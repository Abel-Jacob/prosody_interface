"""
Merge Module — Combine chunk results with time offset logic.

After ASR + prosody analysis on each chunk, this module merges the
results into a PhraseResult with correctly computed time offsets
based on the chunk's actual position in the full audio.
"""

import logging
from typing import Optional

from schemas import PhraseResult, WordResult

logger = logging.getLogger(__name__)


def merge_chunk_results(
    chunk_index: int,
    asr_result: dict,
    prosody_results: dict,
    time_offset: float,
) -> PhraseResult:
    """
    Merge ASR and prosody results for a single chunk into a PhraseResult.

    Args:
        chunk_index: Index of this chunk in the full sequence.
        asr_result: Dict from asr.transcribe_chunk() with 'text' and 'words'.
        prosody_results: Dict from all prosody analyzers, keyed by analyzer name.
        time_offset: Start time of this chunk in the full audio (seconds).
                     Used to compute absolute timestamps.

    Returns:
        PhraseResult with words containing merged ASR + prosody data
        and absolute timestamps.
    """
    asr_words = asr_result.get("words", [])
    asr_text = asr_result.get("text", "")

    # Get stress results if available
    stress_data = prosody_results.get("stress", {})
    stress_words = stress_data.get("word_stress", [])

    # Build merged word list with absolute timestamps
    merged_words = []
    for i, asr_word in enumerate(asr_words):
        word = WordResult(
            word=asr_word["word"],
            start=round(asr_word["start"] + time_offset, 3),
            end=round(asr_word["end"] + time_offset, 3),
            confidence=asr_word.get("confidence", 1.0),
            stressed=False,
            stress_score=0.0,
        )

        # Try to match stress data by index or fuzzy word match
        stress_match = _find_stress_match(asr_word["word"], i, stress_words)
        if stress_match:
            word.stressed = stress_match["stressed"]
            word.stress_score = stress_match.get("stress_score", 1.0 if stress_match["stressed"] else 0.0)

        merged_words.append(word)

    # Compute phrase timing
    phrase_start = merged_words[0].start if merged_words else time_offset
    phrase_end = merged_words[-1].end if merged_words else time_offset

    return PhraseResult(
        phrase_index=chunk_index,
        text=asr_text,
        words=merged_words,
        start_time=phrase_start,
        end_time=phrase_end,
        chunk_index=chunk_index,
    )


def _find_stress_match(
    asr_word: str,
    index: int,
    stress_words: list[dict],
) -> Optional[dict]:
    """
    Find the matching stress result for an ASR word.
    
    First tries exact index match, then falls back to fuzzy word match.
    WhiStress may produce slightly different tokenization than faster-whisper,
    so fuzzy matching is needed.
    """
    if not stress_words:
        return None

    asr_clean = asr_word.strip().lower()

    # Try index match first
    if index < len(stress_words):
        stress_entry = stress_words[index]
        stress_clean = stress_entry.get("word", "").strip().lower()
        # Accept if words match or are close enough
        if stress_clean == asr_clean or asr_clean.startswith(stress_clean) or stress_clean.startswith(asr_clean):
            return stress_entry

    # Fallback: scan all stress words for a match
    for entry in stress_words:
        stress_clean = entry.get("word", "").strip().lower()
        if stress_clean == asr_clean:
            return entry

    return None
