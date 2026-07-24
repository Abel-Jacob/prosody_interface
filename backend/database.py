"""
Prosody Interface Backend — SQLite Database

Job table schema and CRUD operations. Jobs track the lifecycle:
queued -> processing -> complete | failed

Progress is updated per-chunk by the worker, polled by the frontend.
"""

import sqlite3
import json
import time
from pathlib import Path
from contextlib import contextmanager
from typing import Optional

from config import DB_PATH


def init_db():
    """Create the jobs table if it doesn't exist."""
    with get_connection() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS jobs (
                job_id TEXT PRIMARY KEY,
                status TEXT NOT NULL DEFAULT 'queued',
                progress REAL NOT NULL DEFAULT 0.0,
                created_at REAL NOT NULL,
                started_at REAL,
                completed_at REAL,
                filepath TEXT NOT NULL,
                total_chunks INTEGER DEFAULT 0,
                completed_chunks INTEGER DEFAULT 0,
                current_stage TEXT DEFAULT '',
                result TEXT DEFAULT '{}',
                error TEXT DEFAULT ''
            )
        """)
        conn.commit()


@contextmanager
def get_connection():
    """Thread-safe SQLite connection with WAL mode for concurrent reads."""
    conn = sqlite3.connect(str(DB_PATH), timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    try:
        yield conn
    finally:
        conn.close()


def create_job(job_id: str, filepath: str) -> dict:
    """Insert a new queued job. Returns the job dict."""
    now = time.time()
    with get_connection() as conn:
        conn.execute(
            """INSERT INTO jobs (job_id, status, progress, created_at, filepath, result)
               VALUES (?, 'queued', 0.0, ?, ?, '{}')""",
            (job_id, now, filepath),
        )
        conn.commit()
    return get_job(job_id)


def get_job(job_id: str) -> Optional[dict]:
    """Fetch a job by ID. Returns None if not found."""
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM jobs WHERE job_id = ?", (job_id,)
        ).fetchone()
        if row is None:
            return None
        return _row_to_dict(row)


def get_next_queued_job() -> Optional[dict]:
    """Fetch the oldest queued job (FIFO). Returns None if queue is empty."""
    with get_connection() as conn:
        row = conn.execute(
            """SELECT * FROM jobs WHERE status = 'queued'
               ORDER BY created_at ASC LIMIT 1"""
        ).fetchone()
        if row is None:
            return None
        return _row_to_dict(row)


def update_job_status(job_id: str, status: str, **kwargs):
    """Update job status and any additional fields."""
    sets = ["status = ?"]
    values = [status]

    if status == "processing" and "started_at" not in kwargs:
        kwargs["started_at"] = time.time()
    if status in ("complete", "failed") and "completed_at" not in kwargs:
        kwargs["completed_at"] = time.time()

    for key, value in kwargs.items():
        if key == "result" and isinstance(value, dict):
            value = json.dumps(value)
        sets.append(f"{key} = ?")
        values.append(value)

    values.append(job_id)

    with get_connection() as conn:
        conn.execute(
            f"UPDATE jobs SET {', '.join(sets)} WHERE job_id = ?",
            values,
        )
        conn.commit()


def update_job_progress(job_id: str, progress: float, completed_chunks: int,
                         current_stage: str = "", partial_result: Optional[dict] = None):
    """Update job progress after a chunk completes. Called by the worker."""
    sets = "progress = ?, completed_chunks = ?, current_stage = ?"
    values = [progress, completed_chunks, current_stage]

    if partial_result is not None:
        sets += ", result = ?"
        values.append(json.dumps(partial_result))

    values.append(job_id)

    with get_connection() as conn:
        conn.execute(
            f"UPDATE jobs SET {sets} WHERE job_id = ?",
            values,
        )
        conn.commit()


def _row_to_dict(row: sqlite3.Row) -> dict:
    """Convert a sqlite3.Row to a plain dict, parsing JSON fields."""
    d = dict(row)
    if "result" in d and isinstance(d["result"], str):
        try:
            d["result"] = json.loads(d["result"])
        except (json.JSONDecodeError, TypeError):
            d["result"] = {}
    return d
