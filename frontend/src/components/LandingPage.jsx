import React, { useState, useEffect, useCallback, useRef } from 'react'
import { motion } from 'framer-motion'
import { BACKEND_DOMAIN, setBackendDomain } from '../apiConfig'
import './LandingPage.css'

const tapSpring = { type: 'spring', duration: 0.15, bounce: 0 }

/**
 * Landing page — App Entry Point.
 * Features:
 * - Two cards: "Prosody Interface" and "LexiRep — Train Your Own Model".
 * - Centralized Cloudflare Tunnel URL connection bar that sets the backend
 *   globally for both Prosody Interface and LexiRep Training.
 */
export default function LandingPage({ onNavigate }) {
  const [tunnelUrl, setTunnelUrl] = useState(BACKEND_DOMAIN)
  const [status, setStatus] = useState('checking') // 'connected' | 'checking' | 'offline' | 'local' | 'idle'
  const [isPinging, setIsPinging] = useState(false)
  const debounceRef = useRef(null)

  const checkConnection = useCallback(async (domain) => {
    const clean = domain
      ? domain.trim().replace(/^https?:\/\//, '').replace(/^wss?:\/\//, '').replace(/\/$/, '')
      : ''

    if (!clean) {
      // Check local fallback
      try {
        const res = await fetch('/health', { signal: AbortSignal.timeout(2500) })
        if (res.ok) setStatus('local')
        else setStatus('idle')
      } catch {
        setStatus('idle')
      }
      return
    }

    setStatus('checking')
    setIsPinging(true)
    try {
      const res = await fetch(`https://${clean}/health`, {
        signal: AbortSignal.timeout(5000),
      })
      if (res.ok) {
        setStatus('connected')
      } else {
        setStatus('offline')
      }
    } catch {
      setStatus('offline')
    } finally {
      setIsPinging(false)
    }
  }, [])

  // Check on mount
  useEffect(() => {
    checkConnection(BACKEND_DOMAIN)
  }, [checkConnection])

  // Handle URL changes with debounce
  const handleChange = (e) => {
    const val = e.target.value
    setTunnelUrl(val)
    setBackendDomain(val)

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      checkConnection(val)
    }, 600)
  }

  const handleManualTest = () => {
    checkConnection(tunnelUrl)
  }

  const handleClear = () => {
    setTunnelUrl('')
    setBackendDomain('')
    checkConnection('')
  }

  return (
    <div className="landing-container">
      <div className="landing-wordmark" aria-label="Prosody.">
        <span>Pros</span><span className="landing-wordmark-accent">ody.</span>
      </div>

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

      {/* ── Seamless Minimalist Backend Connection Bar ─── */}
      <div className="landing-backend-bar">
        <span className={`landing-backend-dot ${status}`} title={`Backend status: ${status}`} />
        <input
          id="landing-tunnel-input"
          className="landing-backend-input"
          type="text"
          value={tunnelUrl}
          onChange={handleChange}
          placeholder="backend url (e.g. your-subdomain.trycloudflare.com)"
          spellCheck="false"
          autoComplete="off"
        />
        {tunnelUrl && (
          <button
            type="button"
            className="landing-backend-clear"
            onClick={handleClear}
            title="Clear URL"
          >
            ✕
          </button>
        )}
        <button
          type="button"
          className="landing-backend-status-btn"
          onClick={handleManualTest}
          disabled={isPinging}
          title="Click to test backend connection"
        >
          {status === 'connected' && 'online'}
          {status === 'checking' && 'testing…'}
          {status === 'offline' && 'offline'}
          {status === 'local' && 'local'}
          {status === 'idle' && (isPinging ? 'testing…' : 'connect')}
        </button>
      </div>
    </div>
  )
}
