import asyncio
import librosa
from models.loader import load_all_models
from pipeline.vad_chunking import chunk_audio_by_vad
from pipeline.asr import transcribe_chunk

def run():
    print("Loading models...")
    models = load_all_models()
    
    audio_path = r"C:\Users\DELL\Desktop\prosody_interface\backend\audio_uploads\e2229e0c-9d85-4483-a718-4fe058a87322.webm"
    print(f"Loading {audio_path}")
    
    try:
        audio, sr = librosa.load(audio_path, sr=16000, mono=True)
    except Exception as e:
        import soundfile as sf
        audio, sr = sf.read(audio_path)
        if sr != 16000:
            audio = librosa.resample(audio, orig_sr=sr, target_sr=16000)

    print("Running VAD chunking...")
    chunks = chunk_audio_by_vad(audio, models["vad"])
    
    for penalty in [1.0, 1.2, 1.5, 2.0]:
        print(f"\n--- Pipeline Test with repetition_penalty={penalty} ---")
        final_text = []
        for i, c in enumerate(chunks):
            # We must override the pipeline's repetition_penalty for this test
            res, _ = models["asr_final"].transcribe(
                c["audio"], language="en", word_timestamps=True,
                condition_on_previous_text=False,
                repetition_penalty=penalty,
                compression_ratio_threshold=2.2,
                log_prob_threshold=-1.0,
                no_repeat_ngram_size=2,
                beam_size=5
            )
            text = " ".join([s.text.strip() for s in res])
            print(f"Chunk {i+1}: {text}")
            final_text.append(text)
        print(f"Result: {' '.join(final_text)}")

if __name__ == "__main__":
    run()
