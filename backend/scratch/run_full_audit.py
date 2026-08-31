import os
import time
import sys
import torch
import numpy as np
import librosa
import asyncio
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent.resolve()))

from models.loader import load_all_models, warmup_models
from pipeline.vad_chunking import chunk_audio_by_vad
from pipeline.prosody_pitch import PitchAnalyzer
from pipeline.prosody_stress import StressAnalyzer
from pipeline.prosody_pause import PauseAnalyzer

async def audit_pipeline_run(models, audio_path, duration_sec):
    print(f"\n==================================================")
    print(f"Auditing file: {audio_path} ({duration_sec}s)")
    print(f"==================================================")
    
    t_start = time.time()
    
    # 1. Load audio
    y, sr = librosa.load(audio_path, sr=16000, mono=True)
    t_loaded = time.time()
    print(f"Loaded audio in {t_loaded - t_start:.3f}s")
    
    # 2. VAD Chunking
    t0 = time.time()
    chunks = chunk_audio_by_vad(y, models["vad"], sr)
    t_vad = time.time() - t0
    print(f"VAD Chunking: {t_vad:.3f}s (Generated {len(chunks)} chunks)")
    
    # Construct mock phrases based on VAD chunks
    phrases = []
    for idx, chunk in enumerate(chunks):
        c_audio = chunk["audio"]
        c_dur = len(c_audio) / sr
        start_time = chunk["start_time"]
        end_time = chunk["end_time"]
        
        # Build mock words in this chunk
        words = []
        w_dur = max(0.2, (end_time - start_time) / 4)
        for w_idx, w_text in enumerate(["hello", "world", "speech", "test"]):
            w_start = start_time + w_idx * w_dur
            w_end = min(end_time, w_start + w_dur - 0.05)
            words.append({
                "word": w_text,
                "start": w_start,
                "end": w_end,
                "confidence": 0.95
            })
            
        phrases.append({
            "phrase_index": idx,
            "start_time": start_time,
            "end_time": end_time,
            "text": "hello world speech test",
            "words": words
        })
        
    # 3. Run Pitch Analyzer
    t0 = time.time()
    pitch_analyzer = PitchAnalyzer()
    pitch_analyzer.setup(models)
    pitch_res = pitch_analyzer.analyze(y, phrases)
    t_pitch = time.time() - t0
    print(f"PitchAnalyzer ({duration_sec}s): {t_pitch:.3f}s")
    
    # 4. Run Stress Analyzer on first chunk
    if len(chunks) > 0:
        chunk = chunks[0]
        t0 = time.time()
        stress_analyzer = StressAnalyzer()
        stress_analyzer.setup(models)
        
        chunk_words = [{"word": w["word"], "start": w["start"], "end": w["end"], "confidence": w["confidence"]} for w in phrases[0]["words"]]
        stress_res = stress_analyzer.analyze(chunk["audio"], chunk_words)
        t_stress = time.time() - t0
        print(f"StressAnalyzer (first chunk, {len(chunk['audio'])/sr:.2f}s): {t_stress:.3f}s")

    # 5. Run Pause Analyzer on all words
    t0 = time.time()
    pause_analyzer = PauseAnalyzer()
    pause_analyzer.setup(models)
    all_words = []
    for p in phrases:
        all_words.extend(p["words"])
    pause_res = pause_analyzer.analyze(y, all_words)
    print(f"PauseAnalyzer: {time.time() - t0:.3f}s")

    print(f"\n--- Total execution summary for {duration_sec}s audio ---")
    print(f"Total time elapsed: {time.time() - t_start:.3f}s")

if __name__ == "__main__":
    print("Loading all models...")
    models = load_all_models()
    print("Warming up models...")
    warmup_models(models)
    
    # Explicit Pitch compilation warmup
    print("Warming up Pitch JIT compiler...")
    dummy_signal = np.zeros(16000, dtype=np.float32)
    dummy_phrase = [{"phrase_index": 0, "start_time": 0.0, "end_time": 1.0, "words": []}]
    dummy_analyzer = PitchAnalyzer()
    dummy_analyzer.setup(models)
    dummy_analyzer.analyze(dummy_signal, dummy_phrase)
    print("Pitch JIT compiler warmed up.")
    
    audio_files = [
        ("backend/tests/fixtures/test_5s.wav", 5.0),
        ("backend/tests/fixtures/real_10s_speech.wav", 10.0),
        ("backend/tests/fixtures/test_30s.wav", 30.0),
        ("backend/tests/fixtures/test_65s.wav", 65.0)
    ]
    for path, dur in audio_files:
        asyncio.run(audit_pipeline_run(models, path, dur))
