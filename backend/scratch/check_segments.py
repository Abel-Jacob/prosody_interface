import os
import sys
import numpy as np
import librosa

# Add backend directory to sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from pipeline.prosody_pitch import clean_short_voiced_runs, extract_voiced_segments, compute_K_wavelet

def check_file(path):
    print(f"\n=== Checking {path} ===")
    try:
        signal, sr = librosa.load(path, sr=16000, mono=True)
    except Exception as e:
        print(f"Error loading {path}: {e}")
        return

    hop_length = int(0.010 * sr)
    fmin = librosa.note_to_hz('C2')
    fmax = librosa.note_to_hz('C6')

    # Try librosa.pyin with resolution=0.25 (backend)
    f0_pyin_025, voiced_flag_pyin_025, _ = librosa.pyin(
        signal, fmin=fmin, fmax=fmax, sr=sr, hop_length=hop_length, resolution=0.25
    )
    f0_pyin_025 = np.nan_to_num(f0_pyin_025, nan=0.0)
    f0_clean_025, flag_clean_025 = clean_short_voiced_runs(f0_pyin_025, f0_pyin_025 > 0, min_run=3)
    segs_025 = extract_voiced_segments(f0_clean_025, flag_clean_025, min_len=8)
    print(f"pyin (res=0.25): found {len(segs_025)} segments:")
    for idx, seg in enumerate(segs_025):
        s_time = seg['start_frame'] * 0.010
        e_time = seg['end_frame'] * 0.010
        n_frames = len(seg['x'])
        K = compute_K_wavelet(seg['x'], wavelet='db1', level=3)
        print(f"  Seg {idx}: {s_time:.2f}s-{e_time:.2f}s | {n_frames} frames | K={K}")

    # Try librosa.pyin with resolution=0.10 (default pyin)
    f0_pyin_010, voiced_flag_pyin_010, _ = librosa.pyin(
        signal, fmin=fmin, fmax=fmax, sr=sr, hop_length=hop_length
    )
    f0_pyin_010 = np.nan_to_num(f0_pyin_010, nan=0.0)
    f0_clean_010, flag_clean_010 = clean_short_voiced_runs(f0_pyin_010, f0_pyin_010 > 0, min_run=3)
    segs_010 = extract_voiced_segments(f0_clean_010, flag_clean_010, min_len=8)
    print(f"pyin (default): found {len(segs_010)} segments:")
    for idx, seg in enumerate(segs_010):
        s_time = seg['start_frame'] * 0.010
        e_time = seg['end_frame'] * 0.010
        n_frames = len(seg['x'])
        K = compute_K_wavelet(seg['x'], wavelet='db1', level=3)
        print(f"  Seg {idx}: {s_time:.2f}s-{e_time:.2f}s | {n_frames} frames | K={K}")

if __name__ == "__main__":
    fixtures_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "tests", "fixtures")
    for f in os.listdir(fixtures_dir):
        if f.endswith(".wav") or f.endswith(".mp3"):
            check_file(os.path.join(fixtures_dir, f))
