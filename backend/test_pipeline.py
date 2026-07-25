import asyncio
import sqlite3
import os
from config import DB_PATH
from worker.worker import _process_job

job_id = "e2229e0c-9d85-4483-a718-4fe058a87322"

# Reset job status to pending
conn = sqlite3.connect(DB_PATH)
cursor = conn.cursor()
cursor.execute("UPDATE jobs SET status='pending' WHERE id=?", (job_id,))
conn.commit()
conn.close()

print(f"Re-running job {job_id} through full pipeline...")

async def run():
    await _process_job(DB_PATH, job_id)
    
    # Read the final result
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT transcription FROM jobs WHERE id=?", (job_id,))
    res = cursor.fetchone()
    conn.close()
    
    if res and res[0]:
        import json
        data = json.loads(res[0])
        print("\n=== FULL PIPELINE RESULT ===")
        print(" ".join([p["text"] for p in data]))
        print("============================")

if __name__ == "__main__":
    asyncio.run(run())
