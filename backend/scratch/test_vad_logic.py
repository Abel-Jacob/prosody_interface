import asyncio
import numpy as np
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.resolve()))

from pipeline.vad_chunking import load_silero_vad, chunk_audio_by_vad

def test_vad_behavior():
    print("Loading VAD...")
    vad_model = load_silero_vad()
    
    # 1. 10s audio with continuous speech (simulated by random noise)
    # Actually VAD might treat noise as silence or speech. Let's make a sine wave.
    sr = 16000
    t = np.linspace(0, 10, 10 * sr, False)
    speech = np.sin(2 * np.pi * 440 * t).astype(np.float32)
    
    # 2. 10s audio with lots of pauses
    # 1s speech, 1s silence, 1s speech, 1s silence...
    speech_with_pauses = np.zeros(10 * sr, dtype=np.float32)
    for i in range(5):
        start = i * 2 * sr
        end = start + sr
        speech_with_pauses[start:end] = np.sin(2 * np.pi * 440 * t[start:end]).astype(np.float32)

    print("\n--- Test 1: 10s Continuous Signal ---")
    chunks1 = chunk_audio_by_vad(speech, vad_model, sr)
    print(f"Produced {len(chunks1)} chunks.")
    
    print("\n--- Test 2: 10s Signal with 1s pauses ---")
    chunks2 = chunk_audio_by_vad(speech_with_pauses, vad_model, sr)
    print(f"Produced {len(chunks2)} chunks.")

if __name__ == "__main__":
    test_vad_behavior()
