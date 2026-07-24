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
DB_PATH = BASE_DIR / "jobs.db"
VENDOR_DIR = BASE_DIR / "vendor"
WHISTRESS_WEIGHTS_DIR = VENDOR_DIR / "whistress_pkg" / "weights"

# Ensure runtime directories exist
AUDIO_UPLOADS_DIR.mkdir(exist_ok=True)

# ── Model Configuration ───────────────────────────────────────
# faster-whisper: use tiny.en for live preview, base.en for final
ASR_MODEL_SIZE_PREVIEW = "tiny.en"
ASR_MODEL_SIZE_FINAL = os.getenv("ASR_MODEL_SIZE_FINAL", "base.en")
ASR_DEVICE = "cpu"
ASR_COMPUTE_TYPE = "int8"  # Best for CPU inference speed

# WhiStress
WHISTRESS_DEVICE = "cpu"
WHISTRESS_WHISPER_BACKBONE = "openai/whisper-small.en"

# Silero VAD
VAD_THRESHOLD = 0.5         # Speech probability threshold
VAD_MIN_SPEECH_MS = 250     # Minimum speech duration (ms)
VAD_MIN_SILENCE_MS = 500    # Minimum silence between chunks (ms)
VAD_TARGET_CHUNK_SEC = 7.0  # Target ~5-8 seconds per chunk
VAD_MAX_CHUNK_SEC = 15.0    # Hard max to bound memory/inference time

# ── Audio ──────────────────────────────────────────────────────
SAMPLE_RATE = 16000  # All audio normalized to 16kHz mono

# ── Server ─────────────────────────────────────────────────────
HOST = "0.0.0.0"
PORT = 8000
CORS_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]

# ── Worker ─────────────────────────────────────────────────────
WORKER_POLL_INTERVAL_SEC = 1.0  # How often worker checks for new jobs
