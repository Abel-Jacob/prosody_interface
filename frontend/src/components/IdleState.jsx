import React, { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import AudioPlayer from './AudioPlayer'

const tapSpring = { type: 'spring', duration: 0.15, bounce: 0 }

export default function IdleState({ onStart, onUpload, onBack }) {
  const [selectedFile, setSelectedFile] = useState(null)
  const [selectedFiles, setSelectedFiles] = useState(null)
  const [isBatch, setIsBatch] = useState(false)
  const [audioUrl, setAudioUrl] = useState(null)
  const [uploadError, setUploadError] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const fileInputRef = useRef(null)

  // Listen for spacebar to start speaking *only* when no file is uploaded and not typing in an input/button
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (['INPUT', 'TEXTAREA', 'BUTTON'].includes(e.target?.tagName) || e.target?.isContentEditable) return
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
    setUploadError(null)

    const validExtensions = ['.wav', '.mp3', '.ogg', '.webm', '.flac', '.m4a', '.zip']
    const hasEmptyFile = files.some(f => (f.size || 0) === 0)
    if (hasEmptyFile) {
      setUploadError("One or more selected files are empty (0 bytes).")
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }

    const hasInvalidExt = files.some(f => {
      const name = f.name.toLowerCase()
      return !validExtensions.some(ext => name.endsWith(ext)) && !f.type.startsWith('audio/')
    })
    if (hasInvalidExt) {
      setUploadError("Please select valid audio files (.wav, .mp3, .ogg, .webm, .flac, .m4a) or a .zip archive.")
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }

    if (audioUrl) {
      URL.revokeObjectURL(audioUrl)
      setAudioUrl(null)
    }

    const isZip = files.length === 1 && files[0].name.toLowerCase().endsWith('.zip')
    if (files.length > 1 || isZip) {
      setIsBatch(true)
      setSelectedFiles(files)
      setSelectedFile(null)
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
    setUploadError(null)
    fileInputRef.current?.click()
  }

  const handleProceed = (e) => {
    e.stopPropagation()
    if (isSubmitting) return
    if (onUpload) {
      setIsSubmitting(true)
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
    setUploadError(null)
    setIsSubmitting(false)
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
        <div className="batch-modal-card">
          <div className="batch-modal-header">
            <span className="batch-modal-kicker">
              {isZip ? 'ZIP Archive Detected' : 'Batch Audio Selection'}
            </span>
            <span className="batch-modal-title">
              {isZip ? selectedFiles[0].name : `${selectedFiles.length} Audio Files Selected`}
            </span>
            <div className="batch-modal-subtitle">
              {isZip ? `Archive Size: ${formattedSize}` : `Total Size: ${formattedSize} • Ready for batch analysis`}
            </div>
          </div>

          {/* Preview list of files */}
          <div className="batch-modal-file-list">
            {selectedFiles.slice(0, 5).map((f, i) => (
              <div key={i} className="batch-modal-file-row">
                <div className="batch-modal-file-info">
                  <svg className="batch-modal-file-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M9 18V5l12-2v13" />
                    <circle cx="6" cy="18" r="3" />
                    <circle cx="18" cy="16" r="3" />
                  </svg>
                  <span className="batch-modal-file-name">
                    {f.name}
                  </span>
                </div>
                <span className="batch-modal-file-size">
                  {(f.size / 1024).toFixed(0)} KB
                </span>
              </div>
            ))}
            {selectedFiles.length > 5 && (
              <div className="batch-modal-more-badge">
                + {selectedFiles.length - 5} more files in batch
              </div>
            )}
          </div>

          <div style={{ height: '1px', backgroundColor: 'rgba(255, 255, 255, 0.07)', margin: '0.1rem 0' }} />

          {/* Action Row */}
          <div className="batch-modal-actions">
            <button
              type="button"
              onClick={handleCancel}
              className="batch-modal-cancel-btn"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={handleProceed}
              disabled={isSubmitting}
              className="batch-modal-process-btn"
            >
              {isSubmitting ? 'Uploading...' : (isZip ? 'Extract & Process ZIP' : `Process ${selectedFiles.length} Files`)}
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
              disabled={isSubmitting}
              style={{
                flex: 1,
                background: isSubmitting ? 'var(--text-faded)' : 'var(--accent)',
                border: '1px solid var(--accent)',
                color: 'var(--bg)',
                padding: '0.5rem',
                borderRadius: '8px',
                cursor: isSubmitting ? 'not-allowed' : 'pointer',
                fontSize: '0.65rem',
                fontFamily: 'var(--font-secondary)',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                opacity: isSubmitting ? 0.7 : 1
              }}
              onMouseEnter={(e) => {
                if (!isSubmitting) e.target.style.opacity = '0.85'
              }}
              onMouseLeave={(e) => {
                if (!isSubmitting) e.target.style.opacity = '1'
              }}
            >
              {isSubmitting ? 'Uploading...' : 'Analyze Audio'}
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

      {uploadError && (
        <div style={{
          marginTop: '1rem',
          color: 'var(--error, #f87171)',
          fontSize: '0.75rem',
          textAlign: 'center',
          maxWidth: '24rem',
          lineHeight: 1.4
        }}>
          {uploadError}
        </div>
      )}
    </div>
  )
}
