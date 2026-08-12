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
    let pollCount = 0

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
        pollCount++
        // Backoff: 250ms for first 10 polls (~2.5s), 500ms for next 10 polls (~5s), then cap at 1000ms
        let delay = 250
        if (pollCount > 20) {
          delay = 1000
        } else if (pollCount > 10) {
          delay = 500
        }
        timeoutId = setTimeout(pollJob, delay)
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

