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
  const yTranslate = position.position === 'above' ? '-100%' : '0%'
  const initialAnim = prefersReducedMotion
    ? { opacity: 0, x: '-50%', y: yTranslate }
    : { opacity: 0, scale: 0.85, filter: 'blur(4px)', x: '-50%', y: yTranslate }
  const animateAnim = prefersReducedMotion
    ? { opacity: 1, x: '-50%', y: yTranslate }
    : { opacity: 1, scale: 1, filter: 'blur(0px)', x: '-50%', y: yTranslate }
  const exitAnim = prefersReducedMotion
    ? { opacity: 0, x: '-50%', y: yTranslate }
    : { opacity: 0, scale: 0.85, filter: 'blur(4px)', x: '-50%', y: yTranslate }

  return createPortal(
    <motion.div
      className={`word-tooltip-container ${position.position}`}
      style={{
        top: position.top,
        left: position.left,
        pointerEvents: 'none',
        transformOrigin,
      }}
      initial={initialAnim}
      animate={animateAnim}
      exit={exitAnim}
      transition={materializeSpring}
    >
      <div className="word-tooltip-content">
        <div className="tooltip-row">
          <span className="tooltip-label">Pause:</span>
          <span className="tooltip-value" style={{ color: '#f97316' }}>
            {pauseVal.toFixed(2)}s
          </span>
        </div>
      </div>
    </motion.div>,
    document.body
  )
}
