import { useEffect, useRef, useCallback } from 'react'
import { robotColor, batteryColor } from '../utils/colors'

const CELL = 22
const GRID = 30

const SHELVES = [
  ...Array.from({ length: 8 }, (_, i) => ({ x: 3 + i, y: 3 })),
  ...Array.from({ length: 8 }, (_, i) => ({ x: 3 + i, y: 5 })),
  ...Array.from({ length: 8 }, (_, i) => ({ x: 3 + i, y: 7 })),
  ...Array.from({ length: 8 }, (_, i) => ({ x: 3 + i, y: 12 })),
  ...Array.from({ length: 8 }, (_, i) => ({ x: 3 + i, y: 14 })),
  ...Array.from({ length: 8 }, (_, i) => ({ x: 18 + i, y: 3 })),
  ...Array.from({ length: 8 }, (_, i) => ({ x: 18 + i, y: 5 })),
  ...Array.from({ length: 8 }, (_, i) => ({ x: 18 + i, y: 12 })),
  ...Array.from({ length: 8 }, (_, i) => ({ x: 18 + i, y: 14 })),
  ...Array.from({ length: 5 }, (_, i) => ({ x: 22 + i, y: 20 })),
  ...Array.from({ length: 5 }, (_, i) => ({ x: 22 + i, y: 22 })),
]

const CHARGING_DOCKS = [
  { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 1 }, { x: 2, y: 2 },
]

const DROP_ZONES = [
  { x: 27, y: 26 }, { x: 28, y: 26 }, { x: 27, y: 27 }, { x: 28, y: 27 },
]

function lerp(a, b, t) { return a + (b - a) * t }

