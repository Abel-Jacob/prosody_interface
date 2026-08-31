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
 */
function validateNpyBuffer(buffer) {
  try {
    const view = new DataView(buffer)
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
      headerLen = view.getUint16(8, true)
      headerOffset = 10
    } else if (majorVersion === 2) {
      headerLen = view.getUint32(8, true)
      headerOffset = 12
    } else {
      return { valid: false, shape: null, message: `Unsupported NPY version ${majorVersion}` }
    }

    const headerBytes = new Uint8Array(buffer, headerOffset, headerLen)
    const header = new TextDecoder().decode(headerBytes)

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
  const [pageState, setPageState] = useState('idle')
  const [selectedFile, setSelectedFile] = useState(null)
  const [validation, setValidation] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [jobId, setJobId] = useState(null)
  const [error, setError] = useState(null)
  const [outputFiles, setOutputFiles] = useState([])
  const [epochs, setEpochs] = useState(10)
  const fileInputRef = useRef(null)
  const pollRef = useRef(null)

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

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

  const handleRemoveFile = useCallback(() => {
    setSelectedFile(null)
    setValidation(null)
    setError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const handleSubmit = useCallback(async () => {
    if (!selectedFile || !validation?.valid) return
    setPageState('uploading')
    setError(null)

    try {
      const formData = new FormData()
      formData.append('dataset', selectedFile)
      formData.append('epochs', epochs.toString())

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
  }, [selectedFile, validation, epochs])

  const handleReset = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    setPageState('idle')
    setSelectedFile(null)
    setValidation(null)
    setJobId(null)
    setError(null)
    setOutputFiles([])
    setEpochs(10)
  }, [])

  const formatSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const sliderPercent = ((epochs - 1) / 99) * 100
  const sliderBg = `linear-gradient(to right, var(--accent) 0%, var(--accent) ${sliderPercent}%, var(--text-faded) ${sliderPercent}%, var(--text-faded) 100%)`

  return (
    <div className="lexirep-container">
      {/* ── Back ─────────────────────────────────────────── */}
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

      {/* ── IDLE ─────────────────────────────────────────── */}
      {pageState === 'idle' && (
        <motion.div
          className="lexirep-content"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleInputChange}
            accept=".csv,.npy"
            style={{ display: 'none' }}
          />

          {/* ── Dataset ──────────────────────────────────── */}
          <div>
            <div className="lexirep-step-label">dataset</div>

            {!selectedFile ? (
              <div
                className={`lexirep-upload-zone${dragOver ? ' drag-over' : ''}`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <div className="lexirep-upload-zone-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
                    strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17,8 12,3 7,8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                </div>
                <div className="lexirep-upload-zone-text">
                  Drop file or click to browse
                </div>
                <div className="lexirep-upload-zone-hint">
                  .csv or .npy — 768-dimensional vectors
                </div>
              </div>
            ) : (
              <>
                <div className="lexirep-file-pill">
                  <div className="lexirep-file-pill-left">
                    <div className="lexirep-file-pill-icon">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
                        strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14,2 14,8 20,8" />
                      </svg>
                    </div>
                    <div className="lexirep-file-pill-info">
                      <span className="lexirep-file-pill-name">{selectedFile.name}</span>
                      <span className="lexirep-file-pill-meta">{formatSize(selectedFile.size)}</span>
                    </div>
                  </div>
                  <button
                    className="lexirep-file-pill-remove"
                    onClick={handleRemoveFile}
                    title="Remove file"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
                      strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
                {validation && (
                  <div className={`lexirep-validation-msg${validation.valid ? '' : ' error'}`}>
                    {validation.valid ? '✓ ' : '✕ '}{validation.message}
                  </div>
                )}
              </>
            )}
          </div>

          {/* ── Epochs ───────────────────────────────────── */}
          <div>
            <div className="lexirep-step-label">training</div>
            <div className="lexirep-epoch-control">
              <div className="lexirep-epoch-header">
                <span className="lexirep-epoch-title">epochs</span>
                <span className="lexirep-epoch-number">{epochs}</span>
              </div>
              <input
                type="range"
                className="lexirep-epoch-slider"
                min="1"
                max="100"
                value={epochs}
                onChange={(e) => setEpochs(parseInt(e.target.value, 10))}
                style={{ background: sliderBg }}
              />
              <div className="lexirep-epoch-range">
                <span>1</span>
                <span>100</span>
              </div>
            </div>
          </div>

          {/* ── Separator ────────────────────────────────── */}
          <div className="lexirep-separator" />

          {/* ── Submit ───────────────────────────────────── */}
          <motion.button
            className="lexirep-submit-btn"
            onClick={handleSubmit}
            disabled={!validation?.valid}
            whileTap={validation?.valid ? { scale: 0.97 } : {}}
            transition={tapSpring}
          >
            Start Training
          </motion.button>
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
          <span className="lexirep-status-sub">
            {epochs} epoch{epochs !== 1 ? 's' : ''} — this may take several minutes
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
            className="lexirep-reset-btn"
            onClick={handleReset}
            whileTap={{ scale: 0.97 }}
            transition={tapSpring}
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
            className="lexirep-submit-btn"
            onClick={handleReset}
            whileTap={{ scale: 0.97 }}
            transition={tapSpring}
            style={{ maxWidth: '14rem' }}
          >
            Try Again
          </motion.button>
        </motion.div>
      )}
    </div>
  )
}
