import numpy as np
import librosa

def verify_audio_sanity(audio: np.ndarray, sr: int = 16000) -> bool:
    """
    Sanity check to verify if the loaded audio has genuine speech energy variation
    rather than being uniform noise, constant tones, or silence.
    """
    duration = len(audio) / sr
    if duration < 0.2:
        raise ValueError(f"Audio duration is too short: {duration:.3f}s")
        
    # Check standard deviation of raw waveform (amplitude)
    std_val = np.std(audio)
    if std_val < 1e-4:
        raise ValueError(f"Audio is silent or has extremely low energy (std={std_val:.6f})")
        
    # Calculate RMS energy of 100ms frames with a 50ms hop
    frame_length = int(0.100 * sr)
    hop_length = int(0.050 * sr)
    
    if len(audio) < frame_length:
        # Too short to frame
        return True
        
    rms = librosa.feature.rms(y=audio, frame_length=frame_length, hop_length=hop_length)[0]
    # Convert to decibels relative to peak RMS
    max_rms = np.max(rms)
    if max_rms < 1e-5:
        raise ValueError("Audio peak RMS is near zero (silent).")
        
    rms_db = librosa.amplitude_to_db(rms, ref=max_rms)
    db_range = float(np.max(rms_db) - np.min(rms_db))
    
    # Speech has natural dynamic range > 15-20 dB between silence gaps and phonemes.
    # Uniform white noise or pure constant tones have very flat envelopes (< 5-10 dB range).
    if db_range < 10.0:
        raise ValueError(
            f"Audio envelope is too uniform ({db_range:.2f} dB range). "
            "It appears to be synthetic noise, flat tones, or digital silence, not real speech."
        )
        
    return True
