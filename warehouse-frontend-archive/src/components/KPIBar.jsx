import { memo } from 'react'

function KPICard({ label, value, color = '#00d4ff', sub, blink }) {
  return (
    <div style={{
      background: '#0d1626',
      border: `1px solid ${color}33`,
      borderRadius: 6,
      padding: '10px 14px',
      minWidth: 90,
      flex: '1 1 90px',
    }}>
      <div style={{
        fontSize: 10,
        color: '#4a6080',
        fontFamily: 'monospace',
        letterSpacing: 1,
        marginBottom: 2,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 22,
        fontWeight: 900,
        fontFamily: 'Orbitron, monospace',
        color,
        lineHeight: 1,
      }} className={blink ? 'blink' : ''}>
        {value ?? '—'}
      </div>
      {sub && (
        <div style={{ fontSize: 10, color: '#4a6080', marginTop: 2 }}>{sub}</div>
      )}
    </div>
  )
}

export default memo(function KPIBar({ snapshot, fleetMetrics }) {
  const stats   = snapshot?.stats ?? {}
  const active  = snapshot?.active_robots  ?? 0
  const crashed = snapshot?.crashed_robots ?? 0
  const idle    = snapshot?.idle_robots    ?? 0
  const rate    = stats.rate?.toFixed(1) ?? '0.0'
  const mttr    = fleetMetrics?.fleet_mttr_s
  const mtbf    = fleetMetrics?.fleet_mtbf_s

  return (
    <div style={{
      display: 'flex',
      gap: 8,
      flexWrap: 'wrap',
      padding: '8px 12px',
      background: '#060b14',
      borderBottom: '1px solid #1a2e50',
    }}>
      <KPICard label="TASKS TOTAL" value={stats.total ?? 0} color="#00d4ff" />
      <KPICard label="MET"         value={stats.met ?? 0}   color="#00ff88" />
      <KPICard label="MISSED"      value={stats.missed ?? 0} color="#ff3366"
        blink={(stats.missed ?? 0) > 0} />
      <KPICard label="SUCCESS %"   value={`${rate}%`}
        color={parseFloat(rate) >= 70 ? '#00ff88' : '#ff7a00'} />
      <div style={{ width: 1, background: '#1a2e50', margin: '0 4px' }} />
      <KPICard label="ACTIVE"  value={active}  color="#00d4ff" />
      <KPICard label="IDLE"    value={idle}    color="#00ff88" />
      <KPICard label="CRASHED" value={crashed} color="#ff3366" blink={crashed > 0} />
      <div style={{ width: 1, background: '#1a2e50', margin: '0 4px' }} />
      <KPICard label="MTTR (s)"
        value={mttr != null ? mttr.toFixed(1) : '—'}
        color="#9b59ff"
        sub="time to recover" />
      <KPICard label="MTBF (s)"
        value={mtbf != null && mtbf < 99999 ? mtbf.toFixed(0) : '∞'}
        color="#ff7a00"
        sub="time between fail" />
    </div>
  )
})