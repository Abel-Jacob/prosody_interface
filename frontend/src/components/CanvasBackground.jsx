import React from 'react'

export default function CanvasBackground({ active }) {
  return (
    <div className={`canvas-bg ${active ? 'active' : ''}`} />
  )
}
