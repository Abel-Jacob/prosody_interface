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


NON_SENTENCE_ENDERS = {
    "the", "a", "an", "of", "in", "to", "for", "with", "on", "at", "from", "by", "about", 
    "as", "into", "like", "through", "after", "over", "between", "out", "against", "during", 
    "without", "before", "under", "around", "among", "and", "but", "or", "nor", "so", "yet", 
    "because", "although", "while", "if", "when", "where", "why", "how", "that", "which", 
    "who", "whom", "whose", "what", "this", "these", "those", "is", "are", "was", "were", 
    "be", "been", "being", "have", "has", "had", "do", "does", "did", "can", "could", "shall", 
    "should", "will", "would", "may", "might", "must", "am", "i", "we", "you", "he", "she", 
    "it", "they", "my", "your", "his", "her", "its", "our", "their", "than", "then", "very", 
    "much", "more", "most", "such", "only", "just", "also", "mr", "mrs", "ms", "dr", "prof", 
    "st", "vs", "e.g", "i.e", "etc"
}

COMMON_LOWERCASEABLE_WORDS = {
    "the", "a", "an", "this", "that", "these", "those", "we", "you", "he", "she", "it", 
    "they", "our", "your", "his", "her", "its", "their", "is", "are", "was", "were", "be", 
    "been", "have", "has", "had", "can", "could", "will", "would", "shall", "should", "may", 
    "might", "must", "do", "does", "did", "not", "and", "but", "or", "so", "if", "when", 
    "where", "why", "how", "what", "which", "who", "there", "here", "then", "now", "just", 
    "only", "also", "very", "much", "more", "most", "some", "any", "all", "each", "every", 
    "both", "either", "neither", "other", "another", "such", "same", "than", "too", "as", 
    "about", "above", "after", "again", "against", "am", "an", "any", "aren't", "at", 
    "because", "before", "being", "below", "between", "by", "can't", "cannot", "couldn't", 
    "didn't", "doesn't", "doing", "don't", "down", "during", "few", "from", "further", 
    "hadn't", "hasn't", "haven't", "having", "he'd", "he'll", "he's", "here's", "hers", 
    "herself", "him", "himself", "how's", "i'd", "i'll", "i'm", "i've", "in", "into", 
    "isn't", "it's", "itself", "let's", "me", "mustn't", "my", "myself", "no", "nor", 
    "of", "off", "on", "once", "or", "ought", "ours", "ourselves", "out", "over", "own", 
    "she'd", "she'll", "she's", "shouldn't", "some", "that's", "theirs", "them", 
    "themselves", "there's", "they'd", "they'll", "they're", "they've", "through", "to", 
    "under", "until", "up", "wasn't", "we'd", "we'll", "we're", "we've", "weren't", 
    "what's", "when's", "where's", "while", "who's", "whom", "why's", "with", "won't", 
    "wouldn't", "you'd", "you'll", "you're", "you've", "yours", "yourself", "yourselves", 
    "make", "made", "work", "works", "worked", "say", "said", "saying", "see", "saw", "seen", 
    "go", "going", "went", "come", "came", "coming", "take", "took", "taken", "get", "got", 
    "gotten", "know", "knew", "known", "think", "thought", "look", "looked", "looking", 
    "want", "wanted", "use", "used", "using", "find", "found", "give", "gave", "given", 
    "tell", "told", "ask", "asked", "seem", "seemed", "feel", "felt", "try", "tried", 
    "leave", "left", "call", "called", "good", "new", "first", "last", "long", "great", 
    "little", "old", "right", "big", "high", "different", "small", "large", "next", 
    "early", "young", "important", "public", "bad", "able", "system", "time", "year", 
    "people", "way", "day", "man", "thing", "woman", "life", "child", "world", "school", 
    "state", "family", "student", "group", "country", "problem", "hand", "part", "place", 
    "case", "week", "company", "program", "question", "government", "number", "night", 
    "point", "home", "water", "room", "mother", "area", "money", "story", "fact", 
    "month", "lot", "study", "book", "eye", "job", "word", "business", "issue", "side", 
    "kind", "head", "house", "service", "friend", "father", "power", "hour", "game", 
    "line", "end", "member", "law", "car", "city", "community", "name", "president", 
    "team", "minute", "idea", "kid", "body", "information", "back", "parent", "face", 
    "others", "level", "office", "door", "health", "person", "art", "war", "history", 
    "party", "result", "change", "morning", "reason", "research", "girl", "guy", "moment", 
    "air", "teacher", "force", "education"
}


