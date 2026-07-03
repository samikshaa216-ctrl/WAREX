import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { TrendingUp, Clock, Shield, Percent } from 'lucide-react'
import { useMetrics } from '../hooks/useMetrics'

function MetricCard({ icon: Icon, label, value, unit, color, sub }) {
  return (
    <div
      className="cyber-card corner-decor p-4 flex flex-col gap-1"
      style={{ flex: 1, minWidth: 120 }}
    >
      <div className="flex items-center gap-2 mb-1">
        <Icon size={12} style={{ color }} />
        <span style={{ fontFamily: 'Share Tech Mono', fontSize: '0.58rem', color: 'var(--cyber-muted)', letterSpacing: '0.1em' }}>
          {label}
        </span>
      </div>
      <div className="metric-number" style={{ fontSize: '1.6rem', color }}>
        {value}
        <span style={{ fontSize: '0.7rem', fontFamily: 'Share Tech Mono', marginLeft: 4, opacity: 0.7 }}>
          {unit}
        </span>
      </div>
      {sub && (
        <div style={{ fontFamily: 'Share Tech Mono', fontSize: '0.6rem', color: 'var(--cyber-muted)' }}>
          {sub}
        </div>
      )}
    </div>
  )
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'rgba(6,11,20,0.95)',
      border:     '1px solid var(--cyber-border)',
      padding:    '8px 12px',
      fontFamily: 'Share Tech Mono',
      fontSize:   '0.65rem',
    }}>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color, marginTop: i > 0 ? 3 : 0 }}>
          {p.name}: {typeof p.value === 'number' ? p.value.toFixed(2) : p.value}
        </div>
      ))}
    </div>
  )
}

