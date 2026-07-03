import { useState, useEffect, useCallback } from 'react'
import { fetchLogs } from '../services/api'

export function useLogs({ robotId, level, search, n = 150 } = {}) {
  const [logs, setLogs]     = useState([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchLogs({
        n,
        robot_id: robotId || undefined,
        level:    level   || undefined,
      })
      setLogs(data.logs ?? [])
    } catch (e) { /* skip */ }
    finally { setLoading(false) }
  }, [robotId, level, n])

  useEffect(() => {
    load()
    const t = setInterval(load, 4000)
    return () => clearInterval(t)
  }, [load])

  // Client-side search filter
  const filtered = search
    ? logs.filter(l => {
        const s = search.toLowerCase()
        return (
          (l.message ?? '').toLowerCase().includes(s) ||
          (l.robot_id ?? '').toLowerCase().includes(s) ||
          (l.event ?? '').toLowerCase().includes(s)
        )
      })
    : logs

  return { logs: filtered, loading, refresh: load }
}