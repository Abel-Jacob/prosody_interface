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
    def __init__(self, name: str = "pause"):
        super().__init__(name)

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
            
            # Calculate pause after this word
            pause_after = 0.0
            if i < len(words) - 1:
                next_word = words[i + 1]
                # Whisper timestamps can sometimes slightly overlap or be negative gap
                gap = next_word["start"] - word_data["end"]
                if gap > 0:
                    pause_after = round(gap, 3)
            
            results.append({
                "word": word_text,
                "pause_after": pause_after,
                "is_hesitation": is_hesitation
            })
            
        return {"word_pauses": results}
