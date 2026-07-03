import { memo } from 'react'
import { robotColor, batteryColor, statusColor, statusBg, shortId, fmtBattery } from '../utils/colors'

function BatteryBar({ pct }) {
  const color = batteryColor(pct)
  return (
    <div style={{
      height: 5,
      background: '#0d1626',
      borderRadius: 3,
      overflow: 'hidden',
      marginTop: 4,
    }}>
      <div style={{
        width: `${Math.max(0, Math.min(100, pct))}%`,
        height: '100%',
        background: color,
        borderRadius: 3,
        transition: 'width 0.5s',
        boxShadow: pct < 25 ? `0 0 6px ${color}` : 'none',
      }} />
    </div>
  )
}

function RobotCard({ robotId, robot, isSelected, onClick }) {
  const col     = robotColor(robotId)
  const sColor  = statusColor(robot.status)
  const sBg     = statusBg(robot.status)
  const crashed = robot.status === 'CRASHED'
  const lowBat  = (robot.battery ?? 100) < 25

  return (
    <div
      onClick={onClick}
      className="fade-in"
      style={{
        background: isSelected ? '#111d35' : '#0d1626',
        border: `1px solid ${isSelected ? col : crashed ? '#ff336633' : '#1a2e50'}`,
        borderRadius: 8,
        padding: '10px 12px',
        cursor: 'pointer',
        boxShadow: isSelected
          ? `0 0 12px ${col}44`
          : crashed ? '0 0 8px #ff336622' : 'none',
        transition: 'all 0.2s',
      }}
    >
      <div style={{ height: 2, background: col, marginBottom: 8, borderRadius: 1, opacity: 0.7 }} />

      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 6,
      }}>
        <span style={{
          fontFamily: 'Orbitron, monospace',
          fontWeight: 700,
          fontSize: 13,
          color: col,
        }}>
          {shortId(robotId)}
        </span>
        <span style={{
          fontSize: 9,
          fontFamily: 'monospace',
          letterSpacing: 1,
          color: sColor,
          background: sBg,
          padding: '2px 6px',
          borderRadius: 3,
          border: `1px solid ${sColor}44`,
        }}>
          {robot.status}
        </span>
      </div>

      <div style={{ fontSize: 11, color: '#4a6080', fontFamily: 'monospace', marginBottom: 4 }}>
        pos ({Math.round(robot.x)}, {Math.round(robot.y)})
      </div>

      <div style={{ fontSize: 11, marginBottom: 4, color: robot.task_id ? '#c8d8f0' : '#4a6080' }}>
        {robot.task_id
          ? <span>🎯 <span style={{ color: '#00d4ff' }}>{robot.task_id.replace('task_', 'T')}</span></span>
          : <span style={{ color: '#2a3f60' }}>no task</span>}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: '#4a6080' }}>BATTERY</span>
        <span style={{
          fontSize: 11,
          fontFamily: 'monospace',
          color: batteryColor(robot.battery ?? 100),
          fontWeight: 700,
        }}>
          {fmtBattery(robot.battery)}
          {lowBat && <span className="blink" style={{ marginLeft: 4 }}>⚠</span>}
        </span>
      </div>
      <BatteryBar pct={robot.battery ?? 100} />

      {crashed && (
        <div style={{
          marginTop: 6,
          fontSize: 10,
          color: '#ff3366',
          fontFamily: 'monospace',
          textAlign: 'center',
          letterSpacing: 1,
        }} className="blink">
          ✕ FAULT DETECTED
        </div>
      )}
    </div>
  )
}

export default memo(function RobotPanel({ snapshot, selectedRobot, onSelectRobot }) {
  const robots = snapshot?.robots ?? {}
  const entries = Object.entries(robots)

  if (entries.length === 0) {
    return (
      <div style={{
        padding: 20,
        color: '#2a3f60',
        fontFamily: 'monospace',
        fontSize: 12,
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 24, marginBottom: 8 }}>⟳</div>
        <div>Waiting for robots...</div>
        <div style={{ fontSize: 10, marginTop: 4 }}>Connect backend on :8080</div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {entries.map(([rid, r]) => (
        <RobotCard
          key={rid}
          robotId={rid}
          robot={r}
          isSelected={rid === selectedRobot}
          onClick={() => onSelectRobot(rid === selectedRobot ? null : rid)}
        />
      ))}
    </div>
  )
})