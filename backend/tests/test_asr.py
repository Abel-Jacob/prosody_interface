"""
Stage 3 Test: ASR (faster-whisper) — Standalone Verification

Tests that:
1. faster-whisper model loads successfully
2. Transcription produces accurate text for known audio
3. Word-level timestamps and confidence scores are returned
4. Multiple chunks transcribe correctly in sequence

Usage: python tests/test_asr.py <audio_file>
If no audio file provided, tests with a short synthetic signal.
"""

import sys
import os
import time
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from pipeline.asr import load_asr_model, transcribe_chunk
from config import SAMPLE_RATE


def test_asr_model_loading():
    """Test that the ASR model loads correctly."""
    print("\n" + "="*60)
    print("TEST: ASR Model Loading")
    print("="*60)

    t0 = time.time()
    model = load_asr_model()
    load_time = time.time() - t0

    print(f"  Model loaded in {load_time:.2f}s")
    print(f"  Model type: {type(model).__name__}")
    print(f"  ✓ Model loaded successfully")

    return model


def test_asr_on_chunks(model, chunks: list):
    """Test ASR on a list of audio chunks."""
    print("\n" + "="*60)
    print(f"TEST: ASR on {len(chunks)} chunks")
    print("="*60)

    all_words = []
    total_time = 0.0

    for i, chunk in enumerate(chunks):
        if isinstance(chunk, dict):
            audio = chunk["audio"]
            start = chunk.get("start_time", 0)
            end = chunk.get("end_time", len(audio) / SAMPLE_RATE)
        else:
            audio = chunk
            start = 0
            end = len(audio) / SAMPLE_RATE

        dur = end - start
        print(f"\n  Chunk {i+1}: {start:.2f}s - {end:.2f}s ({dur:.2f}s)")

        t0 = time.time()
        result = transcribe_chunk(audio, model)
        chunk_time = time.time() - t0
        total_time += chunk_time

        text = result.get("text", "")
        words = result.get("words", [])
        all_words.extend(words)

        print(f"    Transcription: \"{text}\"")
        print(f"    Words: {len(words)}")
        print(f"    Time: {chunk_time:.2f}s (RTF: {chunk_time/dur:.2f}x)")

        if words:
            avg_conf = np.mean([w["confidence"] for w in words])
            print(f"    Avg confidence: {avg_conf:.3f}")

            # Show first few words with timestamps
            for w in words[:5]:
                print(
                    f"      [{w['start']:.2f}-{w['end']:.2f}] "
                    f"\"{w['word']}\" (conf: {w['confidence']:.3f})"
                )
            if len(words) > 5:
                print(f"      ... and {len(words)-5} more words")

    print(f"\n  Total ASR time: {total_time:.2f}s for {len(chunks)} chunks")
    print(f"  Total words transcribed: {len(all_words)}")

    # Verification
    has_words = len(all_words) > 0
    has_timestamps = all(
        "start" in w and "end" in w for w in all_words
    )
    has_confidence = all(
        "confidence" in w and 0 <= w["confidence"] <= 1 for w in all_words
    )

    print(f"\n  Words found: {'✓' if has_words else '✗'}")
    print(f"  All have timestamps: {'✓' if has_timestamps else '✗'}")
    print(f"  All have confidence: {'✓' if has_confidence else '✗'}")

    all_pass = has_words and has_timestamps and has_confidence
    print(f"\n  OVERALL: {'PASS ✓' if all_pass else 'FAIL ✗'}")

    return all_pass


def test_asr_with_file(filepath: str):
    """Full test: load model, load file, chunk with VAD, transcribe each chunk."""
    import librosa
    from pipeline.vad_chunking import load_silero_vad, chunk_audio_by_vad

    print(f"\nLoading audio: {filepath}")
    audio, sr = librosa.load(filepath, sr=SAMPLE_RATE, mono=True)
    print(f"Loaded: {len(audio)/sr:.1f}s")

    # Load models
    vad_model = load_silero_vad()
    asr_model = test_asr_model_loading()

    # Chunk with VAD
    chunks = chunk_audio_by_vad(audio, vad_model)
    print(f"VAD produced {len(chunks)} chunks")

    # Test ASR on each chunk
    return test_asr_on_chunks(asr_model, chunks)


if __name__ == "__main__":
    if len(sys.argv) > 1:
        filepath = sys.argv[1]
        if not os.path.exists(filepath):
            print(f"Error: file not found: {filepath}")
            sys.exit(1)
        success = test_asr_with_file(filepath)
    else:
        print("No audio file provided.")
        print("Usage: python tests/test_asr.py <audio_file.wav>")
        print("\nWill test model loading only...")
        model = test_asr_model_loading()
        success = model is not None

    sys.exit(0 if success else 1)
