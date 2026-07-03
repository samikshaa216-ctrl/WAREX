/**
 * services/api.js — complete, all hooks + App.jsx covered
 */
const BASE = 'http://localhost:8080'
const get  = p => fetch(`${BASE}${p}`).then(r => r.ok ? r.json() : Promise.reject(r.status))
const post = (p, q={}) => {
  const qs = new URLSearchParams(q).toString()
  return fetch(qs ? `${BASE}${p}?${qs}` : `${BASE}${p}`, {method:'POST'})
    .then(r => r.ok ? r.json() : Promise.reject(r.status))
}

export const api = {
  status:        ()      => get('/api/status'),
  fleetMetrics:  ()      => get('/api/metrics/fleet'),
  metrics:       ()      => get('/api/metrics'),
  faults:        ()      => get('/api/faults'),
  logs:          (n=60)  => get(`/api/logs?n=${n}`),
  twinSnapshot:  ()      => get('/api/twin/snapshot'),
  twinEvents:    (n=40)  => get(`/api/twin/events?n=${n}`),
  network:       ()      => get('/api/network'),
  scenarios:     ()      => get('/api/experiment/scenarios'),
  setNetwork:    c       => post('/api/network/condition', {condition:c}),
  runExperiment: (s,d)   => post('/api/experiment/run', d?{scenario:s,duration:d}:{scenario:s}),
  setCrashMode:  mode    => post('/api/experiment/crash_mode', {mode}),
  crashRobot:    id      => fetch(`${BASE}/api/robots/${id}/crash`,         {method:'POST'}).then(r=>r.json()).catch(()=>null),
  drainBattery:  id      => fetch(`${BASE}/api/robots/${id}/battery/drain`, {method:'POST'}).then(r=>r.json()).catch(()=>null),
}

export const fetchStatus         = ()       => api.status()
export const fetchFleetMetrics   = ()       => api.fleetMetrics()
export const fetchAllMetrics     = ()       => api.metrics()
export const fetchFaults         = ()       => api.faults()
export const fetchLogs           = (o={})   => get(`/api/logs?n=${o.n||100}${o.robot_id?`&robot_id=${o.robot_id}`:''}${o.level?`&level=${o.level}`:''}`)
export const fetchNetwork        = ()       => api.network()
export const fetchScenarios      = ()       => api.scenarios()
export const runExperiment       = (s,d)    => api.runExperiment(s,d)
export const setNetworkCondition = c        => api.setNetwork(c)

export function connectWS(onMsg, onOpen, onClose) {
  let alive=true, timer=null, ws=null
  function connect() {
    if (!alive) return
    ws = new WebSocket('ws://localhost:8080/ws')
    ws.onopen    = () => { clearTimeout(timer); onOpen?.() }
    ws.onmessage = e => { try { onMsg(JSON.parse(e.data)) } catch {} }
    ws.onclose   = () => { onClose?.(); if (alive) timer=setTimeout(connect,2000) }
    ws.onerror   = () => ws.close()
  }
  connect()
  return { close() { alive=false; clearTimeout(timer); ws?.close() } }
}
export const createWebSocket = connectWS

const _subs=new Set(), _stat=new Set()
let _ws2=null
function _boot() {
  if (_ws2) return
  _ws2 = connectWS(
    d => _subs.forEach(f=>f(d)),
    ()=>{ _stat.forEach(f=>f(true)) },
    ()=>{ _stat.forEach(f=>f(false)); _ws2=null; setTimeout(_boot,2000) }
  )
}
const wsService = {
  start()     { _boot() },
  subscribe(f){ _subs.add(f); return ()=>_subs.delete(f) },
  onStatus(f) { _stat.add(f); return ()=>_stat.delete(f) },
}
export default wsService