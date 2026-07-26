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
                                    min_speech_duration_ms=200, min_silence_duration_ms=250
                                )
                                if speech_ts:
                                    last_end = speech_ts[-1]["end"]
                                    # Trigger if >= 250ms silence after speech, or if chunk grew > 6.5s
                                    if len(audio_unprocessed) - last_end >= int(0.25 * SAMPLE_RATE) or len(audio_unprocessed) >= int(6.5 * SAMPLE_RATE):
                                        should_process = True
                                        end_sample_in_unprocessed = min(len(audio_unprocessed), last_end + int(0.15 * SAMPLE_RATE))
                            else:
                                # Fallback timer if VAD model is unavailable
                                if len(audio_unprocessed) >= int(3.0 * SAMPLE_RATE):
                                    should_process = True
                                    end_sample_in_unprocessed = len(audio_unprocessed)
                        
                        if should_process and end_sample_in_unprocessed > 0:
                            audio_slice = audio_unprocessed[0 : end_sample_in_unprocessed]
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
                                                res = await asyncio.to_thread(
                                                    analyzer.analyze, audio_slice, asr_result["words"]
                                                )
                                                prosody_results[analyzer.name] = res
                                            except Exception as ae:
                                                logger.debug(f"Live prosody failed: {ae}")
                                                prosody_results[analyzer.name] = {"error": str(ae)}
                                    
                                    phrase = merge_chunk_results(
                                        chunk_index=len(all_phrases),
                                        asr_result=asr_result,
                                        prosody_results=prosody_results,
                                        time_offset=slice_offset,
                                    )
                                    
                                    if phrase.words:
                                        all_phrases.append(phrase)
                                        formatted_words = [w.model_dump() for w in phrase.words]
                                        logger.info(f"Single-Pass VAD Phrase: '{phrase.text}' ({len(formatted_words)} words)")
                                        await websocket.send_json({
                                            "type": "incremental_words",
                                            "words": formatted_words,
                                            "text": phrase.text
                                        })
                                        last_processed_sample_index += end_sample_in_unprocessed
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
                    logger.debug(f"Live VAD incremental decode failed: {e}")
                    await websocket.send_json({"type": "preview_ack", "chunks_received": len(audio_chunks)})
            
            elif "text" in message:
                import json
                try:
                    msg = json.loads(message["text"])
                except json.JSONDecodeError:
                    msg = {"type": message["text"]}
                
                if msg.get("type") == "stop":
                    # Check if there is remaining unprocessed audio at stop
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
                            audio_unprocessed = audio_full[last_processed_sample_index : len(audio_full)]
                            
                            if len(audio_unprocessed) >= int(0.2 * SAMPLE_RATE):
                                slice_offset = last_processed_sample_index / float(SAMPLE_RATE)
                                slice_path = None
                                try:
                                    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as stmp:
                                        sf.write(stmp.name, audio_unprocessed, SAMPLE_RATE)
                                        slice_path = stmp.name
                                    
                                    models = websocket.app.state.models
                                    asr_model = models.get("asr_final") or models.get("asr_preview") if models else None
                                    if asr_model:
                                        from pipeline.asr import transcribe_chunk
                                        asr_result = await asyncio.to_thread(transcribe_chunk, slice_path, asr_model, "en", last_prompt)
                                        if asr_result.get("text"):
                                            last_prompt = asr_result["text"][-150:]
                                        
                                        prosody_results = {}
                                        if models:
                                            from pipeline.prosody_registry import get_active_analyzers
                                            for analyzer in get_active_analyzers(models):
                                                try:
                                                    res = await asyncio.to_thread(analyzer.analyze, audio_unprocessed, asr_result["words"])
                                                    prosody_results[analyzer.name] = res
                                                except Exception:
                                                    pass
                                        
                                        phrase = merge_chunk_results(len(all_phrases), asr_result, prosody_results, slice_offset)
                                        if phrase.words:
                                            all_phrases.append(phrase)
                                            await websocket.send_json({
                                                "type": "incremental_words",
                                                "words": [w.model_dump() for w in phrase.words],
                                                "text": phrase.text
                                            })
                                finally:
                                    if slice_path and os.path.exists(slice_path):
                                        try: os.remove(slice_path)
                                        except Exception: pass
                        finally:
                            if tmp_path and os.path.exists(tmp_path):
                                try: os.remove(tmp_path)
                                except Exception: pass
                    except Exception as fe:
                        logger.debug(f"Final slice processing failed: {fe}")

                    # Save complete audio to disk
                    filepath = await _save_audio(job_id, audio_chunks)
                    
                    if filepath:
                        create_job(job_id, str(filepath))
                        
                        # Build final JobResult from accumulated single-pass phrases, reconstructed for proper grammar and sentence boundaries
                        reconstructed_phrases = reconstruct_grammatical_phrases(all_phrases)
                        all_words = []
                        for p in reconstructed_phrases:
                            all_words.extend(p.words)
                        
                        duration = len(audio_full) / float(SAMPLE_RATE) if 'audio_full' in locals() and len(audio_full) > 0 else 1.0
                        word_count = len(all_words)
                        stressed_count = sum(1 for w in all_words if w.stressed)
                        minutes = duration / 60.0 if duration > 0 else 1.0
                        wpm = word_count / minutes if minutes > 0 else 0.0
                        stress_ratio = stressed_count / word_count if word_count > 0 else 0.0
                        
                        final_result = JobResult(
                            phrases=reconstructed_phrases,
                            total_duration=duration,
                            word_count=word_count,
                            wpm=wpm,
                            stress_ratio=stress_ratio,
                        )
                        
                        # Mark job as complete immediately — NO second run in background!
                        update_job_status(
                            job_id, "complete",
                            progress=1.0,
                            completed_chunks=len(reconstructed_phrases),
                            current_stage="done",
                            result=final_result.model_dump(),
                        )
                        logger.info(f"Single-Pass Recording Stopped & Completed! Job {job_id}")
                        
                        await websocket.send_json({
                            "type": "job_completed",
                            "job_id": job_id,
                            "result": final_result.model_dump(),
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
