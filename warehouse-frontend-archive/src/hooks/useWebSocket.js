import { useEffect, useRef, useState, useCallback } from 'react'
import wsService from '../services/ws'

/**
 * Subscribe to live WebSocket twin snapshots.
 * Returns { snapshot, connected, lastUpdated }
 */
export function useWebSocket() {
  const [snapshot, setSnapshot] = useState(null)
  const [connected, setConnected] = useState(false)
  const [lastUpdated, setLastUpdated] = useState(null)

  useEffect(() => {
    wsService.start()

    const unsubData   = wsService.subscribe((data) => {
      setSnapshot(data)
      setLastUpdated(Date.now())
    })
    const unsubStatus = wsService.onStatus((c) => setConnected(c))

    return () => {
      unsubData()
      unsubStatus()
    }
  }, [])

  return { snapshot, connected, lastUpdated }
}

export default useWebSocket