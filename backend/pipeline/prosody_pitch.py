"""
Pitch Stylization Analyzer — MAE-Based Robust Pitch Stylization

Implements the complete pitch stylization pipeline from:
  "Noise Robust Pitch Stylization using Minimum Mean Absolute Error Criterion"
  — Chiranjeevi Yarra & Prasanta Kumar Ghosh, Interspeech 2021

Pipeline:
  1. Pitch extraction (SWIPE via pysptk, with PYIN fallback)
  2. Short voiced run cleanup
  3. Frame timeline generation
  4. Contiguous voiced segment extraction
  5. Automatic K estimation (wavelet complexity)
  6. Dynamic programming segmentation
  7. Piecewise polynomial fitting — MAE
  8. Full contour reconstruction
  9. Word-level prosodic feature extraction from MAE contour
  10. Per-character pitch normalization for typographic rendering

The MAE criterion is robust against pitch halving/doubling errors,
isolated spikes, and noisy pitch estimation — unlike MSE which is
sensitive to outliers.
"""

import logging
import numpy as np
from typing import Optional

from pipeline.prosody_base import ProsodyAnalyzer

logger = logging.getLogger(__name__)

# ── Constants ──────────────────────────────────────────────────────
SAMPLE_RATE = 16000
HOP_LENGTH_SEC = 0.010  # 10 ms hop
FMIN_NOTE = "C2"  # ~65 Hz
FMAX_NOTE = "C6"  # ~1047 Hz
MIN_VOICED_RUN = 3  # frames — shorter runs are treated as spurious
MIN_SEGMENT_LEN = 8  # frames — minimum length for a voiced segment
MAX_SEGMENT_FRAMES = 500  # ~5s — cap segment length to keep DP tractable
POLY_ORDER = 1  # first-order polynomial (piecewise linear)
K_MAX = 8  # maximum pieces per voiced segment
SWIPE_STRENGTH_THRESH = 0.2  # filter out weakly-voiced frames


# ═══════════════════════════════════════════════════════════════════
#  Module 1 — Pitch Extraction (SWIPE via libf0)
# ═══════════════════════════════════════════════════════════════════

def extract_pitch(signal: np.ndarray, sr: int, hop_length: int,
                  fmin: float, fmax: float) -> np.ndarray:
    """
    Extract pitch using SWIPE (Sawtooth-Waveform Inspired Pitch Estimator).

    SWIPE is the pitch tracker used in the original MAE stylization paper
    (Yarra & Ghosh, Interspeech 2021). It produces frame-level F0 estimates
    without temporal smoothing (unlike PYIN's HMM), which is important
    because the MAE criterion itself handles outlier robustness.

    Uses libf0's pure-Python SWIPE implementation (Camacho & Harris, 2008).
    Requires: pip install libf0

    Returns raw F0 array where unvoiced frames = 0.
    """
    from libf0 import swipe as libf0_swipe

    f0, t, strength = libf0_swipe(
        x=np.asarray(signal, dtype=np.float64),
        Fs=sr,
        H=hop_length,
        F_min=float(fmin),
        F_max=float(fmax),
        strength_threshold=SWIPE_STRENGTH_THRESH,
    )
    # libf0 returns 0 for unvoiced frames (same convention we need)
    f0 = np.asarray(f0, dtype=np.float64)
    logger.debug(
        f"SWIPE pitch extracted: {len(f0)} frames, "
        f"{int(np.sum(f0 > 0))} voiced ({100 * np.mean(f0 > 0):.1f}%)"
    )
    return f0


# ═══════════════════════════════════════════════════════════════════
#  Module 2 — Short Voiced Run Cleanup
# ═══════════════════════════════════════════════════════════════════

def clean_short_voiced_runs(f0_raw: np.ndarray, voiced_flag_raw: np.ndarray,
                            min_run: int = MIN_VOICED_RUN) -> tuple[np.ndarray, np.ndarray]:
    """
    Remove voiced runs shorter than `min_run` consecutive frames.
    SWIPE has no temporal smoothing (unlike PYIN's HMM), so isolated frames
    with wildly wrong pitch can pass f0 > 0. This zeroes them out.
    """
    voiced_flag = voiced_flag_raw.copy()
    n = len(voiced_flag_raw)
    i = 0
    while i < n:
        if voiced_flag_raw[i]:
            j = i
            while j < n and voiced_flag_raw[j]:
                j += 1
            if (j - i) < min_run:
                voiced_flag[i:j] = False
            i = j
        else:
            i += 1
    f0_clean = np.where(voiced_flag, f0_raw, np.nan)
    return f0_clean, voiced_flag


