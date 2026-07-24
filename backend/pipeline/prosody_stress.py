"""
Prosody Stress Module — WhiStress Wrapper

Wraps the vendored WhiStress inference client to implement the
ProsodyAnalyzer interface. Runs per-chunk, not on the full buffer.

WhiStress uses the whisper-small.en backbone with an additional decoder
block and classifier to predict word-level stress/emphasis.
"""

import logging
import numpy as np
import torch
from typing import Optional

from pipeline.prosody_base import ProsodyAnalyzer

logger = logging.getLogger(__name__)


class StressAnalyzer(ProsodyAnalyzer):
    """WhiStress-based word stress detection."""

    name = "stress"

    def __init__(self):
        self.client = None

    def setup(self, models: dict) -> None:
        """Store reference to pre-loaded WhiStress model."""
        self.client = models.get("whistress")
        if self.client is None:
            logger.warning("WhiStress model not found in models dict — stress analysis disabled")

    def analyze(self, audio_chunk: np.ndarray, words: list[dict]) -> dict:
        """
        Run WhiStress stress detection on a chunk.

        Args:
            audio_chunk: float32 numpy array, 16kHz mono
            words: ASR word dicts with {word, start, end, confidence}

        Returns:
            {
                "word_stress": [
                    {"word": "hello", "stressed": False, "stress_score": 0.1},
                    {"word": "WORLD", "stressed": True, "stress_score": 0.9},
                ]
            }
        """
        if self.client is None:
            return {"word_stress": [], "error": "WhiStress model not loaded"}

        if not words:
            logger.debug("StressAnalyzer: no words to analyze")
            return {"word_stress": []}

        try:
            # WhiStress expects audio as a dict with 'array' and 'sampling_rate'
            audio_dict = {
                "array": audio_chunk,
                "sampling_rate": 16000,
            }

            # Run WhiStress inference — returns list of (word, stress_label) tuples
            # The predict method handles audio prep, inference, and token merging
            word_emphasis_pairs = self.client.predict(
                audio=audio_dict,
                transcription=None,  # Let WhiStress use its own transcription
                return_pairs=True,
            )

            # Convert to our standard format
            stress_results = []
            for word_text, stress_label in word_emphasis_pairs:
                stress_results.append({
                    "word": word_text.strip(),
                    "stressed": bool(stress_label == 1),
                    "stress_score": 1.0 if stress_label == 1 else 0.0,
                })

            logger.debug(
                f"StressAnalyzer: {len(stress_results)} words, "
                f"{sum(1 for s in stress_results if s['stressed'])} stressed"
            )

            return {"word_stress": stress_results}

        except Exception as e:
            logger.error(f"StressAnalyzer error: {e}", exc_info=True)
            return {"word_stress": [], "error": str(e)}
