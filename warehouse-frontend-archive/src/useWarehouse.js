/**
 * useWarehouse.js
 * Single source-of-truth hook for the App.
 * Connects WebSocket for live snap, polls events/logs/metrics/faults.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { api, connectWS } from './api.js'

export default function useWarehouse() {
  const [snap,      setSnap]      = useState(null)
  const [events,    setEvents]    = useState([])
  const [logs,      setLogs]      = useState([])
  const [metrics,   setMetrics]   = useState(null)
  const [faults,    setFaults]    = useState(null)
  const [connected, setConnected] = useState(false)
  const wsRef    = useRef(null)
  const pollRef  = useRef(null)

  // ── WebSocket for live snapshot ─────────────────────────────────────────
  useEffect(() => {
    wsRef.current = connectWS(
      (data) => setSnap(data),
      ()     => setConnected(true),
      ()     => setConnected(false),
    )
    return () => wsRef.current?.close()
  }, [])

  // ── Polling for events / logs / metrics / faults ────────────────────────
  const poll = useCallback(async () => {
    try {
      const [evRes, logRes, mRes, fRes] = await Promise.allSettled([
        api.twinEvents(50),
        api.logs(80),
        api.fleetMetrics(),
        api.faults(),
      ])
      if (evRes.status  === 'fulfilled') setEvents(evRes.value?.events  ?? [])
      if (logRes.status === 'fulfilled') setLogs(logRes.value?.logs     ?? [])
      if (mRes.status   === 'fulfilled') setMetrics(mRes.value)
      if (fRes.status   === 'fulfilled') setFaults(fRes.value)
    } catch (_) {}
  }, [])

  useEffect(() => {
    poll()
    pollRef.current = setInterval(poll, 3000)
    return () => clearInterval(pollRef.current)
  }, [poll])

  return { snap, events, logs, metrics, faults, connected }
}