"""Quick diagnostic: test IntonationAnalyzer on the test audio file."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

import numpy as np
import librosa

# Load test audio
audio, sr = librosa.load("../test.wav", sr=16000, mono=True)
print(f"Audio loaded: {len(audio)} samples, {len(audio)/sr:.1f}s")

# Test pyin directly
print("\n--- Testing librosa.pyin ---")
f0, voiced, voiced_prob = librosa.pyin(audio[:16000*5], fmin=50, fmax=500, sr=16000)
print(f"F0 array length: {len(f0)}")
print(f"Non-NaN values: {np.sum(~np.isnan(f0))}")
print(f"F0 range: {np.nanmin(f0):.1f} - {np.nanmax(f0):.1f} Hz")
print(f"F0 mean: {np.nanmean(f0):.1f} Hz")

# Test the analyzer
print("\n--- Testing IntonationAnalyzer ---")
from pipeline.prosody_intonation import IntonationAnalyzer

analyzer = IntonationAnalyzer()
analyzer.setup({})

# Fake word data for first 5 seconds
test_words = [
    {"word": "I", "start": 0.0, "end": 0.24, "confidence": 1.0},
    {"word": "went", "start": 0.32, "end": 0.56, "confidence": 1.0},
    {"word": "to", "start": 0.56, "end": 0.72, "confidence": 1.0},
    {"word": "the", "start": 1.44, "end": 1.60, "confidence": 1.0},
    {"word": "store", "start": 1.64, "end": 2.08, "confidence": 1.0},
]

result = analyzer.analyze(audio[:16000*3], test_words)
print(f"Result keys: {list(result.keys())}")
print(f"Intonation pattern: {result.get('intonation_pattern')}")
print(f"Word count: {len(result.get('word_intonation', []))}")
for w in result.get("word_intonation", []):
    print(f"  {w['word']:>10s}: mean={w['pitch_mean']}, dir={w['pitch_direction']}, range={w['pitch_range']}")

# Check if error key exists
if "error" in result:
    print(f"\nERROR: {result['error']}")

print("\n✅ IntonationAnalyzer works correctly" if result.get("word_intonation") else "\n❌ No intonation data produced")
