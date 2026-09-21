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


def ensure_port_free(port: int, host: str = "0.0.0.0"):
    """
    Check if `port` is in use. If another process is holding it (e.g. from a
    previous interrupted Kaggle / Colab notebook cell run), forcefully terminate
    that process and free the socket so Uvicorn can bind cleanly without Errno 98.
    """
    import socket
    import os
    import time

    def _is_bound() -> bool:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind((host, port))
                return False
            except OSError:
                return True

    if not _is_bound():
        return

    logger.warning(f"Port {port} is occupied by another process. Freeing it now...")
    current_pid = os.getpid()

    # 1. psutil method (portable)
    try:
        import psutil
        for conn in psutil.net_connections(kind="inet"):
            if conn.laddr and conn.laddr.port == port:
                pid = conn.pid
                if pid and pid != current_pid:
                    try:
                        p = psutil.Process(pid)
                        logger.info(f"Terminating lingering process on port {port}: PID {pid} ({p.name()})")
                        p.terminate()
                        try:
                            p.wait(timeout=2)
                        except psutil.TimeoutExpired:
                            p.kill()
                            p.wait(timeout=1)
                        logger.info(f"Process {pid} terminated.")
                    except (psutil.NoSuchProcess, psutil.AccessDenied):
                        pass
    except Exception as e:
        logger.debug(f"psutil cleanup check failed: {e}")

    # 2. Linux native utilities (Kaggle / Colab)
    if sys.platform != "win32":
        try:
            import subprocess
            subprocess.run(["fuser", "-k", "-9", f"{port}/tcp"], capture_output=True, timeout=3)
        except Exception:
            pass

        try:
            import subprocess
            subprocess.run(f"kill -9 $(lsof -t -i:{port}) 2>/dev/null", shell=True, capture_output=True, timeout=3)
        except Exception:
            pass

        try:
            import subprocess
            subprocess.run(f"pkill -9 -f 'uvicorn.*{port}' 2>/dev/null", shell=True, capture_output=True, timeout=3)
        except Exception:
            pass

    # 3. Windows taskkill (if running locally on Windows)
    elif sys.platform == "win32":
        try:
            import subprocess
            out = subprocess.check_output(f"netstat -ano | findstr :{port}", shell=True, text=True)
            for line in out.strip().splitlines():
                parts = line.strip().split()
                if len(parts) >= 5 and "LISTENING" in parts:
                    pid = int(parts[-1])
                    if pid != current_pid:
                        logger.info(f"Killing Windows process {pid} on port {port}")
                        subprocess.run(f"taskkill /F /PID {pid}", shell=True, capture_output=True)
        except Exception:
            pass

    time.sleep(0.5)

    if _is_bound():
        logger.error(
            f"Port {port} is STILL occupied after cleanup! "
            f"In your Kaggle notebook, run '!fuser -k {port}/tcp' before starting the backend, "
            f"or specify a different port with 'export PORT={port + 1}'."
        )
    else:
        logger.info(f"Port {port} successfully freed and ready for binding.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """App lifespan: startup and shutdown logic."""
    global _worker, _worker_task

    # STARTUP
    logger.info("=" * 60)
    logger.info("Prosody Interface Backend — Starting Up")
    logger.info("=" * 60)

    # 0. Free port if occupied by a zombie/interrupted process from earlier notebook run
    ensure_port_free(PORT, HOST)

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
            "jobs_list": "GET /api/jobs",
            "jobs_status": "GET /api/jobs/{job_id}",
        },
    }


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "ok"}


if __name__ == "__main__":
    ensure_port_free(PORT, HOST)
    uvicorn.run(
        "main:app",
        host=HOST,
        port=PORT,
        reload=False,  # No reload in production — models are loaded once
        log_level="info",
    )
