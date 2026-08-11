import React, { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'

const tapSpring = { type: 'spring', duration: 0.15, bounce: 0 }

const formatTime = (secs) => {
  if (isNaN(secs) || secs === null) return '0:00'
  const minutes = Math.floor(secs / 60)
  const seconds = Math.floor(secs % 60)
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`
}

export default function IdleState({ onStart, onUpload }) {
  const [selectedFile, setSelectedFile] = useState(null)
  const [audioUrl, setAudioUrl] = useState(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  const fileInputRef = useRef(null)
  const audioRef = useRef(null)

  // Listen for spacebar to start speaking *only* when no file is uploaded
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === 'Space') {
        // If a file is selected, spacebar plays/pauses the audio instead of starting recording
        if (selectedFile) {
          e.preventDefault()
          handlePlayPause()
        } else {
          e.preventDefault()
          onStart()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onStart, selectedFile, isPlaying])

  const handleFileChange = (e) => {
    const file = e.target.files[0]
    if (file) {
      setSelectedFile(file)
      const url = URL.createObjectURL(file)
      setAudioUrl(url)
      setCurrentTime(0)
      setIsPlaying(false)
    }
  }

  const handleTriggerUpload = (e) => {
    e.stopPropagation()
    fileInputRef.current.click()
  }

  const handlePlayPause = (e) => {
    if (e) e.stopPropagation()
    if (!audioRef.current) return

    if (isPlaying) {
      audioRef.current.pause()
      setIsPlaying(false)
    } else {
      audioRef.current.play()
      setIsPlaying(true)
    }
  }

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

  const handleProceed = (e) => {
    e.stopPropagation()
    if (onUpload && selectedFile) {
      // Clean up URL object before transitioning
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl)
      }
      onUpload(selectedFile)
    }
  }

  const handleCancel = (e) => {
    e.stopPropagation()
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl)
    }
    setSelectedFile(null)
    setAudioUrl(null)
    setCurrentTime(0)
    setDuration(0)
    setIsPlaying(false)
  }

  // Render file player view
  if (selectedFile) {
    return (
      <div 
        className="idle-container"
        style={{
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 2rem'
        }}
      >
        <audio 
          ref={audioRef}
          src={audioUrl}
          onTimeUpdate={handleAudioTimeUpdate}
          onLoadedMetadata={handleAudioLoadedMetadata}
          onEnded={handleAudioEnded}
        />

        <div style={{
          width: '100%',
          maxWidth: '24rem',
          background: 'rgba(22, 21, 20, 0.4)',
          border: '1px solid var(--text-faded)',
          padding: '2rem 1.5rem',
          borderRadius: '4px',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.2rem'
        }}>
          {/* File Metadata */}
          <div style={{ textAlign: 'center' }}>
            <span style={{
              fontSize: '0.6rem',
              color: 'var(--text-muted)',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              display: 'block',
              marginBottom: '0.3rem'
            }}>
              Selected File
            </span>
            <span style={{
              fontSize: '0.85rem',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-secondary)',
              fontWeight: 500,
              wordBreak: 'break-all'
            }}>
              {selectedFile.name}
            </span>
          </div>

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
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid var(--text-faded)',
                color: 'var(--text-primary)',
                padding: '0.4rem 1.2rem',
                borderRadius: '3px',
                cursor: 'pointer',
                fontSize: '0.7rem',
                fontFamily: 'var(--font-secondary)',
                letterSpacing: '0.1em',
                textTransform: 'uppercase'
              }}
              onMouseEnter={(e) => e.target.style.background = 'rgba(255, 255, 255, 0.1)'}
              onMouseLeave={(e) => e.target.style.background = 'rgba(255, 255, 255, 0.05)'}
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

          <div style={{ height: '1px', backgroundColor: 'rgba(255, 255, 255, 0.05)', margin: '0.4rem 0' }} />

          {/* Action Row */}
          <div style={{
            display: 'flex',
            gap: '1rem',
            width: '100%'
          }}>
            <button
              onClick={handleCancel}
              style={{
                flex: 1,
                background: 'none',
                border: '1px solid rgba(255, 255, 255, 0.05)',
                color: 'var(--text-muted)',
                padding: '0.5rem',
                borderRadius: '3px',
                cursor: 'pointer',
                fontSize: '0.65rem',
                fontFamily: 'var(--font-secondary)',
                letterSpacing: '0.1em',
                textTransform: 'uppercase'
              }}
              onMouseEnter={(e) => {
                e.target.style.color = 'var(--text-primary)'
                e.target.style.borderColor = 'var(--text-muted)'
              }}
              onMouseLeave={(e) => {
                e.target.style.color = 'var(--text-muted)'
                e.target.style.borderColor = 'rgba(255, 255, 255, 0.05)'
              }}
            >
              Cancel
            </button>

            <button
              onClick={handleProceed}
              style={{
                flex: 1,
                background: 'none',
                border: '1px solid var(--accent)',
                color: 'var(--accent)',
                padding: '0.5rem',
                borderRadius: '3px',
                cursor: 'pointer',
                fontSize: '0.65rem',
                fontFamily: 'var(--font-secondary)',
                letterSpacing: '0.1em',
                textTransform: 'uppercase'
              }}
              onMouseEnter={(e) => {
                e.target.style.background = 'rgba(196, 149, 106, 0.1)'
                e.target.style.color = 'var(--text-primary)'
              }}
              onMouseLeave={(e) => {
                e.target.style.background = 'none'
                e.target.style.color = 'var(--accent)'
              }}
            >
              Analyze Audio
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Render normal options
  return (
    <div 
      className="idle-container" 
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <input 
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="audio/*"
        style={{ display: 'none' }}
      />

      {/* Main Speak Option */}
      <motion.div
        onClick={onStart}
        whileTap={{ scale: 0.98 }}
        transition={tapSpring}
        style={{
          cursor: 'pointer',
          textAlign: 'center',
          padding: '2rem'
        }}
      >
        <h1 style={{
          fontFamily: 'var(--font-secondary)',
          fontWeight: 500,
          fontSize: '1.05rem',
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
          transition: 'color var(--transition-base)',
          margin: 0
        }}
        onMouseEnter={(e) => e.target.style.color = 'var(--text-primary)'}
        onMouseLeave={(e) => e.target.style.color = 'var(--text-muted)'}
        >
          start speaking
        </h1>
        
        <p style={{
          fontFamily: 'var(--font-secondary)',
          fontSize: '0.8rem',
          letterSpacing: '0.1em',
          color: 'var(--text-faded)',
          marginTop: '0.8rem',
          transition: 'color var(--transition-base)'
        }}
        onMouseEnter={(e) => e.target.style.color = 'var(--text-muted)'}
        onMouseLeave={(e) => e.target.style.color = 'var(--text-faded)'}
        >
          click here or press space
        </p>
      </motion.div>

      {/* Upload Option Divider */}
      <div style={{
        height: '1px',
        width: '4rem',
        backgroundColor: 'var(--text-faded)',
        margin: '1.5rem 0'
      }} />

      {/* Upload Button */}
      <motion.button
        onClick={handleTriggerUpload}
        whileTap={{ scale: 0.97 }}
        transition={tapSpring}
        style={{
          background: 'none',
          border: 'none',
          fontSize: '0.65rem',
          color: 'var(--text-muted)',
          letterSpacing: '0.15em',
          textTransform: 'uppercase',
          cursor: 'pointer',
          padding: '0.5rem',
          fontFamily: 'var(--font-secondary)',
          transition: 'color var(--transition-base)'
        }}
        onMouseEnter={(e) => e.target.style.color = 'var(--text-primary)'}
        onMouseLeave={(e) => e.target.style.color = 'var(--text-muted)'}
      >
        upload audio file
      </motion.button>
    </div>
  )
}
