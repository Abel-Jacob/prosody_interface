import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import CanvasBackground from './components/CanvasBackground'
import IdleState from './components/IdleState'
import ListeningState from './components/ListeningState'
import ProcessingState from './components/ProcessingState'
import SummaryState from './components/SummaryState'
import './index.css'
import { BACKEND_DOMAIN, setBackendDomain } from './apiConfig'

/* Cross-fade transition shared by all state wrappers.
   Critically damped (bounce: 0), ~200ms — system-driven, not gesture. */
const stateTransition = { type: 'spring', duration: 0.2, bounce: 0 }

function App() {
  // state: 'idle' | 'listening' | 'processing' | 'summary'
  const [appState, setAppState] = useState('idle')
  const [jobId, setJobId] = useState(null)
  const [finalResult, setFinalResult] = useState(null)
  const [backendUrl, setBackendUrl] = useState(BACKEND_DOMAIN)

  const handleStartListening = () => {
    setAppState('listening')
  }

  const handleStopListening = (response) => {
    // Finding 11(b): haptic pulse when recording stops & hands off
    if (navigator.vibrate) navigator.vibrate(10)

    if (response && response.result) {
      setFinalResult(response.result)
      setAppState('summary')
    } else {
      setJobId(response?.jobId || response)
      setAppState('processing')
    }
  }

  const handleProcessingComplete = (result) => {
    setFinalResult(result)
    setAppState('summary')
  }

  const handleReset = () => {
    setJobId(null)
    setFinalResult(null)
    setAppState('idle')
  }

  return (
    <>
      <CanvasBackground active={appState === 'listening'} />
      
      {/* Finding 1: AnimatePresence cross-fade around state mount/unmount.
          mode="wait" ensures exiting state fully fades before entering state
          fades in, preventing DOM overlap. Keys must be unique per state. */}
      <AnimatePresence mode="wait">
        {appState === 'idle' && (
          <motion.div
            key="idle"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={stateTransition}
          >
            <IdleState onStart={handleStartListening} />
          </motion.div>
        )}
        
        {appState === 'listening' && (
          <motion.div
            key="listening"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={stateTransition}
          >
            <ListeningState onStop={handleStopListening} />
          </motion.div>
        )}
        
        {appState === 'processing' && (
          <motion.div
            key="processing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={stateTransition}
          >
            <ProcessingState 
              jobId={jobId} 
              onComplete={handleProcessingComplete} 
            />
          </motion.div>
        )}
        
        {appState === 'summary' && (
          <motion.div
            key="summary"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={stateTransition}
          >
            <SummaryState 
              result={finalResult} 
              onReset={handleReset} 
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Backend Configuration UI */}
      <div style={{
        position: 'fixed',
        bottom: '20px',
        left: '20px',
        zIndex: 9999,
        background: 'rgba(0,0,0,0.5)',
        padding: '8px 12px',
        borderRadius: '8px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px'
      }}>
        {/* Finding 10 audit: converted px font-sizes to rem */}
        <label style={{ fontSize: '0.625rem', color: '#888', textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'var(--font-secondary)' }}>Tunnel URL:</label>
        <input 
          type="text" 
          value={backendUrl}
          onChange={(e) => {
            setBackendUrl(e.target.value)
            setBackendDomain(e.target.value)
          }}
          placeholder="e.g. random-words.trycloudflare.com"
          style={{
            background: 'transparent',
            border: '1px solid #333',
            color: '#ccc',
            padding: '4px 8px',
            borderRadius: '4px',
            fontSize: '0.6875rem',
            fontFamily: 'monospace',
            width: '240px',
            outline: 'none'
          }}
        />
      </div>
    </>
  )
}

export default App
