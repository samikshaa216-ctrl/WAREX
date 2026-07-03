import { useState, useEffect, useCallback } from 'react'
import { fetchNetwork, setNetworkCondition } from '../services/api'

export function useNetwork() {
  const [networkData, setNetworkData] = useState(null)
  const [applying, setApplying]       = useState(false)
  const [lastApplied, setLastApplied] = useState(null)

  const load = useCallback(async () => {
    try {
      const d = await fetchNetwork()
      setNetworkData(d)
    } catch (e) { /* skip */ }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [load])

  const applyCondition = useCallback(async (condition) => {
    setApplying(true)
    try {
      const res = await setNetworkCondition(condition)
      setLastApplied(res)
      await load()
    } catch (e) { /* skip */ }
    finally { setApplying(false) }
  }, [load])

  return { networkData, applying, lastApplied, applyCondition, refresh: load }
}