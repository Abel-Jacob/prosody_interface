import { getWsUrl } from '../apiConfig'

export class AudioService {
  constructor() {
    this.stream = null
    this.mediaRecorder = null
    this.socket = null
    this.audioChunks = []
    this.isStarting = false
  }

  async startRecording(onPreviewText, onSocketConnected, onSocketError) {
    if (this.isStarting || this.mediaRecorder) {
      console.warn("Recording already starting or active, cleaning up first")
      this.cleanup()
    }
    
    this.isStarting = true
    const currentSessionId = Date.now() + Math.random();
    this.recordingSessionId = currentSessionId;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      
      if (!this.isStarting || this.recordingSessionId !== currentSessionId) {
        // Was cancelled while awaiting getUserMedia, or a new session started
        this.stream.getTracks().forEach(t => t.stop())
        return null
      }
      
      const wsUrl = getWsUrl('/api/ws/audio')
      this.socket = new WebSocket(wsUrl)
      
      this.socket.onopen = () => {
        if (onSocketConnected) onSocketConnected()
        this.mediaRecorder = new MediaRecorder(this.stream, { mimeType: 'audio/webm' })
        
        this.mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0 && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(event.data)
          }
        }
        
        // Emit chunks every 1 second
        this.mediaRecorder.start(1000)
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
      
      return this.stream
    } catch (err) {
      console.error("Error accessing microphone:", err)
      this.isStarting = false
      throw err
    }
  }

  stopRecording() {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
        return reject(new Error('Cannot stop recording: Connection to backend server was not established. Check your Ngrok URL in apiConfig.js or visit your Ngrok URL in a browser first.'))
      }
      
      const handleMessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === 'job_created' || msg.type === 'job_completed') {
            this.cleanup()
            resolve({ jobId: msg.job_id, result: msg.result })
          } else if (msg.type === 'error') {
            this.cleanup()
            reject(new Error(msg.message))
          }
        } catch (e) {
          // ignore parsing errors for non-json
        }
      }
      
      this.socket.addEventListener('message', handleMessage)
      
      // Stop the recorder, which triggers the final dataavailable event
      this.mediaRecorder.stop()
      
      // Request stop from server after a short delay to ensure final chunk is sent
      setTimeout(() => {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
          this.socket.send(JSON.stringify({ type: 'stop' }))
        }
      }, 200)
    })
  }

  cleanup() {
    this.isStarting = false
    this.recordingSessionId = null
    
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try { this.mediaRecorder.stop() } catch(e) {}
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
