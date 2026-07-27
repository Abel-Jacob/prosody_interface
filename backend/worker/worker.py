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
            from pipeline.merge import group_words_by_punctuation
            from schemas import PhraseResult, WordResult

            # Stage 1: Load audio
            update_job_progress(job_id, 0.05, 0, current_stage="loading_audio")
            audio, duration = await asyncio.to_thread(
                self._load_audio, filepath
            )
            logger.info(f"Job {job_id}: loaded audio, duration={duration:.1f}s")

            # Stage 2: Transcribe full audio in one pass for 100% perfect grammar and punctuation
            update_job_progress(job_id, 0.15, 0, current_stage="transcribing_full_audio")
            asr_result = await asyncio.to_thread(
                transcribe_chunk,
                audio,
                self.models.get("asr_final"),
                "en",
            )
            
            # Group into natural grammatical sentences based strictly on the model's output punctuation
            raw_words = [
                WordResult(
                    word=w["word"],
                    start=round(w["start"], 3),
                    end=round(w["end"], 3),
                    confidence=round(w.get("confidence", 1.0), 3),
                    stressed=False,
                    stress_score=0.0,
                )
                for w in asr_result.get("words", [])
            ]
            
            grammatical_phrases = group_words_by_punctuation(raw_words)
            total_sentences = len(grammatical_phrases)
            logger.info(f"Job {job_id}: full ASR complete -> {total_sentences} grammatical sentences")

            update_job_status(job_id, "processing", total_chunks=total_sentences)

            # Stage 3: Analyze prosody (word stress) on each grammatical sentence
            prosody_analyzers = get_active_analyzers(self.models)
            for idx, phrase in enumerate(grammatical_phrases):
                phrase.phrase_index = idx
                phrase.chunk_index = idx
                
                start_sample = max(0, int(phrase.start_time * self.models.get("sample_rate", 16000)))
                end_sample = min(len(audio), int(phrase.end_time * self.models.get("sample_rate", 16000)))
                sentence_audio = audio[start_sample:end_sample]

                for analyzer in prosody_analyzers:
                    try:
                        res = await asyncio.to_thread(
                            analyzer.analyze, sentence_audio, [w.model_dump() for w in phrase.words]
                        )
                        if "word_stress" in res:
                            from pipeline.merge import _find_stress_match
                            for i, w in enumerate(phrase.words):
                                match = _find_stress_match(w.word, i, res["word_stress"])
                                if match:
                                    w.stressed = match["stressed"]
                                    w.stress_score = match.get("stress_score", 1.0 if match["stressed"] else 0.0)
                    except Exception as ae:
                        logger.warning(f"Job {job_id}: analyzer '{analyzer.name}' failed on sentence {idx+1}: {ae}")

                update_job_progress(
                    job_id,
                    0.20 + (0.75 * (idx + 1) / max(1, total_sentences)),
                    idx + 1,
                    current_stage=f"analyzing_sentence_{idx+1}_of_{total_sentences}",
                    partial_result=self._build_result(grammatical_phrases[:idx+1], duration).model_dump(),
                )

            # Free audio buffer
            del audio
            gc.collect()

            # Stage 4: Finalize
            update_job_progress(job_id, 0.95, total_sentences, current_stage="finalizing")
            final_result = self._build_result(grammatical_phrases, duration)

            update_job_status(
                job_id, "complete",
                progress=1.0,
                completed_chunks=total_sentences,
                current_stage="done",
                result=final_result.model_dump(),
            )
            logger.info(
                f"Job {job_id}: complete — {len(grammatical_phrases)} phrases, "
                f"{final_result.word_count} words, {final_result.wpm:.0f} WPM"
            )

        except Exception as e:
            logger.error(f"Job {job_id} failed: {e}", exc_info=True)
            update_job_status(
                job_id, "failed",
                error=f"{type(e).__name__}: {str(e)}\n{traceback.format_exc()[-500:]}",
            )
        finally:
            import os
            try:
                if os.path.exists(filepath):
                    os.remove(filepath)
                    logger.info(f"Cleaned up audio file: {filepath}")
            except Exception as cleanup_err:
                logger.warning(f"Failed to clean up audio file {filepath}: {cleanup_err}")

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
