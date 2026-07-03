import { AlertTriangle, Zap, Wifi, Clock, RefreshCw } from 'lucide-react'
import { useFaults } from '../hooks/useFaults'
import { format } from 'date-fns'

const FAULT_ICONS = {
  CRASH:        { icon: AlertTriangle, color: 'var(--cyber-red)',    badge: 'badge-crashed',  label: 'CRASH'        },
  TIMEOUT:      { icon: Clock,         color: 'var(--cyber-orange)', badge: 'badge-warn',     label: 'TIMEOUT'      },
  BATTERY_DEAD: { icon: Zap,           color: 'var(--cyber-yellow)', badge: 'badge-charging', label: 'BATT_DEAD'    },
  NETWORK_LOST: { icon: Wifi,          color: 'var(--cyber-purple)', badge: 'badge-idle',     label: 'NET_LOST'     },
}

function FaultRow({ fault, idx }) {
  const meta   = FAULT_ICONS[fault.fault_type] ?? FAULT_ICONS.CRASH
  const Icon   = meta.icon
  const ts     = fault.timestamp ? new Date(fault.timestamp * 1000) : null
  const timeStr = ts ? format(ts, 'HH:mm:ss') : '—'
  const dateStr = ts ? format(ts, 'MM/dd')    : ''

  return (
    <div
      className="flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-white/[0.02]"
      style={{
        borderBottom:    '1px solid rgba(26,46,80,0.5)',
        animationDelay:  `${idx * 30}ms`,
        animation:       'fadeIn 0.3s ease-out both',
      }}
    >
      {/* Icon */}
      <div
        className="flex items-center justify-center mt-0.5 shrink-0"
        style={{
          width:      24, height: 24,
          borderRadius: 2,
          background: `${meta.color}18`,
          border:     `1px solid ${meta.color}40`,
        }}
      >
        <Icon size={11} style={{ color: meta.color }} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className={`badge ${meta.badge}`} style={{ fontSize: '0.55rem' }}>
            {meta.label}
          </span>
          <span style={{ fontFamily: 'Orbitron', fontSize: '0.62rem', color: 'var(--cyber-text)', fontWeight: 600 }}>
            {(fault.robot_id ?? '').replace('robot_', 'R-')}
          </span>
          {fault.task_id && (
            <span style={{ fontFamily: 'Share Tech Mono', fontSize: '0.58rem', color: 'var(--cyber-muted)' }}>
              · {fault.task_id.slice(0, 14)}
            </span>
          )}
        </div>
        {fault.details && (
          <div style={{ fontFamily: 'Share Tech Mono', fontSize: '0.6rem', color: 'var(--cyber-muted)' }}>
            {fault.details}
          </div>
        )}
      </div>

      {/* Timestamp */}
      <div className="text-right shrink-0">
        <div style={{ fontFamily: 'Share Tech Mono', fontSize: '0.65rem', color: 'var(--cyber-cyan)', letterSpacing: '0.04em' }}>
          {timeStr}
        </div>
        <div style={{ fontFamily: 'Share Tech Mono', fontSize: '0.55rem', color: 'var(--cyber-muted)' }}>
          {dateStr}
        </div>
      </div>
    </div>
  )
}

function ActiveFaultCard({ robotId, record }) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded-sm"
      style={{
        background:  'rgba(255,51,102,0.08)',
        border:      '1px solid rgba(255,51,102,0.3)',
        animation:   'pulse2 2s ease-in-out infinite',
      }}
    >
      <AlertTriangle size={12} style={{ color: 'var(--cyber-red)', flexShrink: 0 }} />
      <span style={{ fontFamily: 'Orbitron', fontSize: '0.65rem', color: 'var(--cyber-red)', fontWeight: 600 }}>
        {robotId.replace('robot_', 'R-')}
      </span>
      <span style={{ fontFamily: 'Share Tech Mono', fontSize: '0.6rem', color: 'rgba(255,51,102,0.8)' }}>
        {typeof record === 'object' ? (record.state ?? record.fault_type ?? 'FAULTED') : record}
      </span>
    </div>
  )
}

