import asyncio
import time
import sys
import os
from pathlib import Path

# Add backend directory to path
sys.path.insert(0, str(Path(__file__).parent.parent.resolve()))

from pipeline.vad_chunking import load_silero_vad, chunk_audio_by_vad
from pipeline.asr import load_asr_model, transcribe_chunk
from pipeline.prosody_stress import StressAnalyzer
import librosa
import urllib.request

async def run_diagnostics():
    audio_path = Path("backend/tests/fixtures/real_10s_speech.wav").resolve()
    
    # Download a realistic ~10s file if not exists
    if not audio_path.exists():
        print("Downloading realistic 10s audio...")
        url = "https://audio-samples.github.io/samples/mp3/blizzard_unconditional/sample-0.mp3"
        urllib.request.urlretrieve(url, str(audio_path))
    
    print(f"--- DIAGNOSTIC SCRIPT ---")
    print(f"Testing audio: {audio_path}")
    
    from models.loader import load_all_models
    models = load_all_models()
    
    stress_analyzer = StressAnalyzer()
    stress_analyzer.setup(models)
    models["stress"] = stress_analyzer
    
    # Load audio
    audio, sr = librosa.load(audio_path, sr=16000, mono=True)
    audio_duration = len(audio) / 16000
    print(f"\nLoaded Audio Duration: {audio_duration:.2f}s")
    
    from pipeline.audio_sanity import verify_audio_sanity
    try:
        verify_audio_sanity(audio, sr)
        print("Audio sanity check: PASSED (Genuine speech detected)")
    except ValueError as e:
        print(f"WARNING: Audio sanity check FAILED! {e}")

    
    print("\n--- Running Pipeline ---")
    
    # VAD
    t_vad0 = time.time()
    chunks = chunk_audio_by_vad(audio, models["vad"], 16000)
    t_vad1 = time.time()
    
    print(f"[TIMING] VAD Chunking: {t_vad1 - t_vad0:.2f}s (Chunks generated: {len(chunks)})")
    
    total_vad_time = t_vad1 - t_vad0
    total_asr_time = 0
    total_stress_time = 0
    
    for i, chunk in enumerate(chunks):
        chunk_duration = chunk['end_time'] - chunk['start_time']
        print(f"\nProcessing Chunk {i+1}/{len(chunks)} ({chunk['start_time']:.1f}s - {chunk['end_time']:.1f}s) [Duration: {chunk_duration:.2f}s]")
        
        # ASR
        t_asr0 = time.time()
        asr_result = transcribe_chunk(chunk['audio'], models["asr_final"])
        words = asr_result["words"]
        text = asr_result["text"]
        t_asr1 = time.time()
        total_asr_time += (t_asr1 - t_asr0)
        print(f"[TIMING] ASR Chunk {i+1}: {t_asr1 - t_asr0:.2f}s. Words: {len(words)}")
        
        # Stress
        t_stress0 = time.time()
        try:
            stress_result = models["stress"].analyze(chunk['audio'], words)
        except Exception as e:
            stress_result = {"error": str(e)}
        t_stress1 = time.time()
        total_stress_time += (t_stress1 - t_stress0)
        print(f"[TIMING] Stress Chunk {i+1}: {t_stress1 - t_stress0:.2f}s.")
        
    print(f"\n--- SUMMARY ---")
    print(f"Total Audio Duration: {audio_duration:.2f}s")
    print(f"Total Pipeline Time: {total_vad_time + total_asr_time + total_stress_time:.2f}s")
    print(f"Total VAD Time: {total_vad_time:.2f}s")
    print(f"Total ASR Time: {total_asr_time:.2f}s")
    print(f"Total Stress Time: {total_stress_time:.2f}s")

if __name__ == "__main__":
    asyncio.run(run_diagnostics())
