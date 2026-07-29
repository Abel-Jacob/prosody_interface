import React, { useState, useRef, useMemo } from 'react'
import { motion } from 'framer-motion'
import WordTooltip from './WordTooltip'

/**
 * Pre-process a phrase's word list:
 * - Absorb hesitation words (um, uh, etc.) into the previous word's pause.
 *   The total pause = gap before filler + filler duration + gap after filler.
 * - Returns a new array with hesitation words removed.
 */
function preprocessWords(words) {
  const result = []
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    if (w.is_hesitation && result.length > 0) {
      // Merge this filler's entire span into the previous word's pause
      const prev = result[result.length - 1]
      const fillerDuration = (w.end || 0) - (w.start || 0)
      prev.pause_after = (prev.pause_after || 0) + fillerDuration + (w.pause_after || 0)
      continue // skip rendering this word
    }
    // Clone to avoid mutating original data
    result.push({ ...w })
  }
  return result
}

// Helper component to render each word and its ref
function TranscribedWord({ w, isLast, inspectedWord, setInspectedWord }) {
  const wordRef = useRef(null)
  
  // Feature 1: Confidence-Based Text Blur
  const conf = w.confidence !== undefined ? w.confidence : 1
  const opacity = conf < 0.95 ? Math.max(0.5, 0.4 + conf * 0.6) : 1
  const blurVal = conf < 0.85 ? Math.min(1.4, (0.85 - conf) * 4) : 0
  const filter = blurVal > 0.05 ? `blur(${blurVal.toFixed(2)}px)` : 'none'
  
  const isInspected = inspectedWord && inspectedWord.data.word === w.word && inspectedWord.data.start === w.start

  const appliedFilter = isInspected ? 'none' : filter
  const appliedOpacity = isInspected ? 1 : opacity

  const baseStyle = {
    filter: appliedFilter,
    opacity: appliedOpacity,
    cursor: 'pointer',
    display: 'inline-block',
    marginRight: isLast ? '0' : '0.25rem',
    textDecoration: isInspected ? 'underline' : 'none',
    transition: 'filter 0.2s, opacity 0.2s'
  }

  const stressedStyle = w.stressed ? {
    fontWeight: 600,
    color: 'var(--accent)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    textShadow: '0 0 12px var(--accent-dim)'
  } : {}

  const handleClick = (e) => {
    e.stopPropagation()
    setInspectedWord({ data: w, ref: wordRef })
  }

  // Determine pause visualization
  const pauseVal = w.pause_after || 0
  // Commas for micro pauses (0.2–0.5s), breathing dots for longer pauses
  const dotCount = isLast ? 0
    : pauseVal > 1.0 ? 3
    : pauseVal > 0.5 ? 2
    : 0
  const showComma = dotCount === 0 && pauseVal >= 0.2 && pauseVal <= 0.5 && !isLast

  const wordText = w.word
  const alreadyHasPunct = /[.,!?;:]$/.test(wordText)
  const displayWord = (showComma && !alreadyHasPunct) ? wordText + ',' : wordText

  return (
    <React.Fragment>
      <span
        ref={wordRef}
        onClick={handleClick}
        style={{ ...baseStyle, ...stressedStyle }}
      >
        {displayWord}
      </span>
      {dotCount > 0 && (
        <span className="pause-dots" data-pause={`${pauseVal.toFixed(1)}s`}>
          {Array.from({ length: dotCount }, (_, i) => (
            <span key={i} className="pause-dot" />
          ))}
        </span>
      )}
    </React.Fragment>
  )
}

