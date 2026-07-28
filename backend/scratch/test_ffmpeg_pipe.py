import asyncio
import os

async def test_pipe():
    chunks = []
    for i in range(0, 10):
        filename = f"test_chunk{i:03d}.webm"
        if os.path.exists(filename):
            chunks.append(open(filename, "rb").read())
            
    if not chunks:
        print("No chunks found.")
        return

    process = await asyncio.create_subprocess_exec(
        'ffmpeg', '-i', 'pipe:0', '-f', 's16le', '-acodec', 'pcm_s16le', '-ac', '1', '-ar', '16000', '-',
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )
    
    pcm_data = bytearray()
    
    async def read_stdout():
        while True:
            chunk = await process.stdout.read(4096)
            if not chunk:
                break
            pcm_data.extend(chunk)
            print(f"Read {len(chunk)} bytes. Total PCM: {len(pcm_data)}")
            
    async def read_stderr():
        while True:
            chunk = await process.stderr.read(4096)
            if not chunk:
                break
            # print("FFMPEG LOG:", chunk.decode('utf-8', errors='ignore'))
            
    asyncio.create_task(read_stdout())
    asyncio.create_task(read_stderr())
    
    for i, c in enumerate(chunks):
        print(f"Writing chunk {i}")
        process.stdin.write(c)
        await process.stdin.drain()
        await asyncio.sleep(1.0) # simulate real-time
        
    process.stdin.close()
    await process.wait()
    print(f"Finished. Total PCM bytes: {len(pcm_data)} ({len(pcm_data)/32000} seconds)")

if __name__ == "__main__":
    asyncio.run(test_pipe())
