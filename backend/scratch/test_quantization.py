import asyncio
import time
import sys
import os
import torch
import torch.nn as nn
from pathlib import Path

# Add backend directory to path
sys.path.insert(0, str(Path(__file__).parent.parent.resolve()))

import librosa
from pipeline.asr import transcribe_chunk
from models.loader import load_all_models
from pipeline.prosody_stress import StressAnalyzer

async def test_quantization():
    audio_path = Path("backend/tests/fixtures/real_10s_speech.wav").resolve()
    audio, sr = librosa.load(audio_path, sr=16000, mono=True)
    audio_duration = len(audio) / 16000
    
    print(f"Loaded audio: {audio_duration:.2f}s")
    
    # We will test bare WhiStress inference
    models = load_all_models()
    stress_analyzer = StressAnalyzer()
    stress_analyzer.setup(models)
    
    # We need a transcription to use the fast path
    print("\nGetting transcription...")
    asr_result = transcribe_chunk(audio, models["asr_final"])
    words = asr_result["words"]
    print(f"Transcription: {' '.join([w['word'] for w in words])}")
    
    # Warmup
    print("\nWarming up...")
    _ = stress_analyzer.analyze(audio, words)
    
    def run_benchmark(label):
        t0 = time.time()
        res = stress_analyzer.analyze(audio, words)
        avg_time = time.time() - t0
        stressed_words = [w['word'] for w in res.get('word_stress', []) if w.get('stressed')]
        print(f"[{label}] Time: {avg_time:.2f}s | Stressed words: {stressed_words}")
        return avg_time

    # 1. Test 4 Threads (Target CPU has 4 cores)
    torch.set_num_threads(4)
    run_benchmark(f"Float32 | Threads=4")
        
    # 2. Apply Quantization
    print("\nApplying Dynamic Quantization...")
    whistress_model = stress_analyzer.client.whistress
    quantized_model = torch.quantization.quantize_dynamic(
        whistress_model, {nn.Linear}, dtype=torch.qint8
    )
    stress_analyzer.client.whistress = quantized_model
    
    # Warmup quantized
    _ = stress_analyzer.analyze(audio, words)
    
    # 3. Test 4 Threads with Quantization
    torch.set_num_threads(4)
    run_benchmark(f"Quantized (qint8) | Threads=4")

if __name__ == "__main__":
    asyncio.run(test_quantization())