# ═══════════════════════════════════════════════════════════════════
#  Module 4 — Voiced Segment Extraction
# ═══════════════════════════════════════════════════════════════════

def extract_voiced_segments(f0: np.ndarray, voiced_flag: np.ndarray,
                            min_len: int = MIN_SEGMENT_LEN,
                            max_len: int = MAX_SEGMENT_FRAMES) -> list[dict]:
    """
    Split the full pitch track into contiguous voiced runs.
    Returns list of dicts: {start_frame, end_frame, x}.
    `min_len` discards runs too short to fit a first-order polynomial.
    `max_len` splits oversized segments so the DP stays tractable.
    """
    raw_segments = []
    n = len(f0)
    i = 0
    while i < n:
        if voiced_flag[i] and not np.isnan(f0[i]):
            j = i
            while j < n and voiced_flag[j] and not np.isnan(f0[j]):
                j += 1
            if (j - i) >= min_len:
                raw_segments.append({
                    "start_frame": i,
                    "end_frame": j - 1,
                    "x": f0[i:j].astype(float),
                })
            i = j
        else:
            i += 1

    # Split oversized segments to cap DP complexity at O(K * max_len^2)
    segments = []
    for seg in raw_segments:
        seg_len = len(seg["x"])
        if seg_len <= max_len:
            segments.append(seg)
        else:
            n_splits = (seg_len + max_len - 1) // max_len
            chunk_size = seg_len // n_splits
            for k in range(n_splits):
                start = k * chunk_size
                end = seg_len if k == n_splits - 1 else (k + 1) * chunk_size
                if (end - start) >= min_len:
                    segments.append({
                        "start_frame": seg["start_frame"] + start,
                        "end_frame": seg["start_frame"] + end - 1,
                        "x": seg["x"][start:end].copy(),
                    })
            logger.debug(
                f"Split oversized segment ({seg_len} frames) into "
                f"{n_splits} sub-segments of ~{chunk_size} frames"
            )
    return segments


# ═══════════════════════════════════════════════════════════════════
#  Module 5 — Automatic K Estimation (Wavelet Complexity)
# ═══════════════════════════════════════════════════════════════════

def compute_K_wavelet(x: np.ndarray, wavelet: str = "db1",
                      level: int = 3, K_max: int = K_MAX) -> int:
    """
    K - 1 = number of extrema in the level-3 wavelet detail coefficients.
    Simple contours → small K. Complex contours → larger K.
    """
    import pywt
    from scipy.signal import argrelextrema

    w = pywt.Wavelet(wavelet)
    max_level = pywt.dwt_max_level(len(x), w.dec_len)
    eff_level = min(level, max_level)
    if eff_level < 1:
        return 1

    coeffs = pywt.wavedec(x, wavelet=wavelet, level=eff_level)
    cD_target = coeffs[1]  # detail coefficients at target level

    if len(cD_target) < 3:
        return 1

    maxima = argrelextrema(cD_target, np.greater)[0]
    minima = argrelextrema(cD_target, np.less)[0]
    num_extrema = len(maxima) + len(minima)
    K = max(1, num_extrema + 1)
    K = min(K, K_max)
    return K


# ═══════════════════════════════════════════════════════════════════
#  Module 7 — Polynomial Fitting Utilities
# ═══════════════════════════════════════════════════════════════════

def _vandermonde(indices: np.ndarray, P: int) -> np.ndarray:
    """Build (len(indices) × (P+1)) Vandermonde matrix for polynomial order P."""
    indices = np.asarray(indices, dtype=float)
    return np.vstack([indices ** p for p in range(P + 1)]).T


