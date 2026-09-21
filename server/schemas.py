"""
Prosody Interface Backend — Pydantic Schemas

All API/job payloads defined here. Single source of truth for data shapes
flowing between frontend, API, worker, and database.
"""

from pydantic import BaseModel, Field
from typing import Optional, Union, Any
from enum import Enum


class JobStatus(str, Enum):
    QUEUED = "queued"
    PROCESSING = "processing"
    COMPLETE = "complete"
    FAILED = "failed"


class SyllableModelInfo(BaseModel):
    """Stress prediction from a specific LexiRep model (fused, ger, ita, ensemble)."""
    stressed: bool = Field(default=False, description="Whether this model predicts primary stress")
    margin: float = Field(default=0.0, description="Cosine stress margin")


class SyllableResult(BaseModel):
    """A single syllable with its lexical stress prediction from LexiRep."""
    text: str = Field(description="Syllable text (e.g. 're', 'cord')")
    stressed: bool = Field(default=False, description="Whether this syllable carries primary lexical stress (active model)")
    stress_margin: float = Field(default=0.0, description="Cosine margin to stressed prototype (higher = more stressed)")
    models: Optional[dict[str, SyllableModelInfo]] = Field(
        default=None,
        description="Per-model stress predictions: 'fused', 'ensemble', 'ger', 'ita'"
    )


class WordResult(BaseModel):
    """A single word with all its analysis results."""
    word: str
    start: float = Field(description="Start time in seconds (absolute)")
    end: float = Field(description="End time in seconds (absolute)")
    confidence: float = Field(default=1.0, description="ASR confidence 0-1")
    stressed: bool = Field(default=False, description="Whether word is stressed")
    stress_score: float = Field(default=0.0, description="Stress probability 0-1")
    syllables: Optional[list[SyllableResult]] = Field(default=None, description="LexiRep syllable-level stress breakdown (null for monosyllabic words)")
    pause_after: float = Field(default=0.0, description="Silent pause duration after this word in seconds")
    is_hesitation: bool = Field(default=False, description="Whether this word is a vocalized hesitation (e.g. um, uh)")
    pitch_mean: Optional[float] = Field(default=None, description="Average F0 pitch in Hz over the word")
    pitch_direction: Optional[str] = Field(default=None, description="Pitch direction: rising, falling, flat, or unvoiced")
    pitch_range: float = Field(default=0.0, description="F0 range (max - min) in Hz across the word")
    pitch_contour: list[float] = Field(default_factory=list, description="Per-character F0 values for letter-level pitch visualization")

    # Pitch prosody (from MAE stylized contour)
    mean_pitch: Optional[float] = Field(default=None, description="Mean MAE-stylized pitch in Hz")
    max_pitch: Optional[float] = Field(default=None, description="Maximum pitch in Hz within word")
    min_pitch: Optional[float] = Field(default=None, description="Minimum pitch in Hz within word")
    start_pitch: Optional[float] = Field(default=None, description="Pitch at word onset in Hz")
    end_pitch: Optional[float] = Field(default=None, description="Pitch at word offset in Hz")
    pitch_slope: Optional[float] = Field(default=None, description="Hz change across word duration")
    pitch_range: Optional[float] = Field(default=None, description="max_pitch - min_pitch in Hz")
    normalized_pitch: Optional[float] = Field(default=None, description="0-1 normalized within utterance range")
    pitch_trend: Optional[str] = Field(default=None, description="Pitch direction: ↑ ↓ → ↗ ↘")
    char_pitches: Optional[list[float]] = Field(default=None, description="Per-character normalized pitch for rendering")
    voiced_segment_index: Optional[int] = Field(default=None, description="Index of the voiced segment this word belongs to")


class PhraseIntonation(BaseModel):
    """Phrase-level intonation prosody statistics."""
    mean_pitch: Optional[float] = Field(default=None, description="Mean MAE-stylized pitch in Hz across phrase")
    max_pitch: Optional[float] = Field(default=None, description="Maximum pitch in Hz within phrase")
    min_pitch: Optional[float] = Field(default=None, description="Minimum pitch in Hz within phrase")
    start_pitch: Optional[float] = Field(default=None, description="Pitch at phrase onset in Hz")
    end_pitch: Optional[float] = Field(default=None, description="Pitch at phrase offset in Hz")
    pitch_slope: Optional[float] = Field(default=None, description="Hz change across phrase duration")
    pitch_range: Optional[float] = Field(default=None, description="max_pitch - min_pitch in Hz")
    normalized_pitch: Optional[float] = Field(default=None, description="0-1 normalized within utterance range")
    pitch_trend: Optional[str] = Field(default=None, description="Pitch direction: ↑ ↓ → ↗ ↘")
    voiced_segment_index: Optional[int] = Field(default=None, description="Dominant voiced segment index for this phrase")


class PhraseResult(BaseModel):
    """A phrase/sentence derived from one VAD chunk."""
    phrase_index: int
    text: str
    words: list[WordResult]
    start_time: float = Field(description="Phrase start time (absolute)")
    end_time: float = Field(description="Phrase end time (absolute)")
    chunk_index: int = Field(description="Which VAD chunk this came from")
    intonation_pattern: Optional[str] = Field(default=None, description="Sentence-level intonation: rising, falling, flat, or rise-fall")
    intonation: Optional[PhraseIntonation] = Field(default=None, description="Phrase-level intonation features")


class VoicedSegmentDetail(BaseModel):
    """Details of a single contiguous voiced segment stylized with MAE."""
    segment_index: int = Field(description="Index of this voiced segment")
    start_time: float = Field(description="Onset time in seconds")
    end_time: float = Field(description="Offset time in seconds")
    frame_count: int = Field(description="Number of pitch frames in this segment")
    k_value: int = Field(description="wavelet complexity K value used for stylization")
    mae_stylized: list[float] = Field(description="MAE stylized pitch values (Hz) for each frame")
    raw_contour: list[float] = Field(default_factory=list, description="Raw pitch values (Hz) for each frame")


class JobResult(BaseModel):
    """Complete results for a finished job."""
    phrases: list[PhraseResult] = Field(default_factory=list)
    total_duration: float = 0.0
    word_count: int = 0
    wpm: float = 0.0
    stress_ratio: float = Field(default=0.0, description="Fraction of stressed words")
    pitch_variation: float = Field(default=0.0, description="Standard deviation of pitch_mean values across all voiced words (Hz)")
    voiced_segments: list[VoicedSegmentDetail] = Field(default_factory=list, description="Contiguous voiced segment stylization results")


class BatchFileItem(BaseModel):
    """An individual file processed within a batch job."""
    file_id: str
    filename: str
    status: str = "complete"  # "complete" | "error"
    duration: float = 0.0
    word_count: int = 0
    sentence_count: int = 0
    error: Optional[str] = None
    result: Optional[JobResult] = None
    annotation: Optional[dict] = None


class BatchJobResult(BaseModel):
    """Result container for multi-audio or ZIP batch jobs."""
    is_batch: bool = True
    batch_name: str = "batch"
    total_files: int = 0
    completed_files: int = 0
    failed_files: int = 0
    total_duration: float = 0.0
    total_words: int = 0
    files: list[BatchFileItem] = Field(default_factory=list)


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
    result: Optional[Union[JobResult, BatchJobResult, dict]] = None
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
