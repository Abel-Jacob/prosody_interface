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
    try {
      return localStorage.getItem('lexirep_active_model') || 'fused'
    } catch {
      return 'fused'
    }
  })
  const [selectedSylIdx, setSelectedSylIdx] = useState(null)

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
    try {
      localStorage.setItem('lexirep_active_model', modelKey)
    } catch {
      // Ignore storage error
    }
  }

  // Word text cleaned of trailing punctuation for display
  const rawWord = String(wordData.word ?? '')
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

  // WhiStress sentence-level prominence (for monosyllabic word fallback)
  const isWordStressed = !!wordData.stressed

  const activeModelOption = MODEL_OPTIONS.find(m => m.id === activeModel) || MODEL_OPTIONS[0]

  const modalContent = (
    <motion.div
      className="syllable-bokeh-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
      onClick={onClose}
    >
      {/* Optical bokeh background light discs */}
      <div className="syllable-bokeh-orbs" aria-hidden="true">
        <div className="bokeh-orb bokeh-orb-1" />
        <div className="bokeh-orb bokeh-orb-2" />
        <div className="bokeh-orb bokeh-orb-3" />
        <div className="bokeh-orb bokeh-orb-4" />
      </div>

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
              const isSelected = selectedSylIdx === idx
              return (
                <React.Fragment key={idx}>
                  {idx > 0 && <span className="syllable-bokeh-sep">·</span>}
                  <span
                    className={`syllable-bokeh-syl ${isStressed ? 'stressed' : ''} ${isSelected ? 'focused' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelectedSylIdx(selectedSylIdx === idx ? null : idx)
                    }}
                    title={isStressed ? `Primary stress (margin: ${margin ?? 'N/A'}). Click to inspect.` : `Unstressed (margin: ${margin ?? 'N/A'}). Click to inspect.`}
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

        {/* Sub-label describing stress status */}
        <div className="syllable-bokeh-info">
          {isPolysyllabic ? (
            (() => {
              const currentSyl = selectedSylIdx !== null ? syllables[selectedSylIdx] : activeStressedSyl
              const isCurrStressed = currentSyl ? getIsSylStressed(currentSyl) : false
              const currMargin = currentSyl ? getSylMargin(currentSyl) : null

              return (
                <span>
                  {selectedSylIdx !== null ? (
                    <>
                      Syllable <strong style={{ color: '#ffffff' }}>"{currentSyl?.text?.toUpperCase()}"</strong>:{' '}
                      <span style={{ color: isCurrStressed ? 'var(--accent)' : 'var(--text-muted)', fontWeight: 600 }}>
                        {isCurrStressed ? 'PRIMARY STRESS' : 'UNSTRESSED'}
                      </span>
                      {currMargin != null && (
                        <span style={{ opacity: 0.75, marginLeft: '6px' }}>
                          (margin: {currMargin > 0 ? `+${currMargin}` : currMargin})
                        </span>
                      )}
                    </>
                  ) : (
                    <>
                      {activeModelOption.label} primary stress on syllable:{' '}
                      <strong style={{ color: '#ffffff', letterSpacing: '0.04em' }}>
                        "{activeStressedSyl ? activeStressedSyl.text.toUpperCase() : 'N/A'}"
                      </strong>
                      {activeMargin != null && (
                        <span style={{ opacity: 0.75, marginLeft: '6px' }}>
                          (margin: {activeMargin > 0 ? `+${activeMargin}` : activeMargin})
                        </span>
                      )}
                    </>
                  )}
                </span>
              )
            })()
          ) : (
            <span>Monosyllabic word — single syllable (no intra-word stress contrast)</span>
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
