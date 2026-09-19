import React from 'react'
import { ThinkingOrb } from 'thinking-orbs'
import { useJobPolling } from '../services/useJobPolling'

class SafeThinkingOrb extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }
  static getDerivedStateFromError() {
    return { hasError: true }
  }
  componentDidCatch(err) {
    console.warn('[ProcessingState] ThinkingOrb canvas failed:', err)
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          width: 64,
          height: 64,
          borderRadius: '50%',
          border: '2px solid var(--accent, #c4956a)',
          borderTopColor: 'transparent',
          animation: 'spin 1s linear infinite'
        }} />
      )
    }
    return <ThinkingOrb {...this.props} />
  }
}

export default function ProcessingState({ jobId, onComplete, onReset }) {
  const { progress, status, currentStage, error } = useJobPolling(jobId, onComplete)

  const getStageDisplay = () => {
    if (!currentStage) return { title: 'TRANSCRIPTION IN PROGRESS…', subtitle: 'Analyzing speech prosody, syllable stress & intonation' }
    if (currentStage.startsWith('file_')) {
      const match = currentStage.match(/file_(\d+)_of_(\d+):\s*(.*)/)
      if (match) {
        return {
          title: `PROCESSING BATCH: FILE ${match[1]} OF ${match[2]}…`,
          subtitle: match[3] ? `${match[3]}` : 'Evaluating prosody, syllable stress & intonation'
        }
      }
    }
    if (currentStage === 'loading_audio') return { title: 'PREPARING AUDIO…', subtitle: 'Decoding and normalizing speech signal' }
    if (currentStage === 'transcribing_full_audio') return { title: 'TRANSCRIBING SPEECH…', subtitle: 'faster-whisper acoustic word alignment' }
    if (currentStage.startsWith('analyzing_sentence_')) {
      const match = currentStage.match(/analyzing_sentence_(\d+)_of_(\d+)/)
      if (match) {
        return {
          title: `ANALYZING PROSODY (${match[1]}/${match[2]})…`,
          subtitle: 'Evaluating WhiStress, LexiRep 768-D & SWIPE pitch'
        }
      }
      return { title: 'ANALYZING PROSODY…', subtitle: 'Evaluating WhiStress, LexiRep 768-D & SWIPE pitch' }
    }
    if (currentStage === 'pitch_stylization') return { title: 'STYLIZING PITCH…', subtitle: 'Dynamic programming piecewise linear MAE' }
    if (currentStage === 'finalizing') return { title: 'FINALIZING REPORT…', subtitle: 'Synthesizing prosody metrics' }
    return { title: 'TRANSCRIPTION IN PROGRESS…', subtitle: 'Analyzing speech prosody, syllable stress & intonation' }
  }

  const { title, subtitle } = getStageDisplay()
  const percent = Math.min(99, Math.max(0, Math.round((progress || 0) * 100)))

  return (
    <div className="processing-state" style={{
      minHeight: '100vh',
      width: '100%',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '80px 2rem 64px',
      position: 'relative'
    }}>
      <div className="page-path" aria-label="Current page">PROSODY / INTERFACE</div>

      <div style={{
        maxWidth: '34rem',
        width: '100%',
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '1.2rem',
        textAlign: 'center'
      }}>
        {error ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            gap: '1rem',
            maxWidth: '28rem'
          }}>
            <h2 style={{
              color: 'var(--error, #f87171)',
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: '1rem',
              margin: 0,
              textTransform: 'uppercase',
              letterSpacing: '0.08em'
            }}>
              Processing Failed
            </h2>
            <p style={{
              color: 'var(--text-muted, #888)',
              fontSize: '0.8rem',
              lineHeight: 1.6,
              margin: 0
            }}>
              {error}
            </p>
            <button
              type="button"
              onClick={onReset || (() => window.location.reload())}
              style={{
                padding: '8px 18px',
                borderRadius: '4px',
                border: '1px solid var(--border-strong, #444)',
                background: 'transparent',
                color: 'var(--text-primary, #fff)',
                fontFamily: 'var(--font-mono, monospace)',
                fontSize: '0.72rem',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                marginTop: '0.5rem'
              }}
            >
              ← Back to Recorder
            </button>
          </div>
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
              <SafeThinkingOrb state="connecting" size={64} />
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
                {title}
              </div>
              <div style={{
                fontFamily: 'Helvetica, Arial, sans-serif',
                fontSize: '0.8rem',
                fontWeight: 400,
                letterSpacing: '0.02em',
                color: 'var(--text-muted)',
                margin: 0
              }}>
                {subtitle}
              </div>

              {/* Hairline Progress Bar & Percentage */}
              <div style={{
                width: '180px',
                height: '2px',
                background: 'rgba(255, 255, 255, 0.08)',
                borderRadius: '2px',
                overflow: 'hidden',
                marginTop: '10px'
              }}>
                <div style={{
                  width: `${percent}%`,
                  height: '100%',
                  background: 'var(--accent, #c4956a)',
                  transition: 'width 0.25s ease'
                }} />
              </div>
              <span style={{
                fontFamily: 'Helvetica, Arial, sans-serif',
                fontSize: '0.68rem',
                letterSpacing: '0.06em',
                color: 'var(--text-muted)',
                marginTop: '2px'
              }}>
                {percent}%
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
