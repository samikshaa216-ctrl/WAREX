import { useState, useEffect } from 'react'
import { Activity, Wifi, WifiOff, Clock, Hexagon } from 'lucide-react'

const NAV_TABS = [
  { id: 'fleet',      label: 'Fleet Map' },
  { id: 'robots',     label: 'Robots' },
  { id: 'analytics',  label: 'Analytics' },
  { id: 'faults',     label: 'Faults' },
  { id: 'logs',       label: 'Logs' },
  { id: 'network',    label: 'Network' },
  { id: 'experiment', label: 'Experiments' },
]

export default function Topbar({ activeTab, onTabChange, connected, snapshot }) {
  const [time, setTime] = useState(new Date())

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  const active   = snapshot?.active_robots  ?? 0
  const crashed  = snapshot?.crashed_robots ?? 0
  const idle     = snapshot?.idle_robots    ?? 0
  const total    = active + crashed + idle

  const pad = n => String(n).padStart(2, '0')
  const timeStr = `${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())}`

  return (
    <header
      className="flex items-center gap-0 border-b shrink-0 relative z-10"
      style={{
        background:   'linear-gradient(180deg, #0d1a2e 0%, #0a1525 100%)',
        borderColor:  'var(--cyber-border)',
        height:       '52px',
        boxShadow:    '0 1px 0 rgba(0,212,255,0.15), 0 4px 20px rgba(0,0,0,0.4)',
      }}
    >
      {/* Logo */}
      <div
        className="flex items-center gap-2 px-4 shrink-0"
        style={{ borderRight: '1px solid var(--cyber-border)', height: '100%' }}
      >
        <Hexagon size={18} style={{ color: 'var(--cyber-cyan)' }} strokeWidth={1.5} />
        <span
          style={{
            fontFamily:    'Orbitron, monospace',
            fontSize:      '0.85rem',
            fontWeight:    700,
            letterSpacing: '0.18em',
            color:         'var(--cyber-cyan)',
            textShadow:    '0 0 12px rgba(0,212,255,0.5)',
          }}
        >
          WAREX
        </span>
        <span
          style={{
            fontFamily:    'Share Tech Mono, monospace',
            fontSize:      '0.58rem',
            color:         'var(--cyber-muted)',
            letterSpacing: '0.12em',
            alignSelf:     'flex-end',
            paddingBottom: '2px',
          }}
        >
          v2.0
        </span>
      </div>

      {/* Tabs */}
      <nav className="flex items-center h-full flex-1 px-2 gap-1 overflow-x-auto">
        {NAV_TABS.map(tab => {
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className="relative px-3 h-full flex items-center shrink-0 transition-all"
              style={{
                fontFamily:    'Orbitron, monospace',
                fontSize:      '0.6rem',
                fontWeight:    600,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color:         isActive ? 'var(--cyber-cyan)' : 'var(--cyber-muted)',
                background:    isActive ? 'rgba(0,212,255,0.06)' : 'transparent',
                border:        'none',
                cursor:        'pointer',
                borderBottom:  isActive ? '2px solid var(--cyber-cyan)' : '2px solid transparent',
                transition:    'all 0.2s',
              }}
            >
              {tab.label}
              {tab.id === 'faults' && crashed > 0 && (
                <span
                  className="ml-1 px-1 rounded-sm"
                  style={{
                    background:    'var(--cyber-red)',
                    color:         '#fff',
                    fontSize:      '0.5rem',
                    fontFamily:    'Share Tech Mono, monospace',
                    verticalAlign: 'middle',
                  }}
                >
                  {crashed}
                </span>
              )}
            </button>
          )
        })}
      </nav>

      {/* Right info bar */}
      <div
        className="flex items-center gap-4 px-4 shrink-0 h-full"
        style={{ borderLeft: '1px solid var(--cyber-border)' }}
      >
        {/* Mini fleet counters */}
        {total > 0 && (
          <div className="flex items-center gap-3">
            <MiniCounter label="ACT" value={active}  color="var(--cyber-green)" />
            <MiniCounter label="IDL" value={idle}    color="var(--cyber-cyan)"  />
            <MiniCounter label="ERR" value={crashed} color="var(--cyber-red)"   />
          </div>
        )}

        {/* WS status */}
        <div className="flex items-center gap-1.5">
          {connected
            ? <Wifi size={12} style={{ color: 'var(--cyber-green)' }} />
            : <WifiOff size={12} style={{ color: 'var(--cyber-red)' }} />
          }
          <span style={{ fontFamily: 'Share Tech Mono', fontSize: '0.6rem', color: connected ? 'var(--cyber-green)' : 'var(--cyber-red)' }}>
            {connected ? 'LIVE' : 'DISC'}
          </span>
        </div>

        {/* Clock */}
        <div className="flex items-center gap-1">
          <Clock size={11} style={{ color: 'var(--cyber-muted)' }} />
          <span style={{ fontFamily: 'Share Tech Mono', fontSize: '0.7rem', color: 'var(--cyber-cyan)', letterSpacing: '0.05em' }}>
            {timeStr}
          </span>
        </div>
      </div>
    </header>
  )
}

function MiniCounter({ label, value, color }) {
  return (
    <div className="flex items-center gap-1">
      <span style={{ fontFamily: 'Share Tech Mono', fontSize: '0.55rem', color: 'var(--cyber-muted)', letterSpacing: '0.1em' }}>
        {label}
      </span>
      <span style={{ fontFamily: 'Orbitron', fontSize: '0.7rem', fontWeight: 700, color }}>
        {value}
      </span>
    </div>
  )
}