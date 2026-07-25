from faster_whisper import WhisperModel
print("Testing distil-large-v3...")
try:
    model = WhisperModel("distil-large-v3", device="cpu", compute_type="int8")
    print("Success: distil-large-v3")
except Exception as e:
    print(f"Failed distil-large-v3: {e}")

print("Testing medium.en...")
try:
    model2 = WhisperModel("medium.en", device="cpu", compute_type="int8")
    print("Success: medium.en")
except Exception as e:
    print(f"Failed medium.en: {e}")
