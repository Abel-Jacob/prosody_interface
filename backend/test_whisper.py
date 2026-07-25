import sys
from faster_whisper import WhisperModel
import time
import librosa
import numpy as np

# Load the latest audio file
audio_path = r"C:\Users\DELL\Desktop\prosody_interface\backend\audio_uploads\94304eef-62b4-4006-8ea4-1258713a9cce.webm"

print(f"Loading audio from {audio_path}...")
try:
    audio, sr = librosa.load(audio_path, sr=16000, mono=True)
except Exception as e:
    import soundfile as sf
    audio, sr = sf.read(audio_path)
    if sr != 16000:
        audio = librosa.resample(audio, orig_sr=sr, target_sr=16000)

print("Audio loaded. Length:", len(audio)/16000, "seconds")

for model_size in ["base.en", "small.en"]:
    print(f"\n======================================")
    print(f"Testing model: {model_size}")
    
    start_time = time.time()
    print(f"Loading {model_size}...")
    model = WhisperModel(model_size, device="cpu", compute_type="int8")
    print(f"Loaded in {time.time() - start_time:.2f}s")
    
    print("Transcribing (WITH Hallucination Guards)...")
    start_time = time.time()
    segments, info = model.transcribe(
        audio,
        language="en",
        beam_size=3,
        best_of=1,
        vad_filter=False,
        condition_on_previous_text=False,
        compression_ratio_threshold=2.4,
        log_prob_threshold=-1.0,
        no_repeat_ngram_size=3,
    )
    
    text = " ".join([s.text.strip() for s in segments])
    print(f"Time taken: {time.time() - start_time:.2f}s")
    print("Result:", text)

    print("\nTranscribing (WITHOUT Hallucination Guards)...")
    start_time = time.time()
    segments, info = model.transcribe(
        audio,
        language="en",
        beam_size=3,
        best_of=1,
        vad_filter=False,
    )
    
    text = " ".join([s.text.strip() for s in segments])
    print(f"Time taken: {time.time() - start_time:.2f}s")
    print("Result:", text)
