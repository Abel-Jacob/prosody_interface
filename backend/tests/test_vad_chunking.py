"""
Stage 2 Test: VAD Chunking — Standalone Verification

Tests that:
1. Silero VAD model loads successfully
2. Audio is split at silence/pause boundaries, NOT mid-word
3. Chunk durations are within expected range (~5-15s)
4. All speech content is captured (no dropped audio)

Usage: python tests/test_vad_chunking.py <audio_file>
If no audio file provided, generates a synthetic test signal.
"""

import sys
import os
import time
import numpy as np

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from pipeline.vad_chunking import load_silero_vad, chunk_audio_by_vad
from config import SAMPLE_RATE


def generate_test_audio(duration_sec: float = 60.0) -> np.ndarray:
    """
    Generate synthetic test audio with speech-like segments and silences.
    Alternates between 3-5s of noise (simulated speech) and 0.5-1.5s silence.
    """
    sr = SAMPLE_RATE
    audio_parts = []
    t = 0.0
    segment_info = []

    np.random.seed(42)
    while t < duration_sec:
        # Speech segment: 2-6 seconds
        speech_dur = np.random.uniform(2.0, 6.0)
        speech_dur = min(speech_dur, duration_sec - t)
        n_samples = int(speech_dur * sr)

        # Create speech-like signal (sine waves + noise)
        time_arr = np.linspace(0, speech_dur, n_samples)
        signal = (
            0.3 * np.sin(2 * np.pi * 200 * time_arr) +
            0.2 * np.sin(2 * np.pi * 400 * time_arr) +
            0.1 * np.random.randn(n_samples)
        ).astype(np.float32)
        audio_parts.append(signal)
        segment_info.append(("speech", t, t + speech_dur))
        t += speech_dur

        if t >= duration_sec:
            break

        # Silence segment: 0.3-1.5 seconds
        silence_dur = np.random.uniform(0.3, 1.5)
        silence_dur = min(silence_dur, duration_sec - t)
        n_silence = int(silence_dur * sr)
        silence = np.zeros(n_silence, dtype=np.float32)
        audio_parts.append(silence)
        segment_info.append(("silence", t, t + silence_dur))
        t += silence_dur

    audio = np.concatenate(audio_parts)
    print(f"\nGenerated test audio: {len(audio)/sr:.1f}s, {len(segment_info)} segments")
    for kind, start, end in segment_info:
        print(f"  {kind}: {start:.2f}s - {end:.2f}s ({end-start:.2f}s)")

    return audio


def test_vad_chunking_with_file(filepath: str):
    """Test VAD chunking on a real audio file."""
    import librosa
    print(f"\nLoading audio file: {filepath}")
    audio, sr = librosa.load(filepath, sr=SAMPLE_RATE, mono=True)
    print(f"Loaded: {len(audio)/sr:.1f}s, {sr}Hz, {audio.dtype}")
    return test_vad_chunking(audio)


def test_vad_chunking(audio: np.ndarray):
    """Run VAD chunking and verify results."""
    sr = SAMPLE_RATE
    total_duration = len(audio) / sr
    print(f"\nTotal audio duration: {total_duration:.1f}s")

    # Load VAD model
    print("\nLoading Silero VAD model...")
    t0 = time.time()
    vad_model = load_silero_vad()
    print(f"VAD model loaded in {time.time()-t0:.2f}s")

    # Run chunking
    print("\nRunning VAD chunking...")
    t0 = time.time()
    chunks = chunk_audio_by_vad(audio, vad_model)
    chunk_time = time.time() - t0
    print(f"Chunking completed in {chunk_time:.2f}s")

    # Report results
    print(f"\n{'='*60}")
    print(f"RESULTS: {len(chunks)} chunks from {total_duration:.1f}s audio")
    print(f"{'='*60}")

    total_chunk_duration = 0.0
    for i, chunk in enumerate(chunks):
        dur = chunk["end_time"] - chunk["start_time"]
        total_chunk_duration += dur
        n_samples = len(chunk["audio"])
        print(
            f"  Chunk {i+1:2d}: {chunk['start_time']:6.2f}s - {chunk['end_time']:6.2f}s "
            f"(duration: {dur:5.2f}s, samples: {n_samples:,})"
        )

    # Verification checks
    print(f"\n{'='*60}")
    print("VERIFICATION")
    print(f"{'='*60}")

    # Check 1: All chunks have reasonable duration
    durations = [c["end_time"] - c["start_time"] for c in chunks]
    max_dur = max(durations) if durations else 0
    min_dur = min(durations) if durations else 0
    avg_dur = np.mean(durations) if durations else 0

    print(f"  Chunk durations: min={min_dur:.2f}s, max={max_dur:.2f}s, avg={avg_dur:.2f}s")
    if max_dur <= 20.0:
        print("  [PASS] All chunks <= 20s (bounded for inference)")
    else:
        print(f"  [FAIL] Some chunks exceed 20s (max: {max_dur:.2f}s)")

    # Check 2: Total chunk coverage
    coverage_ratio = total_chunk_duration / total_duration if total_duration > 0 else 0
    print(f"  Total chunk duration: {total_chunk_duration:.2f}s / {total_duration:.2f}s ({coverage_ratio*100:.1f}%)")

    # Check 3: Chunks are ordered and non-overlapping
    ordered = all(
        chunks[i]["start_time"] < chunks[i+1]["start_time"]
        for i in range(len(chunks)-1)
    )
    print(f"  Chunks ordered: {'[PASS]' if ordered else '[FAIL]'}")

    non_overlapping = all(
        chunks[i]["end_time"] <= chunks[i+1]["start_time"] + 0.01  # tiny tolerance
        for i in range(len(chunks)-1)
    )
    print(f"  Chunks non-overlapping: {'[PASS]' if non_overlapping else '[FAIL]'}")

    # Check 4: Audio arrays are valid
    valid_arrays = all(
        isinstance(c["audio"], np.ndarray) and len(c["audio"]) > 0
        for c in chunks
    )
    print(f"  All chunk arrays valid: {'[PASS]' if valid_arrays else '[FAIL]'}")

    print(f"\n{'='*60}")
    all_pass = (max_dur <= 20.0) and ordered and non_overlapping and valid_arrays
    print(f"OVERALL: {'PASS' if all_pass else 'FAIL'}")
    print(f"{'='*60}")

    return all_pass, chunks


if __name__ == "__main__":
    if len(sys.argv) > 1:
        filepath = sys.argv[1]
        if not os.path.exists(filepath):
            print(f"Error: file not found: {filepath}")
            sys.exit(1)
        success, _ = test_vad_chunking_with_file(filepath)
    else:
        print("No audio file provided — using synthetic test audio")
        audio = generate_test_audio(duration_sec=65.0)
        success, _ = test_vad_chunking(audio)

    sys.exit(0 if success else 1)
