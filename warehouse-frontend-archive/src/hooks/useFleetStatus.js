import { useState, useEffect, useCallback } from 'react'
import { fetchStatus } from '../services/api'

export function useFleetStatus(intervalMs = 5000) {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    try {
      const data = await fetchStatus()
      setStatus(data)
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()

    const timer = setInterval(load, intervalMs)

    return () => clearInterval(timer)
  }, [load, intervalMs])

  return {
    status,
    loading,
    error,
    refresh: load,
  }
}

export default useFleetStatus