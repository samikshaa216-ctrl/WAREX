import { useState, useEffect, useCallback } from 'react'
import { fetchFaults } from '../services/api'

export function useFaults(intervalMs = 4000) {
  const [faults, setFaults]   = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const data = await fetchFaults()
      setFaults(data)
    } catch (e) { /* skip */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, intervalMs)
    return () => clearInterval(t)
  }, [load, intervalMs])

  return { faults, loading, refresh: load }
}