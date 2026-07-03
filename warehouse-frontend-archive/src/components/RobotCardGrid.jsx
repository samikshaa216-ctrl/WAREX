import { useState } from 'react'
import { LayoutGrid, Filter } from 'lucide-react'
import RobotCard from './RobotCard'

const FILTERS = ['ALL', 'ACTIVE', 'IDLE', 'CRASHED', 'CHARGING']

export default function RobotCardGrid({ snapshot }) {
  const [filter,   setFilter]   = useState('ALL')
  const [selected, setSelected] = useState(null)

  const robots = Object.values(snapshot?.robots ?? {})
  const filtered = filter === 'ALL'
    ? robots
    : robots.filter(r => r.status === filter)

  // Sort: crashed first, then active, then others
  const sorted = [...filtered].sort((a, b) => {
    const order = { CRASHED: 0, ACTIVE: 1, CHARGING: 2, IDLE: 3 }
    return (order[a.status] ?? 4) - (order[b.status] ?? 4)
  })

  return (
    <div className="flex flex-col h-full">
      <div className="panel-header">
        <LayoutGrid size={12} style={{ color: 'var(--cyber-cyan)' }} />
        <span className="panel-title">Robot Fleet</span>
        <span style={{ fontFamily: 'Share Tech Mono', fontSize: '0.6rem', color: 'var(--cyber-muted)' }}>
          {robots.length} units
        </span>
        <div className="flex-1" />

        {/* Filter buttons */}
        <div className="flex gap-1">
          {FILTERS.map(f => {
            const count = f === 'ALL' ? robots.length : robots.filter(r => r.status === f).length
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  fontFamily:   'Share Tech Mono',
                  fontSize:     '0.58rem',
                  letterSpacing:'0.06em',
                  background:   filter === f ? 'rgba(0,212,255,0.15)' : 'transparent',
                  border:       `1px solid ${filter === f ? 'var(--cyber-cyan)' : 'var(--cyber-border)'}`,
                  color:        filter === f ? 'var(--cyber-cyan)' : 'var(--cyber-muted)',
                  padding:      '2px 8px',
                  cursor:       'pointer',
                  borderRadius: 2,
                  transition:   'all 0.15s',
                }}
              >
                {f} {count > 0 ? `(${count})` : ''}
              </button>
            )
          })}
        </div>
      </div>

      <div
        className="flex-1 panel-scroll p-3"
        style={{
          display:             'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
          gap:                 10,
          alignContent:        'start',
        }}
      >
        {sorted.length === 0 ? (
          <div
            className="col-span-full flex flex-col items-center justify-center gap-2 py-12"
            style={{ color: 'var(--cyber-muted)' }}
          >
            <Filter size={24} style={{ opacity: 0.4 }} />
            <span style={{ fontFamily: 'Share Tech Mono', fontSize: '0.7rem' }}>
              No robots match filter
            </span>
          </div>
        ) : (
          sorted.map(robot => (
            <RobotCard
              key={robot.robot_id}
              robot={robot}
              selected={selected === robot.robot_id}
              onSelect={id => setSelected(prev => prev === id ? null : id)}
            />
          ))
        )}
      </div>
    </div>
  )
}