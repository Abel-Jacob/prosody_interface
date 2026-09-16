"""
LexiRep Custom Training — API Routes

Isolated router mounted at /lexirep prefix.

Endpoints:
  POST /lexirep/train-custom        — Upload dataset (.npz or .csv) & start async training
  POST /lexirep/convert-csv         — Convert uploaded CSV to an optimized .npz cache
  GET  /lexirep/train-status/{id}   — Poll job status & live training loop metrics
  GET  /lexirep/train-result/{id}   — Download trained model (.pt), weights, or full zip bundle
"""

import asyncio
import io
import zipfile
import logging
from typing import Optional
import numpy as np
import pandas as pd
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Query
from fastapi.responses import JSONResponse, StreamingResponse, FileResponse

from config import BASE_DIR
from api.lexirep_training import (
    create_train_job,
    get_train_job,
    execute_training_job,
    parse_and_convert_csv,
    TrainJobStatus,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/lexirep")

# Per-job directories live here
LEXIREP_JOBS_DIR = BASE_DIR / "lexirep_jobs"
LEXIREP_JOBS_DIR.mkdir(exist_ok=True)


def _validate_npz(filepath: Path) -> tuple[bool, str]:
    """Validate that an NPZ file contains valid 768-D representation arrays."""
    try:
        data = np.load(str(filepath))
        keys = list(data.keys())
        if "X_tr" in data and "X_te" in data:
            shape_tr = data["X_tr"].shape
            shape_te = data["X_te"].shape
            if len(shape_tr) != 2 or shape_tr[1] < 768:
                return False, f"Expected X_tr to have 768 feature dimensions, got shape {shape_tr}"
            return True, f"Optimized NPZ Cache: {shape_tr[0]} train + {shape_te[0]} test samples (768-D)"
        elif "X" in data:
            shape = data["X"].shape
            if len(shape) != 2 or shape[1] < 768:
                return False, f"Expected X to have 768 feature dimensions, got shape {shape}"
            return True, f"NPZ Dataset: {shape[0]} samples (768-D features)"
        else:
            return False, f"NPZ file missing required keys. Found keys: {keys}. Expected ('X_tr', 'X_te') or ('X')"
    except Exception as e:
        return False, f"Failed to parse NPZ file: {e}"


def _validate_csv(filepath: Path) -> tuple[bool, str]:
    """
    Validate that a CSV file has 768 feature dimensions.
    Supports both:
    1. Transposed format (rows ~ 770, cols = samples)
    2. Columnar format (cols >= 768, rows = samples)
    """
    try:
        df_head = pd.read_csv(filepath, nrows=5, header=None)
        
        # Check if it has >= 768 columns
        if df_head.shape[1] >= 768:
            # Let's count total lines for feedback
            with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                total_lines = sum(1 for _ in f)
            return True, f"CSV format: ~{total_lines} rows × {df_head.shape[1]} columns (auto-converts to .npz)"

        # Check transposed format (768 to 775 rows)
        # Read first 10 columns only
        df_transposed = pd.read_csv(filepath, usecols=list(range(min(10, df_head.shape[1]))), header=None)
        if df_transposed.shape[0] in (768, 769, 770, 771, 772):
            return True, f"Transposed ISLE CSV format: {df_transposed.shape[0]} feature rows (auto-converts to .npz)"

        return False, f"CSV format unrecognized. Expected at least 768 columns or ~770 rows (transposed), got {df_head.shape[1]} cols × {df_transposed.shape[0]} rows"
    except Exception as e:
        return False, f"Failed to parse CSV: {e}"


def _validate_npy(filepath: Path) -> tuple[bool, str]:
    """Validate that an NPY file contains a 2D array with 768 columns."""
    try:
        data = np.load(str(filepath), allow_pickle=False)
        if data.ndim != 2:
            return False, f"Expected 2D array, got {data.ndim}D (shape: {data.shape})"
        if data.shape[1] < 768:
            return False, f"Expected at least 768 feature columns, found {data.shape[1]}"
        return True, f"NPY array: {data.shape[0]} samples × {data.shape[1]} features"
    except Exception as e:
        return False, f"Failed to load NPY file: {e}"


@router.post("/train-custom")
async def train_custom(
    dataset: UploadFile = File(...),
    epochs: int = Form(13),
):
    """
    Upload a 768-dim dataset file (.npz or .csv) and start asynchronous LexiRep training.
    """
    if not dataset.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    ext = Path(dataset.filename).suffix.lower()
    if ext not in (".npz", ".csv", ".npy"):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext}'. Please upload a .npz cache file (recommended) or .csv.",
        )

    # Create isolated per-job directory
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
        logger.info(f"[LexiRep] Saved dataset for job {job_id}: {dataset_path} ({len(content)} bytes)")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save uploaded file: {e}")

    # Validate file structure
    if ext == ".npz":
        valid, msg = _validate_npz(dataset_path)
    elif ext == ".csv":
        valid, msg = _validate_csv(dataset_path)
    else:
        valid, msg = _validate_npy(dataset_path)

    if not valid:
        import shutil
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(status_code=422, detail=msg)

    logger.info(f"[LexiRep] Dataset validation passed: {msg}")

    # Clamp epochs to sane range [1, 50]
    epochs = max(1, min(epochs, 50))

    # Create job and launch async training
    job = create_train_job(dataset_path, output_dir, epochs=epochs, job_id=job_id)

    asyncio.create_task(execute_training_job(job))

    return JSONResponse(
        content={
            "job_id": job_id,
            "status": "running",
            "validation": msg,
            "epochs": epochs,
            "is_npz": ext == ".npz"
        }
    )


