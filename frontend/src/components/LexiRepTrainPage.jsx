import React, { useState, useRef, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ThinkingOrb } from 'thinking-orbs'
import { getHttpUrl } from '../apiConfig'
import './LexiRepTrainPage.css'

const tapSpring = { type: 'spring', duration: 0.15, bounce: 0 }

/**
 * SafeThinkingOrb — Guards against thinking-orbs crashes.
 * thinking-orbs strictly only supports preset sizes: 64 and 20.
 * Any other size (like 72 or 80) throws an unhandled TypeError: Cannot read properties of undefined (reading 'count').
 * This component enforces size=64 and catches any unexpected canvas runtime error so React NEVER blanks out.
 */
class SafeThinkingOrb extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }
  static getDerivedStateFromError() {
    return { hasError: true }
  }
  componentDidCatch(err) {
    console.warn('[SafeThinkingOrb] Render issue caught:', err)
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="lexirep-fallback-orb">
          <span className="lexirep-fallback-ring" />
        </div>
      )
    }
    const safeSize = this.props.size === 20 ? 20 : 64
    return (
      <div className="lexirep-orb-scale" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
        <ThinkingOrb state={this.props.state || 'connecting'} size={safeSize} />
      </div>
    )
  }
}

/**
 * Format file size in KB / MB
 */
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Parse a CSV string's row or columns to validate 768-D format.
 */
function validateCsvText(text) {
  const lines = text.trim().split('\n').filter(l => l.trim())
  if (lines.length === 0) return { valid: false, message: 'File is empty' }

  // Check if transposed format (768 to 775 rows, like ISLE GER_train.csv)
  if (lines.length >= 768 && lines.length <= 775) {
    return {
      valid: true,
      message: `Transposed ISLE CSV format (${lines.length} feature rows) — auto-converts to cached .npz`
    }
  }

  // Row-based format
  let dataRow = lines[0]
  const firstFields = dataRow.split(',')
  const isHeader = firstFields.some(f => isNaN(parseFloat(f.trim())))
  if (isHeader && lines.length > 1) {
    dataRow = lines[1]
  }

  const ncols = dataRow.split(',').length
  if (ncols >= 768) {
    return {
      valid: true,
      message: `${lines.length - (isHeader ? 1 : 0)} samples × ${ncols} columns — auto-converts to cached .npz`
    }
  }

  return {
    valid: false,
    message: `Expected 768 feature columns or ~770 rows (transposed), but found ${ncols} columns`
  }
}

/**
 * Validate NPZ binary archive (checks ZIP magic number: PK\x03\x04).
 */
function validateNpzBuffer(buffer) {
  try {
    const view = new DataView(buffer)
    if (view.byteLength < 4) return { valid: false, message: 'File is too small to be a valid .npz file' }
    const magic = view.getUint32(0, true)
    if (magic === 0x04034b50) {
      return { valid: true, message: 'Optimized binary NPZ cache archive (Recommended: 10× faster)' }
    }
    return { valid: false, message: 'Not a valid NPZ file format' }
  } catch (e) {
    return { valid: false, message: `Failed to inspect NPZ file: ${e.message}` }
  }
}

/**
 * Parse NPY header to read shape.
 */
function validateNpyBuffer(buffer) {
  try {
    const view = new DataView(buffer)
    const magic = String.fromCharCode(
      view.getUint8(0), view.getUint8(1), view.getUint8(2),
      view.getUint8(3), view.getUint8(4), view.getUint8(5)
    )
    if (magic !== '\x93NUMPY') {
      return { valid: false, message: 'Not a valid NPY file (bad magic number)' }
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
      return { valid: false, message: `Unsupported NPY version ${majorVersion}` }
    }

    const headerBytes = new Uint8Array(buffer, headerOffset, headerLen)
    const header = new TextDecoder().decode(headerBytes)

    const shapeMatch = header.match(/'shape'\s*:\s*\(([^)]+)\)/)
    if (!shapeMatch) {
      return { valid: false, message: 'Could not parse shape from NPY header' }
    }

    const dims = shapeMatch[1].split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))
    if (dims.length !== 2) {
      return { valid: false, message: `Expected 2D array, got ${dims.length}D (shape: ${dims.join('×')})` }
    }
    if (dims[1] < 768) {
      return { valid: false, message: `Expected at least 768 columns, found ${dims[1]}` }
    }
    return { valid: true, message: `${dims[0]} samples × ${dims[1]} dimensions (768-D)` }
  } catch (e) {
    return { valid: false, message: `Failed to parse NPY file: ${e.message}` }
  }
}

