"""
Prosody Interface Backend — Application Entry Point

Startup sequence:
1. Initialize SQLite database (create tables if needed)
2. Load ALL models once (ASR, VAD, WhiStress)
3. Start the background worker task
4. Mount API routes and WebSocket handlers
5. Start FastAPI/Uvicorn server

The worker runs as an asyncio background task, completely decoupled from
the request handling path.
"""

import asyncio
import logging
import sys
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import HOST, PORT, CORS_ORIGINS
from database import init_db
from models.loader import load_all_models
from worker.worker import Worker
from api.routes import router as api_router
from api.websocket import router as ws_router
from api.lexirep_routes import router as lexirep_router

# ── Logging ────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

# ── Global state ───────────────────────────────────────────────
_worker: Worker | None = None
_worker_task: asyncio.Task | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """App lifespan: startup and shutdown logic."""
    global _worker, _worker_task

    # STARTUP
    logger.info("=" * 60)
    logger.info("Prosody Interface Backend — Starting Up")
    logger.info("=" * 60)

    # 1. Init database
    logger.info("Initializing database...")
    init_db()

    # 2. Load all models ONCE
    logger.info("Loading models (this may take a minute on first run)...")
    from models.loader import load_all_models, warmup_models
    models = load_all_models()
    warmup_models(models)
    app.state.models = models

    # 3. Start background worker
    _worker = Worker(models)
    _worker_task = asyncio.create_task(_worker.run())
    logger.info("Background worker started")

    logger.info("=" * 60)
    logger.info(f"Server ready at http://{HOST}:{PORT}")
    logger.info("=" * 60)

    yield  # App is running

    # SHUTDOWN
    logger.info("Shutting down...")
    if _worker:
        _worker.stop()
    if _worker_task:
        _worker_task.cancel()
        try:
            await _worker_task
        except asyncio.CancelledError:
            pass
    logger.info("Shutdown complete")


# ── App ────────────────────────────────────────────────────────
app = FastAPI(
    title="Prosody Interface API",
    description="Speech-to-Text + Prosody Analysis with Job Queue Architecture",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS for frontend dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount routes
app.include_router(api_router)
app.include_router(ws_router)
app.include_router(lexirep_router)


@app.get("/")
async def root():
    """Root endpoint for easy verification when opening the Ngrok URL in a browser."""
    return {
        "status": "ok",
        "message": "Prosody Interface Backend is running and ready!",
        "version": "1.0.0",
        "endpoints": {
            "health": "/health",
            "websocket": "/api/ws/audio",
            "jobs_create": "POST /api/jobs",
            "jobs_status": "GET /api/jobs/{job_id}",
        },
    }


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "ok"}


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=HOST,
        port=PORT,
        reload=False,  # No reload in production — models are loaded once
        log_level="info",
    )
