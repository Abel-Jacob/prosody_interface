"""
Prosody LexiRep Module — Syllable-Level Lexical Stress Analyzer

Integrates the trained LexiRep FUSED model into the Prosody Interface pipeline.
For each polysyllabic word, extracts 768-D contextualized Wav2Vec 2.0 features
per syllable, projects through the trained 5-layer MLP encoder to 10-D, and
assigns primary stress via cosine prototype distance + BTQ linguistic constraint.

Pipeline:
  1. Syllabify word via pyphen (zero-dependency OOV-safe)
  2. Compute syllable time boundaries (proportional to word duration)
  3. Extract full-sentence Wav2Vec 2.0 hidden states (768-D, 50fps)
  4. Mean-pool hidden frames per syllable boundary
  5. Project through LexiRep encoder (768 → 128 → 64 → 32 → 16 → 10)
  6. Cosine distance to stressed/unstressed prototypes
  7. BTQ argmax: exactly 1 primary stress per polysyllabic word
"""

import logging
import numpy as np
import torch
import torch.nn as nn
from typing import Optional
from pathlib import Path

from pipeline.prosody_base import ProsodyAnalyzer

logger = logging.getLogger(__name__)


# ── LexiRep Encoder Architecture ──────────────────────────────────
# Matches the exact architecture from lexirep_core.py / notebooks:
# 5-layer MLP: Linear(768,128) → ReLU → Linear(128,64) → ReLU →
#              Linear(64,32) → ReLU → Linear(32,16) → ReLU → Linear(16,10)
# No BatchNorm (checkpoint keys are net.0, net.2, net.4, net.6, net.8)

class LexiRepEncoder(nn.Module):
    """5-layer MLP: 768 → 128 → 64 → 32 → 16 → 10"""
    def __init__(self, in_dim=768, out_dim=10):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(in_dim, 128),
            nn.ReLU(),
            nn.Linear(128, 64),
            nn.ReLU(),
            nn.Linear(64, 32),
            nn.ReLU(),
            nn.Linear(32, 16),
            nn.ReLU(),
            nn.Linear(16, out_dim),
        )

    def forward(self, x):
        return self.net(x)


# ── Syllabifier ───────────────────────────────────────────────────

_pyphen_us = None
_pyphen_gb = None

def _get_pyphens():
    """Lazy-load pyphen dictionaries for US and GB English."""
    global _pyphen_us, _pyphen_gb
    if _pyphen_us is None or _pyphen_gb is None:
        try:
            import pyphen
            _pyphen_us = pyphen.Pyphen(lang='en_US')
            _pyphen_gb = pyphen.Pyphen(lang='en_GB')
        except ImportError:
            logger.warning("pyphen not installed — syllable stress disabled")
            return None, None
    return _pyphen_us, _pyphen_gb


def syllabify_word(word: str) -> list[str]:
    """
    Split a word into syllable strings using combined US/GB pyphen dictionaries.
    Takes the finer-grained split if one dictionary is more detailed.
    Strips trailing punctuation before syllabification.
    """
    import re
    clean = re.sub(r'[^a-zA-Z]', '', word).lower()
    if not clean:
        return [word]

    d_us, d_gb = _get_pyphens()
    if d_us is None:
        return [clean]

    s_us = [s for s in d_us.inserted(clean).split('-') if s]
    s_gb = [s for s in d_gb.inserted(clean).split('-') if s] if d_gb else [clean]

    # Pick the finer breakdown (more syllables detected)
    syllables = s_us if len(s_us) >= len(s_gb) else s_gb
    return syllables if syllables else [clean]


# ── Main Analyzer ─────────────────────────────────────────────────

