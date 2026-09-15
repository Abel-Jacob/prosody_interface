import React from 'react'
import { ThinkingOrb } from 'thinking-orbs'
import { useJobPolling } from '../services/useJobPolling'

export default function ProcessingState({ jobId, onComplete }) {
  const { error } = useJobPolling(jobId, onComplete)

  return (
    <div style={{
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
          <ThinkingOrb state="solving" size={64} />
          <h1 style={{
            fontFamily: 'var(--font-secondary)',
            fontSize: '1.15rem',
            fontWeight: 500,
            textTransform: 'lowercase',
            letterSpacing: '0.1em',
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
