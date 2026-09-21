"""
Pause & Hesitation Analyzer

Analyzes a chunk of words to detect:
1. Silent gaps between words (pause duration)
2. Vocalized hesitations (e.g. um, uh, ah)
"""

import logging
import numpy as np

from pipeline.prosody_base import ProsodyAnalyzer

logger = logging.getLogger(__name__)

HESITATION_WORDS = {"um", "umm", "uh", "uhh", "ah", "ahh", "er", "erm"}

class PauseAnalyzer(ProsodyAnalyzer):
    """Timestamp-based pause and hesitation detection."""

    name = "pause"

    def __init__(self):
        self.client = None

    def setup(self, models: dict) -> None:
        """No model needed — pause detection is purely timestamp-based."""
        # Pause detection doesn't require any ML model.
        # It uses the word-level timestamps from faster-whisper.
        logger.info("PauseAnalyzer initialized (no model required)")

    def analyze(self, audio: np.ndarray, words: list[dict]) -> dict:
        """
        Calculates pauses between words and detects hesitations.

        Args:
            audio: Full chunk audio (not used for this analyzer, relies on timestamps)
            words: List of dicts with 'word', 'start', 'end'

        Returns:
            dict containing list of words with pause and hesitation data
        """
        results = []
        
        for i, word_data in enumerate(words):
            word_text = word_data["word"]
            clean_word = word_text.strip().lower().rstrip(".,?!:;\"'")
            
            is_hesitation = clean_word in HESITATION_WORDS
            
            # Special case for "a": Whisper sometimes transcribes prolonged "ahhh" as just "a".
            # The article "a" is spoken very quickly. If "a" lasts >= 0.35s, it is likely a hesitation.
            if not is_hesitation and clean_word == "a":
                word_duration = word_data["end"] - word_data["start"]
                if word_duration >= 0.35:
                    is_hesitation = True
            
            # Calculate pause after this word
            pause_after = 0.0
            if i < len(words) - 1:
                next_word = words[i + 1]
                # Whisper timestamps can sometimes slightly overlap or be negative gap
                gap = next_word["start"] - word_data["end"]
                if gap > 0:
                    pause_after = round(gap, 3)
            elif len(words) > 0 and len(audio) > 0:
                # Handle the final word of the audio clip using the total audio duration
                audio_duration = len(audio) / 16000.0  # 16kHz sample rate
                gap = audio_duration - word_data["end"]
                if gap > 0:
                    pause_after = round(gap, 3)
            
            results.append({
                "word": word_text,
                "pause_after": pause_after,
                "is_hesitation": is_hesitation
            })
            
        return {"word_pauses": results}
