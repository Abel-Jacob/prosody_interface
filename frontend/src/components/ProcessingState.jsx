import React from 'react'
import { motion } from 'framer-motion'
import { useJobPolling } from '../services/useJobPolling'

/* Finding 4: spring-driven progress bar width.
   Critically damped (bounce: 0), ~0.4s response — smooth even if
   progress value updates rapidly or out of order. */
const progressSpring = { type: 'spring', duration: 0.4, bounce: 0 }

export default function ProcessingState({ jobId, onComplete }) {
  const { progress, error, status } = useJobPolling(jobId, onComplete)

  const progressPercent = Math.min(100, Math.max(0, progress * 100))

  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '1.2rem',
      maxWidth: '32rem',
      margin: '0 auto',
      width: '100%',
      padding: '0 2rem'
    }}>
      {error ? (
        <h1 style={{ color: 'var(--error)' }}>Error: {error}</h1>
      ) : (
        <>
          <h1 style={{
            fontFamily: 'var(--font-secondary)',
            fontSize: '1.15rem',
            fontWeight: 500,
            textTransform: 'lowercase',
            letterSpacing: '0.1em',
            color: 'var(--text-primary)',
            margin: 0
          }}>
            processing transcription...
          </h1>
          
          <div style={{
            width: '100%',
            height: '8px',
            backgroundColor: 'var(--text-faded)',
            border: '1px solid var(--text-faded)',
            borderRadius: '0px',
            overflow: 'hidden'
          }}>
            {/* Finding 4: replaced CSS transition with framer-motion spring.
                This is a justified width animation (determinate fill bar)
                rather than a transform-friendly property. */}
            <motion.div
              animate={{ width: `${progressPercent}%` }}
              transition={progressSpring}
              style={{
                height: '100%',
                backgroundColor: 'var(--accent)',
                borderRadius: '0px'
              }}
            />
          </div>
          
          <div style={{
            fontFamily: 'var(--font-secondary)',
            fontSize: '0.75rem',
            fontWeight: 500,
            color: 'var(--accent)',
            letterSpacing: '0.1em'
          }}>
            {progressPercent.toFixed(0)}%
          </div>
        </>
      )}
    </div>
  )
}