export default function WarehouseCanvas({ snapshot, selectedRobot, onSelectRobot }) {
  const canvasRef = useRef(null)
  const animRef   = useRef(null)
  const smoothRef = useRef({})
  const frameRef  = useRef(0)

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const W = CELL * GRID
    const H = CELL * GRID

    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = '#060b14'
    ctx.fillRect(0, 0, W, H)

    // Grid lines
    ctx.strokeStyle = '#0d1626'
    ctx.lineWidth = 0.5
    for (let i = 0; i <= GRID; i++) {
      ctx.beginPath(); ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, H); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0, i * CELL); ctx.lineTo(W, i * CELL); ctx.stroke()
    }

    // Charging Docks
    CHARGING_DOCKS.forEach(({ x, y }) => {
      ctx.fillStyle = 'rgba(255,215,0,0.15)'
      ctx.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2)
      ctx.strokeStyle = '#ffd700'
      ctx.lineWidth = 1
      ctx.strokeRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2)
      ctx.fillStyle = '#ffd70099'
      ctx.font = `${Math.floor(CELL * 0.55)}px monospace`
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText('⚡', x * CELL + CELL / 2, y * CELL + CELL / 2)
    })

    // Drop Zones
    DROP_ZONES.forEach(({ x, y }) => {
      ctx.fillStyle = 'rgba(0,255,136,0.15)'
      ctx.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2)
      ctx.strokeStyle = '#00ff88'
      ctx.lineWidth = 1
      ctx.strokeRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2)
      ctx.fillStyle = '#00ff8899'
      ctx.font = `${Math.floor(CELL * 0.55)}px monospace`
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText('📦', x * CELL + CELL / 2, y * CELL + CELL / 2)
    })

    // Shelves
    SHELVES.forEach(({ x, y }) => {
      const grad = ctx.createLinearGradient(x * CELL, y * CELL, x * CELL, y * CELL + CELL)
      grad.addColorStop(0, '#1a2e50')
      grad.addColorStop(1, '#0d1626')
      ctx.fillStyle = grad
      ctx.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2)
      ctx.strokeStyle = '#1a3a6a'
      ctx.lineWidth = 0.8
      ctx.strokeRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2)
    })

    const robots = snapshot?.robots ?? {}
    const tasks  = snapshot?.tasks  ?? {}

    // Smooth robot positions
    Object.entries(robots).forEach(([rid, r]) => {
      if (!smoothRef.current[rid]) {
        smoothRef.current[rid] = { x: r.x, y: r.y }
      } else {
        smoothRef.current[rid].x = lerp(smoothRef.current[rid].x, r.x, 0.18)
        smoothRef.current[rid].y = lerp(smoothRef.current[rid].y, r.y, 0.18)
      }
    })

    // Task goal markers
    Object.entries(tasks).forEach(([, task]) => {
      const col = robotColor(task.robot_id)
      const gx  = task.goal_x * CELL + CELL / 2
      const gy  = task.goal_y * CELL + CELL / 2
      const sz  = 6
      ctx.strokeStyle = col
      ctx.lineWidth   = 1.5
      ctx.globalAlpha = 0.7
      ctx.beginPath()
      ctx.moveTo(gx - sz, gy); ctx.lineTo(gx + sz, gy)
      ctx.moveTo(gx, gy - sz); ctx.lineTo(gx, gy + sz)
      ctx.stroke()
      ctx.globalAlpha = 0.35
      ctx.strokeRect(gx - sz, gy - sz, sz * 2, sz * 2)
      ctx.globalAlpha = 1
    })

    // Path history trails
    Object.entries(robots).forEach(([rid, r]) => {
      const trail = r.path_history || []
      if (trail.length < 2) return
      const col = robotColor(rid)
      ctx.strokeStyle = col
      ctx.lineWidth   = 1.2
      ctx.globalAlpha = 0.22
      ctx.setLineDash([2, 4])
      ctx.beginPath()
      trail.forEach(([px, py], i) => {
        const cx = px * CELL + CELL / 2
        const cy = py * CELL + CELL / 2
        i === 0 ? ctx.moveTo(cx, cy) : ctx.lineTo(cx, cy)
      })
      ctx.stroke()
      ctx.setLineDash([])
      ctx.globalAlpha = 1
    })

    // Robot → goal dashed line
    Object.entries(robots).forEach(([rid, r]) => {
      if (!r.task_id || !tasks[r.task_id]) return
      const t  = tasks[r.task_id]
      const sp = smoothRef.current[rid] || r
      const sx = sp.x * CELL + CELL / 2
      const sy = sp.y * CELL + CELL / 2
      const gx = t.goal_x * CELL + CELL / 2
      const gy = t.goal_y * CELL + CELL / 2
      ctx.strokeStyle = robotColor(rid)
      ctx.lineWidth   = 0.8
      ctx.globalAlpha = 0.28
      ctx.setLineDash([4, 6])
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(gx, gy); ctx.stroke()
      ctx.setLineDash([])
      ctx.globalAlpha = 1
    })

    // Robots
    frameRef.current++
    const pulse = Math.sin(frameRef.current * 0.08) * 0.3 + 0.7

    Object.entries(robots).forEach(([rid, r]) => {
      const sp  = smoothRef.current[rid] || r
      const px  = sp.x * CELL + CELL / 2
      const py  = sp.y * CELL + CELL / 2
      const col = robotColor(rid)
      const isSelected = rid === selectedRobot
      const isCrashed  = r.status === 'CRASHED'
      const isCharging = r.status === 'CHARGING' || r.status === 'RECHARGING'
      const isActive   = r.status === 'ACTIVE'
      const radius     = 8

      if (isCrashed) {
        ctx.shadowColor = '#ff3366'; ctx.shadowBlur = 14 * pulse
      } else if (isCharging) {
        ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 10 * pulse
      } else if (isActive) {
        ctx.shadowColor = col; ctx.shadowBlur = 8
      } else {
        ctx.shadowBlur = 0
      }

      if (isSelected) {
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth   = 2
        ctx.globalAlpha = 0.6
        ctx.beginPath()
        ctx.arc(px, py, radius + 5, 0, Math.PI * 2)
        ctx.stroke()
        ctx.globalAlpha = 1
      }

      ctx.fillStyle = col
      ctx.beginPath()
      ctx.arc(px, py, radius, 0, Math.PI * 2)
      ctx.fill()

      ctx.shadowBlur = 0
      ctx.fillStyle  = '#060b14'
      ctx.font       = 'bold 7px monospace'
      ctx.textAlign  = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(rid.replace('robot_', 'R'), px, py)

      // Battery bar below robot
      const barW = 14, barH = 3
      const bx   = px - barW / 2
      const by   = py + radius + 3
      const bPct = (r.battery ?? 100) / 100
      ctx.fillStyle = '#0d1626'
      ctx.fillRect(bx, by, barW, barH)
      ctx.fillStyle = batteryColor(r.battery ?? 100)
      ctx.fillRect(bx, by, barW * bPct, barH)
    })

    ctx.shadowBlur = 0
  }, [snapshot, selectedRobot])

  useEffect(() => {
    const loop = () => {
      draw()
      animRef.current = requestAnimationFrame(loop)
    }
    animRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(animRef.current)
  }, [draw])

  const handleClick = useCallback((e) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect  = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    const mx = (e.clientX - rect.left) * scaleX
    const my = (e.clientY - rect.top)  * scaleY
    const gx = Math.floor(mx / CELL)
    const gy = Math.floor(my / CELL)

    const robots = snapshot?.robots ?? {}
    let closest = null, minDist = 2.5
    Object.entries(robots).forEach(([rid, r]) => {
      const d = Math.hypot(r.x - gx, r.y - gy)
      if (d < minDist) { minDist = d; closest = rid }
    })
    onSelectRobot?.(closest)
  }, [snapshot, onSelectRobot])

  const size = CELL * GRID

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      onClick={handleClick}
      style={{
        width: '100%',
        height: '100%',
        cursor: 'crosshair',
        maxWidth: size,
        maxHeight: size,
      }}
    />
  )
}