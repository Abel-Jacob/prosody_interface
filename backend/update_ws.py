import sys

with open('c:/Users/DELL/Desktop/prosody_interface/backend/api/websocket.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix 1: Add stop_handled flag and duplicate job prevention
content = content.replace(
    '    job_id = str(uuid.uuid4())\n    \n    try:\n        vad_task = None',
    '    job_id = str(uuid.uuid4())\n    stop_handled = False\n    \n    try:\n        vad_task = None'
)

# Fix 2: Stop block logic
old_stop_block = """                if msg.get("type") == "stop":
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
                    
                    break  # Close connection after stop"""

new_stop_block = """                if msg.get("type") == "stop":
                    if not stop_handled:
                        stop_handled = True
                        # Cancel any running VAD task
                        if vad_task and not vad_task.done():
                            vad_task.cancel()

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
                    break  # Close connection after stop"""

content = content.replace(old_stop_block, new_stop_block)

# Fix 3: WebSocketDisconnect logic
old_disconnect_block = """    except WebSocketDisconnect:
        logger.info("WebSocket disconnected")
        # If we have audio but didn't get a stop signal, save anyway
        if audio_chunks:
            filepath = await _save_audio(job_id, audio_chunks)
            if filepath:
                create_job(job_id, str(filepath))
                logger.info(f"Saved orphaned recording as job {job_id}")"""

new_disconnect_block = """    except WebSocketDisconnect:
        logger.info("WebSocket disconnected")
        # If we have audio but didn't get a stop signal, save anyway
        if audio_chunks and not stop_handled:
            stop_handled = True
            filepath = await _save_audio(job_id, audio_chunks)
            if filepath:
                create_job(job_id, str(filepath))
                logger.info(f"Saved orphaned recording as job {job_id}")"""

content = content.replace(old_disconnect_block, new_disconnect_block)

# Fix 4: Snowballing buffer logic
old_vad_logic = """                        if should_process and end_sample_in_unprocessed > 0:
                            # Only spawn a new VAD task if one isn't currently running
                            # This prevents the CPU from backing up and blocking the main thread
                            if vad_task is None or vad_task.done():
                                audio_slice = audio_unprocessed[0 : end_sample_in_unprocessed]
                                current_index = last_processed_sample_index
                                last_processed_sample_index += end_sample_in_unprocessed
                                vad_task = asyncio.create_task(process_vad(audio_slice, current_index))
                            else:
                                await websocket.send_json({"type": "preview_ack", "chunks_received": len(audio_chunks)})
                        else:
                            await websocket.send_json({"type": "preview_ack", "chunks_received": len(audio_chunks)})"""

new_vad_logic = """                        if should_process and end_sample_in_unprocessed > 0:
                            # Only spawn a new VAD task if one isn't currently running
                            # This prevents the CPU from backing up and blocking the main thread
                            if vad_task is None or vad_task.done():
                                audio_slice = audio_unprocessed[0 : end_sample_in_unprocessed]
                                current_index = last_processed_sample_index
                                last_processed_sample_index += end_sample_in_unprocessed
                                vad_task = asyncio.create_task(process_vad(audio_slice, current_index))
                            else:
                                # LIVE PREVIEW FELL BEHIND!
                                # Advance the index anyway to prevent O(N^2) snowballing.
                                # This drops the chunk from the live preview, ensuring the preview stays fast.
                                logger.warning(f"Live preview skipping a {end_sample_in_unprocessed/SAMPLE_RATE:.1f}s chunk to maintain real-time speed.")
                                last_processed_sample_index += end_sample_in_unprocessed
                                try:
                                    await websocket.send_json({"type": "preview_ack", "chunks_received": len(audio_chunks)})
                                except Exception:
                                    pass
                        else:
                            try:
                                await websocket.send_json({"type": "preview_ack", "chunks_received": len(audio_chunks)})
                            except Exception:
                                pass"""

content = content.replace(old_vad_logic, new_vad_logic)

# Replace all plain await websocket.send_json with try/except in the process_vad function as well to prevent ConnectionClosed crashes
content = content.replace(
    'await websocket.send_json({"type": "preview_ack", "chunks_received": len(audio_chunks)})',
    'try:\n                                await websocket.send_json({"type": "preview_ack", "chunks_received": len(audio_chunks)})\n                            except Exception:\n                                pass'
)

# And in send_json in process_vad
content = content.replace(
    '                            await websocket.send_json({\n                                "type": "incremental_words",',
    '                            try:\n                                await websocket.send_json({\n                                    "type": "incremental_words",'
)
content = content.replace(
    '                            await websocket.send_json({\n                                            "type": "incremental_words",',
    '                            try:\n                                await websocket.send_json({\n                                                "type": "incremental_words",'
)
content = content.replace(
    '                                            "text": full\n                                        })',
    '                                            "text": full\n                                        })\n                            except Exception:\n                                pass'
)
content = content.replace(
    '                                "text": full_text\n                            })',
    '                                "text": full_text\n                                })\n                            except Exception:\n                                pass'
)

# Move imports to top of the while block
content = content.replace(
    '                    import tempfile\n                    import os\n                    import soundfile as sf\n                    import librosa\n                    import torch',
    ''
)

content = content.replace(
    '                import tempfile\n                import os\n                import soundfile as sf',
    ''
)

content = content.replace(
    'import io\nfrom pathlib import Path',
    'import io\nfrom pathlib import Path\nimport tempfile\nimport os\nimport soundfile as sf\nimport librosa\nimport torch\nimport json'
)

content = content.replace(
    '                import json\n                try:',
    '                try:'
)

with open('c:/Users/DELL/Desktop/prosody_interface/backend/api/websocket.py', 'w', encoding='utf-8') as f:
    f.write(content)

print("Done updating websocket.py")
