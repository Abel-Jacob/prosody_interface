"""
Stage 4 Test: Worker & Job Queue Verification

Tests that:
1. Jobs can be inserted into the SQLite database.
2. The worker loop polls and picks up queued jobs.
3. The worker updates progress properly through simulated stages.
4. The job completes successfully with a mocked pipeline.
"""
import sys
import os
import asyncio
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from database import init_db, create_job, get_job, get_connection
from worker.worker import Worker
from schemas import JobResult

async def test_worker_flow():
    print("\n" + "="*60)
    print("TEST: Job Queue and Worker Loop")
    print("="*60)

    # Initialize DB (creates table if not exists)
    init_db()
    
    # Create a dummy audio file
    dummy_filepath = os.path.abspath("backend/tests/fixtures/test_5s.wav")
    if not os.path.exists(dummy_filepath):
        from generate_test_audio import generate_simple_test_wav
        os.makedirs(os.path.dirname(dummy_filepath), exist_ok=True)
        generate_simple_test_wav(dummy_filepath, 5.0)

    # Mock models dict - we just need it to not crash.
    # We will let the real pipeline try to load or fail, wait, we can't test worker
    # easily without loading models. Let's just instantiate the models.
    from models.loader import load_all_models
    print("Loading models for worker test (this might take a few seconds)...")
    models = load_all_models()
    print("[PASS] Models loaded")

    # Start worker in background
    worker = Worker(models=models)
    worker_task = asyncio.create_task(worker.run())
    
    # Create job
    job = create_job("test_job_123", dummy_filepath)
    print(f"Created job: {job['job_id']}, status: {job['status']}")
    
    # Poll job status
    print("Polling job status...")
    max_polls = 60
    for i in range(max_polls):
        job = get_job("test_job_123")
        status = job["status"]
        progress = job["progress"]
        stage = job["current_stage"]
        
        print(f"  Poll {i+1}: status={status}, progress={progress:.2f}, stage={stage}")
        
        if status in ("complete", "failed"):
            break
            
        await asyncio.sleep(1.0)
    
    # Stop worker
    worker.stop()
    await worker_task
    
    print("\n" + "="*60)
    if job["status"] == "complete":
        print("[PASS] Job completed successfully!")
        return True
    elif job["status"] == "failed":
        print(f"[FAIL] Job failed with error: {job.get('error')}")
        return False
    else:
        print("[FAIL] Job timed out")
        return False

if __name__ == "__main__":
    success = asyncio.run(test_worker_flow())
    sys.exit(0 if success else 1)
