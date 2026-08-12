"""
REST API Routes

Endpoints:
- POST /api/jobs                          — Create a job from uploaded audio
- GET  /api/jobs/{job_id}                 — Poll job status and progress
- GET  /api/jobs/{job_id}/annotation      — Get canonical annotation document
- GET  /api/jobs/{job_id}/annotation/download — Download annotation as .json file
"""

import json
import uuid
import shutil
import logging
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse, FileResponse

from database import create_job, get_job
from config import AUDIO_UPLOADS_DIR, ANNOTATIONS_DIR
from schemas import JobResponse, JobCreateResponse, JobStatus, JobResult
from pipeline.annotation import build_annotation

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
    
    # Preserving the original uploaded file extension
    suffix = ".webm"
    if audio.filename:
        uploaded_suffix = Path(audio.filename).suffix.lower()
        if uploaded_suffix in (".webm", ".wav", ".mp3", ".ogg"):
            suffix = uploaded_suffix

    filename = f"{job_id}{suffix}"
    filepath = AUDIO_UPLOADS_DIR / filename
    
    try:
        with open(filepath, "wb") as f:
            content = await audio.read()
            f.write(content)
        logger.info(f"Saved audio file: {filepath} ({len(content)} bytes)")

        # If it is a webm, remux it to make it seekable in browsers
        if suffix == ".webm":
            import asyncio
            temp_filepath = filepath.with_suffix(".temp.webm")
            try:
                proc = await asyncio.create_subprocess_exec(
                    'ffmpeg', '-y', '-i', str(filepath), '-c', 'copy', str(temp_filepath),
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                await proc.communicate()
                if temp_filepath.exists():
                    import os
                    os.replace(temp_filepath, filepath)
                    logger.info(f"Successfully remuxed uploaded webm using ffmpeg: {filepath}")
                else:
                    logger.warning(f"ffmpeg remux completed but temp file does not exist: {temp_filepath}")
            except Exception as fe:
                logger.error(f"Failed to remux uploaded webm: {fe}")
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

@router.get("/jobs/{job_id}/annotation")
async def get_annotation(job_id: str):
    """
    Generate and return the canonical annotation document for a completed job.

    The annotation is built on-the-fly from the stored JobResult — it's a
    pure reshaping, not a re-computation. Sub-millisecond.

    Returns:
        200: The annotation JSON document.
        404: Job not found.
        409: Job not yet complete (includes current status and progress).
    """
    job = get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

    if job["status"] != "complete":
        return JSONResponse(
            status_code=409,
            content={
                "detail": f"Job not yet complete (status: {job['status']})",
                "status": job["status"],
                "progress": job.get("progress", 0.0),
                "error": job.get("error", ""),
            },
        )

    try:
        annotation = build_annotation(job)
    except Exception as e:
        logger.error(f"Failed to build annotation for job {job_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Annotation generation failed: {e}")

    # Persist to disk for future downloads
    annotation_path = ANNOTATIONS_DIR / f"{job_id}.json"
    try:
        with open(annotation_path, "w", encoding="utf-8") as f:
            json.dump(annotation, f, indent=2, ensure_ascii=False)
    except Exception as e:
        logger.warning(f"Failed to persist annotation file: {e}")

    return JSONResponse(content=annotation)


@router.get("/jobs/{job_id}/annotation/download")
async def download_annotation(job_id: str):
    """
    Download the annotation document as a .json file.

    If the file already exists on disk, serves it directly.
    Otherwise, generates it first (same as the /annotation endpoint).
    """
    job = get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

    if job["status"] != "complete":
        return JSONResponse(
            status_code=409,
            content={
                "detail": f"Job not yet complete (status: {job['status']})",
                "status": job["status"],
                "progress": job.get("progress", 0.0),
            },
        )

    annotation_path = ANNOTATIONS_DIR / f"{job_id}.json"

    # Generate if not already on disk
    if not annotation_path.exists():
        try:
            annotation = build_annotation(job)
            with open(annotation_path, "w", encoding="utf-8") as f:
                json.dump(annotation, f, indent=2, ensure_ascii=False)
        except Exception as e:
            logger.error(f"Failed to generate annotation for download: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"Annotation generation failed: {e}")

    return FileResponse(
        path=str(annotation_path),
        media_type="application/json",
        filename=f"annotation_{job_id}.json",
    )


@router.get("/jobs/{job_id}/audio")
async def get_job_audio(job_id: str):
    """
    Serve the audio file associated with the job.
    """
    job = get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

    filepath = Path(job["filepath"])
    if not filepath.exists():
        raise HTTPException(status_code=404, detail="Audio file not found")

    media_type = "audio/webm"
    if filepath.suffix == ".wav":
        media_type = "audio/wav"
    elif filepath.suffix == ".ogg":
        media_type = "audio/ogg"
    elif filepath.suffix == ".mp3":
        media_type = "audio/mpeg"

    return FileResponse(path=str(filepath), media_type=media_type)