export default function SummaryState({ result, onReset }) {
  // Feature 3: Track inspected word for tooltip
  const [inspectedWord, setInspectedWord] = useState(null)

  if (!result) return null

  const phrases = result.phrases || []

  // Pre-process: absorb hesitation words into pauses for each phrase
  const processedPhrases = useMemo(() => {
    return phrases.map(p => ({
      ...p,
      words: preprocessWords(p.words)
    }))
  }, [phrases])
  
  // Feature 4: Calculate total average confidence (from processed words)
  let wordCount = 0;
  let totalConfidence = 0;
  processedPhrases.forEach(p => {
    p.words.forEach(w => {
      wordCount++;
      totalConfidence += (w.confidence !== undefined ? w.confidence : 1);
    })
  });
  const avgConfidence = wordCount > 0 ? Math.round((totalConfidence / wordCount) * 100) : 0;

  const handleCanvasClick = () => {
    if (inspectedWord !== null) {
      setInspectedWord(null)
    }
  }

  return (
    <div 
      onClick={handleCanvasClick}
      style={{
        minHeight: '100vh',
        maxHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        paddingTop: '2rem',
        paddingBottom: '3rem',
        alignItems: 'center',
        paddingLeft: '2rem',
        paddingRight: '2rem',
        overflow: 'hidden'
      }}
    >
      
      {/* Transcript View */}
      <motion.div 
        initial={{ y: 30, opacity: 0.85 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 100, damping: 20 }}
        style={{
          maxWidth: '48rem',
          width: '100%',
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          paddingRight: '1rem',
          marginBottom: '1rem',
          marginTop: '1.5rem',
          textAlign: 'center'
        }}
      >
        <div style={{
          fontSize: 'clamp(0.95rem, 1.6vw, 1.4rem)',
          lineHeight: 1.65,
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-primary)'
        }}>
          {processedPhrases.map((phrase, pIndex) => (
            <div key={pIndex} style={{ marginBottom: '1.2rem' }}>
              {phrase.words.map((w, wIndex) => (
                <TranscribedWord 
                  key={wIndex} 
                  w={w} 
                  isLast={wIndex === phrase.words.length - 1} 
                  inspectedWord={inspectedWord}
                  setInspectedWord={setInspectedWord}
                />
              ))}
            </div>
          ))}
        </div>
      </motion.div>

      {/* Feature 2: Render Word Tooltip */}
      {inspectedWord && (
        <WordTooltip 
          wordData={inspectedWord.data} 
          wordRef={inspectedWord.ref} 
          onClose={() => setInspectedWord(null)} 
        />
      )}

      {/* Summary Panel */}
      <motion.div
        initial={{ y: 25, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 100, damping: 18, delay: 0.25 }}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '1.5rem',
          flexShrink: 0,
          width: '100%'
        }}
      >
        <div style={{
          width: '4rem',
          height: '1px',
          backgroundColor: 'var(--text-faded)'
        }} />

        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '2.5rem',
          width: '100%'
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '6rem' }}>
            <span style={{ fontSize: '1.2rem', fontWeight: 300, color: 'var(--text-primary)' }}>
              {Math.round(result.wpm || 0)}
            </span>
            <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: '0.3rem' }}>
              WPM
            </span>
          </div>

          <div style={{ width: '1px', height: '1.2rem', backgroundColor: 'var(--text-faded)' }} />

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '6rem' }}>
            <span style={{ fontSize: '1.2rem', fontWeight: 300, color: 'var(--text-primary)' }}>
              {Math.round(result.total_duration || 0)}s
            </span>
            <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: '0.3rem' }}>
              Duration
            </span>
          </div>

          <div style={{ width: '1px', height: '1.2rem', backgroundColor: 'var(--text-faded)' }} />

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '6rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: '1.2rem', fontWeight: 300, color: 'var(--accent)' }}>
                {avgConfidence}%
              </span>
            </div>
            <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: '0.3rem' }}>
              ASR Score
            </span>
          </div>
        </div>

        {/* Legend */}
        <div style={{
          display: 'flex', justifyContent: 'center', gap: '1.5rem', marginTop: '0.5rem', 
          fontSize: '0.75rem', color: 'var(--text-muted)', width: '100%', flexWrap: 'wrap'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ color: 'var(--accent)', fontWeight: 'bold', letterSpacing: '0.04em' }}>CAPS</span>
            <span>indicates stressed words</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ filter: 'blur(2px)', color: 'var(--text-faded)', fontWeight: 'bold' }}>blur</span>
            <span>indicates ASR score</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ color: 'var(--text-muted)' }}>,</span>
            <span>micro pause</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span className="pause-dots" style={{ animation: 'none' }}>
              <span className="pause-dot" style={{ opacity: 1, transform: 'none', animation: 'none' }} />
              <span className="pause-dot" style={{ opacity: 1, transform: 'none', animation: 'none' }} />
            </span>
            <span>medium pause</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span className="pause-dots" style={{ animation: 'none' }}>
              <span className="pause-dot" style={{ opacity: 1, transform: 'none', animation: 'none' }} />
              <span className="pause-dot" style={{ opacity: 1, transform: 'none', animation: 'none' }} />
              <span className="pause-dot" style={{ opacity: 1, transform: 'none', animation: 'none' }} />
            </span>
            <span>long pause</span>
          </div>
        </div>

        <button
          onClick={onReset}
          style={{
            background: 'none',
            border: 'none',
            fontSize: '0.65rem',
            color: 'var(--text-muted)',
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            cursor: 'pointer',
            padding: '0.5rem',
            marginTop: '1rem',
            fontFamily: 'var(--font-secondary)',
            transition: 'color var(--transition-base)'
          }}
          onMouseEnter={(e) => e.target.style.color = 'var(--text-primary)'}
          onMouseLeave={(e) => e.target.style.color = 'var(--text-muted)'}
        >
          Start New Session
        </button>
      </motion.div>
    </div>
  )
}
