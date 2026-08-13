import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import './AnnotationReport.css'
import WordTooltip from './WordTooltip'
import ProsodyWord from './ProsodyWord'


// Arrow icon mapping
const TREND_ARROWS = {
  '↑': '↑',
  '↓': '↓',
  '→': '→',
  '↗': '↗',
  '↘': '↘',
}

export default function AnnotationReport({ data, onBack }) {
  const [expandedWordIndex, setExpandedWordIndex] = useState(null)
  const [viewMode, setViewMode] = useState('transcript') // 'transcript' | 'table'
  const [expandedSegmentIndex, setExpandedSegmentIndex] = useState(null)
  const [activeTooltipWord, setActiveTooltipWord] = useState(null)
  const [activeTooltipRef, setActiveTooltipRef] = useState(null)

  const handleTranscriptWordClick = (w, e) => {
    e.stopPropagation()
    if (activeTooltipWord?.word_index === w.word_index) {
      setActiveTooltipWord(null)
      setActiveTooltipRef(null)
    } else {
      setActiveTooltipWord(w)
      setActiveTooltipRef({ current: e.currentTarget })
    }
  }


  if (!data) {
    return (
      <div className="annotation-report-container">
        <div className="empty-state">
          <h3>No Data Loaded</h3>
          <p>Please record speech and try again.</p>
          <button className="control-btn" onClick={onBack} style={{ marginTop: '1.5rem' }}>
            Back to Recorder
          </button>
        </div>
      </div>
    )
  }

  const { recording, models, summary, phrases = [], words = [], errors = [] } = data

  // CSV Export Handler
  const handleDownloadCSV = () => {
    if (!words || words.length === 0) return

    const headers = [
      'word_index',
      'word',
      'start_time',
      'end_time',
      'phrase_index',
      'asr_confidence',
      'stressed',
      'stress_score',
      'pause_after',
      'is_hesitation',
      'mean_pitch',
      'pitch_trend',
      'pitch_slope',
      'pitch_range',
    ]

    const csvRows = [
      headers.join(','),
      ...words.map((w) => {
        const fields = [
          w.word_index,
          `"${w.word.replace(/"/g, '""')}"`, // escape quotes
          w.start_time.toFixed(2),
          w.end_time.toFixed(2),
          w.phrase_index,
          (w.asr_confidence || 1.0).toFixed(3),
          w.stressed ? 'TRUE' : 'FALSE',
          (w.stress_score || 0.0).toFixed(3),
          (w.pause_after || 0.0).toFixed(2),
          w.is_hesitation ? 'TRUE' : 'FALSE',
          w.intonation?.mean_pitch !== undefined && w.intonation?.mean_pitch !== null
            ? w.intonation.mean_pitch.toFixed(1)
            : '',
          w.intonation?.pitch_trend || '',
          w.intonation?.pitch_slope !== undefined && w.intonation?.pitch_slope !== null
            ? w.intonation.pitch_slope.toFixed(2)
            : '',
          w.intonation?.pitch_range !== undefined && w.intonation?.pitch_range !== null
            ? w.intonation.pitch_range.toFixed(1)
            : '',
        ]
        return fields.join(',')
      }),
    ]

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', `annotation_${recording?.job_id || 'export'}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // JSON Export Handler
  const handleDownloadJSON = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', `annotation_${recording?.job_id || 'export'}.json`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // Sparkline SVG renderer
  const renderSparkline = (charPitches) => {
    if (!charPitches || charPitches.length === 0) {
      return <span style={{ color: 'var(--text-faded)', fontSize: '0.65rem' }}>No pitch contour</span>
    }

    const width = 120
    const height = 24
    const padding = 2

    // If only 1 pitch point, draw a flat baseline
    if (charPitches.length === 1) {
      const y = height - (charPitches[0] * (height - padding * 2) + padding)
      return (
        <svg width={width} height={height} className="sparkline-svg">
          <line
            x1="0"
            y1={y}
            x2={width}
            y2={y}
            stroke="var(--accent)"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      )
    }

    const points = charPitches
      .map((val, idx) => {
        const x = (idx / (charPitches.length - 1)) * width
        const y = height - (val * (height - padding * 2) + padding)
        return `${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ')

    return (
      <svg width={width} height={height} className="sparkline-svg">
        <polyline
          fill="none"
          stroke="var(--accent)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={points}
        />
      </svg>
    )
  }

  const renderSegmentContourGraph = (seg) => {
    if (!seg || !seg.mae_stylized || seg.mae_stylized.length === 0) return null

    const stylizedPitches = seg.mae_stylized || []
    const rawPitches = seg.raw_contour || []
    const allPitches = [...stylizedPitches, ...rawPitches]

    const minVal = Math.min(...allPitches)
    const maxVal = Math.max(...allPitches)
    const rangeMin = Math.max(0, minVal - 20)
    const rangeMax = maxVal + 20

    const width = 600
    const height = 180
    const paddingX = 45
    const paddingY = 25

    const stylizedPoints = stylizedPitches
      .map((val, idx) => {
        const x = paddingX + (idx / (stylizedPitches.length - 1)) * (width - 2 * paddingX)
        const y = height - paddingY - ((val - rangeMin) / (rangeMax - rangeMin)) * (height - 2 * paddingY)
        return `${x},${y}`
      })
      .join(' ')

    const rawPoints = rawPitches
      .map((val, idx) => {
        const x = paddingX + (idx / (rawPitches.length - 1)) * (width - 2 * paddingX)
        const y = height - paddingY - ((val - rangeMin) / (rangeMax - rangeMin)) * (height - 2 * paddingY)
        return `${x},${y}`
      })
      .join(' ')

    const areaPoints = [
      `${paddingX},${height - paddingY}`,
      ...stylizedPitches.map((val, idx) => {
        const x = paddingX + (idx / (stylizedPitches.length - 1)) * (width - 2 * paddingX)
        const y = height - paddingY - ((val - rangeMin) / (rangeMax - rangeMin)) * (height - 2 * paddingY)
        return `${x},${y}`
      }),
      `${paddingX + (width - 2 * paddingX)},${height - paddingY}`
    ].join(' ')

    const yGrid1 = height - paddingY
    const yGrid2 = height - paddingY - 0.5 * (height - 2 * paddingY)
    const yGrid3 = paddingY

    const valGrid1 = rangeMin.toFixed(0)
    const valGrid2 = (rangeMin + 0.5 * (rangeMax - rangeMin)).toFixed(0)
    const valGrid3 = rangeMax.toFixed(0)

    return (
      <div className="segment-graph-wrapper" style={{ padding: '1rem', background: 'rgba(22, 21, 20, 0.25)', borderRadius: '4px', border: '1px solid var(--overlay-border)', marginTop: '0.8rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          <span>Segment range: {seg.start_time.toFixed(2)}s – {seg.end_time.toFixed(2)}s</span>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ display: 'inline-block', width: '12px', height: '2.5px', background: 'var(--accent)' }}></span>
              Stylized (P=1)
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ display: 'inline-block', width: '12px', height: '2.5px', background: '#ffffff' }}></span>
              Raw (SWIPE)
            </span>
          </div>
        </div>
        <div style={{ position: 'relative', width: '100%', display: 'flex', justifyContent: 'center' }}>
          <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" className="segment-contour-svg">
            <defs>
              <linearGradient id={`grad-${seg.segment_index}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.25" />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.0" />
              </linearGradient>
            </defs>

            <line x1={paddingX} y1={yGrid1} x2={width - paddingX} y2={yGrid1} stroke="rgba(255,255,255,0.06)" strokeDasharray="3,3" />
            <line x1={paddingX} y1={yGrid2} x2={width - paddingX} y2={yGrid2} stroke="rgba(255,255,255,0.06)" strokeDasharray="3,3" />
            <line x1={paddingX} y1={yGrid3} x2={width - paddingX} y2={yGrid3} stroke="rgba(255,255,255,0.06)" strokeDasharray="3,3" />

            <text x={paddingX - 10} y={yGrid1 + 4} textAnchor="end" fill="var(--text-muted)" fontSize="9" fontFamily="monospace">{valGrid1} Hz</text>
            <text x={paddingX - 10} y={yGrid2 + 4} textAnchor="end" fill="var(--text-muted)" fontSize="9" fontFamily="monospace">{valGrid2} Hz</text>
            <text x={paddingX - 10} y={yGrid3 + 4} textAnchor="end" fill="var(--text-muted)" fontSize="9" fontFamily="monospace">{valGrid3} Hz</text>

            <text x={paddingX} y={height - 6} textAnchor="middle" fill="var(--text-muted)" fontSize="9" fontFamily="monospace">{seg.start_time.toFixed(2)}s</text>
            <text x={width / 2} y={height - 6} textAnchor="middle" fill="var(--text-muted)" fontSize="9" fontFamily="monospace">{((seg.start_time + seg.end_time) / 2).toFixed(2)}s</text>
            <text x={width - paddingX} y={height - 6} textAnchor="middle" fill="var(--text-muted)" fontSize="9" fontFamily="monospace">{seg.end_time.toFixed(2)}s</text>

            <polygon points={areaPoints} fill={`url(#grad-${seg.segment_index})`} />

            {rawPoints && (
              <polyline
                fill="none"
                stroke="#ffffff"
                strokeWidth="2.5"
                points={rawPoints}
              />
            )}

            <polyline fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" points={stylizedPoints} />
          </svg>
        </div>
      </div>
    )
  }

  const handleWordClick = (wordIndex, e) => {
    e.stopPropagation()
    setExpandedWordIndex((prev) => (prev === wordIndex ? null : wordIndex))
  }

  const handlePageClick = () => {
    setExpandedWordIndex(null)
  }

  // Complete structured grid of all properties from the JSON file
  const renderWordDetailGrid = (w) => {
    return (
      <div className="detail-grid-container" style={{ gridTemplateColumns: '1fr' }}>
        <div>
          <div className="detail-section-title">Word Properties</div>
          <table className="property-details-table">
            <tbody>
              <tr>
                <td className="prop-key">word</td>
                <td className="prop-val">"{w.word}"</td>
              </tr>
              <tr>
                <td className="prop-key">start_time</td>
                <td className="prop-val">{w.start_time.toFixed(3)}s</td>
              </tr>
              <tr>
                <td className="prop-key">end_time</td>
                <td className="prop-val">{w.end_time.toFixed(3)}s</td>
              </tr>
              <tr>
                <td className="prop-key">asr_confidence</td>
                <td className="prop-val">{w.asr_confidence !== undefined ? w.asr_confidence.toFixed(3) : 'null'}</td>
              </tr>
              <tr>
                <td className="prop-key">stressed</td>
                <td className="prop-val">{w.stressed ? 'true' : 'false'}</td>
              </tr>
              <tr>
                <td className="prop-key">stress_score</td>
                <td className="prop-val">{(w.stress_score || 0).toFixed(3)}</td>
              </tr>
              <tr>
                <td className="prop-key">pause_after</td>
                <td className="prop-val">{(w.pause_after || 0).toFixed(2)}s</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <div className="annotation-report-container" onClick={handlePageClick}>
      {/* Header controls & stats */}
      <header className="report-header">
        <div className="header-title-section">
          <h1>Annotation Report</h1>

          <div className="metadata-row">
            <span className="metadata-item">
              Duration: <strong>{recording?.audio_duration_sec?.toFixed(1) || 0}s</strong>
            </span>
            <span className="metadata-item">
              WPM: <strong>{Math.round(summary?.wpm || 0)}</strong>
            </span>
            <span className="metadata-item">
              Stress Ratio: <strong>{Math.round((summary?.stress_ratio || 0) * 100)}%</strong>
            </span>
            <span className="metadata-item">
              Phrases: <strong>{summary?.phrase_count || phrases.length}</strong>
            </span>
          </div>

          <div className="models-row">
            ASR: {models?.asr_final || 'N/A'} ({models?.asr_device || 'cpu'}) | VAD: {models?.vad_model || 'N/A'} | Stress: {models?.stress_model || 'N/A'}
          </div>
        </div>

        <div className="header-controls">
          {/* View Mode Toggle Controls */}
          <div className="view-toggle-container">
            <button
              className={`toggle-btn ${viewMode === 'transcript' ? 'active' : ''}`}
              onClick={(e) => {
                e.stopPropagation()
                setViewMode('transcript')
              }}
            >
              Transcript
            </button>
            <button
              className={`toggle-btn ${viewMode === 'table' ? 'active' : ''}`}
              onClick={(e) => {
                e.stopPropagation()
                setViewMode('table')
              }}
            >
              Table View
            </button>
          </div>

          <button className="control-btn primary" onClick={handleDownloadCSV}>
            Download CSV
          </button>
          <button className="control-btn" onClick={handleDownloadJSON}>
            Download JSON
          </button>
          <button className="control-btn" onClick={onBack} style={{ borderColor: 'var(--text-faded)' }}>
            Back
          </button>
        </div>
      </header>

      {/* Main expandable phrase area */}
      <main className="report-content">

        {errors && errors.length > 0 && (
          <div style={{ color: 'var(--error)', fontSize: '0.75rem', marginBottom: '0.5rem' }}>
            {errors.map((err, i) => (
              <div key={i}>⚠️ {err.message}</div>
            ))}
          </div>
        )}

        {phrases.length === 0 ? (
          <div className="empty-state">
            <h3>No Speech Detected</h3>
            <p>The recording did not contain any valid speech segments.</p>
          </div>
        ) : (
          phrases.map((phrase) => {
            const phraseWords = words.filter((w) => w.phrase_index === phrase.phrase_index)

            return (
              <section key={phrase.phrase_index} className="phrase-card">
                <header className="phrase-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span className="phrase-title">Phrase #{phrase.phrase_index + 1}</span>
                    <span className="phrase-time">
                      {phrase.start_time.toFixed(2)}s – {phrase.end_time.toFixed(2)}s
                    </span>
                  </div>
                  {phrase.intonation && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.75rem' }}>
                      {phrase.intonation.pitch_trend && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'rgba(196, 149, 106, 0.15)', color: 'var(--accent)', padding: '2px 8px', borderRadius: '4px', fontWeight: 600 }}>
                          Pitch: {TREND_ARROWS[phrase.intonation.pitch_trend] || phrase.intonation.pitch_trend}
                        </span>
                      )}
                      {phrase.intonation.mean_pitch != null && (
                        <span style={{ color: 'var(--text-muted)' }}>
                          Mean: <strong>{phrase.intonation.mean_pitch.toFixed(1)} Hz</strong>
                        </span>
                      )}
                      {phrase.intonation.pitch_range != null && (
                        <span style={{ color: 'var(--text-muted)' }}>
                          Range: <strong>{phrase.intonation.pitch_range.toFixed(1)} Hz</strong>
                        </span>
                      )}
                    </div>
                  )}
                </header>

                {viewMode === 'transcript' ? (
                  // Mode A: Transcript Inline View
                  <div className="phrase-words-container">
                    {phraseWords.length === 0 ? (
                      <span style={{ color: 'var(--text-faded)', fontStyle: 'italic', fontSize: '0.8rem' }}>
                        No words processed in this phrase
                      </span>
                    ) : (
                      phraseWords.map((w) => {
                        const isExpanded = expandedWordIndex === w.word_index
                        const stressOpacity = w.stress_score != null ? Math.max(0.4, w.stress_score) : 1.0

                        // Check for meaningful pause (> 0.3 seconds)
                        const isSignificantPause = w.pause_after > 0.3
                        const isLongPause = w.pause_after > 0.8

                        return (
                          <React.Fragment key={w.word_index}>
                            <div className="word-inline-wrapper">
                              <div
                                onClick={(e) => handleTranscriptWordClick(w, e)}
                                className={`word-default-view ${w.stressed ? 'is-stressed' : ''} ${
                                  w.is_hesitation ? 'is-hesitation' : ''
                                } ${activeTooltipWord?.word_index === w.word_index ? 'expanded-word' : ''}`}
                              >
                                <ProsodyWord
                                  word={w.word}
                                  charPitches={w.char_pitches}
                                  stressed={w.stressed}
                                  isInspected={activeTooltipWord?.word_index === w.word_index}
                                  confidence={w.asr_confidence}
                                />
                                {w.stressed && (
                                  <span className="stress-dot" style={{ opacity: stressOpacity }} />
                                )}
                              </div>
                            </div>

                            {/* Render visual pause marker if present */}
                            {isSignificantPause && (
                              <span
                                className={`word-pause-spacer ${isLongPause ? 'long-pause' : ''}`}
                                title={`Pause: ${w.pause_after.toFixed(2)}s`}
                              />
                            )}

                            {/* Expandable inline card */}
                            <AnimatePresence>
                              {isExpanded && (
                                <motion.div
                                  initial={{ height: 0, opacity: 0, scaleY: 0.95 }}
                                  animate={{ height: 'auto', opacity: 1, scaleY: 1 }}
                                  exit={{ height: 0, opacity: 0, scaleY: 0.95 }}
                                  transition={{ type: 'spring', duration: 0.3, bounce: 0 }}
                                  className="word-detail-drawer"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <div className="word-detail-card-content">
                                    {renderWordDetailGrid(w)}
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </React.Fragment>
                        )
                      })
                    )}
                  </div>
                ) : (
                  // Mode B: Table List View
                  <div className="phrase-table-container">
                    <table className="phrase-data-table" style={{ tableLayout: 'fixed', width: '100%' }}>
                      <thead>
                        <tr>
                          <th style={{ width: '8%', textAlign: 'left' }}>#</th>
                          <th style={{ width: '22%', textAlign: 'left' }}>Word</th>
                          <th style={{ width: '25%', textAlign: 'left' }}>Time Range</th>
                          <th style={{ width: '15%', textAlign: 'left' }}>Confidence</th>
                          <th style={{ width: '15%', textAlign: 'left' }}>Stressed</th>
                          <th style={{ width: '15%', textAlign: 'left' }}>Pause After</th>
                        </tr>
                      </thead>
                      <tbody>
                        {phraseWords.length === 0 ? (
                          <tr>
                            <td colSpan={6} style={{ color: 'var(--text-faded)', fontStyle: 'italic', textAlign: 'center' }}>
                              No words processed in this phrase
                            </td>
                          </tr>
                        ) : (
                          phraseWords.map((w) => {
                            const isExpanded = expandedWordIndex === w.word_index

                            return (
                              <React.Fragment key={w.word_index}>
                                <tr
                                  className={`clickable-row ${isExpanded ? 'row-expanded' : ''}`}
                                  onClick={(e) => handleWordClick(w.word_index, e)}
                                >
                                  <td style={{ textAlign: 'left' }}>{w.word_index}</td>
                                  <td style={{ textAlign: 'left', ...(w.stressed ? { color: 'var(--accent)', fontWeight: 600, textTransform: 'uppercase' } : {}) }}>
                                    {w.word}
                                  </td>
                                  <td style={{ textAlign: 'left', fontFamily: 'monospace' }}>
                                    {w.start_time.toFixed(3)}s – {w.end_time.toFixed(3)}s
                                  </td>
                                  <td style={{ textAlign: 'left' }}>{Math.round((w.asr_confidence || 0) * 100)}%</td>
                                  <td style={{ textAlign: 'left' }}>
                                    {w.stressed ? 'YES' : 'NO'}
                                  </td>
                                  <td style={{ textAlign: 'left', fontFamily: 'monospace' }}>
                                    {w.pause_after ? `${w.pause_after.toFixed(2)}s` : '0.00s'}
                                  </td>
                                </tr>
                                {isExpanded && (
                                  <tr onClick={(e) => e.stopPropagation()}>
                                    <td colSpan={6} style={{ padding: '0.8rem 1.2rem', backgroundColor: 'rgba(22, 21, 20, 0.25)', borderBottom: '1px solid var(--overlay-border)' }}>
                                      <motion.div
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: 'auto', opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        transition={{ type: 'spring', duration: 0.3, bounce: 0 }}
                                        style={{ overflow: 'hidden' }}
                                      >
                                        <div style={{ padding: '0.4rem 0' }}>
                                          {renderWordDetailGrid(w)}
                                        </div>
                                      </motion.div>
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            )
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )
          })
        )}

        {viewMode === 'transcript' && data.voiced_segments && data.voiced_segments.length > 0 && (
          <section className="voiced-segments-section">
            <div style={{ marginTop: '2.5rem', borderTop: '1px solid rgba(255, 255, 255, 0.08)', paddingTop: '2rem' }}>
              <h2 style={{ fontSize: '1.05rem', fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-primary)', marginBottom: '0.4rem', fontFamily: 'var(--font-primary)' }}>
                Voiced Segments Stylization
              </h2>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '1.2rem', lineHeight: 1.5 }}>
                Contiguous voiced regions extracted globally from SWIPE pitch tracking, stylized with first-order polynomial (P=1) MAE criterion. Click on a segment to visualize its stylized pitch contour.
              </p>
              
              <table className="voiced-segments-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.06)', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '0.6rem 0.8rem', textAlign: 'left', fontWeight: 500 }}>Segment</th>
                    <th style={{ padding: '0.6rem 0.8rem', textAlign: 'left', fontWeight: 500 }}>Time Range</th>
                    <th style={{ padding: '0.6rem 0.8rem', textAlign: 'left', fontWeight: 500 }}>Frames</th>
                    <th style={{ padding: '0.6rem 0.8rem', textAlign: 'left', fontWeight: 500 }}>Complexity (K)</th>
                    <th style={{ padding: '0.6rem 0.8rem', textAlign: 'right', fontWeight: 500 }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {data.voiced_segments.map((seg) => {
                    const isExpanded = expandedSegmentIndex === seg.segment_index
                    return (
                      <React.Fragment key={seg.segment_index}>
                        <tr 
                          className={`clickable-row ${isExpanded ? 'row-expanded' : ''}`}
                          onClick={() => setExpandedSegmentIndex(isExpanded ? null : seg.segment_index)}
                          style={{
                            borderBottom: '1px solid rgba(255, 255, 255, 0.03)',
                            cursor: 'pointer',
                            transition: 'background-color 0.2s',
                          }}
                        >
                          <td style={{ padding: '0.8rem', fontWeight: 500 }}>Voiced Segment {seg.segment_index}</td>
                          <td style={{ padding: '0.8rem', fontFamily: 'monospace', color: 'var(--text-muted)' }}>{seg.start_time.toFixed(2)}s – {seg.end_time.toFixed(2)}s</td>
                          <td style={{ padding: '0.8rem', color: 'var(--text-muted)' }}>{seg.frame_count} frames</td>
                          <td style={{ padding: '0.8rem', fontFamily: 'monospace' }}>K = {seg.k_value}</td>
                          <td style={{ padding: '0.8rem', textAlign: 'right', color: 'var(--accent)', fontWeight: 600 }}>
                            {isExpanded ? 'CLOSE GRAPH' : 'VIEW GRAPH'}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr onClick={(e) => e.stopPropagation()}>
                            <td colSpan={5} style={{ padding: '0.4rem 0.8rem 1.2rem 0.8rem', borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}>
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ type: 'spring', duration: 0.3, bounce: 0 }}
                                style={{ overflow: 'hidden' }}
                              >
                                {renderSegmentContourGraph(seg)}
                              </motion.div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>

      <AnimatePresence>
        {activeTooltipWord && (
          <WordTooltip
            wordData={activeTooltipWord}
            phraseIntonation={phrases.find((p) => p.phrase_index === activeTooltipWord.phrase_index)?.intonation}
            wordRef={activeTooltipRef}
            onClose={() => {
              setActiveTooltipWord(null)
              setActiveTooltipRef(null)
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
