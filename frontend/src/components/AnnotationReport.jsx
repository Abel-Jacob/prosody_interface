import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import './AnnotationReport.css'

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

  const handleWordClick = (wordIndex, e) => {
    e.stopPropagation()
    setExpandedWordIndex((prev) => (prev === wordIndex ? null : wordIndex))
  }

  const handlePageClick = () => {
    setExpandedWordIndex(null)
  }

  // Complete structured grid of all properties from the JSON file
  const renderWordDetailGrid = (w) => {
    const hasIntonation = w.intonation != null
    return (
      <div className="detail-grid-container" style={!hasIntonation ? { gridTemplateColumns: '1fr' } : {}}>
        {/* Left Column: Word Properties */}
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
            </tbody>
          </table>
        </div>

        {/* Right Column: Intonation Properties */}
        {hasIntonation && (
          <div>
            <div className="detail-section-title">Intonation Properties</div>
            <table className="property-details-table">
              <tbody>
                <tr>
                  <td className="prop-key">mean_pitch</td>
                  <td className="prop-val">{w.intonation.mean_pitch?.toFixed(1)} Hz</td>
                </tr>
                <tr>
                  <td className="prop-key">pitch_trend</td>
                  <td className="prop-val">"{w.intonation.pitch_trend}"</td>
                </tr>
                <tr>
                  <td className="prop-key">pitch_range</td>
                  <td className="prop-val">{w.intonation.pitch_range?.toFixed(1)} Hz</td>
                </tr>
                <tr>
                  <td className="prop-key">normalized_pitch</td>
                  <td className="prop-val">
                    {w.intonation.normalized_pitch !== undefined && w.intonation.normalized_pitch !== null
                      ? w.intonation.normalized_pitch.toFixed(3)
                      : 'null'}
                  </td>
                </tr>
                <tr>
                  <td className="prop-key">start_pitch</td>
                  <td className="prop-val">{w.intonation.start_pitch?.toFixed(1)} Hz</td>
                </tr>
                <tr>
                  <td className="prop-key">end_pitch</td>
                  <td className="prop-val">{w.intonation.end_pitch?.toFixed(1)} Hz</td>
                </tr>
                <tr>
                  <td className="prop-key">voiced_segment_index</td>
                  <td className="prop-val">
                    {w.intonation.voiced_segment_index !== undefined && w.intonation.voiced_segment_index !== null
                      ? w.intonation.voiced_segment_index
                      : 'null'}
                  </td>
                </tr>
              </tbody>
            </table>
            <div className="detail-sparkline-container" style={{ padding: '0 0.5rem' }}>
              <div className="sparkline-title">Pitch Contour</div>
              {renderSparkline(w.intonation.char_pitches)}
            </div>
          </div>
        )}
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
                  <span className="phrase-title">Phrase #{phrase.phrase_index + 1}</span>
                  <span className="phrase-time">
                    {phrase.start_time.toFixed(2)}s – {phrase.end_time.toFixed(2)}s
                  </span>
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
                        const hasIntonation = w.intonation != null
                        const stressOpacity = w.stress_score != null ? Math.max(0.4, w.stress_score) : 1.0

                        // Check for meaningful pause (> 0.3 seconds)
                        const isSignificantPause = w.pause_after > 0.3
                        const isLongPause = w.pause_after > 0.8

                        return (
                          <React.Fragment key={w.word_index}>
                            <div className="word-inline-wrapper">
                              <div
                                onClick={(e) => handleWordClick(w.word_index, e)}
                                className={`word-default-view ${w.stressed ? 'is-stressed' : ''} ${
                                  w.is_hesitation ? 'is-hesitation' : ''
                                } ${isExpanded ? 'expanded-word' : ''}`}
                              >
                                <span className="word-text">{w.word}</span>
                                {w.stressed && (
                                  <span className="stress-dot" style={{ opacity: stressOpacity }} />
                                )}
                                {hasIntonation && w.intonation.pitch_trend && (
                                  <span className="pitch-trend-arrow">
                                    {TREND_ARROWS[w.intonation.pitch_trend] || w.intonation.pitch_trend}
                                  </span>
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
                          <th style={{ width: '15%', textAlign: 'left' }}>Pitch Trend</th>
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
                            const hasIntonation = w.intonation != null

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
                                    {hasIntonation && w.intonation.pitch_trend ? w.intonation.pitch_trend : 'unvoiced'}
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
      </main>
    </div>
  )
}
