"""
Annotation Pipeline — Canonical Annotation Document Generator

Transforms a completed job's stored JobResult into a single, time-ordered
annotation document containing all prosody features. This is a pure
function with no side effects — it reads the already-stored result JSON
and reshapes it into the annotation schema.

The annotation is a DERIVED EXPORT. The jobs table's `result` column
remains the source of truth. This module never modifies the database.
"""

import json
import logging
from datetime import datetime, timezone
from typing import Optional

from config import (
    ASR_MODEL_SIZE_FINAL,
    ASR_MODEL_SIZE_PREVIEW,
    ASR_DEVICE,
    ASR_COMPUTE_TYPE,
    VAD_THRESHOLD,
    WHISTRESS_WHISPER_BACKBONE,
    WHISTRESS_DEVICE,
    SAMPLE_RATE,
)

logger = logging.getLogger(__name__)

# Annotation schema version — bump when the schema changes
ANNOTATION_VERSION = "1.0"


def build_annotation(job: dict) -> dict:
    """
    Build a canonical annotation document from a completed job.

    Args:
        job: A job dict from the database (as returned by get_job()),
             must have status="complete" and a parsed `result` dict.

    Returns:
        The annotation document as a plain dict, ready for JSON serialization.

    Raises:
        ValueError: If the job is not in "complete" status.
    """
    if job.get("status") != "complete":
        raise ValueError(
            f"Cannot build annotation for job in status '{job.get('status')}'. "
            f"Job must be complete."
        )

    result = job.get("result", {})
    if isinstance(result, str):
        result = json.loads(result)

    phrases_raw = result.get("phrases", [])
    errors = []

    # ── Recording metadata ─────────────────────────────────────────
    recording = {
        "job_id": job["job_id"],
        "audio_duration_sec": result.get("total_duration", 0.0),
        "sample_rate": SAMPLE_RATE,
        "created_at": job.get("created_at"),
        "completed_at": job.get("completed_at"),
    }

    # ── Model provenance (pulled from config, never hardcoded) ─────
    models = {
        "asr_final": ASR_MODEL_SIZE_FINAL,
        "asr_preview": ASR_MODEL_SIZE_PREVIEW,
        "asr_device": ASR_DEVICE,
        "asr_compute_type": ASR_COMPUTE_TYPE,
        "vad_model": "silero_vad",
        "vad_threshold": VAD_THRESHOLD,
        "stress_model": "whistress",
        "stress_backbone": WHISTRESS_WHISPER_BACKBONE,
        "stress_device": WHISTRESS_DEVICE,
        "pitch_method": "swipe",
        "pitch_polynomial_order": 1,
    }

    # ── Build phrase entries ───────────────────────────────────────
    annotation_phrases = []
    all_words = []

    for phrase in phrases_raw:
        phrase_idx = phrase.get("phrase_index", phrase.get("chunk_index", 0))
        phrase_words = phrase.get("words", [])

        # Determine phrase status
        phrase_status = "ok"
        if not phrase_words:
            phrase_status = "empty"

        annotation_phrases.append({
            "phrase_index": phrase_idx,
            "text": phrase.get("text", ""),
            "start_time": phrase.get("start_time", 0.0),
            "end_time": phrase.get("end_time", 0.0),
            "intonation_pattern": phrase.get("intonation_pattern"),
            "intonation": phrase.get("intonation"),
            "status": phrase_status,
        })

        # ── Build word entries from this phrase ────────────────────
        for word_data in phrase_words:
            word_entry = _build_word_entry(word_data, phrase_idx)
            all_words.append(word_entry)

    # ── Sort words by absolute start_time (safety net) ─────────────
    all_words.sort(key=lambda w: (w["start_time"], w["end_time"]))

    # Assign sequential word_index after sorting
    for i, w in enumerate(all_words):
        w["word_index"] = i

    # ── Handle zero-word case ──────────────────────────────────────
    if not all_words:
        errors.append({"message": "No speech detected in recording"})

    # ── Summary statistics ─────────────────────────────────────────
    summary = {
        "word_count": result.get("word_count", len(all_words)),
        "wpm": result.get("wpm", 0.0),
        "stress_ratio": result.get("stress_ratio", 0.0),
        "pitch_variation_hz": result.get("pitch_variation", 0.0),
        "phrase_count": len(annotation_phrases),
    }

    # ── Assemble the final document ────────────────────────────────
    annotation = {
        "annotation_version": ANNOTATION_VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "recording": recording,
        "models": models,
        "summary": summary,
        "phrases": annotation_phrases,
        "words": all_words,
        "voiced_segments": result.get("voiced_segments", []),
        "errors": errors,
    }

    logger.info(
        f"Built annotation for job {job['job_id']}: "
        f"{len(all_words)} words, {len(annotation_phrases)} phrases"
    )

    return annotation


def _build_word_entry(word_data: dict, phrase_index: int) -> dict:
    """
    Transform a single WordResult dict into an annotation word entry.
    Word entries carry word-level stress, pause, and confidence data.
    """
    return {
        "word_index": 0,  # Will be reassigned after sorting
        "word": word_data.get("word", ""),
        "start_time": word_data.get("start", 0.0),
        "end_time": word_data.get("end", 0.0),
        "phrase_index": phrase_index,
        "asr_confidence": word_data.get("confidence", 1.0),
        "stressed": word_data.get("stressed", False),
        "stress_score": word_data.get("stress_score", 0.0),
        "pause_after": word_data.get("pause_after", 0.0),
        "is_hesitation": word_data.get("is_hesitation", False),
    }
