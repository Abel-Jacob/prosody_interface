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
import io
import zipfile
from pathlib import Path
from typing import Optional, List, Union
from fastapi import APIRouter, UploadFile, File, Query, HTTPException, Response
from fastapi.responses import JSONResponse, FileResponse

from database import create_job, get_job, get_recent_jobs
from config import AUDIO_UPLOADS_DIR, ANNOTATIONS_DIR
from schemas import JobResponse, JobCreateResponse, JobStatus, JobResult, BatchJobResult
from pipeline.annotation import build_annotation

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")


@router.get("/jobs")
async def list_recent_jobs(limit: int = 20):
    """
    List recent jobs and provide usage hint.
    Prevents 405 Method Not Allowed when accessed via browser or GET.
    """
    jobs = get_recent_jobs(limit=limit)
    return {
        "status": "ok",
        "message": "Prosody Interface Job API. To submit a new job, send a POST request with multipart/form-data containing 'audio' or 'files'.",
        "count": len(jobs),
        "jobs": [
            {
                "job_id": j["job_id"],
                "status": j["status"],
                "progress": j["progress"],
                "created_at": j["created_at"],
                "completed_chunks": j.get("completed_chunks", 0),
                "total_chunks": j.get("total_chunks", 0),
            }
            for j in jobs
        ],
    }


