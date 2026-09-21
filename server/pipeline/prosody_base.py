"""
Prosody Base — Abstract Interface for Prosody Modules

All prosody analysis modules must implement this interface.
This enables extensibility: new modules (intonation, rhythm, pause
detection) can be added without touching existing code.

Each module:
- Has a `name` identifier
- Implements `analyze(audio_chunk, words) -> dict`
- Is registered in prosody_registry.py
"""

import numpy as np
from abc import ABC, abstractmethod


class ProsodyAnalyzer(ABC):
    """
    Base class for all prosody analysis modules.
    
    Subclasses must set `name` and implement `analyze()`.
    The worker calls each registered analyzer in sequence per chunk.
    """

    name: str = "base"

    @abstractmethod
    def setup(self, models: dict) -> None:
        """
        Initialize with pre-loaded models.
        Called once when the analyzer is instantiated.
        
        Args:
            models: Dict of all loaded models from models/loader.py
        """
        ...

    @abstractmethod
    def analyze(self, audio_chunk: np.ndarray, words: list[dict]) -> dict:
        """
        Analyze a single audio chunk and return prosody features.

        Args:
            audio_chunk: Audio as float32 numpy array, 16kHz mono.
            words: List of word dicts from ASR with
                   {word, start, end, confidence}.

        Returns:
            Dict of features. Structure depends on the module.
            Must be JSON-serializable for storage in SQLite.
        """
        ...
