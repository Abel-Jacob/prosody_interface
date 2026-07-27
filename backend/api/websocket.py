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
import tempfile
import os
import soundfile as sf
import librosa
import torch
import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from database import create_job, update_job_status
from config import AUDIO_UPLOADS_DIR, SAMPLE_RATE
from schemas import PhraseResult, WordResult, JobResult
from pipeline.merge import merge_chunk_results, reconstruct_grammatical_phrases

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
    window_chunks: list[bytes] = []
    last_prompt: str | None = None
    job_id = str(uuid.uuid4())
    stop_handled = False
    
    try:
        process_task = None

        async def process_window(audio_slice):
            nonlocal last_prompt
            try:

                
                try:
                    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as stmp:
                        sf.write(stmp.name, audio_slice, SAMPLE_RATE)
                        slice_path = stmp.name
                    
                    models = websocket.app.state.models
                    asr_model = models.get("asr_preview") or models.get("asr_final") if models else None
                    
                    if asr_model:
                        from pipeline.asr import transcribe_chunk
                        asr_result = await asyncio.to_thread(
                            transcribe_chunk,
                            slice_path,
                            asr_model,
                            "en",
                            last_prompt,
                        )
                        if asr_result.get("text"):
                            last_prompt = asr_result["text"][-150:]
                        
                        # RUN STRESS (WhiStress) ON THE SAME SLICE
                        pros_results = {}
                        try:
                            if models and asr_result.get("words"):
                                from pipeline.prosody_registry import get_active_analyzers
                                for analyzer in get_active_analyzers(models):
                                    if analyzer.name == "stress":
                                        res = await asyncio.to_thread(analyzer.analyze, audio_slice, asr_result["words"])
                                        pros_results[analyzer.name] = res
                        except Exception as e:
                            logger.error(f"Live stress analyzer failed: {e}")
                            
                        # 1. SEND INSTANT ASR + STRESS PREVIEW
                        phrase = merge_chunk_results(
                            chunk_index=0,
                            asr_result=asr_result,
                            prosody_results=pros_results,
                            time_offset=0.0,
                        )
                        
                        if phrase.words:
                            w_dump = [w.model_dump() for w in phrase.words]
                            from datetime import datetime
                            now_str = datetime.now().strftime("%H:%M:%S.%f")[:-3]
                            logger.info(f"[{now_str}] Live ASR (Instant): '{phrase.text}' ({len(w_dump)} words)")
                            try:
                                payload = {
                                    "type": "incremental_words",
                                    "replace_words": False,
                                    "words": w_dump,
                                    "text": phrase.text
                                }
                                logger.info(f"[{now_str}] ATTEMPTING to send WebSocket payload: {payload['type']}")
                                await websocket.send_json(payload)
                                logger.info(f"[{now_str}] SUCCESS: WebSocket payload sent")
                            except Exception as e:
                                logger.error(f"[{now_str}] FAILED to send WebSocket payload: {e}")
                        else:
                            try:
                                await websocket.send_json({"type": "preview_ack", "chunks_received": len(audio_chunks)})
                            except Exception:
                                pass
                    else:
                        try:
                            await websocket.send_json({"type": "preview_ack", "chunks_received": len(audio_chunks)})
                        except Exception:
                            pass
                finally:
                    if slice_path and os.path.exists(slice_path):
                        try: os.remove(slice_path)
                        except Exception: pass
            except Exception as e:
                logger.error(f"Live window decode failed: {e}")
                try:
                    await websocket.send_json({"type": "preview_ack", "chunks_received": len(audio_chunks)})
                except Exception:
                    pass

        while True:
            message = await websocket.receive()
            
            if "bytes" in message:
                # Audio chunk received — accumulate it
                chunk_data = message["bytes"]
                audio_chunks.append(chunk_data)
                
                if not window_chunks:
                    # First chunk is always the WebM header
                    window_chunks.append(chunk_data)
                else:
                    window_chunks.append(chunk_data)
                
                # Process rolling window when we have header + 3 chunks (~3 seconds)
                if len(window_chunks) >= 4:
                    try:
                        tmp_path = None
                        try:
                            with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
                                tmp.write(b"".join(window_chunks))
                                tmp_path = tmp.name
                                
                            # Fast decode using direct ffmpeg Popen to avoid O(N^2) librosa/audioread overhead
                            async def decode_ffmpeg():
                                import subprocess, numpy as np
                                p = subprocess.Popen(
                                    ['ffmpeg', '-i', tmp_path, '-f', 's16le', '-acodec', 'pcm_s16le', '-ac', '1', '-ar', '16000', '-'],
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE
                                )
                                out, err = await asyncio.to_thread(p.communicate)
                                if out:
                                    return np.frombuffer(out, dtype=np.int16).astype(np.float32) / 32768.0
                                logger.error(f"ffmpeg decode failed: {err.decode('utf-8', errors='ignore')}")
                                return np.array([], dtype=np.float32)
                            
                            audio_slice = await decode_ffmpeg()
                            
                            if len(audio_slice) > 0:
                                if process_task is None or process_task.done():
                                    process_task = asyncio.create_task(process_window(audio_slice))
                                else:
                                    # Fall behind protection
                                    logger.warning("Live preview skipped a rolling window chunk to maintain real-time speed.")
                                    try:
                                        await websocket.send_json({"type": "preview_ack", "chunks_received": len(audio_chunks)})
                                    except Exception:
                                        pass
                            else:
                                try:
                                    await websocket.send_json({"type": "preview_ack", "chunks_received": len(audio_chunks)})
                                except Exception:
                                    pass
                        finally:
                            if tmp_path and os.path.exists(tmp_path):
                                try: os.remove(tmp_path)
                                except Exception: pass
                                
                        # Clear window chunks (keep header)
                        window_chunks = [window_chunks[0]]
                        
                    except Exception as e:
                        logger.error(f"Live decode failed: {e}")
                        window_chunks = [window_chunks[0]]
                        try:
                            await websocket.send_json({"type": "preview_ack", "chunks_received": len(audio_chunks)})
                        except Exception:
                            pass
            
            elif "text" in message:
                try:
                    msg = json.loads(message["text"])
                except json.JSONDecodeError:
                    msg = {"type": message["text"]}
                
                if msg.get("type") == "stop":
                    if not stop_handled:
                        stop_handled = True
                        # Cancel any running processing task
                        if process_task and not process_task.done():
                            process_task.cancel()

                        # Save complete audio to disk
                        filepath = await _save_audio(job_id, audio_chunks)
                        
                        if filepath:
                            create_job(job_id, str(filepath))
                            logger.info(f"Recording stopped. Queued background job {job_id} for high-accuracy final processing.")
                            try:
                                await websocket.send_json({
                                    "type": "job_created",
                                    "job_id": job_id,
                                })
                            except Exception:
                                pass
                        else:
                            try:
                                await websocket.send_json({
                                    "type": "error",
                                    "message": "Failed to save audio",
                                })
                            except Exception:
                                pass
                    break  # Close connection after stop
    
    except WebSocketDisconnect:
        logger.info("WebSocket disconnected")
        # If we have audio but didn't get a stop signal, save anyway
        if audio_chunks and not stop_handled:
            stop_handled = True
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
