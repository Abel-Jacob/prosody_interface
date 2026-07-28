# Prosody Interface: Project Overview & Technical Deep Dive

This document explains the architecture, flow, and code structure of the Prosody Interface project. It is designed so that anyone can understand the system in simple terms, while also providing deep, technical explanations of exactly how the code computes and processes data under the hood.

---

## 1. The Big Picture: How the System Works

At its core, this project is a real-time web application that does two things:
1. **Transcribes your speech into text** on the fly.
2. **Analyzes your speech** to detect which specific words you stressed or emphasized (your "prosody").

The system is split into two halves:
- **The Frontend (The User Interface):** The website you see in your browser. It manages your microphone, shows a live preview of what you are saying, and displays the final colored results.
- **The Backend (The Brain):** The server. It receives your audio, runs Artificial Intelligence (AI) models to understand the text and stress, and sends the data back to the frontend.

---

## 2. How the Frontend and Backend Connect

1. **The WebSocket (For Live Preview):** 
   While you speak, the frontend chops your voice into tiny chunks and streams them to the backend through an open, two-way WebSocket connection. The backend instantly runs a fast transcription and whispers back the text so you see it in real-time.
   * **Technical Detail:** The frontend uses the browser's `MediaRecorder` API to emit `audio/webm;codecs=opus` blobs every 1 second. The backend concatenates these binary blobs in memory and streams them through an OS-level `ffmpeg` subprocess to decode the Opus packets into raw, 16kHz Mono PCM float32 arrays on the fly.

2. **The REST API (For Final Processing):** 
   When you stop recording, the backend puts the full audio in a "Job Queue". The frontend repeatedly asks the server via an HTTP GET request (polling), *"What percentage is complete?"* Once the backend finishes the heavy AI lifting, the frontend grabs the final, highly accurate results.

---

## 3. Detailed Backend Breakdown (File by File)

The backend is built using **FastAPI** and is heavily optimized to run AI inference efficiently on constrained hardware.

### A. The Base Files (The Foundation)

#### `backend/main.py`
* **Simple Explanation:** The starting point of the server. It initializes the database, loads all the AI models into memory once, starts the background worker, and opens the network routes.
* **Technical Deep Dive:** FastAPI uses an `asynccontextmanager` called `lifespan` to handle startup. Here, it calls `load_all_models()` and attaches the models to `app.state.models` so they persist globally across all requests. It then spawns the `Worker` class as an `asyncio.create_task()`. This architecture completely decouples the heavy inference pipeline from the ASGI event loop, ensuring the web server never blocks while the GPU/CPU is busy.

#### `backend/config.py`
* **Simple Explanation:** The master settings file. It automatically checks if you have a GPU (`cuda`) or just a CPU, and sets up paths and rules for the AI models.
* **Technical Deep Dive:** It runs `torch.cuda.is_available()` at import-time. If true, it assigns `ASR_DEVICE = "cuda"` and `ASR_COMPUTE_TYPE = "float16"`. If false, it gracefully degrades to `"cpu"` and `"int8"` quantization. This prevents PyTorch from throwing silent `CUDA out of memory` or `No CUDA runtime` exceptions on hardware without NVIDIA GPUs.

#### `backend/database.py` & `backend/schemas.py`
* **Simple Explanation:** `database.py` manages a local SQLite file (`jobs.db`) to track audio processing progress. `schemas.py` acts as a dictionary that defines exactly what data looks like (e.g., a "Word" has a text, a start time, and a stress score).
* **Technical Deep Dive:** `database.py` uses standard `sqlite3` with thread-safe queries to prevent the worker thread and the ASGI thread from locking the database. `schemas.py` utilizes `Pydantic V2` (`BaseModel`). Every payload sent to the frontend is strictly validated and serialized using `.model_dump()`, ensuring no malformed JSON ever crashes the frontend state machine.

---

### B. The Network Layer (Talking to the Frontend)

#### `backend/api/websocket.py`
* **Simple Explanation:** Receives live audio chunks, runs a quick Whisper transcription, and shoots live words back to the frontend. When you stop, it saves the audio to the hard drive.
* **Technical Deep Dive:** 
  1. **Accumulation:** As `bytes` arrive, they are appended to an array. 
  2. **Decoding:** Every ~2 seconds, it dumps the accumulated WebM bytes into a `tempfile` and spawns an `ffmpeg` thread to decode the entire stream up to that point into raw PCM audio.
  3. **Sliding Window:** It slices out the last 4 seconds of the PCM array (`audio_window = full_pcm[-4 * SAMPLE_RATE:]`).
  4. **Inference:** It passes this 4-second window to `asr_preview` using `asyncio.to_thread` to prevent event loop blocking. 
  5. **Offset Math:** Because it only transcribes the last 4 seconds, it compares the timestamps of the returned words against the `last_yielded_idx` to prevent sending the frontend duplicate words, ensuring a seamless, flicker-free live transcription.

#### `backend/api/routes.py`
* **Simple Explanation:** The standard REST API (e.g., `/api/jobs/{job_id}`) that the frontend polls for progress updates.

