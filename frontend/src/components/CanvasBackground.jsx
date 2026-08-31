import React from 'react'

export default function CanvasBackground({ active, waveform = false }) {
  return (
    <div className={`canvas-bg ${active ? 'active' : ''} ${waveform ? 'waveform-bg' : ''}`} aria-hidden="true">
      {waveform && (
        <div className="waveform-scene">
          <div className="waveform-ribbon waveform-ribbon-a" />
          <div className="waveform-ribbon waveform-ribbon-b" />
          <div className="waveform-ribbon waveform-ribbon-c" />
        </div>
      )}
    </div>
  )
}