def reconstruct_grammatical_phrases(phrases: list[PhraseResult]) -> list[PhraseResult]:
    """
    Reconstruct accurate grammatical sentences from accumulated chunk/slice phrases.
    
    Fixes Whisper's tendency to attach false sentence-ending periods at acoustic chunk
    boundaries and capitalize mid-sentence continuations. Groups words by true
    grammatical sentence boundaries (punct or major pauses) instead of VAD slices.
    """
    if not phrases:
        return []

    # 1. Gather all words chronologically
    all_words: list[WordResult] = []
    for p in phrases:
        all_words.extend(p.words)

    if not all_words:
        return phrases

    # 2. Cleanup false periods and false capitalizations at chunk transitions
    for i in range(len(all_words) - 1):
        w_curr = all_words[i]
        w_next = all_words[i + 1]

        clean_curr = w_curr.word.strip().lower().rstrip(".,?!:;\"'")
        gap = w_next.start - w_curr.end

        # Check if w_curr has trailing sentence punctuation
        has_period = w_curr.word.endswith(".") or w_curr.word.endswith("?") or w_curr.word.endswith("!")

        if has_period:
            is_false_period = False

            # Rule A: If next word starts with lowercase, current period is definitely hallucinated
            if w_next.word and w_next.word[0].islower():
                is_false_period = True
            # Rule B: If current word is grammatically incapable of ending a sentence
            elif clean_curr in NON_SENTENCE_ENDERS:
                is_false_period = True
            # Rule C: If the acoustic gap is small (< 0.8s) and next word is a common lowercaseable word
            elif gap < 0.8 and w_next.word.strip().lower().rstrip(".,?!:;\"'") in COMMON_LOWERCASEABLE_WORDS:
                is_false_period = True

            if is_false_period:
                # Strip trailing period/question/exclamation
                w_curr.word = w_curr.word.rstrip(".?!")
                # Lowercase next word if it's not "I" and is a common word
                next_clean = w_next.word.strip().lower().rstrip(".,?!:;\"'")
                if w_next.word and w_next.word[0].isupper() and w_next.word != "I" and not w_next.word.startswith("I'") and next_clean in COMMON_LOWERCASEABLE_WORDS:
                    w_next.word = w_next.word[0].lower() + w_next.word[1:]

    # 3. Group words into grammatical sentences
    reconstructed_phrases: list[PhraseResult] = []
    current_sentence_words: list[WordResult] = []

    for i, w in enumerate(all_words):
        if not current_sentence_words:
            # Ensure first word of sentence is capitalized (if alphabetic)
            if w.word and w.word[0].islower():
                w.word = w.word[0].upper() + w.word[1:]

        current_sentence_words.append(w)

        is_last_word = (i == len(all_words) - 1)
        has_sent_end = w.word.endswith(".") or w.word.endswith("?") or w.word.endswith("!")

        # Check if there's a major pause after this word
        major_pause = False
        if not is_last_word:
            gap = all_words[i + 1].start - w.end
            if gap >= 1.0:
                major_pause = True

        # Check if sentence is very long and has a natural clause break
        clause_break = False
        if len(current_sentence_words) >= 30 and not is_last_word:
            if w.word.endswith(",") or w.word.endswith(";") or (all_words[i + 1].start - w.end >= 0.4):
                clause_break = True

        # End sentence if: true punctuation, major pause, long clause break, or very last word
        if has_sent_end or major_pause or clause_break or is_last_word:
            # If ending due to major pause/clause break/last word and missing punctuation, add period
            if not has_sent_end and w.word and not w.word.endswith((".", "?", "!", ",", ";", ":")):
                w.word = w.word + "."
            elif not has_sent_end and w.word and w.word.endswith((",", ";", ":")):
                w.word = w.word.rstrip(",;:") + "."

            # Build PhraseResult
            phrase_idx = len(reconstructed_phrases)
            start_t = current_sentence_words[0].start
            end_t = current_sentence_words[-1].end
            text_str = " ".join([cw.word for cw in current_sentence_words])

            reconstructed_phrases.append(
                PhraseResult(
                    phrase_index=phrase_idx,
                    text=text_str,
                    words=current_sentence_words,
                    start_time=start_t,
                    end_time=end_t,
                    chunk_index=phrase_idx,
                )
            )
            current_sentence_words = []

    return reconstructed_phrases
