"""
Prosody Interface Backend — Configuration

All settings centralized here: paths, model sizes, chunk parameters,
database path, server config. Import from here, never hardcode paths
elsewhere.
"""

import os
from pathlib import Path

# ── Paths ──────────────────────────────────────────────────────
BASE_DIR = Path(__file__).parent.resolve()
AUDIO_UPLOADS_DIR = BASE_DIR / "audio_uploads"
ANNOTATIONS_DIR = BASE_DIR / "annotations"
DB_PATH = BASE_DIR / "jobs.db"
VENDOR_DIR = BASE_DIR / "vendor"
# Function to automatically resolve WhiStress weights directory
def _resolve_whistress_weights_dir() -> Path:
    if "WHISTRESS_WEIGHTS_DIR" in os.environ:
        p = Path(os.environ["WHISTRESS_WEIGHTS_DIR"])
        if (p / "classifier.pt").exists():
            return p
    local_p = VENDOR_DIR / "whistress_pkg" / "weights"
    if (local_p / "classifier.pt").exists():
        return local_p
    kaggle_p = Path("/kaggle/input/lexirep")
    if (kaggle_p / "classifier.pt").exists():
        return kaggle_p
    try:
        for p in Path("/kaggle/input").glob("**/classifier.pt"):
            return p.parent
    except Exception:
        pass
    return local_p

WHISTRESS_WEIGHTS_DIR = _resolve_whistress_weights_dir()

# Ensure runtime directories exist
AUDIO_UPLOADS_DIR.mkdir(exist_ok=True)
ANNOTATIONS_DIR.mkdir(exist_ok=True)

# ── Model Configuration ───────────────────────────────────────
import torch
_HAS_GPU = torch.cuda.is_available()

# Use base.en on CPU for 5x speedups, medium.en on CUDA GPU
ASR_MODEL_SIZE_PREVIEW = "medium.en" if _HAS_GPU else "base.en"
ASR_MODEL_SIZE_FINAL = os.getenv("ASR_MODEL_SIZE_FINAL", "medium.en" if _HAS_GPU else "base.en")

ASR_DEVICE = "cuda" if _HAS_GPU else "cpu"
ASR_COMPUTE_TYPE = "float16" if _HAS_GPU else "int8"
WHISTRESS_DEVICE = "cuda" if _HAS_GPU else "cpu"
WHISTRESS_WHISPER_BACKBONE = "openai/whisper-small.en"

# Silero VAD
VAD_THRESHOLD = 0.5         # Speech probability threshold
VAD_MIN_SPEECH_MS = 250     # Minimum speech duration (ms)
VAD_MIN_SILENCE_MS = 500    # Minimum silence between chunks (ms)
VAD_TARGET_CHUNK_SEC = 25.0 # Target ~25 seconds per chunk (gives Whisper full grammatical context)
VAD_MAX_CHUNK_SEC = 29.0    # Hard max just under Whisper's 30s attention limit

# ── Audio ──────────────────────────────────────────────────────
SAMPLE_RATE = 16000  # All audio normalized to 16kHz mono

# ── Server ─────────────────────────────────────────────────────
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8000"))
CORS_ORIGINS = ["*"]

# ── Upload Limits ──────────────────────────────────────────────
# Configurable via environment variables (ideal for production server tuning)
MAX_SINGLE_AUDIO_MB = int(os.environ.get("MAX_SINGLE_AUDIO_MB", "100"))
MAX_SINGLE_AUDIO_BYTES = MAX_SINGLE_AUDIO_MB * 1024 * 1024

MAX_ZIP_UPLOAD_MB = int(os.environ.get("MAX_ZIP_UPLOAD_MB", "250"))
MAX_ZIP_UPLOAD_BYTES = MAX_ZIP_UPLOAD_MB * 1024 * 1024

MAX_BATCH_FILE_COUNT = int(os.environ.get("MAX_BATCH_FILE_COUNT", "50"))

MAX_ZIP_UNCOMPRESSED_MB = int(os.environ.get("MAX_ZIP_UNCOMPRESSED_MB", "500"))
MAX_ZIP_UNCOMPRESSED_BYTES = MAX_ZIP_UNCOMPRESSED_MB * 1024 * 1024

MAX_DATASET_MB = int(os.environ.get("MAX_DATASET_MB", "500"))
MAX_DATASET_BYTES = MAX_DATASET_MB * 1024 * 1024

# ── Worker ─────────────────────────────────────────────────────
WORKER_POLL_INTERVAL_SEC = 0.2  # How often worker checks for new jobs

# ── LexiRep Syllable Stress ───────────────────────────────────
def _resolve_lexirep_checkpoint(key: str) -> Path:
    """Resolve checkpoint path for 'fused', 'ger', or 'ita' model across local and Kaggle."""
    # 1. Environment variable override
    env_var = f"LEXIREP_{key.upper()}_CHECKPOINT"
    if env_var in os.environ:
        p = Path(os.environ[env_var])
        if p.exists():
            return p

    # 2. Kaggle dataset with exact uploaded filename: final_lexirep_model_{key}.pt
    kaggle_p = Path(f"/kaggle/input/lexirep/final_lexirep_model_{key}.pt")
    if kaggle_p.exists():
        return kaggle_p

    # 3. Local workspace path: results_{key}/final_lexirep_model_{key}.pt or final_lexirep_model.pt
    isle_dir = BASE_DIR.parent / "ISLE 768"
    local_candidates = [
        isle_dir / f"results_{key}" / f"final_lexirep_model_{key}.pt",
        isle_dir / f"results_{key}" / "final_lexirep_model.pt",
        BASE_DIR / f"final_lexirep_model_{key}.pt",
        BASE_DIR / "final_lexirep_model.pt",
    ]
    for cand in local_candidates:
        if cand.exists():
            return cand

    # 4. Search recursively in /kaggle/input/
    try:
        for p in Path("/kaggle/input").glob(f"**/final_lexirep_model_{key}.pt"):
            return p
        for p in Path("/kaggle/input").glob(f"**/final_lexirep_model.pt"):
            return p
    except Exception:
        pass

    return local_candidates[0]

LEXIREP_CHECKPOINT_PATHS = {
    "fused": _resolve_lexirep_checkpoint("fused"),
    "ger": _resolve_lexirep_checkpoint("ger"),
    "ita": _resolve_lexirep_checkpoint("ita"),
}

LEXIREP_CHECKPOINT_PATH = LEXIREP_CHECKPOINT_PATHS["fused"]