---

### C. The Heavy Lifter

#### `backend/worker/worker.py`
* **Simple Explanation:** A background worker that constantly checks the database for new jobs. When it finds one, it passes the audio through the AI Pipeline chunk by chunk, updating the database progress as it goes.
* **Technical Deep Dive:** It runs an infinite `while True` loop inside an `asyncio` task. When a job is found, it loads the saved `.webm` file using `librosa.load(sr=16000)`. It then calculates exactly how many VAD chunks the audio was split into. For each chunk, it updates the `progress` column in SQLite (e.g., `completed_chunks / total_chunks`). Because it processes chunk-by-chunk and yields to the event loop, a 10-minute audio file will not freeze the server, and if a specific chunk throws a tensor error, it catches it and moves to the next chunk without losing the entire job.

---

### D. The AI Pipeline (The Brain)

#### `pipeline/vad_chunking.py` (Voice Activity Detection)
* **Simple Explanation:** The "Silence Detector." It prevents the computer from running out of memory by chopping long audio recordings into small 10-20 second chunks during silent pauses.
* **Technical Deep Dive:** It loads the `Silero VAD` model from PyTorch Hub. It calculates speech probabilities across the waveform. Using `VAD_THRESHOLD = 0.5`, it identifies boundaries where speech probability drops below 50% for more than `VAD_MIN_SILENCE_MS`. It then slices the underlying NumPy array into sub-arrays (chunks) guaranteeing that Whisper never receives audio longer than its 30-second cross-attention window limit.

#### `pipeline/asr.py` (Automatic Speech Recognition)
* **Simple Explanation:** The Transcriber. It takes a chunk of audio and converts it into text, calculating exact timestamps for every word.
* **Technical Deep Dive:** It wraps the `faster-whisper` library, which runs on the `CTranslate2` inference engine. `CTranslate2` optimizes transformer models via weight quantization (converting 32-bit floats to 16-bit or 8-bit integers). This allows it to run up to 4x faster than standard OpenAI Whisper on a CPU. It extracts word-level timestamps by analyzing the cross-attention weights between the audio Mel-spectrogram and the generated text tokens.

#### `pipeline/prosody_stress.py` & `pipeline/prosody_registry.py`
* **Simple Explanation:** `prosody_registry.py` is a plugin manager for voice analyzers. It triggers `prosody_stress.py`, which feeds the audio into the WhiStress neural network to calculate an emphasis score (0.0 to 1.0) for each word.
* **Technical Deep Dive:** It aligns the Whisper word timestamps with the raw audio, extracting the specific audio frame for that word. It feeds both the audio frame and the textual token into the WhiStress model. WhiStress is a multi-modal model, meaning it analyzes both the acoustic energy (volume/pitch) and the semantic context to output a softmax probability of stress.

#### `pipeline/merge.py`
* **Simple Explanation:** The Organizer. It takes the text from Whisper and the scores from WhiStress, calculates their exact timings, and groups them into clean, grammatically correct sentences.
* **Technical Deep Dive:** 
  1. **Absolute Timestamping:** Because VAD chopped the audio at, say, 15.0 seconds, Whisper returns a word starting at `2.0s`. `merge.py` does the math: `15.0s (offset) + 2.0s = 17.0s (absolute)`. 
  2. **Punctuation Heuristics:** Whisper frequently hallucinates periods at the end of acoustic chunks. The `reconstruct_grammatical_phrases` function looks at the acoustic gap between words (`gap < 0.8s`). If a period is followed by a short gap and a common lowercase conjunction (like "and" or "because" in `COMMON_LOWERCASEABLE_WORDS`), the algorithm assumes the period is fake, strips it, and merges the two chunks into a single, flowing grammatical sentence.

---

### E. The Vendor Directory (The Neural Network Weights)

#### The `.pt` Files (`backend/vendor/whistress_pkg/weights/`)
* **Simple Explanation:** These are PyTorch Checkpoint files. They contain millions of mathematical numbers (weights) that the AI "learned" during training to recognize stressed words.
* **Technical Deep Dive:** These files (`classifier.pt` and `additional_decoder_block.pt`) are serialized dictionaries of PyTorch tensors. WhiStress uses the `openai/whisper-small.en` backbone to generate hidden-state embeddings from the audio. However, instead of passing these embeddings to the standard text-generation head, WhiStress bypasses it. It loads these `.pt` tensors into a custom Linear Classification layer. This custom layer takes the embeddings and projects them down into a binary classification output (`0` for unstressed, `1` for stressed), running it through a Sigmoid activation function to give us our `stress_score`.

#### `whistress_client.py` & `model.py`
* **Simple Explanation:** The bridge that loads the math files and runs the audio through them.
* **Technical Deep Dive:** `model.py` uses the `transformers` library to build the Neural Network graph in PyTorch. `whistress_client.py` instantiates this graph, loads the `.pt` state dictionaries into the GPU VRAM via `torch.load()`, and provides the `predict()` function that orchestrates the forward pass of the tensors through the network.
