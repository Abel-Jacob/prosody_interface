import React from 'react'
import { ThinkingOrb } from 'thinking-orbs'
import { useJobPolling } from '../services/useJobPolling'

export default function ProcessingState({ jobId, onComplete }) {
  const { error } = useJobPolling(jobId, onComplete)

  return (
    <div className="processing-state" style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '1.2rem',
      maxWidth: '34rem',
      margin: '0 auto',
      width: '100%',
      padding: '0 2rem',
      position: 'relative'
    }}>
      <div className="page-path" aria-label="Current page">PROSODY / INTERFACE</div>

      {error ? (
        <h1 style={{ color: 'var(--error)' }}>Error: {error}</h1>
      ) : (
        <>
          <div className="processing-orb-wrapper" style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: 'scale(1.48)',
            transformOrigin: 'center',
            margin: '12px 0 16px'
          }}>
            <ThinkingOrb state="connecting" size={64} />
          </div>
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px',
            textAlign: 'center'
          }}>
            <div style={{
              fontFamily: 'Helvetica, Arial, sans-serif',
              fontSize: '1.05rem',
              fontWeight: 400,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--text-primary)',
              lineHeight: 1.4,
              margin: 0
            }}>
              TRANSCRIPTION IN PROGRESS…
            </div>
            <div style={{
              fontFamily: 'Helvetica, Arial, sans-serif',
              fontSize: '0.8rem',
              fontWeight: 400,
              letterSpacing: '0.02em',
              color: 'var(--text-muted)',
              margin: 0
            }}>
              Analyzing speech prosody &amp; rhythm
            </div>
          </div>
        </>
      )}
    </div>
  )
}
