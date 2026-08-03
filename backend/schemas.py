"""
Prosody Interface Backend — Pydantic Schemas

All API/job payloads defined here. Single source of truth for data shapes
flowing between frontend, API, worker, and database.
"""

from pydantic import BaseModel, Field
from typing import Optional
from enum import Enum


class JobStatus(str, Enum):
    QUEUED = "queued"
    PROCESSING = "processing"
    COMPLETE = "complete"
    FAILED = "failed"


class WordResult(BaseModel):
    """A single word with all its analysis results."""
    word: str
    start: float = Field(description="Start time in seconds (absolute)")
    end: float = Field(description="End time in seconds (absolute)")
    confidence: float = Field(default=1.0, description="ASR confidence 0-1")
    stressed: bool = Field(default=False, description="Whether word is stressed")
    stress_score: float = Field(default=0.0, description="Stress probability 0-1")
    pause_after: float = Field(default=0.0, description="Silent pause duration after this word in seconds")
    is_hesitation: bool = Field(default=False, description="Whether this word is a vocalized hesitation (e.g. um, uh)")
    pitch_mean: Optional[float] = Field(default=None, description="Average F0 pitch in Hz over the word")
    pitch_direction: Optional[str] = Field(default=None, description="Pitch direction: rising, falling, flat, or unvoiced")
    pitch_range: float = Field(default=0.0, description="F0 range (max - min) in Hz across the word")


class PhraseResult(BaseModel):
    """A phrase/sentence derived from one VAD chunk."""
    phrase_index: int
    text: str
    words: list[WordResult]
    start_time: float = Field(description="Phrase start time (absolute)")
    end_time: float = Field(description="Phrase end time (absolute)")
    chunk_index: int = Field(description="Which VAD chunk this came from")
    intonation_pattern: Optional[str] = Field(default=None, description="Sentence-level intonation: rising, falling, flat, or rise-fall")


class JobResult(BaseModel):
    """Complete results for a finished job."""
    phrases: list[PhraseResult] = Field(default_factory=list)
    total_duration: float = 0.0
    word_count: int = 0
    wpm: float = 0.0
    stress_ratio: float = Field(default=0.0, description="Fraction of stressed words")
    pitch_variation: float = Field(default=0.0, description="Standard deviation of pitch_mean values across all voiced words (Hz)")


class JobResponse(BaseModel):
    """Response shape for GET /jobs/{job_id}."""
    job_id: str
    status: JobStatus
    progress: float = Field(ge=0.0, le=1.0)
    created_at: float
    started_at: Optional[float] = None
    completed_at: Optional[float] = None
    total_chunks: int = 0
    completed_chunks: int = 0
    current_stage: str = ""
    result: Optional[JobResult] = None
    error: str = ""


class JobCreateResponse(BaseModel):
    """Response when a new job is created (recording stopped)."""
    job_id: str
    status: JobStatus = JobStatus.QUEUED


class LivePreviewWord(BaseModel):
    """A word in the live preview transcription (lightweight, imperfect)."""
    word: str
    confidence: float = 1.0
    start: Optional[float] = None
    end: Optional[float] = None
