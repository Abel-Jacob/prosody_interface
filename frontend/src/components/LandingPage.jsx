import React from 'react'
import { motion } from 'framer-motion'
import './LandingPage.css'

const tapSpring = { type: 'spring', duration: 0.15, bounce: 0 }

/**
 * Landing page — new app entry point.
 * Two cards: "Prosody Interface" and "LexiRep — Train Your Own Model".
 */
export default function LandingPage({ onNavigate }) {
  return (
    <div className="landing-container">
      <h1 className="landing-title">Choose an interface</h1>

      <div className="landing-cards">
        {/* ── Prosody Interface Card ──────────────────── */}
        <motion.div
          className="landing-card"
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') onNavigate('prosody')
          }}
          onClick={() => onNavigate('prosody')}
          whileTap={{ scale: 0.97 }}
          transition={tapSpring}
        >
          <div className="landing-card-icon">
            {/* Waveform / microphone icon (inline SVG) */}
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          </div>
          <span className="landing-card-title">prosody interface</span>
          <span className="landing-card-subtitle">
            Record or upload audio for real-time
            speech prosody analysis
          </span>
        </motion.div>

        {/* ── Divider ────────────────────────────────── */}
        <div className="landing-divider">
          <div className="landing-divider-line" />
        </div>

        {/* ── LexiRep Training Card ──────────────────── */}
        <motion.div
          className="landing-card"
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') onNavigate('lexirep')
          }}
          onClick={() => onNavigate('lexirep')}
          whileTap={{ scale: 0.97 }}
          transition={tapSpring}
        >
          <div className="landing-card-icon">
            {/* Neural network / model icon (inline SVG) */}
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="2" />
              <circle cx="4" cy="6" r="2" />
              <circle cx="20" cy="6" r="2" />
              <circle cx="4" cy="18" r="2" />
              <circle cx="20" cy="18" r="2" />
              <line x1="6" y1="7" x2="10" y2="11" />
              <line x1="18" y1="7" x2="14" y2="11" />
              <line x1="6" y1="17" x2="10" y2="13" />
              <line x1="18" y1="17" x2="14" y2="13" />
            </svg>
          </div>
          <span className="landing-card-title">lexirep</span>
          <span className="landing-card-subtitle">
            Upload a 768-dim dataset and train
            a custom LexiRep model
          </span>
        </motion.div>
      </div>
    </div>
  )
}
