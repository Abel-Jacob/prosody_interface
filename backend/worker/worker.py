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
from pathlib import Path

from database import (
    get_next_queued_job,
    update_job_status,
    update_job_progress,
)
from config import WORKER_POLL_INTERVAL_SEC
from schemas import (
    PhraseResult,
    WordResult,
    JobResult,
    PhraseIntonation,
    BatchFileItem,
    BatchJobResult,
)

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

        path_obj = Path(filepath)
        if path_obj.is_dir() or path_obj.name.startswith("batch_"):
            await self._process_batch_job(job)
            return

        update_job_status(job_id, "processing")

        try:
            # Import pipeline modules here to avoid circular imports
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
            
            is_upload = Path(filepath).name.startswith("upload_")

            # Stage 2: Transcribe full audio in one pass for 100% perfect grammar and punctuation
            update_job_progress(job_id, 0.15, 0, current_stage="transcribing_full_audio")
            asr_result = await asyncio.to_thread(
                transcribe_chunk,
                audio,
                self.models.get("asr_final"),
                "en",
                is_live=is_upload,
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
            sr = self.models.get("sample_rate", 16000)
            for idx, phrase in enumerate(grammatical_phrases):
                phrase.phrase_index = idx
                phrase.chunk_index = idx
                
                start_sample = max(0, int(phrase.start_time * sr))
                end_sample = min(len(audio), int(phrase.end_time * sr))
                sentence_audio = audio[start_sample:end_sample]

                # Pre-serialize word dicts once — reused by all analyzers
                word_dicts = [w.model_dump() for w in phrase.words]

                for analyzer in prosody_analyzers:
                    if is_upload and analyzer.name == "stress":
                        continue
                    try:
                        res = await asyncio.to_thread(
                            analyzer.analyze, sentence_audio, word_dicts
                        )
                        # Apply stress results
                        if "word_stress" in res:
                            from pipeline.merge import _find_stress_match
                            for i, w in enumerate(phrase.words):
                                match = _find_stress_match(w.word, i, res["word_stress"])
                                if match:
                                    w.stressed = match["stressed"]
                                    w.stress_score = match.get("stress_score", 1.0 if match["stressed"] else 0.0)
                        # Apply pause & hesitation results
                        if "word_pauses" in res:
                            pause_words = res["word_pauses"]
                            for i, w in enumerate(phrase.words):
                                if i < len(pause_words):
                                    w.pause_after = pause_words[i].get("pause_after", 0.0)
                                    w.is_hesitation = pause_words[i].get("is_hesitation", False)
                        # Apply intonation / pitch results
                        if "word_intonation" in res:
                            inton_words = res["word_intonation"]
                            for i, w in enumerate(phrase.words):
                                if i < len(inton_words):
                                    w.pitch_mean = inton_words[i].get("pitch_mean")
                                    w.pitch_direction = inton_words[i].get("pitch_direction")
                                    w.pitch_range = inton_words[i].get("pitch_range", 0.0)
                                    w.pitch_contour = inton_words[i].get("pitch_contour", [])
                            # Sentence-level intonation pattern
                            if "intonation_pattern" in res:
                                phrase.intonation_pattern = res["intonation_pattern"]
                        # Apply syllable-level stress results (LexiRep)
                        if "word_syllables" in res:
                            from schemas import SyllableResult
                            syl_data = res["word_syllables"]
                            for syl_entry in syl_data:
                                # Match by start time (more reliable than word text for punctuation)
                                entry_start = syl_entry.get("start", -1)
                                entry_word = syl_entry.get("word", "")
                                for w in phrase.words:
                                    if abs(w.start - entry_start) < 0.01:
                                        raw_syls = syl_entry.get("syllables")
                                        if raw_syls is not None:
                                            w.syllables = [
                                                SyllableResult(
                                                    text=s["text"],
                                                    stressed=s["stressed"],
                                                    stress_margin=s.get("stress_margin", 0.0),
                                                    models=s.get("models"),
                                                )
                                                for s in raw_syls
                                            ]
                                        break
                    except Exception as ae:
                        logger.warning(f"Job {job_id}: analyzer '{analyzer.name}' failed on sentence {idx+1}: {ae}")

                # Emit partial results every 3 sentences (or on the last one)
                # to avoid O(N²) serialization from rebuilding the full result each time
                is_last = (idx == total_sentences - 1)
                if is_last or (idx + 1) % 3 == 0:
                    update_job_progress(
                        job_id,
                        0.20 + (0.55 * (idx + 1) / max(1, total_sentences)),
                        idx + 1,
                        current_stage=f"analyzing_sentence_{idx+1}_of_{total_sentences}",
                        partial_result=self._build_result(grammatical_phrases[:idx+1], duration).model_dump(),
                    )
                else:
                    update_job_progress(
                        job_id,
                        0.20 + (0.55 * (idx + 1) / max(1, total_sentences)),
                        idx + 1,
                        current_stage=f"analyzing_sentence_{idx+1}_of_{total_sentences}",
                    )

            # Stage 3.5: Full-audio pitch stylization (MAE algorithm)
            # PitchAnalyzer needs the complete audio to build a globally coherent
            # stylized contour, so it runs once on all words after per-sentence analysis.
            update_job_progress(job_id, 0.78, total_sentences, current_stage="pitch_stylization")
            from pipeline.prosody_registry import get_full_audio_analyzers
            full_audio_analyzers = get_full_audio_analyzers(self.models)

            # Gather all phrase dicts for full-audio analysis
            phrase_dicts = [
                {
                    "phrase_index": p.phrase_index,
                    "start_time": p.start_time,
                    "end_time": p.end_time,
                    "words": [w.model_dump() for w in p.words],
                }
                for p in grammatical_phrases
            ]

            # Stage 3: Full-audio analysis (serial sequence of full-signal modules)
            update_job_progress(job_id, 0.85, total_sentences, current_stage="analyzing_full_audio")
            voiced_segments_details = []
            for analyzer in full_audio_analyzers:
                try:
                    logger.info(f"Job {job_id}: running full-audio '{analyzer.name}' analyzer...")
                    res = await asyncio.to_thread(
                        analyzer.analyze, audio, phrase_dicts
                    )
                    if "voiced_segments" in res:
                        voiced_segments_details = res["voiced_segments"]
                    # Apply pitch results back to phrase objects
                    if "phrase_pitch" in res and res["phrase_pitch"]:
                        pitch_data = res["phrase_pitch"]
                        for i, p in enumerate(grammatical_phrases):
                            if i < len(pitch_data):
                                pd = pitch_data[i]
                                if pd.get("mean_pitch") is not None:
                                    p.intonation = PhraseIntonation(
                                        mean_pitch=pd.get("mean_pitch"),
                                        max_pitch=pd.get("max_pitch"),
                                        min_pitch=pd.get("min_pitch"),
                                        start_pitch=pd.get("start_pitch"),
                                        end_pitch=pd.get("end_pitch"),
                                        pitch_slope=pd.get("pitch_slope"),
                                        pitch_range=pd.get("pitch_range"),
                                        normalized_pitch=pd.get("normalized_pitch"),
                                        pitch_trend=pd.get("pitch_trend"),
                                        voiced_segment_index=pd.get("voiced_segment_index"),
                                    )
                                else:
                                    p.intonation = None
                    if "word_pitch" in res and res["word_pitch"]:
                        wp_map = {
                            (w.get("start"), w.get("end")): w
                            for w in res["word_pitch"]
                        }
                        for p in grammatical_phrases:
                            for w in p.words:
                                key = (w.start, w.end)
                                if key in wp_map:
                                    wp = wp_map[key]
                                    w.mean_pitch = wp.get("mean_pitch")
                                    w.max_pitch = wp.get("max_pitch")
                                    w.min_pitch = wp.get("min_pitch")
                                    w.start_pitch = wp.get("start_pitch")
                                    w.end_pitch = wp.get("end_pitch")
                                    w.pitch_slope = wp.get("pitch_slope")
                                    w.pitch_range = wp.get("pitch_range")
                                    w.normalized_pitch = wp.get("normalized_pitch")
                                    w.pitch_trend = wp.get("pitch_trend")
                                    w.char_pitches = wp.get("char_pitches")
                                    w.voiced_segment_index = wp.get("voiced_segment_index")
                    logger.info(
                        f"Job {job_id}: pitch analysis complete — "
                        f"{sum(1 for pd in pitch_data if pd.get('mean_pitch') is not None)} "
                        f"phrases with pitch data"
                    )
                except Exception as ae:
                    logger.warning(f"Job {job_id}: full-audio analyzer '{analyzer.name}' failed: {ae}", exc_info=True)

            # Free audio buffer
            del audio
            gc.collect()

            # Stage 4: Finalize
            update_job_progress(job_id, 0.95, total_sentences, current_stage="finalizing")
            final_result = self._build_result(grammatical_phrases, duration, voiced_segments_details)

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

    def _build_result(self, phrases: list[PhraseResult], duration: float, voiced_segments: list[dict] = None) -> JobResult:
        """Build a JobResult from accumulated phrases."""
        all_words = []
        for p in phrases:
            all_words.extend(p.words)

        word_count = len(all_words)
        stressed_count = sum(1 for w in all_words if w.stressed)
        minutes = duration / 60.0 if duration > 0 else 1.0
        wpm = word_count / minutes if minutes > 0 else 0.0
        stress_ratio = stressed_count / word_count if word_count > 0 else 0.0

        # Pitch variation: std-dev of pitch_mean across all voiced words
        pitch_means = [w.pitch_mean for w in all_words if w.pitch_mean is not None]
        pitch_variation = float(np.std(pitch_means)) if len(pitch_means) >= 2 else 0.0

        return JobResult(
            phrases=[p for p in phrases],
            total_duration=duration,
            word_count=word_count,
            wpm=wpm,
            stress_ratio=stress_ratio,
            pitch_variation=round(pitch_variation, 1),
            voiced_segments=voiced_segments or [],
        )

    async def _process_batch_job(self, job: dict):
        """
        Process a batch job containing multiple audio files or extracted zip archive.
        Sequential, file-by-file processing with per-file error isolation,
        frequent memory cleanup, and live progress reporting.
        """
        job_id = job["job_id"]
        batch_dir = Path(job["filepath"])
        logger.info(f"Processing batch job {job_id} at {batch_dir}")

        update_job_status(job_id, "processing")

        SUPPORTED_EXTENSIONS = {".wav", ".mp3", ".ogg", ".webm", ".flac", ".m4a"}
        audio_files = sorted(
            [p for p in batch_dir.rglob("*") if p.is_file() and p.suffix.lower() in SUPPORTED_EXTENSIONS],
            key=lambda p: p.name.lower()
        )

        total_files = len(audio_files)
        if total_files == 0:
            logger.warning(f"Batch job {job_id} has no valid audio files in {batch_dir}")
            update_job_status(job_id, "failed", error="No valid audio files found in uploaded batch.")
            return

        update_job_status(job_id, "processing", total_chunks=total_files)

        from pipeline.asr import transcribe_chunk
        from pipeline.prosody_registry import get_active_analyzers, get_full_audio_analyzers
        from pipeline.merge import group_words_by_punctuation, _find_stress_match
        from pipeline.annotation import build_annotation
        from schemas import PhraseResult, WordResult, SyllableResult, PhraseIntonation, BatchFileItem, BatchJobResult

        batch_files: list[BatchFileItem] = []
        completed_count = 0
        failed_count = 0
        total_duration = 0.0
        total_words = 0

        sr = self.models.get("sample_rate", 16000)

        for idx, file_path in enumerate(audio_files):
            file_num = idx + 1
            filename = file_path.name
            current_stage = f"file_{file_num}_of_{total_files}: {filename}"
            progress = idx / total_files
            update_job_progress(job_id, progress, idx, current_stage=current_stage)
            logger.info(f"Job {job_id} [{file_num}/{total_files}]: processing {filename}")

            audio = None
            try:
                # 1. Load Audio
                audio, duration = await asyncio.to_thread(self._load_audio, str(file_path))
                
                # 2. Fast ASR (greedy single-pass)
                asr_result = await asyncio.to_thread(
                    transcribe_chunk,
                    audio,
                    self.models.get("asr_final"),
                    "en",
                    is_live=True,
                )

                # 3. Form grammatical phrases
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

                # 4. Sentence-level prosody analyzers (WhiStress, LexiRep, Pauses, Intonation)
                prosody_analyzers = get_active_analyzers(self.models)
                for s_idx, phrase in enumerate(grammatical_phrases):
                    phrase.phrase_index = s_idx
                    phrase.chunk_index = s_idx

                    start_sample = max(0, int(phrase.start_time * sr))
                    end_sample = min(len(audio), int(phrase.end_time * sr))
                    sentence_audio = audio[start_sample:end_sample]

                    word_dicts = [w.model_dump() for w in phrase.words]
                    for analyzer in prosody_analyzers:
                        try:
                            res = await asyncio.to_thread(analyzer.analyze, sentence_audio, word_dicts)
                            if "word_stress" in res:
                                for i, w in enumerate(phrase.words):
                                    match = _find_stress_match(w.word, i, res["word_stress"])
                                    if match:
                                        w.stressed = match["stressed"]
                                        w.stress_score = match.get("stress_score", 1.0 if match["stressed"] else 0.0)
                            if "word_pauses" in res:
                                pause_words = res["word_pauses"]
                                for i, w in enumerate(phrase.words):
                                    if i < len(pause_words):
                                        w.pause_after = pause_words[i].get("pause_after", 0.0)
                                        w.is_hesitation = pause_words[i].get("is_hesitation", False)
                            if "word_intonation" in res:
                                inton_words = res["word_intonation"]
                                for i, w in enumerate(phrase.words):
                                    if i < len(inton_words):
                                        w.pitch_mean = inton_words[i].get("pitch_mean")
                                        w.pitch_direction = inton_words[i].get("pitch_direction")
                                        w.pitch_range = inton_words[i].get("pitch_range", 0.0)
                                        w.pitch_contour = inton_words[i].get("pitch_contour", [])
                                if "intonation_pattern" in res:
                                    phrase.intonation_pattern = res["intonation_pattern"]
                            if "word_syllables" in res:
                                syl_data = res["word_syllables"]
                                for syl_entry in syl_data:
                                    entry_start = syl_entry.get("start", -1)
                                    for w in phrase.words:
                                        if abs(w.start - entry_start) < 0.01:
                                            raw_syls = syl_entry.get("syllables")
                                            if raw_syls is not None:
                                                w.syllables = [
                                                    SyllableResult(
                                                        text=s["text"],
                                                        stressed=s["stressed"],
                                                        stress_margin=s.get("stress_margin", 0.0),
                                                        models=s.get("models"),
                                                    )
                                                    for s in raw_syls
                                                ]
                                            break
                        except Exception as ae:
                            logger.warning(f"Batch {job_id} file {filename}: analyzer '{analyzer.name}' failed on sentence {s_idx+1}: {ae}")

                # 5. Full-audio pitch stylization (MAE)
                full_audio_analyzers = get_full_audio_analyzers(self.models)
                phrase_dicts = [
                    {
                        "phrase_index": p.phrase_index,
                        "start_time": p.start_time,
                        "end_time": p.end_time,
                        "words": [w.model_dump() for w in p.words],
                    }
                    for p in grammatical_phrases
                ]
                voiced_segments_details = []
                for analyzer in full_audio_analyzers:
                    try:
                        res = await asyncio.to_thread(analyzer.analyze, audio, phrase_dicts)
                        if "voiced_segments" in res:
                            voiced_segments_details = res["voiced_segments"]
                        if "phrase_pitch" in res and res["phrase_pitch"]:
                            pitch_data = res["phrase_pitch"]
                            for i, p in enumerate(grammatical_phrases):
                                if i < len(pitch_data):
                                    pd = pitch_data[i]
                                    if pd.get("mean_pitch") is not None:
                                        p.intonation = PhraseIntonation(
                                            mean_pitch=pd.get("mean_pitch"),
                                            max_pitch=pd.get("max_pitch"),
                                            min_pitch=pd.get("min_pitch"),
                                            start_pitch=pd.get("start_pitch"),
                                            end_pitch=pd.get("end_pitch"),
                                            pitch_slope=pd.get("pitch_slope"),
                                            pitch_range=pd.get("pitch_range"),
                                            normalized_pitch=pd.get("normalized_pitch"),
                                            pitch_trend=pd.get("pitch_trend"),
                                            voiced_segment_index=pd.get("voiced_segment_index"),
                                        )
                                    else:
                                        p.intonation = None
                        if "word_pitch" in res and res["word_pitch"]:
                            wp_map = {
                                (w.get("start"), w.get("end")): w
                                for w in res["word_pitch"]
                            }
                            for p in grammatical_phrases:
                                for w in p.words:
                                    key = (w.start, w.end)
                                    if key in wp_map:
                                        wp = wp_map[key]
                                        w.mean_pitch = wp.get("mean_pitch")
                                        w.max_pitch = wp.get("max_pitch")
                                        w.min_pitch = wp.get("min_pitch")
                                        w.start_pitch = wp.get("start_pitch")
                                        w.end_pitch = wp.get("end_pitch")
                                        w.pitch_slope = wp.get("pitch_slope")
                                        w.pitch_range = wp.get("pitch_range")
                                        w.normalized_pitch = wp.get("normalized_pitch")
                                        w.pitch_trend = wp.get("pitch_trend")
                                        w.char_pitches = wp.get("char_pitches")
                                        w.voiced_segment_index = wp.get("voiced_segment_index")
                    except Exception as fae:
                        logger.warning(f"Batch {job_id} file {filename}: full-audio analyzer '{analyzer.name}' failed: {fae}")

                # 6. Build file result
                file_result = self._build_result(grammatical_phrases, duration, voiced_segments_details)

                # 7. Build canonical annotation document for this file
                sub_job = {
                    "job_id": f"{job_id}_{file_num}",
                    "filename": filename,
                    "status": "complete",
                    "created_at": job.get("created_at", time.time()),
                    "completed_at": time.time(),
                    "result": file_result.model_dump(),
                }
                file_annotation = build_annotation(sub_job)
                file_annotation["filename"] = filename

                batch_files.append(
                    BatchFileItem(
                        file_id=f"file_{file_num}",
                        filename=filename,
                        status="complete",
                        duration=round(duration, 2),
                        word_count=file_result.word_count,
                        sentence_count=len(grammatical_phrases),
                        result=file_result,
                        annotation=file_annotation,
                    )
                )
                completed_count += 1
                total_duration += duration
                total_words += file_result.word_count

            except Exception as file_err:
                logger.error(f"Batch {job_id} file {filename} failed: {file_err}", exc_info=True)
                batch_files.append(
                    BatchFileItem(
                        file_id=f"file_{file_num}",
                        filename=filename,
                        status="error",
                        error=f"{type(file_err).__name__}: {str(file_err)}",
                    )
                )
                failed_count += 1

            finally:
                if audio is not None:
                    del audio
                gc.collect()
                try:
                    import torch
                    if torch.cuda.is_available():
                        torch.cuda.empty_cache()
                except Exception:
                    pass

            # Update live progress after each file
            interim_batch_result = BatchJobResult(
                is_batch=True,
                batch_name=batch_dir.name,
                total_files=total_files,
                completed_files=completed_count,
                failed_files=failed_count,
                total_duration=round(total_duration, 2),
                total_words=total_words,
                files=batch_files,
            )
            update_job_progress(
                job_id,
                progress=round(file_num / total_files, 3),
                completed_chunks=file_num,
                current_stage=f"file_{file_num}_of_{total_files}: {filename}",
                partial_result=interim_batch_result.model_dump(),
            )

        # Batch finished
        final_batch_result = BatchJobResult(
            is_batch=True,
            batch_name=batch_dir.name,
            total_files=total_files,
            completed_files=completed_count,
            failed_files=failed_count,
            total_duration=round(total_duration, 2),
            total_words=total_words,
            files=batch_files,
        )
        update_job_status(
            job_id,
            "complete",
            progress=1.0,
            completed_chunks=total_files,
            current_stage="done",
            result=final_batch_result.model_dump(),
        )
        logger.info(
            f"Batch job {job_id} complete: {completed_count}/{total_files} files successful, "
            f"{failed_count} failed, total words={total_words}, total duration={total_duration:.1f}s"
        )

        # Cleanup extracted batch dir
        try:
            import shutil
            shutil.rmtree(batch_dir, ignore_errors=True)
            logger.info(f"Cleaned up batch dir: {batch_dir}")
        except Exception as cleanup_err:
            logger.warning(f"Failed to cleanup batch dir {batch_dir}: {cleanup_err}")
