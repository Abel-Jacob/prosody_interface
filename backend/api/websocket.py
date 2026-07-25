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
    last_processed_sample_index = 0
    job_id = str(uuid.uuid4())
    
    try:
        while True:
            message = await websocket.receive()
            
            if "bytes" in message:
                # Audio chunk received — accumulate it
                chunk_data = message["bytes"]
                audio_chunks.append(chunk_data)
                
                # Live incremental transcription & stress (every ~2.5s of new speech)
                try:
                    import tempfile
                    import os
                    import soundfile as sf
                    import librosa
                    
                    tmp_path = None
                    try:
                        with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
                            tmp.write(b"".join(audio_chunks))
                            tmp_path = tmp.name
                        
                        audio_full, _ = librosa.load(tmp_path, sr=SAMPLE_RATE, mono=True)
                        
                        # Process an incremental phrase every ~2.5 seconds (40,000 samples)
                        if len(audio_full) - last_processed_sample_index >= 40000:
                            audio_slice = audio_full[last_processed_sample_index : len(audio_full)]
                            slice_offset = last_processed_sample_index / float(SAMPLE_RATE)
                            
                            slice_path = None
                            try:
                                with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as stmp:
                                    sf.write(stmp.name, audio_slice, SAMPLE_RATE)
                                    slice_path = stmp.name
                                
                                models = websocket.app.state.models
                                asr_model = models.get("asr_final") or models.get("asr_preview") if models else None
                                
                                if asr_model:
                                    from pipeline.asr import transcribe_chunk
                                    asr_result = await asyncio.to_thread(
                                        transcribe_chunk,
                                        slice_path,
                                        asr_model
                                    )
                                    
                                    # Run live stress analysis on the incremental slice
                                    stress_map = {}
                                    if models:
                                        from pipeline.prosody_registry import get_active_analyzers
                                        for analyzer in get_active_analyzers(models):
                                            try:
                                                res = await asyncio.to_thread(
                                                    analyzer.analyze, audio_slice, asr_result["words"]
                                                )
                                                if "word_stress" in res:
                                                    for item in res["word_stress"]:
                                                        stress_map[item["word"].strip().lower()] = item.get("stressed", False)
                                            except Exception as ae:
                                                logger.debug(f"Live prosody analyzer failed: {ae}")
                                    
                                    formatted_words = []
                                    for w in asr_result["words"]:
                                        w_clean = w["word"].strip().lower()
                                        formatted_words.append({
                                            "word": w["word"],
                                            "start": round(w["start"] + slice_offset, 3),
                                            "end": round(w["end"] + slice_offset, 3),
                                            "confidence": w.get("confidence", 1.0),
                                            "stressed": stress_map.get(w_clean, False)
                                        })
                                    
                                    if formatted_words:
                                        logger.info(f"Live Incremental Phrase: '{asr_result['text']}' ({len(formatted_words)} words)")
                                        await websocket.send_json({
                                            "type": "incremental_words",
                                            "words": formatted_words,
                                            "text": asr_result["text"]
                                        })
                                        last_processed_sample_index = len(audio_full)
                                    else:
                                        await websocket.send_json({"type": "preview_ack", "chunks_received": len(audio_chunks)})
                                else:
                                    await websocket.send_json({"type": "preview_ack", "chunks_received": len(audio_chunks)})
                            finally:
                                if slice_path and os.path.exists(slice_path):
                                    try: os.remove(slice_path)
                                    except Exception: pass
                        else:
                            await websocket.send_json({"type": "preview_ack", "chunks_received": len(audio_chunks)})
                    finally:
                        if tmp_path and os.path.exists(tmp_path):
                            try: os.remove(tmp_path)
                            except Exception: pass
                except Exception as e:
                    logger.debug(f"Live incremental decode failed: {e}")
                    await websocket.send_json({"type": "preview_ack", "chunks_received": len(audio_chunks)})
            
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
