import librosa
import numpy as np
import libf0

def get_voiced_ratio(path):
    y, sr = librosa.load(path, sr=16000)
    f0_raw, time_axis, strength = libf0.swipe(
        np.asarray(y, dtype=np.float64),
        Fs=sr,
        H=160,
        F_min=50,
        F_max=500
    )
    voiced_flag = (~np.isnan(strength)) & (strength >= 0.20)
    ratio = np.mean(voiced_flag) * 100
    return ratio, len(y)/sr

if __name__ == "__main__":
    files = [
        "backend/tests/fixtures/test_5s.wav",
        "backend/tests/fixtures/real_10s_speech.wav",
        "backend/tests/fixtures/test_30s.wav",
        "backend/tests/fixtures/test_65s.wav"
    ]
    for f in files:
        ratio, dur = get_voiced_ratio(f)
        print(f"{f}: duration={dur:.2f}s | voiced_ratio={ratio:.2f}%")
