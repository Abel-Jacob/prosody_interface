# Pitch Feature — Technical Reference

> Everything about how raw pitch is tracked, how the MAE algorithm stylizes it,
> and how the stylized contour is finally painted onto the transcribed text.

---

## Table of Contents

- [Overview](#overview)
- [Why MAE, not MSE?](#why-mae-not-mse)
- [End-to-End Pipeline](#end-to-end-pipeline)
  - [Step 1 — Raw Pitch Extraction (SWIPE)](#step-1--raw-pitch-extraction-swipe)
  - [Step 2 — Short Voiced Run Cleanup](#step-2--short-voiced-run-cleanup)
  - [Step 3 — Frame Timeline](#step-3--frame-timeline)
  - [Step 4 — Contiguous Voiced Segment Extraction](#step-4--contiguous-voiced-segment-extraction)
  - [Step 5 — Automatic K Estimation (Wavelet Complexity)](#step-5--automatic-k-estimation-wavelet-complexity)
  - [Step 6 — Dynamic Programming Segmentation](#step-6--dynamic-programming-segmentation)
  - [Step 7 — MAE Polynomial Fitting (Linear Programming)](#step-7--mae-polynomial-fitting-linear-programming)
  - [Step 8 — Full Contour Reconstruction](#step-8--full-contour-reconstruction)
  - [Step 9 — Word-Level Feature Extraction](#step-9--word-level-feature-extraction)
  - [Step 10 — Per-Character Pitch Normalization](#step-10--per-character-pitch-normalization)
- [How Raw Pitch Is Tracked](#how-raw-pitch-is-tracked)
- [What the Word Receives](#what-the-word-receives)
- [Frontend Visualization](#frontend-visualization)
  - [The Baseline-Only Rule](#the-baseline-only-rule)
  - [How scaleY Is Applied](#how-scaley-is-applied)
  - [Reveal Animation](#reveal-animation)
- [Data Flow Diagram](#data-flow-diagram)
- [Constants and Tunables](#constants-and-tunables)
- [Files Involved](#files-involved)
- [Reference Paper](#reference-paper)

---

## Overview

The pitch feature produces a **typographic pitch contour** — each character in the
transcribed text is individually scaled vertically to reflect the MAE-stylized
fundamental frequency (F0) of the speech at that moment.

- A character spoken at a **high pitch** is rendered **taller** (scaleY > 1).
- A character spoken at a **low pitch** is rendered **shorter** (scaleY < 1).
- Every word, whether it has pitch data or not, stays on the **same horizontal
  baseline** — characters only stretch or compress upward, never moving up or down.

---

## Why MAE, not MSE?

Standard pitch stylization fits piecewise polynomials by minimizing the **Mean
Squared Error** (MSE). MSE is sensitive to outliers: a single pitch-halving error
(e.g. 220 Hz tracked as 110 Hz) or a spike can drag the fitted line far from the
true contour.

The implementation follows **Yarra & Ghosh (Interspeech 2021)** and minimizes the
**Mean Absolute Error** (MAE) instead. Because MAE is a linear norm, it can be
solved exactly as a **Linear Program (LP)** using the HiGHS solver
(`scipy.optimize.linprog` with `method="highs"`).

The result is that pitch halving/doubling errors and isolated spikes contribute
only linearly — not quadratically — to the cost, so the fitted contour stays close
to the true voiced pitch even in noisy conditions.

---

## End-to-End Pipeline

All of this lives in `backend/pipeline/prosody_pitch.py`.
The entry point is `run_pitch_stylization(signal, sr, words)`.

```
raw audio (float32, 16 kHz mono)
       |
       v
[1] SWIPE pitch extraction      -> f0_raw[n_frames]   (Hz, 0 = unvoiced)
       |
       v
[2] Short voiced run cleanup    -> f0[n_frames], voiced_flag[n_frames]
       |
       v
[3] Frame timeline              -> frame_times[n_frames]  (seconds)
       |
       v
[4] Voiced segment extraction   -> list of {start_frame, end_frame, x[]}
       |
       v
[5] Automatic K estimation      -> K per segment  (wavelet extrema count)
       |
       v
[6] DP segmentation             +
[7] MAE LP fitting              +-> stylized contour per segment
       |
       v
[8] Full contour reconstruction -> mae_full[n_frames]   (Hz, NaN = unvoiced)
       |
       v
[9] Word-level feature extraction
       |
       v
[10] Per-character pitch normalization -> char_pitches[] (0-1 per character)
```

---

### Step 1 — Raw Pitch Extraction (SWIPE)

```python
f0_raw = extract_pitch(signal, sr, hop_length, fmin, fmax)
```

Uses **libf0's pure-Python SWIPE** (Sawtooth Waveform Inspired Pitch Estimator,
Camacho & Harris 2008). SWIPE was chosen because:

- It is the tracker used in the original MAE paper.
- Unlike PYIN, it applies **no HMM temporal smoothing** — it produces raw,
  frame-by-frame estimates. This is intentional: the MAE fitting step is what
  handles robustness, not the tracker.
- `strength_threshold=0` keeps all frames; filtering happens in step 2.

| Parameter | Value |
|-----------|-------|
| Hop length | 10 ms (160 samples at 16 kHz) |
| F0 min | ~65 Hz (C2) |
| F0 max | ~1047 Hz (C6) |
| Unvoiced convention | f0 = 0 |

---

### Step 2 — Short Voiced Run Cleanup

```python
f0, voiced_flag = clean_short_voiced_runs(f0_raw, voiced_flag_raw, min_run=3)
```

Because SWIPE has no temporal smoothing, isolated 1- or 2-frame "voiced" spikes
appear between unvoiced regions. Any voiced run shorter than `MIN_VOICED_RUN = 3`
consecutive frames (~30 ms) is zeroed out and treated as unvoiced (`NaN`).

This is a conservative pre-filter. The MAE criterion provides further robustness
against outliers within genuine voiced runs.

---

### Step 3 — Frame Timeline

```python
frame_times = librosa.frames_to_time(np.arange(n_frames), sr=sr, hop_length=hop_length)
```

Converts frame indices to seconds. Used later to align pitch frames with
ASR word timestamps.

---

### Step 4 — Contiguous Voiced Segment Extraction

```python
voiced_segments = extract_voiced_segments(f0, voiced_flag, min_len=8)
```

Splits the full pitch track into contiguous voiced runs. Each segment is a dict:

```python
{
  "start_frame": int,
  "end_frame": int,
  "x": np.ndarray   # raw F0 values in Hz
}
```

Segments shorter than `MIN_SEGMENT_LEN = 8` frames (~80 ms) are discarded —
too short to fit a first-order polynomial.

---

### Step 5 — Automatic K Estimation (Wavelet Complexity)

```python
K = compute_K_wavelet(x, wavelet="db1", level=3)
```

`K` is the number of **piecewise segments** to use for DP stylization. A flat
intonation contour needs `K=1`; a complex rise-fall-rise contour needs `K=4+`.

The estimate is derived from the **level-3 Daubechies-1 wavelet detail
coefficients** of the raw F0 segment:

```
K = (number of local extrema in level-3 detail coefficients) + 1
```

More extrema means more complexity, which means more pieces. Capped at `K_MAX = 8`.

---

### Step 6 — Dynamic Programming Segmentation

```python
stylized, boundaries, cost = dp_stylize(x_seg, K, P=1, fit_func=mae_fit)
```

Given a voiced segment of length N and a target number of pieces K, the DP
finds the **optimal breakpoints** that minimize the total MAE across all K pieces.

The DP table stores:

- `e[k][r]` — minimum total cost using `k` pieces ending at frame `r`
- `gamma[k][r]` — polynomial coefficients for the last piece ending at `r`
- `xi[k][r]` — optimal start of the last piece

Continuity between pieces is enforced: each new piece is constrained to begin
exactly at the ending value of the previous piece (a shared boundary value).

**Backtracking** then recovers the K boundary points that achieve the minimum cost.

---

### Step 7 — MAE Polynomial Fitting (Linear Programming)

```python
alpha, error = mae_fit(x_seg, s, r, P=1, boundary=None)
```

For a given frame range `[s, r]` and polynomial order `P=1` (piecewise linear),
fits the polynomial coefficients `alpha` that minimize:

```
minimize  sum |x_i - (alpha_0 + alpha_1 * i)|   for i = s..r
```

This is formulated as an LP:

```
Variables:   alpha_0, alpha_1      (2 free)
             phi_s, ..., phi_r     (N slack variables >= 0)

Minimize:    sum(phi_i)

Subject to:  A * alpha - phi <= x      (residual upper bound)
            -A * alpha - phi <= -x     (residual lower bound)
             (optional boundary: alpha evaluated at s = b_val)
```

Solved by **HiGHS** (`scipy.optimize.linprog`, `method="highs"`) — a
state-of-the-art LP solver included in SciPy >= 1.9.

The optional `boundary` constraint enforces continuity at segment joins: the
polynomial of piece `k` must pass through the endpoint of piece `k-1`.

---

### Step 8 — Full Contour Reconstruction

```python
mae_full = build_full_contour(segment_results, "mae_stylized", n_frames)
```

Writes each segment's stylized contour back into a full-length frame array
`(n_frames,)`, leaving `NaN` wherever speech was unvoiced. This is the
**globally coherent MAE contour** used for all downstream analysis.

---

### Step 9 — Word-Level Feature Extraction

```python
features = compute_word_pitch_features(word, mae_contour, frame_times, ...)
```

For each ASR word:

1. Find all frames where `frame_times[i]` is within `[word.start, word.end]`.
2. Keep only voiced (non-NaN) frames from the MAE contour within that window.
3. Compute summary statistics:

| Feature | Description |
|---------|-------------|
| `mean_pitch` | Mean F0 in Hz over voiced frames |
| `max_pitch` | Maximum F0 in Hz |
| `min_pitch` | Minimum F0 in Hz |
| `start_pitch` | F0 at word onset |
| `end_pitch` | F0 at word offset |
| `pitch_slope` | `end_pitch - start_pitch` in Hz |
| `pitch_range` | `max_pitch - min_pitch` in Hz |
| `normalized_pitch` | `(mean_pitch - global_min) / (global_max - global_min)` |
| `pitch_trend` | rising / falling / flat arrow symbol |
| `voiced_segment_index` | Which voiced segment this word falls in |
| `char_pitches` | Per-character normalized values (see step 10) |

Global min/max are computed from the entire voiced portion of `mae_full` — so
all words share the same normalization reference, enabling meaningful comparison
across a full utterance.

**Pitch trend classification:**

```python
threshold = mean_pitch * 0.03   # 3% of mean pitch
if abs(end - start) < threshold:   -> flat  ->
elif end > start:                  -> rising  up-arrow
else:                              -> falling  down-arrow
```

---

### Step 10 — Per-Character Pitch Normalization

```python
indices = np.linspace(0, len(voiced_pitches) - 1, n_chars)
char_pitch_raw = np.interp(indices, np.arange(len(voiced_pitches)), voiced_pitches)
char_pitches = [(p - global_min) / global_range for p in char_pitch_raw]
```

The voiced pitch values for a word are resampled to `n_chars` evenly-spaced
points (one per character, excluding trailing punctuation). Each value is then
normalized to `[0, 1]` within the utterance's global pitch range.

The result — `char_pitches: list[float]` — is sent to the frontend inside
`WordResult.char_pitches`.

---

## How Raw Pitch Is Tracked

SWIPE does not smooth across time. At every 10 ms hop:

1. It estimates the fundamental period of a sawtooth waveform that best matches
   the local autocorrelation of the audio.
2. If no clear period is found (unvoiced frame), it returns 0.

The resulting `f0_raw[i]` values are frame-synchronized but can be noisy:
- Adjacent frames may jump by an octave (pitch halving/doubling).
- Isolated voiced frames can appear in unvoiced regions.

Step 2 cleans up isolated frames. Steps 6 and 7 (DP + MAE LP) handle octave errors
and within-segment spikes — the L1 cost makes the fitted line insensitive to a
small number of outlier frames.

---

## What the Word Receives

After the full pipeline runs (in the background worker `worker.py`),
each `WordResult` carries:

```python
WordResult(
    word="hello",
    start=0.44, end=0.80,
    ...
    mean_pitch=175.3,         # Hz
    max_pitch=192.1,
    min_pitch=162.7,
    start_pitch=168.0,
    end_pitch=185.4,
    pitch_slope=17.4,         # rising
    pitch_range=29.4,
    normalized_pitch=0.62,    # 62% of utterance range
    pitch_trend="up-arrow",
    char_pitches=[0.55, 0.59, 0.62, 0.66, 0.70],  # one per char of "hello"
    voiced_segment_index=0,
)
```

---

## Frontend Visualization

The pitch contour is rendered by two files:

- `frontend/src/components/ProsodyWord.jsx` — renders one word
- `frontend/src/components/ProsodyWord.css` — all styling, animation, and the baseline-pin logic

### The Baseline-Only Rule

> **Every word stays on the default line it is transcribed on. Words only
> stretch or shrink (vertically). They never go up or down.**

This is guaranteed by two CSS properties working together:

```css
/* The word container — stays in normal text flow */
.prosody-word {
  display: inline;           /* NOT inline-block: no block formatting context */
  white-space: nowrap;
}

/* Each character span */
.prosody-char {
  display: inline-block;     /* needs a box to apply scaleY */
  vertical-align: bottom;    /* pin the BOTTOM EDGE to the text baseline */
  line-height: 1;            /* no descender spacing below the glyph */
  transform-origin: bottom center;  /* scaleY grows upward only */
}
```

**Why `vertical-align: bottom` and not `baseline`?**

The CSS `baseline` alignment aligns the text glyph's baseline. When `scaleY`
is applied, the inline-block's box grows but its baseline stays at the glyph
position — the top of tall characters extends above the line box's top, which
can cause the line to reflow and push other lines down. With `vertical-align:
bottom`, the **bottom edge** of the inline-block is pinned to the bottom of
the line box. `scaleY` then grows upward into the existing line box height
without affecting any other element's position.

The outer tooltip-tracking wrapper in `SummaryState` also gets
`vertical-align: bottom`:

```jsx
<span
  ref={wordRef}
  style={{ display: 'inline-block', verticalAlign: 'bottom', marginRight: ... }}
>
  <ProsodyWord ... />
</span>
```

### How scaleY Is Applied

```javascript
// Pitch scale range
const SCALE_MIN = 0.7   // lowest pitch -> characters 70% of normal height
const SCALE_MAX = 1.3   // highest pitch -> characters 130% of normal height

function normalizedPitchToScale(p) {
  return SCALE_MIN + clamp(p, 0, 1) * (SCALE_MAX - SCALE_MIN)
}
```

For each character at index `i`:

```javascript
const scale = getCharScale(i)   // interpolates charPitches to chars.length
// Applied as:
<span
  className="prosody-char"
  style={{
    '--final-scale': scale,
    transform: revealed ? `scaleY(${scale})` : 'scaleY(1)',
  }}
>
  {char}
</span>
```

If `charPitches.length` does not equal `chars.length` (word length changed due
to punctuation stripping), linear interpolation maps the pitch array to the
actual character count.

### Reveal Animation

When a `ProsodyWord` first mounts, all characters start at `scaleY(1)`. After a
50 ms delay, the `reveal` class is added, triggering the CSS keyframe animation:

```css
@keyframes revealPitchChar {
  0%   { transform: scaleY(1);                      opacity: 0.85; }
  60%  {                                             opacity: 1;    }
  100% { transform: scaleY(var(--final-scale, 1));  opacity: 1;    }
}
```

Characters are staggered by 30 ms each (`:nth-child` selectors), so the
deformation ripples across the word left-to-right, making the pitch shape
visually readable as a flowing contour rather than an instant jump.

---

## Data Flow Diagram

```
Audio (float32, 16 kHz)
         |
         |  prosody_pitch.py::run_pitch_stylization()
         v
  SWIPE (libf0) -----------------------------> f0_raw[N_frames]
         |
  clean_short_voiced_runs() ----------------> voiced_flag[N_frames]
         |
  extract_voiced_segments() ----------------> segments[]
         |
  compute_K_wavelet() ----------------------> K per segment
         |
  dp_stylize() + mae_fit() (LP, HiGHS) -----> stylized[] per segment
         |
  build_full_contour() ---------------------> mae_full[N_frames]
         |
  compute_word_pitch_features() ------------> word_pitch[]
         |                                    (per ASR word)
         v
  worker.py::_process_job()
    w.char_pitches = pd["char_pitches"]    <- list[float] 0-1
    w.mean_pitch   = pd["mean_pitch"]      <- Hz
    w.pitch_trend  = pd["pitch_trend"]     <- arrow symbols
    ... (all WordResult pitch fields)
         |
         v  JSON via GET /api/jobs/{id}
  SummaryState.jsx
    hasPitchData = w.char_pitches?.length > 0
    -> <ProsodyWord charPitches={w.char_pitches} />
         |
         v
  ProsodyWord.jsx
    chars.map((char, i) => scaleY mapped from charPitches[i])
         |
         v
  ProsodyWord.css
    vertical-align: bottom + transform-origin: bottom center
    -> characters stretch UPWARD ONLY from the text baseline
```

---

## Constants and Tunables

All in `backend/pipeline/prosody_pitch.py`:

| Constant | Value | Effect |
|----------|-------|--------|
| `HOP_LENGTH_SEC` | 0.010 s | Time resolution of pitch tracking (10 ms) |
| `FMIN_NOTE` | "C2" (~65 Hz) | Minimum tracked F0 (excludes sub-bass) |
| `FMAX_NOTE` | "C6" (~1047 Hz) | Maximum tracked F0 (above normal speech range) |
| `MIN_VOICED_RUN` | 3 frames | Shorter voiced runs are discarded as noise |
| `MIN_SEGMENT_LEN` | 8 frames | Minimum segment length for stylization |
| `POLY_ORDER` | 1 | Piecewise linear (first-order) fitting |
| `K_MAX` | 8 | Maximum pieces per voiced segment |

All in `frontend/src/components/ProsodyWord.jsx`:

| Constant | Value | Effect |
|----------|-------|--------|
| `SCALE_MIN` | 0.7 | Characters at lowest pitch are 70% of normal height |
| `SCALE_MAX` | 1.3 | Characters at highest pitch are 130% of normal height |

---

## Files Involved

| File | Role |
|------|------|
| `backend/pipeline/prosody_pitch.py` | Complete MAE pipeline (SWIPE -> DP -> LP -> word features) |
| `backend/pipeline/prosody_registry.py` | Registers `PitchAnalyzer` as a full-audio analyzer |
| `backend/worker/worker.py` | Runs pitch analysis post-sentence-processing; merges results into `WordResult` |
| `backend/schemas.py` | `WordResult` pitch fields: `mean_pitch`, `char_pitches`, `pitch_trend`, etc. |
| `frontend/src/components/ProsodyWord.jsx` | React component: maps `char_pitches` to per-char `scaleY` |
| `frontend/src/components/ProsodyWord.css` | `vertical-align: bottom` baseline-pinning and reveal animation |
| `frontend/src/components/SummaryState.jsx` | Decides when to render `ProsodyWord` vs plain text; wraps with tooltip ref |
| `frontend/src/components/ProsodyTooltip.jsx` | Displays `mean_pitch`, `pitch_trend`, `pitch_slope`, `pitch_range` on click |

---

## Reference Paper

> Chiranjeevi Yarra & Prasanta Kumar Ghosh,
> **"Noise Robust Pitch Stylization using Minimum Mean Absolute Error Criterion"**,
> *Interspeech 2021*.
>
> Full PDF included in the repository root: `yarra21_interspeech.pdf`
>
> The reference Jupyter notebook exploration is at:
> `pitch_stylization_mae (8).ipynb`
