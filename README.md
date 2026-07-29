# Prosody Interface

A real-time web application that records speech, transcribes it, and analyzes prosody features — **word stress**, **pauses**, and **hesitations** — using AI models running on a GPU-accelerated backend.

---

## Table of Contents

- [How It Works (Simple Version)](#how-it-works-simple-version)
- [Architecture Overview](#architecture-overview)
- [The Complete Pipeline](#the-complete-pipeline)
  - [Phase 1: Live Recording & Preview](#phase-1-live-recording--preview)
  - [Phase 2: Final Processing (The Worker)](#phase-2-final-processing-the-worker)
- [How Pause Detection Works](#how-pause-detection-works)
- [How VAD Chunking Works](#how-vad-chunking-works)
- [How Stress Detection Works](#how-stress-detection-works)
- [How Sentences Are Built](#how-sentences-are-built)
- [Current Pause Visualization](#current-pause-visualization)
- [Alternative Pause Visualization Methods](#alternative-pause-visualization-methods)
- [Tech Stack](#tech-stack)
- [File Structure](#file-structure)
- [Configuration Reference](#configuration-reference)
- [Running the Project](#running-the-project)

---

## How It Works (Simple Version)

1. You click **Record** and speak into your microphone.
2. While you speak, you see a **live preview** of your words appearing in real-time.
3. When you click **Stop**, the backend queues a background job.
4. The backend runs your full audio through a high-accuracy pipeline: transcription → stress detection → pause detection.
5. The frontend polls for progress and displays the final results — stressed words highlighted, pauses visualized, hesitations absorbed.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                        FRONTEND                         │
│  React (Vite) + RecordRTC + WaveSurfer.js               │
│                                                         │
│  IdleState → ListeningState → ProcessingState → Summary │
│       ▲              │                 ▲          │     │
│       │         WebSocket              │   HTTP Poll    │
│       │        (1s chunks)          GET /jobs/:id  │     │
└───────┼──────────────┼─────────────────┼──────────┼─────┘
        │              ▼                 │          ▼
┌───────┼──────────────────────────────────────────────────┐
│       │          BACKEND (FastAPI)                       │
│       │                                                  │
│  WebSocket Handler ──► Live ASR (fast, greedy)           │
│       │                                                  │
│  POST /api/jobs ──► SQLite Job Queue                     │
│                          │                               │
│                    Background Worker                     │
│                          │                               │
│            ┌─────────────┼─────────────────┐             │
│            ▼             ▼                 ▼             │
│     Full-pass ASR    WhiStress         PauseAnalyzer     │
│    (beam search)   (stress model)  (timestamp math)      │
│            │             │                 │             │
│            └─────────────┼─────────────────┘             │
│                          ▼                               │
│                   Merge + Group                          │
│                   into Sentences                         │
│                          │                               │
│                          ▼                               │
│                  SQLite (result JSON)                     │
└──────────────────────────────────────────────────────────┘
```

---

## The Complete Pipeline

### Phase 1: Live Recording & Preview

**What the user sees:** Words appearing on screen as they speak.

**What actually happens under the hood:**

1. **Audio Capture** — The browser's `MediaRecorder` API captures audio as `audio/webm;codecs=opus` blobs. A new blob is emitted every **1 second**.

2. **WebSocket Streaming** — Each 1-second blob is sent over a WebSocket to `backend/api/websocket.py`.

3. **Real-time Decoding** — The backend pipes every incoming WebM blob directly into a persistent `ffmpeg` subprocess:
   ```
   ffmpeg -i pipe:0 -f s16le -acodec pcm_s16le -ac 1 -ar 16000 -
   ```
   This decodes Opus audio into raw 16kHz mono PCM (int16) on the fly. The decoded bytes accumulate in an in-memory `pcm_buffer`.

4. **Sliding Window Transcription** — Every **~2 chunks (~2 seconds)**, the backend:
   - Converts the full `pcm_buffer` to a `float32` numpy array.
   - Extracts the **last 8 seconds** as a sliding window.
   - Runs `faster-whisper` in **greedy mode** (`beam_size=1`, `temperature=0.0`) for speed.
   - Runs the `StressAnalyzer` (WhiStress) on that window for live stress highlighting.

5. **Deduplication** — The backend tracks `last_yielded_idx` (the sample index of the last word sent to the client). Only words whose timestamps fall *after* this index and *before* a 400ms safety margin from the window edge are sent. This prevents duplicates and cut-off words.

6. **Incremental Delivery** — The backend sends a JSON payload:
   ```json
   {
     "type": "incremental_words",
     "words": [{"word": "hello", "start": 1.2, "end": 1.5, "stressed": true, ...}],
     "text": "hello world"
   }
   ```
   The frontend appends these words to the display.

7. **On Stop** — When the user clicks Stop:
   - All accumulated WebM blobs are concatenated and saved to disk as `audio_uploads/{job_id}.webm`.
   - A job row is created in SQLite with status `queued`.
   - The frontend receives a `job_created` message with the `job_id`.

---

### Phase 2: Final Processing (The Worker)

**What the user sees:** A progress bar going from 0% to 100%.

**What actually happens:**

The `Worker` class (`backend/worker/worker.py`) runs as an `asyncio.create_task()` started at server boot. It runs an infinite loop:

```
while running:
    job = get_next_queued_job()      # Check SQLite
    if job:
        process_job(job)             # Full pipeline
    else:
        await asyncio.sleep(1.0)     # Poll every 1 second
```

**Processing a single job step-by-step:**

| Stage | Progress | What Happens |
|-------|----------|--------------|
| **1. Load Audio** | 5% | `librosa.load(filepath, sr=16000, mono=True)` converts the saved `.webm` file into a float32 numpy array at 16kHz mono. |
| **2. Full-pass Transcription** | 15% | The **entire** audio is passed to `faster-whisper` in a single pass (not chunked). This uses `beam_size=5`, `best_of=5`, and temperature fallback `[0.0, 0.2, 0.4]` for maximum accuracy. Whisper returns word-level timestamps and confidence scores. |
| **3. Sentence Grouping** | 15% | Words are grouped into grammatical sentences by `group_words_by_punctuation()` — splitting strictly at Whisper's own sentence-ending punctuation (`.` `?` `!`). |
| **4. Per-Sentence Prosody** | 20%→95% | For each sentence, the audio segment is sliced out and passed through all registered prosody analyzers (stress + pause). Progress updates after each sentence. |
| **5. Finalize** | 95%→100% | Results are assembled into a `JobResult` with computed WPM, stress ratio, and total duration. Saved to SQLite. Audio file deleted from disk. |

The frontend polls `GET /api/jobs/{job_id}` every 1.5 seconds. When `status === "complete"`, it receives the full result JSON and renders the summary view.

---

## How Pause Detection Works

> **Key insight: Pause detection does NOT use a separate ML model.** It is calculated purely from the word-level timestamps that `faster-whisper` already provides as part of transcription.

### The Math

When Whisper transcribes audio, it returns precise start and end timestamps for every word:

```
Word: "I"       start=0.000  end=0.240
Word: "went"    start=0.320  end=0.560
Word: "to"      start=0.560  end=0.720
Word: "the"     start=1.440  end=1.600    ← big gap before this word
Word: "store"   start=1.640  end=2.080
```

The `PauseAnalyzer` (in `backend/pipeline/prosody_pause.py`) simply calculates the **gap** between consecutive words:

```python
pause_after = next_word["start"] - current_word["end"]
```

For the example above:
- "I" → "went": `0.320 - 0.240 = 0.08s` (normal gap, not a pause)
- "went" → "to": `0.560 - 0.560 = 0.00s` (no gap)
- "to" → "the": `1.440 - 0.720 = 0.72s` ← **this is a long pause**
- "the" → "store": `1.640 - 1.600 = 0.04s` (normal)

### Hesitation Detection

The `PauseAnalyzer` also detects **vocalized hesitations** — filler words like "um", "uh", "ah", "er". This is a simple string lookup against a hardcoded set:

```python
HESITATION_WORDS = {"um", "umm", "uh", "uhh", "ah", "ahh", "er", "erm"}
```

No acoustic analysis is needed — Whisper already transcribes these as words. The analyzer just flags them.

### Hesitation Absorption (Frontend)

When the frontend receives a hesitation word, it doesn't display it. Instead, the `preprocessWords()` function in `SummaryState.jsx` **absorbs** the filler into the previous word's pause:

```
Original:  "I" (pause=0.1s) → "um" (pause=0.3s) → "went"
Displayed: "I" (pause=0.1 + 0.4s_filler_duration + 0.3s = 0.8s) → "went"
```

The filler word disappears, and its entire time span (gap before + filler duration + gap after) gets folded into the preceding word's `pause_after`.

### Why No Separate Pause Model?

Whisper's word timestamps are derived from its **cross-attention weights** between the audio mel-spectrogram and generated text tokens. These timestamps are already sub-100ms accurate for English speech. Computing the gap between consecutive word endpoints gives us pause durations that are accurate enough for prosody visualization without any additional model, saving GPU memory and inference time.

---

## How VAD Chunking Works

> **Note:** In the current architecture, VAD chunking is available but not used in the final processing path. The worker runs a **single full-pass transcription** of the entire audio instead. VAD chunking was used in an earlier streaming architecture and remains available for future use. The information below describes how it works.

### Purpose

VAD (Voice Activity Detection) chunking splits long audio recordings into smaller segments at **natural silence boundaries**. This is critical because:
1. Whisper has a **30-second attention window limit** — audio longer than this degrades quality.
2. Processing chunks sequentially keeps memory usage bounded regardless of recording length.

### How It Works Step-by-Step

**Step 1: Speech Detection**

The `Silero VAD` model (loaded from `torch.hub`) scans the audio and returns a list of speech segments:

```python
speech_timestamps = get_speech_timestamps(
    audio_tensor,
    model,
    threshold=0.5,              # 50% speech probability cutoff
    min_speech_duration_ms=250, # Ignore speech shorter than 250ms
    min_silence_duration_ms=500 # Silences must be at least 500ms to count
)
# Returns: [{"start": 0, "end": 48000}, {"start": 56000, "end": 112000}, ...]
#           (values in sample indices, not seconds)
```

**Step 2: Oversized Segment Splitting**

If any single speech segment exceeds `VAD_MAX_CHUNK_SEC` (29 seconds), it's split into roughly equal sub-segments. This is the **only** case where a cut happens inside active speech.

**Step 3: Merging Segments into Chunks**

Adjacent speech segments are merged into chunks, splitting when:
- The **silence gap** between segments exceeds **1.2 seconds** (a "major pause"), OR
- The **accumulated span** from the first segment to the current one exceeds `VAD_TARGET_CHUNK_SEC` (25 seconds)

Each chunk gets **150ms of padding** on each side for cleaner audio boundaries.

**Step 4: Building Chunks**

Each chunk spans from the first segment's start to the last segment's end, **including any silence between segments** (preserving natural pauses for prosody analysis).

### Configuration

| Parameter | Value | Meaning |
|-----------|-------|---------|
| `VAD_THRESHOLD` | 0.5 | Speech probability must exceed 50% |
| `VAD_MIN_SPEECH_MS` | 250ms | Ignore speech bursts shorter than this |
| `VAD_MIN_SILENCE_MS` | 500ms | Silence must last at least this long to be a boundary |
| `VAD_TARGET_CHUNK_SEC` | 25s | Target chunk duration (gives Whisper full context) |
| `VAD_MAX_CHUNK_SEC` | 29s | Hard max, just under Whisper's 30s limit |
| Major pause threshold | 1.2s | Silence longer than this always triggers a chunk split |

---

## How Stress Detection Works

The `StressAnalyzer` uses **WhiStress**, a custom model built on top of `openai/whisper-small.en`. It predicts whether each word in an utterance is **stressed** (emphasized) or not.

### How It Works

1. The sentence audio is packaged as `{"array": np.ndarray, "sampling_rate": 16000}`.
2. The transcription text is reconstructed from the word list.
3. WhiStress runs a single forward pass with `torch.inference_mode()`.
4. It returns a list of `(word, stress_label)` tuples where `stress_label` is `0` (unstressed) or `1` (stressed).

### WhiStress Architecture

WhiStress uses Whisper's encoder to produce hidden-state embeddings from the audio, but instead of Whisper's standard text-generation decoder, it routes those embeddings through:
- An **additional decoder block** (`additional_decoder_block.pt`)
- A **linear classifier** (`classifier.pt`)

This produces a binary classification (stressed / unstressed) per word via sigmoid activation.

---

## How Sentences Are Built

### In Final Processing: `group_words_by_punctuation()`

Words are grouped into sentences strictly by Whisper's own punctuation output. When Whisper ends a word with `.`, `?`, or `!`, that's a sentence boundary. Simple and reliable because the full-pass transcription gives Whisper enough context to punctuate correctly.

### In Streaming (Legacy): `reconstruct_grammatical_phrases()`

When audio was processed in VAD chunks, Whisper would sometimes hallucinate periods at chunk boundaries. The `merge.py` module contained heuristics to fix this:
- **False period detection:** If a period is followed by a small gap (<0.8s) and a common lowercase word, strip the period.
- **False capitalization:** If a word is capitalized but is a common lowercase word (from a 200+ word set), lowercase it.
- **Major pause splitting:** Gaps ≥1.0s trigger a sentence break even without punctuation.
- **Long clause breaking:** Sentences exceeding 30 words break at commas or 0.4s gaps.

---

## Current Pause Visualization

The frontend uses breathing dots in `SummaryState.jsx`:

| Pause Duration | Visual |
|----------------|--------|
| < 0.5s | Nothing — normal word spacing |
| 0.5s – 1.0s | `• •` — two animated breathing dots (orange, pulsing) |
| > 1.0s | `• • •` — three animated breathing dots |

Hovering over the breathing dots reveals a tooltip showing the exact pause duration (e.g. `0.8s`). Clicking a word opens the full `WordTooltip` where pauses >0.5s are highlighted in orange (`#f97316`).

---

## Alternative Pause Visualization Methods

Below are alternative methods that could complement the current comma/breathing-dots approach:

### 1. Variable-Width Gaps Between Words

Instead of uniform word spacing, render the physical gap between words proportional to the actual pause duration. A 0.2s pause gets a small gap; a 1.5s pause gets a wide gap. This creates an intuitive spatial "timeline" where the reader's eye naturally slows down at pauses — the same way the speaker did.

**Pros:** Very intuitive, no extra visual clutter.
**Cons:** Can waste horizontal space on long pauses; line-wrapping becomes unpredictable.

### 2. Waveform Timeline with Pause Annotations

Display the audio waveform (using wavesurfer.js, which is already in the project) below the transcript. Overlay vertical markers or shaded regions on the waveform where pauses occur. Clicking a pause region could highlight the corresponding words in the transcript.

**Pros:** Grounds pauses in the actual audio; great for detailed analysis.
**Cons:** Takes up vertical space; more complex to implement.

### 3. Color-Gradient Word Backgrounds

Apply a background color to each word that varies by the pause *after* it. Words followed by no pause have no background; words followed by long pauses get an increasingly saturated warm color (e.g., transparent → light amber → deep orange). This creates a heat-map effect across the transcript.

**Pros:** Dense information without taking extra space; immediately scannable.
**Cons:** Can conflict with stress highlighting colors.

### 4. Animated Karaoke-Style Playback

Add a "Play" button that replays the transcript like karaoke. Words highlight in sequence at their actual spoken timing. During pauses, nothing highlights — the playback just waits. The user *experiences* the pauses in real-time rather than reading a number.

**Pros:** Most immersive and intuitive way to feel the rhythm.
**Cons:** Not useful for static analysis; requires audio playback integration.

### 5. Sparkline / Timing Ribbon

Below each sentence, render a thin horizontal bar (a "timing ribbon") where each word is a colored segment proportional to its spoken duration, and gaps between segments represent pauses. Short pauses appear as thin gray lines; long pauses appear as wide orange blocks.

**Pros:** Compact; gives a full sentence-level rhythm overview at a glance.
**Cons:** Requires careful scaling to be readable.

### 6. Pause Histogram / Summary Chart

After the transcript, show a bar chart or histogram of all detected pauses in the recording. X-axis = pause index, Y-axis = duration. Color-code by category (micro, normal, long). This gives the user a statistical overview of their speaking fluency.

**Pros:** Great for coaching/feedback (e.g., "you had 12 pauses over 1 second").
**Cons:** Disconnected from the transcript text itself.

### 7. Inline Breathing Dots

Instead of a pill badge, show animated dots (like a typing indicator `• • •`) between words where pauses occur. More dots = longer pause (1 dot for 0.2–0.5s, 2 dots for 0.5–1.0s, 3 dots for >1.0s). The dots can have a subtle pulse animation.

**Pros:** Lightweight, visually charming, immediately readable.
**Cons:** Approximate (quantized to dot counts rather than exact duration).

### 8. Vertical Timeline Layout

Instead of paragraph-style text, render words vertically in a timeline layout (like a chat interface or subtitle track). Each word sits at its actual timestamp position on a vertical axis. Pauses appear as empty space between words. This makes the time dimension explicit.

**Pros:** Perfect for comparing timing across different recordings.
**Cons:** Poor space efficiency; impractical for long transcripts.

---

## Tech Stack

### Frontend
| Technology | Purpose |
|------------|---------|
| React (Vite) | UI framework |
| Vanilla CSS | Styling |
| RecordRTC | Audio recording |
| Web Audio API | Microphone access |
| wavesurfer.js | Waveform visualization |
| Framer Motion | Animations |

### Backend
| Technology | Purpose |
|------------|---------|
| FastAPI | HTTP/WebSocket server |
| SQLite + sqlite3 | Job queue and results storage |
| Pydantic V2 | Data validation and serialization |
| faster-whisper (CTranslate2) | ASR transcription with word timestamps |
| Silero VAD (torch.hub) | Voice activity detection for chunking |
| WhiStress (custom) | Word-level stress detection |
| librosa | Audio loading and resampling |
| ffmpeg (subprocess) | Live WebM/Opus → PCM decoding |

### Environment
- Backend typically runs in **Google Colab** (GPU) and is tunneled via **Cloudflare** (`cloudflared`).
- Frontend runs locally with `npm run dev` and connects to the tunnel URL.

---

## File Structure

```
prosody_interface/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── IdleState.jsx          # "Click to record" landing
│   │   │   ├── ListeningState.jsx     # Live recording with preview
│   │   │   ├── ProcessingState.jsx    # Progress bar during analysis
│   │   │   ├── SummaryState.jsx       # Final results with stress/pause vis
│   │   │   ├── WordTooltip.jsx        # Click-to-inspect word details
│   │   │   └── CanvasBackground.jsx   # Ambient background animation
│   │   ├── services/
│   │   │   └── useJobPolling.js       # React hook: polls GET /api/jobs/:id
│   │   ├── App.jsx                    # State machine: idle → listening → processing → summary
│   │   └── apiConfig.js               # Backend URL configuration
│   └── package.json
│
├── backend/
│   ├── main.py                  # FastAPI entry point, lifespan, model loading
│   ├── config.py                # All settings (model sizes, thresholds, paths)
│   ├── database.py              # SQLite CRUD for job queue
│   ├── schemas.py               # Pydantic models (WordResult, PhraseResult, JobResult)
│   │
│   ├── api/
│   │   ├── routes.py            # REST endpoints (POST /api/jobs, GET /api/jobs/:id)
│   │   └── websocket.py         # WebSocket handler for live audio streaming
│   │
│   ├── worker/
│   │   └── worker.py            # Background job processor (the heavy lifter)
│   │
│   ├── pipeline/
│   │   ├── asr.py               # faster-whisper wrapper (transcription)
│   │   ├── vad_chunking.py      # Silero VAD wrapper (silence-based splitting)
│   │   ├── prosody_base.py      # Abstract base class for analyzers
│   │   ├── prosody_stress.py    # WhiStress wrapper (stress detection)
│   │   ├── prosody_pause.py     # Timestamp-based pause & hesitation detection
│   │   ├── prosody_registry.py  # Plugin registry for analyzers
│   │   └── merge.py             # Merge ASR + prosody, sentence reconstruction
│   │
│   ├── models/
│   │   └── loader.py            # Loads all ML models once at startup
│   │
│   ├── vendor/
│   │   └── whistress_pkg/       # Vendored WhiStress model code + weights
│   │       ├── weights/
│   │       │   ├── classifier.pt
│   │       │   └── additional_decoder_block.pt
│   │       ├── model.py
│   │       └── whistress_client.py
│   │
│   └── requirements.txt
│
├── LLM_CONTEXT.md               # Quick-reference context for AI assistants
├── ARCHITECTURE.md              # In-depth architecture notes
└── README.md                    # This file
```

---

## Configuration Reference

All settings live in `backend/config.py`:

| Setting | Default | Description |
|---------|---------|-------------|
| `ASR_MODEL_SIZE_PREVIEW` | `medium.en` | Whisper model for live preview |
| `ASR_MODEL_SIZE_FINAL` | `medium.en` | Whisper model for final processing |
| `ASR_DEVICE` | Auto (`cuda`/`cpu`) | Inference device |
| `ASR_COMPUTE_TYPE` | Auto (`float16`/`int8`) | Quantization type |
| `WHISTRESS_DEVICE` | Auto (`cuda`/`cpu`) | WhiStress device |
| `WHISTRESS_WHISPER_BACKBONE` | `openai/whisper-small.en` | WhiStress base model |
| `SAMPLE_RATE` | `16000` | Audio normalized to 16kHz mono |
| `VAD_THRESHOLD` | `0.5` | Speech probability threshold |
| `VAD_MIN_SPEECH_MS` | `250` | Min speech segment duration |
| `VAD_MIN_SILENCE_MS` | `500` | Min silence to be a boundary |
| `VAD_TARGET_CHUNK_SEC` | `25.0` | Target chunk size |
| `VAD_MAX_CHUNK_SEC` | `29.0` | Hard max chunk size |
| `WORKER_POLL_INTERVAL_SEC` | `1.0` | How often worker checks for jobs |

---

## Running the Project

### Backend (Google Colab with GPU)
```bash
cd backend
pip install -r requirements.txt
python main.py
# Server starts at http://0.0.0.0:8000
# Tunnel with: cloudflared tunnel --url http://localhost:8000
```

### Frontend (Local)
```bash
cd frontend
npm install
npm run dev
# Update apiConfig.js with the Cloudflare tunnel URL
```

### Backend (Local, CPU-only)
```bash
cd backend
pip install -r requirements.txt
# Will auto-detect no GPU and use CPU + int8 quantization
python main.py
```
