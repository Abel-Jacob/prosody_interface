import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import './WordTooltip.css'

/**
 * ProsodyTooltip — Enhanced tooltip showing pitch prosody data.
 * 
 * When pitch data is available, shows:
 *   - Average pitch, pitch trend, pitch change, duration, pitch range, segment
 * When pitch data is absent, falls back to the existing tooltip content:
 *   - Timing, ASR score, stress, pause
 * 
 * Reuses WordTooltip.css for consistent styling.
 */

// Human-readable trend labels
const TREND_LABELS = {
  '↑': '↑ Rising',
  '↓': '↓ Falling',
  '→': '→ Flat',
  '↗': '↗ Rising then Level',
  '↘': '↘ Falling then Level',
}

export default function ProsodyTooltip({ wordData, wordRef, onClose }) {
  const [position, setPosition] = useState({ top: 0, left: 0, position: 'above' })

  useEffect(() => {
    if (!wordRef.current) return

    const updatePosition = () => {
      if (!wordRef.current) return
      const rect = wordRef.current.getBoundingClientRect()
      const isTooCloseToTop = rect.top < 120 // slightly more room for the larger tooltip

      setPosition({
        top: isTooCloseToTop ? rect.bottom + 8 : rect.top - 8,
        left: rect.left + rect.width / 2,
        position: isTooCloseToTop ? 'below' : 'above',
      })
    }

    updatePosition()

    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)

    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [wordRef, wordData])

  if (!wordData) return null

  const hasPitch = wordData.mean_pitch != null
  const duration = wordData.end && wordData.start
    ? Math.round((wordData.end - wordData.start) * 1000)
    : null
  const pitchChange = wordData.pitch_slope != null
    ? (wordData.pitch_slope >= 0 ? '+' : '') + wordData.pitch_slope.toFixed(1)
    : null
  const trendLabel = wordData.pitch_trend
    ? (TREND_LABELS[wordData.pitch_trend] || wordData.pitch_trend)
    : null

  const tooltipContent = (
    <div
      className={`word-tooltip-container ${position.position}`}
      style={{ top: position.top, left: position.left }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="word-tooltip-content">
        {/* Word header */}
        <div className="tooltip-row" style={{ marginBottom: '4px' }}>
          <span className="tooltip-label" style={{ 
            color: 'var(--text-primary, #e5e5e5)', 
            fontWeight: 700,
            fontSize: '0.7rem',
            letterSpacing: '0.02em',
          }}>
            {wordData.word}
          </span>
        </div>

        {/* Divider */}
        <div style={{
          width: '100%',
          height: '1px',
          background: 'rgba(255,255,255,0.1)',
          margin: '3px 0 4px',
        }} />

        {/* Pitch data (if available) */}
        {hasPitch && (
          <>
            <div className="tooltip-row">
              <span className="tooltip-label">Average Pitch</span>
              <span className="tooltip-value">
                {Math.round(wordData.mean_pitch)} Hz
              </span>
            </div>

            {trendLabel && (
              <div className="tooltip-row">
                <span className="tooltip-label">Pitch Trend</span>
                <span className="tooltip-value" style={{
                  color: wordData.pitch_trend === '↑' ? '#4ade80'
                    : wordData.pitch_trend === '↓' ? '#f87171'
                    : '#94a3b8',
                }}>
                  {trendLabel}
                </span>
              </div>
            )}

            {pitchChange != null && (
              <div className="tooltip-row">
                <span className="tooltip-label">Pitch Change</span>
                <span className="tooltip-value" style={{
                  color: wordData.pitch_slope > 0 ? '#4ade80'
                    : wordData.pitch_slope < 0 ? '#f87171'
                    : 'inherit',
                }}>
                  {pitchChange} Hz
                </span>
              </div>
            )}

            {duration != null && (
              <div className="tooltip-row">
                <span className="tooltip-label">Duration</span>
                <span className="tooltip-value">{duration} ms</span>
              </div>
            )}

            {wordData.pitch_range != null && wordData.pitch_range > 0 && (
              <div className="tooltip-row">
                <span className="tooltip-label">Pitch Range</span>
                <span className="tooltip-value">
                  {wordData.pitch_range.toFixed(1)} Hz
                </span>
              </div>
            )}

            {wordData.voiced_segment_index != null && (
              <div className="tooltip-row">
                <span className="tooltip-label">Segment</span>
                <span className="tooltip-value">{wordData.voiced_segment_index}</span>
              </div>
            )}

            {/* Divider before existing features */}
            <div style={{
              width: '100%',
              height: '1px',
              background: 'rgba(255,255,255,0.06)',
              margin: '3px 0 4px',
            }} />
          </>
        )}

        {/* Standard features (always shown) */}
        <div className="tooltip-row">
          <span className="tooltip-label">Timing</span>
          <span className="tooltip-value">
            {wordData.start.toFixed(2)}s ➔ {wordData.end.toFixed(2)}s
          </span>
        </div>

        <div className="tooltip-row">
          <span className="tooltip-label">ASR Score</span>
          <span className="tooltip-value">
            {(wordData.confidence * 100).toFixed(1)}%
          </span>
        </div>

        {wordData.stressed && (
          <div className="tooltip-row">
            <span className="tooltip-label">Stress</span>
            <span className="tooltip-value" style={{ color: 'var(--accent)' }}>
              Stressed
            </span>
          </div>
        )}

        {wordData.pause_after > 0 && (
          <div className="tooltip-row">
            <span className="tooltip-label">Pause After</span>
            <span className="tooltip-value" style={{
              color: wordData.pause_after > 0.5 ? '#f97316' : 'inherit',
            }}>
              {wordData.pause_after.toFixed(2)}s
            </span>
          </div>
        )}
      </div>
    </div>
  )

  return createPortal(tooltipContent, document.body)
}
