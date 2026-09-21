# Prosody Interface

> Real-time speech transcription, multi-tier prosody analysis (word stress, syllable stress, pitch stylization, pause dynamics), and unsupervised lexical stress model training.

---

## Key Features & Capabilities

### 1. Live Recording & Real-Time Streaming
- **Low-Latency Preview**: Streams 1-second WebM audio chunks over WebSocket (`/api/ws/audio`).
- **On-the-Fly Decoding & ASR**: Pipes audio through a persistent FFmpeg PCM decoder with sliding-window `faster-whisper` greedy transcription and real-time word emphasis display.
- **Seamless Finalization**: Automatically saves and queues the completed recording for deep multi-pass analysis.

### 2. Multi-Tier Prosody Analysis Pipeline
- **Word-Level Stress (WhiStress)**: Pretrained Whisper-small backbone with an emphasis classification head to detect accented/prominent words.
- **Syllable-Level Stress (LexiRep)**:
  - Automatically syllabifies words using `pyphen` (US/GB dictionaries).
  - Extracts 768-D contextualized representations via `Wav2Vec 2.0` per syllable.
  - Projects through a 5-layer MLP encoder to 10-D latent space and applies cosine prototype classification with linguistic BTQ constraints (exactly 1 primary stress per polysyllabic word).
  - Pretrained checkpoints included: **FUSED** (multilingual), **GER** (German), and **ITA** (Italian).
- **Pitch Stylization & Declination (MAE Algorithm)**:
  - Sub-harmonic SWIPE pitch tracking (`pysptk` / `libf0`).
  - L1 Minimum Absolute Error (MAE) polygonal line stylization solved via HiGHS Linear Programming (`scipy.optimize.linprog`).
  - Computes word-level pitch slope (rising, falling, flat) and phrase declination.
- **Pause & Vocalized Hesitation Detection**:
  - Sub-100ms precision pause tracking calculated from Whisper word boundary gaps.
  - Detects vocalized fillers ("um", "uh", "ah") and optionally absorbs their duration into preceding pauses.

### 3. Interactive Visualization & Exploration
- **Word Details & Tooltips**: Click any word to inspect exact start/end timestamps, confidence, pitch contour, and pause intervals.
- **Syllable Bokeh**: Visual syllable breakdown showing stress labels, model confidence, and primary stress assignments.
- **Audio Playback Sync**: Integrated waveform audio player synchronized with text selection.

### 4. Batch Audio Annotation & Export Center
- **Single & Multi-File ZIP Uploads**: Upload individual `.wav`/`.mp3`/`.webm` or ZIP archives (up to 50 files) for background processing.
- **Editorial Annotation Report**: Search, filter, inspect, and play individual file annotations with summary metrics (WPM, stress ratio, total duration).
- **One-Click Exports**:
  - **Batch Combined JSON**: All transcripts and detailed word/syllable/pitch metrics in one file.
  - **Batch Transcripts TXT**: Clean, aggregated text transcripts.
  - **Batch ZIP Archive**: Individual JSON and TXT reports per audio file.
  - **Per-File CSV/JSON/TXT**: Granular exports for phonetic research pipelines.

### 5. Custom LexiRep Training Suite
- **In-Browser Model Training**: Upload custom 768-dim syllable datasets (`.csv` or `.npz`) to train new LexiRep models directly from the web interface.
- **Unsupervised Optimization**:
  - Offline anchor word selection via acoustic separation.
  - Iterative Deep Embedded Clustering (IDEC) + Supervised Contrastive Learning (SupCon).
  - Majority-voting polarity calibration with cluster-specific prototype extraction.
- **Live Scorecards & Artifacts**: Live progress metrics (B, BT, BTQ accuracy) with instant download of trained `.pt` model weights, `.npz` caches, and full bundle archives.

---

## LexiRep Training: Custom Syllable Stress Models

The platform includes an end-to-end unsupervised training suite to train new syllable-level lexical stress encoders on **any language or custom speech dataset** without requiring manual ground-truth phonetic annotations.

