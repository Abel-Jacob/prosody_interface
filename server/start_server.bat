@echo off
:: =================================================================
:: Prosody Interface — Windows Server Startup Script
:: =================================================================
cd /d "%~dp0"

echo [1/3] Checking virtual environment...
if not exist "venv" (
    echo Creating virtual environment (venv)...
    python -m venv venv
)

echo [2/3] Activating virtual environment...
call venv\Scripts\activate.bat

echo [3/3] Checking dependencies...
python -m pip install --upgrade pip --quiet
pip install -r requirements.txt --quiet

echo =======================================================
echo  Starting Prosody Interface Backend Server...
echo =======================================================
python -m uvicorn main:app --host 0.0.0.0 --port 8000
pause
