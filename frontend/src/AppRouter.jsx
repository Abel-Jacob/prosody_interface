import React, { useState, Component } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import CanvasBackground from './components/CanvasBackground'
import LandingPage from './components/LandingPage'
import LexiRepTrainPage from './components/LexiRepTrainPage'
import App from './App'

class PageErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('Page-level crash caught by PageErrorBoundary:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          textAlign: 'center',
          background: 'var(--bg, #0a0a0f)',
          color: 'var(--text-primary, #ffffff)'
        }}>
          <h2 style={{ color: '#f87171', fontFamily: 'var(--font-mono, monospace)', fontSize: '1.2rem', marginBottom: '1rem' }}>
            Application Render Error
          </h2>
          <p style={{ maxWidth: '30rem', color: 'var(--text-muted, #888)', fontSize: '0.85rem', lineHeight: '1.6', marginBottom: '1.5rem' }}>
            {this.state.error?.message || 'An unexpected rendering error occurred.'}
          </p>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null })
              if (this.props.onReset) this.props.onReset()
            }}
            style={{
              padding: '10px 20px',
              borderRadius: '4px',
              border: '1px solid var(--border-strong, #444)',
              background: 'var(--accent, #c4956a)',
              color: 'var(--bg, #000)',
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: '0.75rem',
              fontWeight: 600,
              cursor: 'pointer',
              textTransform: 'uppercase'
            }}
          >
            Return to Dashboard
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

/**
 * AppRouter — Page-level routing layer.
 *
 * Sits above App.jsx (which is completely untouched) and adds a
 * landing page as the new entry point. Uses the same state-machine
 * and AnimatePresence cross-fade pattern as App.jsx internally does.
 *
 * Pages:
 *   'landing'  → LandingPage (new default entry)
 *   'prosody'  → App (existing recording interface, unchanged)
 *   'lexirep'  → LexiRepTrainPage (new training page)
 */

const pageTransition = { type: 'spring', duration: 0.25, bounce: 0 }

export default function AppRouter() {
  const [page, setPage] = useState('landing')

  return (
    <>
      {/* Canvas background shown on landing and lexirep pages;
          App.jsx has its own CanvasBackground internally */}
      {page !== 'prosody' && <CanvasBackground active={false} waveform={page === 'landing'} />}

      <AnimatePresence mode="wait">
        {page === 'landing' && (
          <motion.div
            key="landing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={pageTransition}
          >
            <LandingPage onNavigate={setPage} />
          </motion.div>
        )}

        {page === 'prosody' && (
          <motion.div
            key="prosody"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={pageTransition}
          >
            <PageErrorBoundary onReset={() => setPage('landing')}>
              <App onBack={() => setPage('landing')} />
            </PageErrorBoundary>
          </motion.div>
        )}

        {page === 'lexirep' && (
          <motion.div
            key="lexirep"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={pageTransition}
          >
            <PageErrorBoundary onReset={() => setPage('landing')}>
              <LexiRepTrainPage onBack={() => setPage('landing')} />
            </PageErrorBoundary>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
