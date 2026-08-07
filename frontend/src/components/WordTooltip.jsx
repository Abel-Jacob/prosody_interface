import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'framer-motion';
import './WordTooltip.css';

/* Finding 6: materialize spring — scale + opacity + blur, anchored to trigger.
   Critically damped (~0.25s response). Exit mirrors entry. */
const materializeSpring = { type: 'spring', duration: 0.25, bounce: 0 }

export default function WordTooltip({ wordData, wordRef, onClose }) {
  const [position, setPosition] = useState({ top: 0, left: 0, position: 'above' });
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    if (!wordRef.current) return;

    const updatePosition = () => {
      if (!wordRef.current) return;
      const rect = wordRef.current.getBoundingClientRect();
      const isTooCloseToTop = rect.top < 70;

      setPosition({
        top: isTooCloseToTop ? rect.bottom + 8 : rect.top - 8,
        left: rect.left + rect.width / 2,
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

  if (!wordData) return null;

  /* Finding 6: transform-origin points toward the trigger element.
     "above" → scale originates from center-bottom (toward the word below).
     "below" → scale originates from center-top (toward the word above). */
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
      <div className="word-tooltip-content">
        <div className="tooltip-row">
          <span className="tooltip-label">Timing:</span>
          <span className="tooltip-value">
            {wordData.start.toFixed(2)}s ➔ {wordData.end.toFixed(2)}s
          </span>
        </div>
        <div className="tooltip-row">
          <span className="tooltip-label">ASR Score:</span>
          <span className="tooltip-value">
            {(wordData.confidence * 100).toFixed(1)}%
          </span>
        </div>
        {wordData.stressed && (
          <div className="tooltip-row">
            <span className="tooltip-label">WhiStress ML:</span>
            <span className="tooltip-value" style={{ color: 'var(--accent)' }}>Stressed</span>
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
        {wordData.pitch_mean != null && (
          <div className="tooltip-row">
            <span className="tooltip-label">Pitch:</span>
            <span className="tooltip-value">
              {Math.round(wordData.pitch_mean)} Hz {wordData.pitch_direction === 'rising' ? '↗' : wordData.pitch_direction === 'falling' ? '↘' : wordData.pitch_direction === 'flat' ? '→' : ''}
            </span>
          </div>
        )}
      </div>
    </motion.div>
  );

  return createPortal(tooltipContent, document.body);
}
