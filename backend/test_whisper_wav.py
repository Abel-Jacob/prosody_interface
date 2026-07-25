import sys
from faster_whisper import WhisperModel
import time
import soundfile as sf
import librosa
import numpy as np

audio_path = r"C:\Users\DELL\Desktop\prosody_interface\backend\audio_uploads\test.wav"

audio, sr = sf.read(audio_path)
if sr != 16000:
    audio = librosa.resample(audio, orig_sr=sr, target_sr=16000)
audio = audio.astype(np.float32)

print("Audio loaded from WAV. Length:", len(audio)/16000, "seconds")

model_size = "small.en"
model = WhisperModel(model_size, device="cpu", compute_type="int8")

print("\nTranscribing WAV file...")
segments, info = model.transcribe(
    audio,
    language="en",
    beam_size=5,
    vad_filter=True,
    condition_on_previous_text=True
)

text = " ".join([s.text.strip() for s in segments])
print("Result:", text)
