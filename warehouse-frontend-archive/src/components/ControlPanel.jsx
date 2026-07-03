import { useState, useEffect, memo } from 'react'
import { api } from '../services/api'

function Btn({ label, color = '#00d4ff', onClick, loading, disabled, small }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      style={{
        background: 'transparent',
        border: `1px solid ${disabled ? '#1a2e50' : color}`,
        color: disabled ? '#2a3f60' : color,
        padding: small ? '5px 10px' : '7px 14px',
        borderRadius: 4,
        fontFamily: 'monospace',
        fontSize: small ? 10 : 11,
        letterSpacing: 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: loading ? 0.6 : 1,
        transition: 'all 0.15s',
        width: '100%',
        textAlign: 'center',
      }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = `${color}22` }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >
      {loading ? '...' : label}
    </button>
  )
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{
        fontSize: 9, fontFamily: 'monospace', letterSpacing: 2,
        color: '#4a6080', marginBottom: 8,
        borderBottom: '1px solid #1a2e50', paddingBottom: 4,
      }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function Sel({ value, onChange, options, placeholder }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        width: '100%', background: '#0d1626', border: '1px solid #1a2e50',
        color: '#c8d8f0', padding: '6px 8px', borderRadius: 4,
        fontFamily: 'monospace', fontSize: 11, cursor: 'pointer', marginBottom: 6,
      }}
    >
      <option value="">{placeholder}</option>
      {options.map(o => (
        <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>
      ))}
    </select>
  )
}

export default memo(function ControlPanel({ snapshot, onRefresh }) {
  const [robotIds,  setRobotIds]  = useState([])
  const [selRobot,  setSelRobot]  = useState('')
  const [netCond,   setNetCond]   = useState('')
  const [scenarios, setScenarios] = useState([])
  const [scenario,  setScenario]  = useState('')
  const [loading,   setLoading]   = useState({})
  const [feedback,  setFeedback]  = useState('')

  useEffect(() => {
    setRobotIds(Object.keys(snapshot?.robots ?? {}))
  }, [snapshot])

  useEffect(() => {
    api.scenarios().then(r => setScenarios(r.scenarios || [])).catch(() => {})
  }, [])

  const fb = (msg) => { setFeedback(msg); setTimeout(() => setFeedback(''), 2500) }

  const run = (key, fn) => {
    setLoading(l => ({ ...l, [key]: true }))
    Promise.resolve(fn())
      .catch(e => fb(`Error: ${e.message}`))
      .finally(() => setLoading(l => ({ ...l, [key]: false })))
  }

  const NET = [
    { value: 'IDEAL',    label: '🟢 IDEAL'    },
    { value: 'GOOD',     label: '🔵 GOOD'     },
    { value: 'DEGRADED', label: '🟡 DEGRADED' },
    { value: 'POOR',     label: '🟠 POOR'     },
    { value: 'OFFLINE',  label: '🔴 OFFLINE'  },
  ]

  return (
    <div style={{ padding: '10px 12px', overflowY: 'auto', height: '100%' }}>
      {feedback && (
        <div style={{
          background: '#00d4ff11', border: '1px solid #00d4ff33', color: '#00d4ff',
          padding: '6px 10px', borderRadius: 4, fontFamily: 'monospace',
          fontSize: 10, marginBottom: 10, textAlign: 'center',
        }}>
          {feedback}
        </div>
      )}

      <Section title="── ROBOT TARGET ──">
        <Sel value={selRobot} onChange={setSelRobot}
          options={robotIds.map(id => ({ value: id, label: id.replace('robot_', 'Robot ') }))}
          placeholder="Select robot..." />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <Btn label="💥 CRASH" color="#ff3366" loading={loading.crash} disabled={!selRobot} small
            onClick={() => run('crash', async () => { await api.crashRobot(selRobot); fb(`Crashed ${selRobot}`) })} />
          <Btn label="🔋 LOW BAT" color="#ffd700" loading={loading.bat} disabled={!selRobot} small
            onClick={() => run('bat', async () => { await api.injectLowBattery(selRobot); fb(`Battery drain → ${selRobot}`) })} />
        </div>
      </Section>

      <Section title="── NETWORK ──">
        <Sel value={netCond} onChange={setNetCond} options={NET} placeholder="Network condition..." />
        <Btn label="APPLY CONDITION" color="#9b59ff" loading={loading.net} disabled={!netCond}
          onClick={() => run('net', async () => { await api.setNetwork(netCond); fb(`Network → ${netCond}`) })} />
      </Section>

      <Section title="── EXPERIMENTS ──">
        <Sel value={scenario} onChange={setScenario}
          options={scenarios.map(s => ({ value: s.name, label: s.name }))}
          placeholder="Select scenario..." />
        <Btn label="▶ LAUNCH" color="#00ff88" loading={loading.exp} disabled={!scenario}
          onClick={() => run('exp', async () => { await api.runExperiment(scenario); fb(`Started: ${scenario}`) })} />
      </Section>

      <Section title="── SYSTEM ──">
        <Btn label="↺ REFRESH DATA" color="#00d4ff" onClick={onRefresh} small />
      </Section>

      <div style={{ borderTop: '1px solid #1a2e50', paddingTop: 10 }}>
        <div style={{ fontSize: 9, fontFamily: 'monospace', color: '#4a6080', marginBottom: 6, letterSpacing: 1 }}>
          ── LEGEND ──
        </div>
        {[
          ['#ffd700', '⚡ Charging Dock'],
          ['#00ff88', '📦 Drop Zone'],
          ['#1a3a6a', '▪ Shelf / Obstacle'],
          ['#00d4ff', '━ Task Route Line'],
          ['#c8d8f0', '◉ Robot (click to select)'],
        ].map(([color, label]) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <div style={{ width: 10, height: 10, background: color, borderRadius: 2, flexShrink: 0, opacity: 0.8 }} />
            <span style={{ fontSize: 10, color: '#4a6080' }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
})