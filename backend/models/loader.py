"""
Model Loader — Single source of truth for all model loading.

Every model is loaded ONCE at startup and reused for all subsequent work.
Never reload per request. This module is called by main.py at app startup.

Models loaded:
- faster-whisper (base.en): ASR for final transcription
- WhiStress (small): Stress detection
- Silero VAD: Silence boundary detection for chunking
"""

import sys
import logging
from pathlib import Path

from config import VENDOR_DIR, WHISTRESS_DEVICE, ASR_DEVICE

logger = logging.getLogger(__name__)


def load_all_models() -> dict:
    """
    Load all ML models. Called once at app startup.

    Returns:
        Dict with keys: 'asr', 'whistress', 'vad'
        Each value is the loaded model object, ready for inference.
    """
    import torch
    # Lock PyTorch CPU threads to physical cores (4) to prevent OS thread thrashing
    try:
        torch.set_num_threads(4)
        torch.set_num_interop_threads(1)
        logger.info("Optimized PyTorch CPU threads (threads=4, interop=1)")
    except Exception as e:
        logger.debug(f"Could not set PyTorch threads: {e}")

    models = {}

    # 1. Load faster-whisper ASR models
    logger.info("=" * 50)
    has_cuda = torch.cuda.is_available()
    gpu_name = torch.cuda.get_device_name(0) if has_cuda else "None"
    logger.info(f"System Check | CUDA Available: {has_cuda} | GPU Name: {gpu_name}")
    logger.info(f"ASR Device: {ASR_DEVICE} | WhiStress Device: {WHISTRESS_DEVICE}")
    logger.info("Loading ASR models (faster-whisper)...")
    try:
        from pipeline.asr import load_asr_model
        from config import ASR_MODEL_SIZE_PREVIEW, ASR_MODEL_SIZE_FINAL
        models["asr_preview"] = load_asr_model(ASR_MODEL_SIZE_PREVIEW)
        models["asr_final"] = load_asr_model(ASR_MODEL_SIZE_FINAL)
    except Exception as e:
        logger.error(f"Failed to load ASR models: {e}", exc_info=True)
        models["asr_preview"] = None
        models["asr_final"] = None

    # 2. Load Silero VAD model
    logger.info("=" * 50)
    logger.info("Loading Silero VAD model...")
    try:
        from pipeline.vad_chunking import load_silero_vad
        models["vad"] = load_silero_vad()
    except Exception as e:
        logger.error(f"Failed to load VAD model: {e}", exc_info=True)
        models["vad"] = None

    # 3. Load WhiStress model
    logger.info("=" * 50)
    logger.info("Loading WhiStress model...")
    try:
        # Add vendor directory to sys.path so whistress_pkg can be imported
        vendor_path = str(VENDOR_DIR)
        if vendor_path not in sys.path:
            sys.path.insert(0, vendor_path)

        from whistress_pkg import WhiStressInferenceClient
        client = WhiStressInferenceClient(device=WHISTRESS_DEVICE)
        models["whistress"] = client
        logger.info("WhiStress model loaded successfully")
    except Exception as e:
        logger.error(f"Failed to load WhiStress model: {e}", exc_info=True)
        models["whistress"] = None

    logger.info("=" * 50)
    loaded = [k for k, v in models.items() if v is not None]
    failed = [k for k, v in models.items() if v is None]
    logger.info(f"Model loading complete. Loaded: {loaded}. Failed: {failed}")

    return models

def warmup_models(models: dict):
    """Run a dummy forward pass to force CUDA memory allocation and cuDNN benchmarking."""
    import numpy as np
    import time
    logger.info("=" * 50)
    logger.info("Warming up models to prevent first-request latency spike...")
    
    dummy_audio = np.zeros(16000 * 2, dtype=np.float32)
    start = time.time()
    
    if models.get("asr_preview"):
        try:
            list(models["asr_preview"].transcribe(dummy_audio, language="en"))
        except: pass
    
    if models.get("whistress"):
        try:
            audio_dict = {"array": dummy_audio, "sampling_rate": 16000}
            models["whistress"].predict(audio_dict, transcription="hello world", return_pairs=True)
            # Run twice to ensure full CUDA initialization
            models["whistress"].predict(audio_dict, transcription="hello world", return_pairs=True)
        except Exception as e:
            logger.error(f"WhiStress warmup failed: {e}")
            
    logger.info(f"Warmup complete in {time.time() - start:.2f}s")

