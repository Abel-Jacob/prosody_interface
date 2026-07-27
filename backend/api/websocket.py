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
    last_yielded_idx = 0
    last_processed_chunk_idx = 1
    last_prompt: str | None = None
    job_id = str(uuid.uuid4())
    stop_handled = False
    
    try:
        process_task = None

        async def process_live_audio(chunks_to_process):
            nonlocal last_yielded_idx, last_prompt
            try:
                # 1. Decode all accumulated chunks to PCM
                tmp_path = None
                try:
                    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
                        tmp.write(b"".join(chunks_to_process))
                        tmp_path = tmp.name
                        
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
                    
                    full_pcm = await decode_ffmpeg()
                finally:
                    if tmp_path and os.path.exists(tmp_path):
                        try: os.remove(tmp_path)
                        except Exception: pass
                        
                if len(full_pcm) == 0:
                    return
                
                # Check if we have enough new audio since last yield
                if len(full_pcm) - last_yielded_idx < int(1.5 * SAMPLE_RATE):
                    return
                    
                # 2. Extract 4-second context window ending at the live edge
                window_start_idx = max(0, len(full_pcm) - 4 * SAMPLE_RATE)
                audio_window = full_pcm[window_start_idx : len(full_pcm)]
                
                models = websocket.app.state.models
                asr_model = models.get("asr_preview") or models.get("asr_final") if models else None
                
                if not asr_model:
                    return
                    
                # 3. Transcribe window
                from pipeline.asr import transcribe_chunk
                import time
                
                start_asr = time.time()
                asr_result = await asyncio.to_thread(
                    transcribe_chunk,
                    audio_window,
                    asr_model,
                    "en",
                    last_prompt,
                )
                asr_duration = time.time() - start_asr
                
                if asr_result.get("text"):
                    last_prompt = asr_result["text"][-150:]
                    
                # 4. Run Stress Analyzer on the FULL window with FULL words
                pros_results = {}
                start_stress = time.time()
                try:
                    from pipeline.prosody_registry import get_active_analyzers
                    for analyzer in get_active_analyzers(models):
                        if analyzer.name == "stress" and asr_result.get("words"):
                            res = await asyncio.to_thread(analyzer.analyze, audio_window, asr_result["words"])
                            pros_results[analyzer.name] = res
                except Exception as e:
                    logger.error(f"Live stress analyzer failed: {e}")
                stress_duration = time.time() - start_stress
                
                # 5. Merge results for the FULL window
                full_phrase = merge_chunk_results(0, asr_result, pros_results, 0.0)
                
                # 6. Filter valid words to prevent duplication and cut-off
                threshold_sec = (last_yielded_idx - window_start_idx) / float(SAMPLE_RATE)
                safe_end_sec = (len(audio_window) / float(SAMPLE_RATE)) - 0.4
                
                valid_words = []
                for w in full_phrase.words:
                    if w.start >= threshold_sec and w.end <= safe_end_sec:
                        valid_words.append(w)
                            
                if not valid_words:
                    # If we've processed a lot of silence, force advance to prevent endless silence processing
                    if len(full_pcm) - last_yielded_idx > 5 * SAMPLE_RATE:
                        last_yielded_idx = len(full_pcm) - int(2.0 * SAMPLE_RATE)
                    return
                
                # 7. Construct payload and send
                phrase_text = " ".join([w.word for w in valid_words])
                w_dump = [w.model_dump() for w in valid_words]
                
                from datetime import datetime
                now_str = datetime.now().strftime("%H:%M:%S.%f")[:-3]
                stress_vals = [w.stress_score for w in valid_words]
                
                logger.info(f"[{now_str}] WINDOW STATS: len={len(audio_window)/SAMPLE_RATE:.2f}s | ASR={asr_duration:.2f}s | STRESS={stress_duration:.2f}s | NEW_WORDS={len(valid_words)}")
                logger.info(f"[{now_str}] Live ASR (Instant): '{phrase_text}' | STRESS={stress_vals}")
                
                payload = {
                    "type": "incremental_words",
                    "replace_words": False,
                    "words": w_dump,
                    "text": phrase_text
                }
                await websocket.send_json(payload)
                
                # 8. Advance yielded index exactly to the end of the last word
                last_yielded_idx = window_start_idx + int(valid_words[-1].end * SAMPLE_RATE)
                
            except Exception as e:
                logger.error(f"Live window processing failed: {e}", exc_info=True)
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
                
                # Process every 2 chunks (~2 seconds)
                if len(audio_chunks) - last_processed_chunk_idx >= 2:
                    last_processed_chunk_idx = len(audio_chunks)
                    
                    if process_task is None or process_task.done():
                        # Pass a copy of the list so it doesn't mutate during await
                        process_task = asyncio.create_task(process_live_audio(list(audio_chunks)))
                    else:
                        logger.warning("Live preview skipped chunks to maintain real-time speed.")
            
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
