import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'framer-motion';
import './WordTooltip.css';

/* Finding 6: materialize spring — scale + opacity + blur, anchored to trigger.
   Critically damped (~0.25s response). Exit mirrors entry. */
const materializeSpring = { type: 'spring', duration: 0.25, bounce: 0 }

export default function WordTooltip({ wordData, phraseIntonation, wordRef, onClose }) {
  const [position, setPosition] = useState({ top: 0, left: 0, position: 'above' });
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    if (!wordRef.current) return;

    const updatePosition = () => {
      if (!wordRef.current) return;
      const rect = wordRef.current.getBoundingClientRect();
      const isTooCloseToTop = rect.top < 75;

      setPosition({
        top: isTooCloseToTop ? rect.bottom + window.scrollY + 8 : rect.top + window.scrollY - 8,
        left: rect.left + window.scrollX + rect.width / 2,
        position: isTooCloseToTop ? 'below' : 'above'
      });
    };

    updatePosition();
    
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [wordRef, wordData]);

  useEffect(() => {
    // Click outside handler to close the tooltip
    const handleOutsideClick = () => {
      onClose();
    };
    window.addEventListener('click', handleOutsideClick);
    return () => window.removeEventListener('click', handleOutsideClick);
  }, [onClose]);

  if (!wordData) return null;

  /* Finding 6: transform-origin points toward the trigger element. */
  const transformOrigin = position.position === 'above' ? 'center bottom' : 'center top';

  /* Finding 8: reduced-motion fallback — opacity-only, no scale/blur. */
  const initialAnim = prefersReducedMotion
    ? { opacity: 0 }
    : { opacity: 0, scale: 0.85, filter: 'blur(4px)' };
  const animateAnim = prefersReducedMotion
    ? { opacity: 1 }
    : { opacity: 1, scale: 1, filter: 'blur(0px)' };
  const exitAnim = prefersReducedMotion
    ? { opacity: 0 }
    : { opacity: 0, scale: 0.85, filter: 'blur(4px)' };

  // Calculate Average Pitch: Convert word's normalized_pitch (0.0 to 1.0) back to Hz
  // relative to the parent phrase's min_pitch and max_pitch.
  let avgPitchStr = 'N/A';
  if (
    phraseIntonation &&
    phraseIntonation.min_pitch != null &&
    phraseIntonation.max_pitch != null &&
    wordData.normalized_pitch != null
  ) {
    const hz = phraseIntonation.min_pitch + wordData.normalized_pitch * (phraseIntonation.max_pitch - phraseIntonation.min_pitch);
    avgPitchStr = `${Math.round(hz)} Hz`;
  } else if (phraseIntonation && phraseIntonation.mean_pitch != null) {
    avgPitchStr = `${Math.round(phraseIntonation.mean_pitch)} Hz (Phrase Mean)`;
  }

  // Pitch Trend mapping and styling
  const trend = phraseIntonation?.pitch_trend || '→';
  const trendLabel = trend === '↑' || trend === '↗' ? 'Rising' : trend === '↓' || trend === '↘' ? 'Falling' : 'Flat';
  const trendColor = trendLabel === 'Rising' ? '#22c55e' : trendLabel === 'Falling' ? '#ef4444' : '#e5e5e5';
  const trendArrow = trend === '↑' || trend === '↗' ? '↑' : trend === '↓' || trend === '↘' ? '↓' : '→';

  // Pitch change (slope)
  const slope = phraseIntonation?.pitch_slope;
  const slopeStr = slope != null ? `${slope > 0 ? '+' : ''}${slope.toFixed(1)} Hz` : 'N/A';

  // Pitch range
  const range = phraseIntonation?.pitch_range;
  const rangeStr = range != null ? `${range.toFixed(1)} Hz` : 'N/A';

  // Duration
  const durationMs = Math.round((wordData.end_time - wordData.start_time) * 1000);

  const tooltipContent = (
    <motion.div
      className={`word-tooltip-container ${position.position}`}
      style={{
        top: position.top,
        left: position.left,
        transformOrigin,
      }}
      initial={initialAnim}
      animate={animateAnim}
      exit={exitAnim}
      transition={materializeSpring}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="word-tooltip-content" style={{ minWidth: '170px' }}>
        <div className="tooltip-row">
          <span className="tooltip-label">Timing:</span>
          <span className="tooltip-value">{wordData.start_time.toFixed(2)}s ➔ {wordData.end_time.toFixed(2)}s</span>
        </div>
        <div className="tooltip-row">
          <span className="tooltip-label">Duration:</span>
          <span className="tooltip-value">{durationMs} ms</span>
        </div>
        <div className="tooltip-row">
          <span className="tooltip-label">ASR Score:</span>
          <span className="tooltip-value">{(wordData.asr_confidence * 100).toFixed(1)}%</span>
        </div>
        
        <div className="tooltip-row">
          <span className="tooltip-label">Average Pitch:</span>
          <span className="tooltip-value" style={{ color: 'var(--accent)' }}>{avgPitchStr}</span>
        </div>
        <div className="tooltip-row">
          <span className="tooltip-label">Pitch Trend:</span>
          <span className="tooltip-value" style={{ color: trendColor }}>{trendArrow} {trendLabel}</span>
        </div>
        <div className="tooltip-row">
          <span className="tooltip-label">Pitch Change:</span>
          <span className="tooltip-value" style={{ color: slope >= 0 ? '#22c55e' : '#ef4444' }}>{slopeStr}</span>
        </div>
        <div className="tooltip-row">
          <span className="tooltip-label">Pitch Range:</span>
          <span className="tooltip-value">{rangeStr}</span>
        </div>

        {wordData.stressed && (
          <div className="tooltip-row">
            <span className="tooltip-label">Stress:</span>
            <span className="tooltip-value" style={{ color: 'var(--accent)' }}>Stressed ({(wordData.stress_score || 0).toFixed(2)})</span>
          </div>
        )}
        {wordData.pause_after > 0 && (
          <div className="tooltip-row">
            <span className="tooltip-label">Pause After:</span>
            <span className="tooltip-value" style={{ color: wordData.pause_after > 0.5 ? '#f97316' : 'inherit' }}>
              {wordData.pause_after.toFixed(2)}s
            </span>
          </div>
        )}
      </div>
    </motion.div>
  );

  return createPortal(tooltipContent, document.body);
}
