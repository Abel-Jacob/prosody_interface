import asyncio
import websockets
import json
import time
import subprocess
import os
import shutil

async def simulate_live_recording():
    uri = "ws://localhost:8000/api/ws/audio"
    
    # First loop the sample.flac to make it 40 seconds long
    print("Looping sample.flac to 40 seconds...")
    subprocess.run([
        "ffmpeg", "-stream_loop", "-1", "-i", "sample.flac",
        "-t", "40", "-c:a", "pcm_s16le", "-ar", "16000", "long_speech.wav", "-y"
    ], capture_output=True)
    
    print("Generating 40 seconds of test audio in 1-second chunks...")
    subprocess.run([
        "ffmpeg", "-i", "long_speech.wav",
        "-c:a", "libopus", "-segment_time", "1", "-f", "segment",
        "chunk%03d.webm", "-y"
    ], capture_output=True)
    
    if not os.path.exists("chunk000.webm"):
        print("Failed to generate chunks!")
        return
        
    header = open("chunk000.webm", "rb").read()
    chunks = []
    for i in range(1, 41):
        filename = f"chunk{i:03d}.webm"
        if os.path.exists(filename):
            chunks.append(open(filename, "rb").read())
            
    print(f"Generated header and {len(chunks)} chunks.")
    
    start_time = time.time()
    
    async def listen(ws):
        while True:
            try:
                msg = await asyncio.wait_for(ws.recv(), timeout=2.0)
                msg_data = json.loads(msg)
                elapsed = time.time() - start_time
                if msg_data.get("type") == "incremental_words":
                    words = msg_data.get("words", [])
                    print(f"\n[FRONTEND RECV t={elapsed:.2f}s] Received incremental_words:")
                    print(f"   Text: '{msg_data.get('text')}'")
                    stress_vals = [w.get("stress") for w in words]
                    print(f"   Stress array: {stress_vals}")
            except asyncio.TimeoutError:
                continue
            except websockets.exceptions.ConnectionClosed:
                print("Server closed connection.")
                break
            except Exception as e:
                print(f"Listen error: {e}")
                break

    try:
        async with websockets.connect(uri) as ws:
            print(f"[{time.time()-start_time:.2f}s] Connected to websocket.")
            
            # Start listener task
            listener_task = asyncio.create_task(listen(ws))
            
            print(f"[{time.time()-start_time:.2f}s] Sending header.")
            await ws.send(header)
            
            for i, chunk in enumerate(chunks):
                await asyncio.sleep(1.0) # simulate exactly 1 second per chunk
                print(f"[{time.time()-start_time:.2f}s] Sending chunk {i+1}/40")
                await ws.send(chunk)
                
            print(f"[{time.time()-start_time:.2f}s] Sending stop.")
            await ws.send(json.dumps({"type": "stop"}))
            
            # Wait for backend to disconnect
            await listener_task
    except Exception as e:
        print(f"Connection failed: {e}")
        
    print("\nCleaning up temporary chunks...")
    for f in os.listdir("."):
        if f.startswith("chunk") and f.endswith(".webm"):
            try:
                os.remove(f)
            except:
                pass
    if os.path.exists("long_speech.wav"):
        try:
            os.remove("long_speech.wav")
        except:
            pass

if __name__ == "__main__":
    asyncio.run(simulate_live_recording())
