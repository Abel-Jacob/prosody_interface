"""
ASR Module — faster-whisper Wrapper

Single canonical location for all ASR (Automatic Speech Recognition)
operations. Uses faster-whisper (CTranslate2 backend) for significantly
faster CPU inference vs openai-whisper, with the same model weights.

Provides word-level timestamps and confidence scores.
"""

import logging
import numpy as np
from typing import Optional

from config import ASR_MODEL_SIZE_FINAL, ASR_DEVICE, ASR_COMPUTE_TYPE, SAMPLE_RATE

logger = logging.getLogger(__name__)


def load_asr_model(model_size: str = ASR_MODEL_SIZE_FINAL):
    """
    Load the faster-whisper model. Called once at startup.

    Args:
        model_size: One of 'tiny.en', 'base.en', 'small.en', etc.
    
    Returns:
        The loaded WhisperModel instance (reused for all subsequent calls).
    """
    from faster_whisper import WhisperModel

    logger.info(f"Loading faster-whisper model: {model_size} (device={ASR_DEVICE}, compute={ASR_COMPUTE_TYPE})")
    model = WhisperModel(
        model_size,
        device=ASR_DEVICE,
        compute_type=ASR_COMPUTE_TYPE,
    )
    logger.info(f"faster-whisper model '{model_size}' loaded successfully")
    return model


def transcribe_chunk(
    audio: np.ndarray,
    model,
    language: str = "en",
) -> dict:
    """
    Transcribe a single audio chunk using faster-whisper.

    Args:
        audio: Audio chunk as float32 numpy array, 16kHz mono.
        model: Pre-loaded WhisperModel from load_asr_model().
        language: Language code.

    Returns:
        dict with:
        - 'text': Full transcription text
        - 'words': List of word dicts with {word, start, end, confidence}
    """
    segments, info = model.transcribe(
        audio,
        language=language,
        word_timestamps=True,
        beam_size=3,          # Reduced from default 5 for CPU speed
        best_of=1,            # No sampling variants on CPU
        vad_filter=False,     # We already did VAD chunking, don't double-filter
    )

    words = []
    text_parts = []

    for segment in segments:
        text_parts.append(segment.text.strip())
        if segment.words:
            for w in segment.words:
                words.append({
                    "word": w.word.strip(),
                    "start": round(w.start, 3),
                    "end": round(w.end, 3),
                    "confidence": round(w.probability, 3),
                })

    full_text = " ".join(text_parts)

    logger.debug(f"ASR: '{full_text[:80]}...' ({len(words)} words)")

    return {
        "text": full_text,
        "words": words,
    }
