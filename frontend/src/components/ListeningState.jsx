import React, { useEffect, useRef, useState, useCallback } from 'react'
import { AudioService } from '../services/audioService'

export default function ListeningState({ onStop }) {
  const [error, setError] = useState(null)
  const [isConnected, setIsConnected] = useState(false)
  const [previewText, setPreviewText] = useState('')
  const [words, setWords] = useState([])
  const canvasRef = useRef(null)
  const audioService = useRef(new AudioService())
  const audioCtxRef = useRef(null)
  const analyserRef = useRef(null)
  const animationFrameRef = useRef(null)
  // Use a ref for the stopping guard — refs are not affected by stale closures
  const isStoppingRef = useRef(false)

  const handleStop = useCallback(async () => {
    // Guard: if already stopping, do nothing. Uses a ref so it works
    // correctly even when called from a stale closure (keydown handler).
    if (isStoppingRef.current) return
    isStoppingRef.current = true

    try {
      const result = await audioService.current.stopRecording()
      onStop(result)
    } catch (err) {
      setError(err.message)
      isStoppingRef.current = false
    }
  }, [onStop])

  useEffect(() => {
    let mounted = true

    const start = async () => {
      try {
        const stream = await audioService.current.startRecording(
          (payload) => {
            if (!mounted || !payload) return
            if (payload.type === 'words' && payload.words) {
              const nowStr = new Date().toISOString().split('T')[1].slice(0, -1)
              console.log(`[${nowStr}] Received ${payload.words.length} words (replace: ${payload.replace_words})`)
              
              if (payload.replace_words) {
                setWords(payload.words)
                setPreviewText(payload.text || payload.words.map(w => w.word).join(' '))
              } else {
                setWords(prev => [...prev, ...payload.words])
                setPreviewText(prevText => prevText ? prevText + ' ' + payload.words.map(w => w.word).join(' ') : payload.words.map(w => w.word).join(' '))
              }
            } else if (payload.type === 'text') {
              setPreviewText(payload.text)
            } else if (typeof payload === 'string') {
              setPreviewText(payload)
            }
          },
          () => {
            if (mounted) setIsConnected(true)
          },
          (err) => {
            if (mounted) setError("Connection lost")
          }
        )

        if (!stream || !mounted) return

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

    return () => {
      mounted = false
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current)
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close()
      }
      audioService.current.cleanup()
    }
  }, [])

  // Separate effect for keydown so handleStop is always up-to-date
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === 'Space') {
        e.preventDefault()
        handleStop()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleStop])

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
        {!previewText && words.length === 0 ? (
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
            {words.length > 0 ? (
              words.map((w, index) => {
                const conf = w.confidence !== undefined ? w.confidence : 1
                const opacity = conf < 0.95 ? Math.max(0.5, 0.4 + conf * 0.6) : 1
                const blurVal = conf < 0.85 ? Math.min(1.4, (0.85 - conf) * 4) : 0
                const filter = blurVal > 0.05 ? `blur(${blurVal.toFixed(2)}px)` : 'none'

                const baseStyle = {
                  filter,
                  opacity,
                  display: 'inline-block',
                  marginRight: '0.25rem',
                  transition: 'filter 0.2s, opacity 0.2s'
                }

                const stressedStyle = w.stressed ? {
                  fontWeight: 600,
                  color: 'var(--accent)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  textShadow: '0 0 12px var(--accent-dim)'
                } : {}

                const renderPause = (pauseVal) => {
                  if (!pauseVal || pauseVal < 0.3) return null
                  let size = '3px'
                  let opacity = 0.3
                  if (pauseVal > 1.2) { size = '7px'; opacity = 0.8 }
                  else if (pauseVal > 0.6) { size = '5px'; opacity = 0.5 }
                  
                  return (
                    <span style={{
                      display: 'inline-block',
                      width: size,
                      height: size,
                      borderRadius: '50%',
                      backgroundColor: 'var(--accent)',
                      opacity: opacity,
                      marginLeft: '4px',
                      marginRight: '2px',
                      verticalAlign: 'middle',
                      transition: 'all 0.2s ease',
                      boxShadow: `0 0 8px var(--accent-dim)`
                    }} title={`Pause: ${pauseVal.toFixed(2)}s`} />
                  )
                }

                return (
                  <React.Fragment key={index}>
                    <span style={{ ...baseStyle, ...stressedStyle }}>
                      {w.word}
                    </span>
                    {renderPause(w.pause_after)}
                  </React.Fragment>
                )
              })
            ) : (
              previewText
            )}
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
