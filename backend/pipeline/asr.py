"""
ASR Module — faster-whisper Wrapper

Single canonical location for all ASR (Automatic Speech Recognition)
operations. Uses faster-whisper (CTranslate2 backend) for significantly
faster CPU inference vs openai-whisper, with the same model weights.

Provides word-level timestamps and confidence scores.
"""

import logging
import numpy as np
import re
import difflib
from typing import Optional
from pathlib import Path

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
        cpu_threads=4,
        num_workers=1,
    )
    logger.info(f"faster-whisper model '{model_size}' loaded successfully")
    return model


def restore_punctuation_and_quotes(segment_text: str, segment_words: list[dict]) -> list[dict]:
    """
    Aligns segment_words with segment_text to restore quotation marks and punctuation
    that faster-whisper's word-level timestamps might have stripped or misplaced.
    Normalizes quote and punctuation order (e.g. "anarchy," -> "anarchy",) to ensure
    trailing punctuation is at the very end of the string for downstream checks.
    """
    if not segment_words:
        return []
    tokens = segment_text.split()
    if not tokens:
        return segment_words

    def clean(s):
        return re.sub(r"[^a-zA-Z0-9']", '', s).lower()

    token_cleans = [clean(t) for t in tokens]
    word_cleans = [clean(w['word']) for w in segment_words]

    matcher = difflib.SequenceMatcher(None, token_cleans, word_cleans)
    word_to_token = {}
    for block in matcher.get_matching_blocks():
        token_start, word_start, size = block
        for offset in range(size):
            word_to_token[word_start + offset] = token_start + offset

    for i, w in enumerate(segment_words):
        if i in word_to_token:
            token = tokens[word_to_token[i]]
            if clean(w['word']) == clean(token):
                normalized = token
                for quote in ['"', "'"]:
                    for punct in ['.', ',', '?', '!', ';', ':']:
                        if normalized.endswith(punct + quote):
                            normalized = normalized[:-2] + quote + punct
                w['word'] = normalized
    return segment_words


def transcribe_chunk(
    audio: np.ndarray,
    model,
    language: str = "en",
    initial_prompt: Optional[str] = None,
    is_live: bool = False,
) -> dict:
    """
    Transcribe a single audio chunk using faster-whisper.

    Args:
        audio: Audio chunk as float32 numpy array, 16kHz mono.
        model: Pre-loaded WhisperModel from load_asr_model().
        language: Language code.
        initial_prompt: Optional text from previous chunk to maintain context and punctuation.
        is_live: If True, uses ultra-fast greedy decoding to maintain real-time speed.

    Returns:
        dict with:
        - 'text': Full transcription text
        - 'words': List of word dicts with {word, start, end, confidence}
    """
    # If audio is passed as a file path (string or Path), load it into numpy array first
    if isinstance(audio, (str, Path)):
        import librosa
        audio, _ = librosa.load(str(audio), sr=SAMPLE_RATE, mono=True)

    # Normalize audio volume if too quiet (helps Whisper recognize low-volume speech)
    max_val = np.max(np.abs(audio))
    if max_val > 1e-4 and max_val < 0.5:
        audio = audio * (0.85 / max_val)

    # Base parameters for high accuracy
    kwargs = {
        "language": language,
        "word_timestamps": True,
        "beam_size": 5,
        "best_of": 3,
        "vad_filter": True,
        "vad_parameters": dict(min_silence_duration_ms=200),
        "condition_on_previous_text": True if (initial_prompt and initial_prompt.strip()) else False,
        "repetition_penalty": 1.05,
        "compression_ratio_threshold": 2.4,
        "log_prob_threshold": -1.0,
        "no_repeat_ngram_size": 0,
        "temperature": [0.0, 0.2],
    }

    if is_live:
        # Ultra-fast settings for real-time preview to prevent pipeline blockage
        kwargs["beam_size"] = 1
        kwargs["best_of"] = 1
        kwargs["temperature"] = [0.0]
        # Never condition on previous text for sliding windows, it causes infinite hallucination loops!
        kwargs["condition_on_previous_text"] = False
        
    elif initial_prompt and initial_prompt.strip():
        kwargs["initial_prompt"] = initial_prompt.strip()

    segments, info = model.transcribe(
        audio,
        **kwargs,
    )

    words = []
    text_parts = []

    for segment in segments:
        if segment.no_speech_prob > 0.85:
            logger.debug(f"ASR: Dropped segment due to high no_speech_prob ({segment.no_speech_prob:.2f})")
            continue
            
        text_parts.append(segment.text.strip())
        segment_words_dicts = []
        if segment.words:
            for w in segment.words:
                segment_words_dicts.append({
                    "word": w.word.strip(),
                    "start": round(w.start, 3),
                    "end": round(w.end, 3),
                    "confidence": round(w.probability, 3),
                })
        restored_words = restore_punctuation_and_quotes(segment.text, segment_words_dicts)
        words.extend(restored_words)

    full_text = " ".join(text_parts)

    logger.debug(f"ASR: '{full_text[:80]}...' ({len(words)} words)")

    return {
        "text": full_text,
        "words": words,
    }
