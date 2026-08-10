import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, useReducedMotion } from 'framer-motion'
import './WordTooltip.css'

/* Finding 6: materialize spring — same config as WordTooltip for consistency */
const materializeSpring = { type: 'spring', duration: 0.25, bounce: 0 }

/**
 * Hover tooltip for breathing dots — same design as WordTooltip.
 * Shows pause duration above the dots, rendered via portal.
 */
export default function PauseTooltip({ pauseVal, dotsRef }) {
  const [position, setPosition] = useState({ top: 0, left: 0, position: 'above' })
  const prefersReducedMotion = useReducedMotion()

  useEffect(() => {
    if (!dotsRef?.current) return

    const update = () => {
      if (!dotsRef.current) return
      const rect = dotsRef.current.getBoundingClientRect()
      const isTooCloseToTop = rect.top < 70

      setPosition({
        top: isTooCloseToTop ? rect.bottom + 8 : rect.top - 8,
        left: rect.left + rect.width / 2,
        position: isTooCloseToTop ? 'below' : 'above',
      })
    }

    update()
    window.addEventListener('scroll', update, true)
    return () => window.removeEventListener('scroll', update, true)
  }, [dotsRef])

  /* Finding 6: transform-origin anchored to trigger direction */
  const transformOrigin = position.position === 'above' ? 'center bottom' : 'center top'

  /* Finding 8: reduced-motion fallback — opacity-only */
  const initialAnim = prefersReducedMotion
    ? { opacity: 0 }
    : { opacity: 0, scale: 0.85, filter: 'blur(4px)' }
  const animateAnim = prefersReducedMotion
    ? { opacity: 1 }
    : { opacity: 1, scale: 1, filter: 'blur(0px)' }
  const exitAnim = prefersReducedMotion
    ? { opacity: 0 }
    : { opacity: 0, scale: 0.85, filter: 'blur(4px)' }

  return createPortal(
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
        style={{ transformOrigin }}
      >
        <div
          className={`word-tooltip-container ${position.position}`}
          style={{ position: 'absolute', pointerEvents: 'auto' }}
        >
          <div className="word-tooltip-content">
            <div className="tooltip-row">
              <span className="tooltip-label">Pause:</span>
          <span className="tooltip-value" style={{ color: '#f97316' }}>
            {pauseVal.toFixed(2)}s
          </span>
            </div>
          </div>
        </div>
      </motion.div>
    </div>,
    document.body
  )
}
