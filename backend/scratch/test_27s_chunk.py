import os
import sys
import numpy as np
import librosa

# Add backend directory to sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from models.loader import load_all_models
from pipeline.vad_chunking import chunk_audio_by_vad
from pipeline.prosody_pitch import clean_short_voiced_runs, extract_voiced_segments, compute_K_wavelet

def run_test():
    models = load_all_models()
    audio_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "tests", "fixtures", "real_10s_speech.wav")
    audio, sr = librosa.load(audio_path, sr=16000, mono=True)
    
    chunks = chunk_audio_by_vad(audio, models["vad"])
    if len(chunks) > 0:
        chunk_audio = chunks[0]["audio"]
        duration = len(chunk_audio) / sr
        print(f"Chunk 1 duration: {duration:.3f}s")
        
        hop_length = int(0.010 * sr)
        fmin = librosa.note_to_hz('C2')
        fmax = librosa.note_to_hz('C6')
        
        # Test both resolutions
        for res in [0.25, 0.1]:
            print(f"\n=== PyIN resolution={res} ===")
            f0, voiced_flag, voiced_prob = librosa.pyin(
                chunk_audio,
                fmin=fmin,
                fmax=fmax,
                sr=sr,
                hop_length=hop_length,
                frame_length=2048,
                resolution=res
            )
            f0_clean = np.nan_to_num(f0, nan=0.0)
            f0_clean, voiced_flag_clean = clean_short_voiced_runs(f0_clean, f0_clean > 0, min_run=3)
            segs = extract_voiced_segments(f0_clean, voiced_flag_clean, min_len=8)
            
            print(f"Found {len(segs)} segments:")
            for idx, s in enumerate(segs):
                s_time = s['start_frame'] * 0.010
                e_time = s['end_frame'] * 0.010
                n_frames = len(s['x'])
                K = compute_K_wavelet(s['x'], wavelet='db1', level=3)
                print(f"  Seg {idx}: {s_time:.2f}s-{e_time:.2f}s | {n_frames} frames | K={K}")

if __name__ == "__main__":
    run_test()
