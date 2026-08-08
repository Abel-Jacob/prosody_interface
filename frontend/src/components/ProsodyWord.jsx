import React, { useEffect, useState, useRef } from 'react'
import './ProsodyWord.css'

/**
 * ProsodyWord — Renders a single word with character-level pitch deformation.
 *
 * The MAE-stylized pitch contour from the backend drives per-character scaleY
 * transforms. Rising pitch stretches characters taller; falling pitch compresses
 * them. All words — pitched or plain — sit on the SAME text baseline:
 *
 *   .prosody-word  → display: inline   (never shifts the word off its line)
 *   .prosody-char  → vertical-align: baseline + transform-origin: center
 *                     so scaleY grows characters symmetrically up and down
 *                     like a music waveform, without moving the layout baseline.
 *
 * Props:
 *   word        — The word text to display
 *   charPitches — Array of normalized pitch values (0–1) per character
 *   stressed    — Whether this word is stressed (for styling)
 *   isInspected — Whether this word is currently inspected/selected
 *   onClick     — Click handler
 *   confidence  — ASR confidence (for blur effect)
 *   style       — Additional inline styles
 */

// Pitch deformation range
const SCALE_MIN = 0.7
const SCALE_MAX = 1.3

function normalizedPitchToScale(normalizedPitch) {
  // Map 0-1 normalized pitch to SCALE_MIN-SCALE_MAX
  // Clamp to [0, 1] first
  const clamped = Math.max(0, Math.min(1, normalizedPitch))
  return SCALE_MIN + clamped * (SCALE_MAX - SCALE_MIN)
}

export default function ProsodyWord({
  word,
  charPitches,
  stressed = false,
  isInspected = false,
  onClick,
  confidence = 1,
  style = {},
}) {
  const [revealed, setRevealed] = useState(false)
  const wordRef = useRef(null)

  // Trigger reveal animation after mount
  useEffect(() => {
    const timer = setTimeout(() => setRevealed(true), 50)
    return () => clearTimeout(timer)
  }, [])

  // Strip trailing punctuation from the word for character rendering
  // but keep it as a suffix to display after the deformed characters
  const punctMatch = word.match(/([.,!?;:"'\-]+)$/)
  const punctuation = punctMatch ? punctMatch[1] : ''
  const cleanWord = punctuation ? word.slice(0, -punctuation.length) : word

  // Build per-character scale values
  const chars = cleanWord.split('')
  const hasValidPitches = charPitches && charPitches.length > 0

  // Map charPitches to actual characters
  // charPitches may have a different length than chars (it's based on
  // the word without trailing punctuation from the backend side)
  const getCharScale = (charIndex) => {
    if (!hasValidPitches) return 1
    // Interpolate if lengths don't match exactly
    if (charPitches.length === chars.length) {
      return normalizedPitchToScale(charPitches[charIndex])
    }
    // Linear interpolation
    const ratio = chars.length > 1
      ? charIndex / (chars.length - 1)
      : 0.5
    const pitchIndex = ratio * (charPitches.length - 1)
    const lower = Math.floor(pitchIndex)
    const upper = Math.min(Math.ceil(pitchIndex), charPitches.length - 1)
    const frac = pitchIndex - lower
    const interpolated = charPitches[lower] * (1 - frac) + charPitches[upper] * frac
    return normalizedPitchToScale(interpolated)
  }

  // Confidence-based visual effects (matching existing TranscribedWord behavior)
  const opacity = confidence < 0.95 ? Math.max(0.5, 0.4 + confidence * 0.6) : 1
  const blurVal = confidence < 0.85 ? Math.min(1.4, (0.85 - confidence) * 4) : 0
  const filter = blurVal > 0.05 ? `blur(${blurVal.toFixed(2)}px)` : 'none'

  const appliedFilter = isInspected ? 'none' : filter
  const appliedOpacity = isInspected ? 1 : opacity

  // Stressed word styling
  const stressedStyle = stressed ? {
    fontWeight: 600,
    color: 'var(--accent)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    textShadow: '0 0 12px var(--accent-dim)',
  } : {}

  const className = [
    'prosody-word',
    revealed ? 'reveal' : 'animating',
    isInspected ? 'inspected' : '',
  ].filter(Boolean).join(' ')

  return (
    <span
      ref={wordRef}
      className={className}
      onClick={onClick}
      style={{
        ...style,
        filter: appliedFilter,
        opacity: appliedOpacity,
        transition: 'filter 0.2s, opacity 0.2s',
        ...stressedStyle,
      }}
    >
      {chars.map((char, i) => {
        const scale = getCharScale(i)
        return (
          <span
            key={i}
            className="prosody-char"
            style={{
              '--final-scale': scale,
              transform: revealed ? `scaleY(${scale})` : 'scaleY(1)',
            }}
          >
            {char}
          </span>
        )
      })}
      {punctuation && (
        <span className="prosody-char" style={{ transform: 'scaleY(1)' }}>
          {punctuation}
        </span>
      )}
    </span>
  )
}
