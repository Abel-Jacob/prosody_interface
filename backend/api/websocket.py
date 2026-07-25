"""
WebSocket Handler — Live Preview Only

This WebSocket handles ONLY the lightweight live-preview transcription
during recording. It streams audio chunks from the browser and returns
cheap/fast Whisper transcription for user feedback.

On STOP: saves the complete audio, creates a queued job, returns job_id.
The heavy processing happens in the background worker, NOT here.
"""

import uuid
import logging
import asyncio
import numpy as np
import io
from pathlib import Path
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from database import create_job
from config import AUDIO_UPLOADS_DIR, SAMPLE_RATE

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")


@router.websocket("/ws/audio")
async def audio_websocket(websocket: WebSocket):
    """
    WebSocket lifecycle:
    1. Client connects
    2. Client streams audio chunks -> server returns live preview text
    3. Client sends STOP message -> server saves audio, creates job, returns job_id
    4. Connection closes
    """
    await websocket.accept()
    logger.info("WebSocket connected")
    
    audio_chunks: list[bytes] = []
    job_id = str(uuid.uuid4())
    
    try:
        while True:
            message = await websocket.receive()
            
            if "bytes" in message:
                # Audio chunk received — accumulate it
                chunk_data = message["bytes"]
                audio_chunks.append(chunk_data)
                
                # Live preview transcription (lightweight)
                try:
                    import tempfile
                    import os
                    
                    tmp_path = None
                    try:
                        with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
                            tmp.write(b"".join(audio_chunks))
                            tmp_path = tmp.name
                        
                        models = websocket.app.state.models
                        if models and models.get("asr_preview"):
                            from pipeline.asr import transcribe_chunk
                            asr_result = await asyncio.to_thread(
                                transcribe_chunk,
                                tmp_path,
                                models.get("asr_preview")
                            )
                            logger.info(f"Live Preview ASR: {asr_result['text']}")
                            await websocket.send_json({
                                "type": "preview_text",
                                "text": asr_result["text"]
                            })
                        else:
                            await websocket.send_json({
                                "type": "preview_ack",
                                "chunks_received": len(audio_chunks),
                            })
                    finally:
                        if tmp_path and os.path.exists(tmp_path):
                            try:
                                os.remove(tmp_path)
                            except Exception:
                                pass
                except Exception as e:
                    logger.debug(f"Live preview decode failed (often normal for partial webm): {e}")
                    await websocket.send_json({
                        "type": "preview_ack",
                        "chunks_received": len(audio_chunks),
                    })
            
            elif "text" in message:
                import json
                try:
                    msg = json.loads(message["text"])
                except json.JSONDecodeError:
                    msg = {"type": message["text"]}
                
                if msg.get("type") == "stop":
                    # Save complete audio to disk
                    filepath = await _save_audio(job_id, audio_chunks)
                    
                    if filepath:
                        # Create job in SQLite — handler's job ends here
                        job = create_job(job_id, str(filepath))
                        logger.info(f"Recording stopped. Created job {job_id}")
                        
                        await websocket.send_json({
                            "type": "job_created",
                            "job_id": job_id,
                        })
                    else:
                        await websocket.send_json({
                            "type": "error",
                            "message": "Failed to save audio",
                        })
                    
                    break  # Close connection after stop
    
    except WebSocketDisconnect:
        logger.info("WebSocket disconnected")
        # If we have audio but didn't get a stop signal, save anyway
        if audio_chunks:
            filepath = await _save_audio(job_id, audio_chunks)
            if filepath:
                create_job(job_id, str(filepath))
                logger.info(f"Saved orphaned recording as job {job_id}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}", exc_info=True)
    finally:
        try:
            await websocket.close()
        except Exception:
            pass


async def _save_audio(job_id: str, chunks: list[bytes]) -> Path | None:
    """Save accumulated audio chunks to a single file on disk."""
    if not chunks:
        return None
    
    filepath = AUDIO_UPLOADS_DIR / f"{job_id}.webm"
    
    try:
        combined = b"".join(chunks)
        # Write in a thread to avoid blocking the event loop
        await asyncio.to_thread(_write_file, filepath, combined)
        logger.info(f"Saved audio: {filepath} ({len(combined)} bytes)")
        return filepath
    except Exception as e:
        logger.error(f"Failed to save audio: {e}")
        return None


def _write_file(path: Path, data: bytes):
    """Synchronous file write, run in thread."""
    with open(path, "wb") as f:
        f.write(data)