### 1. Accepted Dataset Formats
- **Transposed ISLE CSV**: 770 rows — Row 0: `word_id`, Row 1: `label` (0/1 or empty), Rows 2–769: 768-D Wav2Vec 2.0 features. Columns represent individual syllables.
- **Row-Based CSV**: Standard CSV with `word_id`, optional `label`, and 768 feature columns (`feat_0`...`feat_767` or `f0`...`f767`).
- **Precomputed Binary NPZ**: Fast `.npz` archive containing `X_tr`, `Y_tr`, `W_tr`, `X_te`, `Y_te`, `W_te` arrays for instant loading.

### 2. Under the Hood: 5-Stage Unsupervised Engine

```
[Uploaded CSV / NPZ Dataset]
             │
             ▼
1. Word-Isolated 80/20 Split ──► Zero word leakage between train & test sets
             │
             ▼
2. Offline Anchor Selection  ──► Scans polysyllabic words for maximal acoustic separation
             │
             ▼
3. Autoencoder Warmup        ──► 5 epochs pre-training 768→128→64→32→16→10→768
             │
             ▼
4. Iterative Refinement Loop (1 to 10 loops)
   ├── A. KMeans Re-init     ──► Recalibrates cluster centers to prevent drift
   ├── B. IDEC Clustering    ──► 100 mini-batch steps with Student-t distribution
   ├── C. Polarity Voting    ──► Majority voting + 3-level tie-break (stressed vs unstressed)
   ├── D. SupCon Fine-Tuning ──► Supervised contrastive learning on word-grouped batches
   └── E. Prototype Extract  ──► Cluster-specific latent prototypes (z_s_h, z_u_h)
             │
             ▼
5. Evaluation & Export       ──► Peak accuracy tracking (B, BT, BTQ) & .pt/.zip artifacts
```

- **Accuracy Metrics**:
  - **B (Binary)**: Raw cosine prototype assignment.
  - **BT (Binary + Tie-break)**: Polarity-calibrated assignment.
  - **BTQ (Binary + Tie-break + Quinquennial Constraint)**: Strictly enforces linguistic constraint of exactly **one primary stress per polysyllabic word** (reaches **80.7%+ BTQ** unsupervised).

### 3. How to Train a Model

#### Method A: Interactive Web UI
1. Click the **LexiRep** card on the home screen (or navigate to `/train`).
2. Drag & drop your `.csv` or `.npz` dataset. The UI automatically validates structure and displays row/column counts.
3. Select training loops (slider: 1 to 10, default: 5).
4. Click **Start Training** — watch live real-time loop progress and metric curves.
5. Download your artifacts:
   - `final_lexirep_model.pt` — Standalone PyTorch checkpoint.
   - `model_weights.pt` — PyTorch state dict.
   - `dataset_cache.npz` — Preprocessed, cached binary dataset for instant re-training.
   - `lexirep_bundle.zip` — Complete archive with weights, config, and plots.

#### Method B: REST API
- **Start Training**:
  ```bash
  curl -X POST http://localhost:8000/lexirep/train-custom \
    -F "file=@my_dataset.csv" \
    -F "total_loops=5"
  # Returns: {"job_id": "...", "status": "queued"}
  ```
- **Poll Progress**:
  ```bash
  curl http://localhost:8000/lexirep/train-status/{job_id}
  # Returns: current_loop, stage, logs, latest_btq
  ```
- **Download Trained Checkpoint**:
  ```bash
  curl -O http://localhost:8000/lexirep/train-result/{job_id}?file=final_lexirep_model.pt
  ```

---

## Primary Use Cases

| Use Case | Description |
|---|---|
| **Linguistic & Phonetic Research** | Extract empirical word stress, syllable prominence, pitch slopes, and silence durations without manual Praat alignment. |
| **Language Learning (L2 Acquisition)** | Provide non-native speakers visual feedback on rhythm, emphasis, and syllable stress patterns. |
| **Speech Coaching & Fluency Analysis** | Track speaking rate (WPM), hesitation frequencies, and pausing patterns for presentation and vocal training. |
| **Low-Resource Language Adaptation** | Train custom syllable-level stress encoders on novel language corpora without phonetic ground-truth labels. |
| **Bulk Audio Corpus Annotation** | Process hundreds of audio files asynchronously and export structured JSON/CSV datasets. |

---

## Architecture Overview

