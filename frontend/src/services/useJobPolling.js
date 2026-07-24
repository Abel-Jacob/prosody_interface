import { useState, useEffect } from 'react'

export function useJobPolling(jobId, onComplete) {
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('queued')
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!jobId) return

    let pollInterval
    let isPolling = true

    const pollJob = async () => {
      try {
        const response = await fetch(`/api/jobs/${jobId}`)
        if (!response.ok) {
          throw new Error('Failed to fetch job status')
        }
        
        const data = await response.json()
        
        if (isPolling) {
          setProgress(data.progress || 0)
          setStatus(data.status)
          
          if (data.status === 'complete') {
            clearInterval(pollInterval)
            if (onComplete) {
              onComplete(data.result)
            }
          } else if (data.status === 'failed') {
            clearInterval(pollInterval)
            setError(data.error || 'Job failed')
          }
        }
      } catch (err) {
        if (isPolling) {
          setError(err.message)
          clearInterval(pollInterval)
        }
      }
    }

    // Initial poll
    pollJob()
    
    // Poll every 1 second
    pollInterval = setInterval(pollJob, 1000)

    return () => {
      isPolling = false
      clearInterval(pollInterval)
    }
  }, [jobId, onComplete])

  return { progress, status, error }
}
