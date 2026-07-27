import { useState, useEffect, useRef } from 'react'
import { getHttpUrl } from '../apiConfig'

export function useJobPolling(jobId, onComplete) {
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('queued')
  const [error, setError] = useState(null)
  
  const onCompleteRef = useRef(onComplete)
  useEffect(() => {
    onCompleteRef.current = onComplete
  }, [onComplete])

  useEffect(() => {
    if (!jobId) return

    let isPolling = true
    let timeoutId

    const pollJob = async () => {
      if (!isPolling) return
      
      try {
        const response = await fetch(getHttpUrl(`/api/jobs/${jobId}`), {
          headers: {
            'ngrok-skip-browser-warning': 'true'
          }
        })
        if (!response.ok) {
          throw new Error('Failed to fetch job status')
        }
        
        const data = await response.json()
        
        if (isPolling) {
          setProgress(data.progress || 0)
          setStatus(data.status)
          
          if (data.status === 'complete') {
            if (onCompleteRef.current) {
              onCompleteRef.current(data.result)
            }
            return // Stop polling
          } else if (data.status === 'failed') {
            setError(data.error || 'Job failed')
            return // Stop polling
          }
        }
      } catch (err) {
        if (isPolling) {
          setError(err.message)
          return // Stop polling on error to prevent infinite loops
        }
      }
      
      if (isPolling) {
        // Schedule next poll only AFTER current request finishes
        timeoutId = setTimeout(pollJob, 1000)
      }
    }

    // Initial poll
    pollJob()

    return () => {
      isPolling = false
      clearTimeout(timeoutId)
    }
  }, [jobId]) // Removed onComplete from dependencies

  return { progress, status, error }
}

