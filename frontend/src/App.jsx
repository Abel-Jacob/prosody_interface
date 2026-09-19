import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import CanvasBackground from './components/CanvasBackground'
import IdleState from './components/IdleState'
import ListeningState from './components/ListeningState'
import ProcessingState from './components/ProcessingState'
import SummaryState from './components/SummaryState'
import AnnotationReport from './components/AnnotationReport'
import './index.css'
import { getHttpUrl } from './apiConfig'

/* Cross-fade transition shared by all state wrappers.
   Critically damped (bounce: 0), ~200ms — system-driven, not gesture. */
const stateTransition = { type: 'spring', duration: 0.2, bounce: 0 }

function App({ onBack }) {
  // state: 'idle' | 'listening' | 'processing' | 'summary' | 'annotation'
  const [appState, setAppState] = useState('idle')
  const [jobId, setJobId] = useState(null)
  const [finalResult, setFinalResult] = useState(null)
  const [annotationData, setAnnotationData] = useState(null)

  const handleStartListening = () => {
    setAppState('listening')
  }

  const handleStopListening = (response) => {
    // Finding 11(b): haptic pulse when recording stops & hands off
    if (navigator.vibrate) navigator.vibrate(10)

    if (response && response.result) {
      setJobId(response.jobId || null)
      setFinalResult(response.result)
      setAppState('summary')
    } else {
      setJobId(response?.jobId || response)
      setAppState('processing')
    }
  }

  const handleProcessingComplete = async (result) => {
    setFinalResult(result)
    if (result && result.is_batch) {
      try {
        await handleViewAnnotation(jobId)
      } catch (err) {
        console.error('Failed to view batch annotation, falling back to summary:', err)
        setAppState('summary')
      }
    } else {
      setAppState('summary')
    }
  }

  const handleViewAnnotation = async (id) => {
    if (!id) return
    try {
      const response = await fetch(getHttpUrl(`/api/jobs/${id}/annotation`))
      if (!response.ok) {
        throw new Error(`Failed to fetch annotation: ${response.statusText}`)
      }
      const data = await response.json()
      setAnnotationData(data)
      setAppState('annotation')
    } catch (err) {
      console.error(err)
      alert(`Error loading annotation: ${err.message}`)
    }
  }

  const handleUploadAudio = async (filesOrFile) => {
    setAppState('processing')
    const formData = new FormData()
    if (Array.isArray(filesOrFile)) {
      filesOrFile.forEach((f) => {
        formData.append('files', f)
      })
    } else {
      formData.append('audio', filesOrFile)
    }
    try {
      const response = await fetch(getHttpUrl('/api/jobs'), {
        method: 'POST',
        body: formData,
      })
      if (!response.ok) {
        let errMsg = response.statusText
        try {
          const errData = await response.json()
          if (errData?.detail) errMsg = errData.detail
        } catch (_) {}
        throw new Error(errMsg)
      }
      const data = await response.json()
      setJobId(data.job_id)
    } catch (err) {
      console.error(err)
      alert(`Error uploading audio: ${err.message}`)
      setAppState('idle')
    }
  }

  const handleReset = () => {
    setJobId(null)
    setFinalResult(null)
    setAnnotationData(null)
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
            <IdleState onStart={handleStartListening} onUpload={handleUploadAudio} onBack={onBack} />
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
            <ListeningState onStop={handleStopListening} onCancel={handleReset} />
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
              onReset={handleReset}
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
              jobId={jobId}
              onReset={handleReset} 
              onViewAnnotation={handleViewAnnotation}
            />
          </motion.div>
        )}

        {appState === 'annotation' && (
          <motion.div
            key="annotation"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={stateTransition}
          >
            <AnnotationReport 
              data={annotationData} 
              onBack={() => {
                if (finalResult && finalResult.is_batch) {
                  handleReset()
                } else {
                  setAppState('summary')
                }
              }} 
            />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

export default App