class SyllableStressAnalyzer(ProsodyAnalyzer):
    """
    LexiRep-based syllable-level lexical stress detector.

    Runs on each grammatical sentence (same interface as StressAnalyzer).
    Adds a 'syllables' list to each polysyllabic word's result.
    """

    name = "syllable_stress"

    def __init__(self):
        self.wav2vec_model = None
        self.models = {}  # {key: {"encoder": ..., "proto_s": ..., "proto_u": ...}}
        self.device = None
        self._ready = False

    def setup(self, models: dict) -> None:
        """
        Load Wav2Vec 2.0 model and LexiRep checkpoints from the models dict.
        Loads all available models: 'fused', 'ger', 'ita'.
        """
        self.wav2vec_model = models.get("wav2vec2")
        if self.wav2vec_model is None:
            logger.warning("SyllableStressAnalyzer: wav2vec2 model not loaded — disabled")
            return

        # Determine device from wav2vec model
        self.device = next(self.wav2vec_model.parameters()).device

        # Get checkpoints dict
        ckpts = models.get("lexirep_ckpts", {})
        if not ckpts and models.get("lexirep_ckpt"):
            ckpts = {"fused": models.get("lexirep_ckpt")}

        if not ckpts:
            logger.warning("SyllableStressAnalyzer: No LexiRep checkpoints loaded — disabled")
            return

        self.models = {}
        for m_key, ckpt in ckpts.items():
            if not ckpt:
                continue
            try:
                encoder = LexiRepEncoder(768, 10).to(self.device)
                encoder.load_state_dict(ckpt["cl_encoder"])
                encoder.eval()

                proto_s = ckpt["z_s_h"].to(self.device).float()
                proto_u = ckpt["z_u_h"].to(self.device).float()

                self.models[m_key] = {
                    "encoder": encoder,
                    "proto_s": proto_s,
                    "proto_u": proto_u,
                    "dataset": ckpt.get("dataset_name", m_key.upper()),
                }
                logger.info(f"SyllableStressAnalyzer: model [{m_key}] loaded on {self.device}")
            except Exception as e:
                logger.error(f"Failed to initialize LexiRep model [{m_key}]: {e}", exc_info=True)

        if self.models:
            self._ready = True
            logger.info(f"SyllableStressAnalyzer ready with models: {list(self.models.keys())}")
        else:
            logger.warning("SyllableStressAnalyzer: No valid LexiRep models initialized")

    def analyze(self, audio_chunk: np.ndarray, words: list[dict]) -> dict:
        """
        Run syllable-level stress detection on a sentence.

        Args:
            audio_chunk: float32 numpy array, 16kHz mono (sentence audio)
            words: ASR word dicts with {word, start, end, confidence, ...}

        Returns:
            {
                "word_syllables": [
                    {
                        "word": "record",
                        "start": 1.20,
                        "syllables": [
                            {"text": "re", "stressed": False, "stress_margin": -0.12},
                            {"text": "cord", "stressed": True, "stress_margin": 0.45},
                        ]
                    },
                    ...
                ]
            }
        """
        if not self._ready or not words:
            return {"word_syllables": []}

        if len(audio_chunk) < 400:
            return {"word_syllables": []}

        try:
            return self._analyze_impl(audio_chunk, words)
        except Exception as e:
            logger.error(f"SyllableStressAnalyzer error: {e}", exc_info=True)
            return {"word_syllables": []}

    @torch.no_grad()
    def _analyze_impl(self, audio_chunk: np.ndarray, words: list[dict]) -> dict:
        """Core analysis implementation."""

        # 1. Full-sentence Wav2Vec 2.0 forward pass
        inp = torch.tensor(audio_chunk, dtype=torch.float32, device=self.device).unsqueeze(0)
        hidden = self.wav2vec_model(inp).last_hidden_state.squeeze(0)  # [T_frames, 768]
        n_frames = hidden.shape[0]
        audio_dur = len(audio_chunk) / 16000.0

        if n_frames == 0 or audio_dur <= 0:
            return {"word_syllables": []}

        # Compute the offset: words have absolute timestamps, but audio_chunk
        # starts at the phrase start time. We need to figure out the offset.
        # The first word's start time tells us the phrase start.
        phrase_start = words[0].get("start", 0.0) if words else 0.0

        results = []

        for w in words:
            word_text = w.get("word", "")
            w_start = w.get("start", 0.0)
            w_end = w.get("end", 0.0)

            # Syllabify
            syls = syllabify_word(word_text)

            # Skip monosyllabic words (no intra-word competition)
            if len(syls) <= 1:
                results.append({
                    "word": word_text,
                    "start": w_start,
                    "syllables": None,  # null signals monosyllabic to frontend
                })
                continue

            # Compute syllable time boundaries (relative to audio chunk)
            # Word timestamps are absolute; audio chunk starts at phrase_start
            rel_start = w_start - phrase_start
            rel_end = w_end - phrase_start
            word_dur = rel_end - rel_start

            if word_dur <= 0:
                results.append({
                    "word": word_text,
                    "start": w_start,
                    "syllables": None,
                })
                continue

            k = len(syls)
            syl_dur = word_dur / k

            # 2. Mean-pool 768-D vectors per syllable slice
            feats = []
            valid = True
            for i in range(k):
                t0 = rel_start + i * syl_dur
                t1 = rel_start + (i + 1) * syl_dur

                # Map time to frame indices (Wav2Vec 2.0: ~50fps at 16kHz)
                # More precisely: frame_rate = n_frames / audio_dur
                frame_rate = n_frames / audio_dur
                f0 = int(np.clip(round(t0 * frame_rate), 0, n_frames - 1))
                f1 = int(np.clip(round(t1 * frame_rate), f0 + 1, n_frames))

                if f0 >= n_frames or f1 <= f0:
                    valid = False
                    break

                syl_vec = hidden[f0:f1].mean(dim=0)  # [768]
                feats.append(syl_vec)

            if not valid or len(feats) != k:
                results.append({
                    "word": word_text,
                    "start": w_start,
                    "syllables": None,
                })
                continue

            feats_tensor = torch.stack(feats)  # [K, 768]

            # 3. Project & Score with each available LexiRep model
            model_margins = {}
            model_bests = {}

            for m_key, m_info in self.models.items():
                z = m_info["encoder"](feats_tensor)  # [K, 10]
                sim_s = torch.cosine_similarity(z, m_info["proto_s"], dim=-1)  # [K]
                sim_u = torch.cosine_similarity(z, m_info["proto_u"], dim=-1)  # [K]
                m_margin = (sim_s - sim_u).cpu().numpy()  # Higher = more stressed
                model_margins[m_key] = m_margin
                model_bests[m_key] = int(np.argmax(m_margin))

            # 4. Compute Dual-Model Ensemble (GER + ITA average)
            if "ger" in model_margins and "ita" in model_margins:
                ens_margin = (model_margins["ger"] + model_margins["ita"]) / 2.0
                model_margins["ensemble"] = ens_margin
                model_bests["ensemble"] = int(np.argmax(ens_margin))

            # Primary default model for legacy/default view: 'fused' -> 'ensemble' -> first available
            default_key = (
                "fused" if "fused" in model_margins
                else "ensemble" if "ensemble" in model_margins
                else list(model_margins.keys())[0]
            )

            syl_results = []
            for idx, syl_text in enumerate(syls):
                # Build per-model prediction map
                models_dict = {}
                for m_key, m_arr in model_margins.items():
                    models_dict[m_key] = {
                        "stressed": bool(idx == model_bests[m_key]),
                        "margin": round(float(m_arr[idx]), 4),
                    }

                syl_results.append({
                    "text": syl_text,
                    "stressed": bool(idx == model_bests[default_key]),
                    "stress_margin": round(float(model_margins[default_key][idx]), 4),
                    "models": models_dict,
                })

            results.append({
                "word": word_text,
                "start": w_start,
                "syllables": syl_results,
            })

        return {"word_syllables": results}
