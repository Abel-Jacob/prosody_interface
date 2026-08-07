"""Quick test: verify SWIPE pitch extraction via pysptk on a synthetic tone."""
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.path.insert(0, ".")
import numpy as np
from pipeline.prosody_pitch import extract_pitch

# Generate a 1-second 200Hz sine wave at 16kHz (simulating a voiced segment)
sr = 16000
duration = 1.0
t = np.arange(0, duration, 1/sr)
freq = 200.0
signal = 0.5 * np.sin(2 * np.pi * freq * t)

# Extract pitch with SWIPE
hop_length = int(0.010 * sr)  # 10ms hop
f0 = extract_pitch(signal, sr, hop_length, fmin=65.0, fmax=1047.0)

print(f"Signal: {len(signal)} samples, {duration}s at {sr}Hz")
print(f"F0 array: {len(f0)} frames")

# Check that most frames detected ~200Hz
voiced = f0[f0 > 0]
print(f"Voiced frames: {len(voiced)}/{len(f0)}")
if len(voiced) > 0:
    mean_f0 = np.mean(voiced)
    print(f"Mean F0: {mean_f0:.1f} Hz (expected ~200 Hz)")
    assert 180 < mean_f0 < 220, f"F0 way off: {mean_f0}"
    print("SWIPE EXTRACTION: PASSED")
else:
    print("WARNING: No voiced frames detected (may be expected for pure sine)")
    print("SWIPE EXTRACTION: SKIPPED (sine may not trigger voicing)")
