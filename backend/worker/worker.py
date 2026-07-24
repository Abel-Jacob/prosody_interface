"""
Background Worker — Sequential Job Processor

This is the core of the job-queue architecture. A single long-running
background task that:
1. Polls the SQLite job table for queued jobs
2. Processes them ONE AT A TIME, sequentially (never concurrently)
3. For each job: VAD chunk → ASR → prosody per chunk → merge → done
4. Updates progress after each chunk so the frontend can poll real values
5. Frees memory after each chunk (del array, gc.collect)
6. On chunk failure: logs error, marks chunk, continues remaining chunks

Started at app launch, independent of any individual request.
"""

import asyncio
import gc
import logging
import time
import traceback
import numpy as np
from typing import Optional

from database import (
    get_next_queued_job,
    update_job_status,
    update_job_progress,
)
from config import WORKER_POLL_INTERVAL_SEC
from schemas import PhraseResult, WordResult, JobResult

logger = logging.getLogger(__name__)


class Worker:
    """Background worker that processes jobs from the queue."""

    def __init__(self, models: dict):
        """
        Args:
            models: Dict of pre-loaded models from models/loader.py.
                    Keys: 'asr', 'whistress', 'vad'
        """
        self.models = models
        self._running = False

    async def run(self):
        """Main worker loop. Call this as a background task at app startup."""
        self._running = True
        logger.info("Worker started — polling for jobs")

        while self._running:
            try:
                job = get_next_queued_job()
                if job is not None:
                    await self._process_job(job)
                else:
                    await asyncio.sleep(WORKER_POLL_INTERVAL_SEC)
            except Exception as e:
                logger.error(f"Worker loop error: {e}", exc_info=True)
                await asyncio.sleep(WORKER_POLL_INTERVAL_SEC)

    def stop(self):
        """Signal the worker to stop after current job finishes."""
        self._running = False
        logger.info("Worker stop requested")

    async def _process_job(self, job: dict):
        """Process a single job through the full pipeline."""
        job_id = job["job_id"]
        filepath = job["filepath"]
        logger.info(f"Processing job {job_id}: {filepath}")

        update_job_status(job_id, "processing")

        try:
            # Import pipeline modules here to avoid circular imports
            from pipeline.vad_chunking import chunk_audio_by_vad
            from pipeline.asr import transcribe_chunk
            from pipeline.prosody_registry import get_active_analyzers
            from pipeline.merge import merge_chunk_results

            # Stage 1: Load and chunk audio by VAD
            update_job_progress(job_id, 0.05, 0, current_stage="loading_audio")
            audio, duration = await asyncio.to_thread(
                self._load_audio, filepath
            )
            logger.info(f"Job {job_id}: loaded audio, duration={duration:.1f}s")

            update_job_progress(job_id, 0.10, 0, current_stage="vad_chunking")
            chunks = await asyncio.to_thread(
                chunk_audio_by_vad, audio, self.models.get("vad")
            )
            total_chunks = len(chunks)
            logger.info(f"Job {job_id}: VAD produced {total_chunks} chunks")

            update_job_status(job_id, "processing", total_chunks=total_chunks)

            # Free the full audio buffer — we have chunks now
            del audio
            gc.collect()

            # Stage 2: Process each chunk sequentially
            all_phrases: list[PhraseResult] = []
            cumulative_offset = 0.0
            prosody_analyzers = get_active_analyzers(self.models)

            for i, chunk_info in enumerate(chunks):
                chunk_audio = chunk_info["audio"]
                chunk_start = chunk_info["start_time"]
                chunk_end = chunk_info["end_time"]
                chunk_duration = chunk_end - chunk_start

                stage_label = f"chunk_{i+1}_of_{total_chunks}"
                logger.info(
                    f"Job {job_id}: processing chunk {i+1}/{total_chunks} "
                    f"({chunk_start:.1f}s - {chunk_end:.1f}s)"
                )

                try:
                    # (a) ASR transcription
                    update_job_progress(
                        job_id,
                        0.10 + (0.80 * i / total_chunks),
                        i,
                        current_stage=f"transcribing_chunk_{i+1}",
                    )
                    asr_result = await asyncio.to_thread(
                        transcribe_chunk,
                        chunk_audio,
                        self.models.get("asr"),
                    )

                    # (b) Prosody analysis (stress detection + future modules)
                    update_job_progress(
                        job_id,
                        0.10 + (0.80 * (i + 0.5) / total_chunks),
                        i,
                        current_stage=f"analyzing_chunk_{i+1}",
                    )
                    prosody_results = {}
                    for analyzer in prosody_analyzers:
                        try:
                            result = await asyncio.to_thread(
                                analyzer.analyze, chunk_audio, asr_result["words"]
                            )
                            prosody_results[analyzer.name] = result
                        except Exception as ae:
                            logger.warning(
                                f"Job {job_id}: prosody analyzer '{analyzer.name}' "
                                f"failed on chunk {i+1}: {ae}"
                            )
                            prosody_results[analyzer.name] = {"error": str(ae)}

                    # (c) Build phrase result with correct time_offset
                    phrase = merge_chunk_results(
                        chunk_index=i,
                        asr_result=asr_result,
                        prosody_results=prosody_results,
                        time_offset=chunk_start,  # Use actual chunk start from VAD
                    )
                    all_phrases.append(phrase)

                except Exception as chunk_err:
                    logger.error(
                        f"Job {job_id}: chunk {i+1} failed: {chunk_err}",
                        exc_info=True,
                    )
                    # Create a placeholder phrase for the failed chunk
                    all_phrases.append(
                        PhraseResult(
                            phrase_index=i,
                            text=f"[chunk {i+1} failed: {str(chunk_err)[:100]}]",
                            words=[],
                            start_time=chunk_start,
                            end_time=chunk_end,
                            chunk_index=i,
                        )
                    )

                finally:
                    # (d) Free chunk memory
                    del chunk_audio
                    gc.collect()

                    # Update progress with partial results
                    partial = self._build_result(all_phrases, duration)
                    update_job_progress(
                        job_id,
                        0.10 + (0.80 * (i + 1) / total_chunks),
                        i + 1,
                        current_stage=stage_label,
                        partial_result=partial.model_dump(),
                    )

            # Stage 3: Finalize
            update_job_progress(job_id, 0.95, total_chunks, current_stage="finalizing")
            final_result = self._build_result(all_phrases, duration)

            update_job_status(
                job_id, "complete",
                progress=1.0,
                completed_chunks=total_chunks,
                current_stage="done",
                result=final_result.model_dump(),
            )
            logger.info(
                f"Job {job_id}: complete — {len(all_phrases)} phrases, "
                f"{final_result.word_count} words, {final_result.wpm:.0f} WPM"
            )

        except Exception as e:
            logger.error(f"Job {job_id} failed: {e}", exc_info=True)
            update_job_status(
                job_id, "failed",
                error=f"{type(e).__name__}: {str(e)}\n{traceback.format_exc()[-500:]}",
            )

    def _load_audio(self, filepath: str) -> tuple[np.ndarray, float]:
        """Load audio file, convert to 16kHz mono float32 numpy array."""
        import librosa
        audio, sr = librosa.load(filepath, sr=16000, mono=True)
        duration = len(audio) / sr
        return audio, duration

    def _build_result(self, phrases: list[PhraseResult], duration: float) -> JobResult:
        """Build a JobResult from accumulated phrases."""
        all_words = []
        for p in phrases:
            all_words.extend(p.words)

        word_count = len(all_words)
        stressed_count = sum(1 for w in all_words if w.stressed)
        minutes = duration / 60.0 if duration > 0 else 1.0
        wpm = word_count / minutes if minutes > 0 else 0.0
        stress_ratio = stressed_count / word_count if word_count > 0 else 0.0

        return JobResult(
            phrases=[p for p in phrases],
            total_duration=duration,
            word_count=word_count,
            wpm=wpm,
            stress_ratio=stress_ratio,
        )
