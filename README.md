# Prosody Interface

Real-time Speech-to-Text + Prosody Analysis web application with a 
job-queue architecture 

## Quick Start

### Backend
```bash
cd backend
python -m venv venv
venv\Scripts\activate        # Windows
pip install -r requirements.txt
python main.py
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for full design documentation.

## Tech Stack

- **Backend**: FastAPI, SQLite, faster-whisper, WhiStress, Silero VAD
- **Frontend**: React, Vite, Framer Motion
