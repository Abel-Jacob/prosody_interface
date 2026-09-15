import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import './SyllableBokeh.css'

const MODEL_OPTIONS = [
  { id: 'fused', label: 'Fused Model', desc: 'Cross-lingual combined L2 distribution (Recommended)' },
  { id: 'ensemble', label: 'Dual Ensemble', desc: 'Consensus average of German & Italian models' },
  { id: 'ger', label: 'German L2', desc: 'German learner acoustic specialist' },
  { id: 'ita', label: 'Italian L2', desc: 'Italian learner acoustic specialist' },
]

/**
 * SyllableBokeh — Full-screen immersive bokeh modal for syllable-level lexical stress.
 *
 * Features:
 * - Ambient floating bokeh light orbs & 20px frosted backdrop filter.
 * - Central card showing enlarged word and syllable breakdown.
 * - Interactive model selector toggle: [ Fused ] [ Dual Ensemble ] [ German L2 ] [ Italian L2 ].
 * - Dynamically updates the glowing orange stressed syllable per selected model.
 * - Consensus indicator: Shows whether German and Italian models agree or split.
 * - Displays both lexical stress and WhiStress utterance focal stress.
 * - Keyboard (Escape) or backdrop click dismisses.
 */
export default function SyllableBokeh({ wordData, onClose }) {
  const [activeModel, setActiveModel] = useState(() => {
    return localStorage.getItem('lexirep_active_model') || 'fused'
  })

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  if (!wordData) return null

  const handleSelectModel = (modelKey) => {
    setActiveModel(modelKey)
    localStorage.setItem('lexirep_active_model', modelKey)
  }

  // Word text cleaned of trailing punctuation for display
  const rawWord = wordData.word || ''
  const punctMatch = rawWord.match(/([.,!?;:"'-]+)$/)
  const punctuation = punctMatch ? punctMatch[1] : ''
  const cleanWord = punctuation ? rawWord.slice(0, -punctuation.length) : rawWord

  // Syllables from LexiRep
  const syllables = wordData.syllables || null
  const isPolysyllabic = Array.isArray(syllables) && syllables.length > 1

  // Helper functions for model-specific stress
  const getIsSylStressed = (syl) => {
    if (syl.models && syl.models[activeModel]) {
      return !!syl.models[activeModel].stressed
    }
    return !!syl.stressed
  }

  const getSylMargin = (syl) => {
    if (syl.models && syl.models[activeModel]) {
      return syl.models[activeModel].margin
    }
    return syl.stress_margin
  }

  // Active stressed syllable
  const activeStressedSyl = isPolysyllabic ? syllables.find(s => getIsSylStressed(s)) : null
  const activeMargin = activeStressedSyl ? getSylMargin(activeStressedSyl) : null

  // Consensus calculation between GER and ITA models
  const gerWinner = isPolysyllabic && syllables.find(s => s.models?.ger?.stressed)
  const itaWinner = isPolysyllabic && syllables.find(s => s.models?.ita?.stressed)
  const hasBothLearnerModels = !!(gerWinner && itaWinner)
  const isConsensus = hasBothLearnerModels && (gerWinner.text === itaWinner.text)

  // WhiStress sentence-level prominence
  const isWordStressed = !!wordData.stressed
  const stressScore = wordData.stress_score != null ? Math.round(wordData.stress_score * 100) : null

  // Prosody intonation metrics
  const inton = wordData.intonation || {}
  const meanPitch = inton.mean_pitch ?? wordData.pitch_mean
  const pitchTrend = inton.pitch_trend || (wordData.pitch_direction === 'rising' ? '↑' : wordData.pitch_direction === 'falling' ? '↓' : null)

  const startVal = wordData.start !== undefined ? wordData.start : wordData.start_time
  const endVal = wordData.end !== undefined ? wordData.end : wordData.end_time
  const durationMs = (startVal !== undefined && endVal !== undefined)
    ? Math.round((endVal - startVal) * 1000)
    : null

  const confPercent = wordData.confidence !== undefined ? Math.round(wordData.confidence * 100) : 100

  const activeModelOption = MODEL_OPTIONS.find(m => m.id === activeModel) || MODEL_OPTIONS[0]

  const modalContent = (
    <motion.div
      className="syllable-bokeh-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      onClick={onClose}
    >
      {/* Ambient bokeh light orbs */}
      <div className="bokeh-circle bokeh-circle-1" />
      <div className="bokeh-circle bokeh-circle-2" />
      <div className="bokeh-circle bokeh-circle-3" />

      {/* Center Bokeh Presentation Card */}
      <motion.div
        className="syllable-bokeh-card"
        initial={{ scale: 0.88, opacity: 0, y: 15 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: 10 }}
        transition={{ type: 'spring', duration: 0.35, bounce: 0.05 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Model Selector Bar (for polysyllabic words with multi-model data) */}
        {isPolysyllabic && (
          <div className="syllable-bokeh-model-bar">
            <span className="model-bar-label">LexiRep Model:</span>
            <div className="syllable-bokeh-model-selector">
              {MODEL_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={`syllable-bokeh-model-btn ${activeModel === opt.id ? 'active' : ''}`}
                  onClick={() => handleSelectModel(opt.id)}
                  title={opt.desc}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Word header label */}
        <div className="syllable-bokeh-word-title">
          {cleanWord} {punctuation && <span style={{ opacity: 0.5 }}>{punctuation}</span>}
        </div>

        {/* Syllables display */}
        <div className="syllable-bokeh-syllables">
          {isPolysyllabic ? (
            syllables.map((syl, idx) => {
              const isStressed = getIsSylStressed(syl)
              const margin = getSylMargin(syl)
              return (
                <React.Fragment key={idx}>
                  {idx > 0 && <span className="syllable-bokeh-sep">·</span>}
                  <span
                    className={`syllable-bokeh-syl ${isStressed ? 'stressed' : ''}`}
                    title={isStressed ? `Primary stress (margin: ${margin ?? 'N/A'})` : `Unstressed (margin: ${margin ?? 'N/A'})`}
                  >
                    {syl.text}
                  </span>
                </React.Fragment>
              )
            })
          ) : (
            /* Monosyllabic word display */
            <span className={`syllable-bokeh-syl ${isWordStressed ? 'stressed' : ''}`}>
              {cleanWord}
            </span>
          )}
        </div>

        {/* Consensus / Divergence Tag */}
        {hasBothLearnerModels && (
          <div className={`syllable-bokeh-consensus ${isConsensus ? 'agreed' : 'divergent'}`}>
            <span className="consensus-indicator" />
            {isConsensus ? (
              <span>GER &amp; ITA Models Agree: <strong>"{gerWinner.text.toUpperCase()}"</strong></span>
            ) : (
              <span>Model Split: GER prefers <strong>"{gerWinner.text}"</strong>, ITA prefers <strong>"{itaWinner.text}"</strong></span>
            )}
          </div>
        )}

        {/* Sub-label describing stress status */}
        <div className="syllable-bokeh-info">
          {isPolysyllabic ? (
            <span>
              {activeModelOption.label} primary stress on syllable:{' '}
              <strong style={{ color: 'var(--accent)', letterSpacing: '0.04em' }}>
                "{activeStressedSyl ? activeStressedSyl.text.toUpperCase() : 'N/A'}"
              </strong>
              {activeMargin != null && (
                <span style={{ opacity: 0.7, marginLeft: '6px' }}>
                  (margin: {activeMargin > 0 ? `+${activeMargin}` : activeMargin})
                </span>
              )}
            </span>
          ) : (
            <span>Monosyllabic word — single syllable (no intra-word stress contrast)</span>
          )}
        </div>

        {/* Badges: WhiStress Sentence Prominence + ASR score + Duration + Pitch */}
        <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
          <div className={`syllable-bokeh-badge ${isWordStressed ? 'emphasized' : 'neutral'}`}>
            <span>Utterance Prominence:</span>
            <strong>{isWordStressed ? 'STRESSED' : 'UNSTRESSED'}</strong>
            {stressScore != null && <span style={{ opacity: 0.7 }}>({stressScore}%)</span>}
          </div>

          <div className="syllable-bokeh-badge neutral">
            <span>ASR:</span>
            <strong>{confPercent}%</strong>
          </div>

          {durationMs != null && (
            <div className="syllable-bokeh-badge neutral">
              <span>Duration:</span>
              <strong>{durationMs} ms</strong>
            </div>
          )}

          {meanPitch != null && (
            <div className="syllable-bokeh-badge neutral">
              <span>Pitch:</span>
              <strong>{Math.round(meanPitch)} Hz</strong>
              {pitchTrend && (
                <span style={{
                  color: pitchTrend === '↑' ? '#4ade80' : pitchTrend === '↓' ? '#f87171' : '#94a3b8',
                  marginLeft: '2px',
                  fontWeight: 700
                }}>
                  {pitchTrend}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Dismiss hint */}
        <div className="syllable-bokeh-hint">
          Click anywhere or press Esc to return
        </div>
      </motion.div>
    </motion.div>
  )

  return createPortal(modalContent, document.body)
}
