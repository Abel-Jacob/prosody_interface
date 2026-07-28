import numpy as np
from pipeline.prosody_base import ProsodyAnalyzer

class PauseAnalyzer(ProsodyAnalyzer):
    """
    Detects pauses between words using Whisper's highly accurate word-level timestamps.
    This runs at blazing speed with zero model overhead.
    """
    
    name = "pause"

    def setup(self, models: dict) -> None:
        # No extra models needed for timestamp-based gap calculation
        pass

    def analyze(self, audio_chunk: np.ndarray, words: list[dict]) -> dict:
        """
        Calculates the gap between the end of word[i] and the start of word[i+1].
        """
        pauses = []
        
        # We need at least 2 words to measure a gap
        if len(words) >= 2:
            for i in range(len(words) - 1):
                current_word = words[i]
                next_word = words[i+1]
                
                # Gap calculation
                gap = next_word["start"] - current_word["end"]
                
                # We can enforce a minimum threshold if we want, or just return everything
                # and let the frontend decide. Let's return any gap > 0 for accuracy.
                if gap > 0:
                    pauses.append({
                        "word_index": i,
                        "pause_length": round(gap, 3)
                    })
                    
        return {"word_pauses": pauses}
