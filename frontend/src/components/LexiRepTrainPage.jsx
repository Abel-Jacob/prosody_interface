import React, { useState, useRef, useCallback, useEffect } from 'react'
import { motion } from 'framer-motion'
import { getHttpUrl } from '../apiConfig'
import './LexiRepTrainPage.css'

const tapSpring = { type: 'spring', duration: 0.15, bounce: 0 }

/**
 * Parse a CSV string's first data row to count columns.
 * Returns { valid, ncols, message }.
 */
function validateCsvText(text) {
  const lines = text.trim().split('\n').filter(l => l.trim())
  if (lines.length === 0) return { valid: false, ncols: 0, message: 'File is empty' }

  // Try to detect header: if first row has non-numeric values
  let dataRow = lines[0]
  const firstFields = dataRow.split(',')
  const isHeader = firstFields.some(f => isNaN(parseFloat(f.trim())))
  if (isHeader) {
    if (lines.length < 2) return { valid: false, ncols: 0, message: 'Only a header row, no data' }
    dataRow = lines[1]
  }

  const ncols = dataRow.split(',').length
  if (ncols < 768) {
    return {
      valid: false, ncols,
      message: `Expected at least 768 columns, found ${ncols}`
    }
  }
  return {
    valid: true, ncols,
    message: `${isHeader ? 'Header + ' : ''}${lines.length - (isHeader ? 1 : 0)} rows × ${ncols} columns`
  }
}

/**
 * Parse NPY header to read shape. Returns { valid, shape, message }.
 * NPY v1 format: 6-byte magic, 2-byte version, 2-byte header_len, then ASCII header dict.
 */
function validateNpyBuffer(buffer) {
  try {
    const view = new DataView(buffer)
    // Check magic: \x93NUMPY
    const magic = String.fromCharCode(
      view.getUint8(0), view.getUint8(1), view.getUint8(2),
      view.getUint8(3), view.getUint8(4), view.getUint8(5)
    )
    if (magic !== '\x93NUMPY') {
      return { valid: false, shape: null, message: 'Not a valid NPY file (bad magic number)' }
    }

    const majorVersion = view.getUint8(6)
    let headerLen, headerOffset
    if (majorVersion === 1) {
      headerLen = view.getUint16(8, true) // little-endian
      headerOffset = 10
    } else if (majorVersion === 2) {
      headerLen = view.getUint32(8, true)
      headerOffset = 12
    } else {
      return { valid: false, shape: null, message: `Unsupported NPY version ${majorVersion}` }
    }

    const headerBytes = new Uint8Array(buffer, headerOffset, headerLen)
    const header = new TextDecoder().decode(headerBytes)

    // Parse shape from the header dict string, e.g. "'shape': (100, 768),"
    const shapeMatch = header.match(/'shape'\s*:\s*\(([^)]+)\)/)
    if (!shapeMatch) {
      return { valid: false, shape: null, message: 'Could not parse shape from NPY header' }
    }

    const dims = shapeMatch[1].split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))
    if (dims.length !== 2) {
      return { valid: false, shape: dims, message: `Expected 2D array, got ${dims.length}D (shape: ${dims.join('×')})` }
    }
    if (dims[1] < 768) {
      return { valid: false, shape: dims, message: `Expected at least 768 columns, found ${dims[1]} (shape: ${dims.join('×')})` }
    }
    return { valid: true, shape: dims, message: `${dims[0]} samples × ${dims[1]} dimensions` }
  } catch (e) {
    return { valid: false, shape: null, message: `Failed to parse NPY file: ${e.message}` }
  }
}


