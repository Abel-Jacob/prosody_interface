import React from 'react'

export default function CanvasBackground({ active, waveform = false }) {
  return (
    <div className={`canvas-bg ${active ? 'active' : ''} ${waveform ? 'waveform-bg' : ''}`} aria-hidden="true">
      {waveform && (
        <div className="waveform-scene">
          <svg className="waveform-svg" viewBox="0 0 1200 520" preserveAspectRatio="none">
            <path className="waveform-line waveform-line-a" d="M0 260 C70 250 85 210 125 260 S180 330 220 260 S275 175 320 260 S380 350 425 260 S490 195 535 260 S600 330 650 260 S715 160 760 260 S820 350 865 260 S930 190 975 260 S1040 325 1085 260 S1140 215 1200 260" />
            <path className="waveform-line waveform-line-b" d="M0 260 C45 260 60 245 90 260 S135 290 165 260 S215 235 245 260 S290 275 320 260 S370 220 405 260 S455 300 490 260 S540 230 575 260 S625 290 660 260 S710 210 745 260 S795 305 830 260 S880 225 915 260 S965 290 1000 260 S1050 235 1085 260 S1150 285 1200 260" />
            <path className="waveform-line waveform-line-c" d="M0 260 C80 262 105 255 150 260 S215 270 260 260 S320 245 365 260 S430 275 475 260 S535 248 580 260 S645 272 690 260 S750 242 795 260 S860 278 905 260 S970 248 1015 260 S1080 270 1125 260 S1170 255 1200 260" />
          </svg>
        </div>
      )}
    </div>
  )
}
