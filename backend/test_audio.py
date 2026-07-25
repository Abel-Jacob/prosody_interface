import sys
import librosa
import numpy as np

audio_path = r"C:\Users\DELL\Desktop\prosody_interface\backend\audio_uploads\94304eef-62b4-4006-8ea4-1258713a9cce.webm"

try:
    audio, sr = librosa.load(audio_path, sr=16000, mono=True)
except Exception as e:
    import soundfile as sf
    audio, sr = sf.read(audio_path)
    if sr != 16000:
        audio = librosa.resample(audio, orig_sr=sr, target_sr=16000)

print(f"Total length: {len(audio)/sr:.2f}s")

# Calculate RMS energy per second
chunk_samples = sr  # 1 second
for i in range(0, len(audio), chunk_samples):
    chunk = audio[i:i+chunk_samples]
    rms = np.sqrt(np.mean(chunk**2))
    print(f"Sec {i//sr:02d}-{i//sr+1:02d}: RMS = {rms:.5f}")
