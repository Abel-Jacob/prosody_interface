import React, { useRef, useState, useEffect } from 'react'

const formatTime = (secs) => {
  if (isNaN(secs) || secs === null) return '0:00'
  const minutes = Math.floor(secs / 60)
  const seconds = Math.floor(secs % 60)
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`
}

export default function AudioPlayer({ src, style }) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const audioRef = useRef(null)

  useEffect(() => {
    if (audioRef.current && src) {
      audioRef.current.load()
      setIsPlaying(false)
      setCurrentTime(0)
    }
  }, [src])

  const handlePlayPause = (e) => {
    if (e) e.stopPropagation()
    if (!audioRef.current) return

    if (audioRef.current.paused) {
      audioRef.current.play().catch(err => {
        console.error("Audio play failed:", err)
      })
      setIsPlaying(true)
    } else {
      audioRef.current.pause()
      setIsPlaying(false)
    }
  }

  // Listen for spacebar to play/pause when player is mounted
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === 'Space') {
        e.preventDefault()
        handlePlayPause()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleRewind = (e) => {
    if (e) e.stopPropagation()
    if (!audioRef.current) return
    audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 5)
    setCurrentTime(audioRef.current.currentTime)
  }

  const handleForward = (e) => {
    if (e) e.stopPropagation()
    if (!audioRef.current) return
    audioRef.current.currentTime = Math.min(duration, audioRef.current.currentTime + 5)
    setCurrentTime(audioRef.current.currentTime)
  }

  const handleScrub = (e) => {
    e.stopPropagation()
    if (!audioRef.current) return
    const val = parseFloat(e.target.value)
    audioRef.current.currentTime = val
    setCurrentTime(val)
  }

  const handleAudioTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime)
    }
  }

  const handleAudioLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration)
    }
  }

  const handleAudioEnded = () => {
    setIsPlaying(false)
    setCurrentTime(0)
  }

  return (
    <div style={{
      width: '100%',
      maxWidth: '24rem',
      background: 'var(--bg-subtle)',
      border: '1px solid var(--text-faded)',
      padding: '1.2rem 1.5rem',
      borderRadius: '10px',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.8rem',
      ...style
    }}>
      <audio 
        ref={audioRef}
        src={src}
        onTimeUpdate={handleAudioTimeUpdate}
        onLoadedMetadata={handleAudioLoadedMetadata}
        onEnded={handleAudioEnded}
      />

      {/* Time Labels */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: '0.7rem',
        color: 'var(--text-muted)',
        fontFamily: 'monospace'
      }}>
        <span>{formatTime(currentTime)}</span>
        <span>{formatTime(duration)}</span>
      </div>

      {/* Scrubber Progress Bar */}
      <div style={{ width: '100%' }}>
        <input 
          type="range"
          min={0}
          max={duration || 0}
          step="0.05"
          value={currentTime}
          onChange={handleScrub}
          onClick={(e) => e.stopPropagation()}
          style={{
            width: '100%',
            accentColor: 'var(--accent)',
            cursor: 'pointer',
            background: 'var(--text-faded)',
            height: '4px',
            borderRadius: '2px',
            border: 'none',
            outline: 'none'
          }}
        />
      </div>

      {/* Playback Controls Row */}
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        gap: '2rem'
      }}>
        <button
          onClick={handleRewind}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: '0.75rem',
            fontFamily: 'var(--font-secondary)'
          }}
          onMouseEnter={(e) => e.target.style.color = 'var(--text-primary)'}
          onMouseLeave={(e) => e.target.style.color = 'var(--text-muted)'}
        >
          -5s
        </button>

        <button
          onClick={handlePlayPause}
          style={{
            background: 'var(--bg-subtle)',
            border: '1px solid var(--text-faded)',
            color: 'var(--text-primary)',
            padding: '0.4rem 1.2rem',
            borderRadius: '8px',
            cursor: 'pointer',
            fontSize: '0.7rem',
            fontFamily: 'var(--font-secondary)',
            letterSpacing: '0.1em',
            textTransform: 'uppercase'
          }}
          onMouseEnter={(e) => e.target.style.background = 'var(--text-faded)'}
          onMouseLeave={(e) => e.target.style.background = 'var(--bg-subtle)'}
        >
          {isPlaying ? 'pause' : 'play'}
        </button>

        <button
          onClick={handleForward}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: '0.75rem',
            fontFamily: 'var(--font-secondary)'
          }}
          onMouseEnter={(e) => e.target.style.color = 'var(--text-primary)'}
          onMouseLeave={(e) => e.target.style.color = 'var(--text-muted)'}
        >
          +5s
        </button>
      </div>
    </div>
  )
}
