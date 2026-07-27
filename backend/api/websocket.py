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
    last_processed_sample_index = 0
    all_phrases: list[PhraseResult] = []
    last_prompt: str | None = None
    job_id = str(uuid.uuid4())
    
    try:
        vad_task = None

        async def process_vad(unprocessed_audio, processed_index):
            nonlocal all_phrases, last_prompt, last_processed_sample_index
            try:
                import tempfile
                import os
                import soundfile as sf
                
                slice_path = None
                try:
                    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as stmp:
                        sf.write(stmp.name, unprocessed_audio, SAMPLE_RATE)
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
                        
                        prosody_results = {}
                        if models:
                            from pipeline.prosody_registry import get_active_analyzers
                            for analyzer in get_active_analyzers(models):
                                try:
                                    res = await asyncio.to_thread(analyzer.analyze, unprocessed_audio, asr_result["words"])
                                    prosody_results[analyzer.name] = res
                                except Exception as e:
                                    logger.debug(f"Live prosody analyzer '{analyzer.name}' failed: {e}")
                        
                        slice_offset = processed_index / float(SAMPLE_RATE)
                        phrase = merge_chunk_results(
                            chunk_index=len(all_phrases),
                            asr_result=asr_result,
                            prosody_results=prosody_results,
                            time_offset=slice_offset,
                        )
                        
                        if phrase.words:
                            all_phrases.append(phrase)
                            all_phrases = reconstruct_grammatical_phrases(all_phrases)
                            all_words_dump = [w.model_dump() for p in all_phrases for w in p.words]
                            full_text = " ".join([p.text for p in all_phrases])
                            logger.info(f"Single-Pass VAD Phrase: '{full_text}' ({len(all_words_dump)} words)")
                            await websocket.send_json({
                                "type": "incremental_words",
                                "replace_words": True,
                                "words": all_words_dump,
                                "text": full_text
                            })
                            last_processed_sample_index += len(unprocessed_audio)
                        else:
                            await websocket.send_json({"type": "preview_ack", "chunks_received": len(audio_chunks)})
                    else:
                        await websocket.send_json({"type": "preview_ack", "chunks_received": len(audio_chunks)})
                finally:
                    if slice_path and os.path.exists(slice_path):
                        try: os.remove(slice_path)
                        except Exception: pass
            except Exception as e:
                logger.debug(f"Live VAD incremental decode failed: {e}")
                await websocket.send_json({"type": "preview_ack", "chunks_received": len(audio_chunks)})

        while True:
            message = await websocket.receive()
            
            if "bytes" in message:
                # Audio chunk received — accumulate it
                chunk_data = message["bytes"]
                audio_chunks.append(chunk_data)
                
                # Single-Pass VAD streaming: check for natural speech pauses
                try:
                    import tempfile
                    import os
                    import soundfile as sf
                    import librosa
                    import torch
                    
                    tmp_path = None
                    try:
                        with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
                            tmp.write(b"".join(audio_chunks))
                            tmp_path = tmp.name
                        
                        audio_full, _ = librosa.load(tmp_path, sr=SAMPLE_RATE, mono=True)
                        audio_unprocessed = audio_full[last_processed_sample_index : len(audio_full)]
                        
                        should_process = False
                        end_sample_in_unprocessed = 0
                        
                        # Check Silero VAD if we have at least 1.0s of unprocessed audio
                        if len(audio_unprocessed) >= int(1.0 * SAMPLE_RATE):
                            models = websocket.app.state.models
                            vad_model = models.get("vad") if models else None
                            
                            if vad_model:
                                audio_tensor = torch.from_numpy(audio_unprocessed).float()
                                speech_ts = vad_model["get_speech_timestamps"](
                                    audio_tensor, vad_model["model"], sampling_rate=SAMPLE_RATE,
                                    min_speech_duration_ms=200, min_silence_duration_ms=500
                                )
                                if speech_ts:
                                    last_end = speech_ts[-1]["end"]
                                    # Trigger if >= 600ms silence after speech, or if chunk grew > 20.0s
                                    if len(audio_unprocessed) - last_end >= int(0.6 * SAMPLE_RATE) or len(audio_unprocessed) >= int(20.0 * SAMPLE_RATE):
                                        should_process = True
                                        if len(audio_unprocessed) - last_end >= int(0.6 * SAMPLE_RATE):
                                            end_sample_in_unprocessed = min(len(audio_unprocessed), last_end + int(0.2 * SAMPLE_RATE))
                                        elif len(speech_ts) > 1:
                                            end_sample_in_unprocessed = speech_ts[-2]["end"] + int(0.2 * SAMPLE_RATE)
                                        else:
                                            end_sample_in_unprocessed = last_end
                            else:
                                # Fallback timer if VAD model is unavailable
                                if len(audio_unprocessed) >= int(3.0 * SAMPLE_RATE):
                                    should_process = True
                                    end_sample_in_unprocessed = len(audio_unprocessed)
                        
                        if should_process and end_sample_in_unprocessed > 0:
                            # Only spawn a new VAD task if one isn't currently running
                            # This prevents the CPU from backing up and blocking the main thread
                            if vad_task is None or vad_task.done():
                                audio_slice = audio_unprocessed[0 : end_sample_in_unprocessed]
                                current_index = last_processed_sample_index
                                vad_task = asyncio.create_task(process_vad(audio_slice, current_index))
                            else:
                                await websocket.send_json({"type": "preview_ack", "chunks_received": len(audio_chunks)})
                        else:
                            await websocket.send_json({"type": "preview_ack", "chunks_received": len(audio_chunks)})
                    finally:
                        if tmp_path and os.path.exists(tmp_path):
                            try: os.remove(tmp_path)
                            except Exception: pass
                except Exception as e:
                    logger.debug(f"Live VAD incremental decode failed: {e}")
                    await websocket.send_json({"type": "preview_ack", "chunks_received": len(audio_chunks)})
            
            elif "text" in message:
                import json
                try:
                    msg = json.loads(message["text"])
                except json.JSONDecodeError:
                    msg = {"type": message["text"]}
                
                if msg.get("type") == "stop":
                    # Cancel any running VAD task
                    if vad_task and not vad_task.done():
                        vad_task.cancel()

                    # Save complete audio to disk
                    filepath = await _save_audio(job_id, audio_chunks)
                    
                    if filepath:
                        create_job(job_id, str(filepath))
                        
                        logger.info(f"Recording stopped. Queued background job {job_id} for high-accuracy final processing.")
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