export default function AnalyticsPanel() {
  const { fleet, all, history, loading } = useMetrics()

  const mttr   = fleet?.fleet_mttr_s ?? 0
  const mtbf   = fleet?.fleet_mtbf_s ?? 9999
  const uptime = fleet?.system?.uptime_pct ?? 100
  const tasks  = all?.system?.tasks_total ?? 0
  const crashes = all?.system?.crashes_total ?? 0
  const recoveries = all?.system?.recoveries_total ?? 0

  const availability = mtbf >= 9999
    ? 100
    : parseFloat(((mtbf / (mtbf + mttr)) * 100).toFixed(2))

  // Per-robot reliability data
  const robotMetrics = all?.robots
    ? Object.entries(all.robots).map(([id, m]) => ({
        robot:     id.replace('robot_', 'R'),
        uptime:    m.uptime_pct ?? 100,
        crashes:   m.crash_count ?? 0,
        tasks_done: m.tasks_completed ?? 0,
        mttr:      m.mttr_s ?? 0,
      }))
    : []

  return (
    <div className="flex flex-col h-full panel-scroll">
      <div className="panel-header">
        <TrendingUp size={12} style={{ color: 'var(--cyber-cyan)' }} />
        <span className="panel-title">Fleet Analytics — MTTR / MTBF</span>
      </div>

      <div className="flex-1 p-4 flex flex-col gap-4">
        {/* KPI cards row */}
        <div className="flex gap-3 flex-wrap">
          <MetricCard
            icon={Clock}
            label="FLEET MTTR"
            value={mttr.toFixed(1)}
            unit="s"
            color="var(--cyber-orange)"
            sub="Mean time to repair"
          />
          <MetricCard
            icon={Shield}
            label="FLEET MTBF"
            value={mtbf >= 9999 ? '∞' : mtbf.toFixed(1)}
            unit={mtbf >= 9999 ? '' : 's'}
            color="var(--cyber-purple)"
            sub="Mean time between failures"
          />
          <MetricCard
            icon={Percent}
            label="AVAILABILITY"
            value={availability.toFixed(1)}
            unit="%"
            color={availability > 90 ? 'var(--cyber-green)' : availability > 70 ? 'var(--cyber-yellow)' : 'var(--cyber-red)'}
            sub="Fleet availability"
          />
          <MetricCard
            icon={TrendingUp}
            label="UPTIME"
            value={(uptime ?? 100).toFixed(1)}
            unit="%"
            color="var(--cyber-cyan)"
            sub={`Crashes: ${crashes} | Recoveries: ${recoveries}`}
          />
        </div>

        {/* Trend chart */}
        {history.length > 2 && (
          <div className="cyber-card p-4 flex flex-col gap-2">
            <div style={{ fontFamily: 'Share Tech Mono', fontSize: '0.6rem', color: 'var(--cyber-muted)', letterSpacing: '0.1em' }}>
              MTTR / UPTIME TREND
            </div>
            <ResponsiveContainer width="100%" height={130}>
              <LineChart data={history} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="rgba(26,46,80,0.8)" />
                <XAxis
                  dataKey="ts"
                  tickFormatter={v => {
                    const d = new Date(v)
                    return `${d.getMinutes().toString().padStart(2,'0')}:${d.getSeconds().toString().padStart(2,'0')}`
                  }}
                  stroke="#2a3f60"
                  tick={{ fill: '#4a6080', fontSize: 8, fontFamily: 'Share Tech Mono' }}
                />
                <YAxis
                  yAxisId="mttr"
                  stroke="#2a3f60"
                  tick={{ fill: '#4a6080', fontSize: 8, fontFamily: 'Share Tech Mono' }}
                  width={30}
                />
                <YAxis
                  yAxisId="uptime"
                  orientation="right"
                  domain={[0, 100]}
                  stroke="#2a3f60"
                  tick={{ fill: '#4a6080', fontSize: 8, fontFamily: 'Share Tech Mono' }}
                  width={30}
                />
                <Tooltip content={<CustomTooltip />} />
                <Line
                  yAxisId="mttr"
                  type="monotone"
                  dataKey="mttr"
                  stroke="var(--cyber-orange)"
                  strokeWidth={1.5}
                  dot={false}
                  name="MTTR (s)"
                />
                <Line
                  yAxisId="uptime"
                  type="monotone"
                  dataKey="uptime_pct"
                  stroke="var(--cyber-cyan)"
                  strokeWidth={1.5}
                  dot={false}
                  name="Uptime %"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Per-robot breakdown */}
        {robotMetrics.length > 0 && (
          <div className="cyber-card p-4 flex flex-col gap-2">
            <div style={{ fontFamily: 'Share Tech Mono', fontSize: '0.6rem', color: 'var(--cyber-muted)', letterSpacing: '0.1em' }}>
              PER-ROBOT UPTIME & CRASHES
            </div>
            <ResponsiveContainer width="100%" height={120}>
              <BarChart data={robotMetrics} margin={{ top: 5, right: 10, left: 0, bottom: 0 }} barGap={2}>
                <CartesianGrid strokeDasharray="2 4" stroke="rgba(26,46,80,0.8)" />
                <XAxis dataKey="robot" stroke="#2a3f60" tick={{ fill: '#4a6080', fontSize: 8, fontFamily: 'Share Tech Mono' }} />
                <YAxis stroke="#2a3f60" tick={{ fill: '#4a6080', fontSize: 8, fontFamily: 'Share Tech Mono' }} width={28} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="uptime" name="Uptime %" fill="var(--cyber-cyan)" fillOpacity={0.7} radius={[2,2,0,0]} />
                <Bar dataKey="crashes" name="Crashes" fill="var(--cyber-red)" fillOpacity={0.8} radius={[2,2,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Reliability table */}
        {robotMetrics.length > 0 && (
          <div className="cyber-card overflow-hidden">
            <div className="panel-header">
              <span style={{ fontFamily: 'Share Tech Mono', fontSize: '0.58rem', color: 'var(--cyber-muted)', letterSpacing: '0.1em' }}>
                PER-ROBOT RELIABILITY TABLE
              </span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'Share Tech Mono', fontSize: '0.65rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--cyber-border)', background: 'rgba(0,212,255,0.03)' }}>
                    {['ROBOT', 'UPTIME', 'CRASHES', 'TASKS', 'MTTR'].map(h => (
                      <th key={h} style={{ padding: '6px 12px', textAlign: 'left', color: 'var(--cyber-muted)', letterSpacing: '0.1em', fontSize: '0.55rem', fontWeight: 400 }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {robotMetrics.map((r, i) => (
                    <tr
                      key={r.robot}
                      style={{
                        borderBottom: '1px solid rgba(26,46,80,0.5)',
                        background:   i % 2 === 0 ? 'transparent' : 'rgba(0,212,255,0.02)',
                      }}
                    >
                      <td style={{ padding: '5px 12px', color: 'var(--cyber-cyan)', fontWeight: 600 }}>{r.robot}</td>
                      <td style={{ padding: '5px 12px', color: r.uptime > 90 ? 'var(--cyber-green)' : r.uptime > 60 ? 'var(--cyber-yellow)' : 'var(--cyber-red)' }}>
                        {r.uptime.toFixed(1)}%
                      </td>
                      <td style={{ padding: '5px 12px', color: r.crashes > 0 ? 'var(--cyber-red)' : 'var(--cyber-muted)' }}>
                        {r.crashes}
                      </td>
                      <td style={{ padding: '5px 12px', color: 'var(--cyber-text)' }}>{r.tasks_done}</td>
                      <td style={{ padding: '5px 12px', color: 'var(--cyber-orange)' }}>{r.mttr.toFixed(1)}s</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {loading && !fleet && (
          <div className="flex items-center justify-center py-12">
            <span style={{ fontFamily: 'Share Tech Mono', fontSize: '0.65rem', color: 'var(--cyber-muted)' }}>
              Loading analytics...
            </span>
          </div>
        )}
      </div>
    </div>
  )
}