import os
import sys
import numpy as np
import librosa

# Add backend directory to sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from models.loader import load_all_models
from pipeline.vad_chunking import chunk_audio_by_vad
from pipeline.asr import transcribe_chunk
from pipeline.prosody_pitch import PitchAnalyzer

def run():
    models = load_all_models()
    audio_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "tests", "fixtures", "real_10s_speech.wav")
    audio, sr = librosa.load(audio_path, sr=16000, mono=True)
    
    # Run VAD and ASR to get phrases
    chunks = chunk_audio_by_vad(audio, models["vad"])
    phrases = []
    for idx, c in enumerate(chunks):
        asr_res = transcribe_chunk(c["audio"], models["asr_final"])
        # Format phrases as expected by worker/PitchAnalyzer
        phrases.append({
            "phrase_index": idx,
            "start_time": c["start_time"],
            "end_time": c["end_time"],
            "words": asr_res["words"]
        })
        
    print(f"Total phrases: {len(phrases)}")
    
    # Now run PitchAnalyzer
    analyzer = PitchAnalyzer()
    analyzer.setup(models)
    
    result = analyzer.analyze(audio, phrases)
    print("\n=== PitchAnalyzer Voiced Segments ===")
    for seg in result["voiced_segments"]:
        print(f"Segment {seg['segment_index']}: {seg['start_time']:.2f}s - {seg['end_time']:.2f}s | {seg['frame_count']} frames | K={seg['k_value']}")

if __name__ == "__main__":
    run()
