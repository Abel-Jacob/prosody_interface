"""
Comprehensive Edgecase and Crash-Resilience Test Suite for Batch Processing
Tests:
1. Multi-file audio upload
2. ZIP with valid audio + 0-byte audio + corrupted audio + nested folders + non-audio junk
3. Pure silence audio (no speech)
4. Empty ZIP rejection (400)
5. Worker sequential execution with per-file error isolation
6. Export endpoints (/export/batch-json, /export/batch-txt, /export/batch-zip, /annotation?file=...)
7. Rapid repeated executions
"""

import io
import os
import sys
import wave
import zipfile
import struct
import math
import shutil
import asyncio
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient
from main import app
from database import init_db, get_job, update_job_status
from worker.worker import Worker
from config import AUDIO_UPLOADS_DIR, DB_PATH


def create_synthetic_wav(duration_sec=1.5, sample_rate=16000, freq=440.0, silence=False) -> bytes:
    """Generate a valid PCM 16-bit mono WAV in memory."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        n_samples = int(duration_sec * sample_rate)
        if silence:
            raw_data = b"\x00\x00" * n_samples
        else:
            samples = []
            for i in range(n_samples):
                t = i / sample_rate
                val = int(16000 * math.sin(2 * math.pi * freq * t))
                samples.append(struct.pack("<h", val))
            raw_data = b"".join(samples)
        wf.writeframes(raw_data)
    return buf.getvalue()


def run_tests():
    init_db()
    client = TestClient(app)

    print("\n" + "="*70)
    print("RUNNING PROSODY BATCH PROCESSING TEST SUITE")
    print("="*70)

    # -------------------------------------------------------------
    # Test 1: Empty ZIP rejection (400)
    # -------------------------------------------------------------
    print("\n[TEST 1] Empty ZIP rejection (zero audio files)...")
    empty_zip_buf = io.BytesIO()
    with zipfile.ZipFile(empty_zip_buf, "w") as zf:
        zf.writestr("readme.txt", "this archive has no audio files.")
    empty_zip_buf.seek(0)

    res = client.post(
        "/api/jobs",
        files={"audio": ("empty_archive.zip", empty_zip_buf.getvalue(), "application/zip")},
    )
    assert res.status_code == 400, f"Expected 400, got {res.status_code}: {res.text}"
    print("  [PASS] Correctly rejected empty ZIP with 400 status")

    # -------------------------------------------------------------
    # Test 2: Upload multiple individual audio files at once
    # -------------------------------------------------------------
    print("\n[TEST 2] Multi-file audio upload (3 separate files)...")
    wav1 = create_synthetic_wav(duration_sec=1.0, freq=440.0)
    wav2 = create_synthetic_wav(duration_sec=1.2, freq=550.0)
    wav3 = create_synthetic_wav(duration_sec=0.8, freq=660.0)

    multi_files = [
        ("files", ("audio_1.wav", wav1, "audio/wav")),
        ("files", ("audio_2.wav", wav2, "audio/wav")),
        ("files", ("audio_3.wav", wav3, "audio/wav")),
    ]
    res = client.post("/api/jobs", files=multi_files)
    assert res.status_code == 200, f"Multi-file upload failed: {res.text}"
    job2_id = res.json()["job_id"]
    print(f"  [PASS] Multi-file job created: {job2_id}")

    job_data = get_job(job2_id)
    assert job_data is not None
    batch_dir = Path(job_data["filepath"])
    assert batch_dir.is_dir(), f"Expected directory {batch_dir}"
    extracted_files = list(batch_dir.glob("*.wav"))
    assert len(extracted_files) == 3, f"Expected 3 files, found {len(extracted_files)}"
    print(f"  [PASS] Successfully staged {len(extracted_files)} files in {batch_dir.name}")

    # -------------------------------------------------------------
    # Test 3: ZIP with valid, 0-byte, corrupt, nested, and non-audio files
    # -------------------------------------------------------------
    print("\n[TEST 3] Comprehensive ZIP archive with edge cases...")
    complex_zip = io.BytesIO()
    with zipfile.ZipFile(complex_zip, "w") as zf:
        # Valid audio
        zf.writestr("valid_tone.wav", create_synthetic_wav(duration_sec=1.0, freq=440.0))
        # Silence audio
        zf.writestr("silence.wav", create_synthetic_wav(duration_sec=1.5, silence=True))
        # 0-byte corrupt file
        zf.writestr("zero_byte.wav", b"")
        # Corrupted header / random junk
        zf.writestr("corrupted_junk.wav", b"RIFF\x00\x00\x00\x00WAVEfmt \x10\x00\x00\x00INVALIDBYTESCORRUPTED")
        # Nested directory
        zf.writestr("deep/nested/subfolder_audio.wav", create_synthetic_wav(duration_sec=0.7, freq=880.0))
        # Duplicate basename in different subfolder
        zf.writestr("another_folder/valid_tone.wav", create_synthetic_wav(duration_sec=0.5, freq=330.0))
        # Non-audio junk
        zf.writestr("document.pdf", b"%PDF-1.4 test")
        zf.writestr("image.png", b"\x89PNG\r\n\x1a\n")
        # macOS junk
        zf.writestr("__MACOSX/._valid_tone.wav", b"junk")
        zf.writestr(".DS_Store", b"junk")

    complex_zip.seek(0)
    res = client.post(
        "/api/jobs",
        files={"audio": ("complex_batch.zip", complex_zip.getvalue(), "application/zip")},
    )
    assert res.status_code == 200, f"Complex ZIP upload failed: {res.text}"
    complex_job_id = res.json()["job_id"]
    print(f"  [PASS] Complex ZIP job created: {complex_job_id}")

    complex_job_data = get_job(complex_job_id)
    c_batch_dir = Path(complex_job_data["filepath"])
    c_files = list(c_batch_dir.glob("*.wav"))
    print(f"  [PASS] Extracted {len(c_files)} audio files (filtered non-audio and macOS artifacts)")
    assert len(c_files) == 6, f"Expected 6 audio files, got {len(c_files)}"

    # -------------------------------------------------------------
    # Test 4: Worker processing & crash-resilience
    # -------------------------------------------------------------
    print("\n[TEST 4] Testing Worker batch execution and error isolation...")
    class MockWord:
        def __init__(self, word, start, end, probability=0.95):
            self.word = word
            self.start = start
            self.end = end
            self.probability = probability

    class MockSegment:
        def __init__(self, text, words=None, no_speech_prob=0.05):
            self.text = text
            self.words = words or []
            self.no_speech_prob = no_speech_prob

    class MockASR:
        def transcribe(self, audio, **kwargs):
            import numpy as np
            if hasattr(audio, "shape") and len(audio) > 0 and float(np.max(np.abs(audio))) < 1e-4:
                return [MockSegment("", [], no_speech_prob=0.99)], None
            return [
                MockSegment(
                    "Hello world this is a batch prosody test.",
                    [
                        MockWord("Hello", 0.0, 0.2),
                        MockWord("world", 0.25, 0.5),
                        MockWord("this", 0.55, 0.7),
                        MockWord("is", 0.75, 0.85),
                        MockWord("a", 0.9, 0.95),
                        MockWord("batch", 1.0, 1.2),
                        MockWord("prosody", 1.25, 1.4),
                        MockWord("test.", 1.45, 1.5),
                    ]
                )
            ], None

    mock_models = {
        "sample_rate": 16000,
        "asr_final": MockASR(),
    }

    worker = Worker(mock_models)

    async def run_worker_test():
        await worker._process_batch_job(complex_job_data)

    asyncio.run(run_worker_test())

    # Check database status
    finished_job = get_job(complex_job_id)
    assert finished_job["status"] == "complete", f"Expected job complete, got {finished_job['status']}: {finished_job.get('error')}"
    print(f"  [PASS] Batch completed without crashing! Status: {finished_job['status']}")

    result = finished_job["result"]
    assert result.get("is_batch") is True, "Result missing is_batch flag"
    print(f"  [PASS] Completed files: {result.get('completed_files')}, Failed files: {result.get('failed_files')}")
    assert result.get("failed_files") >= 2, "Expected at least 2 failed files (0-byte and corrupt)"
    assert result.get("completed_files") >= 3, "Expected at least 3 completed files"

    # Verify corrupt file has error recorded
    file_items = result.get("files", [])
    zero_byte_item = next((f for f in file_items if "zero_byte" in f["filename"]), None)
    assert zero_byte_item is not None
    assert zero_byte_item["status"] == "error", f"Expected zero_byte to fail, got {zero_byte_item['status']}"
    assert zero_byte_item.get("error") is not None
    print(f"  [PASS] Error correctly isolated for zero_byte.wav: {zero_byte_item['error'][:50]}...")

    # -------------------------------------------------------------
    # Test 5: Verify all Export Endpoints
    # -------------------------------------------------------------
    print("\n[TEST 5] Verifying all Export Endpoints on completed batch...")

    # 5a. GET /api/jobs/{id}/export/batch-json
    res_json = client.get(f"/api/jobs/{complex_job_id}/export/batch-json")
    assert res_json.status_code == 200, f"batch-json failed: {res_json.status_code}"
    batch_json_data = res_json.json()
    assert batch_json_data.get("is_batch") is True
    print("  [PASS] GET /export/batch-json: 200 OK, valid JSON")

    # 5b. GET /api/jobs/{id}/export/batch-txt
    res_txt = client.get(f"/api/jobs/{complex_job_id}/export/batch-txt")
    assert res_txt.status_code == 200, f"batch-txt failed: {res_txt.status_code}"
    assert "BATCH ANNOTATION TRANSCRIPTS" in res_txt.text
    assert "FILE [" in res_txt.text
    print("  [PASS] GET /export/batch-txt: 200 OK, clean file-wise transcripts")

    # 5c. GET /api/jobs/{id}/export/batch-zip
    res_zip = client.get(f"/api/jobs/{complex_job_id}/export/batch-zip")
    assert res_zip.status_code == 200, f"batch-zip failed: {res_zip.status_code}"
    zip_bytes = io.BytesIO(res_zip.content)
    with zipfile.ZipFile(zip_bytes, "r") as zf:
        namelist = zf.namelist()
        assert "batch_summary.json" in namelist
        print(f"  [PASS] GET /export/batch-zip: 200 OK, valid ZIP containing {len(namelist)} items")

    # 5d. GET /api/jobs/{id}/annotation (Batch manifest)
    res_ann = client.get(f"/api/jobs/{complex_job_id}/annotation")
    assert res_ann.status_code == 200
    assert res_ann.json().get("is_batch") is True
    assert res_ann.json().get("job_id") == complex_job_id
    print("  [PASS] GET /annotation: 200 OK, includes job_id and file list")

    # 5e. GET /api/jobs/{id}/annotation?file={valid_filename}
    valid_file = next(f for f in file_items if f["status"] == "complete")
    res_single = client.get(f"/api/jobs/{complex_job_id}/annotation?file={valid_file['filename']}")
    assert res_single.status_code == 200
    assert "phrases" in res_single.json()
    print(f"  [PASS] GET /annotation?file={valid_file['filename']}: 200 OK, canonical annotation returned")

    # 5f. GET /api/jobs/{id}/annotation?file=nonexistent.wav -> 404
    res_404 = client.get(f"/api/jobs/{complex_job_id}/annotation?file=nonexistent.wav")
    assert res_404.status_code == 404
    print("  [PASS] GET /annotation?file=nonexistent.wav: 404 Not Found")

    # -------------------------------------------------------------
    # Test 6: Repeated executions to verify no state leak (10 runs)
    # -------------------------------------------------------------
    print("\n[TEST 6] Running multiple repeated batch submissions (10 iterations)...")
    for i in range(10):
        repeat_zip = io.BytesIO()
        with zipfile.ZipFile(repeat_zip, "w") as zf:
            zf.writestr(f"repeat_tone_{i}.wav", create_synthetic_wav(duration_sec=0.5, freq=440.0 + i*50))
        repeat_zip.seek(0)
        r = client.post(
            "/api/jobs",
            files={"audio": (f"repeat_{i}.zip", repeat_zip.getvalue(), "application/zip")},
        )
        assert r.status_code == 200
        r_jid = r.json()["job_id"]
        r_data = get_job(r_jid)
        asyncio.run(worker._process_batch_job(r_data))
        r_fin = get_job(r_jid)
        assert r_fin["status"] == "complete"
        print(f"  [PASS] Iteration {i+1}/10: job {r_jid[:8]} completed successfully")

    # -------------------------------------------------------------
    # Test 7: Non-audio only ZIP rejection (400)
    # -------------------------------------------------------------
    print("\n[TEST 7] Testing ZIP with only non-audio files...")
    non_audio_zip = io.BytesIO()
    with zipfile.ZipFile(non_audio_zip, "w") as zf:
        zf.writestr("notes.txt", b"meeting notes")
        zf.writestr("presentation.pdf", b"%PDF-1.4 test")
        zf.writestr("image.png", b"\x89PNG\r\n\x1a\n")
    non_audio_zip.seek(0)
    res_na = client.post(
        "/api/jobs",
        files={"audio": ("non_audio_only.zip", non_audio_zip.getvalue(), "application/zip")},
    )
    assert res_na.status_code == 400, f"Expected 400 for non-audio ZIP, got {res_na.status_code}"
    print("  [PASS] Correctly rejected ZIP containing zero audio files (400 Bad Request)")

    # -------------------------------------------------------------
    # Test 8: Special characters in filenames & URL encoding
    # -------------------------------------------------------------
    print("\n[TEST 8] Filenames with spaces, brackets, and symbols...")
    tricky_filename = "acoustic tone (take 1) [final] - test.wav"
    tricky_zip = io.BytesIO()
    with zipfile.ZipFile(tricky_zip, "w") as zf:
        zf.writestr(tricky_filename, create_synthetic_wav(duration_sec=0.5, freq=520.0))
    tricky_zip.seek(0)
    res_tricky = client.post(
        "/api/jobs",
        files={"audio": ("tricky.zip", tricky_zip.getvalue(), "application/zip")},
    )
    assert res_tricky.status_code == 200
    tricky_jid = res_tricky.json()["job_id"]
    tricky_data = get_job(tricky_jid)
    asyncio.run(worker._process_batch_job(tricky_data))
    
    # Query with raw filename
    res_query = client.get(f"/api/jobs/{tricky_jid}/annotation?file={tricky_filename}")
    assert res_query.status_code == 200, f"Failed to retrieve annotation for tricky filename: {res_query.status_code}"
    assert res_query.json().get("filename") == tricky_filename
    print(f"  [PASS] Successfully retrieved file-specific annotation for '{tricky_filename}'")

    # Verify ZIP export handles special characters cleanly
    res_tricky_zip = client.get(f"/api/jobs/{tricky_jid}/export/batch-zip")
    assert res_tricky_zip.status_code == 200
    with zipfile.ZipFile(io.BytesIO(res_tricky_zip.content), "r") as zf:
        names = zf.namelist()
        assert any(tricky_filename.split(".")[0] in n for n in names)
    print("  [PASS] Export ZIP cleanly formatted and contains individual report for tricky filename")

    print("\n" + "="*70)
    print("ALL TESTS PASSED SUCCESSFULLY! ZERO CRASHES.")
    print("="*70 + "\n")


if __name__ == "__main__":
    run_tests()

