"""
LexiRep Custom Training — API Routes

Isolated router mounted at /lexirep prefix. Does NOT touch any existing
routes or endpoints.

Endpoints:
  POST /lexirep/train-custom       — Upload dataset & start async training
  GET  /lexirep/train-status/{id}  — Poll job status
  GET  /lexirep/train-result/{id}  — Download trained model artifacts
"""

import asyncio
import io
import zipfile
import logging
import numpy as np
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse

from config import BASE_DIR
from api.lexirep_training import (
    create_train_job,
    get_train_job,
    execute_training_job,
    TrainJobStatus,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/lexirep")

# Per-job directories live here
LEXIREP_JOBS_DIR = BASE_DIR / "lexirep_jobs"
LEXIREP_JOBS_DIR.mkdir(exist_ok=True)


def _validate_csv(filepath: Path) -> tuple[bool, str]:
    """Validate that a CSV file has 768 columns (features)."""
    try:
        import csv

        with open(filepath, "r", newline="", encoding="utf-8") as f:
            reader = csv.reader(f)
            first_row = next(reader, None)
            if first_row is None:
                return False, "CSV file is empty"

            # Try to detect if first row is a header (non-numeric)
            try:
                [float(v) for v in first_row]
                # First row is numeric — treat as data
                ncols = len(first_row)
            except ValueError:
                # First row is a header — check second row
                second_row = next(reader, None)
                if second_row is None:
                    return False, "CSV file has only a header row, no data"
                ncols = len(second_row)

            if ncols < 768:
                return False, (
                    f"Expected at least 768 columns (dimensions), "
                    f"but found {ncols}"
                )
            return True, f"Valid CSV with {ncols} columns"
    except Exception as e:
        return False, f"Failed to parse CSV: {e}"


def _validate_npy(filepath: Path) -> tuple[bool, str]:
    """Validate that an NPY file contains a 2D array with 768 columns."""
    try:
        data = np.load(str(filepath), allow_pickle=False)
        if data.ndim != 2:
            return False, (
                f"Expected a 2D array, but got {data.ndim}D "
                f"with shape {data.shape}"
            )
        if data.shape[1] < 768:
            return False, (
                f"Expected at least 768 columns (dimensions), "
                f"but found {data.shape[1]}"
            )
        return True, f"Valid NPY array with shape {data.shape}"
    except Exception as e:
        return False, f"Failed to load NPY file: {e}"


@router.post("/train-custom")
async def train_custom(
    dataset: UploadFile = File(...),
    epochs: int = Form(10),
):
    """
    Upload a 768-dim dataset file and start asynchronous LexiRep training.

    Accepts: .csv or .npy files with 768-dimensional feature vectors.
    Returns: { "job_id": "...", "status": "running" } immediately.
    """
    # Validate file extension
    if not dataset.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    ext = Path(dataset.filename).suffix.lower()
    if ext not in (".csv", ".npy"):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext}'. Please upload a .csv or .npy file.",
        )

    # Create isolated per-job directory
    from api.lexirep_training import create_train_job
    import uuid

    job_id = str(uuid.uuid4())
    job_dir = LEXIREP_JOBS_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    output_dir = job_dir / "output"
    output_dir.mkdir(exist_ok=True)

    # Save uploaded file
    dataset_path = job_dir / f"dataset{ext}"
    try:
        content = await dataset.read()
        with open(dataset_path, "wb") as f:
            f.write(content)
        logger.info(
            f"[LexiRep] Saved dataset for job {job_id}: "
            f"{dataset_path} ({len(content)} bytes)"
        )
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to save uploaded file: {e}"
        )

    # Validate file structure
    if ext == ".csv":
        valid, msg = _validate_csv(dataset_path)
    else:
        valid, msg = _validate_npy(dataset_path)

    if not valid:
        # Clean up
        import shutil
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(status_code=422, detail=msg)

    logger.info(f"[LexiRep] Dataset validation passed: {msg}")

    # Clamp epochs to a sane range
    epochs = max(1, min(epochs, 100))
    logger.info(f"[LexiRep] Epochs requested: {epochs}")

    # Create job and launch async training
    job = create_train_job(dataset_path, output_dir)
    # Override job_id to match our directory
    job.job_id = job_id
    job.epochs = epochs
    from api.lexirep_training import _jobs
    _jobs[job_id] = job

    asyncio.create_task(execute_training_job(job))

    return JSONResponse(
        content={"job_id": job_id, "status": "running", "validation": msg, "epochs": epochs}
    )


@router.get("/train-status/{job_id}")
async def train_status(job_id: str):
    """
    Poll the status of a training job.

    Returns:
        { "status": "running" | "complete" | "failed",
          "error": "..." (if failed),
          "output_files": [...] (if complete) }
    """
    job = get_train_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Training job {job_id} not found")

    response = {"status": job.status.value}

    if job.status == TrainJobStatus.FAILED:
        response["error"] = job.error or "Unknown error"

    if job.status == TrainJobStatus.COMPLETE:
        response["output_files"] = job.output_files

    return JSONResponse(content=response)


@router.get("/train-result/{job_id}")
async def train_result(job_id: str):
    """
    Download the trained model artifacts as a zip file.

    Only available when job status is 'complete'.
    """
    job = get_train_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Training job {job_id} not found")

    if job.status != TrainJobStatus.COMPLETE:
        raise HTTPException(
            status_code=409,
            detail=f"Job not yet complete (status: {job.status.value})",
        )

    if not job.output_dir.exists() or not job.output_files:
        raise HTTPException(
            status_code=404, detail="No output files found for this job"
        )

    # Create a zip of all output files in memory
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for filename in job.output_files:
            filepath = job.output_dir / filename
            if filepath.exists():
                zf.write(filepath, arcname=filename)

    zip_buffer.seek(0)

    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="lexirep_model_{job_id[:8]}.zip"'
        },
    )
