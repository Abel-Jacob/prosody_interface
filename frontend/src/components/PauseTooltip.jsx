import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * Lightweight hover tooltip for breathing dots.
 * Shows pause duration above the dots, rendered via portal to avoid overflow clipping.
 */
export default function PauseTooltip({ pauseVal, dotsRef }) {
  const [position, setPosition] = useState({ top: 0, left: 0 })

  useEffect(() => {
    if (!dotsRef?.current) return

    const update = () => {
      if (!dotsRef.current) return
      const rect = dotsRef.current.getBoundingClientRect()
      setPosition({
        top: rect.top - 8,
        left: rect.left + rect.width / 2,
      })
    }

    update()
    window.addEventListener('scroll', update, true)
    return () => window.removeEventListener('scroll', update, true)
  }, [dotsRef])

  return createPortal(
    <div style={{
      position: 'fixed',
      top: position.top,
      left: position.left,
      transform: 'translate(-50%, -100%)',
      zIndex: 9999,
      pointerEvents: 'none',
      animation: 'tooltipFadeIn 0.12s ease-out forwards',
    }}>
      <div style={{
        backgroundColor: '#1a1a1a',
        color: '#f97316',
        padding: '3px 8px',
        borderRadius: '4px',
        fontSize: '0.7rem',
        fontWeight: 600,
        fontFamily: 'monospace',
        boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
        border: '1px solid rgba(249, 115, 22, 0.25)',
        whiteSpace: 'nowrap',
        position: 'relative',
      }}>
        {pauseVal.toFixed(1)}s
        {/* Arrow pointing down */}
        <div style={{
          position: 'absolute',
          top: '100%',
          left: '50%',
          marginLeft: '-5px',
          borderWidth: '5px',
          borderStyle: 'solid',
          borderColor: '#1a1a1a transparent transparent transparent',
        }} />
      </div>
    </div>,
    document.body
  )
}
