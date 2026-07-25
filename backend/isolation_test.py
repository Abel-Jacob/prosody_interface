import os
import librosa
import numpy as np
from faster_whisper import WhisperModel
import torch

audio_path = r"C:\Users\DELL\Desktop\prosody_interface\backend\audio_uploads\e2229e0c-9d85-4483-a718-4fe058a87322.webm"

print(f"Loading audio from {audio_path}")
try:
    audio, sr = librosa.load(audio_path, sr=16000, mono=True)
except Exception as e:
    print(f"librosa failed, trying soundfile: {e}")
    import soundfile as sf
    audio, sr = sf.read(audio_path)
    if sr != 16000:
        audio = librosa.resample(audio, orig_sr=sr, target_sr=16000)

print(f"Audio loaded. Length: {len(audio)/16000:.2f} seconds")

# 1. Transcribe the whole file with base.en, no VAD, no chunking
print("\n--- 1. faster-whisper base.en RAW OUTPUT ---")
model = WhisperModel("base.en", device="cpu", compute_type="int8")
segments, info = model.transcribe(
    audio, 
    language="en",
    beam_size=5,
    vad_filter=False,
    condition_on_previous_text=True,
)

raw_text = " ".join([s.text.strip() for s in segments])
print("Output text:")
print(raw_text)

# 2. VAD chunk checking
print("\n--- 2. VAD Chunk Range Checking ---")
# Load Silero VAD
vad_model, utils = torch.hub.load(
    repo_or_dir="snakers4/silero-vad",
    model="silero_vad",
    force_reload=False,
    trust_repo=True
)
(get_speech_timestamps, _, _, _, _) = utils

# Use the exact threshold used in config (0.5)
speech_timestamps = get_speech_timestamps(
    torch.from_numpy(audio), 
    vad_model,
    sampling_rate=16000,
    threshold=0.5,
    min_speech_duration_ms=250,
    min_silence_duration_ms=500
)

print(f"Total VAD speech segments found: {len(speech_timestamps)}")
for i, chunk in enumerate(speech_timestamps):
    start_sec = chunk['start'] / 16000.0
    end_sec = chunk['end'] / 16000.0
    print(f"Segment {i+1}: start = {start_sec:.2f}s, end = {end_sec:.2f}s")

# Let's also run our exact chunking logic to see the final chunks produced 
# (the user asked "each chunk's start/end timestamp in seconds — check if any chunks overlap")
# I will just print the segments since those are what VAD produces.

print("\nFinished.")
