"""
Prosody Registry — Register and retrieve active prosody modules.

All prosody analyzers are registered here. The worker calls
get_active_analyzers() to get the list of modules to run per chunk.

To add a new prosody module:
1. Create a new file in pipeline/ implementing ProsodyAnalyzer
2. Import it here and add to ANALYZER_CLASSES
3. That's it — the worker will automatically call it per chunk
"""

import logging
from typing import Optional

from pipeline.prosody_base import ProsodyAnalyzer
from pipeline.prosody_stress import StressAnalyzer
from pipeline.prosody_pause import PauseAnalyzer
from pipeline.prosody_intonation import IntonationAnalyzer

logger = logging.getLogger(__name__)

# ── Register all analyzer classes here ─────────────────────────
# Add new prosody modules to this list as they're implemented.
# Order matters: they run in this sequence per chunk.
ANALYZER_CLASSES: list[type[ProsodyAnalyzer]] = [
    StressAnalyzer,
    PauseAnalyzer,
    IntonationAnalyzer,
    # Future modules:
    # RhythmAnalyzer,       # inter-word timing statistics
]


_cached_analyzers: list[ProsodyAnalyzer] = []


def get_active_analyzers(models: dict) -> list[ProsodyAnalyzer]:
    """
    Get the list of initialized prosody analyzers.
    
    Initializes on first call, reuses cached instances after that.
    Each analyzer's setup() is called with the models dict.
    """
    global _cached_analyzers

    if not _cached_analyzers:
        for cls in ANALYZER_CLASSES:
            try:
                analyzer = cls()
                analyzer.setup(models)
                _cached_analyzers.append(analyzer)
                logger.info(f"Prosody analyzer registered: {analyzer.name}")
            except Exception as e:
                logger.error(f"Failed to initialize {cls.__name__}: {e}")

    return _cached_analyzers
