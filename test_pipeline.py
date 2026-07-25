import asyncio
import librosa
from backend.models.loader import load_all_models
from backend.pipeline.vad_chunking import chunk_audio_by_vad
from backend.pipeline.asr import transcribe_chunk
import os
import sys

sys.path.append(os.path.join(os.path.dirname(__file__), 'backend'))
# Have to hack path for absolute imports inside backend

def run():
    print("Loading models...")
    models = load_all_models()
    
    audio_path = r"C:\Users\DELL\Desktop\prosody_interface\backend\audio_uploads\e2229e0c-9d85-4483-a718-4fe058a87322.webm"
    print(f"Loading {audio_path}")
    
    try:
        audio, sr = librosa.load(audio_path, sr=16000, mono=True)
    except Exception as e:
        import soundfile as sf
        audio, sr = sf.read(audio_path)
        if sr != 16000:
            audio = librosa.resample(audio, orig_sr=sr, target_sr=16000)

    print("Running VAD chunking...")
    chunks = chunk_audio_by_vad(audio, models["vad"])
    
    print(f"Got {len(chunks)} chunks. Running ASR pipeline...")
    final_text = []
    
    for i, c in enumerate(chunks):
        res = transcribe_chunk(c["audio"], models["asr_final"])
        print(f"Chunk {i+1} Output: {res['text']}")
        final_text.append(res['text'])
        
    print("\n=== FINAL PIPELINE RESULT ===")
    print(" ".join(final_text))

if __name__ == "__main__":
    run()
