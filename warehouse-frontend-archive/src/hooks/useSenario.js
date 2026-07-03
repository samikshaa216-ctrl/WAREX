import { useState, useEffect, useCallback } from 'react'
import { fetchScenarios, runExperiment } from '../services/api'

export function useScenarios() {
  const [scenarios, setScenarios]     = useState([])
  const [running, setRunning]         = useState(false)
  const [lastResult, setLastResult]   = useState(null)
  const [error, setError]             = useState(null)

  useEffect(() => {
    fetchScenarios()
      .then(d => setScenarios(d.scenarios ?? []))
      .catch(() => setScenarios([]))
  }, [])

  const launch = useCallback(async (scenario, duration) => {
    setRunning(true)
    setError(null)
    try {
      const res = await runExperiment(scenario, duration)
      setLastResult(res)
    } catch (e) {
      setError(e?.response?.data?.detail ?? e.message)
    } finally {
      setRunning(false)
    }
  }, [])

  return { scenarios, running, lastResult, error, launch }
}