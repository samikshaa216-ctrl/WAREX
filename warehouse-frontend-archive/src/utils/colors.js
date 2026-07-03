export const ROBOT_COLORS = [
  '#00d4ff',
  '#00ff88',
  '#ffd700',
  '#ff7a00',
  '#9b59ff',
  '#ff3366',
  '#4fc3f7',
  '#a5d6a7',
]

export function robotColor(robotId) {
  const num = parseInt(robotId?.replace(/\D/g, '') || '0', 10) - 1
  return ROBOT_COLORS[Math.max(0, num) % ROBOT_COLORS.length] || '#c8d8f0'
}

export function batteryColor(pct) {
  if (pct > 50) return '#00ff88'
  if (pct > 25) return '#ffd700'
  return '#ff3366'
}

export function statusColor(status) {
  switch (status) {
    case 'ACTIVE':     return '#00d4ff'
    case 'IDLE':       return '#00ff88'
    case 'CRASHED':    return '#ff3366'
    case 'CHARGING':
    case 'RECHARGING': return '#ffd700'
    default:           return '#4a6080'
  }
}

export function statusBg(status) {
  switch (status) {
    case 'ACTIVE':     return 'rgba(0,212,255,0.12)'
    case 'IDLE':       return 'rgba(0,255,136,0.10)'
    case 'CRASHED':    return 'rgba(255,51,102,0.15)'
    case 'CHARGING':
    case 'RECHARGING': return 'rgba(255,215,0,0.10)'
    default:           return 'rgba(74,96,128,0.10)'
  }
}

export function fmtBattery(b) {
  return `${Math.round(b ?? 0)}%`
}

export function shortId(id) {
  return id?.replace('robot_', 'R') ?? id
}