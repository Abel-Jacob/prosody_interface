import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import './WordTooltip.css'

/**
 * Hover tooltip for breathing dots — same design as WordTooltip.
 * Shows pause duration above the dots, rendered via portal.
 */
export default function PauseTooltip({ pauseVal, dotsRef }) {
  const [position, setPosition] = useState({ top: 0, left: 0, position: 'above' })

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

  return createPortal(
    <div
      className={`word-tooltip-container ${position.position}`}
      style={{ top: position.top, left: position.left, pointerEvents: 'none' }}
    >
      <div className="word-tooltip-content">
        <div className="tooltip-row">
          <span className="tooltip-label">Pause:</span>
          <span className="tooltip-value" style={{ color: '#f97316' }}>
            {pauseVal.toFixed(2)}s
          </span>
        </div>
      </div>
    </div>,
    document.body
  )
}