def _eval_poly(alpha: np.ndarray, n: np.ndarray) -> np.ndarray:
    """Evaluate polynomial sum_p alpha_p * n^p."""
    alpha = np.asarray(alpha, dtype=float)
    n = np.asarray(n, dtype=float)
    P = len(alpha) - 1
    if np.ndim(n) == 0:
        powers = np.array([n ** p for p in range(P + 1)])
    else:
        powers = np.vstack([n ** p for p in range(P + 1)]).T
    return powers @ alpha


# ═══════════════════════════════════════════════════════════════════
#  Module 8 — MAE Fit (Linear Programming, production)
# ═══════════════════════════════════════════════════════════════════

def mae_fit(x_seg: np.ndarray, s: int, r: int, P: int,
            boundary: Optional[tuple] = None) -> tuple[np.ndarray, float]:
    """
    Minimum-absolute-error polynomial fit over 1-indexed frame range [s, r].
    Solved as a linear program (HiGHS solver). Robust to pitch
    halving/doubling errors and isolated spikes.
    """
    from scipy.optimize import linprog

    idx = np.arange(s, r + 1)
    x = x_seg[s - 1:r]
    N = len(idx)
    A = _vandermonde(idx, P)
    n_alpha = P + 1

    # Objective: minimize sum of slack variables (absolute errors)
    f = np.concatenate([np.zeros(n_alpha), np.ones(N)])

    # Inequality constraints: A*alpha - phi <= x  and  -A*alpha - phi <= -x
    I_N = np.eye(N)
    D_top = np.hstack([A, -I_N])
    D_bot = np.hstack([-A, -I_N])
    D = np.vstack([D_top, D_bot])
    y = np.concatenate([x, -x])

    # Optional continuity constraint
    A_eq, b_eq = None, None
    if boundary is not None:
        n0, b_val = boundary
        h_alpha = np.array([n0 ** p for p in range(n_alpha)], dtype=float)
        h = np.concatenate([h_alpha, np.zeros(N)])
        A_eq = h.reshape(1, -1)
        b_eq = np.array([b_val])

    # Bounds: alpha unconstrained, slack >= 0
    bounds = [(None, None)] * n_alpha + [(0, None)] * N

    res = linprog(
        c=f,
        A_ub=D, b_ub=y,
        A_eq=A_eq, b_eq=b_eq,
        bounds=bounds,
        method="highs",
    )
    if not res.success:
        raise RuntimeError(
            f"LP failed for segment [{s},{r}], P={P}: {res.message}"
        )

    phi = res.x
    alpha = phi[:n_alpha]
    residual = x - A @ alpha
    mae_error = float(np.sum(np.abs(residual)))
    return alpha, mae_error


# ═══════════════════════════════════════════════════════════════════
#  Module 6 — Dynamic Programming Segmentation
# ═══════════════════════════════════════════════════════════════════

