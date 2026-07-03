import { useState } from 'react'
import { Wifi, Activity, AlertTriangle, CheckCircle } from 'lucide-react'
import { useNetwork } from '../hooks/useNetwork'

const CONDITIONS = [
  {
    id:      'GOOD',
    label:   'GOOD',
    desc:    'Low latency, minimal loss',
    color:   'var(--cyber-green)',
    latency: 5,
    loss:    0.1,
  },
  {
    id:      'DEGRADED',
    label:   'DEGRADED',
    desc:    'Elevated latency, some packet loss',
    color:   'var(--cyber-yellow)',
    latency: 40,
    loss:    5,
  },
  {
    id:      'POOR',
    label:   'POOR',
    desc:    'High latency, significant loss',
    color:   'var(--cyber-orange)',
    latency: 120,
    loss:    15,
  },
  {
    id:      'OFFLINE',
    label:   'OFFLINE',
    desc:    'Complete network loss (100%)',
    color:   'var(--cyber-red)',
    latency: 0,
    loss:    100,
  },
]

function QualityGauge({ score }) {
  const pct   = Math.round((score ?? 0) * 100)
  const color = pct > 70 ? 'var(--cyber-green)' : pct > 40 ? 'var(--cyber-yellow)' : 'var(--cyber-red)'
  const r     = 28
  const circ  = 2 * Math.PI * r
  const dash  = (pct / 100) * circ

  return (
    <div style={{ position: 'relative', width: 72, height: 72 }}>
      <svg viewBox="0 0 72 72" width="72" height="72">
        <circle cx="36" cy="36" r={r} fill="none" stroke="#1a2e50" strokeWidth="4" />
        <circle
          cx="36" cy="36" r={r}
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          transform="rotate(-90 36 36)"
          style={{ filter: `drop-shadow(0 0 6px ${color})`, transition: 'stroke-dasharray 0.6s ease' }}
        />
      </svg>
      <div style={{
        position:   'absolute', inset: 0,
        display:    'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{ fontFamily: 'Orbitron', fontSize: '1rem', fontWeight: 700, color, lineHeight: 1 }}>{pct}</div>
        <div style={{ fontFamily: 'Share Tech Mono', fontSize: '0.5rem', color: 'var(--cyber-muted)' }}>QOS</div>
      </div>
    </div>
  )
}

function StatRow({ label, value, unit, color }) {
  return (
    <div className="flex items-center justify-between py-1.5" style={{ borderBottom: '1px solid rgba(26,46,80,0.5)' }}>
      <span style={{ fontFamily: 'Share Tech Mono', fontSize: '0.62rem', color: 'var(--cyber-muted)', letterSpacing: '0.08em' }}>
        {label}
      </span>
      <span style={{ fontFamily: 'Orbitron', fontSize: '0.75rem', fontWeight: 600, color: color ?? 'var(--cyber-cyan)' }}>
        {value}
        {unit && <span style={{ fontSize: '0.55rem', marginLeft: 2, opacity: 0.7 }}>{unit}</span>}
      </span>
    </div>
  )
}

export default function NetworkPanel() {
  const { networkData, applying, lastApplied, applyCondition } = useNetwork()
  const [selected, setSelected] = useState('GOOD')

  // Parse networkData — it may vary by backend version
  const fleetNet  = networkData ?? {}
  const profile   = fleetNet.profile ?? {}
  const stats     = fleetNet.stats   ?? {}
  const condition = fleetNet.condition ?? fleetNet.current_condition ?? '—'
  const qos       = typeof profile.quality_score === 'number' ? profile.quality_score : null

  const sent    = stats.packets_sent    ?? 0
  const dropped = stats.packets_dropped ?? 0
  const dropPct = sent > 0 ? ((dropped / sent) * 100).toFixed(2) : '0.00'

  return (
    <div className="flex flex-col h-full">
      <div className="panel-header">
        <Wifi size={12} style={{ color: 'var(--cyber-cyan)' }} />
        <span className="panel-title">Network Control</span>
      </div>

      <div className="flex-1 panel-scroll p-4 flex flex-col gap-4">
        {/* Current status */}
        <div className="cyber-card p-4">
          <div style={{ fontFamily: 'Share Tech Mono', fontSize: '0.58rem', color: 'var(--cyber-muted)', letterSpacing: '0.1em', marginBottom: 12 }}>
            CURRENT NETWORK STATUS
          </div>
          <div className="flex items-center gap-4">
            {qos !== null && <QualityGauge score={qos} />}
            <div className="flex-1 flex flex-col gap-1">
              <StatRow
                label="CONDITION"
                value={condition}
                color={
                  condition === 'GOOD'     ? 'var(--cyber-green)' :
                  condition === 'DEGRADED' ? 'var(--cyber-yellow)' :
                  condition === 'POOR'     ? 'var(--cyber-orange)' :
                  condition === 'OFFLINE'  ? 'var(--cyber-red)' :
                  'var(--cyber-muted)'
                }
              />
              <StatRow label="LATENCY"     value={profile.latency_ms?.toFixed(1) ?? '—'} unit="ms"  color="var(--cyber-cyan)" />
              <StatRow label="JITTER"      value={profile.jitter_ms?.toFixed(1)  ?? '—'} unit="ms"  color="var(--cyber-blue)" />
              <StatRow label="LOSS RATE"   value={profile.loss_rate != null ? (profile.loss_rate * 100).toFixed(1) : '—'} unit="%" color="var(--cyber-orange)" />
              <StatRow label="PKTS SENT"   value={sent.toLocaleString()}  color="var(--cyber-text)" />
              <StatRow label="PKTS DROPPED" value={`${dropped} (${dropPct}%)`} color={parseFloat(dropPct) > 5 ? 'var(--cyber-red)' : 'var(--cyber-muted)'} />
            </div>
          </div>
        </div>

        {/* Condition selector */}
        <div className="cyber-card p-4">
          <div style={{ fontFamily: 'Share Tech Mono', fontSize: '0.58rem', color: 'var(--cyber-muted)', letterSpacing: '0.1em', marginBottom: 12 }}>
            APPLY NETWORK CONDITION
          </div>
          <div className="grid grid-cols-2 gap-2 mb-4">
            {CONDITIONS.map(c => (
              <button
                key={c.id}
                onClick={() => setSelected(c.id)}
                style={{
                  background:   selected === c.id ? `${c.color}18` : 'rgba(0,0,0,0.3)',
                  border:       `1px solid ${selected === c.id ? c.color : 'var(--cyber-border)'}`,
                  color:        selected === c.id ? c.color : 'var(--cyber-muted)',
                  padding:      '10px 12px',
                  cursor:       'pointer',
                  borderRadius: 3,
                  textAlign:    'left',
                  transition:   'all 0.2s',
                  boxShadow:    selected === c.id ? `0 0 12px ${c.color}30` : 'none',
                }}
              >
                <div style={{ fontFamily: 'Orbitron', fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.08em' }}>
                  {c.label}
                </div>
                <div style={{ fontFamily: 'Share Tech Mono', fontSize: '0.58rem', opacity: 0.7, marginTop: 3 }}>
                  {c.desc}
                </div>
                <div style={{ fontFamily: 'Share Tech Mono', fontSize: '0.58rem', marginTop: 4, opacity: 0.6 }}>
                  {c.latency > 0 ? `${c.latency}ms · ${c.loss}% loss` : 'No packets'}
                </div>
              </button>
            ))}
          </div>

          {/* Presets visual reference */}
          <div className="mb-4">
            {(() => {
              const sel = CONDITIONS.find(c => c.id === selected)
              return sel ? (
                <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: 3, padding: '10px 12px' }}>
                  <div className="flex items-center justify-between mb-2">
                    <span style={{ fontFamily: 'Share Tech Mono', fontSize: '0.58rem', color: 'var(--cyber-muted)' }}>LATENCY</span>
                    <span style={{ fontFamily: 'Orbitron', fontSize: '0.7rem', color: sel.color }}>{sel.latency} ms</span>
                  </div>
                  <div style={{ height: 4, background: 'var(--cyber-border)', borderRadius: 2, marginBottom: 8 }}>
                    <div style={{ width: `${Math.min(sel.latency / 200 * 100, 100)}%`, height: '100%', background: sel.color, borderRadius: 2, boxShadow: `0 0 6px ${sel.color}` }} />
                  </div>
                  <div className="flex items-center justify-between mb-2">
                    <span style={{ fontFamily: 'Share Tech Mono', fontSize: '0.58rem', color: 'var(--cyber-muted)' }}>PACKET LOSS</span>
                    <span style={{ fontFamily: 'Orbitron', fontSize: '0.7rem', color: sel.color }}>{sel.loss}%</span>
                  </div>
                  <div style={{ height: 4, background: 'var(--cyber-border)', borderRadius: 2 }}>
                    <div style={{ width: `${sel.loss}%`, height: '100%', background: sel.color, borderRadius: 2, boxShadow: `0 0 6px ${sel.color}` }} />
                  </div>
                </div>
              ) : null
            })()}
          </div>

          <button
            onClick={() => applyCondition(selected)}
            disabled={applying}
            className="cyber-btn w-full"
            style={{
              width:     '100%',
              padding:   '10px',
              fontSize:  '0.7rem',
              opacity:   applying ? 0.6 : 1,
              cursor:    applying ? 'not-allowed' : 'pointer',
            }}
          >
            {applying ? '⟳ APPLYING...' : `APPLY — ${selected}`}
          </button>
        </div>

        {/* Last applied */}
        {lastApplied && (
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-sm"
            style={{
              background: 'rgba(0,255,136,0.06)',
              border:     '1px solid rgba(0,255,136,0.3)',
            }}
          >
            <CheckCircle size={12} style={{ color: 'var(--cyber-green)' }} />
            <span style={{ fontFamily: 'Share Tech Mono', fontSize: '0.62rem', color: 'var(--cyber-green)' }}>
              Applied: {lastApplied.applied}
            </span>
            <span style={{ fontFamily: 'Share Tech Mono', fontSize: '0.58rem', color: 'var(--cyber-muted)', marginLeft: 'auto' }}>
              {lastApplied.ts ? new Date(lastApplied.ts * 1000).toLocaleTimeString() : ''}
            </span>
          </div>
        )}

        {/* Warning */}
        {selected === 'OFFLINE' && (
          <div
            className="flex items-start gap-2 px-3 py-2 rounded-sm"
            style={{
              background: 'rgba(255,51,102,0.08)',
              border:     '1px solid rgba(255,51,102,0.35)',
            }}
          >
            <AlertTriangle size={12} style={{ color: 'var(--cyber-red)', marginTop: 1, flexShrink: 0 }} />
            <span style={{ fontFamily: 'Share Tech Mono', fontSize: '0.62rem', color: 'rgba(255,51,102,0.9)', lineHeight: 1.5 }}>
              OFFLINE mode drops all packets. Robots will lose connectivity and may timeout.
            </span>
          </div>
        )}
      </div>
    </div>
  )
}