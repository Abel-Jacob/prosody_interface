import os
import librosa
import numpy as np
from faster_whisper import WhisperModel

audio_path = r"C:\Users\DELL\Desktop\prosody_interface\backend\audio_uploads\e2229e0c-9d85-4483-a718-4fe058a87322.webm"

print(f"Loading audio from {audio_path}...")
try:
    audio, sr = librosa.load(audio_path, sr=16000, mono=True)
except Exception as e:
    import soundfile as sf
    audio, sr = sf.read(audio_path)
    if sr != 16000:
        audio = librosa.resample(audio, orig_sr=sr, target_sr=16000)

print(f"Audio loaded. Length: {len(audio)/16000:.2f} seconds")

# Load model once
model = WhisperModel("base.en", device="cpu", compute_type="int8")

def transcribe_and_print(name, **kwargs):
    print(f"\n--- Testing: {name} ---")
    segments, info = model.transcribe(audio, language="en", word_timestamps=True, **kwargs)
    raw_text = " ".join([s.text.strip() for s in segments])
    print(f"Result: {raw_text}")

# 1. Baseline
transcribe_and_print("Baseline (Defaults)", condition_on_previous_text=True)

# 2. condition_on_previous_text=False
transcribe_and_print("condition_on_previous_text=False", condition_on_previous_text=False)

# 3. repetition_penalty=1.2
transcribe_and_print(
    "repetition_penalty=1.2",
    condition_on_previous_text=False,
    repetition_penalty=1.2
)

# 4. no_repeat_ngram_size=3
transcribe_and_print(
    "no_repeat_ngram_size=3",
    condition_on_previous_text=False,
    repetition_penalty=1.2,
    no_repeat_ngram_size=3
)

# 5. compression_ratio / logprob_threshold
transcribe_and_print(
    "compression_ratio=2.2, log_prob=-1.0",
    condition_on_previous_text=False,
    repetition_penalty=1.2,
    no_repeat_ngram_size=3,
    compression_ratio_threshold=2.2,
    log_prob_threshold=-1.0
)

# 6. beam_size=5
transcribe_and_print(
    "beam_size=5",
    condition_on_previous_text=False,
    repetition_penalty=1.2,
    no_repeat_ngram_size=3,
    compression_ratio_threshold=2.2,
    log_prob_threshold=-1.0,
    beam_size=5
)

# 7. Fallback temperatures
transcribe_and_print(
    "temperature=[0.0, 0.2, 0.4, 0.6, 0.8, 1.0]",
    condition_on_previous_text=False,
    repetition_penalty=1.2,
    no_repeat_ngram_size=3,
    compression_ratio_threshold=2.2,
    log_prob_threshold=-1.0,
    beam_size=5,
    temperature=[0.0, 0.2, 0.4, 0.6, 0.8, 1.0]
)

print("\nFinished parameter iterations.")