def dp_stylize(x_seg: np.ndarray, K: int, P: int,
               fit_func) -> tuple[np.ndarray, list, float]:
    """
    Joint segmentation + piecewise polynomial fitting via DP.

    Args:
        x_seg:    1-D pitch array for one voiced segment.
        K:        number of segments (pieces).
        P:        polynomial order (1 = linear).
        fit_func: mae_fit.

    Returns:
        (stylized_contour, boundaries, total_cost)
    """
    N = len(x_seg)
    K = min(K, max(1, N // (P + 1)))

    # Forward pass: build cost table
    e = {1: {}}
    gamma = {1: {}}
    xi = {1: {}}
    for r in range(P + 1, N + 1):
        alpha, err = fit_func(x_seg, 1, r, P, boundary=None)
        e[1][r] = err
        gamma[1][r] = alpha
        xi[1][r] = 1

    for k in range(2, K + 1):
        e[k] = {}
        gamma[k] = {}
        xi[k] = {}
        r_min = k * P + 1
        for r in range(r_min, N + 1):
            best_cost = np.inf
            best_s = None
            best_alpha = None
            s_min = (k - 1) * P + 1
            s_max = r - P
            for s in range(s_min, s_max + 1):
                if s not in e[k - 1]:
                    continue
                b_val = float(_eval_poly(gamma[k - 1][s], s))
                alpha_c, err_c = fit_func(x_seg, s, r, P, boundary=(s, b_val))
                cost = e[k - 1][s] + err_c
                if cost < best_cost:
                    best_cost = cost
                    best_s = s
                    best_alpha = alpha_c
            if best_s is not None:
                e[k][r] = best_cost
                xi[k][r] = best_s
                gamma[k][r] = best_alpha

    # Find effective K (may be reduced if segment too short)
    K_eff = K
    while K_eff > 1 and N not in e.get(K_eff, {}):
        K_eff -= 1
    if N not in e.get(K_eff, {}) and K_eff == 1:
        raise RuntimeError("Unable to fit segment: too few points for polynomial order P.")

    # Backtrack to recover boundaries
    boundaries = []
    r = N
    k = K_eff
    while k >= 1:
        s = xi[k][r]
        alpha = gamma[k][r]
        boundaries.append((s, r, alpha))
        r = s
        k -= 1
    boundaries.reverse()

    total_cost = e[K_eff][N]

    # Reconstruct stylized contour
    stylized = np.zeros(N)
    for (s, r, alpha) in boundaries:
        idx = np.arange(s, r + 1)
        stylized[s - 1:r] = _eval_poly(alpha, idx)

    return stylized, boundaries, total_cost


# ═══════════════════════════════════════════════════════════════════
#  Module 9–10 — Full Contour Reconstruction
# ═══════════════════════════════════════════════════════════════════

def build_full_contour(results: list[dict], key: str, n_frames: int) -> np.ndarray:
    """Write per-segment stylized contours back into a full-length frame array."""
    full = np.full(n_frames, np.nan)
    for seg_result in results:
        s = seg_result["start_frame"]
        e = seg_result["end_frame"]
        full[s:e + 1] = seg_result[key]
    return full


# ═══════════════════════════════════════════════════════════════════
#  Word-Level Prosodic Feature Extraction
# ═══════════════════════════════════════════════════════════════════

def _classify_trend(start_pitch: float, end_pitch: float,
                    mean_pitch: float, threshold_ratio: float = 0.03) -> str:
    """
    Classify pitch movement across a word.
    threshold_ratio is relative to mean pitch.
    """
    if mean_pitch <= 0:
        return "→"
    threshold = mean_pitch * threshold_ratio
    change = end_pitch - start_pitch
    abs_change = abs(change)

    if abs_change < threshold:
        return "→"  # Flat
    elif change > 0:
        return "↑"  # Rising
    else:
        return "↓"  # Falling


def compute_word_pitch_features(
    word: dict,
    mae_contour: np.ndarray,
    frame_times: np.ndarray,
    global_min: float,
    global_max: float,
    segment_results: list[dict],
) -> dict:
    """
    For a single ASR word, extract prosodic features from the MAE contour.

    Returns dict with mean_pitch, max_pitch, min_pitch, start_pitch, end_pitch,
    pitch_slope, pitch_range, normalized_pitch, pitch_trend, char_pitches,
    voiced_segment_index.
    """
    word_start = word["start"]
    word_end = word["end"]
    word_text = word["word"]

    # Find frames within this word's time interval
    mask = (frame_times >= word_start) & (frame_times <= word_end)
    word_pitches = mae_contour[mask]

    # Filter to voiced frames only (non-NaN)
    voiced_pitches = word_pitches[~np.isnan(word_pitches)]

    if len(voiced_pitches) == 0:
        # Entirely unvoiced word — return None values
        return {
            "mean_pitch": None,
            "max_pitch": None,
            "min_pitch": None,
            "start_pitch": None,
            "end_pitch": None,
            "pitch_slope": None,
            "pitch_range": None,
            "normalized_pitch": None,
            "pitch_trend": None,
            "char_pitches": None,
            "voiced_segment_index": None,
        }

    mean_pitch = float(np.mean(voiced_pitches))
    max_pitch = float(np.max(voiced_pitches))
    min_pitch = float(np.min(voiced_pitches))
    start_pitch = float(voiced_pitches[0])
    end_pitch = float(voiced_pitches[-1])
    pitch_slope = round(end_pitch - start_pitch, 2)
    pitch_range = round(max_pitch - min_pitch, 2)

    # Normalize within utterance range
    global_range = global_max - global_min
    if global_range > 0:
        normalized_pitch = round((mean_pitch - global_min) / global_range, 3)
    else:
        normalized_pitch = 0.5

    pitch_trend = _classify_trend(start_pitch, end_pitch, mean_pitch)

    # Find which voiced segment this word falls in
    word_mid = (word_start + word_end) / 2.0
    voiced_segment_index = None
    for seg in segment_results:
        seg_start_time = frame_times[seg["start_frame"]]
        seg_end_time = frame_times[seg["end_frame"]]
        if seg_start_time <= word_mid <= seg_end_time:
            voiced_segment_index = seg["segment_index"]
            break

    # Per-character pitch interpolation
    n_chars = len(word_text.strip().rstrip(".,?!:;\"'"))
    if n_chars <= 0:
        n_chars = max(1, len(word_text))

    if len(voiced_pitches) >= 2 and n_chars > 1:
        # Interpolate the contour to n_chars points
        indices = np.linspace(0, len(voiced_pitches) - 1, n_chars)
        char_pitch_raw = np.interp(indices, np.arange(len(voiced_pitches)), voiced_pitches)
        # Normalize to 0–1 within global range
        if global_range > 0:
            char_pitches = [
                round(float((p - global_min) / global_range), 3)
                for p in char_pitch_raw
            ]
        else:
            char_pitches = [0.5] * n_chars
    else:
        # Single sample or single char — uniform
        char_pitches = [round(normalized_pitch, 3)] * n_chars

    return {
        "mean_pitch": round(mean_pitch, 1),
        "max_pitch": round(max_pitch, 1),
        "min_pitch": round(min_pitch, 1),
        "start_pitch": round(start_pitch, 1),
        "end_pitch": round(end_pitch, 1),
        "pitch_slope": pitch_slope,
        "pitch_range": pitch_range,
        "normalized_pitch": normalized_pitch,
        "pitch_trend": pitch_trend,
        "char_pitches": char_pitches,
        "voiced_segment_index": voiced_segment_index,
    }


# ═══════════════════════════════════════════════════════════════════
#  Full Pipeline
# ═══════════════════════════════════════════════════════════════════

def run_pitch_stylization(
    signal: np.ndarray,
    sr: int,
    words: list[dict],
) -> dict:
    """
    End-to-end pitch stylization pipeline.

    Args:
        signal: float32 mono audio at `sr` Hz.
        words:  list of word dicts with {word, start, end, ...}.

    Returns:
        dict with 'word_pitch' key containing per-word prosodic features.
    """
    import librosa

    hop_length = int(HOP_LENGTH_SEC * sr)
    fmin = librosa.note_to_hz(FMIN_NOTE)
    fmax = librosa.note_to_hz(FMAX_NOTE)

    # ── Step 1: Pitch extraction ───────────────────────────────────
    f0_raw = extract_pitch(signal, sr, hop_length, fmin, fmax)
    voiced_flag_raw = f0_raw > 0

    # ── Step 2: Clean short voiced runs ────────────────────────────
    f0, voiced_flag = clean_short_voiced_runs(f0_raw, voiced_flag_raw, min_run=MIN_VOICED_RUN)

    n_frames = len(f0)
    logger.info(
        f"Pitch: {n_frames} frames, {int(np.sum(voiced_flag))} voiced "
        f"({100 * np.mean(voiced_flag):.1f}%)"
    )

    # ── Step 3: Frame timeline ─────────────────────────────────────
    frame_times = librosa.frames_to_time(
        np.arange(n_frames), sr=sr, hop_length=hop_length
    )

    # ── Step 4: Voiced segment extraction ──────────────────────────
    voiced_segments = extract_voiced_segments(f0, voiced_flag, min_len=MIN_SEGMENT_LEN)
    if not voiced_segments:
        logger.warning("No voiced segments found — returning empty pitch data")
        return {"word_pitch": [{"word": w["word"]} | {
            "mean_pitch": None, "max_pitch": None, "min_pitch": None,
            "start_pitch": None, "end_pitch": None, "pitch_slope": None,
            "pitch_range": None, "normalized_pitch": None, "pitch_trend": None,
            "char_pitches": None, "voiced_segment_index": None,
        } for w in words]}

    logger.info(
        f"Found {len(voiced_segments)} voiced segments "
        f"(lengths: {[len(s['x']) for s in voiced_segments]})"
    )

    # ── Step 5: Automatic K estimation ─────────────────────────────
    for seg in voiced_segments:
        seg["K"] = compute_K_wavelet(seg["x"], wavelet="db1", level=3)

    # ── Step 6–9: DP stylization with MAE ──────────────────────────
    P = POLY_ORDER
    segment_results = []

    for seg_idx, seg in enumerate(voiced_segments):
        x_seg = seg["x"]
        K = seg["K"]

        try:
            mae_stylized, mae_boundaries, mae_cost = dp_stylize(x_seg, K, P, mae_fit)
        except Exception as e:
            logger.warning(f"MAE stylization failed for segment {seg_idx}: {e}")
            # Fall back to raw contour if MAE fails
            mae_stylized = x_seg.copy()
            mae_boundaries, mae_cost = [], 0.0

        segment_results.append({
            "segment_index": seg_idx,
            "start_frame": seg["start_frame"],
            "end_frame": seg["end_frame"],
            "x": x_seg,
            "K": K,
            "mae_stylized": mae_stylized,
            "mae_cost": mae_cost,
        })

        logger.debug(
            f"Segment {seg_idx}: N={len(x_seg)}, K={K} → "
            f"MAE cost={mae_cost:.2f}"
        )

    # ── Step 10: Full contour reconstruction ───────────────────────
    mae_full = build_full_contour(segment_results, "mae_stylized", n_frames)

    # Compute global pitch range from voiced frames of MAE contour
    voiced_mae = mae_full[~np.isnan(mae_full)]
    if len(voiced_mae) > 0:
        global_min = float(np.min(voiced_mae))
        global_max = float(np.max(voiced_mae))
    else:
        global_min, global_max = 0.0, 1.0

    logger.info(
        f"Pitch range: {global_min:.1f}–{global_max:.1f} Hz "
        f"({len(segment_results)} segments stylized)"
    )

    # ── Word-level feature extraction ──────────────────────────────
    word_pitch_results = []
    for w in words:
        features = compute_word_pitch_features(
            w, mae_full, frame_times, global_min, global_max, segment_results
        )
        features["word"] = w["word"]
        word_pitch_results.append(features)

    return {"word_pitch": word_pitch_results}


# ═══════════════════════════════════════════════════════════════════
#  ProsodyAnalyzer Interface Implementation
# ═══════════════════════════════════════════════════════════════════

class PitchAnalyzer(ProsodyAnalyzer):
    """
    MAE-based pitch stylization and word-level prosodic feature extraction.

    Unlike StressAnalyzer and PauseAnalyzer which process per-sentence chunks,
    PitchAnalyzer processes the full audio to produce a globally coherent
    stylized contour, then maps it to individual words.
    """

    name = "pitch"

    def __init__(self):
        self._sr = SAMPLE_RATE

    def setup(self, models: dict) -> None:
        """Store sample rate from models config."""
        self._sr = models.get("sample_rate", SAMPLE_RATE)
        logger.info(
            f"PitchAnalyzer initialized (sr={self._sr}, "
            f"hop={HOP_LENGTH_SEC}s, P={POLY_ORDER})"
        )

    def analyze(self, audio_chunk: np.ndarray, words: list[dict]) -> dict:
        """
        Run the full MAE pitch stylization pipeline.

        Args:
            audio_chunk: float32 numpy array, 16kHz mono (full audio).
            words: All ASR word dicts with {word, start, end, ...}.

        Returns:
            {'word_pitch': [{word, mean_pitch, pitch_slope, char_pitches, ...}, ...]}
        """
        if len(audio_chunk) == 0 or not words:
            logger.debug("PitchAnalyzer: empty audio or no words")
            return {"word_pitch": []}

        try:
            result = run_pitch_stylization(audio_chunk, self._sr, words)
            logger.info(
                f"PitchAnalyzer: processed {len(words)} words, "
                f"{sum(1 for w in result['word_pitch'] if w.get('mean_pitch') is not None)} "
                f"with pitch data"
            )
            return result
        except Exception as e:
            logger.error(f"PitchAnalyzer error: {e}", exc_info=True)
            return {"word_pitch": [], "error": str(e)}
