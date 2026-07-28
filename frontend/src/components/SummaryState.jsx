import React, { useState, useRef } from 'react'
import { motion } from 'framer-motion'
import WordTooltip from './WordTooltip'

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
  
  const hesitationStyle = w.is_hesitation ? {
    color: '#eab308', // Amber/Yellow for hesitation
    fontStyle: 'italic',
    opacity: 0.8
  } : {}

  const handleClick = (e) => {
    e.stopPropagation() // Feature 3: Prevent canvas click from dismissing immediately
    setInspectedWord({ data: w, ref: wordRef })
  }

  return (
    <React.Fragment>
      <span
        ref={wordRef}
        onClick={handleClick}
        style={{ ...baseStyle, ...stressedStyle, ...hesitationStyle }}
      >
        {w.word}
      </span>
      {/* Option 1: The "Time-Pill" Badge */}
      {w.pause_after > 0.5 && !isLast && (
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '0.65rem',
          color: 'var(--text-faded)',
          backgroundColor: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '12px',
          padding: '0 6px',
          height: '18px',
          marginRight: '0.35rem',
          marginLeft: '0.1rem',
          verticalAlign: 'middle',
          fontFamily: 'monospace'
        }}>
          {w.pause_after.toFixed(1)}s
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
  
  // Feature 4: Calculate total average confidence
  let wordCount = 0;
  let totalConfidence = 0;
  phrases.forEach(p => {
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
          {phrases.map((phrase, pIndex) => (
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
            <span style={{ color: '#eab308', fontStyle: 'italic', fontWeight: 'bold' }}>italic</span>
            <span>indicates hesitation (um/uh)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.65rem', color: 'var(--text-faded)', backgroundColor: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', padding: '0 6px', height: '18px', fontFamily: 'monospace'
            }}>0.8s</span>
            <span>indicates silent pause &gt; 0.5s</span>
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
