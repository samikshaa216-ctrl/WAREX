import { memo } from 'react'
import { robotColor } from '../utils/colors'

const EVENT_STYLE = {
  CRASH:            { icon: '💥', color: '#ff3366' },
  RECOVERY:         { icon: '🔧', color: '#00ff88' },
  TASK_ASSIGNED:    { icon: '📋', color: '#00d4ff' },
  TASK_COMPLETED:   { icon: '✅', color: '#00ff88' },
  ROBOT_REGISTERED: { icon: '🤖', color: '#9b59ff' },
  LOW_BATTERY:      { icon: '🔋', color: '#ffd700' },
  REROUTE:          { icon: '🔀', color: '#ff7a00' },
  MISSED_DEADLINE:  { icon: '⏰', color: '#ff3366' },
}

function fmt(ts) {
  return new Date(ts * 1000).toLocaleTimeString('en', { hour12: false })
}

function EventRow({ ev }) {
  if (ev.event_type === 'ROBOT_UPDATED') return null
  const style = EVENT_STYLE[ev.event_type] ?? { icon: '•', color: '#4a6080' }
  const col   = ev.robot_id ? robotColor(ev.robot_id) : style.color

  return (
    <div style={{
      display: 'flex',
      gap: 8,
      alignItems: 'flex-start',
      padding: '5px 0',
      borderBottom: '1px solid #0d1626',
      fontSize: 11,
    }}>
      <span style={{ minWidth: 16, fontSize: 12 }}>{style.icon}</span>
      <span style={{ color: '#2a3f60', fontFamily: 'monospace', minWidth: 58, fontSize: 10 }}>
        {fmt(ev.timestamp)}
      </span>
      <span style={{ color: col, fontFamily: 'monospace', minWidth: 28, fontWeight: 700 }}>
        {ev.robot_id?.replace('robot_', 'R') ?? ''}
      </span>
      <span style={{ color: style.color, flex: 1 }}>
        {ev.event_type.replace(/_/g, ' ')}
        {ev.task_id && (
          <span style={{ color: '#2a3f60' }}> · {ev.task_id.replace('task_', 'T')}</span>
        )}
      </span>
    </div>
  )
}

function LogRow({ line }) {
  const isError = /ERROR|CRASH|DEPLETED/i.test(line)
  const isWarn  = /WARN|LOW.BATTERY|MISSED/i.test(line)
  const isInfo  = /RECOVER|COMPLET|ASSIGN/i.test(line)
  const color   = isError ? '#ff3366' : isWarn ? '#ffd700' : isInfo ? '#00ff88' : '#4a6080'
  return (
    <div style={{ fontSize: 10, fontFamily: 'monospace', color, padding: '2px 0', lineHeight: 1.4 }}>
      {line}
    </div>
  )
}

export default memo(function EventFeed({ events, logs }) {
  const filtered = (events || []).filter(e => e.event_type !== 'ROBOT_UPDATED').slice(-20).reverse()
  const recent   = (logs   || []).slice(-20).reverse()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{
        fontSize: 10, fontFamily: 'monospace', letterSpacing: 1,
        color: '#4a6080', padding: '6px 10px',
        borderBottom: '1px solid #1a2e50', background: '#0d1626', flexShrink: 0,
      }}>
        FAULT / EVENT FEED
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 10px', minHeight: 0 }}>
        {filtered.length === 0
          ? <div style={{ color: '#2a3f60', fontFamily: 'monospace', fontSize: 11, padding: '10px 0' }}>
              No events yet...
            </div>
          : filtered.map((ev, i) => <EventRow key={i} ev={ev} />)
        }
      </div>

      <div style={{
        fontSize: 10, fontFamily: 'monospace', letterSpacing: 1,
        color: '#4a6080', padding: '6px 10px',
        borderTop: '1px solid #1a2e50', borderBottom: '1px solid #1a2e50',
        background: '#0d1626', flexShrink: 0,
      }}>
        SYSTEM LOG
      </div>
      <div style={{ maxHeight: 130, overflowY: 'auto', padding: '4px 10px', flexShrink: 0 }}>
        {recent.length === 0
          ? <div style={{ color: '#2a3f60', fontFamily: 'monospace', fontSize: 10, padding: '4px 0' }}>
              Waiting for logs...
            </div>
          : recent.map((line, i) => <LogRow key={i} line={typeof line === 'string' ? line : JSON.stringify(line)} />)
        }
      </div>
    </div>
  )
})