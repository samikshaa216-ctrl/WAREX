import { useState, useEffect, useCallback, useRef } from 'react'
import { fetchFleetMetrics, fetchAllMetrics } from '../services/api'

export function useMetrics(intervalMs = 6000) {
  const [fleet, setFleet]   = useState(null)
  const [all, setAll]       = useState(null)
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const [f, a] = await Promise.all([fetchFleetMetrics(), fetchAllMetrics()])
      setFleet(f)
      setAll(a)
      setHistory(prev => {
        const next = [...prev, {
          ts:         Date.now(),
          mttr:       f.fleet_mttr_s,
          mtbf:       Math.min(f.fleet_mtbf_s, 9999),
          uptime_pct: f.system?.uptime_pct ?? 100,
        }]
        return next.slice(-40)
      })
    } catch (e) { /* silently skip */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, intervalMs)
    return () => clearInterval(t)
  }, [load, intervalMs])

  return { fleet, all, history, loading }
}