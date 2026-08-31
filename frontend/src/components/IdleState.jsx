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

      {onBack && (
        <button
          type="button"
          className="prosody-back-button"
          onClick={onBack}
          aria-label="Back to interface selection"
        >
          ← Back
        </button>
      )}

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
        onMouseEnter={(e) => e.target.style.color = 'var(--accent)'}
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
        onMouseEnter={(e) => e.target.style.color = 'var(--accent)'}
        onMouseLeave={(e) => e.target.style.color = 'var(--text-muted)'}
      >
        upload audio file
      </motion.button>
    </div>
  )
}
