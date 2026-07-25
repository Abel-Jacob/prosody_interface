import React, { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { AudioService } from '../services/audioService'

export default function ListeningState({ onStop }) {
  const [error, setError] = useState(null)
  const [isConnected, setIsConnected] = useState(false)
  const [previewText, setPreviewText] = useState('')
  const canvasRef = useRef(null)
  const audioService = useRef(new AudioService())
  const audioCtxRef = useRef(null)
  const analyserRef = useRef(null)
  const animationFrameRef = useRef(null)

  useEffect(() => {
    let mounted = true

    const start = async () => {
      try {
        const stream = await audioService.current.startRecording(
          (text) => {
            if (mounted && text) {
              setPreviewText(text)
            }
          },
          () => {
            if (mounted) setIsConnected(true)
          },
          (err) => {
            if (mounted) setError("Connection lost")
          }
        )

        // Setup Web Audio API for visualizer
        const AudioContext = window.AudioContext || window.webkitAudioContext
        audioCtxRef.current = new AudioContext()
        analyserRef.current = audioCtxRef.current.createAnalyser()
        const source = audioCtxRef.current.createMediaStreamSource(stream)
        source.connect(analyserRef.current)
        analyserRef.current.fftSize = 256
        
        drawWaveform()
      } catch (err) {
        if (mounted) setError(err.message)
      }
    }

    start()

    const handleKeyDown = (e) => {
      if (e.code === 'Space') {
        e.preventDefault()
        handleStop()
      }
    }
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      mounted = false
      window.removeEventListener('keydown', handleKeyDown)
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current)
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close()
      }
      audioService.current.cleanup()
    }
  }, [])

  const handleStop = async () => {
    try {
      const jobId = await audioService.current.stopRecording()
      onStop(jobId)
    } catch (err) {
      setError(err.message)
    }
  }

  const drawWaveform = () => {
    if (!canvasRef.current || !analyserRef.current) return
    
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const width = canvas.width
    const height = canvas.height
    
    const bufferLength = analyserRef.current.frequencyBinCount
    const dataArray = new Uint8Array(bufferLength)
    
    const draw = () => {
      animationFrameRef.current = requestAnimationFrame(draw)
      
      analyserRef.current.getByteTimeDomainData(dataArray)
      
      ctx.clearRect(0, 0, width, height)
      
      // Draw faint background line
      ctx.lineWidth = 0.75
      ctx.strokeStyle = 'rgba(196, 149, 106, 0.3)'
      ctx.beginPath()
      ctx.moveTo(0, height / 2)
      for (let i = 0; i < width; i += 20) {
        ctx.lineTo(i, height / 2 + Math.sin(i * 0.05 + performance.now() * 0.002) * 5)
      }
      ctx.stroke()

      // Draw main amplitude-deformed line
      ctx.lineWidth = 1.5
      ctx.strokeStyle = 'rgba(196, 149, 106, 0.8)'
      ctx.beginPath()
      
      const sliceWidth = width * 1.0 / bufferLength
      let x = 0
      
      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0
        const y = v * height / 2
        
        if (i === 0) {
          ctx.moveTo(x, y)
        } else {
          ctx.lineTo(x, y)
        }
        
        x += sliceWidth
      }
      
      ctx.lineTo(canvas.width, canvas.height / 2)
      ctx.stroke()
    }
    
    draw()
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      
      {/* Overlays */}
      <div style={{
        position: 'fixed',
        top: '2rem',
        right: '2rem',
        backgroundColor: 'var(--overlay-bg)',
        border: '1px solid var(--overlay-border)',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
        padding: '0.4rem 0.6rem',
        borderRadius: '3px',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        zIndex: 10
      }}>
        <div style={{
          width: '5px',
          height: '5px',
          borderRadius: '50%',
          backgroundColor: error ? 'var(--error)' : (isConnected ? 'var(--accent)' : 'var(--text-faded)')
        }} />
        <span style={{
          fontSize: '0.6rem',
          letterSpacing: '0.15em',
          textTransform: 'uppercase',
          color: 'var(--text-faded)'
        }}>
          {error ? 'ERROR' : (isConnected ? 'LIVE' : 'CONNECTING')}
        </span>
      </div>

      <div style={{
        position: 'fixed',
        bottom: '2rem',
        left: '2rem',
        backgroundColor: 'var(--overlay-bg)',
        border: '1px solid var(--overlay-border)',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
        padding: '0.4rem 0.6rem',
        borderRadius: '3px',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.4rem',
        zIndex: 10
      }}>
        <span style={{
          fontSize: '0.6rem',
          letterSpacing: '0.15em',
          textTransform: 'uppercase',
          color: 'var(--text-faded)'
        }}>
          MIC: <span style={{ color: 'var(--text-muted)' }}>ACTIVE</span>
        </span>
        <span style={{
          fontSize: '0.6rem',
          letterSpacing: '0.15em',
          textTransform: 'uppercase',
          color: 'var(--text-faded)'
        }}>
          STREAM: <span style={{ color: 'var(--text-muted)' }}>{isConnected ? 'OK' : 'WAIT'}</span>
        </span>
      </div>

      {/* Main Content Area */}
      <div 
        onClick={handleStop}
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          padding: '0 2rem'
        }}
      >
        {!previewText ? (
          <>
            <h1 style={{
              fontFamily: 'var(--font-secondary)',
              fontWeight: 'bold',
              fontSize: '1.05rem',
              letterSpacing: '0.18em',
              textTransform: 'lowercase',
              color: 'var(--text-muted)',
              margin: 0
            }}>
              listening
            </h1>
            
            <p style={{
              fontFamily: 'var(--font-secondary)',
              fontSize: '0.8rem',
              letterSpacing: '0.1em',
              color: 'var(--text-faded)',
              marginTop: '0.8rem',
              textDecoration: 'underline'
            }}>
              click anywhere or press space to stop
            </p>
          </>
        ) : (
          <div style={{
            maxWidth: '48rem',
            width: '100%',
            maxHeight: '65vh',
            overflowY: 'auto',
            padding: '0 1rem',
            textAlign: 'center',
            fontSize: 'clamp(0.95rem, 1.6vw, 1.4rem)',
            lineHeight: 1.65,
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-primary)'
          }}>
            {previewText}
          </div>
        )}

        {error && (
          <p style={{ color: 'var(--error)', marginTop: '2rem' }}>{error}</p>
        )}
      </div>

      {/* Listening Line Canvas */}
      <div style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        width: '100%',
        height: '60px',
        pointerEvents: 'none'
      }}>
        <canvas 
          ref={canvasRef} 
          width={window.innerWidth} 
          height={60} 
          style={{ width: '100%', height: '100%' }} 
        />
      </div>
    </div>
  )
}
