"""
REST API Routes

Endpoints:
- POST /api/jobs          — Create a job from uploaded audio
- GET  /api/jobs/{job_id} — Poll job status and progress (frontend polls every 1-2s)
"""

import uuid
import shutil
import logging
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, HTTPException

from database import create_job, get_job
from config import AUDIO_UPLOADS_DIR
from schemas import JobResponse, JobCreateResponse, JobStatus, JobResult

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")


@router.post("/jobs", response_model=JobCreateResponse)
async def create_new_job(audio: UploadFile = File(...)):
    """
    Receive the complete recorded audio file, save it to disk,
    create a queued job, and return the job_id immediately.
    The WebSocket/HTTP handler's job ends here — it does NOT wait for processing.
    """
    job_id = str(uuid.uuid4())
    
    # Save audio to disk
    filename = f"{job_id}.webm"
    filepath = AUDIO_UPLOADS_DIR / filename
    
    try:
        with open(filepath, "wb") as f:
            content = await audio.read()
            f.write(content)
        logger.info(f"Saved audio file: {filepath} ({len(content)} bytes)")
    except Exception as e:
        logger.error(f"Failed to save audio: {e}")
        raise HTTPException(status_code=500, detail="Failed to save audio file")
    
    # Create job record in SQLite
    job = create_job(job_id, str(filepath))
    logger.info(f"Created job {job_id} (status=queued)")
    
    return JobCreateResponse(job_id=job_id, status=JobStatus.QUEUED)


@router.get("/jobs/{job_id}", response_model=JobResponse)
async def get_job_status(job_id: str):
    """
    Poll endpoint for job status and progress.
    Frontend calls this every 1-2 seconds during processing.
    Returns real progress values written by the worker.
    """
    job = get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    
    # Parse result into JobResult if job is complete
    result = None
    if job["status"] == "complete" and job.get("result"):
        try:
            result = JobResult(**job["result"])
        except Exception:
            result = JobResult()
    elif job["status"] == "processing" and job.get("result"):
        # Return partial results during processing too
        try:
            result = JobResult(**job["result"])
        except Exception:
            result = None
    
    return JobResponse(
        job_id=job["job_id"],
        status=JobStatus(job["status"]),
        progress=job["progress"],
        created_at=job["created_at"],
        started_at=job.get("started_at"),
        completed_at=job.get("completed_at"),
        total_chunks=job.get("total_chunks", 0),
        completed_chunks=job.get("completed_chunks", 0),
        current_stage=job.get("current_stage", ""),
        result=result,
        error=job.get("error", ""),
    )
