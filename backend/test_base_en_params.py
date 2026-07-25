import time
from faster_whisper import WhisperModel
import librosa
from pipeline.vad_chunking import chunk_audio_by_vad
from models.loader import load_all_models

def run():
    print("Loading models...")
    models = load_all_models()
    model = WhisperModel("small.en", device="cpu", compute_type="int8")
    
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
    
    def test_params(name, **kwargs):
        print(f"\n--- Testing: {name} ---")
        start = time.time()
        final_text = []
        for i, c in enumerate(chunks):
            res, _ = model.transcribe(
                c["audio"], language="en", word_timestamps=True, **kwargs
            )
            text = " ".join([s.text.strip() for s in res])
            final_text.append(text)
        total_time = time.time() - start
        print(f"Result: {' '.join(final_text)}")
        print(f"Time: {total_time:.2f}s")
        return total_time

    # 1. Baseline
    test_params("Baseline")
    
    # 2. condition_on_previous_text=False
    test_params(
        "condition_on_previous_text=False",
        condition_on_previous_text=False
    )
    
    # 3. beam_size=5
    test_params(
        "+ beam_size=5",
        condition_on_previous_text=False,
        beam_size=5
    )
    
    # 4. temperature fallback
    test_params(
        "+ temperature=[0.0, 0.2, 0.4, 0.6, 0.8, 1.0]",
        condition_on_previous_text=False,
        beam_size=5,
        temperature=[0.0, 0.2, 0.4, 0.6, 0.8, 1.0]
    )
    
    # 5. compression_ratio_threshold=2.4
    test_params(
        "+ compression_ratio_threshold=2.4",
        condition_on_previous_text=False,
        beam_size=5,
        temperature=[0.0, 0.2, 0.4, 0.6, 0.8, 1.0],
        compression_ratio_threshold=2.4
    )
    
    # 6. log_prob_threshold=-1.0
    test_params(
        "+ log_prob_threshold=-1.0",
        condition_on_previous_text=False,
        beam_size=5,
        temperature=[0.0, 0.2, 0.4, 0.6, 0.8, 1.0],
        compression_ratio_threshold=2.4,
        log_prob_threshold=-1.0
    )
    
    # 7. no_repeat_ngram_size=3
    test_params(
        "+ no_repeat_ngram_size=3",
        condition_on_previous_text=False,
        beam_size=5,
        temperature=[0.0, 0.2, 0.4, 0.6, 0.8, 1.0],
        compression_ratio_threshold=2.4,
        log_prob_threshold=-1.0,
        no_repeat_ngram_size=3
    )

if __name__ == "__main__":
    run()
