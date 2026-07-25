import librosa
from pipeline.vad_chunking import chunk_audio_by_vad, load_silero_vad
import logging

logging.basicConfig(level=logging.DEBUG)

audio_path = r"C:\Users\DELL\Desktop\prosody_interface\backend\audio_uploads\94304eef-62b4-4006-8ea4-1258713a9cce.webm"

try:
    audio, sr = librosa.load(audio_path, sr=16000, mono=True)
except Exception as e:
    import soundfile as sf
    audio, sr = sf.read(audio_path)
    if sr != 16000:
        audio = librosa.resample(audio, orig_sr=sr, target_sr=16000)

vad_model = load_silero_vad()
chunks = chunk_audio_by_vad(audio, vad_model, sample_rate=16000)

print(f"\nTotal chunks produced: {len(chunks)}")
for i, c in enumerate(chunks):
    dur = c['end_time'] - c['start_time']
    print(f"Chunk {i+1}: start={c['start_time']:.2f}s, end={c['end_time']:.2f}s, duration={dur:.2f}s")
