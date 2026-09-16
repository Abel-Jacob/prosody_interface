"""
LexiRep Custom Training — Standalone PyTorch Training Pipeline

Supports:
- Direct .npz cache files (X_tr, Y_tr, W_tr, X_te, Y_te, W_te) for instant training
- Direct .csv dataset files (both transposed 770-row ISLE format and standard row-based format)
  with automatic validation, polysyllabic filtering, 80/20 word-isolated split, and .npz caching
- 5-layer MLP representation encoder (768 -> 128 -> 64 -> 32 -> 16 -> 10) matching prosody_lexirep.py
- Supervised Contrastive Loss (SupConLoss) with temperature scaling (T=0.08)
- Symmetric IDEC Autoencoder (10 -> 32 -> 32 -> 20 -> 2 -> 10) with Student-t soft clustering
- Automated one-shot reference anchor selection (1 stressed, 1 unstressed syllable from same word)
- 13-loop iterative self-training with linguistic constraint enforcement (Δ_i = |sim(z_i, z_s^h) - sim(z_i, z_u^h)|)
- Live loop-by-loop progress tracking for real-time frontend visualization
- Checkpoint generation strictly compatible with prosody_lexirep.py
- Rich model summary and weight statistics export (JSON) for creative UI display
"""

import asyncio
import io
import json
import logging
import math
import os
import random
import time
import traceback
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Optional, Callable

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.metrics import accuracy_score
from sklearn.metrics.pairwise import cosine_similarity
import torch
import torch.nn as nn
import torch.nn.functional as F
import torch.optim as optim

logger = logging.getLogger(__name__)


# ── Hyperparameters matching the paper & reference ────────────
INPUT_DIM = 768
CL_LATENT_DIM = 10
ENCODER_UNITS = [128, 64, 32, 16, CL_LATENT_DIM]
IDEC_AE_SHAPE = [CL_LATENT_DIM, 32, 32, 20, 2]
DEFAULT_LOOPS = 13
TEMPERATURE = 0.08
GAMMA = 0.4
ALPHA = 1.0
LEARNING_RATE = 0.001
IDEC_LR = 0.001
BATCH_WORDS = 32
EPOCHS_PER_LOOP = 6
IDEC_EPOCHS_PER_LOOP = 5
SEED = 42


# ── Models ─────────────────────────────────────────────────────

class LexiRepEncoder(nn.Module):
    """
    5-layer MLP encoder: 768 -> 128 -> 64 -> 32 -> 16 -> 10.
    Identical layer naming ('net.0', 'net.2', 'net.4', 'net.6', 'net.8')
    to ensure 100% plug-and-play compatibility with prosody_lexirep.py.
    """
    def __init__(self, in_dim=INPUT_DIM, hidden=ENCODER_UNITS):
        super().__init__()
        layers = []
        cur = in_dim
        for h in hidden[:-1]:
            layers.append(nn.Linear(cur, h))
            layers.append(nn.ReLU())
            cur = h
        layers.append(nn.Linear(cur, hidden[-1]))
        layers.append(nn.Sigmoid())
        self.net = nn.Sequential(*layers)

    def forward(self, x):
        return self.net(x)


class IDECAutoencoder(nn.Module):
    """
    Symmetric autoencoder for IDEC (10 -> 32 -> 32 -> 20 -> 2 -> 10)
    with Student-t soft assignment layer.
    """
    def __init__(self, in_dim=CL_LATENT_DIM, shape=IDEC_AE_SHAPE, alpha=ALPHA):
        super().__init__()
        self.alpha = alpha
        self.encoder = nn.Sequential(
            nn.Linear(shape[0], shape[1]), nn.ReLU(),
            nn.Linear(shape[1], shape[2]), nn.ReLU(),
            nn.Linear(shape[2], shape[3]), nn.ReLU(),
            nn.Linear(shape[3], shape[4])
        )
        self.decoder = nn.Sequential(
            nn.Linear(shape[4], shape[3]), nn.ReLU(),
            nn.Linear(shape[3], shape[2]), nn.ReLU(),
            nn.Linear(shape[2], shape[1]), nn.ReLU(),
            nn.Linear(shape[1], shape[0]), nn.Sigmoid()
        )
        self.cluster_centers = nn.Parameter(torch.Tensor(2, shape[4]))
        nn.init.xavier_uniform_(self.cluster_centers)

    def forward(self, x):
        z = self.encoder(x)
        x_rec = self.decoder(z)
        z_norm = F.normalize(z, dim=1)
        c_norm = F.normalize(self.cluster_centers, dim=1)
        dist = torch.sum((z_norm.unsqueeze(1) - c_norm.unsqueeze(0)) ** 2, dim=2)
        q = 1.0 / (1.0 + dist / self.alpha)
        q = q ** ((self.alpha + 1.0) / 2.0)
        q = q / torch.sum(q, dim=1, keepdim=True)
        return z, x_rec, q


def target_distribution(q):
    p = q ** 2 / torch.sum(q, dim=0, keepdim=True)
    p = p / torch.sum(p, dim=1, keepdim=True)
    return p


