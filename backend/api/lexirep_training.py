"""
LexiRep Custom Training — Job State Management & Training Stub

This module manages per-user training jobs and provides the plug-in point
for the actual LexiRep training code. When the real training code is
provided, ONLY the body of `run_lexirep_training()` needs to change —
everything else (async job management, API routes, frontend) works unchanged.
"""

import asyncio
import logging
import traceback
import uuid
from pathlib import Path
from dataclasses import dataclass, field
from typing import Optional
from enum import Enum

logger = logging.getLogger(__name__)


class TrainJobStatus(str, Enum):
    RUNNING = "running"
    COMPLETE = "complete"
    FAILED = "failed"


@dataclass
class TrainJob:
    job_id: str
    status: TrainJobStatus
    dataset_path: Path
    output_dir: Path
    epochs: int = 10
    error: Optional[str] = None
    output_files: list = field(default_factory=list)


# ── In-memory job store (isolated per job_id) ──────────────────
_jobs: dict[str, TrainJob] = {}


def get_train_job(job_id: str) -> Optional[TrainJob]:
    """Retrieve a training job by ID."""
    return _jobs.get(job_id)


def create_train_job(dataset_path: Path, output_dir: Path) -> TrainJob:
    """Create and register a new training job."""
    job_id = str(uuid.uuid4())
    job = TrainJob(
        job_id=job_id,
        status=TrainJobStatus.RUNNING,
        dataset_path=dataset_path,
        output_dir=output_dir,
    )
    _jobs[job_id] = job
    return job


# ══════════════════════════════════════════════════════════════════
# PLUG-IN POINT: Replace ONLY this function body when the real
# LexiRep training code is provided. The function signature and
# contract must stay the same.
#
# Contract:
#   - dataset_path: Path to the uploaded 768-dim dataset file (CSV or NPY)
#   - output_dir:   Directory where trained model files should be written
#   - The function should write all output artifacts (model weights, etc.)
#     into output_dir. The download endpoint serves everything in that dir.
#   - Raise any exception on failure — the caller will catch it.
# ══════════════════════════════════════════════════════════════════

def run_lexirep_training(dataset_path: Path, output_dir: Path, epochs: int = 10) -> None:
    """
    Run the full LexiRep training pipeline on the provided 768-dim dataset.

    This is a SYNCHRONOUS, blocking function. It will be called inside
    asyncio.to_thread() so it doesn't block the event loop.

    Parameters:
        dataset_path: Path to the uploaded 768-dim dataset file (CSV or NPY)
        output_dir:   Directory where trained model files should be written
        epochs:       Number of training epochs (configurable from the UI)

    When the real LexiRep code is provided, replace this body with:
        from lexirep import train  # or whatever the import is
        train(dataset_path, output_dir, epochs=epochs)

    For now, raises NotImplementedError.
    """
    raise NotImplementedError(
        "LexiRep training code not yet integrated. "
        "Replace the body of run_lexirep_training() in "
        "api/lexirep_training.py when the training code is provided."
    )


# ── Async wrapper that manages job state ───────────────────────

async def execute_training_job(job: TrainJob) -> None:
    """
    Run training in a background thread, updating job state on
    completion or failure. Called as a fire-and-forget asyncio task.
    """
    try:
        logger.info(f"[LexiRep] Starting training job {job.job_id}")
        logger.info(f"[LexiRep]   Dataset: {job.dataset_path}")
        logger.info(f"[LexiRep]   Output:  {job.output_dir}")
        logger.info(f"[LexiRep]   Epochs:  {job.epochs}")

        # Run blocking training in a thread so we don't block the event loop
        await asyncio.to_thread(
            run_lexirep_training,
            job.dataset_path,
            job.output_dir,
            job.epochs,
        )

        # Collect output files
        if job.output_dir.exists():
            job.output_files = [
                f.name for f in job.output_dir.iterdir() if f.is_file()
            ]

        job.status = TrainJobStatus.COMPLETE
        logger.info(
            f"[LexiRep] Job {job.job_id} completed. "
            f"Output files: {job.output_files}"
        )

    except NotImplementedError as e:
        job.status = TrainJobStatus.FAILED
        job.error = str(e)
        logger.warning(f"[LexiRep] Job {job.job_id} — training not yet integrated: {e}")

    except Exception as e:
        job.status = TrainJobStatus.FAILED
        job.error = f"{type(e).__name__}: {e}"
        logger.error(
            f"[LexiRep] Job {job.job_id} failed: {e}\n"
            f"{traceback.format_exc()}"
        )
