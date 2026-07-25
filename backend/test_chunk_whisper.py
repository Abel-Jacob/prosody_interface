import sys
import librosa
import numpy as np
from faster_whisper import WhisperModel

# Use the latest audio file
audio_path = r"C:\Users\DELL\Desktop\prosody_interface\backend\audio_uploads\e2229e0c-9d85-4483-a718-4fe058a87322.webm"

try:
    audio, sr = librosa.load(audio_path, sr=16000, mono=True)
except Exception as e:
    import soundfile as sf
    audio, sr = sf.read(audio_path)
    if sr != 16000:
        audio = librosa.resample(audio, orig_sr=sr, target_sr=16000)

print(f"Loaded audio, length: {len(audio)/16000:.2f}s")

# Extract the first chunk (0.1s to 4.2s as seen in the logs)
start_sample = int(0.1 * 16000)
end_sample = int(4.2 * 16000)
chunk = audio[start_sample:end_sample].astype(np.float32)

model = WhisperModel("small.en", device="cpu", compute_type="int8")

print("\nTesting default pipeline settings:")
segments, info = model.transcribe(
    chunk,
    language="en",
    beam_size=3,
    best_of=1,
    vad_filter=False,
    condition_on_previous_text=False,
    compression_ratio_threshold=2.4,
    log_prob_threshold=-1.0,
    no_repeat_ngram_size=3,
)
print("Result:", " ".join([s.text.strip() for s in segments]))

print("\nTesting with condition_on_previous_text=True:")
segments, info = model.transcribe(
    chunk,
    language="en",
    beam_size=3,
    best_of=1,
    vad_filter=False,
    condition_on_previous_text=True,
    compression_ratio_threshold=2.4,
    log_prob_threshold=-1.0,
    no_repeat_ngram_size=3,
)
print("Result:", " ".join([s.text.strip() for s in segments]))

print("\nTesting with higher beam_size and defaults:")
segments, info = model.transcribe(
    chunk,
    language="en",
    beam_size=5,
    vad_filter=True,
)
print("Result:", " ".join([s.text.strip() for s in segments]))