```
                      ┌──────────────────────────────────────────────┐
                      │              FRONTEND (React + Vite)         │
                      │  LandingPage ──┬── Prosody Interface (Audio) │
                      │                └── LexiRep Trainer (Models)  │
                      └──────────────────────┬───────────────────────┘
                                             │ HTTP / WebSocket (WSS)
                                             ▼
                      ┌──────────────────────────────────────────────┐
                      │            BACKEND (FastAPI / Uvicorn)       │
                      │  • REST API (Upload, Jobs, LexiRep, Exports) │
                      │  • WebSocket Handler (1s Opus audio chunks)  │
                      │  • SQLite Job Queue & Status Polling         │
                      └──────────────────────┬───────────────────────┘
                                             ▼
                      ┌──────────────────────────────────────────────┐
                      │              PROCESSING PIPELINE             │
                      │  1. faster-whisper  ──► Word Timestamps      │
                      │  2. WhiStress       ──► Word-Level Stress    │
                      │  3. Wav2Vec + MLP   ──► Syllable LexiRep     │
                      │  4. SWIPE + HiGHS   ──► MAE Pitch Contours   │
                      │  5. Pause Math      ──► Silence Gaps & Um/Uh │
                      └──────────────────────────────────────────────┘
```

---

## Directory Layout

```text
prosody_interface/
├── frontend/                # React (Vite) UI application
│   ├── src/
│   │   ├── components/      # Audio recording, reports, syllable bokeh, training page
│   │   ├── services/        # Polling & WebSocket client hooks
│   │   └── apiConfig.js     # Configurable backend domain resolver
├── backend/                 # Full research & development backend
│   ├── api/                 # FastAPI routes (audio upload, jobs, WebSocket, LexiRep)
│   ├── pipeline/            # ASR, WhiStress, LexiRep, SWIPE/MAE pitch, VAD modules
│   ├── models/              # Model loaders & caching
│   ├── vendor/              # Vendored WhiStress weights and inference client
│   ├── worker/              # Background queue processor
│   └── config.py            # Central configuration & paths
├── server/                  # Standalone 42 MB production server package
│   ├── checkpoints/         # Pretrained LexiRep models (fused, ger, ita)
│   ├── start_server.sh      # One-click Linux launch script
│   └── README.md            # Production deployment & 24/7 service guide
```

---

## Quickstart

### 1. Local Development (Frontend)

```bash
cd frontend
npm install
npm run dev
# App opens at http://localhost:5173
```

### 2. Local Backend

```bash
cd server
python -m venv venv

# Windows:
venv\Scripts\activate
# Linux/macOS:
source venv/bin/activate

# Install PyTorch (matching CPU or CUDA):
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu

# Install remaining dependencies:
pip install -r requirements.txt

# Run server:
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

### 3. Production Deployment (Remote Work Server + Vercel)

The `server/` directory is completely self-contained (42.5 MB) and ready for headless 24/7 remote deployment:
1. Copy `server/` to your remote work server.
2. Run `./start_server.sh` or configure as a `systemd` background service.
3. Expose over HTTPS via Cloudflare Tunnel or Ngrok.
4. Add your domain to Vercel (`VITE_BACKEND_DOMAIN = your-tunnel.ngrok-free.app`) and redeploy.

*(For detailed production instructions, see [server/README.md](server/README.md).)*

---

## Core Configuration Reference

Settings can be customized via `.env` or environment variables:

| Variable | Default | Description |
|---|---|---|
| `HOST` | `0.0.0.0` | Server bind address |
| `PORT` | `8000` | Server port |
| `CORS_ORIGINS` | `*` | Allowed CORS origins (e.g. Vercel domain) |
| `ASR_DEVICE` | Auto (`cuda`/`cpu`) | Hardware accelerator for Whisper |
| `ASR_MODEL_SIZE_FINAL` | `medium.en` / `base.en` | Whisper model accuracy tier |
| `WHISTRESS_DEVICE` | Auto (`cuda`/`cpu`) | Hardware accelerator for WhiStress |
| `MAX_SINGLE_AUDIO_MB` | `100` | Maximum upload size for single audio files |
| `MAX_ZIP_UPLOAD_MB` | `250` | Maximum upload size for batch ZIP archives |
| `MAX_BATCH_FILE_COUNT`| `50` | Maximum file count in a single batch archive |
| `MAX_DATASET_MB` | `500` | Maximum dataset size for LexiRep custom training |
