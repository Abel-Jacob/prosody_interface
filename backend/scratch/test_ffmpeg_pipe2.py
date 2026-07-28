import asyncio

async def test_pipe2():
    with open("test.webm", "rb") as f:
        data = f.read()
        
    # Split into 10 chunks
    chunk_size = len(data) // 10
    chunks = [data[i:i+chunk_size] for i in range(0, len(data), chunk_size)]

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
            
    asyncio.create_task(read_stdout())
    
    for i, c in enumerate(chunks):
        print(f"Writing chunk {i}")
        process.stdin.write(c)
        await process.stdin.drain()
        await asyncio.sleep(0.5)
        
    process.stdin.close()
    await process.wait()
    print(f"Finished. Total PCM bytes: {len(pcm_data)} ({len(pcm_data)/32000} seconds)")

if __name__ == "__main__":
    asyncio.run(test_pipe2())
