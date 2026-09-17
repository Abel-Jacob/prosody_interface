import React, { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import AudioPlayer from './AudioPlayer'

const tapSpring = { type: 'spring', duration: 0.15, bounce: 0 }

export default function IdleState({ onStart, onUpload, onBack }) {
  const [selectedFile, setSelectedFile] = useState(null)
  const [selectedFiles, setSelectedFiles] = useState(null)
  const [isBatch, setIsBatch] = useState(false)
  const [audioUrl, setAudioUrl] = useState(null)

  const fileInputRef = useRef(null)

  // Listen for spacebar to start speaking *only* when no file is uploaded
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === 'Space') {
        if (!selectedFile && !selectedFiles) {
          e.preventDefault()
          onStart()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onStart, selectedFile, selectedFiles])

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files || [])
    if (!files.length) return

    const isZip = files.length === 1 && files[0].name.toLowerCase().endsWith('.zip')
    if (files.length > 1 || isZip) {
      setIsBatch(true)
      setSelectedFiles(files)
      setSelectedFile(null)
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl)
        setAudioUrl(null)
      }
    } else {
      setIsBatch(false)
      setSelectedFiles(null)
      setSelectedFile(files[0])
      const url = URL.createObjectURL(files[0])
      setAudioUrl(url)
    }
  }

  const handleTriggerUpload = (e) => {
    e.stopPropagation()
    fileInputRef.current.click()
  }

  const handleProceed = (e) => {
    e.stopPropagation()
    if (onUpload) {
      if (isBatch && selectedFiles && selectedFiles.length > 0) {
        onUpload(selectedFiles)
      } else if (selectedFile) {
        if (audioUrl) {
          URL.revokeObjectURL(audioUrl)
        }
        onUpload(selectedFile)
      }
    }
  }

  const handleCancel = (e) => {
    e.stopPropagation()
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl)
    }
    setSelectedFile(null)
    setSelectedFiles(null)
    setIsBatch(false)
    setAudioUrl(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  // Render batch selection card
  if (isBatch && selectedFiles && selectedFiles.length > 0) {
    const isZip = selectedFiles.length === 1 && selectedFiles[0].name.toLowerCase().endsWith('.zip')
    const totalBytes = selectedFiles.reduce((acc, f) => acc + (f.size || 0), 0)
    const formattedSize = totalBytes > 1024 * 1024
      ? `${(totalBytes / (1024 * 1024)).toFixed(1)} MB`
      : `${(totalBytes / 1024).toFixed(0)} KB`

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
          maxWidth: '28rem',
          background: 'var(--bg-subtle)',
          border: '1px solid var(--text-faded)',
          padding: '2rem 1.6rem',
          borderRadius: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.2rem',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.36)'
        }}>
          <div style={{ textAlign: 'center' }}>
            <span style={{
              fontSize: '0.65rem',
              color: 'var(--accent)',
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              fontWeight: 600,
              display: 'block',
              marginBottom: '0.35rem'
            }}>
              {isZip ? 'ZIP Archive Detected' : 'Batch Audio Selection'}
            </span>
            <span style={{
              fontSize: '1rem',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-secondary)',
              fontWeight: 500,
              wordBreak: 'break-all'
            }}>
              {isZip ? selectedFiles[0].name : `${selectedFiles.length} Audio Files Selected`}
            </span>
            <div style={{
              fontSize: '0.75rem',
              color: 'var(--text-muted)',
              marginTop: '0.3rem',
              fontFamily: 'var(--font-secondary)'
            }}>
              {isZip ? `Archive Size: ${formattedSize}` : `Total Size: ${formattedSize} • Ready for batch analysis`}
            </div>
          </div>

          {/* Preview list of files */}
          <div style={{
            background: 'rgba(0, 0, 0, 0.25)',
            border: '1px solid rgba(255, 255, 255, 0.05)',
            borderRadius: '8px',
            padding: '0.75rem 1rem',
            maxHeight: '130px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.35rem',
            fontSize: '0.75rem',
            color: 'var(--text-muted)'
          }}>
            {selectedFiles.slice(0, 5).map((f, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '75%', color: 'var(--text-primary)' }}>
                  🎵 {f.name}
                </span>
                <span style={{ fontSize: '0.68rem', color: 'var(--text-faded)' }}>
                  {(f.size / 1024).toFixed(0)} KB
                </span>
              </div>
            ))}
            {selectedFiles.length > 5 && (
              <div style={{ fontSize: '0.7rem', color: 'var(--accent)', marginTop: '0.2rem', textAlign: 'center' }}>
                + {selectedFiles.length - 5} more files in batch
              </div>
            )}
          </div>

          <div style={{ height: '1px', backgroundColor: 'var(--text-faded)', margin: '0.2rem 0' }} />

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
                padding: '0.6rem',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '0.7rem',
                fontFamily: 'var(--font-secondary)',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                transition: 'all 0.2s'
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
                flex: 1.5,
                background: 'var(--accent)',
                border: '1px solid var(--accent)',
                color: 'var(--bg)',
                padding: '0.6rem',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '0.7rem',
                fontWeight: 600,
                fontFamily: 'var(--font-secondary)',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                transition: 'all 0.2s'
              }}
              onMouseEnter={(e) => {
                e.target.style.opacity = '0.85'
              }}
              onMouseLeave={(e) => {
                e.target.style.opacity = '1'
              }}
            >
              {isZip ? 'Extract & Process ZIP' : `Process ${selectedFiles.length} Files`}
            </button>
          </div>
        </div>
      </div>
    )
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
        accept="audio/*,.zip,.webm,.wav,.mp3,.ogg,.flac,.m4a"
        multiple
        style={{ display: 'none' }}
      />

      <div className="page-path" aria-label="Current page">PROSODY / INTERFACE</div>

      {onBack && (
        <motion.button
          type="button"
          className="page-back"
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
        upload audio file(s) or zip archive
      </motion.button>
    </div>
  )
}
