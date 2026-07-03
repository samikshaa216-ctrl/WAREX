const B = 'http://localhost:8080'

const get  = p => fetch(`${B}${p}`).then(r => r.ok ? r.json() : Promise.reject(r.status))
const post = (p, q={}) => {
  const qs = new URLSearchParams(q).toString()
  return fetch(qs ? `${B}${p}?${qs}` : `${B}${p}`, { method:'POST' })
    .then(r => r.ok ? r.json() : Promise.reject(r.status))
}

export const api = {
  status:       () => get('/api/status'),
  fleetMetrics: () => get('/api/metrics/fleet'),
  metrics:      () => get('/api/metrics'),
  faults:       () => get('/api/faults'),
  logs:         (n=60) => get(`/api/logs?n=${n}`),
  twinSnapshot: () => get('/api/twin/snapshot'),
  twinEvents:   (n=40) => get(`/api/twin/events?n=${n}`),
  network:      () => get('/api/network'),
  scenarios:    () => get('/api/experiment/scenarios'),
  setNetwork:   c => post('/api/network/condition', { condition: c }),
  runExperiment:(s,d) => post('/api/experiment/run', d ? {scenario:s,duration:d} : {scenario:s}),
  crashRobot:   id => fetch(`${B}/api/robots/${id}/crash`,{method:'POST'}).then(r=>r.json()).catch(()=>null),
  drainBattery: id => fetch(`${B}/api/robots/${id}/battery/drain`,{method:'POST'}).then(r=>r.json()).catch(()=>null),
}

export function connectWS(onMsg, onOpen, onClose) {
  let alive = true, timer = null, ws = null
  function connect() {
    if (!alive) return
    ws = new WebSocket('ws://localhost:8080/ws')
    ws.onopen    = () => { clearTimeout(timer); onOpen?.() }
    ws.onmessage = e => { try { onMsg(JSON.parse(e.data)) } catch {} }
    ws.onclose   = () => { onClose?.(); alive && (timer = setTimeout(connect, 2000)) }
    ws.onerror   = () => ws.close()
  }
  connect()
  return { close() { alive=false; clearTimeout(timer); ws?.close() } }
}
