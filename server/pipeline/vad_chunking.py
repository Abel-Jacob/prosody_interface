"""
VAD Chunking — Split audio at silence boundaries

Uses Silero VAD to detect speech segments and split audio at natural
pause/silence boundaries. NEVER at a rigid fixed-duration cut that can
slice through active speech mid-word.

Each chunk targets ~5-8 seconds of speech to keep memory and per-chunk
inference time bounded regardless of total recording length.
"""

import logging
import numpy as np
import torch
from typing import Optional

from config import (
    SAMPLE_RATE,
    VAD_THRESHOLD,
    VAD_MIN_SPEECH_MS,
    VAD_MIN_SILENCE_MS,
    VAD_MAX_CHUNK_SEC,
)

logger = logging.getLogger(__name__)


def load_silero_vad():
    """Load the Silero VAD model. Called once at startup."""
    model, utils = torch.hub.load(
        repo_or_dir="snakers4/silero-vad",
        model="silero_vad",
        force_reload=False,
        trust_repo=True,
    )
    get_speech_timestamps = utils[0]
    logger.info("Silero VAD model loaded")
    return {"model": model, "get_speech_timestamps": get_speech_timestamps}


def chunk_audio_by_vad(
    audio: np.ndarray,
    vad_model: Optional[dict] = None,
    sample_rate: int = SAMPLE_RATE,
) -> list[dict]:
    """
    Split audio into chunks at silence/pause boundaries using Silero VAD.

    Args:
        audio: Full audio as float32 numpy array, 16kHz mono.
        vad_model: Dict with 'model' and 'get_speech_timestamps' from load_silero_vad().
        sample_rate: Audio sample rate (default 16000).

    Returns:
        List of dicts, each containing:
        - 'audio': np.ndarray of the chunk
        - 'start_time': float, start time in seconds
        - 'end_time': float, end time in seconds
    """
    if vad_model is None:
        raise ValueError("VAD model not loaded — call load_silero_vad() first")

    model = vad_model["model"]
    get_speech_timestamps = vad_model["get_speech_timestamps"]

    # Convert to torch tensor for Silero VAD
    audio_tensor = torch.from_numpy(audio).float()

    # Get speech timestamps from VAD
    speech_timestamps = get_speech_timestamps(
        audio_tensor,
        model,
        sampling_rate=sample_rate,
        threshold=VAD_THRESHOLD,
        min_speech_duration_ms=VAD_MIN_SPEECH_MS,
        min_silence_duration_ms=VAD_MIN_SILENCE_MS,
    )

    if not speech_timestamps:
        logger.warning("VAD found no speech in audio — treating full audio as one speech segment")
        # Create a synthetic segment spanning the full audio so the
        # splitting logic below still enforces max chunk size
        speech_timestamps = [{"start": 0, "end": len(audio)}]

    # Merge adjacent speech segments into chunks of ~5-8 seconds
    chunks = _merge_segments_into_chunks(
        audio, speech_timestamps, sample_rate
    )

    logger.info(
        f"VAD chunking: {len(speech_timestamps)} speech segments -> "
        f"{len(chunks)} chunks (target: 5-8s each)"
    )
    for i, c in enumerate(chunks):
        dur = c["end_time"] - c["start_time"]
        logger.debug(f"  Chunk {i}: {c['start_time']:.2f}s - {c['end_time']:.2f}s ({dur:.2f}s)")

    return chunks


def _merge_segments_into_chunks(
    audio: np.ndarray,
    speech_timestamps: list[dict],
    sample_rate: int,
) -> list[dict]:
    """
    Merge VAD speech segments into larger chunks, splitting at silence
    boundaries when accumulated speech exceeds the target duration.
    Adds small padding around speech segments for cleaner boundaries.

    If a single speech segment exceeds VAD_MAX_CHUNK_SEC, it is split
    into sub-segments of approximately equal length — this is the only
    case where we cut inside speech (necessary to bound inference time).
    """
    max_chunk_samples = int(VAD_MAX_CHUNK_SEC * sample_rate)
    padding_samples = int(0.15 * sample_rate)  # 150ms padding on each side

    # First pass: split any oversized individual segments
    split_segments = []
    for seg in speech_timestamps:
        seg_start = max(0, seg["start"] - padding_samples)
        seg_end = min(len(audio), seg["end"] + padding_samples)
        seg_len = seg_end - seg_start

        if seg_len > max_chunk_samples:
            # Split this oversized segment into roughly equal sub-segments
            n_splits = int(np.ceil(seg_len / max_chunk_samples))
            sub_len = seg_len // n_splits
            for j in range(n_splits):
                sub_start = seg_start + j * sub_len
                sub_end = seg_start + (j + 1) * sub_len if j < n_splits - 1 else seg_end
                split_segments.append({"start": sub_start, "end": sub_end})
        else:
            split_segments.append({"start": seg_start, "end": seg_end})

    # Second pass: Merge adjacent segments into chunks targeting ~7 seconds.
    # We split when accumulated duration exceeds target, or at major pauses (>1.2s).
    from config import VAD_TARGET_CHUNK_SEC
    target_chunk_samples = int(VAD_TARGET_CHUNK_SEC * sample_rate)
    major_pause_samples = int(1.2 * sample_rate)

    chunks = []
    current_group = []

    for seg in split_segments:
        if not current_group:
            current_group.append(seg)
            continue

        # Check silence gap between current segment and last segment in group
        silence_gap = seg["start"] - current_group[-1]["end"]
        # Check accumulated span if we were to add this segment
        accumulated_span = seg["end"] - current_group[0]["start"]

        # Split if there's a major speech pause or if we exceed target duration
        if silence_gap >= major_pause_samples or accumulated_span > target_chunk_samples:
            chunks.append(_build_chunk(audio, current_group, sample_rate))
            current_group = [seg]
        else:
            current_group.append(seg)

    if current_group:
        chunks.append(_build_chunk(audio, current_group, sample_rate))

    return chunks


def _build_chunk(
    audio: np.ndarray,
    segments: list[dict],
    sample_rate: int,
) -> dict:
    """
    Build a single chunk from a list of speech segments.
    Uses the full range from first segment start to last segment end,
    including any silence between segments (preserves natural pauses
    which are important for prosody analysis).
    """
    chunk_start_sample = segments[0]["start"]
    chunk_end_sample = segments[-1]["end"]

    chunk_audio = audio[chunk_start_sample:chunk_end_sample].copy()

    return {
        "audio": chunk_audio,
        "start_time": chunk_start_sample / sample_rate,
        "end_time": chunk_end_sample / sample_rate,
    }

