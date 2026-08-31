import numpy as np
import librosa
from pipeline.prosody_pitch import clean_short_voiced_runs, extract_voiced_segments, compute_K_wavelet

def test():
    # Load root test.wav and slice to 2.7s
    audio, sr = librosa.load("test.wav", sr=16000)
    slice_dur = 2.7
    y_slice = audio[:int(slice_dur * sr)]
    print(f"Slice duration: {len(y_slice)/sr:.3f}s")
    
    # Run librosa.pyin fallback
    f0_raw, voiced_flag_raw, voiced_prob = librosa.pyin(
        np.asarray(y_slice, dtype=np.float32),
        fmin=50,
        fmax=500,
        sr=sr,
        frame_length=2048,
        hop_length=160,
        resolution=0.10
    )
    f0 = np.nan_to_num(f0_raw, nan=0.0)
    f0, voiced_flag = clean_short_voiced_runs(f0, voiced_flag_raw, min_run=3)
    segs = extract_voiced_segments(f0, voiced_flag, min_len=8)
    
    print(f"Found {len(segs)} segments:")
    for idx, s in enumerate(segs):
        s_time = s['start_frame'] * 0.010
        e_time = s['end_frame'] * 0.010
        n_frames = len(s['x'])
        K = compute_K_wavelet(s['x'], wavelet='db1', level=3)
        print(f"  Seg {idx}: {s_time:.2f}s-{e_time:.2f}s | {n_frames} frames | K={K}")

if __name__ == "__main__":
    test()
