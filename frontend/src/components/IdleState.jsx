import React, { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import AudioPlayer from './AudioPlayer'

const tapSpring = { type: 'spring', duration: 0.15, bounce: 0 }

export default function IdleState({ onStart, onUpload, onBack }) {
  const [selectedFile, setSelectedFile] = useState(null)
  const [audioUrl, setAudioUrl] = useState(null)

  const fileInputRef = useRef(null)

  // Listen for spacebar to start speaking *only* when no file is uploaded
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === 'Space') {
        if (!selectedFile) {
          e.preventDefault()
          onStart()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onStart, selectedFile])

  const handleFileChange = (e) => {
    const file = e.target.files[0]
    if (file) {
      setSelectedFile(file)
      const url = URL.createObjectURL(file)
      setAudioUrl(url)
    }
  }

  const handleTriggerUpload = (e) => {
    e.stopPropagation()
    fileInputRef.current.click()
  }

  const handleProceed = (e) => {
    e.stopPropagation()
    if (onUpload && selectedFile) {
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
        <div style={{
          width: '100%',
          maxWidth: '24rem',
          background: 'var(--bg-subtle)',
          border: '1px solid var(--text-faded)',
          padding: '2rem 1.5rem',
          borderRadius: '12px',
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

          <AudioPlayer src={audioUrl} style={{ border: 'none', background: 'none', padding: 0, maxWidth: '100%' }} />

          <div style={{ height: '1px', backgroundColor: 'var(--text-faded)', margin: '0.4rem 0' }} />

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
                border: '1px solid var(--text-faded)',
                color: 'var(--text-muted)',
                padding: '0.5rem',
                borderRadius: '8px',
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
                e.target.style.borderColor = 'var(--text-faded)'
              }}
            >
              Cancel
            </button>

            <button
              onClick={handleProceed}
              style={{
                flex: 1,
                background: 'var(--accent)',
                border: '1px solid var(--accent)',
                color: 'var(--bg)',
                padding: '0.5rem',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '0.65rem',
                fontFamily: 'var(--font-secondary)',
                letterSpacing: '0.1em',
                textTransform: 'uppercase'
              }}
              onMouseEnter={(e) => {
                e.target.style.opacity = '0.85'
              }}
              onMouseLeave={(e) => {
                e.target.style.opacity = '1'
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
      className="prosody-page"
    >
      <input 
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="audio/*"
        style={{ display: 'none' }}
      />

      {/* Header */}
      <header className="prosody-header">
        <div className="prosody-header-brand">
          <span className="prosody-header-label">PROSODY</span>
          <span className="prosody-header-slash">/</span>
          <span className="prosody-header-label">ANALYSIS</span>
        </div>
        
        {onBack && (
          <motion.button
            type="button"
            className="prosody-header-back"
            onClick={onBack}
            aria-label="Back to interface selection"
            whileTap={{ scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12,19 5,12 12,5" />
            </svg>
            back
          </motion.button>
        )}
      </header>

      {/* Main Recording Area */}
      <main className="prosody-main">
        <motion.div
          className="prosody-center"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        >
          {/* Session Context */}
          <div className="prosody-context">
            <span className="prosody-context-label">SESSION</span>
            <span className="prosody-context-value">MICROPHONE</span>
          </div>

          {/* Idle Waveform Baseline */}
          <div className="prosody-waveform-container">
            <svg className="prosody-idle-waveform" viewBox="0 0 200 40" preserveAspectRatio="none">
              <line x1="0" y1="20" x2="200" y2="20" stroke="var(--text-faded)" strokeWidth="0.5" opacity="0.4" />
              <polyline points="0,20 10,18 20,22 30,19 40,21 50,20 60,19 70,21 80,20 90,22 100,18 110,22 120,19 130,21 140,20 150,22 160,19 170,21 180,20 190,22 200,20" 
                fill="none" stroke="var(--text-faded)" strokeWidth="1" opacity="0.25" vectorEffect="non-scaling-stroke" />
            </svg>
          </div>

          {/* Primary Action */}
          <motion.button
            onClick={onStart}
            className="prosody-action-primary"
            whileTap={{ scale: 0.96 }}
            transition={tapSpring}
          >
            <span className="prosody-action-text">START SPEAKING</span>
          </motion.button>

          {/* Supporting Text */}
          <p className="prosody-action-hint">
            click here or press <kbd>space</kbd>
          </p>

          {/* Divider */}
          <div className="prosody-divider" />

          {/* Upload Alternative */}
          <div className="prosody-upload-group">
            <span className="prosody-upload-label">OR</span>
            
            <motion.button
              onClick={handleTriggerUpload}
              className="prosody-action-secondary"
              whileTap={{ scale: 0.97 }}
              transition={tapSpring}
            >
              UPLOAD AUDIO FILE
            </motion.button>

            <p className="prosody-upload-hint">
              Choose an existing recording
            </p>
          </div>
        </motion.div>
      </main>
    </div>
  )
}