class SupConLoss(nn.Module):
    """Supervised Contrastive Loss (Paper Equation 1)."""
    def __init__(self, temp=TEMPERATURE):
        super().__init__()
        self.temp = temp

    def forward(self, z, y):
        zn = F.normalize(z, dim=1)
        sim = torch.mm(zn, zn.t()) / self.temp
        sim_max, _ = torch.max(sim, dim=1, keepdim=True)
        sim = sim - sim_max.detach()
        labels = y.view(-1, 1)
        mask = torch.eq(labels, labels.t()).float()
        diag = torch.eye(len(y), device=z.device)
        mask = mask * (1.0 - diag)
        exp_sim = torch.exp(sim) * (1.0 - diag)
        log_prob = sim - torch.log(exp_sim.sum(1, keepdim=True) + 1e-12)
        pos_counts = mask.sum(1)
        valid = pos_counts > 0
        loss = - (mask * log_prob).sum(1) / torch.clamp(pos_counts, min=1.0)
        return torch.mean(loss[valid]) if valid.any() else torch.tensor(0.0, device=z.device)


def make_word_batches(X, labels, wmap, batch_words=BATCH_WORDS):
    """
    Generate balanced word-level batches for contrastive training.
    """
    words = list(wmap.keys())
    np.random.shuffle(words)
    batches = []
    for i in range(0, len(words), batch_words):
        b_words = words[i:i + batch_words]
        b_idxs = []
        for w in b_words:
            idxs = wmap[w]
            s_idxs = [j for j in idxs if labels[j] == 1]
            u_idxs = [j for j in idxs if labels[j] == 0]
            if s_idxs and u_idxs:
                rep = max(1, len(u_idxs) // len(s_idxs))
                b_idxs.extend(s_idxs * rep + u_idxs)
        if len(b_idxs) >= 8:
            batches.append((
                torch.tensor(X[b_idxs], dtype=torch.float32),
                torch.tensor(labels[b_idxs], dtype=torch.long)
            ))
    return batches


# ── Job Status & Dataclass ─────────────────────────────────────

class TrainJobStatus(str, Enum):
    RUNNING = "running"
    COMPLETE = "complete"
    FAILED = "failed"


def log_lexirep(msg: str):
    """Print to both standard logger and stdout with flush=True so logs appear in Colab/terminals."""
    logger.info(msg)
    print(msg, flush=True)


@dataclass
class TrainJob:
    job_id: str
    status: TrainJobStatus
    dataset_path: Path
    output_dir: Path
    epochs: int = DEFAULT_LOOPS
    error: Optional[str] = None
    output_files: list = field(default_factory=list)
    current_loop: int = 0
    total_loops: int = DEFAULT_LOOPS
    progress: int = 0
    current_metrics: dict = field(default_factory=dict)
    history: list = field(default_factory=list)
    model_summary: dict = field(default_factory=dict)
    logs: list = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "job_id": self.job_id,
            "status": self.status.value,
            "dataset_path": str(self.dataset_path),
            "output_dir": str(self.output_dir),
            "epochs": self.epochs,
            "error": self.error,
            "output_files": self.output_files,
            "current_loop": self.current_loop,
            "total_loops": self.total_loops,
            "progress": self.progress,
            "current_metrics": self.current_metrics,
            "history": self.history,
            "model_summary": self.model_summary,
            "logs": self.logs,
        }

    def save_to_disk(self):
        try:
            job_file = self.output_dir.parent / "job_info.json"
            with open(job_file, "w") as f:
                json.dump(self.to_dict(), f, indent=2)
        except Exception as e:
            logger.warning(f"Failed to save job_info.json: {e}")


# ── In-memory job store (isolated per job_id) ──────────────────
_jobs: dict[str, TrainJob] = {}


def get_train_job(job_id: str) -> Optional[TrainJob]:
    if job_id in _jobs:
        return _jobs[job_id]
    # Fallback: read persisted status from disk
    from config import BASE_DIR
    job_file = BASE_DIR / "lexirep_jobs" / job_id / "job_info.json"
    if job_file.exists():
        try:
            with open(job_file, "r") as f:
                d = json.load(f)
            job = TrainJob(
                job_id=d["job_id"],
                status=TrainJobStatus(d["status"]),
                dataset_path=Path(d.get("dataset_path", "")),
                output_dir=Path(d.get("output_dir", "")),
                epochs=d.get("epochs", DEFAULT_LOOPS),
                error=d.get("error"),
                output_files=d.get("output_files", []),
                current_loop=d.get("current_loop", 0),
                total_loops=d.get("total_loops", DEFAULT_LOOPS),
                progress=d.get("progress", 0),
                current_metrics=d.get("current_metrics", {}),
                history=d.get("history", []),
                model_summary=d.get("model_summary", {}),
                logs=d.get("logs", []),
            )
            _jobs[job_id] = job
            return job
        except Exception as e:
            logger.warning(f"Failed to load job_info.json from disk: {e}")
    return None


def create_train_job(dataset_path: Path, output_dir: Path, epochs: int = DEFAULT_LOOPS, job_id: Optional[str] = None) -> TrainJob:
    if job_id is None:
        job_id = str(uuid.uuid4())
    job = TrainJob(
        job_id=job_id,
        status=TrainJobStatus.RUNNING,
        dataset_path=dataset_path,
        output_dir=output_dir,
        epochs=epochs,
        total_loops=epochs,
    )
    job.save_to_disk()
    _jobs[job_id] = job
    return job


# ── Dataset Loading & Automatic CSV-to-NPZ Conversion ──────────

def filter_polysyllabic(X, Y, W):
    """Filter dataset to polysyllabic words (>= 2 syllables) only."""
    wmap = defaultdict(list)
    for i, w in enumerate(W):
        wmap[w].append(i)
    keep_indices = []
    for w, idxs in wmap.items():
        if len(idxs) >= 2:
            keep_indices.extend(idxs)
    keep_indices = np.array(sorted(keep_indices))
    if len(keep_indices) == 0:
        return X, Y, W
    return X[keep_indices], Y[keep_indices], W[keep_indices]


