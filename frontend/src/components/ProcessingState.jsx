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
          <div style={{
            fontFamily: 'Helvetica, Arial, sans-serif',
            fontSize: '1.05rem',
            fontWeight: 400,
            letterSpacing: '0.02em',
            color: 'var(--text-primary)',
            textAlign: 'center',
            lineHeight: 1.4,
            margin: 0
          }}>
            transcription in progress…
          </div>
        </>
      )}
    </div>
  )
}
