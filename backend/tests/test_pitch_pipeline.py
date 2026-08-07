"""
Test script for the MAE pitch stylization pipeline.
Verifies the algorithm end-to-end with synthetic data.
"""
import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.path.insert(0, ".")
import numpy as np
from pipeline.prosody_pitch import (
    clean_short_voiced_runs, extract_voiced_segments,
    compute_K_wavelet, mse_fit, mae_fit, dp_stylize,
    build_full_contour, compute_word_pitch_features
)

# Simulate a pitch contour: 100 frames, some voiced, some unvoiced
np.random.seed(42)
f0 = np.zeros(100)
# Voiced region 1: frames 10-50, rising pitch ~150-200 Hz
f0[10:50] = np.linspace(150, 200, 40) + np.random.randn(40) * 3
# Voiced region 2: frames 60-85, falling pitch ~190-160 Hz
f0[60:85] = np.linspace(190, 160, 25) + np.random.randn(25) * 3
voiced_flag_raw = f0 > 0

# Clean short runs
f0_clean, voiced_flag = clean_short_voiced_runs(f0, voiced_flag_raw, min_run=3)
print(f"Voiced frames: {np.sum(voiced_flag)}")

# Extract segments
segments = extract_voiced_segments(f0_clean, voiced_flag, min_len=8)
print(f"Segments: {len(segments)}")
assert len(segments) == 2, f"Expected 2 segments, got {len(segments)}"

# Wavelet K estimation
for seg in segments:
    K = compute_K_wavelet(seg["x"])
    seg["K"] = K
    print(f"  Segment N={len(seg['x'])}, K={K}")
    assert K >= 1, "K must be >= 1"

# DP stylization with MAE and MSE
for i, seg in enumerate(segments):
    mae_stylized, mae_bounds, mae_cost = dp_stylize(seg["x"], seg["K"], 1, mae_fit)
    mse_stylized, mse_bounds, mse_cost = dp_stylize(seg["x"], seg["K"], 1, mse_fit)
    seg["mae_stylized"] = mae_stylized
    seg["mse_stylized"] = mse_stylized
    seg["segment_index"] = i
    print(f"  Segment {i}: MAE cost={mae_cost:.2f}, MSE cost={mse_cost:.2f}")
    assert len(mae_stylized) == len(seg["x"]), "Stylized length mismatch"
    assert mae_cost >= 0, "Cost must be non-negative"

# Reconstruct full contours
mae_full = build_full_contour(segments, "mae_stylized", 100)
voiced_mae = mae_full[~np.isnan(mae_full)]
print(f"Full MAE contour: {len(voiced_mae)} voiced frames")
assert len(voiced_mae) == 65, f"Expected 65 voiced frames, got {len(voiced_mae)}"

# Compute word-level features
import librosa
frame_times = librosa.frames_to_time(np.arange(100), sr=16000, hop_length=160)
global_min = float(np.min(voiced_mae))
global_max = float(np.max(voiced_mae))

# Word in rising region
word1 = {"word": "hello", "start": frame_times[10], "end": frame_times[35]}
feat1 = compute_word_pitch_features(word1, mae_full, frame_times, global_min, global_max, segments)
print(f"\nWord 'hello': mean={feat1['mean_pitch']}, trend={feat1['pitch_trend']}, slope={feat1['pitch_slope']}")
print(f"  char_pitches ({len(feat1['char_pitches'])} chars): {feat1['char_pitches']}")
assert feat1["mean_pitch"] is not None, "Should have pitch data"
assert feat1["pitch_trend"] == "↑", f"Expected rising trend, got {feat1['pitch_trend']}"
assert len(feat1["char_pitches"]) == 5, f"Expected 5 chars, got {len(feat1['char_pitches'])}"

# Word in falling region
word2 = {"word": "world", "start": frame_times[60], "end": frame_times[80]}
feat2 = compute_word_pitch_features(word2, mae_full, frame_times, global_min, global_max, segments)
print(f"\nWord 'world': mean={feat2['mean_pitch']}, trend={feat2['pitch_trend']}, slope={feat2['pitch_slope']}")
assert feat2["pitch_trend"] == "↓", f"Expected falling trend, got {feat2['pitch_trend']}"

# Word in unvoiced region
word3 = {"word": "silence", "start": frame_times[0], "end": frame_times[5]}
feat3 = compute_word_pitch_features(word3, mae_full, frame_times, global_min, global_max, segments)
print(f"\nWord 'silence': mean={feat3['mean_pitch']}, trend={feat3['pitch_trend']}")
assert feat3["mean_pitch"] is None, "Should have no pitch data for unvoiced word"
assert feat3["char_pitches"] is None, "Should have no char pitches for unvoiced word"

print("\n" + "=" * 50)
print("ALL TESTS PASSED")
print("=" * 50)
