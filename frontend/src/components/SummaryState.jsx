import React from 'react'
import { motion } from 'framer-motion'

export default function SummaryState({ result, onReset }) {
  if (!result) return null

  // We map the phrases and color the stressed words
  const phrases = result.phrases || []

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      paddingTop: '3rem',
      paddingBottom: '6rem',
      alignItems: 'center',
      paddingLeft: '2rem',
      paddingRight: '2rem'
    }}>
      
      {/* Transcript View */}
      <div style={{
        maxWidth: '48rem',
        width: '100%',
        maxHeight: '50vh',
        overflowY: 'auto',
        paddingRight: '1rem',
        marginBottom: '4rem'
      }}>
        <p style={{
          fontSize: 'clamp(0.95rem, 1.6vw, 1.4rem)',
          lineHeight: 1.65,
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-primary)'
        }}>
          {phrases.map((phrase, pIndex) => (
            <React.Fragment key={pIndex}>
              {phrase.words.map((w, wIndex) => {
                if (w.stressed) {
                  return (
                    <span 
                      key={wIndex}
                      style={{
                        fontWeight: 600,
                        color: 'var(--accent)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        textShadow: '0 0 12px var(--accent-dim)'
                      }}
                    >
                      {w.word}
                      {wIndex !== phrase.words.length - 1 ? ' ' : ''}
                    </span>
                  )
                }
                return <span key={wIndex}>{w.word}{wIndex !== phrase.words.length - 1 ? ' ' : ''}</span>
              })}
              {/* Space between phrases */}
              {' '}
            </React.Fragment>
          ))}
        </p>
      </div>

      {/* Summary Panel */}
      <motion.div
        initial={{ y: 15, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 100, damping: 18, delay: 0.2 }}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '2rem'
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
          gap: '2.5rem'
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ fontSize: '1.2rem', fontWeight: 300, color: 'var(--text-primary)' }}>
              {Math.round(result.wpm || 0)}
            </span>
            <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: '0.3rem' }}>
              WPM
            </span>
          </div>

          <div style={{ width: '1px', height: '1.2rem', backgroundColor: 'var(--text-faded)' }} />

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ fontSize: '1.2rem', fontWeight: 300, color: 'var(--text-primary)' }}>
              {Math.round(result.total_duration || 0)}s
            </span>
            <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: '0.3rem' }}>
              Duration
            </span>
          </div>

          <div style={{ width: '1px', height: '1.2rem', backgroundColor: 'var(--text-faded)' }} />

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ fontSize: '1.2rem', fontWeight: 300, color: 'var(--accent)' }}>
              {((result.stress_ratio || 0) * 100).toFixed(0)}%
            </span>
            <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: '0.3rem' }}>
              Stress
            </span>
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
