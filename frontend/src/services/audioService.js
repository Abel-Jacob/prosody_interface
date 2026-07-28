import { getWsUrl } from '../apiConfig'

export class AudioService {
  constructor() {
    this.stream = null
    this.mediaRecorder = null
    this.socket = null
    this.isStarting = false
    this.isStopping = false
  }

  async startRecording(onPreviewText, onSocketConnected, onSocketError) {
    if (this.isStarting || this.mediaRecorder) {
      console.warn("Recording already starting or active, cleaning up first")
      this.cleanup()
    }

    this.isStarting = true
    this.isStopping = false

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true })

      if (!this.isStarting) {
        this.stream.getTracks().forEach(t => t.stop())
        return null
      }

      this.pendingChunks = []

      this.mediaRecorder = new MediaRecorder(this.stream, { mimeType: 'audio/webm' })

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(event.data)
          } else if (this.socket && this.socket.readyState === WebSocket.CONNECTING) {
            this.pendingChunks.push(event.data)
          }
        }
      }

      this.mediaRecorder.start(1000)

      const wsUrl = getWsUrl('/api/ws/audio')
      console.log('[AudioService] Connecting WebSocket:', wsUrl)
      this.socket = new WebSocket(wsUrl)

      this.socket.onopen = () => {
        console.log('[AudioService] WebSocket connected')
        if (onSocketConnected) onSocketConnected()
        
        // Send any chunks that were recorded while connecting
        while (this.pendingChunks.length > 0) {
          this.socket.send(this.pendingChunks.shift())
        }
      }

      this.socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === 'incremental_words' && onPreviewText) {
            onPreviewText({ type: 'words', words: msg.words, replace_words: msg.replace_words, text: msg.text })
          } else if (msg.type === 'preview_text' && onPreviewText) {
            onPreviewText({ type: 'text', text: msg.text })
          }
        } catch (e) {
          console.error("Failed to parse socket message", e)
        }
      }

      this.socket.onerror = (error) => {
        console.error("WebSocket error:", error)
        if (onSocketError) onSocketError(error)
      }

      this.socket.onclose = () => {
        console.log('[AudioService] WebSocket closed')
      }

      return this.stream
    } catch (err) {
      console.error("Error accessing microphone:", err)
      this.isStarting = false
      throw err
    }
  }

  /**
   * Stop recording. Returns a promise that resolves with { jobId, result }.
   * 
   * Guards:
   * - If already stopping, returns a never-resolving promise (safe no-op).
   * - If mediaRecorder isn't ready yet (WebSocket still connecting), 
   *   cleans up gracefully instead of showing a scary error.
   */
  stopRecording() {
    if (this.isStopping) {
      console.warn('[AudioService] stopRecording() called while already stopping — ignoring')
      return new Promise(() => {})
    }
    this.isStopping = true

    // If the socket completely failed or we have no stream, reject
    if (!this.stream) {
      console.warn('[AudioService] No stream available at stop time')
      this.cleanup()
      return Promise.reject(new Error('Microphone was not active.'))
    }

    return new Promise((resolve, reject) => {
      // Timeout: if we don't get a response in 15 seconds, reject
      const timeout = setTimeout(() => {
        console.error('[AudioService] Stop timed out waiting for server response')
        this.cleanup()
        reject(new Error('Server did not respond in time. Please try again.'))
      }, 15000)

      const handleMessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === 'job_created' || msg.type === 'job_completed') {
            clearTimeout(timeout)
            this.socket.removeEventListener('close', handleClose)
            this.cleanup()
            resolve({ jobId: msg.job_id, result: msg.result })
          } else if (msg.type === 'error') {
            clearTimeout(timeout)
            this.socket.removeEventListener('close', handleClose)
            this.cleanup()
            reject(new Error(msg.message))
          }
        } catch (e) {
          // ignore parsing errors for non-json
        }
      }

      const handleClose = () => {
        clearTimeout(timeout)
        this.cleanup()
        reject(new Error('WebSocket connection lost before server could respond.'))
      }

      this.socket.addEventListener('message', handleMessage)
      this.socket.addEventListener('close', handleClose)

      // Stop the recorder, which triggers the final dataavailable event
      try {
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
          this.mediaRecorder.stop()
        }
      } catch (e) {
        console.error("Error stopping media recorder", e)
      }

      // Request stop from server after a short delay to ensure final chunk is sent.
      // If the socket is still connecting, we must wait for it to open first.
      const sendStop = () => {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
          this.socket.send(JSON.stringify({ type: 'stop' }))
        } else if (this.socket && this.socket.readyState === WebSocket.CONNECTING) {
          // Wait a bit and try again
          setTimeout(sendStop, 100)
        } else {
          clearTimeout(timeout)
          this.cleanup()
          reject(new Error('WebSocket closed before stop signal could be sent.'))
        }
      }

      setTimeout(sendStop, 200)
    })
  }

  cleanup() {
    this.isStarting = false
    this.isStopping = false

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try { this.mediaRecorder.stop() } catch (e) {}
    }

    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop())
      this.stream = null
    }
    if (this.socket) {
      this.socket.close()
      this.socket = null
    }
    this.mediaRecorder = null
  }
}
