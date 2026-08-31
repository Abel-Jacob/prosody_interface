import numpy as np
import librosa
import libf0
from pipeline.prosody_pitch import extract_voiced_segments, clean_short_voiced_runs

def test():
    # Load the 10s speech file and slice to 2.7s
    audio, sr = librosa.load("backend/tests/fixtures/real_10s_speech.wav", sr=16000)
    slice_dur = 2.7
    y_slice = audio[:int(slice_dur * sr)]
    print(f"Slice duration: {len(y_slice)/sr:.3f}s")
    
    # We will test libf0.swipe with different thresholds and min_run/min_len parameters
    f0_raw, time_axis, strength = libf0.swipe(
        np.asarray(y_slice, dtype=np.float64),
        Fs=sr,
        H=160,
        F_min=50,
        F_max=500
    )
    
    for thresh in [0.20, 0.22, 0.25, 0.28, 0.30, 0.32, 0.35, 0.38]:
        voiced_flag_raw = (~np.isnan(strength)) & (strength >= thresh)
        f0, voiced_flag = clean_short_voiced_runs(f0_raw, voiced_flag_raw, min_run=3)
        segs = extract_voiced_segments(f0, voiced_flag, min_len=8)
        
        print(f"\n--- Threshold {thresh:.2f} ---")
        print(f"Found {len(segs)} segments:")
        for idx, s in enumerate(segs):
            s_time = s['start_frame'] * 0.010
            e_time = s['end_frame'] * 0.010
            n_frames = len(s['x'])
            print(f"  Seg {idx}: {s_time:.2f}s-{e_time:.2f}s | {n_frames} frames")

if __name__ == "__main__":
    test()
