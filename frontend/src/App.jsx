import { useState } from 'react'
import CanvasBackground from './components/CanvasBackground'
import IdleState from './components/IdleState'
import ListeningState from './components/ListeningState'
import ProcessingState from './components/ProcessingState'
import SummaryState from './components/SummaryState'
import './index.css'
import { BACKEND_DOMAIN, setBackendDomain } from './apiConfig'

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
      
      {appState === 'idle' && (
        <IdleState onStart={handleStartListening} />
      )}
      
      {appState === 'listening' && (
        <ListeningState onStop={handleStopListening} />
      )}
      
      {appState === 'processing' && (
        <ProcessingState 
          jobId={jobId} 
          onComplete={handleProcessingComplete} 
        />
      )}
      
      {appState === 'summary' && (
        <SummaryState 
          result={finalResult} 
          onReset={handleReset} 
        />
      )}

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
        <label style={{ fontSize: '10px', color: '#888', textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'var(--font-secondary)' }}>Tunnel URL:</label>
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
            fontSize: '11px',
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
