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
          <ThinkingOrb state="connecting" size={64} />
          <h1 style={{
            fontFamily: 'var(--font-primary)',
            fontSize: '0.9rem',
            fontWeight: 400,
            textTransform: 'none',
            letterSpacing: '0.04em',
            color: 'var(--text-primary)',
            margin: 0
          }}>
            transcription in progress...
          </h1>
        </>
      )}
    </div>
  )
}
