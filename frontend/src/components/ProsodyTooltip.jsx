import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, useReducedMotion } from 'framer-motion'
import './WordTooltip.css'

/**
 * ProsodyTooltip — Enhanced tooltip showing pitch prosody data.
 * 
 * When pitch data is available, shows:
 *   - Average pitch, pitch trend, pitch change, duration, pitch range, segment
 * When pitch data is absent, falls back to the existing tooltip content:
 *   - Timing, ASR score, stress, pause
 * 
 * Uses motion.div for materialize/dematerialize animation consistent
 * with WordTooltip and PauseTooltip.
 */

/* Finding 6: materialize spring — same config as WordTooltip for consistency */
const materializeSpring = { type: 'spring', duration: 0.25, bounce: 0 }

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
  const tooltipRef = useRef(null)
  const prefersReducedMotion = useReducedMotion()

  useEffect(() => {
    if (!wordRef.current) return

    const updatePosition = () => {
      if (!wordRef.current) return
      const rect = wordRef.current.getBoundingClientRect()

      // Measure tooltip height if already rendered, otherwise use a generous estimate
      const tooltipHeight = tooltipRef.current
        ? tooltipRef.current.getBoundingClientRect().height
        : 250

      // If the tooltip would clip above the viewport, flip it below
      const spaceAbove = rect.top - 8
      const isTooCloseToTop = spaceAbove < tooltipHeight

      setPosition({
        top: isTooCloseToTop ? rect.bottom + 8 : rect.top - 8,
        left: rect.left + rect.width / 2,
        position: isTooCloseToTop ? 'below' : 'above',
      })
    }

    updatePosition()
    // Re-measure after a frame to account for actual rendered height
    requestAnimationFrame(updatePosition)

    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)

    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [wordRef, wordData])

  if (!wordData) return null

  const inton = wordData.intonation || wordData || {}
  const meanPitch = inton.mean_pitch ?? wordData.pitch_mean
  const pitchSlope = inton.pitch_slope
  const pitchTrend = inton.pitch_trend || (wordData.pitch_direction === 'rising' ? '↑' : wordData.pitch_direction === 'falling' ? '↓' : null)

  const hasPitch = meanPitch != null
  const startVal = wordData.start !== undefined ? wordData.start : wordData.start_time
  const endVal = wordData.end !== undefined ? wordData.end : wordData.end_time

  const duration = (startVal !== undefined && endVal !== undefined)
    ? Math.round((endVal - startVal) * 1000)
    : null
  const pitchChange = pitchSlope != null
    ? (pitchSlope >= 0 ? '+' : '') + pitchSlope.toFixed(1)
    : null
  const trendLabel = pitchTrend
    ? (TREND_LABELS[pitchTrend] || pitchTrend)
    : null

  /* Finding 6: transform-origin points toward the trigger element */
  const transformOrigin = position.position === 'above' ? 'center bottom' : 'center top'

  /* Finding 8: reduced-motion fallback — opacity-only, no scale/blur */
  const initialAnim = prefersReducedMotion
    ? { opacity: 0 }
    : { opacity: 0, scale: 0.85, filter: 'blur(4px)' }
  const animateAnim = prefersReducedMotion
    ? { opacity: 1 }
    : { opacity: 1, scale: 1, filter: 'blur(0px)' }
  const exitAnim = prefersReducedMotion
    ? { opacity: 0 }
    : { opacity: 0, scale: 0.85, filter: 'blur(4px)' }

  const tooltipContent = (
    <div style={{
      position: 'fixed',
      top: position.top,
      left: position.left,
      zIndex: 9999,
      pointerEvents: 'none',
    }}>
      <motion.div
        initial={initialAnim}
        animate={animateAnim}
        exit={exitAnim}
        transition={materializeSpring}
        style={{
          transformOrigin,
          boxShadow: 'var(--shadow-lg)',
          fontFamily: 'var(--font-primary)',
        }}
        className="prosody-tooltip"
      >
        <div
          ref={tooltipRef}
          className={`word-tooltip-container ${position.position}`}
          style={{ position: 'absolute', pointerEvents: 'auto' }}
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
                {Math.round(meanPitch)} Hz
              </span>
            </div>

            {trendLabel && (
              <div className="tooltip-row">
                <span className="tooltip-label">Pitch Trend</span>
                <span className="tooltip-value" style={{
                  color: pitchTrend === '↑' ? '#4ade80'
                    : pitchTrend === '↓' ? '#f87171'
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
                  color: pitchSlope > 0 ? '#4ade80'
                    : pitchSlope < 0 ? '#f87171'
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
            {startVal !== undefined ? startVal.toFixed(2) : '0.00'}s ➔ {endVal !== undefined ? endVal.toFixed(2) : '0.00'}s
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
      </motion.div>
    </div>
  )

  return createPortal(tooltipContent, document.body)
}
