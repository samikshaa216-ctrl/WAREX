import { useState, useEffect, useRef, useCallback } from 'react'
import { createWebSocket, api } from '../services/api'

export function useTwinSocket() {
  const [snapshot, setSnapshot] = useState(null)
  const [connected, setConnected] = useState(false)
  const [events, setEvents] = useState([])
  const wsRef = useRef(null)

  const handleMessage = useCallback((data) => {
    setSnapshot(data)
  }, [])

  useEffect(() => {
    wsRef.current = createWebSocket(
      handleMessage,
      () => setConnected(true),
      () => setConnected(false),
    )

    const evtTimer = setInterval(async () => {
      try {
        const r = await api.twinEvents(30)
        setEvents(r.events || [])
      } catch {}
    }, 3000)

    return () => {
      wsRef.current?.close()
      clearInterval(evtTimer)
    }
  }, [handleMessage])

  return { snapshot, connected, events }
}