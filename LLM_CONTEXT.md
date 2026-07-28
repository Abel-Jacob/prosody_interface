# Prosody Interface - LLM Context

This document is designed to give any LLM (like ChatGPT, Claude, etc.) a complete understanding of this project's architecture, technologies, data flow, and current state. If you are an AI reading this, use this as your ultimate source of truth for the codebase.

## 1. Project Overview
**Prosody Interface** is a real-time web application that records user speech, provides a live transcription preview, and then analyzes the speech to detect prosody features—specifically word-level stress (emphasis) and pauses (silences between words). 

## 2. Tech Stack
### Frontend
- **Framework:** React (via Vite)
- **Styling:** Vanilla CSS (CSS Modules / standard CSS)
- **Audio Recording:** RecordRTC, Web Audio API
- **Real-time Comms:** `socket.io-client`
- **Visualization:** `wavesurfer.js` (for audio waveforms)

### Backend
- **Framework:** FastAPI (Python)
- **Real-time Comms:** `python-socketio` (async)
- **Database:** SQLite (using SQLAlchemy ORM)
- **Machine Learning / Audio Processing:**
  - **ASR (Transcription):** `faster-whisper` (CTranslate2 backend)
  - **VAD (Voice Activity Detection):** Silero VAD (via `torch.hub`)
  - **Stress Detection:** `WhiStress` (custom HuggingFace transformers model)
  - **Audio manipulation:** `numpy`, `librosa`

### Environment
- The backend is often run in Google Colab (with a GPU) and tunneled to the public web via Cloudflare tunnels (`cloudflared`).

## 3. Data Flow & Architecture

### A. Live Audio Streaming
1. **Frontend:** User clicks "Start Recording". The browser uses `RecordRTC` to capture audio.
2. Every 1 second (or specified interval), the frontend takes the audio slice and emits it via Socket.IO (`audio_chunk` event).
3. **Backend (`stream_handler.py`):** Receives the chunk, standardizes the sample rate to 16kHz mono, and pushes it into an in-memory buffer (`audio_buffer[session_id]`).

### B. Background Processing (The Worker)
The backend has an asynchronous background worker (`worker.py`) that constantly monitors the `audio_buffer`.
1. **VAD Chunking:** The worker uses Silero VAD to detect whether someone is speaking or if there is silence.
2. **Boundary Detection:** It accumulates audio until a silence threshold is met (e.g., 1.5 seconds of silence). This boundary indicates a complete "utterance".
3. **ASR (Transcription):** The utterance is passed to `faster-whisper` to get the word-level transcription (including word start and end timestamps).
4. **Prosody Pipeline:** The transcription and audio are passed to the Prosody Analyzers (`pipeline/prosody_base.py`).
   - `StressAnalyzer`: Uses WhiStress to assign a stress score (0.0 to 1.0) and boolean flag to each word.
   - `PauseAnalyzer`: Uses the timestamps of the words to calculate `pause_before` and `pause_after` for each word.
5. **Database:** The final results are saved to SQLite via `database.py`.
6. **Client Notification:** The worker emits a `chunk_completed` Socket.IO event back to the client with the final text, stress data, and pause data.

### C. Live Preview
While the worker is waiting for a silence boundary, it periodically runs a smaller "preview" ASR model on the currently accumulating audio and emits `transcription_update` to the frontend, giving the user a live view of what they are saying before the final analysis is done.

## 4. Database Schema (`schemas.py` & `database.py`)
- **Record:** Represents a single recording session (has `id`, `session_id`, `created_at`).
- **AudioChunk:** Represents a single utterance/chunk within a session (has `id`, `recording_id`, `final_text`, `status`, `start_time`, `end_time`).
- **WordLevelData:** Represents a single word in a chunk (has `id`, `chunk_id`, `word`, `start_time`, `end_time`, `confidence`, `stress_score`, `is_stressed`, `pause_before`, `is_pause_after`).

## 5. File Structure
```
prosody_interface/
├── frontend/
│   ├── src/
│   │   ├── components/       # React components (AudioRecorder, Transcript, etc.)
│   │   ├── App.jsx           # Main React App
│   │   ├── apiConfig.js      # WebSocket/HTTP endpoints
│   │   └── ...
├── backend/
│   ├── main.py               # FastAPI entry point, socket handlers
│   ├── worker.py             # Background asyncio loop for VAD & Prosody
│   ├── database.py           # DB connection, CRUD ops
│   ├── schemas.py            # SQLAlchemy models
│   ├── models/
│   │   └── loader.py         # Loads ASR, VAD, and Stress models into memory
│   ├── pipeline/
│   │   ├── asr.py            # faster-whisper wrapper
│   │   ├── vad_chunking.py   # Silero VAD wrapper
│   │   ├── prosody_base.py   # Base class for analyzers
│   │   ├── stress.py         # StressAnalyzer (WhiStress)
│   │   └── pause.py          # PauseAnalyzer (calculates silences)
│   ├── vendor/               # Third-party models (e.g. WhiStress logic)
│   └── requirements.txt      # Python dependencies
├── LLM_CONTEXT.md            # This file
├── README.md                 # Basic overview for humans
└── ARCHITECTURE.md           # In-depth logic overview
```

## 6. Recent Updates
- **Pause Integration:** The backend now fully tracks pauses. It computes `pause_before` (float duration of silence before the word) and `is_pause_after` (boolean, if there is a significant pause after). These are saved in the database under `WordLevelData` and sent to the frontend.

## 7. How to Work on This Project
- **Frontend changes:** Usually involve editing components in `frontend/src/`. To test, run `npm run dev`.
- **Backend changes:** Usually involve editing `worker.py` or the `pipeline/` modules. To test, run `uvicorn main:app --reload`.
- **Database changes:** If you change `schemas.py`, you must update the database. (Currently, the DB is deleted/recreated on startup `Base.metadata.create_all`, or migrations can be added).
- **Colab:** The production-like environment runs the backend via Ngrok/Cloudflared in Colab for GPU access, while the frontend runs locally and connects to the tunnel URL.
