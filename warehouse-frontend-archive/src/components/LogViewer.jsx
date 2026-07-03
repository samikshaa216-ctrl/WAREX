import { useState, useRef, useEffect } from 'react'
import { Terminal, Search, Filter, RefreshCw, ArrowDown } from 'lucide-react'
import { useLogs } from '../hooks/useLogs'
import { format } from 'date-fns'

const LEVEL_META = {
  DEBUG:    { color: 'var(--cyber-muted)',  badge: 'badge-idle'     },
  INFO:     { color: 'var(--cyber-cyan)',   badge: 'badge-info'     },
  WARNING:  { color: 'var(--cyber-yellow)', badge: 'badge-warn'     },
  ERROR:    { color: 'var(--cyber-red)',    badge: 'badge-crashed'  },
  CRITICAL: { color: 'var(--cyber-red)',    badge: 'badge-critical' },
}

const LEVELS   = ['ALL', 'DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL']
const ROBOT_IDS = ['ALL', 'robot_0', 'robot_1', 'robot_2', 'robot_3', 'robot_4', 'robot_5']

function LogLine({ log, idx }) {
  const meta    = LEVEL_META[log.level] ?? LEVEL_META.INFO
  const ts      = log.timestamp ? new Date(log.timestamp * 1000) : null
  const timeStr = ts ? format(ts, 'HH:mm:ss.SSS') : '—'

  return (
    <div
      className="flex items-start gap-2 px-3 py-1.5 hover:bg-white/[0.02] transition-colors"
      style={{
        borderBottom:   'none',
        borderLeft:     `2px solid ${meta.color}50`,
        marginLeft:     4,
        animationDelay: `${Math.min(idx * 15, 200)}ms`,
        animation:      'fadeIn 0.2s ease-out both',
      }}
    >
      {/* Timestamp */}
      <span
        style={{
          fontFamily:  'Share Tech Mono',
          fontSize:    '0.62rem',
          color:       'var(--cyber-muted)',
          whiteSpace:  'nowrap',
          flexShrink:  0,
          marginTop:   1,
        }}
      >
        {timeStr}
      </span>

      {/* Level badge */}
      <span className={`badge ${meta.badge} shrink-0`} style={{ fontSize: '0.52rem', marginTop: 1 }}>
        {(log.level ?? 'INFO').slice(0, 4)}
      </span>

      {/* Robot */}
      {log.robot_id && (
        <span
          style={{
            fontFamily: 'Orbitron',
            fontSize:   '0.58rem',
            color:      'var(--cyber-cyan)',
            flexShrink: 0,
            marginTop:  1,
          }}
        >
          {log.robot_id.replace('robot_', 'R')}
        </span>
      )}

      {/* Event */}
      {log.event && (
        <span style={{
          fontFamily: 'Share Tech Mono',
          fontSize:   '0.6rem',
          color:      'rgba(155,89,255,0.9)',
          flexShrink: 0,
          marginTop:  1,
        }}>
          [{log.event}]
        </span>
      )}

      {/* Message */}
      <span
        style={{
          fontFamily:  'Share Tech Mono',
          fontSize:    '0.63rem',
          color:       meta.color,
          wordBreak:   'break-word',
          lineHeight:  1.4,
        }}
      >
        {log.message ?? JSON.stringify(log)}
      </span>
    </div>
  )
}

