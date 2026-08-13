# Prosody Interface — Architecture

## Overview

A real-time-feeling (but backend-decoupled) Speech-to-Text + Prosody 
Analysis web app. Records speech in the browser, streams live-preview 
transcription via WebSocket, then offloads full analysis to a background 
job queue for reliable processing of any-length audio on constrained 
hardware (Intel i5-8365U, 8GB RAM, no GPU).

## Why a Job Queue?

Previous attempts ran ASR + prosody inference synchronously inside the 
WebSocket handler. This caused:

1. **Hangs on long audio (>30s)**: The event loop blocked for minutes 
   while ML inference ran, causing WebSocket timeouts and frozen UI.
2. **No progress feedback**: Users saw a blank screen with no indication 
   of progress.
3. **Unrecoverable failures**: If any part of the pipeline failed, the 
   entire recording was lost with no partial results.

The job queue architecture solves all three:

- **Decoupled processing**: The WebSocket handler returns immediately 
  with a `job_id`. Heavy work happens in a separate background worker.
- **Real progress**: The worker updates progress in SQLite after each 
  chunk. The frontend polls a REST endpoint for real values.
- **Fault tolerance**: If a chunk fails, the worker logs the error and 
  continues with remaining chunks — partial results are better than 
  total failure.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│  BROWSER                                                         │
│                                                                  │
│  ┌──────────┐  audio chunks   ┌──────────────┐                  │
│  │ Mic API  │────────────────>│  WebSocket   │  live preview     │
│  └──────────┘                 │  Handler     │<─ ─ ─ ─ ─ ─ ─   │
│                               └──────┬───────┘                   │
│  STOP ──────────────────────────────>│                           │
│                                      │ job_id                    │
│  ┌──────────┐  GET /jobs/{id}  ┌─────┴────────┐                 │
│  │ Polling  │<────────────────>│  REST API    │                  │
│  │ Hook     │  {progress,...}  └──────────────┘                  │
│  └──────────┘                                                    │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  BACKEND (FastAPI)                                               │
│                                                                  │
│  WebSocket Handler ─── saves audio to disk ──> audio_uploads/    │
│       │                                                          │
│       └── INSERT job (status=queued) ──> ┌──────────┐           │
│                                          │ SQLite   │           │
│  Background Worker (single thread) <──── │ jobs.db  │           │
│       │                                  └──────────┘           │
│       │  For each queued job:                                    │
│       │  1. Load audio from disk                                 │
│       │  2. VAD chunk at silence boundaries                      │
│       │  3. For each chunk:                                      │
│       │     a. ASR (faster-whisper)                              │
│       │     b. Stress detection (WhiStress)                      │
│       │     c. Update progress in SQLite                         │
│       │     d. Free chunk memory                                 │
│       │  4. Merge all chunk results                              │
│       │  5. Mark job complete                                    │
│       │                                                          │
│  Models loaded ONCE at startup:                                  │
│  - faster-whisper base.en (ASR)                                  │
│  - WhiStress small (stress detection)                            │
│  - Silero VAD (chunking)                                         │
└─────────────────────────────────────────────────────────────────┘
```

## Processing Pipeline Detail

```
Full Audio File
      │
      ▼
┌─────────────┐
│  Silero VAD │──> Chunk 1 (silence boundary)
│  Chunking   │──> Chunk 2 (silence boundary)
│             │──> Chunk 3 (silence boundary)
│             │──> ...
└─────────────┘
      │
      ▼ (for each chunk, sequentially)
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│ ASR         │────>│ Stress       │────>│ Merge       │
│ (faster-    │     │ (WhiStress)  │     │ Results     │
│  whisper)   │     │              │     │ + offset    │
└─────────────┘     └──────────────┘     └─────────────┘
      │                    │                    │
      ▼                    ▼                    ▼
  word-level          stress labels        cumulative
  timestamps          per word             time_offset
  + confidence                             alignment
```

## Hardware Constraints (Design Non-Negotiables)

| Constraint | Design Response |
|-----------|----------------|
| No GPU | All inference on CPU; use `faster-whisper` (CTranslate2) not `openai-whisper` |
| 4 cores / 8 threads | Never run >1 model inference concurrently |
| 8GB RAM | Free chunk memory after each chunk; small model sizes only |
| Laptop CPU throttling | Job queue means processing can take as long as needed without hanging UI |

## Model Stack

| Model | Purpose | Size | Loaded By |
|-------|---------|------|-----------|
| faster-whisper `base.en` | Live preview transcription | ~150MB | Worker startup |
| faster-whisper `medium.en` | Final full transcription | ~1.5GB | Worker startup |
| WhiStress | Stress/emphasis detection | ~42MB custom weights + whisper-small.en backbone | Worker startup |
| Silero VAD | Silence boundary detection | ~2MB | Worker startup |

## Extensibility: Prosody Modules

All prosody analysis modules implement `ProsodyAnalyzer` (defined in 
`pipeline/prosody_base.py`):

```python
class ProsodyAnalyzer(ABC):
    name: str
    
    @abstractmethod
    def analyze(self, audio_chunk: np.ndarray, words: list[dict]) -> dict:
        """Analyze a chunk and return feature dict."""
        ...
```

Current modules:
- `prosody_stress.py` — WhiStress-based stress detection
- `prosody_pause.py` — Pause and hesitation detection based on ASR timestamps and silence gaps
- `prosody_pitch.py` — Intonation and pitch stylization (F0 extraction via SWIPE + Mean Absolute Error DP polynomial fitting)

Planned future modules (designed to slot in without touching existing code):
- Rhythm via inter-word timing statistics from ASR timestamps — pure computation

## Frontend State Machine

```
IDLE ──(click/space)──> LISTENING ──(click/space/stop)──> QUEUED
                                                            │
                                                     (poll /jobs/{id})
                                                            │
                                                        PROCESSING
                                                            │
                                                     (status=complete)
                                                            │
                                                        SUMMARY
                                                            │
                                                  (click "new session")
                                                            │
                                                          IDLE
```

## File Structure

See `implementation_plan.md` for complete directory tree.

## Key Decisions Log

1. **Silero VAD over webrtcvad**: Better boundary detection accuracy, 
   tiny model (~2MB), worth the small PyTorch dependency we already have.
2. **SQLite over Redis/Postgres**: Zero infrastructure, single file, 
   perfect for single-machine deployment.
3. **Polling over SSE/WebSocket for progress**: Simpler, more reliable, 
   1-2s polling interval is perfectly fine for a progress bar.
4. **Vendored WhiStress**: Copied as-is from the original repo, clearly 
   separated in `vendor/` to avoid accidental modification.
5. **Pitch DP Optimization (O(1) prefix sums)**: The raw MAE DP pitch stylization took minutes due to O(N^3) array allocations in the inner loop. Using pre-computed cumulative sums reduced this to purely scalar math, making it run in seconds.
6. **Model Deduplication**: ASR model sizes configured similarly (e.g. `medium.en` for preview and final) are loaded exactly once and shared by reference, saving ~1.5GB VRAM and cutting startup time significantly.
7. **SWIPE vs PYIN Pitch Divergence**: The production pipeline extracts pitch using SWIPE (via `pysptk.sptk.swipe` or `libf0.swipe` fallback), whereas the reference notebook implementation historically used `librosa.pyin`. Because SWIPE and PYIN are fundamentally different algorithms, their voiced segment boundaries and count (6 segments vs 5 segments on the 2.74s reference audio) permanently diverge. This is a known, expected architectural behavior and should not be treated as a bug.

