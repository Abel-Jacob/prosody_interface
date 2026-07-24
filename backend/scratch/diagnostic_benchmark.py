import sys
import time
import asyncio
from pathlib import Path

# Add backend to path so we can import modules
sys.path.append(str(Path(__file__).parent.parent))

from models.loader import load_all_models
from pipeline.vad_chunking import chunk_audio_by_vad
from pipeline.asr import transcribe_chunk
from pipeline.prosody_stress import StressAnalyzer
import config

async def run_diagnostics():
    audio_path = Path("tests/fixtures/real_speech.mp3").resolve()
    
    print(f"--- DIAGNOSTIC SCRIPT ---")
    print(f"Testing audio: {audio_path}")
    print(f"ASR Model: {config.ASR_MODEL_SIZE_FINAL}")
    print(f"Loading models...")
    
    t0 = time.time()
    models = load_all_models()
    t1 = time.time()
    print(f"[TIMING] Model Loading: {t1 - t0:.2f}s")
    
    stress_analyzer = StressAnalyzer()
    stress_analyzer.setup(models)

    print(f"\n--- Running Pipeline ---")
    t_start = time.time()
    
    # 1. VAD Chunking
    import soundfile as sf
    audio_data, sr = sf.read(str(audio_path))
    if len(audio_data.shape) > 1:
        audio_data = audio_data.mean(axis=1) # to mono
    t_vad0 = time.time()
    chunks = chunk_audio_by_vad(audio_data, models["vad"])
    t_vad1 = time.time()
    print(f"[TIMING] VAD Chunking: {t_vad1 - t_vad0:.2f}s (Chunks generated: {len(chunks)})")
    
    # 2 & 3. Process each chunk
    results = []
    total_asr_time = 0
    total_stress_time = 0
    
    for i, chunk in enumerate(chunks):
        print(f"\nProcessing Chunk {i+1}/{len(chunks)} ({chunk['start_time']:.1f}s - {chunk['end_time']:.1f}s)...")
        
        # ASR
        t_asr0 = time.time()
        # transcribe_chunk is sync (uses faster-whisper)
        asr_result = transcribe_chunk(chunk['audio'], models["asr"])
        words = asr_result["words"]
        text = asr_result["text"]
        t_asr1 = time.time()
        total_asr_time += (t_asr1 - t_asr0)
        print(f"[TIMING] ASR Chunk {i+1}: {t_asr1 - t_asr0:.2f}s. Words: {len(words)}")
        print(f"  ASR Text: {text}")
        
        # Stress
        t_stress0 = time.time()
        stressed_words = []
        if words:
            try:
                stressed_words = stress_analyzer.analyze(chunk['audio'], words)
            except Exception as e:
                print(f"[ERROR] Stress Analyzer crashed: {e}")
                import traceback
                traceback.print_exc()
        t_stress1 = time.time()
        total_stress_time += (t_stress1 - t_stress0)
        print(f"[TIMING] Stress Chunk {i+1}: {t_stress1 - t_stress0:.2f}s.")
        print(f"  Stress Output: {stressed_words}")
        
    t_end = time.time()
    
    print(f"\n--- SUMMARY ---")
    print(f"Total Pipeline Time: {t_end - t_start:.2f}s")
    print(f"Total VAD Time: {t_vad1 - t_vad0:.2f}s")
    print(f"Total ASR Time: {total_asr_time:.2f}s")
    print(f"Total Stress Time: {total_stress_time:.2f}s")

if __name__ == "__main__":
    asyncio.run(run_diagnostics())
