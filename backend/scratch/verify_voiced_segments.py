import numpy as np
import librosa
import libf0
from pipeline.prosody_pitch import extract_voiced_segments

def test_on_slice():
    audio, sr = librosa.load("backend/tests/fixtures/real_10s_speech.wav", sr=16000)
    # Slice to first 2.7 seconds
    slice_dur = 2.7
    y_slice = audio[:int(slice_dur * sr)]
    print(f"Loaded slice: duration = {len(y_slice)/sr:.3f}s")
    
    # 1. Test librosa.pyin
    print("\n=== librosa.pyin (resolution=0.10, frame_length=2048) ===")
    f0_pyin, voiced_flag_pyin, voiced_prob = librosa.pyin(
        np.asarray(y_slice, dtype=np.float32),
        fmin=50,
        fmax=500,
        sr=sr,
        frame_length=2048,
        hop_length=160,
        resolution=0.10
    )
    f0_pyin = np.nan_to_num(f0_pyin, nan=0.0)
    segs_pyin = extract_voiced_segments(f0_pyin, voiced_flag_pyin)
    print(f"Found {len(segs_pyin)} segments:")
    for idx, seg in enumerate(segs_pyin):
        t_start = seg["start_frame"] * (160 / sr)
        t_end = seg["end_frame"] * (160 / sr)
        n_frames = len(seg["x"])
        print(f"  Seg {idx}: {t_start:.2f}s - {t_end:.2f}s | {n_frames} frames")
        
    # 2. Test libf0.swipe
    print("\n=== libf0.swipe (strength >= 0.20) ===")
    f0_raw, time_axis, strength = libf0.swipe(
        np.asarray(y_slice, dtype=np.float64),
        Fs=sr,
        H=160,
        F_min=50,
        F_max=500
    )
    voiced_flag_swipe = (~np.isnan(strength)) & (strength >= 0.20)
    f0_swipe = np.where(voiced_flag_swipe, f0_raw, 0.0)
    segs_swipe = extract_voiced_segments(f0_swipe, voiced_flag_swipe)
    print(f"Found {len(segs_swipe)} segments:")
    for idx, seg in enumerate(segs_swipe):
        t_start = seg["start_frame"] * (160 / sr)
        t_end = seg["end_frame"] * (160 / sr)
        n_frames = len(seg["x"])
        print(f"  Seg {idx}: {t_start:.2f}s - {t_end:.2f}s | {n_frames} frames")

if __name__ == "__main__":
    test_on_slice()
