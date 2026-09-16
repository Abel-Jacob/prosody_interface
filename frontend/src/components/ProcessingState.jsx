import React from 'react'
import { ThinkingOrb } from 'thinking-orbs'
import { useJobPolling } from '../services/useJobPolling'

export default function ProcessingState({ jobId, onComplete }) {
  const { error } = useJobPolling(jobId, onComplete)

  return (
    <div className="processing-state" style={{
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '1.4rem',
      maxWidth: '32rem',
      margin: '0 auto',
      width: '100%',
      padding: '0 2rem'
    }}>
      {error ? (
        <h1 style={{ color: 'var(--error)' }}>Error: {error}</h1>
      ) : (
        <>
          <div className="processing-orb-wrapper" style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: 'scale(1.28)',
            transformOrigin: 'center',
            marginBottom: '0.6rem'
          }}>
            <ThinkingOrb state="connecting" size={64} />
          </div>
          <h1 style={{
            fontFamily: 'var(--font-secondary)',
            fontSize: '1.15rem',
            fontWeight: 500,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
            margin: 0
          }}>
            transcription in progress...
          </h1>
        </>
      )}
    </div>
  )
}