export default function FaultTimeline() {
  const { faults, loading, refresh } = useFaults()

  const active  = faults?.active  ?? {}
  const recent  = faults?.recent  ?? []
  const stats   = faults?.stats   ?? {}

  const activeEntries = Object.entries(active)

  return (
    <div className="flex flex-col h-full">
      <div className="panel-header">
        <AlertTriangle size={12} style={{ color: 'var(--cyber-red)' }} />
        <span className="panel-title" style={{ color: 'var(--cyber-red)' }}>Fault Timeline</span>
        <span style={{ fontFamily: 'Share Tech Mono', fontSize: '0.6rem', color: 'var(--cyber-muted)' }}>
          {recent.length} events
        </span>
        <div className="flex-1" />
        <button onClick={refresh} className="cyber-btn danger" style={{ padding: '2px 10px', fontSize: '0.58rem' }}>
          <RefreshCw size={9} style={{ display: 'inline', marginRight: 4 }} />
          REFRESH
        </button>
      </div>

      <div className="flex-1 panel-scroll flex flex-col">
        {/* Stats row */}
        <div
          className="flex items-center gap-6 px-4 py-3"
          style={{ borderBottom: '1px solid var(--cyber-border)', background: 'rgba(255,51,102,0.03)', flexShrink: 0 }}
        >
          {[
            { label: 'TOTAL CRASHES',     value: stats.total_crashes     ?? 0, color: 'var(--cyber-red)'    },
            { label: 'RECOVERIES',        value: stats.total_recoveries  ?? 0, color: 'var(--cyber-green)'  },
            { label: 'ACTIVE FAULTS',     value: activeEntries.length,          color: activeEntries.length > 0 ? 'var(--cyber-red)' : 'var(--cyber-muted)' },
            { label: 'TIMEOUT EVENTS',    value: stats.timeout_events    ?? 0, color: 'var(--cyber-orange)' },
          ].map(s => (
            <div key={s.label}>
              <div className="metric-number" style={{ fontSize: '1.1rem', color: s.color }}>{s.value}</div>
              <div style={{ fontFamily: 'Share Tech Mono', fontSize: '0.54rem', color: 'var(--cyber-muted)', letterSpacing: '0.08em' }}>
                {s.label}
              </div>
            </div>
          ))}
        </div>

        {/* Active faults */}
        {activeEntries.length > 0 && (
          <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--cyber-border)', flexShrink: 0 }}>
            <div style={{ fontFamily: 'Share Tech Mono', fontSize: '0.58rem', color: 'var(--cyber-red)', letterSpacing: '0.12em', marginBottom: 8 }}>
              ● ACTIVE FAULTS
            </div>
            <div className="flex flex-wrap gap-2">
              {activeEntries.map(([id, rec]) => (
                <ActiveFaultCard key={id} robotId={id} record={rec} />
              ))}
            </div>
          </div>
        )}

        {/* Recent fault list */}
        <div style={{ flexShrink: 0, padding: '8px 16px 4px' }}>
          <div style={{ fontFamily: 'Share Tech Mono', fontSize: '0.55rem', color: 'var(--cyber-muted)', letterSpacing: '0.12em' }}>
            RECENT EVENTS (newest first)
          </div>
        </div>

        <div className="flex-1 panel-scroll">
          {loading && recent.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <span style={{ fontFamily: 'Share Tech Mono', fontSize: '0.65rem', color: 'var(--cyber-muted)' }}>
                Loading fault history...
              </span>
            </div>
          ) : recent.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <div style={{ color: 'var(--cyber-green)', fontSize: '1.4rem' }}>✓</div>
              <span style={{ fontFamily: 'Share Tech Mono', fontSize: '0.65rem', color: 'var(--cyber-green)' }}>
                No fault events recorded
              </span>
            </div>
          ) : (
            [...recent].reverse().map((fault, i) => (
              <FaultRow key={i} fault={fault} idx={i} />
            ))
          )}
        </div>
      </div>
    </div>
  )
}