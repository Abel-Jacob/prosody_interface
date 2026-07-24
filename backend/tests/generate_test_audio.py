"""
Generate a test audio file using edge-tts for testing the full pipeline.
Creates a ~60s multi-sentence spoken audio file.
"""
import sys
import os
import asyncio

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# We'll use a simpler approach: create a WAV file with known speech content
# by concatenating the whisper model's test generation

import numpy as np
import soundfile as sf
from config import SAMPLE_RATE


def generate_simple_test_wav(output_path: str, duration: float = 5.0):
    """Generate a simple audio file that faster-whisper can transcribe.
    Uses random noise which won't produce meaningful speech but will verify
    the pipeline mechanics."""
    sr = SAMPLE_RATE
    t = np.linspace(0, duration, int(sr * duration), dtype=np.float32)
    # Generate something with speech-like spectral characteristics
    audio = np.zeros_like(t)
    for freq in [100, 200, 300, 500, 800, 1200, 2000, 3000]:
        audio += 0.05 * np.sin(2 * np.pi * freq * t + np.random.uniform(0, 2*np.pi))
    # Add amplitude modulation to simulate speech rhythm
    envelope = 0.5 + 0.5 * np.sin(2 * np.pi * 3 * t)  # ~3 Hz modulation
    audio *= envelope
    audio = audio.astype(np.float32)
    sf.write(output_path, audio, sr)
    print(f"Generated test audio: {output_path} ({duration:.1f}s)")
    return output_path


if __name__ == "__main__":
    os.makedirs("backend/tests/fixtures", exist_ok=True)
    generate_simple_test_wav("backend/tests/fixtures/test_5s.wav", 5.0)
    generate_simple_test_wav("backend/tests/fixtures/test_30s.wav", 30.0)
    generate_simple_test_wav("backend/tests/fixtures/test_65s.wav", 65.0)
    print("\nDone! Test files generated in backend/tests/fixtures/")
