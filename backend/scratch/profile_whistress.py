import sys
import os
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config import VENDOR_DIR
sys.path.insert(0, str(VENDOR_DIR))

from whistress_pkg import WhiStressInferenceClient
import numpy as np
import time

print("Loading model...")
client = WhiStressInferenceClient(device="cuda")

# Dummy audio: 4 seconds of silence
audio_chunk = np.zeros(16000 * 4, dtype=np.float32)

audio_dict = {
    "array": audio_chunk,
    "sampling_rate": 16000,
}
transcription = "Hello this is a test transcription to see why it is so slow."

print("Running inference (first pass)...")
start = time.time()
res = client.predict(audio_dict, transcription=transcription, return_pairs=True)
end = time.time()
print(f"First pass took: {end - start:.2f} seconds")

print("Running inference (second pass)...")
start = time.time()
res = client.predict(audio_dict, transcription=transcription, return_pairs=True)
end = time.time()
print(f"Second pass took: {end - start:.2f} seconds")