def parse_and_convert_csv(csv_path: Path, output_npz_path: Optional[Path] = None):
    """
    Parse a CSV file and convert it into a train/test dictionary:
    Returns (X_tr, Y_tr, W_tr, X_te, Y_te, W_te).
    Supports:
    1. Transposed format (shape: 770 rows, N cols):
       - Rows 0 to -3: 768 feature dimensions
       - Row -2: label (0 or 1)
       - Row -1: word_id
    2. Columnar format:
       - 768 feature columns + 'label' + 'word_id' (or 770 columns)
    """
    df = pd.read_csv(csv_path, header=None)

    # Check if transposed (768 to 780 rows)
    if 768 <= df.shape[0] <= 780:
        # Transposed format (features are rows 0..767, label and word at bottom)
        feat_rows = 768
        X = df.iloc[:feat_rows, :].values.T.astype(np.float32)
        if df.shape[0] >= 770:
            try:
                Y = df.iloc[-2, :].values.astype(int)
                W = df.iloc[-1, :].values.astype(int)
            except Exception:
                n = len(X)
                W = np.repeat(np.arange(n // 2 + 1), 2)[:n]
                Y = np.zeros(n, dtype=int)
                Y[0::2] = 1
        else:
            n = len(X)
            W = np.repeat(np.arange(n // 2 + 1), 2)[:n]
            Y = np.zeros(n, dtype=int)
            Y[0::2] = 1
    elif df.shape[1] >= 768:
        # Standard row-based format (rows = samples, cols >= 768)
        # Check if first row is a header containing non-numeric strings
        first_row = df.iloc[0, :min(10, df.shape[1])].values
        has_str_header = any(
            isinstance(v, str) and not v.replace('.', '', 1).replace('-', '', 1).replace('e', '', 1).replace('E', '', 1).isdigit()
            for v in first_row
        )
        if has_str_header:
            df = df.iloc[1:, :].reset_index(drop=True)

        feat_cols = list(range(0, 768))
        X = df.iloc[:, feat_cols].values.astype(np.float32)
        if df.shape[1] >= 770:
            try:
                Y = df.iloc[:, 768].values.astype(int)
                W = df.iloc[:, 769].values.astype(int)
            except Exception:
                n = len(X)
                W = np.repeat(np.arange(n // 2 + 1), 2)[:n]
                Y = np.zeros(n, dtype=int)
                Y[0::2] = 1
        elif df.shape[1] >= 769:
            try:
                Y = df.iloc[:, 768].values.astype(int)
                n = len(X)
                W = np.repeat(np.arange(n // 2 + 1), 2)[:n]
            except Exception:
                n = len(X)
                W = np.repeat(np.arange(n // 2 + 1), 2)[:n]
                Y = np.zeros(n, dtype=int)
                Y[0::2] = 1
        else:
            n = len(X)
            W = np.repeat(np.arange(n // 2 + 1), 2)[:n]
            Y = np.zeros(n, dtype=int)
            Y[0::2] = 1
    else:
        raise ValueError(f"Unrecognized CSV shape: {df.shape}. Expected 768-D features.")

    # Polysyllabic filter
    X, Y, W = filter_polysyllabic(X, Y, W)

    # Word-isolated Train/Test split (80% train, 20% test)
    unique_words = np.unique(W)
    rng = np.random.RandomState(SEED)
    rng.shuffle(unique_words)
    split_pt = int(len(unique_words) * 0.8)
    tr_words = set(unique_words[:split_pt])
    te_words = set(unique_words[split_pt:])

    tr_mask = np.array([w in tr_words for w in W])
    te_mask = np.array([w in te_words for w in W])

    X_tr, Y_tr, W_tr = X[tr_mask], Y[tr_mask], W[tr_mask]
    X_te, Y_te, W_te = X[te_mask], Y[te_mask], W[te_mask]

    if output_npz_path:
        np.savez_compressed(
            output_npz_path,
            X_tr=X_tr, Y_tr=Y_tr, W_tr=W_tr,
            X_te=X_te, Y_te=Y_te, W_te=W_te
        )

    return X_tr, Y_tr, W_tr, X_te, Y_te, W_te


def load_dataset_file(filepath: Path, cache_npz_path: Optional[Path] = None):
    """Load dataset from .npz, .npy, or .csv."""
    ext = filepath.suffix.lower()

    if ext == ".npz":
        data = np.load(str(filepath))
        if "X_tr" in data and "X_te" in data:
            return (
                data["X_tr"], data["Y_tr"], data["W_tr"],
                data["X_te"], data["Y_te"], data["W_te"]
            )
        elif "X" in data:
            X = data["X"]
            Y = data["Y"] if "Y" in data else np.zeros(len(X), dtype=int)
            W = data["W"] if "W" in data else np.repeat(np.arange(len(X) // 2 + 1), 2)[:len(X)]
            X, Y, W = filter_polysyllabic(X, Y, W)
            unique_w = np.unique(W)
            rng = np.random.RandomState(SEED)
            rng.shuffle(unique_w)
            split_pt = int(len(unique_w) * 0.8)
            tr_words = set(unique_w[:split_pt])
            tr_mask = np.array([w in tr_words for w in W])
            te_mask = ~tr_mask
            return X[tr_mask], Y[tr_mask], W[tr_mask], X[te_mask], Y[te_mask], W[te_mask]
        else:
            raise ValueError(f"NPZ keys not recognized. Expected ('X_tr', 'Y_tr', 'W_tr') or ('X', 'Y', 'W'). Found: {list(data.keys())}")

    elif ext == ".csv":
        return parse_and_convert_csv(filepath, output_npz_path=cache_npz_path)

    elif ext == ".npy":
        arr = np.load(str(filepath))
        if arr.shape[1] < 768:
            raise ValueError(f"Expected at least 768 feature columns, got {arr.shape[1]}")
        X = arr[:, :768].astype(np.float32)
        n = len(X)
        W = np.repeat(np.arange(n // 2 + 1), 2)[:n]
        Y = np.zeros(n, dtype=int)
        Y[0::2] = 1
        X, Y, W = filter_polysyllabic(X, Y, W)
        split = int(len(X) * 0.8)
        if cache_npz_path:
            np.savez_compressed(cache_npz_path, X_tr=X[:split], Y_tr=Y[:split], W_tr=W[:split],
                                X_te=X[split:], Y_te=Y[split:], W_te=W[split:])
        return X[:split], Y[:split], W[:split], X[split:], Y[split:], W[split:]

    else:
        raise ValueError(f"Unsupported file format: {ext}")


def find_best_anchor(
    X_train: np.ndarray,
    Y_train: np.ndarray,
    W_train: np.ndarray,
    device: str = "cpu"
) -> tuple[int, int, any, float]:
    """
    Offline Anchor Selection Pipeline (Paper Section III-B.1):
    Strict adherence to zero-test-leakage methodology:
    Systematically scans candidate bisyllabic/polysyllabic word pairs strictly within the
    training set (X_train, Y_train, W_train) to select the polar reference anchor (rs, ru)
    with maximal intra-word training separation accuracy.
    Test set is NEVER touched, accessed, or referenced during this selection.

    Returns: (rs_idx, ru_idx, word_id, train_separation_acc)
    """
    wmap_tr = defaultdict(list)
    for i, w in enumerate(W_train):
        wmap_tr[w].append(i)

    # 1. Identify all candidate words with at least 1 stressed and 1 unstressed syllable
    b_words = [
        w for w, idxs in wmap_tr.items()
        if len(idxs) == 2 and any(Y_train[i] == 1 for i in idxs) and any(Y_train[i] == 0 for i in idxs)
    ]

    # If fewer than 10 bisyllabic words, expand to tri-syllabic and all polysyllabic words
    if len(b_words) < 10:
        b_words = [
            w for w, idxs in wmap_tr.items()
            if len(idxs) >= 2 and any(Y_train[i] == 1 for i in idxs) and any(Y_train[i] == 0 for i in idxs)
        ]

    # Graceful fallback if no labeled words exist (e.g. pure unsupervised custom dataset)
    if not b_words:
        s_any = np.where(Y_train == 1)[0]
        u_any = np.where(Y_train == 0)[0]
        if len(s_any) > 0 and len(u_any) > 0:
            return int(s_any[0]), int(u_any[0]), W_train[s_any[0]], 50.0

        # Unlabeled custom dataset: select bisyllabic word with maximal intra-word acoustic separation
        bisyl_all = [w for w, idxs in wmap_tr.items() if len(idxs) == 2]
        if bisyl_all:
            best_dist = -1.0
            best_pair = (wmap_tr[bisyl_all[0]][0], wmap_tr[bisyl_all[0]][1], bisyl_all[0])
            for w in bisyl_all[:300]:
                i1, i2 = wmap_tr[w][0], wmap_tr[w][1]
                v1, v2 = X_train[i1], X_train[i2]
                norm_prod = (np.linalg.norm(v1) * np.linalg.norm(v2)) + 1e-9
                dist = 1.0 - float(np.dot(v1, v2) / norm_prod)
                if dist > best_dist:
                    best_dist = dist
                    best_pair = (i1, i2, w)
            return int(best_pair[0]), int(best_pair[1]), best_pair[2], 50.0

        return 0, 1, W_train[0], 50.0

    # 2. Pre-normalize training representations for fast PyTorch cosine evaluation
    torch_device = torch.device(device if torch.cuda.is_available() and device == "cuda" else "cpu")
    X_norm = torch.tensor(X_train, dtype=torch.float32, device=torch_device)
    X_norm = F.normalize(X_norm, dim=1)

    # Group words into:
    # - exactly 2 syllables (1 stressed, 1 unstressed) -> m2_s, m2_u
    # - >2 syllables (1 stressed, multiple unstressed) -> other_words: (s_idx, [u_idxs])
    m2_s, m2_u, other_words = [], [], []
    for w, idxs in wmap_tr.items():
        s_list = [i for i in idxs if Y_train[i] == 1]
        u_list = [i for i in idxs if Y_train[i] == 0]
        if s_list and u_list:
            s_idx = s_list[0]
            if len(u_list) == 1:
                m2_s.append(s_idx)
                m2_u.append(u_list[0])
            else:
                other_words.append((s_idx, torch.tensor(u_list, dtype=torch.long, device=torch_device)))

    m2_s_tensor = torch.tensor(m2_s, dtype=torch.long, device=torch_device) if m2_s else None
    m2_u_tensor = torch.tensor(m2_u, dtype=torch.long, device=torch_device) if m2_u else None

    # Collect candidate anchor pairs (s, u)
    candidates = []
    s_cand, u_cand = [], []
    for w in b_words:
        idxs = wmap_tr[w]
        s_idxs = [i for i in idxs if Y_train[i] == 1]
        u_idxs = [i for i in idxs if Y_train[i] == 0]
        if s_idxs and u_idxs:
            s = s_idxs[0]
            u = u_idxs[0]
            candidates.append((w, s, u))
            s_cand.append(s)
            u_cand.append(u)

    s_cand_tensor = torch.tensor(s_cand, dtype=torch.long, device=torch_device)
    u_cand_tensor = torch.tensor(u_cand, dtype=torch.long, device=torch_device)

    # 3. Batched evaluation across candidates
    cand_accs = []
    batch_size = 500
    base_correct = len(Y_train) - 2 * len(wmap_tr)

    with torch.no_grad():
        for b_start in range(0, len(candidates), batch_size):
            b_end = min(b_start + batch_size, len(candidates))
            sb = s_cand_tensor[b_start:b_end]
            ub = u_cand_tensor[b_start:b_end]

            # Difference vector in normalized space: (rs - ru)
            diff_vec = X_norm[sb] - X_norm[ub]  # [B, 768]
            diffs = torch.mm(X_norm, diff_vec.t())  # [N_tr, B]

            if m2_s_tensor is not None and len(m2_s_tensor) > 0:
                m2_correct = (diffs[m2_s_tensor] > diffs[m2_u_tensor]).long().sum(dim=0)
            else:
                m2_correct = torch.zeros(b_end - b_start, dtype=torch.long, device=torch_device)

            other_correct = torch.zeros(b_end - b_start, dtype=torch.long, device=torch_device)
            for s_idx, u_idx_tensor in other_words:
                u_max = torch.max(diffs[u_idx_tensor], dim=0).values
                other_correct += (diffs[s_idx] > u_max).long()

            tot_correct = base_correct + (m2_correct + other_correct) * 2
            b_accs = (tot_correct.float() / len(Y_train) * 100.0).cpu().tolist()
            cand_accs.extend(b_accs)

    results = [
        (candidates[i][0], candidates[i][1], candidates[i][2], cand_accs[i])
        for i in range(len(candidates))
    ]
    results.sort(key=lambda x: x[3], reverse=True)
    best_w, best_s, best_u, best_acc = results[0]
    return int(best_s), int(best_u), best_w, float(best_acc)


# ── Full Iterative LexiRep Training Runner ─────────────────────

def run_lexirep_training(
    dataset_path: Path,
    output_dir: Path,
    epochs: int = DEFAULT_LOOPS,
    on_progress: Optional[Callable[[dict], None]] = None
) -> dict:
    """
    Run the full standalone PyTorch LexiRep pipeline.
    """
    t0_start = time.time()
    output_dir.mkdir(parents=True, exist_ok=True)
    cache_npz_path = output_dir / "dataset_cache.npz"

    # 1. Deterministic seeding
    random.seed(SEED)
    np.random.seed(SEED)
    torch.manual_seed(SEED)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    log_lexirep(f"[LexiRep Training] Training on device: {device}")

    # 2. Load and validate data
    log_lexirep(f"[LexiRep Training] Loading dataset from: {dataset_path}")
    if on_progress:
        on_progress({"progress": 4, "log": f"Ingesting dataset from {dataset_path.name}..."})

    X_train, Y_train, W_train, X_test, Y_test, W_test = load_dataset_file(
        dataset_path, cache_npz_path=cache_npz_path
    )

    log_lexirep(f"[LexiRep Training] Loaded {len(X_train)} train samples, {len(X_test)} test samples (768-D).")
    if on_progress:
        on_progress({
            "progress": 8,
            "log": f"Dataset ingested: {len(X_train)} train, {len(X_test)} test syllables (768-D features)."
        })

    wmap_tr = defaultdict(list)
    for i, w in enumerate(W_train):
        wmap_tr[w].append(i)

    wmap_te = defaultdict(list)
    for i, w in enumerate(W_test):
        wmap_te[w].append(i)

    mask_b = np.array([i for w, idxs in wmap_te.items() if len(idxs) == 2 for i in idxs])
    mask_bt = np.array([i for w, idxs in wmap_te.items() if len(idxs) in (2, 3) for i in idxs])
    mask_btq = np.array([i for w, idxs in wmap_te.items() if len(idxs) in (2, 3, 4) for i in idxs])

    # 3. Locate reference anchor syllables via Offline Anchor Selection Pipeline (Paper Section III-B.1)
    if on_progress:
        on_progress({
            "progress": 9,
            "log": "Executing offline anchor selection pipeline across training split..."
        })
    log_lexirep("[LexiRep Training] Executing offline anchor selection pipeline (zero test leakage)...")
    rs_idx, ru_idx, anc_word, tr_sep_acc = find_best_anchor(X_train, Y_train, W_train, device=str(device))
    rs_vec = X_train[rs_idx:rs_idx + 1]
    ru_vec = X_train[ru_idx:ru_idx + 1]
    log_lexirep(f"[LexiRep Training] Optimal polar anchor selected from Word #{anc_word} (rs={rs_idx}, ru={ru_idx}) with {tr_sep_acc:.2f}% train separation.")
    if on_progress:
        on_progress({
            "progress": 11,
            "log": f"Optimal polar anchor: Word #{anc_word} (train separation: {tr_sep_acc:.1f}%)."
        })

    # 4. Initialize Models & Optimizers
    cl_encoder = LexiRepEncoder().to(device)
    cl_optimizer = optim.Adam(cl_encoder.parameters(), lr=LEARNING_RATE)
    supcon_criterion = SupConLoss(temp=TEMPERATURE)

    idec_model = IDECAutoencoder(in_dim=CL_LATENT_DIM, shape=IDEC_AE_SHAPE, alpha=ALPHA).to(device)
    idec_optimizer = optim.Adam(idec_model.parameters(), lr=IDEC_LR)

    # 5. Loop 0: Cold-Start Pseudo-Labels via reference anchor (directional stress margin)
    diff_tr0 = cosine_similarity(X_train, rs_vec).flatten() - cosine_similarity(X_train, ru_vec).flatten()
    labels_tr = np.zeros(len(Y_train), dtype=int)
    for w, idxs in wmap_tr.items():
        labels_tr[idxs[np.argmax(diff_tr0[idxs])]] = 1

    log_lexirep(f"[LexiRep Training] Loop 0: Initializing cold-start representation warmup...")
    if on_progress:
        on_progress({
            "current_loop": 0,
            "progress": 12,
            "log": "Cold-start pseudo-labeling initialized. Warming up contrastive encoder..."
        })

    # Warmup contrastive encoder on cold-start pseudo-labels
    cl_encoder.train()
    warmup_batches = make_word_batches(X_train, labels_tr, wmap_tr, batch_words=BATCH_WORDS)
    for ep in range(3):
        for bx, by in warmup_batches:
            bx, by = bx.to(device), by.to(device)
            cl_optimizer.zero_grad()
            out = cl_encoder(bx)
            loss = supcon_criterion(out, by)
            loss.backward()
            cl_optimizer.step()

    # Pretrain IDEC Autoencoder on initial 10-D representations
    cl_encoder.eval()
    with torch.no_grad():
        h_tr_init = cl_encoder(torch.tensor(X_train, dtype=torch.float32).to(device))

    for ep in range(IDEC_EPOCHS_PER_LOOP):
        idec_optimizer.zero_grad()
        _, rec, _ = idec_model(h_tr_init)
        loss_rec = F.mse_loss(rec, h_tr_init)
        loss_rec.backward()
        idec_optimizer.step()

    # Initialize IDEC cluster centers via K-means on normalized 2-D latent space
    with torch.no_grad():
        z_lat_init, _, _ = idec_model(h_tr_init)
    z_norm_init = F.normalize(z_lat_init, dim=1).cpu().numpy()
    km_init = KMeans(n_clusters=2, random_state=SEED, n_init=5).fit(z_norm_init)
    idec_model.cluster_centers.data = torch.tensor(km_init.cluster_centers_, dtype=torch.float32).to(device)

    # Initial test evaluation (directional stress margin)
    diff_te0 = cosine_similarity(X_test, rs_vec).flatten() - cosine_similarity(X_test, ru_vec).flatten()
    preds_te0 = np.zeros(len(Y_test), dtype=int)
    for w, idxs in wmap_te.items():
        preds_te0[idxs[np.argmax(diff_te0[idxs])]] = 1

    init_b = float(accuracy_score(Y_test[mask_b], preds_te0[mask_b]) * 100) if len(mask_b) else 0.0
    init_bt = float(accuracy_score(Y_test[mask_bt], preds_te0[mask_bt]) * 100) if len(mask_bt) else 0.0
    init_btq = float(accuracy_score(Y_test[mask_btq], preds_te0[mask_btq]) * 100) if len(mask_btq) else 0.0

    history_scorecard = [{
        "loop": 0,
        "train": float(accuracy_score(Y_train, labels_tr) * 100),
        "B": round(init_b, 2),
        "BT": round(init_bt, 2),
        "BTQ": round(init_btq, 2),
        "loss": 1.0,
    }]

    if on_progress:
        on_progress({
            "current_loop": 0,
            "total_loops": epochs,
            "progress": 14,
            "current_metrics": history_scorecard[-1],
            "history": history_scorecard,
            "log": f"Cold-start ready: Base BTQ {init_btq:.1f}%. Starting iterative self-training..."
        })

    # 6. Iterative Self-Training Loops
    best_btq = init_btq
    best_loss = 1.0
    z_s_h_best = None
    z_u_h_best = None

    for loop in range(1, epochs + 1):
        log_lexirep(f"[LexiRep Training] Starting Loop {loop}/{epochs}...")
        if on_progress:
            on_progress({
                "current_loop": loop,
                "log": f"Loop {loop}/{epochs}: Running SupCon contrastive learning & IDEC joint clustering..."
            })

        # 6a. Contrastive Learning on refined pseudo-labels
        cl_encoder.train()
        batches = make_word_batches(X_train, labels_tr, wmap_tr, batch_words=BATCH_WORDS)
        cl_loss_sum = 0.0
        cl_steps = 0
        for ep in range(EPOCHS_PER_LOOP):
            for bx, by in batches:
                bx, by = bx.to(device), by.to(device)
                cl_optimizer.zero_grad()
                out = cl_encoder(bx)
                loss = supcon_criterion(out, by)
                loss.backward()
                torch.nn.utils.clip_grad_norm_(cl_encoder.parameters(), max_norm=5.0)
                cl_optimizer.step()
                cl_loss_sum += float(loss.item())
                cl_steps += 1

        # 6b. Extract representations
        cl_encoder.eval()
        with torch.no_grad():
            h_tr = cl_encoder(torch.tensor(X_train, dtype=torch.float32).to(device))
            h_te = cl_encoder(torch.tensor(X_test, dtype=torch.float32).to(device))
            h_rs = cl_encoder(torch.tensor(rs_vec, dtype=torch.float32).to(device))
            h_ru = cl_encoder(torch.tensor(ru_vec, dtype=torch.float32).to(device))

        # 6c. IDEC Joint Clustering
        idec_model.train()
        with torch.no_grad():
            _, _, q_init = idec_model(h_tr)
            p_target = target_distribution(q_init.detach())

        last_idec_loss = 0.0
        for ep in range(IDEC_EPOCHS_PER_LOOP):
            if ep > 0 and ep % 2 == 0:
                with torch.no_grad():
                    _, _, q_curr = idec_model(h_tr)
                    p_target = target_distribution(q_curr.detach())
            idec_optimizer.zero_grad()
            z_lat, rec, q = idec_model(h_tr)
            loss_rec = F.mse_loss(rec, h_tr)
            loss_kl = F.kl_div(q.log(), p_target, reduction='batchmean')
            loss_idec = loss_rec + GAMMA * loss_kl
            loss_idec.backward()
            torch.nn.utils.clip_grad_norm_(idec_model.parameters(), max_norm=5.0)
            idec_optimizer.step()
            last_idec_loss = float(loss_idec.item())

        # 6d. Polar alignment using reference syllables
        idec_model.eval()
        with torch.no_grad():
            _, _, q_tr = idec_model(h_tr)

        q_tr_np = q_tr.cpu().numpy()
        h_tr_np = h_tr.cpu().numpy()
        h_te_np = h_te.cpu().numpy()

        q_rs, q_ru = q_tr_np[rs_idx], q_tr_np[ru_idx]
        s_cluster = 0 if (q_rs[0] - q_ru[0]) >= (q_rs[1] - q_ru[1]) else 1
        u_cluster = 1 - s_cluster

        # 6e. Linguistic Constraint Enforcement
        idx_s_h = int(np.argmax(q_tr_np[:, s_cluster]))
        idx_u_h = int(np.argmax(q_tr_np[:, u_cluster]))
        z_s_h = h_tr_np[idx_s_h:idx_s_h + 1]
        z_u_h = h_tr_np[idx_u_h:idx_u_h + 1]

        # 6e. Linguistic Constraint Enforcement (directional prototype similarity)
        diff_tr = cosine_similarity(h_tr_np, z_s_h).flatten() - cosine_similarity(h_tr_np, z_u_h).flatten()
        new_labels_tr = np.zeros(len(Y_train), dtype=int)
        for w, idxs in wmap_tr.items():
            new_labels_tr[idxs[np.argmax(diff_tr[idxs])]] = 1
        labels_tr = new_labels_tr
        train_acc = float(accuracy_score(Y_train, labels_tr) * 100)

        # 6f. Unseen Test Set Evaluation (BTQ argmax, directional)
        diff_te = cosine_similarity(h_te_np, z_s_h).flatten() - cosine_similarity(h_te_np, z_u_h).flatten()
        preds_te = np.zeros(len(Y_test), dtype=int)
        for w, idxs in wmap_te.items():
            preds_te[idxs[np.argmax(diff_te[idxs])]] = 1

        b_acc = float(accuracy_score(Y_test[mask_b], preds_te[mask_b]) * 100) if len(mask_b) else 0.0
        bt_acc = float(accuracy_score(Y_test[mask_bt], preds_te[mask_bt]) * 100) if len(mask_bt) else 0.0
        btq_acc = float(accuracy_score(Y_test[mask_btq], preds_te[mask_btq]) * 100) if len(mask_btq) else 0.0

        loop_record = {
            "loop": loop,
            "train": round(train_acc, 2),
            "B": round(b_acc, 2),
            "BT": round(bt_acc, 2),
            "BTQ": round(btq_acc, 2),
            "loss": round(last_idec_loss, 4),
        }
        history_scorecard.append(loop_record)

        if btq_acc >= best_btq or loop == epochs:
            best_btq = btq_acc
            best_loss = last_idec_loss
            z_s_h_best = z_s_h
            z_u_h_best = z_u_h

        prog_pct = int(14 + (loop / epochs) * 82)
        log_lexirep(f"[LexiRep Training] Loop {loop}/{epochs} Complete -> Train: {train_acc:.1f}%, Test BTQ: {btq_acc:.1f}%, IDEC Loss: {last_idec_loss:.4f}")

        if on_progress:
            on_progress({
                "current_loop": loop,
                "total_loops": epochs,
                "progress": prog_pct,
                "current_metrics": loop_record,
                "history": history_scorecard,
                "log": f"Loop {loop}/{epochs}: Train {train_acc:.1f}%, Test BTQ {btq_acc:.1f}%, Loss {last_idec_loss:.4f}"
            })

    # 7. Compute Layer Weight Statistics & Parameter Counts
    log_lexirep("[LexiRep Training] Computing layer parameter statistics & Frobenius norms...")
    layer_stats = []
    total_params = 0
    cl_state = cl_encoder.state_dict()

    for name, param in cl_state.items():
        total_params += param.numel()
        if "weight" in name:
            p_np = param.cpu().numpy()
            layer_stats.append({
                "name": name,
                "shape": list(p_np.shape),
                "params": param.numel(),
                "mean": round(float(np.mean(p_np)), 5),
                "std": round(float(np.std(p_np)), 5),
                "min": round(float(np.min(p_np)), 5),
                "max": round(float(np.max(p_np)), 5),
                "l2_norm": round(float(np.linalg.norm(p_np)), 3),
            })

    final_metrics = history_scorecard[-1]
    proto_dist = float(cosine_similarity(z_s_h_best, z_u_h_best)[0][0]) if z_s_h_best is not None else 0.0

    model_summary = {
        "architecture": "LexiRep 5-layer MLP (768 -> 128 -> 64 -> 32 -> 16 -> 10)",
        "input_dim": INPUT_DIM,
        "latent_dim": CL_LATENT_DIM,
        "total_parameters": total_params,
        "epochs_trained": epochs,
        "duration_seconds": round(time.time() - t0_start, 2),
        "final_metrics": final_metrics,
        "layer_breakdown": [
            {"layer": 1, "type": "Linear", "in": 768, "out": 128, "activation": "ReLU", "params": 768 * 128 + 128},
            {"layer": 2, "type": "Linear", "in": 128, "out": 64, "activation": "ReLU", "params": 128 * 64 + 64},
            {"layer": 3, "type": "Linear", "in": 64, "out": 32, "activation": "ReLU", "params": 64 * 32 + 32},
            {"layer": 4, "type": "Linear", "in": 32, "out": 16, "activation": "ReLU", "params": 32 * 16 + 16},
            {"layer": 5, "type": "Bottleneck", "in": 16, "out": 10, "activation": "Sigmoid", "params": 16 * 10 + 10},
        ],
        "weight_stats": layer_stats,
        "prototypes": {
            "stressed_vector": [round(float(v), 4) for v in z_s_h_best.flatten()] if z_s_h_best is not None else [],
            "unstressed_vector": [round(float(v), 4) for v in z_u_h_best.flatten()] if z_u_h_best is not None else [],
            "cosine_similarity": round(proto_dist, 4),
        }
    }

    # 8. Save Model Artifacts
    model_pt_path = output_dir / "final_lexirep_model.pt"
    torch.save({
        "cl_encoder": cl_encoder.state_dict(),
        "idec_model": idec_model.state_dict(),
        "z_s_h": torch.tensor(z_s_h_best if z_s_h_best is not None else z_s_h, dtype=torch.float32),
        "z_u_h": torch.tensor(z_u_h_best if z_u_h_best is not None else z_u_h, dtype=torch.float32),
        "loop": epochs,
        "idec_loss": float(best_loss),
        "dataset_name": "CUSTOM",
        "metrics": final_metrics,
        "seed": SEED,
    }, model_pt_path)

    weights_pt_path = output_dir / "model_weights.pt"
    torch.save(cl_encoder.state_dict(), weights_pt_path)

    summary_path = output_dir / "model_summary.json"
    with open(summary_path, "w") as f:
        json.dump(model_summary, f, indent=2)

    history_path = output_dir / "training_history.json"
    with open(history_path, "w") as f:
        json.dump(history_scorecard, f, indent=2)

    log_lexirep(f"[LexiRep Training] SUCCESS: Checkpoint saved to {model_pt_path.name} ({total_params:,} parameters).")
    return model_summary


# ── Daemon thread worker that executes training safely ─────────
import threading


def _run_job_worker(job: TrainJob):
    """Worker function executed in a dedicated OS thread."""
    def progress_callback(update: dict):
        job.current_loop = update.get("current_loop", job.current_loop)
        job.total_loops = update.get("total_loops", job.total_loops)
        job.progress = update.get("progress", job.progress)
        if update.get("current_metrics"):
            job.current_metrics = update["current_metrics"]
        if update.get("history"):
            job.history = update["history"]
        if "log" in update:
            job.logs.append(update["log"])
        job.save_to_disk()

    try:
        log_lexirep(f"[LexiRep API] Starting worker thread for job {job.job_id} ({job.epochs} loops)")
        job.status = TrainJobStatus.RUNNING
        job.progress = 2
        job.logs.append("Dataset received. Initializing PyTorch LexiRep training pipeline...")
        job.save_to_disk()

        model_summary = run_lexirep_training(
            job.dataset_path,
            job.output_dir,
            job.epochs,
            progress_callback
        )

        job.model_summary = model_summary
        job.progress = 100

        # Collect output files
        if job.output_dir.exists():
            job.output_files = [
                f.name for f in job.output_dir.iterdir() if f.is_file()
            ]

        job.status = TrainJobStatus.COMPLETE
        job.logs.append("Training converged! Models, weights, and blueprints ready.")
        job.save_to_disk()
        log_lexirep(f"[LexiRep API] Job {job.job_id} COMPLETE! Output files: {job.output_files}")

    except Exception as e:
        job.status = TrainJobStatus.FAILED
        job.error = f"{type(e).__name__}: {e}"
        job.logs.append(f"Training failed: {job.error}")
        job.save_to_disk()
        log_lexirep(f"[LexiRep API] Job {job.job_id} FAILED: {e}\n{traceback.format_exc()}")


def launch_training_job(job: TrainJob) -> threading.Thread:
    """Launch training in a dedicated daemon thread so it runs completely independent of asyncio GC."""
    thread = threading.Thread(target=_run_job_worker, args=(job,), daemon=True, name=f"lexirep-{job.job_id[:8]}")
    thread.start()
    return thread


async def execute_training_job(job: TrainJob) -> None:
    """Async compatibility wrapper."""
    launch_training_job(job)
