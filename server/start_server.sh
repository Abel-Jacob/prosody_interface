#!/usr/bin/env bash
# =================================================================
# Prosody Interface — Linux Server Startup Script
# =================================================================
set -e

# Change to server directory
cd "$(dirname "$0")"

# Check Python installation
if ! command -v python3 &> /dev/null; then
    echo "ERROR: python3 not found. Please install Python 3.10 or 3.11."
    exit 1
fi

# Create virtual environment if not already created
if [ ! -d "venv" ]; then
    echo "[1/3] Creating virtual environment (venv)..."
    python3 -m venv venv
fi

# Activate virtual environment
echo "[2/3] Activating virtual environment..."
source venv/bin/activate

# Upgrade pip and install requirements
echo "[3/3] Checking dependencies..."
pip install --upgrade pip --quiet
pip install -r requirements.txt --quiet

# Launch Uvicorn server
echo "======================================================="
echo " Starting Prosody Interface Backend Server..."
echo "======================================================="
python3 -m uvicorn main:app --host "${HOST:-0.0.0.0}" --port "${PORT:-8000}"
