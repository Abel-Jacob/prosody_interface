import sys
import os
import numpy as np
import librosa

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from models.loader import load_all_models
from pipeline.prosody_pitch import PitchAnalyzer

# Load real speech audio
audio_path = "../tests/fixtures/real_10s_speech.wav"
if not os.path.exists(audio_path):
    audio_path = "backend/tests/fixtures/real_10s_speech.wav"

audio, sr = librosa.load(audio_path, sr=16000, mono=True)
print(f"Audio loaded: {len(audio)} samples, {len(audio)/sr:.1f}s")

# Let's mock a simple list of phrases with words that cover the 10s audio
# "Today, I will read a short passage at a natural speaking pace."
# Timestamps obtained from real ASR or manually approximated:
words = [
    {"word": "Today,", "start": 0.12, "end": 0.60},
    {"word": "I", "start": 0.65, "end": 0.85},
    {"word": "will", "start": 0.85, "end": 1.10},
    {"word": "read", "start": 1.10, "end": 1.40},
    {"word": "a", "start": 1.40, "end": 1.50},
    {"word": "short", "start": 1.55, "end": 1.95},
    {"word": "passage", "start": 1.95, "end": 2.50},
    {"word": "at", "start": 2.50, "end": 2.70},
    {"word": "a", "start": 2.70, "end": 2.80},
    {"word": "natural", "start": 2.80, "end": 3.40},
    {"word": "speaking", "start": 3.40, "end": 3.90},
    {"word": "pace.", "start": 3.90, "end": 4.50}
]

phrases = [{
    "phrase_index": 0,
    "start_time": 0.0,
    "end_time": 5.0,
    "words": words
}]

analyzer = PitchAnalyzer()
analyzer.setup({})

result = analyzer.analyze(audio, phrases)
print("\n--- Phrase-Level Pitch Features ---")
for p in result["phrase_pitch"]:
    print(f"Phrase {p['phrase_index']}: mean={p['mean_pitch']}, trend={p['pitch_trend']}, slope={p['pitch_slope']}")

print("\n--- Word-Level Pitch Features ---")
for w in result["word_pitch"]:
    print(f"Word '{w['word']}': mean={w['mean_pitch']}, trend={w['pitch_trend']}, start={w['start_pitch']}, end={w['end_pitch']}, slope={w['pitch_slope']}")