@router.post("/convert-csv")
async def convert_csv(
    file: UploadFile = File(...)
):
    """
    Utility endpoint: Upload a CSV file and convert it into an optimized .npz cache.
    Returns the binary .npz cache directly for fast local re-use.
    """
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Please upload a .csv file.")

    temp_id = str(uuid.uuid4())
    temp_dir = LEXIREP_JOBS_DIR / f"temp_{temp_id}"
    temp_dir.mkdir(parents=True, exist_ok=True)

    csv_path = temp_dir / "input.csv"
    npz_path = temp_dir / f"{Path(file.filename).stem}_cache.npz"

    try:
        content = await file.read()
        with open(csv_path, "wb") as f:
            f.write(content)

        parse_and_convert_csv(csv_path, output_npz_path=npz_path)

        with open(npz_path, "rb") as f:
            data = f.read()

        import shutil
        shutil.rmtree(temp_dir, ignore_errors=True)

        return StreamingResponse(
            io.BytesIO(data),
            media_type="application/octet-stream",
            headers={
                "Content-Disposition": f'attachment; filename="{Path(file.filename).stem}_cache.npz"'
            }
        )
    except Exception as e:
        import shutil
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise HTTPException(status_code=422, detail=f"Failed to convert CSV to NPZ: {e}")


@router.get("/train-status/{job_id}")
async def train_status(job_id: str):
    """
    Poll the live status of a training job.
    Returns live progress %, loop count, metrics history, and model summary.
    """
    job = get_train_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Training job {job_id} not found")

    response = {
        "status": job.status.value,
        "current_loop": job.current_loop,
        "total_loops": job.total_loops,
        "progress": job.progress,
        "current_metrics": job.current_metrics,
        "history": job.history,
    }

    if job.status == TrainJobStatus.FAILED:
        response["error"] = job.error or "Training encountered an error"

    if job.status == TrainJobStatus.COMPLETE:
        response["output_files"] = job.output_files
        response["model_summary"] = job.model_summary

    return JSONResponse(content=response)


@router.get("/train-result/{job_id}")
async def train_result(
    job_id: str,
    file: Optional[str] = Query(None, description="Specific file to download (e.g. final_lexirep_model.pt or dataset_cache.npz)")
):
    """
    Download trained model artifacts.
    If 'file' query param is specified, returns that single file directly.
    Otherwise, returns the entire checkpoint directory as a ZIP archive.
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

    # 1. Download specific requested file
    if file:
        target_path = job.output_dir / file
        if not target_path.exists() or not target_path.is_file():
            raise HTTPException(status_code=404, detail=f"File '{file}' not found in job outputs")

        media_type = "application/octet-stream"
        if file.endswith(".json"):
            media_type = "application/json"
        elif file.endswith(".pt"):
            media_type = "application/octet-stream"

        return FileResponse(
            path=target_path,
            media_type=media_type,
            filename=file
        )

    # 2. Download full ZIP archive
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
            "Content-Disposition": f'attachment; filename="lexirep_checkpoint_bundle_{job_id[:8]}.zip"'
        },
    )
