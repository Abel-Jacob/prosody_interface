# Prosody Interface — Work Server Deployment Guide

This `server/` folder is a **clean, production-ready, self-contained backend package**. It contains all the necessary API routes, audio processing pipelines, and neural network weights required to serve the frontend application deployed on Vercel.

---

## 1. Directory Structure Overview

```text
server/
├── api/                    # FastAPI routes (audio upload, jobs, WebSocket, LexiRep training)
│   ├── routes.py
│   ├── websocket.py
│   ├── lexirep_routes.py
│   └── lexirep_training.py
├── checkpoints/            # Pretrained LexiRep syllable stress models (~1.3 MB total)
│   ├── final_lexirep_model_fused.pt
│   ├── final_lexirep_model_ger.pt
│   └── final_lexirep_model_ita.pt
├── models/                 # Model loader & memory cache
│   └── loader.py
├── pipeline/               # Core audio & prosody algorithms (ASR, VAD, MAE pitch, stress)
├── vendor/                 # WhiStress model package & weights (~41 MB)
│   └── whistress_pkg/
├── worker/                 # Background job queue worker
├── config.py               # Central settings (ports, device, paths, limits)
├── database.py             # SQLite job queue (auto-creates jobs.db)
├── schemas.py              # Pydantic data schemas
├── main.py                 # FastAPI application entry point
├── requirements.txt        # Production dependencies
├── .env.example            # Environment variables template
├── start_server.sh         # One-click startup script for Linux
└── start_server.bat        # One-click startup script for Windows
```

---

## 2. Moving Files to Your Work Server

You only need to transfer this `server/` folder to your work server.

### Option A: Using SCP / RSYNC
From your local terminal:
```bash
# Using rsync (recommended):
rsync -avz --progress ./server/ user@your-work-server-ip:/path/to/server/

# Or using scp:
scp -r ./server user@your-work-server-ip:/path/to/server
```

### Option B: Zip and Transfer
1. Compress the `server/` folder into `server.zip`.
2. Transfer `server.zip` via SFTP or your cloud console.
3. Unzip on the server:
   ```bash
   unzip server.zip -d server
   cd server
   ```

---

## 3. Server Setup & Installation

### Prerequisites
- **Python**: Version `3.10` or `3.11`
- **FFmpeg**: Required for audio decoding:
  - Ubuntu/Debian: `sudo apt update && sudo apt install -y ffmpeg`
  - CentOS/RHEL: `sudo yum install -y ffmpeg`

### Step 1: Create Virtual Environment
```bash
cd /path/to/server
python3 -m venv venv
source venv/bin/activate
```

### Step 2: Install PyTorch Matching Your Server Hardware

- **If your work server has an NVIDIA GPU (CUDA 12.1)**:
  ```bash
  pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121
  ```
- **If your work server is CPU-only**:
  ```bash
  pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu
  ```

### Step 3: Install Remaining Dependencies
```bash
pip install -r requirements.txt
```

### Step 4: Configure Environment Variables (Optional)
Copy `.env.example` to `.env` and customize if needed:
```bash
cp .env.example .env
```
Default settings:
- `PORT=8000`
- `HOST=0.0.0.0`
- `CORS_ORIGINS=*` (allows cross-origin requests from your Vercel domain)

---

## 4. Running the Backend Server

### Quick Start (Linux / macOS)
```bash
chmod +x start_server.sh
./start_server.sh
```

### Direct Command (using Uvicorn)
```bash
source venv/bin/activate
python3 -m uvicorn main:app --host 0.0.0.0 --port 8000
```

### Running Persistently in Background (Production)

#### Option 1: Using `tmux` or `screen` (Easiest)
```bash
tmux new -s prosody
source venv/bin/activate
python3 -m uvicorn main:app --host 0.0.0.0 --port 8000
# Press Ctrl+B then D to detach
```

#### Option 2: Using `systemd` Service (Recommended for dedicated servers)
Create `/etc/systemd/system/prosody.service`:
```ini
[Unit]
Description=Prosody Interface Backend
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/path/to/server
ExecStart=/path/to/server/venv/bin/python3 -m uvicorn main:app --host 0.0.0.0 --port 8000
Restart=always
RestartSec=5
EnvironmentFile=/path/to/server/.env

[Install]
WantedBy=multi-user.target
```
Then start and enable:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now prosody
sudo systemctl status prosody
```

---

## 5. Connecting with Your Vercel Frontend

### Critical Requirement: HTTPS / SSL for Vercel
Because your frontend is hosted on Vercel with **HTTPS** (`https://your-app.vercel.app`), web browsers enforce **Mixed Content** security rules:
- Browsers will **block** plain HTTP (`http://`) or plain WS (`ws://`) requests initiated from an HTTPS web app.
- Therefore, your work server backend must be accessible over **HTTPS** / **WSS**.

Here are the best ways to provide an HTTPS endpoint for your work server:

### Solution 1: Cloudflare Tunnel (Free & No Port Forwarding Required)
If your work server doesn't have an open public IP or SSL certificate:
1. Install `cloudflared`:
   ```bash
   curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
   sudo dpkg -i cloudflared.deb
   ```
2. Start a quick tunnel:
   ```bash
   cloudflared tunnel --url http://localhost:8000
   ```
3. Cloudflare will output an HTTPS URL like:
   `https://random-words.trycloudflare.com`

### Solution 2: Nginx + Let's Encrypt (If you have a domain pointing to the server)
Configure Nginx to proxy port 8000 with SSL:
```nginx
server {
    server_name api.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }
}
```
Obtain SSL via Certbot: `sudo certbot --nginx -d api.yourdomain.com`

---

## 6. Pointing the Vercel Frontend to the Server

Once your server has an HTTPS URL (e.g. `https://api.yourdomain.com` or `https://random-words.trycloudflare.com`):

### Method A: Directly in the UI (Runtime)
1. Open your Vercel deployment in the browser.
2. In the floating bottom-left config widget (`SERVER URL` box), paste your domain or tunnel:
   ```text
   api.yourdomain.com
   ```
   *(or the Cloudflare tunnel domain without the `https://` prefix)*.
3. The frontend stores this in `localStorage` and routes all API and WebSocket requests to your work server.

### Method B: Build Environment Variable in Vercel
1. Go to your project on **Vercel Dashboard** → **Settings** → **Environment Variables**.
2. Add:
   - **Key**: `VITE_BACKEND_DOMAIN`
   - **Value**: `api.yourdomain.com` (or your tunnel domain, e.g. `my-tunnel.trycloudflare.com`)
3. Redeploy your frontend on Vercel.

---

## 7. Verification

Verify the server is running properly by querying the health endpoint from any terminal:
```bash
curl http://localhost:8000/health
# Returns: {"status":"ok"}

curl http://localhost:8000/
# Returns: {"status":"ok","message":"Prosody Interface Backend is running and ready!", ...}
```
