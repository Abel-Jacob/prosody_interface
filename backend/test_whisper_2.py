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

for model_size in ["small.en"]:
    print(f"\n======================================")
    print(f"Testing model: {model_size}")
    
    start_time = time.time()
    print(f"Loading {model_size}...")
    model = WhisperModel(model_size, device="cpu", compute_type="int8")
    
    print("\nTranscribing (WITH VAD_FILTER=TRUE)...")
    start_time = time.time()
    segments, info = model.transcribe(
        audio,
        language="en",
        beam_size=5,
        vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=500)
    )
    
    text = " ".join([s.text.strip() for s in segments])
    print("Result:", text)

    print("\nTranscribing (WITH HIGHER TEMPERATURE)...")
    start_time = time.time()
    segments, info = model.transcribe(
        audio,
        language="en",
        beam_size=5,
        temperature=[0.0, 0.2, 0.4, 0.6, 0.8, 1.0],
        vad_filter=True,
    )
    
    text = " ".join([s.text.strip() for s in segments])
    print("Result:", text)
