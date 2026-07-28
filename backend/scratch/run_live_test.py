import asyncio
import websockets
import json
import time
import subprocess
import os

async def simulate_live_recording():
    uri = "ws://localhost:8000/api/ws/audio"
    
    print("Generating 40 seconds of test audio in 1-second chunks...")
    subprocess.run([
        "ffmpeg", "-f", "lavfi", "-i", "anoisesrc=r=16000:d=40",
        "-c:a", "libopus", "-segment_time", "1", "-f", "segment",
        "chunk%03d.webm", "-y"
    ], capture_output=True)
    
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
            os.remove(f)

if __name__ == "__main__":
    asyncio.run(simulate_live_recording())
