import numpy as np
import librosa
import libf0
from pipeline.vad_chunking import load_silero_vad, chunk_audio_by_vad
from pipeline.prosody_pitch import extract_voiced_segments

def test():
    # Load audio
    audio, sr = librosa.load("backend/tests/fixtures/real_10s_speech.wav", sr=16000)
    
    # Load VAD and chunk
    vad_model = load_silero_vad()
    chunks = chunk_audio_by_vad(audio, vad_model, sr)
    chunk = chunks[0]
    chunk_audio = chunk["audio"]
    print(f"Chunk duration: {len(chunk_audio)/sr:.3f}s")
    
    # Run libf0.swipe
    f0_raw, time_axis, strength = libf0.swipe(
        np.asarray(chunk_audio, dtype=np.float64),
        Fs=sr,
        H=160,
        F_min=50,
        F_max=500
    )
    
    # Try different thresholds
    for thresh in [0.15, 0.18, 0.20, 0.22, 0.25]:
        voiced_mask = (~np.isnan(strength)) & (strength >= thresh)
        f0 = np.where(voiced_mask, f0_raw, 0.0)
        
        # Segment extraction
        runs = extract_voiced_segments(f0, voiced_mask)
        
        print(f"\n--- Threshold {thresh} ---")
        print(f"Found {len(runs)} segments:")
        for idx, seg in enumerate(runs):
            t_start = seg["start_frame"] * (160 / sr)
            t_end = seg["end_frame"] * (160 / sr)
            n_frames = len(seg["x"])
            print(f"  Seg {idx}: {t_start:.2f}s - {t_end:.2f}s | {n_frames} frames")

if __name__ == "__main__":
    test()