export default function LogViewer() {
  const [robotFilter, setRobotFilter] = useState('ALL')
  const [levelFilter, setLevelFilter] = useState('ALL')
  const [search,      setSearch]      = useState('')
  const [autoScroll,  setAutoScroll]  = useState(true)
  const bottomRef = useRef(null)

  const { logs, loading, refresh } = useLogs({
    robotId: robotFilter !== 'ALL' ? robotFilter : undefined,
    level:   levelFilter !== 'ALL' ? levelFilter : undefined,
    search,
    n:       200,
  })

  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs, autoScroll])

  return (
    <div className="flex flex-col h-full">
      <div className="panel-header">
        <Terminal size={12} style={{ color: 'var(--cyber-cyan)' }} />
        <span className="panel-title">Log Viewer</span>
        <span style={{ fontFamily: 'Share Tech Mono', fontSize: '0.6rem', color: 'var(--cyber-muted)' }}>
          {logs.length} lines
        </span>
        <div className="flex-1" />
        <button
          onClick={() => setAutoScroll(v => !v)}
          style={{
            fontFamily:   'Share Tech Mono',
            fontSize:     '0.58rem',
            background:   autoScroll ? 'rgba(0,212,255,0.12)' : 'transparent',
            border:       `1px solid ${autoScroll ? 'var(--cyber-cyan)' : 'var(--cyber-border)'}`,
            color:        autoScroll ? 'var(--cyber-cyan)' : 'var(--cyber-muted)',
            padding:      '2px 8px',
            cursor:       'pointer',
            borderRadius: 2,
            marginRight:  6,
          }}
        >
          <ArrowDown size={9} style={{ display: 'inline', marginRight: 3 }} />
          AUTO
        </button>
        <button onClick={refresh} className="cyber-btn" style={{ padding: '2px 10px', fontSize: '0.58rem' }}>
          <RefreshCw size={9} style={{ display: 'inline', marginRight: 4 }} />
          REFRESH
        </button>
      </div>

      {/* Filters */}
      <div
        className="flex items-center gap-3 px-4 py-2 flex-wrap"
        style={{ borderBottom: '1px solid var(--cyber-border)', background: 'rgba(0,212,255,0.02)', flexShrink: 0 }}
      >
        {/* Search */}
        <div className="flex items-center gap-2 flex-1" style={{ minWidth: 160 }}>
          <Search size={11} style={{ color: 'var(--cyber-muted)' }} />
          <input
            type="text"
            placeholder="Search logs..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="cyber-input"
            style={{ flex: 1, padding: '4px 8px', fontSize: '0.65rem' }}
          />
        </div>

        {/* Robot filter */}
        <div className="flex items-center gap-2">
          <Filter size={10} style={{ color: 'var(--cyber-muted)' }} />
          <select
            value={robotFilter}
            onChange={e => setRobotFilter(e.target.value)}
            className="cyber-select"
            style={{ fontSize: '0.65rem', padding: '4px 8px' }}
          >
            {ROBOT_IDS.map(r => (
              <option key={r} value={r}>{r === 'ALL' ? 'All Robots' : r.replace('robot_', 'Robot ')}</option>
            ))}
          </select>
        </div>

        {/* Level filter */}
        <div className="flex gap-1">
          {LEVELS.map(l => {
            const meta = LEVEL_META[l]
            return (
              <button
                key={l}
                onClick={() => setLevelFilter(l)}
                style={{
                  fontFamily:   'Share Tech Mono',
                  fontSize:     '0.55rem',
                  letterSpacing:'0.06em',
                  background:   levelFilter === l ? (meta ? `${meta.color}20` : 'rgba(0,212,255,0.15)') : 'transparent',
                  border:       `1px solid ${levelFilter === l ? (meta?.color ?? 'var(--cyber-cyan)') : 'var(--cyber-border)'}`,
                  color:        levelFilter === l ? (meta?.color ?? 'var(--cyber-cyan)') : 'var(--cyber-muted)',
                  padding:      '2px 7px',
                  cursor:       'pointer',
                  borderRadius: 2,
                  transition:   'all 0.15s',
                }}
              >
                {l}
              </button>
            )
          })}
        </div>
      </div>

      {/* Log stream */}
      <div
        className="flex-1 panel-scroll"
        style={{
          background: '#04090f',
          fontFamily: 'Share Tech Mono',
        }}
        onScroll={e => {
          const el    = e.currentTarget
          const atBot = el.scrollHeight - el.scrollTop - el.clientHeight < 30
          setAutoScroll(atBot)
        }}
      >
        {loading && logs.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <span style={{ fontSize: '0.65rem', color: 'var(--cyber-muted)' }}>Loading logs...</span>
          </div>
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <Terminal size={20} style={{ color: 'var(--cyber-muted)', opacity: 0.4 }} />
            <span style={{ fontSize: '0.65rem', color: 'var(--cyber-muted)' }}>No logs match filters</span>
          </div>
        ) : (
          <>
            {logs.map((log, i) => (
              <LogLine key={`${log.timestamp}-${i}`} log={log} idx={i} />
            ))}
            <div ref={bottomRef} />
          </>
        )}
      </div>

      {/* Status bar */}
      <div
        className="flex items-center justify-between px-4 py-1.5"
        style={{ borderTop: '1px solid var(--cyber-border)', background: 'rgba(0,0,0,0.3)', flexShrink: 0 }}
      >
        <div style={{ fontFamily: 'Share Tech Mono', fontSize: '0.58rem', color: 'var(--cyber-muted)' }}>
          {robotFilter !== 'ALL' ? `Robot: ${robotFilter}` : 'All robots'} ·{' '}
          {levelFilter !== 'ALL' ? `Level: ${levelFilter}` : 'All levels'}
          {search ? ` · Search: "${search}"` : ''}
        </div>
        <div style={{ fontFamily: 'Share Tech Mono', fontSize: '0.58rem', color: autoScroll ? 'var(--cyber-cyan)' : 'var(--cyber-muted)' }}>
          {autoScroll ? '▼ AUTO-SCROLL' : '■ PAUSED'}
        </div>
      </div>
    </div>
  )
}