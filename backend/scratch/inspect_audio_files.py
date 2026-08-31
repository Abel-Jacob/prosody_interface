import os
import sys
import numpy as np
import librosa
import soundfile as sf

def inspect_file(filepath):
    print(f"\n==================================================")
    print(f"Inspecting: {filepath}")
    print(f"==================================================")
    if not os.path.exists(filepath):
        print("File does not exist.")
        return
        
    try:
        # Load audio
        y, sr = librosa.load(filepath, sr=16000, mono=True)
    except Exception as e:
        print(f"Error loading with librosa: {e}")
        try:
            y, sr = sf.read(filepath)
            print(f"Loaded with soundfile instead. Raw shape: {y.shape}, sr={sr}")
            if len(y.shape) > 1:
                y = y.mean(axis=1)
            if sr != 16000:
                y = librosa.resample(y, orig_sr=sr, target_sr=16000)
                sr = 16000
        except Exception as e2:
            print(f"Error loading with soundfile: {e2}")
            return

    duration = len(y) / sr
    print(f"Duration: {duration:.3f} seconds ({len(y)} samples at {sr}Hz)")
    
    # Calculate stats
    mean_val = np.mean(y)
    std_val = np.std(y)
    min_val = np.min(y)
    max_val = np.max(y)
    print(f"Amplitude Stats: mean={mean_val:.6f}, std={std_val:.6f}, range=[{min_val:.6f}, {max_val:.6f}]")
    
    # Calculate energy in 100ms frames
    frame_len = int(0.100 * sr)
    hop_len = int(0.050 * sr)
    rms = librosa.feature.rms(y=y, frame_length=frame_len, hop_length=hop_len)[0]
    rms_db = librosa.amplitude_to_db(rms, ref=np.max)
    
    # Check silence vs speech
    db_range = np.max(rms_db) - np.min(rms_db)
    print(f"RMS Energy (dB): max={np.max(rms_db):.2f}, min={np.min(rms_db):.2f}, range={db_range:.2f}")
    
    # Check if ASR works or if it's noise
    # We can try PyIN on it to see if it detects voiced frames
    hop_length = int(0.010 * sr)
    fmin = librosa.note_to_hz('C2')
    fmax = librosa.note_to_hz('C6')
    try:
        f0, voiced_flag, voiced_prob = librosa.pyin(
            y[:int(min(5, duration)*sr)], fmin=fmin, fmax=fmax, sr=sr, hop_length=hop_length
        )
        voiced_ratio = np.sum(~np.isnan(f0)) / len(f0) if len(f0) > 0 else 0
        print(f"PyIN Voiced Frame Ratio (first 5s): {voiced_ratio:.2%}")
    except Exception as pe:
        print(f"PyIN failed: {pe}")

if __name__ == "__main__":
    audio_files = [
        "test.wav",
        "test.ogg",
        "backend/test.wav",
        "backend/test_output.wav",
        "backend/scratch/sample.flac",
        "backend/tests/fixtures/real_10s_speech.wav",
        "backend/tests/fixtures/real_speech.mp3",
        "backend/tests/fixtures/test_30s.wav",
        "backend/tests/fixtures/test_5s.wav",
        "backend/tests/fixtures/test_65s.wav"
    ]
    for filepath in audio_files:
        inspect_file(filepath)