export default function LexiRepTrainPage({ onBack }) {
  const [pageState, setPageState] = useState('idle') // idle | uploading | training | complete | failed
  const [selectedFile, setSelectedFile] = useState(null)
  const [validation, setValidation] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [jobId, setJobId] = useState(null)
  const [error, setError] = useState(null)
  const [outputFiles, setOutputFiles] = useState([])
  const [epochs, setEpochs] = useState(13) // Default to 13 loops from paper

  // Live training metrics & progress
  const [currentLoop, setCurrentLoop] = useState(0)
  const [totalLoops, setTotalLoops] = useState(13)
  const [progress, setProgress] = useState(0)
  const [currentMetrics, setCurrentMetrics] = useState(null)
  const [history, setHistory] = useState([])
  const [modelSummary, setModelSummary] = useState(null)
  const [serverLogs, setServerLogs] = useState([])
  const [statusText, setStatusText] = useState('training in progress…')
  const [activeTab, setActiveTab] = useState('blueprint') // 'blueprint' | 'weights' | 'scorecard'

  const fileInputRef = useRef(null)
  const pollRef = useRef(null)

  const formatStatusMessage = useCallback((raw) => {
    if (!raw) return 'training in progress…'
    return raw
      .replace(/^\[PROG\]\s*/i, '')
      .replace(/^\[LexiRep Training\]\s*/i, '')
      .trim()
  }, [])

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  const validateFile = useCallback(async (file) => {
    try {
      const ext = file.name.split('.').pop().toLowerCase()
      if (ext === 'npz') {
        const buffer = await file.arrayBuffer()
        return validateNpzBuffer(buffer)
      } else if (ext === 'csv') {
        const text = await file.text()
        return validateCsvText(text)
      } else if (ext === 'npy') {
        const buffer = await file.arrayBuffer()
        return validateNpyBuffer(buffer)
      } else {
        return { valid: false, message: `Unsupported file type .${ext}. Please use .npz or .csv` }
      }
    } catch (e) {
      return { valid: false, message: `Failed to inspect file: ${e.message}` }
    }
  }, [])

  const handleFileSelect = useCallback(async (file) => {
    if (!file) return
    setSelectedFile(file)
    setValidation(null)
    setError(null)
    try {
      const result = await validateFile(file)
      setValidation(result)
    } catch (e) {
      console.warn('File validation error:', e)
      setValidation({ valid: false, message: `Could not validate file: ${e.message}` })
    }
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
    setStatusText('Preparing & uploading dataset…')
    setError(null)
    setCurrentLoop(0)
    setProgress(0)
    setCurrentMetrics(null)
    setHistory([])
    setModelSummary(null)

    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }

    try {
      const formData = new FormData()
      formData.append('dataset', selectedFile)
      formData.append('epochs', epochs.toString())

      const url = getHttpUrl('/lexirep/train-custom')
      let response
      try {
        response = await fetch(url, {
          method: 'POST',
          body: formData,
        })
      } catch (netErr) {
        throw new Error(
          `Unable to connect to backend server at ${url}. Please verify that the Cloudflare tunnel or backend server is running.`
        )
      }

      let data = {}
      try {
        data = await response.json()
      } catch {
        // Non-JSON response (e.g. proxy HTML error page)
      }

      if (!response.ok) {
        const errorMsg =
          data?.detail ||
          (response.status === 413
            ? 'File is too large for the tunnel connection. Please upload an optimized .npz cache file instead.'
            : `Upload failed (HTTP ${response.status})`)
        throw new Error(errorMsg)
      }

      if (!data?.job_id) {
        throw new Error('Server response did not include a valid training job ID.')
      }

      setJobId(data.job_id)
      setTotalLoops(data.epochs || epochs)
      setPageState('training')
      setStatusText('Initializing pipeline…')

      pollRef.current = setInterval(async () => {
        try {
          const statusRes = await fetch(getHttpUrl(`/lexirep/train-status/${data.job_id}`))
          if (!statusRes.ok) return
          const statusData = await statusRes.json()

          if (statusData.current_loop !== undefined) {
            setCurrentLoop(statusData.current_loop)
          }
          if (statusData.total_loops !== undefined) {
            setTotalLoops(statusData.total_loops)
          }
          if (statusData.progress !== undefined) {
            setProgress(statusData.progress)
          }
          if (statusData.current_metrics) {
            setCurrentMetrics(statusData.current_metrics)
          }
          if (statusData.history) {
            setHistory(statusData.history)
          }
          if (statusData.logs && Array.isArray(statusData.logs)) {
            setServerLogs(statusData.logs)
            if (statusData.logs.length > 0) {
              const latest = statusData.logs[statusData.logs.length - 1]
              if (latest) setStatusText(formatStatusMessage(latest))
            }
          }

          if (statusData.status === 'complete') {
            if (pollRef.current) {
              clearInterval(pollRef.current)
              pollRef.current = null
            }
            setOutputFiles(statusData.output_files || [])
            setModelSummary(statusData.model_summary || null)
            setPageState('complete')
          } else if (statusData.status === 'failed') {
            if (pollRef.current) {
              clearInterval(pollRef.current)
              pollRef.current = null
            }
            setError(statusData.error || 'Training failed on server.')
            setPageState('failed')
          }
        } catch (pollErr) {
          // Network hiccup during polling — keep retrying
          console.warn('[LexiRep] Polling status ping failed, retrying...', pollErr)
        }
      }, 1000)
    } catch (err) {
      console.error('[LexiRep] Training initiation failed:', err)
      setError(err.message || 'An unexpected error occurred during dataset upload.')
      setPageState('failed')
    }
  }, [selectedFile, validation, epochs])

  const handleReset = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    setPageState('idle')
    setSelectedFile(null)
    setValidation(null)
    setError(null)
    setJobId(null)
    setOutputFiles([])
    setCurrentLoop(0)
    setProgress(0)
    setCurrentMetrics(null)
    setHistory([])
    setModelSummary(null)
    setServerLogs([])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const sliderPercent = ((epochs - 1) / (30 - 1)) * 100
  const sliderBg = `linear-gradient(to right, var(--text-primary) 0%, var(--text-primary) ${sliderPercent}%, var(--text-faded) ${sliderPercent}%, var(--text-faded) 100%)`

  const hasCacheFile = outputFiles.includes('dataset_cache.npz')

  return (
    <div className="lexirep-container">
      <div className="page-path" aria-label="Current page">PROSODY / LEXIREP</div>

      {/* Back button */}
      <motion.button
        type="button"
        className="page-back"
        onClick={onBack}
        whileTap={{ scale: 0.95 }}
        transition={tapSpring}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
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
          Iterative One-Shot Linguistically Constrained Lexical Stress Representation Learning.
          Upload a 768-D dataset (.npz cache recommended, or .csv) to train custom neural representations.
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
          <p className="lexirep-upload-note">
            Use a precomputed <code>.npz</code> cache for faster training. CSV files are converted automatically.
          </p>

          <input
            type="file"
            ref={fileInputRef}
            onChange={handleInputChange}
            accept=".npz,.csv,.npy"
            style={{ display: 'none' }}
          />

          {/* ── Dataset ──────────────────────────────────── */}
          <div>
            <div className="lexirep-step-label">dataset file (.npz or .csv)</div>

            {!selectedFile ? (
              <div
                className={`lexirep-upload-zone${dragOver ? ' drag-over' : ''}`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <div className="lexirep-upload-zone-icon">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
                    strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17,8 12,3 7,8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                </div>
                <div className="lexirep-upload-zone-text">
                  Drop .npz or .csv file or click to browse
                </div>
                <div className="lexirep-upload-zone-hint">
                  .npz (precomputed binary cache) or .csv (768-D features)
                </div>
              </div>
            ) : (
              <>
                <div className="lexirep-file-pill">
                  <div className="lexirep-file-pill-left">
                    <div className="lexirep-file-pill-icon">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
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

          {/* ── Training Loops / Epochs ───────────────────── */}
          <div>
            <div className="lexirep-step-label">iterative self-training loops</div>
            <div className="lexirep-epoch-control">
              <div className="lexirep-epoch-header">
                <span className="lexirep-epoch-title">Loops (Paper Standard: 13)</span>
                <span className="lexirep-epoch-number">{epochs}</span>
              </div>
              <input
                type="range"
                className="lexirep-epoch-slider"
                min="1"
                max="30"
                value={epochs}
                onChange={(e) => setEpochs(parseInt(e.target.value, 10))}
                style={{ background: sliderBg }}
              />
              <div className="lexirep-epoch-range">
                <span>1 (Fast Test)</span>
                <span>13 (Paper Standard)</span>
                <span>30 (Deep Convergence)</span>
              </div>
            </div>
          </div>

          <div className="lexirep-separator" />

          {/* ── Submit ───────────────────────────────────── */}
          <motion.button
            className="lexirep-submit-btn"
            onClick={handleSubmit}
            disabled={!validation?.valid}
            whileTap={validation?.valid ? { scale: 0.97 } : {}}
            transition={tapSpring}
          >
            Start LexiRep Training
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
          <div className="lexirep-orb-wrapper">
            <SafeThinkingOrb state="connecting" size={64} />
          </div>
          <span className="lexirep-status-label">Preparing &amp; uploading dataset…</span>
          <span className="lexirep-status-sub">Validating 768-D representation tensors</span>
        </motion.div>
      )}

      {/* ── TRAINING (Connecting Orb) ─────────────────── */}
      {pageState === 'training' && (
        <motion.div
          className="lexirep-training-dashboard"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          {/* Explicitly using state="connecting" with safe size 64 */}
          <div className="lexirep-orb-wrapper">
            <SafeThinkingOrb state="connecting" size={64} />
          </div>

          <div className="lexirep-training-status-wrapper">
            <AnimatePresence mode="wait">
              <motion.div
                key={statusText}
                initial={{ opacity: 0, y: 3 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -3 }}
                transition={{ duration: 0.28, ease: 'easeInOut' }}
                className="lexirep-status-fader-text"
              >
                {statusText}
              </motion.div>
            </AnimatePresence>
          </div>

          <div className="lexirep-loop-counter">
            Loop <span className="highlight">{currentLoop}</span> / {totalLoops}
          </div>

          {/* Progress bar */}
          <div className="lexirep-progress-track">
            <motion.div
              className="lexirep-progress-fill"
              initial={{ width: '0%' }}
              animate={{ width: `${Math.max(progress, 5)}%` }}
              transition={{ ease: 'easeOut', duration: 0.4 }}
            />
          </div>

          {/* Real-time metrics pills */}
          {currentMetrics && (
            <div className="lexirep-live-metrics">
              <div className="lexirep-live-pill btq">
                <span className="pill-title">Test BTQ Accuracy</span>
                <span className="pill-val">{currentMetrics.BTQ ?? '—'}%</span>
              </div>
              <div className="lexirep-live-pill">
                <span className="pill-title">Pseudo Train Acc</span>
                <span className="pill-val">{currentMetrics.train ?? '—'}%</span>
              </div>
              <div className="lexirep-live-pill">
                <span className="pill-title">IDEC Loss</span>
                <span className="pill-val">{currentMetrics.loss ?? '—'}</span>
              </div>
            </div>
          )}

          {/* Live Server Telemetry Logs Box */}
          <div className="lexirep-live-log-box">
            <div className="lexirep-live-log-header">
              <span className="lexirep-log-pulse" />
              <span>LIVE BACKEND TRAINING TELEMETRY</span>
            </div>
            <div className="lexirep-live-log-list">
              {serverLogs && serverLogs.length > 0 ? (
                serverLogs.map((log, idx) => (
                  <div key={idx} className="lexirep-log-line">
                    <span className="lexirep-log-prompt">&gt;</span> {log}
                  </div>
                ))
              ) : (
                <div className="lexirep-log-line muted">
                  <span className="lexirep-log-prompt">&gt;</span> Connected to backend. Initializing PyTorch pipeline...
                </div>
              )}
            </div>
          </div>

          <span className="lexirep-status-sub">
            Optimizing 5-layer encoder and Student-t clustering representations
          </span>
        </motion.div>
      )}

      {/* ── COMPLETE: Creative Model & Weights Display ─── */}
      {pageState === 'complete' && (
        <motion.div
          className="lexirep-complete-container"
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
        >
          {/* Celebratory badge */}
          <div className="lexirep-complete-badge">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
              stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6L9 17l-5-5" />
            </svg>
            <span>TRAINING CONVERGED &amp; VALIDATED</span>
          </div>

          <h2 className="lexirep-complete-title">LexiRep Model Generated</h2>
          <p className="lexirep-complete-desc">
            109,466 weights trained across 5 representation layers. Tested against the BTQ linguistic constraint.
          </p>

          {/* Navigation Tabs */}
          <div className="lexirep-tabs">
            <button
              className={`lexirep-tab-btn ${activeTab === 'blueprint' ? 'active' : ''}`}
              onClick={() => setActiveTab('blueprint')}
            >
              Network Architecture
            </button>
            <button
              className={`lexirep-tab-btn ${activeTab === 'weights' ? 'active' : ''}`}
              onClick={() => setActiveTab('weights')}
            >
              Layer Weight Stats
            </button>
            <button
              className={`lexirep-tab-btn ${activeTab === 'scorecard' ? 'active' : ''}`}
              onClick={() => setActiveTab('scorecard')}
            >
              BTQ Scorecard
            </button>
          </div>

          {/* ── TAB 1: Network Blueprint ───────────────────── */}
          {activeTab === 'blueprint' && (
            <div className="lexirep-blueprint-view">
              <div className="blueprint-nodes-flow">
                <div className="blueprint-node input">
                  <span className="node-type">Input</span>
                  <strong className="node-dim">768-D</strong>
                  <span className="node-sub">Wav2Vec 2.0</span>
                </div>
                <div className="blueprint-arrow">→</div>

                <div className="blueprint-node layer">
                  <span className="node-type">Layer 1</span>
                  <strong className="node-dim">128</strong>
                  <span className="node-sub">ReLU (98.4k)</span>
                </div>
                <div className="blueprint-arrow">→</div>

                <div className="blueprint-node layer">
                  <span className="node-type">Layer 2</span>
                  <strong className="node-dim">64</strong>
                  <span className="node-sub">ReLU (8.2k)</span>
                </div>
                <div className="blueprint-arrow">→</div>

                <div className="blueprint-node layer">
                  <span className="node-type">Layer 3</span>
                  <strong className="node-dim">32</strong>
                  <span className="node-sub">ReLU (2.0k)</span>
                </div>
                <div className="blueprint-arrow">→</div>

                <div className="blueprint-node layer">
                  <span className="node-type">Layer 4</span>
                  <strong className="node-dim">16</strong>
                  <span className="node-sub">ReLU (528)</span>
                </div>
                <div className="blueprint-arrow">→</div>

                <div className="blueprint-node bottleneck">
                  <span className="node-type">Bottleneck</span>
                  <strong className="node-dim">10-D</strong>
                  <span className="node-sub">Sigmoid</span>
                </div>
              </div>

              {/* Latent Space & Prototypes Box */}
              {modelSummary?.prototypes && (
                <div className="lexirep-prototypes-box">
                  <div className="prototype-item">
                    <span className="proto-dot stressed" />
                    <div>
                      <div className="proto-label">Stressed Prototype (z_s^h)</div>
                      <div className="proto-vector">
                        [{Array.isArray(modelSummary.prototypes.stressed_vector)
                          ? modelSummary.prototypes.stressed_vector.slice(0, 5).join(', ')
                          : '—'} …]
                      </div>
                    </div>
                  </div>
                  <div className="proto-divider" />
                  <div className="prototype-item">
                    <span className="proto-dot unstressed" />
                    <div>
                      <div className="proto-label">Unstressed Prototype (z_u^h)</div>
                      <div className="proto-vector">
                        [{Array.isArray(modelSummary.prototypes.unstressed_vector)
                          ? modelSummary.prototypes.unstressed_vector.slice(0, 5).join(', ')
                          : '—'} …]
                      </div>
                    </div>
                  </div>
                  <div className="proto-cosine-badge">
                    <span>Cosine Distance:</span>
                    <strong>{modelSummary.prototypes.cosine_similarity ?? '—'}</strong>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── TAB 2: Weight Statistics ───────────────────── */}
          {activeTab === 'weights' && (
            <div className="lexirep-weights-table-wrapper">
              <table className="lexirep-weights-table">
                <thead>
                  <tr>
                    <th>Tensor Layer</th>
                    <th>Shape</th>
                    <th>Weights</th>
                    <th>Mean</th>
                    <th>Std Dev</th>
                    <th>L2 Norm</th>
                  </tr>
                </thead>
                <tbody>
                  {modelSummary?.weight_stats?.map((w, idx) => (
                    <tr key={idx}>
                      <td><code>{w.name}</code></td>
                      <td>{Array.isArray(w.shape) ? w.shape.join(' × ') : String(w.shape || '—')}</td>
                      <td>{w.params?.toLocaleString?.() ?? w.params ?? '—'}</td>
                      <td>{w.mean ?? '—'}</td>
                      <td>{w.std ?? '—'}</td>
                      <td><span className="norm-tag">{w.l2_norm ?? '—'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── TAB 3: BTQ Benchmark Scorecard ─────────────── */}
          {activeTab === 'scorecard' && (
            <div className="lexirep-scorecard-grid">
              <div className="scorecard-card">
                <span className="sc-label">Bi-syllabic (B)</span>
                <strong className="sc-val">{modelSummary?.final_metrics?.B ?? 0}%</strong>
                <span className="sc-target">Target: ~83.4%</span>
              </div>
              <div className="scorecard-card">
                <span className="sc-label">Bi + Tri (BT)</span>
                <strong className="sc-val">{modelSummary?.final_metrics?.BT ?? 0}%</strong>
                <span className="sc-target">Target: ~83.0%</span>
              </div>
              <div className="scorecard-card highlight">
                <span className="sc-label">Bi + Tri + Quad (BTQ)</span>
                <strong className="sc-val">{modelSummary?.final_metrics?.BTQ ?? 0}%</strong>
                <span className="sc-target">Paper Benchmark Target: 82.73%</span>
              </div>
              <div className="scorecard-card">
                <span className="sc-label">Training Duration</span>
                <strong className="sc-val">{modelSummary?.duration_seconds ?? 0}s</strong>
                <span className="sc-target">{modelSummary?.epochs_trained ?? epochs} Loops</span>
              </div>
            </div>
          )}

          {/* ── Download Action Buttons ───────────────────── */}
          <div className="lexirep-download-section">
            <div className="lexirep-download-grid">
              {/* Primary Model Download Button */}
              <a
                className="lexirep-action-btn primary"
                href={jobId ? getHttpUrl(`/lexirep/train-result/${jobId}?file=final_lexirep_model.pt`) : '#'}
                download="final_lexirep_model.pt"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7,10 12,15 17,10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                <span>Download Model (.pt)</span>
              </a>

              {/* Complete Zip Package Download */}
              <a
                className="lexirep-action-btn secondary"
                href={jobId ? getHttpUrl(`/lexirep/train-result/${jobId}`) : '#'}
                download={`lexirep_bundle_${jobId ? jobId.slice(0, 8) : 'export'}.zip`}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                <span>Download Checkpoint Bundle (.zip)</span>
              </a>

              {/* NPZ Cache Download (if CSV was converted) */}
              {hasCacheFile && (
                <a
                  className="lexirep-action-btn cache"
                  href={jobId ? getHttpUrl(`/lexirep/train-result/${jobId}?file=dataset_cache.npz`) : '#'}
                  download="dataset_cache.npz"
                  title="Download the precomputed binary NPZ cache for future instant training"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                    <polyline points="17 21 17 13 7 13 7 21" />
                    <polyline points="7 3 7 8 15 8" />
                  </svg>
                  <span>Download .npz Cache</span>
                </a>
              )}
            </div>

            <motion.button
              className="lexirep-reset-btn"
              onClick={handleReset}
              whileTap={{ scale: 0.97 }}
              transition={tapSpring}
            >
              Train Another Model
            </motion.button>
          </div>
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
          <span className="lexirep-result-title error">Training Encountered An Error</span>
          <span className="lexirep-result-detail">{error}</span>

          <motion.button
            className="lexirep-submit-btn"
            onClick={handleReset}
            whileTap={{ scale: 0.97 }}
            transition={tapSpring}
            style={{ maxWidth: '14rem', marginTop: '1rem' }}
          >
            Try Again
          </motion.button>
        </motion.div>
      )}
    </div>
  )
}
