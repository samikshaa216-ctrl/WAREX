import FleetCanvas from '../components/FleetCanvas'
import RobotCardGrid from './components/RobotCardGrid'

export default function FleetPage({ snapshot }) {
  return (
    <div className="flex h-full" style={{ overflow: 'hidden' }}>
      {/* Left: Fleet map canvas — takes up ~65% */}
      <div
        className="cyber-card flex flex-col"
        style={{
          flex:        '0 0 65%',
          borderRadius: 0,
          borderLeft:  'none',
          borderTop:   'none',
          borderBottom: 'none',
        }}
      >
        <FleetCanvas snapshot={snapshot} />
      </div>

      {/* Divider */}
      <div style={{ width: 1, background: 'var(--cyber-border)', flexShrink: 0 }} />

      {/* Right: Robot card grid */}
      <div
        className="cyber-card flex flex-col"
        style={{
          flex:         '1 1 35%',
          borderRadius: 0,
          borderRight:  'none',
          borderTop:    'none',
          borderBottom: 'none',
        }}
      >
        <RobotCardGrid snapshot={snapshot} />
      </div>
    </div>
  )
}