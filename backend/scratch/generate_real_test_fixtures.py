import os
import sys
import numpy as np
import librosa
import soundfile as sf

def generate_fixtures():
    root_wav = "test.wav"
    if not os.path.exists(root_wav):
        print(f"Error: {root_wav} does not exist in root directory!")
        return
        
    print(f"Loading {root_wav}...")
    y, sr = librosa.load(root_wav, sr=16000, mono=True)
    print(f"Loaded {len(y)} samples at {sr}Hz.")
    
    # Target file paths
    targets = {
        "backend/test.wav": 30.0,
        "backend/tests/fixtures/test_5s.wav": 5.0,
        "backend/tests/fixtures/test_30s.wav": 30.0,
        "backend/tests/fixtures/test_65s.wav": 65.0
    }
    
    for filepath, duration in targets.items():
        # Ensure parent dir exists
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        # Slice
        num_samples = int(duration * sr)
        sliced_audio = y[:num_samples]
        
        # Save as 16-bit PCM WAV
        sf.write(filepath, sliced_audio, sr, subtype='PCM_16')
        print(f"Generated genuine speech fixture: {filepath} ({duration}s)")

if __name__ == "__main__":
    generate_fixtures()
