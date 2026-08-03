"""
Intonation Analyzer — F0 Pitch Extraction

Extracts fundamental frequency (F0) contour from audio using librosa.pyin
and maps pitch statistics onto individual words. Pure DSP — no ML model needed.

Returns per-word pitch data:
  - pitch_mean:  Average F0 (Hz) over the word's time span
  - pitch_start: F0 at word onset
  - pitch_end:   F0 at word offset
  - pitch_direction: "rising" | "falling" | "flat" | "unvoiced"
  - pitch_range: max(F0) - min(F0) across the word

Also returns a sentence-level intonation_pattern:
  - "rising"    — final word(s) pitch rises (question-like)
  - "falling"   — final word(s) pitch falls (statement)
  - "flat"      — negligible change (monotone)
  - "rise-fall" — penultimate rises, final falls (emphasis)
"""

import logging
import numpy as np

from pipeline.prosody_base import ProsodyAnalyzer

logger = logging.getLogger(__name__)

# Minimum pitch change (Hz) to classify as rising/falling
_DIRECTION_THRESHOLD_HZ = 15.0


class IntonationAnalyzer(ProsodyAnalyzer):
    """Librosa pyin-based F0 pitch extraction per word."""

    name = "intonation"

    def __init__(self):
        pass

    def setup(self, models: dict) -> None:
        """No model needed — intonation uses librosa.pyin (pure DSP)."""
        logger.info("IntonationAnalyzer initialized (no model required)")

    def analyze(self, audio_chunk: np.ndarray, words: list[dict]) -> dict:
        """
        Extract F0 contour and compute per-word pitch statistics.

        Args:
            audio_chunk: float32 numpy array, 16kHz mono.
                         Timestamps in ``words`` are *relative to this chunk*.
            words: ASR word dicts with {word, start, end, confidence}.

        Returns:
            {
                "word_intonation": [
                    {"word": "hello", "pitch_mean": 180.2, ...},
                    ...
                ],
                "intonation_pattern": "falling"
            }
        """
        if not words or len(audio_chunk) == 0:
            return {"word_intonation": [], "intonation_pattern": "flat"}

        sr = 16000

        try:
            import librosa

            # --- Extract F0 contour for the entire chunk at once -----------
            f0, voiced_flag, voiced_prob = librosa.pyin(
                audio_chunk,
                fmin=50,
                fmax=500,
                sr=sr,
            )
            # f0 is a numpy array with NaN for unvoiced frames
            frame_times = librosa.frames_to_time(
                np.arange(len(f0)), sr=sr
            )

            # Compute the chunk's time offset (the earliest word start)
            chunk_offset = words[0]["start"] if words else 0.0

            # --- Per-word pitch stats ----------------------------------
            results = []
            for w in words:
                w_start = w["start"] - chunk_offset
                w_end = w["end"] - chunk_offset

                # Select F0 frames within this word's time span
                mask = (frame_times >= w_start) & (frame_times <= w_end)
                word_f0 = f0[mask]

                # Drop NaN (unvoiced frames)
                voiced_f0 = word_f0[~np.isnan(word_f0)] if len(word_f0) > 0 else np.array([])

                if len(voiced_f0) < 2:
                    # Not enough voiced frames to compute anything meaningful
                    results.append({
                        "word": w["word"],
                        "pitch_mean": None,
                        "pitch_start": None,
                        "pitch_end": None,
                        "pitch_direction": "unvoiced",
                        "pitch_range": 0.0,
                    })
                    continue

                pitch_mean = float(np.nanmean(voiced_f0))
                pitch_start = float(voiced_f0[0])
                pitch_end = float(voiced_f0[-1])
                pitch_range = float(np.max(voiced_f0) - np.min(voiced_f0))

                delta = pitch_end - pitch_start
                if delta > _DIRECTION_THRESHOLD_HZ:
                    direction = "rising"
                elif delta < -_DIRECTION_THRESHOLD_HZ:
                    direction = "falling"
                else:
                    direction = "flat"

                results.append({
                    "word": w["word"],
                    "pitch_mean": round(pitch_mean, 1),
                    "pitch_start": round(pitch_start, 1),
                    "pitch_end": round(pitch_end, 1),
                    "pitch_direction": direction,
                    "pitch_range": round(pitch_range, 1),
                })

            # --- Sentence-level intonation pattern ---------------------
            intonation_pattern = self._classify_sentence(results)

            logger.debug(
                f"IntonationAnalyzer: {len(results)} words, "
                f"pattern={intonation_pattern}"
            )

            return {
                "word_intonation": results,
                "intonation_pattern": intonation_pattern,
            }

        except Exception as e:
            logger.error(f"IntonationAnalyzer error: {e}", exc_info=True)
            return {
                "word_intonation": [],
                "intonation_pattern": "flat",
                "error": str(e),
            }

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _classify_sentence(word_results: list[dict]) -> str:
        """
        Derive a sentence-level intonation label from the last voiced words.

        Looks at the final 2–3 voiced words to determine:
          - "rising"    — final word rises
          - "falling"   — final word falls
          - "rise-fall" — penultimate rises, final falls
          - "flat"      — no significant change
        """
        # Collect voiced words from the end
        voiced = [r for r in word_results if r["pitch_direction"] != "unvoiced"]
        if len(voiced) == 0:
            return "flat"

        final = voiced[-1]

        if len(voiced) >= 2:
            penult = voiced[-2]
            if penult["pitch_direction"] == "rising" and final["pitch_direction"] == "falling":
                return "rise-fall"

        return final["pitch_direction"]  # "rising", "falling", or "flat"
