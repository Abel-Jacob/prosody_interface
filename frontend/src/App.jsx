import { useState } from 'react'
import CanvasBackground from './components/CanvasBackground'
import IdleState from './components/IdleState'
import ListeningState from './components/ListeningState'
import ProcessingState from './components/ProcessingState'
import SummaryState from './components/SummaryState'
import './index.css'

function App() {
  // state: 'idle' | 'listening' | 'processing' | 'summary'
  const [appState, setAppState] = useState('idle')
  const [jobId, setJobId] = useState(null)
  const [finalResult, setFinalResult] = useState(null)

  const handleStartListening = () => {
    setAppState('listening')
  }

  const handleStopListening = (newJobId) => {
    setJobId(newJobId)
    setAppState('processing')
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
    </>
  )
}

export default App
