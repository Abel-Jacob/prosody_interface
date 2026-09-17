import React, { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import './AnnotationReport.css'
import ProsodyWord from './ProsodyWord'
import SyllableBokeh from './SyllableBokeh'
import { getHttpUrl } from '../apiConfig'


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
  const [selectedBokehWord, setSelectedBokehWord] = useState(null)
  const [selectedFileIndex, setSelectedFileIndex] = useState(null)
  const [batchSearchQuery, setBatchSearchQuery] = useState('')
  const [batchFilterStatus, setBatchFilterStatus] = useState('all')

  const handleTranscriptWordClick = (w, e) => {
    e.stopPropagation()
    setExpandedWordIndex(expandedWordIndex === w.word_index ? null : w.word_index)
  }

  const isBatch = Boolean(data && data.is_batch)
  const batchFiles = (isBatch && Array.isArray(data.files)) ? data.files : []
  const isBatchFileActive = isBatch && selectedFileIndex !== null && Boolean(batchFiles[selectedFileIndex])
  const activeBatchFile = isBatchFileActive ? batchFiles[selectedFileIndex] : null

  const filteredFiles = useMemo(() => {
    if (!batchFiles.length) return []
    return batchFiles.filter((file) => {
      if (batchFilterStatus !== 'all' && file.status !== batchFilterStatus) {
        return false
      }
      if (batchSearchQuery.trim()) {
        const query = batchSearchQuery.toLowerCase()
        const nameMatches = (file.filename || '').toLowerCase().includes(query)
        const transcriptMatches = (
          file.annotation?.full_transcription ||
          file.result?.phrases?.map((p) => p.text).join(' ') ||
          ''
        ).toLowerCase().includes(query)
        return nameMatches || transcriptMatches
      }
      return true
    })
  }, [batchFiles, batchSearchQuery, batchFilterStatus])

  // Resolve current active report
  const currentReport = useMemo(() => {
    if (!data) return null
    if (!isBatch) return data
    if (activeBatchFile) {
      if (activeBatchFile.annotation) {
        return { ...activeBatchFile.annotation, filename: activeBatchFile.filename }
      }
      if (activeBatchFile.result) {
        return {
          recording: {
            job_id: activeBatchFile.file_id,
            audio_duration_sec: activeBatchFile.duration,
          },
          summary: {
            word_count: activeBatchFile.word_count,
            wpm: activeBatchFile.result.wpm,
            stress_ratio: activeBatchFile.result.stress_ratio,
            phrase_count: activeBatchFile.result.phrases?.length || 0,
          },
          phrases: activeBatchFile.result.phrases || [],
          words: (activeBatchFile.result.phrases || []).flatMap((p) => p.words || []),
          voiced_segments: activeBatchFile.result.voiced_segments || [],
          filename: activeBatchFile.filename,
        }
      }
    }
    return data
  }, [data, isBatch, activeBatchFile])

  // Batch Export Handlers
  const handleDownloadBatchJSON = () => {
    const jsonStr = JSON.stringify(data, null, 2)
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `batch_${data.job_id || 'manifest'}_all_annotations.json`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const handleDownloadBatchTXT = () => {
    const lines = []
    lines.push(`BATCH ANNOTATION TRANSCRIPTS — JOB ${data.job_id || 'EXPORT'}`)
    lines.push(`Total Files: ${batchFiles.length} | Completed: ${data.completed_files || 0} | Total Words: ${data.total_words || 0}`)
    lines.push('='.repeat(80) + '\n')

    batchFiles.forEach((f, idx) => {
      lines.push(`FILE [${idx + 1}/${batchFiles.length}]: ${f.filename}`)
      lines.push(`Status: ${f.status} | Duration: ${(f.duration || 0).toFixed(2)}s | Words: ${f.word_count || 0}`)
      lines.push('-'.repeat(40))

      if (f.status === 'error') {
        lines.push(`[ERROR: ${f.error || 'Unknown error'}]`)
      } else {
        const fullTxt = f.annotation?.full_transcription ||
          f.result?.phrases?.map((p) => p.text).join(' ') ||
          '[No speech detected]'
        lines.push(fullTxt)
      }
      lines.push('\n' + '='.repeat(80) + '\n')
    })

    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `batch_${data.job_id || 'export'}_all_transcripts.txt`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const handleDownloadBatchZIP = () => {
    const jId = data.job_id || (batchFiles[0]?.file_id ? batchFiles[0].file_id.split('_')[0] : null)
    if (jId) {
      const exportUrl = getHttpUrl(`/api/jobs/${jId}/export/batch-zip`)
      const link = document.createElement('a')
      link.href = exportUrl
      link.download = `batch_${jId}_all_reports.zip`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    } else {
      alert('Job ID not found for batch export')
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

  // If viewing batch overview
  if (isBatch && selectedFileIndex === null) {
    const totalFiles = data.total_files || batchFiles.length
    const completedFiles = data.completed_files ?? batchFiles.filter((f) => f.status === 'complete').length
    const failedFiles = data.failed_files ?? batchFiles.filter((f) => f.status === 'error').length
    const totalDurationSec = data.total_duration ?? batchFiles.reduce((acc, f) => acc + (f.duration || 0), 0)
    const totalWordsCount = data.total_words ?? batchFiles.reduce((acc, f) => acc + (f.word_count || 0), 0)

    const formatDuration = (secs) => {
      const m = Math.floor(secs / 60)
      const s = Math.round(secs % 60)
      return m > 0 ? `${m}m ${s}s` : `${secs.toFixed(1)}s`
    }

    return (
      <div className="annotation-report-container">
        <div className="batch-overview-container">
          {/* Header */}
          <header className="report-header" style={{ marginBottom: '0.8rem' }}>
            <div className="header-title-section">
              <div className="page-path" style={{ position: 'static', marginBottom: '0.2rem' }}>
                PROSODY / BATCH ANNOTATION
              </div>
              <h1 style={{ fontFamily: 'var(--font-primary)', fontSize: '1.25rem', fontWeight: 600 }}>
                Batch Annotation Report
              </h1>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {data.batch_name || 'Batch Session'} • {completedFiles} of {totalFiles} files processed successfully
              </div>
            </div>

            <div className="header-controls">
              <button
                className="control-btn"
                onClick={onBack}
                style={{ borderColor: 'var(--text-faded)' }}
              >
                ← Back to Recorder
              </button>
            </div>
          </header>

          {/* Hero stats grid */}
          <div className="batch-hero-stats">
            <div className="batch-stat-card">
              <span className="batch-stat-label">Total Files</span>
              <span className="batch-stat-val">{totalFiles}</span>
            </div>
            <div className="batch-stat-card">
              <span className="batch-stat-label">Completed</span>
              <span className="batch-stat-val success">{completedFiles}</span>
            </div>
            <div className="batch-stat-card">
              <span className="batch-stat-label">Errors</span>
              <span className={`batch-stat-val ${failedFiles > 0 ? 'error' : ''}`}>{failedFiles}</span>
            </div>
            <div className="batch-stat-card">
              <span className="batch-stat-label">Total Duration</span>
              <span className="batch-stat-val accent">{formatDuration(totalDurationSec)}</span>
            </div>
            <div className="batch-stat-card">
              <span className="batch-stat-label">Total Words</span>
              <span className="batch-stat-val accent">{totalWordsCount.toLocaleString()}</span>
            </div>
          </div>

          {/* One-click Combined Downloads Action Bar */}
          <div className="batch-actions-bar">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
                Batch Exports:
              </span>
              <div className="batch-download-group">
                <button
                  type="button"
                  className="batch-action-btn"
                  onClick={handleDownloadBatchJSON}
                  title="Download all file annotations in a single combined JSON"
                >
                  📥 Combined JSON
                </button>
                <button
                  type="button"
                  className="batch-action-btn"
                  onClick={handleDownloadBatchTXT}
                  title="Download all transcripts in a single text file"
                >
                  📄 Combined Transcripts (TXT)
                </button>
                <button
                  type="button"
                  className="batch-action-btn"
                  onClick={handleDownloadBatchZIP}
                  title="Download ZIP archive of individual JSONs and TXTs"
                >
                  📦 All Reports (ZIP)
                </button>
              </div>
            </div>

            <span style={{ fontSize: '0.72rem', color: 'var(--text-faded)' }}>
              Click any file below to inspect sentence prosody & syllables
            </span>
          </div>

          {/* Search & Filter Bar */}
          <div className="batch-filter-bar">
            <div className="batch-search-wrapper">
              <input
                type="text"
                className="batch-search-input"
                placeholder="Search by filename or speech transcript content..."
                value={batchSearchQuery}
                onChange={(e) => setBatchSearchQuery(e.target.value)}
              />
            </div>
            <div className="batch-filter-tabs">
              <button
                type="button"
                className={`batch-filter-tab ${batchFilterStatus === 'all' ? 'active' : ''}`}
                onClick={() => setBatchFilterStatus('all')}
              >
                All ({batchFiles.length})
              </button>
              <button
                type="button"
                className={`batch-filter-tab ${batchFilterStatus === 'complete' ? 'active' : ''}`}
                onClick={() => setBatchFilterStatus('complete')}
              >
                Completed ({completedFiles})
              </button>
              {failedFiles > 0 && (
                <button
                  type="button"
                  className={`batch-filter-tab ${batchFilterStatus === 'error' ? 'active' : ''}`}
                  onClick={() => setBatchFilterStatus('error')}
                >
                  Failed ({failedFiles})
                </button>
              )}
            </div>
          </div>

          {/* File Cards Scroll Area */}
          <div className="batch-file-list-scroll">
            {filteredFiles.length === 0 ? (
              <div className="empty-state" style={{ padding: '3rem 1rem' }}>
                <h3>No Files Match Your Filter</h3>
                <p>Try adjusting your search query or filter tab.</p>
              </div>
            ) : (
              filteredFiles.map((f) => {
                const originalIndex = batchFiles.indexOf(f)
                const isError = f.status === 'error'
                const fullText = f.annotation?.full_transcription ||
                  f.result?.phrases?.map((p) => p.text).join(' ') ||
                  (isError ? `Error: ${f.error || 'Failed to process audio'}` : 'No speech detected')

                return (
                  <div
                    key={f.file_id || originalIndex}
                    className={`batch-file-card ${isError ? 'is-error' : ''}`}
                    onClick={() => {
                      if (!isError) {
                        setSelectedFileIndex(originalIndex)
                      }
                    }}
                  >
                    <div className="batch-file-header">
                      <div className="batch-file-title-left">
                        <span className={`batch-status-dot ${isError ? 'error' : ''}`} />
                        <span className="batch-file-name">{f.filename}</span>
                      </div>
                      <div className="batch-file-meta-badges">
                        <span className="batch-meta-badge">
                          {(f.duration || 0).toFixed(1)}s
                        </span>
                        {!isError && (
                          <>
                            <span className="batch-meta-badge">
                              {f.sentence_count || f.result?.phrases?.length || 0} sent
                            </span>
                            <span className="batch-meta-badge">
                              {f.word_count || 0} words
                            </span>
                          </>
                        )}
                        {isError && (
                          <span className="batch-meta-badge" style={{ color: '#f87171', borderColor: 'rgba(248, 113, 113, 0.3)' }}>
                            FAILED
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="batch-file-snippet">
                      "{fullText}"
                    </div>

                    {!isError && (
                      <div className="batch-file-action-row">
                        <span className="batch-inspect-link">
                          View Full Annotation →
                        </span>
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>
    )
  }

  const { recording, models, summary, phrases = [], words = [], errors = [] } = currentReport || {}

  // CSV Export Handler
  const handleDownloadCSV = () => {
    if (!words || words.length === 0) return

    const fullTranscription = phrases.map((p) => p.text).join(' ')

    // Section 1: Full Transcription
    const section1 = [
      '# ======================================================== #',
      '# SECTION 1: FULL TRANSCRIPTION                            #',
      '# ======================================================== #',
      `"${fullTranscription.replace(/"/g, '""')}"`,
      ''
    ]

    // Section 2: Phrase Level Intonation
    const phraseHeaders = [
      'phrase_index',
      'start_time',
      'end_time',
      'phrase_pitch_trend',
      'phrase_mean_pitch',
      'phrase_pitch_slope',
      'phrase_pitch_range',
      'text'
    ]
    const phraseRows = phrases.map((p) => {
      const pInton = p.intonation
      return [
        p.phrase_index,
        p.start_time.toFixed(3),
        p.end_time.toFixed(3),
        pInton?.pitch_trend || '',
        pInton?.mean_pitch !== undefined && pInton?.mean_pitch !== null ? pInton.mean_pitch.toFixed(1) : '',
        pInton?.pitch_slope !== undefined && pInton?.pitch_slope !== null ? pInton.pitch_slope.toFixed(2) : '',
        pInton?.pitch_range !== undefined && pInton?.pitch_range !== null ? pInton.pitch_range.toFixed(1) : '',
        `"${p.text.replace(/"/g, '""')}"`
      ].join(',')
    })

    const section2 = [
      '# ======================================================== #',
      '# SECTION 2: PHRASE LEVEL INTONATION                       #',
      '# ======================================================== #',
      phraseHeaders.join(','),
      ...phraseRows,
      ''
    ]

    // Section 3: Word Level Timestamps, Stress, and Pauses
    const wordHeaders = [
      'word',
      'start_time',
      'end_time',
      'stressed',
      'stress_score_pct',
      'word_index',
      'phrase_index',
      'asr_confidence_pct',
      'is_hesitation',
      'syllables_breakdown',
      'stressed_syllable',
      'lexirep_margin'
    ]
    const wordRows = []
    words.forEach((w) => {
      const syls = Array.isArray(w.syllables) ? w.syllables : null
      const isPoly = syls && syls.length > 1
      const stressedSyl = isPoly ? syls.find((s) => s.stressed) : null
      const sylBreakdown = isPoly
        ? syls.map((s) => (s.stressed ? s.text.toUpperCase() : s.text)).join('·')
        : ''
      const stressedSylText = stressedSyl ? stressedSyl.text : ''
      const lexirepMargin = stressedSyl && stressedSyl.stress_margin !== undefined && stressedSyl.stress_margin !== null
        ? Number(stressedSyl.stress_margin).toFixed(4)
        : ''

      // 1. Add the word itself
      wordRows.push([
        `"${w.word.replace(/"/g, '""')}"`, // transcription
        w.start_time.toFixed(3),           // timestamps (onset)
        w.end_time.toFixed(3),             // timestamps (offset)
        w.stressed ? 'TRUE' : 'FALSE',     // stress labels (stressed)
        `${Math.round((w.stress_score || 0.0) * 100)}%`, // stress score in %
        w.word_index,                      // word_index
        w.phrase_index,                    // phrase_index
        `${Math.round((w.asr_confidence || 1.0) * 100)}%`, // ASR confidence in %
        w.is_hesitation ? 'TRUE' : 'FALSE', // is_hesitation
        sylBreakdown ? `"${sylBreakdown}"` : '',
        stressedSylText ? `"${stressedSylText}"` : '',
        lexirepMargin
      ].join(','))

      // 2. If a pause exists immediately following, add it as a separate [PAUSE] row
      if (w.pause_after && w.pause_after > 0.5) {
        wordRows.push([
          '"[PAUSE]"',                      // transcription
          `${w.pause_after.toFixed(2)}s`,   // duration (e.g. 0.80s)
          '',                               // stressed (empty)
          '',                               // stress_score_pct (empty)
          '',                               // word_index (empty)
          '',                               // phrase_index (empty)
          '',                               // asr_confidence_pct (empty)
          '',                               // is_hesitation (empty)
          '',                               // syllables_breakdown (empty)
          '',                               // stressed_syllable (empty)
          ''                                // lexirep_margin (empty)
        ].join(','))
      }
    })

    const section3 = [
      '# ======================================================== #',
      '# SECTION 3: WORD LEVEL TIMESTAMPS, STRESS & PAUSES        #',
      '# ======================================================== #',
      wordHeaders.join(','),
      ...wordRows,
      ''
    ]

    // Section 4: Syllable Level Lexical Stress (LexiRep)
    const syllableHeaders = [
      'word_index',
      'word',
      'start_time',
      'end_time',
      'syllable_index',
      'syllable_text',
      'is_primary_stress',
      'stress_margin',
      'fused_margin',
      'ensemble_margin',
      'ger_margin',
      'ita_margin'
    ]
    const syllableRows = []
    words.forEach((w) => {
      if (Array.isArray(w.syllables) && w.syllables.length > 0) {
        w.syllables.forEach((syl, sylIdx) => {
          const m = syl.models || {}
          syllableRows.push([
            w.word_index,
            `"${w.word.replace(/"/g, '""')}"`,
            w.start_time.toFixed(3),
            w.end_time.toFixed(3),
            sylIdx + 1,
            `"${syl.text.replace(/"/g, '""')}"`,
            syl.stressed ? 'TRUE' : 'FALSE',
            syl.stress_margin !== undefined && syl.stress_margin !== null ? Number(syl.stress_margin).toFixed(4) : '',
            m.fused?.margin !== undefined ? Number(m.fused.margin).toFixed(4) : '',
            m.ensemble?.margin !== undefined ? Number(m.ensemble.margin).toFixed(4) : '',
            m.ger?.margin !== undefined ? Number(m.ger.margin).toFixed(4) : '',
            m.ita?.margin !== undefined ? Number(m.ita.margin).toFixed(4) : ''
          ].join(','))
        })
      }
    })

    const section4 = [
      '# ======================================================== #',
      '# SECTION 4: SYLLABLE LEVEL LEXICAL STRESS (LEXIREP)       #',
      '# ======================================================== #',
      syllableHeaders.join(','),
      ...syllableRows
    ]

    const csvContent = [
      ...section1,
      ...section2,
      ...section3,
      ...section4
    ].join('\n')

    const fileStem = currentReport?.filename ? currentReport.filename.replace(/\.[^/.]+$/, "") : (recording?.job_id || 'export')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', `annotation_${fileStem}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // JSON Export Handler
  const handleDownloadJSON = () => {
    const fileStem = currentReport?.filename ? currentReport.filename.replace(/\.[^/.]+$/, "") : (recording?.job_id || 'export')
    // Construct inline pauses in JSON words list
    const jsonWords = []
    words.forEach((w) => {
      const syls = Array.isArray(w.syllables) ? w.syllables : null
      const isPoly = syls && syls.length > 1
      const stressedSyl = isPoly ? syls.find((s) => s.stressed) : null

      jsonWords.push({
        word: w.word,
        start_time: w.start_time,
        end_time: w.end_time,
        stressed: w.stressed,
        stress_score_pct: `${Math.round((w.stress_score || 0.0) * 100)}%`,
        word_index: w.word_index,
        phrase_index: w.phrase_index,
        asr_confidence_pct: `${Math.round((w.asr_confidence || 1.0) * 100)}%`,
        is_hesitation: w.is_hesitation,
        // Syllable-level lexical stress metrics
        syllables: w.syllables || null,
        lexirep_primary_stressed_syllable: stressedSyl?.text || null,
        lexirep_stress_margin: stressedSyl && stressedSyl.stress_margin !== undefined ? stressedSyl.stress_margin : null
      })

      if (w.pause_after && w.pause_after > 0.5) {
        jsonWords.push({
          pause: `${w.pause_after.toFixed(2)}s`
        })
      }
    })

    // Polysyllabic lexical stress breakdown list
    const syllableStressData = words
      .filter((w) => Array.isArray(w.syllables) && w.syllables.length > 0)
      .map((w) => {
        const stressedSyl = w.syllables.find((s) => s.stressed)
        return {
          word_index: w.word_index,
          word: w.word,
          start_time: w.start_time,
          end_time: w.end_time,
          syllable_count: w.syllables.length,
          primary_stressed_syllable: stressedSyl?.text || null,
          stress_margin: stressedSyl?.stress_margin ?? null,
          syllables: w.syllables
        }
      })

    // Construct an ordered object to match the user's reading flow with section titles
    const orderedData = {
      annotation_version: data.annotation_version || '1.0',
      generated_at: data.generated_at,
      recording: data.recording,
      models: {
        ...data.models,
        syllable_stress_model: data.models?.syllable_stress_model || 'lexirep',
        syllable_stress_backbone: data.models?.syllable_stress_backbone || 'facebook/wav2vec2-base'
      },
      summary: {
        ...data.summary,
        polysyllabic_words_count: data.summary?.polysyllabic_words_count ?? syllableStressData.length
      },
      // 1. Full Transcription
      full_transcription: phrases.map((p) => p.text).join(' '),
      // 2. Phrase Level Intonation
      phrase_level_intonation: phrases.map((p) => ({
        phrase_index: p.phrase_index,
        text: p.text,
        start_time: p.start_time,
        end_time: p.end_time,
        intonation: p.intonation
      })),
      // 3. Word Level Timestamps, Stress, and Pauses
      word_level_timestamps_and_stress: jsonWords,
      // 4. Syllable Level Lexical Stress (LexiRep)
      syllable_level_lexical_stress: syllableStressData,
      voiced_segments: data.voiced_segments || [],
      errors: data.errors || []
    }

    const blob = new Blob([JSON.stringify(orderedData, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', `annotation_${fileStem}.json`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // TXT Export Handler (individual file)
  const handleDownloadTXT = () => {
    if (!phrases || phrases.length === 0) return
    const fileStem = currentReport?.filename ? currentReport.filename.replace(/\.[^/.]+$/, "") : (recording?.job_id || 'export')
    const fullText = phrases.map((p) => p.text).join(' ')
    const lines = []
    lines.push(`TRANSCRIPTION REPORT — ${currentReport?.filename || fileStem}`)
    lines.push(`Duration: ${(recording?.audio_duration_sec || 0).toFixed(2)}s | Words: ${words.length} | WPM: ${Math.round(summary?.wpm || 0)}`)
    lines.push('='.repeat(70) + '\n')
    lines.push('FULL TRANSCRIPTION:')
    lines.push(fullText || '[No speech detected]')
    lines.push('\n' + '='.repeat(70) + '\n')
    lines.push('SENTENCE BREAKDOWN:')
    phrases.forEach((p, idx) => {
      lines.push(`[Sentence ${idx + 1}] (${p.start_time.toFixed(2)}s – ${p.end_time.toFixed(2)}s)`)
      lines.push(`Text: ${p.text}`)
      if (p.intonation) {
        lines.push(`Pitch Trend: ${p.intonation.pitch_trend || 'N/A'} | Mean Pitch: ${p.intonation.mean_pitch != null ? p.intonation.mean_pitch.toFixed(1) + ' Hz' : 'N/A'}`)
      }
      lines.push('')
    })

    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${fileStem}_transcript.txt`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
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

  // Complete structured grid of all properties including LexiRep syllable stress
  const renderWordDetailGrid = (w) => {
    const syllables = Array.isArray(w.syllables) ? w.syllables : null
    const isPolysyllabic = syllables && syllables.length > 1
    const stressedSyl = isPolysyllabic ? syllables.find((s) => s.stressed) : null

    return (
      <div className={`detail-grid-container ${isPolysyllabic ? 'has-syllables' : ''}`}>
        <div>
          <div className="detail-section-title">Word & Acoustic Properties</div>
          <table className="property-details-table">
            <tbody>
              {/* 1. Transcription */}
              <tr>
                <td className="prop-key">word</td>
                <td className="prop-val">"{w.word}"</td>
              </tr>
              {/* 2. Word level timestamps */}
              <tr>
                <td className="prop-key">start_time</td>
                <td className="prop-val">{w.start_time.toFixed(3)}s</td>
              </tr>
              <tr>
                <td className="prop-key">end_time</td>
                <td className="prop-val">{w.end_time.toFixed(3)}s</td>
              </tr>
              <tr>
                <td className="prop-key">duration</td>
                <td className="prop-val">{Math.max(0, (w.end_time - w.start_time)).toFixed(3)}s</td>
              </tr>
              <tr>
                <td className="prop-key">asr_confidence</td>
                <td className="prop-val">
                  {w.asr_confidence !== undefined ? `${Math.round(w.asr_confidence * 100)}%` : 'null'}
                </td>
              </tr>
              {/* 3. Stress labels */}
              <tr>
                <td className="prop-key">sentence_prominence (WhiStress)</td>
                <td className="prop-val" style={{ color: w.stressed ? 'var(--accent)' : 'inherit', fontWeight: w.stressed ? 600 : 400 }}>
                  {w.stressed ? 'PROMINENT (TRUE)' : 'FALSE'}
                </td>
              </tr>
              {w.pause_after && w.pause_after > 0.05 ? (
                <tr>
                  <td className="prop-key">pause_after</td>
                  <td className="prop-val">{w.pause_after.toFixed(2)}s</td>
                </tr>
              ) : null}
              {w.is_hesitation ? (
                <tr>
                  <td className="prop-key">is_hesitation</td>
                  <td className="prop-val" style={{ color: 'var(--accent)' }}>TRUE</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div>
          <div className="detail-section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Syllable-Level Lexical Stress (LexiRep)</span>
            {isPolysyllabic && (
              <button
                type="button"
                className="syllable-bokeh-trigger-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  setSelectedBokehWord(w)
                }}
                title="Open interactive Syllable Bokeh view"
              >
                Inspect Bokeh ↗
              </button>
            )}
          </div>

          {isPolysyllabic ? (
            <div className="syllable-report-box">
              {/* Visual Syllable Chips Breakdown */}
              <div className="syllable-chips-row">
                {syllables.map((syl, idx) => (
                  <React.Fragment key={idx}>
                    {idx > 0 && <span className="syllable-chip-sep">·</span>}
                    <div
                      className={`syllable-chip ${syl.stressed ? 'is-stressed' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelectedBokehWord(w)
                      }}
                      style={{ cursor: 'pointer' }}
                      title={`Click to view Syllable Bokeh for "${w.word}" (${syl.text})`}
                    >
                      <span className="syllable-chip-text">{syl.text}</span>
                      {syl.stressed && <span className="syllable-chip-badge">PRIMARY</span>}
                    </div>
                  </React.Fragment>
                ))}
              </div>

              {/* Syllable metrics table */}
              <table className="syllable-metrics-table">
                <thead>
                  <tr>
                    <th>Syllable</th>
                    <th>Stress</th>
                    <th>Margin</th>
                    <th>Model Breakdown</th>
                  </tr>
                </thead>
                <tbody>
                  {syllables.map((syl, sIdx) => {
                    const models = syl.models || {}
                    const margin = syl.stress_margin
                    const marginStr = margin !== undefined && margin !== null
                      ? (margin > 0 ? `+${margin.toFixed(3)}` : margin.toFixed(3))
                      : '—'

                    return (
                      <tr
                        key={sIdx}
                        className={`clickable-syl-row ${syl.stressed ? 'syl-row-stressed' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelectedBokehWord(w)
                        }}
                        style={{ cursor: 'pointer' }}
                        title="Click to view syllable bokeh effect"
                      >
                        <td className="syl-col-text">
                          <strong>{syl.text}</strong>
                        </td>
                        <td>
                          {syl.stressed ? (
                            <span className="syl-badge-stressed">STRESSED</span>
                          ) : (
                            <span className="syl-badge-unstressed">UNSTRESSED</span>
                          )}
                        </td>
                        <td
                          className="syl-col-margin"
                          style={{
                            fontFamily: 'monospace',
                            color: syl.stressed ? 'var(--accent)' : 'var(--text-muted)'
                          }}
                        >
                          {marginStr}
                        </td>
                        <td className="syl-col-models">
                          <div className="syl-models-chips">
                            {models.fused && (
                              <span className="model-chip" title="Fused Model Margin">
                                fused: {models.fused.margin > 0 ? `+${models.fused.margin.toFixed(2)}` : models.fused.margin.toFixed(2)}
                              </span>
                            )}
                            {models.ensemble && (
                              <span className="model-chip" title="Dual-Model Ensemble (GER+ITA)">
                                ens: {models.ensemble.margin > 0 ? `+${models.ensemble.margin.toFixed(2)}` : models.ensemble.margin.toFixed(2)}
                              </span>
                            )}
                            {models.ger && (
                              <span className="model-chip" title="German Model Margin">
                                ger: {models.ger.margin > 0 ? `+${models.ger.margin.toFixed(2)}` : models.ger.margin.toFixed(2)}
                              </span>
                            )}
                            {models.ita && (
                              <span className="model-chip" title="Italian Model Margin">
                                ita: {models.ita.margin > 0 ? `+${models.ita.margin.toFixed(2)}` : models.ita.margin.toFixed(2)}
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="monosyllabic-note">
              <div className="monosyllabic-title">Monosyllabic Word</div>
              <p className="monosyllabic-desc">
                Single syllable word ("{w.word}") — lexical stress contrast is evaluated across polysyllabic words (≥2 syllables). Sentence-level acoustic prominence is evaluated by WhiStress ({w.stressed ? 'Prominent' : 'Unstressed'}).
              </p>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="annotation-report-container" onClick={handlePageClick}>
      {/* Background content layer — blurs into authentic optical bokeh when a syllable is inspected */}
      <div
        className="annotation-report-body"
        style={{
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0,
          filter: selectedBokehWord ? 'blur(18px) brightness(0.85) saturate(1.25)' : 'none',
          transform: selectedBokehWord ? 'scale(0.985)' : 'scale(1)',
          transition: 'filter 0.35s cubic-bezier(0.16, 1, 0.3, 1), transform 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
          pointerEvents: selectedBokehWord ? 'none' : 'auto',
          userSelect: selectedBokehWord ? 'none' : 'auto',
        }}
      >
        {/* If viewing a file from a batch, show sticky navigation banner */}
        {isBatchFileActive && (
          <div className="batch-file-nav-banner">
            <button
              type="button"
              className="batch-back-btn"
              onClick={() => setSelectedFileIndex(null)}
            >
              ← Back to File List
            </button>
            <div className="batch-file-nav-center">
              <span className="batch-file-nav-tag">
                FILE {selectedFileIndex + 1} OF {batchFiles.length}
              </span>
              <span className="batch-file-nav-name">{activeBatchFile?.filename}</span>
            </div>
            <div className="batch-file-nav-actions">
              <button
                type="button"
                className="batch-nav-arrow-btn"
                onClick={() => setSelectedFileIndex((prev) => Math.max(0, prev - 1))}
                disabled={selectedFileIndex === 0}
                title="Previous file"
              >
                ◀ Prev
              </button>
              <button
                type="button"
                className="batch-nav-arrow-btn"
                onClick={() => setSelectedFileIndex((prev) => Math.min(batchFiles.length - 1, prev + 1))}
                disabled={selectedFileIndex === batchFiles.length - 1}
                title="Next file"
              >
                Next ▶
              </button>
            </div>
          </div>
        )}

        {/* Header controls & stats */}
        <header className="report-header">
          <div className="header-title-section">
          <h1 style={{ fontFamily: "var(--font-primary)" }}>
            {isBatchFileActive ? activeBatchFile.filename : 'Annotation Report'}
          </h1>

          <div className="metadata-row">
            <span className="metadata-item">
              Duration: <strong>{recording?.audio_duration_sec?.toFixed(1) || 0}s</strong>
            </span>
            <span className="metadata-item">
              WPM: <strong>{Math.round(summary?.wpm || 0)}</strong>
            </span>
            <span className="metadata-item">
              Sentence Stress: <strong>{Math.round((summary?.stress_ratio || 0) * 100)}%</strong>
            </span>
            <span className="metadata-item">
              Phrases: <strong>{summary?.phrase_count || phrases.length}</strong>
            </span>
            {words.some((w) => Array.isArray(w.syllables) && w.syllables.length > 1) && (
              <span className="metadata-item">
                Polysyllabic Words: <strong>{words.filter((w) => Array.isArray(w.syllables) && w.syllables.length > 1).length}</strong>
              </span>
            )}
          </div>

          <div className="models-row">
            ASR: {models?.asr_final || 'N/A'} ({models?.asr_device || 'cpu'}) | VAD: {models?.vad_model || 'silero_vad'} | Sentence Stress: {models?.stress_model || 'whistress'} | Syllable Stress: {models?.syllable_stress_model ? models.syllable_stress_model.toUpperCase() : 'LEXIREP'} ({models?.syllable_stress_backbone || 'wav2vec2'})
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
          <button className="control-btn" onClick={handleDownloadTXT}>
            Download TXT
          </button>
          <button
            className="control-btn"
            onClick={isBatchFileActive ? () => setSelectedFileIndex(null) : onBack}
            style={{ borderColor: 'var(--text-faded)' }}
          >
            {isBatchFileActive ? '← Back to Files' : 'Back'}
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

        {phrases.length > 0 && (
          <section className="full-transcription-section" style={{
            background: 'rgba(22, 21, 20, 0.3)',
            border: '1px solid rgba(255, 255, 255, 0.03)',
            borderRadius: '6px',
            padding: '1.2rem',
            marginBottom: '0.5rem',
          }}>
            <h2 style={{
              fontSize: '0.75rem',
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--accent)',
              marginBottom: '0.6rem',
              fontFamily: 'var(--font-primary)',
            }}>
              Full Transcription
            </h2>
            <div style={{
              fontSize: '1.05rem',
              lineHeight: '1.65',
              color: 'var(--text-primary)',
              fontWeight: 400,
            }}>
              {phrases.map((p) => p.text).join(' ')}
            </div>
          </section>
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

                {phrase.intonation && (
                  <div className="phrase-intonation-details">
                    <div className="intonation-metric">
                      <span className="metric-label">Mean Pitch</span>
                      <span className="metric-val">{phrase.intonation.mean_pitch != null ? `${phrase.intonation.mean_pitch.toFixed(1)} Hz` : 'N/A'}</span>
                    </div>
                    <div className="intonation-metric">
                      <span className="metric-label">Pitch Range</span>
                      <span className="metric-val">{phrase.intonation.pitch_range != null ? `${phrase.intonation.pitch_range.toFixed(1)} Hz` : 'N/A'}</span>
                    </div>
                    <div className="intonation-metric">
                      <span className="metric-label">Trend</span>
                      <span className="metric-val">{phrase.intonation.pitch_trend ? `${TREND_ARROWS[phrase.intonation.pitch_trend] || phrase.intonation.pitch_trend}` : 'N/A'}</span>
                    </div>
                    <div className="intonation-metric">
                      <span className="metric-label">Slope</span>
                      <span className="metric-val">
                        {phrase.intonation.pitch_slope != null ? `${phrase.intonation.pitch_slope > 0 ? '+' : ''}${phrase.intonation.pitch_slope.toFixed(1)} Hz` : 'N/A'}
                      </span>
                    </div>
                    <div className="intonation-metric">
                      <span className="metric-label">Onset ➔ Offset</span>
                      <span className="metric-val">
                        {phrase.intonation.start_pitch != null ? `${Math.round(phrase.intonation.start_pitch)}Hz` : 'N/A'} ➔ {phrase.intonation.end_pitch != null ? `${Math.round(phrase.intonation.end_pitch)}Hz` : 'N/A'}
                      </span>
                    </div>
                    <div className="intonation-metric">
                      <span className="metric-label">Min ➔ Max</span>
                      <span className="metric-val">
                        {phrase.intonation.min_pitch != null ? `${Math.round(phrase.intonation.min_pitch)}Hz` : 'N/A'} – {phrase.intonation.max_pitch != null ? `${Math.round(phrase.intonation.max_pitch)}Hz` : 'N/A'}
                      </span>
                    </div>
                  </div>
                )}


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
                                className={`word-default-view ${w.stressed ? 'is-stressed' : ''} ${w.is_hesitation ? 'is-hesitation' : ''
                                  } ${isExpanded ? 'expanded-word' : ''}`}
                              >
                                <ProsodyWord
                                  word={w.word}
                                  charPitches={w.char_pitches}
                                  stressed={w.stressed}
                                  isInspected={isExpanded}
                                  confidence={w.asr_confidence}
                                />
                                {w.stressed && (
                                  <span className="stress-dot" style={{ opacity: stressOpacity }} />
                                )}
                              </div>
                              {w.syllables && w.syllables.length > 1 && (
                                <span
                                  className="word-syllable-tag"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setSelectedBokehWord(w)
                                  }}
                                  title={`Inspect syllable bokeh for "${w.word}"`}
                                >
                                  {w.syllables.map((s, idx) => (
                                    <React.Fragment key={idx}>
                                      {idx > 0 && <span className="tag-dot">·</span>}
                                      <span className={s.stressed ? 'tag-stressed' : ''}>
                                        {s.stressed ? s.text.toUpperCase() : s.text}
                                      </span>
                                    </React.Fragment>
                                  ))}
                                </span>
                              )}
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
                          <th style={{ width: '6%', textAlign: 'left' }}>#</th>
                          <th style={{ width: '34%', textAlign: 'left' }}>Word</th>
                          <th style={{ width: '26%', textAlign: 'left' }}>Time Range</th>
                          <th style={{ width: '14%', textAlign: 'left' }}>Confidence</th>
                          <th style={{ width: '20%', textAlign: 'left' }}>Stress (WhiStress / LexiRep)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {phraseWords.length === 0 ? (
                          <tr>
                            <td colSpan={5} style={{ color: 'var(--text-faded)', fontStyle: 'italic', textAlign: 'center' }}>
                              No words processed in this phrase
                            </td>
                          </tr>
                        ) : (
                          phraseWords.map((w) => {
                            const isExpanded = expandedWordIndex === w.word_index
                            const syllables = Array.isArray(w.syllables) ? w.syllables : null
                            const isPoly = syllables && syllables.length > 1
                            const stressedSyl = isPoly ? syllables.find((s) => s.stressed) : null

                            return (
                              <React.Fragment key={w.word_index}>
                                <tr
                                  className={`clickable-row ${isExpanded ? 'row-expanded' : ''}`}
                                  onClick={(e) => handleWordClick(w.word_index, e)}
                                >
                                  <td style={{ textAlign: 'left' }}>{w.word_index}</td>
                                  <td style={{ textAlign: 'left' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                      <span style={w.stressed ? { color: 'var(--accent)', fontWeight: 600, textTransform: 'uppercase' } : {}}>
                                        {w.word}
                                      </span>
                                      {isPoly && (
                                        <span
                                          className="table-syl-pill clickable-pill"
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            setSelectedBokehWord(w)
                                          }}
                                          title={`Click to view Syllable Bokeh for "${w.word}"`}
                                        >
                                          {syllables.map((s, idx) => (
                                            <React.Fragment key={idx}>
                                              {idx > 0 && <span className="syl-dot">·</span>}
                                              <span className={s.stressed ? 'syl-accent' : ''}>
                                                {s.stressed ? s.text.toUpperCase() : s.text}
                                              </span>
                                            </React.Fragment>
                                          ))}
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td style={{ textAlign: 'left', fontFamily: 'monospace' }}>
                                    {w.start_time.toFixed(3)}s – {w.end_time.toFixed(3)}s
                                  </td>
                                  <td style={{ textAlign: 'left' }}>{Math.round((w.asr_confidence || 0) * 100)}%</td>
                                  <td style={{ textAlign: 'left' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                      <span>{w.stressed ? 'YES' : 'NO'}</span>
                                      {isPoly && stressedSyl && (
                                        <span style={{ fontSize: '0.65rem', color: 'var(--accent)', fontFamily: 'monospace' }}>
                                          Syl: {stressedSyl.text.toUpperCase()} ({stressedSyl.stress_margin !== undefined && stressedSyl.stress_margin !== null ? (stressedSyl.stress_margin > 0 ? `+${stressedSyl.stress_margin.toFixed(2)}` : stressedSyl.stress_margin.toFixed(2)) : '—'})
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                                {isExpanded && (
                                  <tr onClick={(e) => e.stopPropagation()}>
                                    <td colSpan={5} style={{ padding: '0.8rem 1.2rem', backgroundColor: 'rgba(22, 21, 20, 0.25)', borderBottom: '1px solid var(--overlay-border)' }}>
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

        {/* Voiced segment complexity graph section (disabled for now) */}
        {false && viewMode === 'transcript' && data.voiced_segments && data.voiced_segments.length > 0 && (
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
    </div>

    {/* Interactive LexiRep Syllable Bokeh Modal */}
      <AnimatePresence>
        {selectedBokehWord && (
          <SyllableBokeh
            key="syllable-bokeh-modal"
            wordData={selectedBokehWord}
            onClose={() => setSelectedBokehWord(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