@router.post("/jobs", response_model=JobCreateResponse)
async def create_new_job(
    audio: Optional[UploadFile] = File(None),
    files: Optional[List[UploadFile]] = File(None),
):
    """
    Receive recorded audio, multiple audio files, or a ZIP archive,
    save or extract to disk, create a queued job, and return job_id immediately.
    """
    job_id = str(uuid.uuid4())
    
    uploaded_files: list[UploadFile] = []
    if files:
        uploaded_files.extend(files)
    if audio:
        uploaded_files.append(audio)
        
    if not uploaded_files:
        raise HTTPException(status_code=400, detail="No audio file or files provided.")

    AUDIO_EXTENSIONS = {".wav", ".mp3", ".ogg", ".webm", ".flac", ".m4a"}

    # Determine if this is a batch or single file
    is_zip = False
    if len(uploaded_files) == 1 and uploaded_files[0].filename:
        if uploaded_files[0].filename.lower().endswith(".zip"):
            is_zip = True

    is_batch = (len(uploaded_files) > 1) or is_zip

    if not is_batch:
        # Single audio file upload or recording
        single_file = uploaded_files[0]
        suffix = ".webm"
        if single_file.filename:
            uploaded_suffix = Path(single_file.filename).suffix.lower()
            if uploaded_suffix in AUDIO_EXTENSIONS:
                suffix = uploaded_suffix

        filename = f"upload_{job_id}{suffix}"
        filepath = AUDIO_UPLOADS_DIR / filename
        
        try:
            with open(filepath, "wb") as f:
                content = await single_file.read()
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
        logger.info(f"Created single job {job_id} (status=queued)")
        return JobCreateResponse(job_id=job_id, status=JobStatus.QUEUED)

    else:
        # Batch upload (multi-file or zip)
        batch_dir = AUDIO_UPLOADS_DIR / f"batch_{job_id}"
        batch_dir.mkdir(parents=True, exist_ok=True)
        
        try:
            for upfile in uploaded_files:
                if not upfile.filename:
                    continue
                upfile_name_lower = upfile.filename.lower()
                
                if upfile_name_lower.endswith(".zip"):
                    # Extract zip file securely
                    content = await upfile.read()
                    zip_mem = io.BytesIO(content)
                    with zipfile.ZipFile(zip_mem, 'r') as zf:
                        for info in zf.infolist():
                            if info.is_dir():
                                continue
                            member_path = Path(info.filename)
                            if ".." in member_path.parts:
                                continue
                            if "__MACOSX" in member_path.parts or member_path.name.startswith("."):
                                continue
                            if member_path.suffix.lower() in AUDIO_EXTENSIONS:
                                dest_name = member_path.name
                                dest_path = batch_dir / dest_name
                                if dest_path.exists():
                                    dest_path = batch_dir / f"{uuid.uuid4().hex[:6]}_{dest_name}"
                                with zf.open(info) as src, open(dest_path, "wb") as dst:
                                    shutil.copyfileobj(src, dst)
                elif Path(upfile.filename).suffix.lower() in AUDIO_EXTENSIONS:
                    dest_name = Path(upfile.filename).name
                    dest_path = batch_dir / dest_name
                    if dest_path.exists():
                        dest_path = batch_dir / f"{uuid.uuid4().hex[:6]}_{dest_name}"
                    with open(dest_path, "wb") as f:
                        content = await upfile.read()
                        f.write(content)
                        
            valid_extracted = [
                p for p in batch_dir.rglob("*")
                if p.is_file() and p.suffix.lower() in AUDIO_EXTENSIONS
            ]
            if not valid_extracted:
                shutil.rmtree(batch_dir, ignore_errors=True)
                raise HTTPException(
                    status_code=400,
                    detail="No valid audio files found (.wav, .mp3, .ogg, .webm, .flac, .m4a)"
                )
                
            logger.info(f"Created batch job {job_id} with {len(valid_extracted)} audio files")
            job = create_job(job_id, str(batch_dir))
            return JobCreateResponse(job_id=job_id, status=JobStatus.QUEUED)
        except HTTPException:
            raise
        except Exception as e:
            shutil.rmtree(batch_dir, ignore_errors=True)
            logger.error(f"Failed to process batch upload: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"Failed to process batch upload: {str(e)}")


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
    
    # Parse result into JobResult or BatchJobResult if job has results
    result = None
    if job.get("result"):
        res = job["result"]
        if isinstance(res, dict) and res.get("is_batch"):
            try:
                result = BatchJobResult(**res)
            except Exception:
                result = res
        elif isinstance(res, dict):
            try:
                result = JobResult(**res)
            except Exception:
                result = res
    
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
async def get_annotation(job_id: str, file: Optional[str] = Query(None)):
    """
    Generate and return canonical annotation document for a completed job.
    Supports single-file query on batch jobs: ?file=filename.wav.
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

    res = job.get("result") or {}
    if isinstance(res, dict) and res.get("is_batch"):
        if file:
            # Look up specific file in batch
            target = None
            for f in res.get("files", []):
                if f.get("filename") == file or f.get("file_id") == file:
                    target = f
                    break
            if not target:
                raise HTTPException(status_code=404, detail=f"File '{file}' not found in batch {job_id}")
            if target.get("annotation"):
                return JSONResponse(content=target["annotation"])
            if target.get("result"):
                sub_job = {
                    "job_id": f"{job_id}_{target.get('file_id', '1')}",
                    "filename": target.get("filename"),
                    "status": "complete",
                    "created_at": job.get("created_at"),
                    "completed_at": job.get("completed_at"),
                    "result": target["result"],
                }
                ann = build_annotation(sub_job)
                ann["filename"] = target.get("filename")
                return JSONResponse(content=ann)
            return JSONResponse(content=target)
        else:
            manifest = dict(res)
            manifest["job_id"] = job_id
            return JSONResponse(content=manifest)

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
async def download_annotation(job_id: str, file: Optional[str] = Query(None)):
    """
    Download the annotation document as a .json file.
    Supports ?file=filename.wav for batch jobs.
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

    res = job.get("result") or {}
    if isinstance(res, dict) and res.get("is_batch"):
        if file:
            target = None
            for f in res.get("files", []):
                if f.get("filename") == file or f.get("file_id") == file:
                    target = f
                    break
            if not target:
                raise HTTPException(status_code=404, detail=f"File '{file}' not found in batch {job_id}")
            ann = target.get("annotation")
            if not ann and target.get("result"):
                sub_job = {
                    "job_id": f"{job_id}_{target.get('file_id', '1')}",
                    "filename": target.get("filename"),
                    "status": "complete",
                    "created_at": job.get("created_at"),
                    "completed_at": job.get("completed_at"),
                    "result": target["result"],
                }
                try:
                    ann = build_annotation(sub_job)
                    ann["filename"] = target.get("filename")
                except Exception:
                    ann = target.get("result")
            content_bytes = json.dumps(ann or target, indent=2, ensure_ascii=False).encode("utf-8")
            clean_name = Path(target.get("filename", "file")).stem
            return Response(
                content=content_bytes,
                media_type="application/json",
                headers={"Content-Disposition": f'attachment; filename="annotation_{clean_name}.json"'},
            )
        else:
            content_bytes = json.dumps(res, indent=2, ensure_ascii=False).encode("utf-8")
            return Response(
                content=content_bytes,
                media_type="application/json",
                headers={"Content-Disposition": f'attachment; filename="batch_{job_id}_annotation.json"'},
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


@router.get("/jobs/{job_id}/export/batch-json")
async def export_batch_json(job_id: str):
    """
    Download a single combined JSON document containing all file annotations and summary metrics.
    """
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job["status"] != "complete":
        raise HTTPException(status_code=409, detail="Job is not yet complete")
    
    res = job.get("result") or {}
    content_bytes = json.dumps(res, indent=2, ensure_ascii=False).encode("utf-8")
    return Response(
        content=content_bytes,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="batch_{job_id}_all_annotations.json"'}
    )


@router.get("/jobs/{job_id}/export/batch-txt")
async def export_batch_txt(job_id: str):
    """
    Download combined text transcripts of all files in the batch.
    """
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job["status"] != "complete":
        raise HTTPException(status_code=409, detail="Job is not yet complete")
    
    res = job.get("result") or {}
    files = res.get("files", [])
    
    lines = []
    lines.append(f"BATCH ANNOTATION TRANSCRIPTS — JOB {job_id}")
    lines.append(f"Total Files: {res.get('total_files', len(files))} | Completed: {res.get('completed_files', 0)} | Total Words: {res.get('total_words', 0)}")
    lines.append("=" * 80 + "\n")
    
    for idx, f in enumerate(files):
        fname = f.get("filename", f"file_{idx+1}")
        status = f.get("status", "unknown")
        dur = f.get("duration", 0.0)
        wcount = f.get("word_count", 0)
        
        lines.append(f"FILE [{idx+1}/{len(files)}]: {fname}")
        lines.append(f"Status: {status} | Duration: {dur:.2f}s | Words: {wcount}")
        lines.append("-" * 40)
        
        if status == "error":
            lines.append(f"[ERROR PROCESSING FILE: {f.get('error', 'Unknown error')}]")
        else:
            f_res = f.get("result") or {}
            phrases = f_res.get("phrases") or []
            if not phrases and f.get("annotation"):
                phrases = f["annotation"].get("phrases", [])
            
            transcript_parts = []
            for p in phrases:
                p_text = p.get("text")
                if not p_text and "words" in p:
                    p_text = " ".join(w.get("word", "") for w in p["words"])
                if p_text:
                    transcript_parts.append(p_text.strip())
            
            transcript = "\n".join(transcript_parts) if transcript_parts else "[No speech detected]"
            lines.append(transcript)
            
        lines.append("\n" + "=" * 80 + "\n")
        
    full_text = "\n".join(lines)
    return Response(
        content=full_text.encode("utf-8"),
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="batch_{job_id}_transcripts.txt"'}
    )


@router.get("/jobs/{job_id}/export/batch-zip")
async def export_batch_zip(job_id: str):
    """
    Download a ZIP archive containing individual JSON annotations and TXT transcripts for each audio file.
    """
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job["status"] != "complete":
        raise HTTPException(status_code=409, detail="Job is not yet complete")

    res = job.get("result") or {}
    files = res.get("files", [])
    
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        summary_bytes = json.dumps(res, indent=2, ensure_ascii=False).encode("utf-8")
        zf.writestr("batch_summary.json", summary_bytes)
        
        for idx, f in enumerate(files):
            stem = Path(f.get("filename", f"file_{idx+1}")).stem
            ann = f.get("annotation")
            if not ann and f.get("result"):
                sub_job = {
                    "job_id": f"{job_id}_{idx+1}",
                    "filename": f.get("filename"),
                    "status": "complete",
                    "created_at": job.get("created_at"),
                    "completed_at": job.get("completed_at"),
                    "result": f["result"],
                }
                try:
                    ann = build_annotation(sub_job)
                    ann["filename"] = f.get("filename")
                except Exception:
                    ann = f.get("result")
            
            if ann:
                zf.writestr(f"annotations/{stem}_annotation.json", json.dumps(ann, indent=2, ensure_ascii=False).encode("utf-8"))
            
            f_res = f.get("result") or {}
            phrases = f_res.get("phrases") or []
            if not phrases and ann:
                phrases = ann.get("phrases", [])
            transcript_parts = []
            for p in phrases:
                p_text = p.get("text")
                if not p_text and "words" in p:
                    p_text = " ".join(w.get("word", "") for w in p["words"])
                if p_text:
                    transcript_parts.append(p_text.strip())
            transcript = "\n".join(transcript_parts) if transcript_parts else ""
            zf.writestr(f"transcripts/{stem}_transcript.txt", transcript.encode("utf-8"))
            
    zip_buffer.seek(0)
    return Response(
        content=zip_buffer.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="batch_{job_id}_all_reports.zip"'}
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
    if not filepath.exists() or filepath.is_dir():
        raise HTTPException(status_code=404, detail="Audio file not found")

    media_type = "audio/webm"
    if filepath.suffix == ".wav":
        media_type = "audio/wav"
    elif filepath.suffix == ".ogg":
        media_type = "audio/ogg"
    elif filepath.suffix == ".mp3":
        media_type = "audio/mpeg"

    return FileResponse(path=str(filepath), media_type=media_type)


