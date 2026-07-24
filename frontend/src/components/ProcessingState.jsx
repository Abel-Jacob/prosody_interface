import React from 'react'
import { useJobPolling } from '../services/useJobPolling'

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
            color: '#ffffff',
            margin: 0
          }}>
            processing transcription...
          </h1>
          
          <div style={{
            width: '100%',
            height: '8px',
            backgroundColor: '#141312',
            border: '1px solid #3a3632',
            borderRadius: '0px',
            overflow: 'hidden'
          }}>
            <div style={{
              height: '100%',
              backgroundColor: 'var(--accent)',
              width: `${progressPercent}%`,
              transition: 'width 0.3s ease-out',
              borderRadius: '0px'
            }} />
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