export default function LexiRepTrainPage({ onBack }) {
  // States: 'idle' | 'uploading' | 'training' | 'complete' | 'failed'
  const [pageState, setPageState] = useState('idle')
  const [selectedFile, setSelectedFile] = useState(null)
  const [validation, setValidation] = useState(null) // { valid, message }
  const [dragOver, setDragOver] = useState(false)
  const [jobId, setJobId] = useState(null)
  const [error, setError] = useState(null)
  const [outputFiles, setOutputFiles] = useState([])
  const fileInputRef = useRef(null)
  const pollRef = useRef(null)

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  // ── File validation ───────────────────────────────────────
  const validateFile = useCallback(async (file) => {
    const ext = file.name.split('.').pop().toLowerCase()

    if (ext === 'csv') {
      const text = await file.text()
      return validateCsvText(text)
    } else if (ext === 'npy') {
      const buffer = await file.arrayBuffer()
      return validateNpyBuffer(buffer)
    } else {
      return { valid: false, message: `Unsupported file type .${ext}. Use .csv or .npy` }
    }
  }, [])

  const handleFileSelect = useCallback(async (file) => {
    setSelectedFile(file)
    setValidation(null)
    setError(null)

    const result = await validateFile(file)
    setValidation(result)
  }, [validateFile])

  // ── Drag and drop handlers ────────────────────────────────
  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
  }, [])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    const file = e.dataTransfer?.files?.[0]
    if (file) handleFileSelect(file)
  }, [handleFileSelect])

  const handleInputChange = useCallback((e) => {
    const file = e.target.files?.[0]
    if (file) handleFileSelect(file)
  }, [handleFileSelect])

  // ── Submit training job ───────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (!selectedFile || !validation?.valid) return

    setPageState('uploading')
    setError(null)

    try {
      const formData = new FormData()
      formData.append('dataset', selectedFile)

      const response = await fetch(getHttpUrl('/lexirep/train-custom'), {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.detail || `Upload failed (${response.status})`)
      }

      const data = await response.json()
      setJobId(data.job_id)
      setPageState('training')

      // Start polling for status
      pollRef.current = setInterval(async () => {
        try {
          const statusRes = await fetch(getHttpUrl(`/lexirep/train-status/${data.job_id}`))
          if (!statusRes.ok) return
          const statusData = await statusRes.json()

          if (statusData.status === 'complete') {
            clearInterval(pollRef.current)
            pollRef.current = null
            setOutputFiles(statusData.output_files || [])
            setPageState('complete')
          } else if (statusData.status === 'failed') {
            clearInterval(pollRef.current)
            pollRef.current = null
            setError(statusData.error || 'Training failed')
            setPageState('failed')
          }
        } catch {
          // Polling error — keep trying
        }
      }, 2000)

    } catch (err) {
      setError(err.message)
      setPageState('failed')
    }
  }, [selectedFile, validation])

  // ── Reset ─────────────────────────────────────────────────
  const handleReset = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    setPageState('idle')
    setSelectedFile(null)
    setValidation(null)
    setJobId(null)
    setError(null)
    setOutputFiles([])
  }, [])

  // ── Format file size ──────────────────────────────────────
  const formatSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  // ══════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════

  return (
    <div className="lexirep-container">
      {/* ── Back button ──────────────────────────────────── */}
      <motion.button
        className="lexirep-back"
        onClick={onBack}
        whileTap={{ scale: 0.95 }}
        transition={tapSpring}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="19" y1="12" x2="5" y2="12" />
          <polyline points="12,19 5,12 12,5" />
        </svg>
        back
      </motion.button>

      {/* ── Header ───────────────────────────────────────── */}
      <div className="lexirep-header">
        <h1>lexirep training</h1>
        <p>
          Upload a 768-dimensional dataset to train a custom
          LexiRep model. Accepts .csv or .npy files.
        </p>
      </div>

      {/* ── Content area ─────────────────────────────────── */}
      <div className="lexirep-content">

        {/* ── IDLE: Upload zone ──────────────────────────── */}
        {pageState === 'idle' && !selectedFile && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleInputChange}
              accept=".csv,.npy"
              style={{ display: 'none' }}
            />
            <div
              className={`lexirep-dropzone${dragOver ? ' drag-over' : ''}`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <div className="lexirep-dropzone-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
                  strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17,8 12,3 7,8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </div>
              <div className="lexirep-dropzone-text">
                drop file here or click to browse
              </div>
              <div className="lexirep-dropzone-hint">
                .csv or .npy — 768-dimensional feature vectors
              </div>
            </div>
          </motion.div>
        )}

        {/* ── IDLE: File selected, show preview ──────────── */}
        {pageState === 'idle' && selectedFile && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
          >
            <div className="lexirep-file-preview">
              <div className="lexirep-file-info">
                <span className="lexirep-file-label">Selected Dataset</span>
                <span className="lexirep-file-name">{selectedFile.name}</span>
                <span className="lexirep-file-meta">{formatSize(selectedFile.size)}</span>
              </div>

              {validation && (
                <div className={`lexirep-validation-msg${validation.valid ? '' : ' error'}`}>
                  {validation.valid ? '✓ ' : '✕ '}{validation.message}
                </div>
              )}

              <div style={{
                height: '1px',
                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                margin: '0.2rem 0'
              }} />

              <div className="lexirep-actions">
                <motion.button
                  className="lexirep-btn"
                  onClick={handleReset}
                  whileTap={{ scale: 0.97 }}
                  transition={tapSpring}
                >
                  Cancel
                </motion.button>
                <motion.button
                  className="lexirep-btn primary"
                  onClick={handleSubmit}
                  disabled={!validation?.valid}
                  whileTap={validation?.valid ? { scale: 0.97 } : {}}
                  transition={tapSpring}
                >
                  Start Training
                </motion.button>
              </div>
            </div>
          </motion.div>
        )}

        {/* ── UPLOADING ──────────────────────────────────── */}
        {pageState === 'uploading' && (
          <motion.div
            className="lexirep-status"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
          >
            <div className="lexirep-spinner" />
            <span className="lexirep-status-label">uploading dataset…</span>
          </motion.div>
        )}

        {/* ── TRAINING ───────────────────────────────────── */}
        {pageState === 'training' && (
          <motion.div
            className="lexirep-status"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
          >
            <div className="lexirep-spinner" />
            <span className="lexirep-status-label">training in progress…</span>
            <span style={{
              fontFamily: 'var(--font-secondary)',
              fontSize: '0.55rem',
              color: 'var(--text-faded)',
              letterSpacing: '0.06em'
            }}>
              this may take several minutes
            </span>
          </motion.div>
        )}

        {/* ── COMPLETE ───────────────────────────────────── */}
        {pageState === 'complete' && (
          <motion.div
            className="lexirep-result"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
          >
            <div className="lexirep-result-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
                strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22,4 12,14.01 9,11.01" />
              </svg>
            </div>
            <span className="lexirep-result-title">training complete</span>

            {outputFiles.length > 0 && (
              <div className="lexirep-result-files">
                {outputFiles.map((f, i) => (
                  <span key={i}>{f}</span>
                ))}
              </div>
            )}

            <a
              className="lexirep-download-btn"
              href={getHttpUrl(`/lexirep/train-result/${jobId}`)}
              download
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
                strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7,10 12,15 17,10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              download model
            </a>

            <motion.button
              className="lexirep-btn"
              onClick={handleReset}
              whileTap={{ scale: 0.97 }}
              transition={tapSpring}
              style={{ marginTop: '0.5rem', maxWidth: '12rem' }}
            >
              Train Another
            </motion.button>
          </motion.div>
        )}

        {/* ── FAILED ─────────────────────────────────────── */}
        {pageState === 'failed' && (
          <motion.div
            className="lexirep-result"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
          >
            <div className="lexirep-result-icon error">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
                strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            </div>
            <span className="lexirep-result-title error">training failed</span>
            <span className="lexirep-result-detail">{error}</span>

            <motion.button
              className="lexirep-btn primary"
              onClick={handleReset}
              whileTap={{ scale: 0.97 }}
              transition={tapSpring}
              style={{ marginTop: '0.5rem', maxWidth: '12rem' }}
            >
              Try Again
            </motion.button>
          </motion.div>
        )}

      </div>
    </div>
  )
}
