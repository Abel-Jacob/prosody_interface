import subprocess
import os

def generate_test_audio():
    print("Generating 10 seconds of test audio in 1-second chunks...")
    subprocess.run([
        "ffmpeg", "-f", "lavfi", "-i", "anoisesrc=r=16000:d=10",
        "-c:a", "libopus", "-segment_time", "1", "-f", "segment",
        "test_chunk%03d.webm", "-y"
    ], capture_output=True)

def test_partial_decode():
    chunks = []
    header = open("test_chunk000.webm", "rb").read()
    for i in range(1, 10):
        filename = f"test_chunk{i:03d}.webm"
        if os.path.exists(filename):
            chunks.append(open(filename, "rb").read())
            
    # Try decoding Header + last 4 chunks
    last_chunks = chunks[-4:]
    with open("partial.webm", "wb") as f:
        f.write(header)
        for c in last_chunks:
            f.write(c)
            
    print("Running ffmpeg on partial.webm...")
    p = subprocess.Popen(
        ['ffmpeg', '-i', 'partial.webm', '-f', 's16le', '-acodec', 'pcm_s16le', '-ac', '1', '-ar', '16000', '-'],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE
    )
    out, err = p.communicate()
    print(f"Decoded {len(out)} bytes of PCM data.")
    if len(out) > 0:
        print(f"Which is {len(out) / (16000 * 2)} seconds of audio.")
    else:
        print("FFMPEG ERROR:")
        print(err.decode('utf-8', errors='ignore'))

if __name__ == "__main__":
    generate_test_audio()
    test_partial_decode()
