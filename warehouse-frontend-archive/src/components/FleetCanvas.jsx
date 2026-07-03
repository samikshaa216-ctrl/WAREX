import { useRef, useEffect, useCallback, useState } from 'react'
import { Maximize2, RefreshCw, Eye, EyeOff } from 'lucide-react'

// Warehouse bounds from warehouse_graph.py
const GRID_W = 50
const GRID_H = 30

// Warehouse node positions
const NODES = {
  C1:  [0,  0],
  C2:  [45, 0],
  C3:  [25, 25],
  A1:  [2,  0],
  A2:  [4,  0],
  A3:  [6,  0],
  B1:  [0,  3],
  B2:  [2,  3],
  B3:  [4,  3],
  DZ:  [6,  3],
}

const CHARGING_DOCKS = new Set(['C1', 'C2', 'C3'])

const STATUS_COLORS = {
  ACTIVE:   '#00ff88',
  IDLE:     '#00d4ff',
  CRASHED:  '#ff3366',
  CHARGING: '#ffd700',
}

const ROBOT_COLORS = [
  '#00d4ff', '#00ff88', '#9b59ff', '#ffd700', '#ff7a00', '#ff3366',
  '#00e5ff', '#69ff47', '#ff6b6b', '#ffa502',
]

export default function FleetCanvas({ snapshot }) {
  const canvasRef     = useRef(null)
  const animRef       = useRef(null)
  const robotPosRef   = useRef({})   // smoothed positions
  const robotTargetRef = useRef({})  // target positions from WS
  const prevSnapshotRef = useRef(null)

  const [showTrails,  setShowTrails]  = useState(true)
  const [showNodes,   setShowNodes]   = useState(true)
  const [showLabels,  setShowLabels]  = useState(true)
  const [selectedBot, setSelectedBot] = useState(null)
  const [hoveredBot,  setHoveredBot]  = useState(null)
  const [robotIndex,  setRobotIndex]  = useState({}) // robot_id -> stable color index

  // Assign stable color indices to robots
  useEffect(() => {
    if (!snapshot?.robots) return
    setRobotIndex(prev => {
      const next = { ...prev }
      let maxIdx = Math.max(-1, ...Object.values(prev))
      Object.keys(snapshot.robots).forEach(id => {
        if (!(id in next)) {
          maxIdx += 1
          next[id] = maxIdx
        }
      })
      return next
    })
  }, [snapshot?.robots])

  // Update target positions from WS data
  useEffect(() => {
    if (!snapshot?.robots) return
    Object.entries(snapshot.robots).forEach(([id, r]) => {
      robotTargetRef.current[id] = { x: r.x ?? 0, y: r.y ?? 0 }
      // Init smoothed position if new
      if (!robotPosRef.current[id]) {
        robotPosRef.current[id] = { x: r.x ?? 0, y: r.y ?? 0 }
      }
    })
  }, [snapshot])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const W = canvas.width
    const H = canvas.height

    // ── Coordinate transform ───────────────────────────────────────────────
    const pad = { l: 40, r: 20, t: 20, b: 30 }
    const scaleX = (gx) => pad.l + (gx / GRID_W) * (W - pad.l - pad.r)
    const scaleY = (gy) => H - pad.b - (gy / GRID_H) * (H - pad.t - pad.b)

    // ── Clear ──────────────────────────────────────────────────────────────
    ctx.clearRect(0, 0, W, H)

    // Background gradient
    const bg = ctx.createLinearGradient(0, 0, 0, H)
    bg.addColorStop(0, '#060f1a')
    bg.addColorStop(1, '#04090f')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)

    // ── Grid lines ────────────────────────────────────────────────────────
    ctx.strokeStyle = 'rgba(26,46,80,0.6)'
    ctx.lineWidth   = 0.5

    const gStep = 5
    for (let gx = 0; gx <= GRID_W; gx += gStep) {
      const x = scaleX(gx)
      ctx.beginPath()
      ctx.moveTo(x, pad.t)
      ctx.lineTo(x, H - pad.b)
      ctx.stroke()
    }
    for (let gy = 0; gy <= GRID_H; gy += gStep) {
      const y = scaleY(gy)
      ctx.beginPath()
      ctx.moveTo(pad.l, y)
      ctx.lineTo(W - pad.r, y)
      ctx.stroke()
    }

    // Axis labels
    ctx.fillStyle = 'rgba(74,96,128,0.8)'
    ctx.font      = '9px "Share Tech Mono"'
    ctx.textAlign = 'center'
    for (let gx = 0; gx <= GRID_W; gx += 10) {
      ctx.fillText(gx, scaleX(gx), H - pad.b + 14)
    }
    ctx.textAlign = 'right'
    for (let gy = 0; gy <= GRID_H; gy += 10) {
      ctx.fillText(gy, pad.l - 6, scaleY(gy) + 3)
    }

    // ── Warehouse nodes ────────────────────────────────────────────────────
    if (showNodes) {
      // Use live graph nodes if available, else fallback to NODES
      const graphNodes = snapshot?.warehouse_graph?.nodes
      const nodeMap = graphNodes && Object.keys(graphNodes).length > 0
        ? graphNodes
        : NODES

      const nodeEntries = Object.entries(nodeMap)

      // Draw connections between nearby nodes
      ctx.strokeStyle = 'rgba(0,212,255,0.08)'
      ctx.lineWidth   = 1
      nodeEntries.forEach(([idA, posA]) => {
        nodeEntries.forEach(([idB, posB]) => {
          if (idA >= idB) return
          const [ax, ay] = Array.isArray(posA) ? posA : [posA[0], posA[1]]
          const [bx, by] = Array.isArray(posB) ? posB : [posB[0], posB[1]]
          const dist = Math.hypot(ax - bx, ay - by)
          if (dist < 8) {
            ctx.beginPath()
            ctx.moveTo(scaleX(ax), scaleY(ay))
            ctx.lineTo(scaleX(bx), scaleY(by))
            ctx.stroke()
          }
        })
      })

      // Draw nodes
      nodeEntries.forEach(([nodeId, pos]) => {
        const [nx, ny] = Array.isArray(pos) ? pos : [pos[0], pos[1]]
        const sx = scaleX(nx)
        const sy = scaleY(ny)
        const isCharger = CHARGING_DOCKS.has(nodeId)

        if (isCharger) {
          // Charging station — hexagon-ish
          ctx.beginPath()
          for (let i = 0; i < 6; i++) {
            const angle = (Math.PI / 3) * i - Math.PI / 6
            const r = 7
            const method = i === 0 ? 'moveTo' : 'lineTo'
            ctx[method](sx + r * Math.cos(angle), sy + r * Math.sin(angle))
          }
          ctx.closePath()
          ctx.fillStyle   = 'rgba(255,215,0,0.1)'
          ctx.fill()
          ctx.strokeStyle = 'rgba(255,215,0,0.6)'
          ctx.lineWidth   = 1
          ctx.stroke()

          // Lightning bolt ⚡
          ctx.fillStyle   = '#ffd700'
          ctx.font        = '8px sans-serif'
          ctx.textAlign   = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText('⚡', sx, sy)
        } else {
          // Regular node
          ctx.beginPath()
          ctx.arc(sx, sy, 4, 0, Math.PI * 2)
          ctx.fillStyle   = 'rgba(0,212,255,0.15)'
          ctx.fill()
          ctx.strokeStyle = 'rgba(0,212,255,0.5)'
          ctx.lineWidth   = 1
          ctx.stroke()
        }

        if (showLabels) {
          ctx.fillStyle     = isCharger ? 'rgba(255,215,0,0.9)' : 'rgba(0,212,255,0.7)'
          ctx.font          = '8px "Share Tech Mono"'
          ctx.textAlign     = 'center'
          ctx.textBaseline  = 'top'
          ctx.fillText(nodeId, sx, sy + 6)
        }
      })
    }

    // ── Smooth interpolation of robot positions ────────────────────────────
    const LERP = 0.12
    Object.entries(robotTargetRef.current).forEach(([id, target]) => {
      if (!robotPosRef.current[id]) {
        robotPosRef.current[id] = { ...target }
      } else {
        robotPosRef.current[id].x += (target.x - robotPosRef.current[id].x) * LERP
        robotPosRef.current[id].y += (target.y - robotPosRef.current[id].y) * LERP
      }
    })

    const robots  = snapshot?.robots  ?? {}
    const tasks   = snapshot?.tasks   ?? {}

    // ── Task paths ────────────────────────────────────────────────────────
    Object.entries(tasks).forEach(([, task]) => {
      const robot  = robots[task.robot_id]
      if (!robot) return
      const rpos = robotPosRef.current[task.robot_id]
      if (!rpos) return
      const colorIdx = robotIndex[task.robot_id] ?? 0
      const color    = ROBOT_COLORS[colorIdx % ROBOT_COLORS.length]

      ctx.beginPath()
      ctx.setLineDash([4, 5])
      ctx.moveTo(scaleX(rpos.x), scaleY(rpos.y))
      ctx.lineTo(scaleX(task.goal_x), scaleY(task.goal_y))
      ctx.strokeStyle = color + '50'
      ctx.lineWidth   = 1
      ctx.stroke()
      ctx.setLineDash([])

      // Goal marker
      ctx.beginPath()
      ctx.arc(scaleX(task.goal_x), scaleY(task.goal_y), 5, 0, Math.PI * 2)
      ctx.fillStyle   = color + '25'
      ctx.fill()
      ctx.strokeStyle = color + '90'
      ctx.lineWidth   = 1.5
      ctx.stroke()
      // X mark
      const gx = scaleX(task.goal_x)
      const gy = scaleY(task.goal_y)
      ctx.strokeStyle = color
      ctx.lineWidth   = 1.5
      ctx.beginPath()
      ctx.moveTo(gx - 3, gy - 3); ctx.lineTo(gx + 3, gy + 3)
      ctx.moveTo(gx + 3, gy - 3); ctx.lineTo(gx - 3, gy + 3)
      ctx.stroke()
    })

    // ── Robots ────────────────────────────────────────────────────────────
    Object.entries(robots).forEach(([id, robot]) => {
      const spos = robotPosRef.current[id]
      if (!spos) return

      const sx       = scaleX(spos.x)
      const sy       = scaleY(spos.y)
      const status   = robot.status ?? 'IDLE'
      const color    = STATUS_COLORS[status] ?? '#ffffff'
      const colorIdx = robotIndex[id] ?? 0
      const botColor = ROBOT_COLORS[colorIdx % ROBOT_COLORS.length]
      const isSelected = selectedBot === id || hoveredBot === id
      const R        = isSelected ? 9 : 7

      // ── Path history trail ─────────────────────────────────────────────
      if (showTrails && robot.path_history && robot.path_history.length > 1) {
        ctx.beginPath()
        robot.path_history.forEach(([hx, hy], i) => {
          const tx = scaleX(hx)
          const ty = scaleY(hy)
          if (i === 0) ctx.moveTo(tx, ty)
          else         ctx.lineTo(tx, ty)
        })
        const grad = ctx.createLinearGradient(
          scaleX(robot.path_history[0][0]), scaleY(robot.path_history[0][1]),
          sx, sy,
        )
        grad.addColorStop(0, botColor + '00')
        grad.addColorStop(1, botColor + '40')
        ctx.strokeStyle = grad
        ctx.lineWidth   = isSelected ? 2 : 1.5
        ctx.stroke()
      }

      // ── Outer glow ────────────────────────────────────────────────────
      if (status === 'ACTIVE') {
        const now    = Date.now()
        const pulse  = 0.4 + 0.6 * Math.abs(Math.sin(now * 0.003 + colorIdx))
        ctx.beginPath()
        ctx.arc(sx, sy, R + 6, 0, Math.PI * 2)
        ctx.fillStyle = color + Math.round(pulse * 30).toString(16).padStart(2, '0')
        ctx.fill()
      }

      // ── Robot body circle ─────────────────────────────────────────────
      ctx.beginPath()
      ctx.arc(sx, sy, R, 0, Math.PI * 2)
      ctx.fillStyle   = status === 'CRASHED' ? '#1a0008' : `${botColor}22`
      ctx.fill()
      ctx.strokeStyle = color
      ctx.lineWidth   = isSelected ? 2.5 : 2
      ctx.stroke()

      // Glow shadow
      ctx.shadowColor = color
      ctx.shadowBlur  = isSelected ? 16 : 8
      ctx.beginPath()
      ctx.arc(sx, sy, R, 0, Math.PI * 2)
      ctx.strokeStyle = color + 'aa'
      ctx.lineWidth   = 1
      ctx.stroke()
      ctx.shadowBlur  = 0

      // Inner dot
      ctx.beginPath()
      ctx.arc(sx, sy, 2.5, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.fill()

      // Crash X overlay
      if (status === 'CRASHED') {
        ctx.strokeStyle = '#ff3366'
        ctx.lineWidth   = 1.5
        ctx.beginPath()
        ctx.moveTo(sx - 4, sy - 4); ctx.lineTo(sx + 4, sy + 4)
        ctx.moveTo(sx + 4, sy - 4); ctx.lineTo(sx - 4, sy + 4)
        ctx.stroke()
      }

      // ── Label ─────────────────────────────────────────────────────────
      if (showLabels) {
        const label  = id.replace('robot_', 'R')
        const bat    = `${Math.round(robot.battery ?? 0)}%`

        ctx.font      = isSelected ? 'bold 9px "Share Tech Mono"' : '8px "Share Tech Mono"'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'bottom'

        // Label bg
        const lw  = ctx.measureText(label).width + 6
        ctx.fillStyle = 'rgba(4,9,15,0.85)'
        ctx.fillRect(sx - lw / 2, sy - R - 18, lw, 12)

        ctx.fillStyle = isSelected ? '#ffffff' : color
        ctx.fillText(label, sx, sy - R - 7)

        // Battery below
        ctx.font      = '7px "Share Tech Mono"'
        ctx.fillStyle = robot.battery > 40 ? 'rgba(0,255,136,0.8)' : robot.battery > 15 ? 'rgba(255,122,0,0.9)' : 'rgba(255,51,102,1)'
        ctx.textBaseline = 'top'
        ctx.fillText(bat, sx, sy + R + 3)
      }

      // ── Battery arc ───────────────────────────────────────────────────
      const batPct   = (robot.battery ?? 100) / 100
      const batColor = robot.battery > 40 ? '#00ff88' : robot.battery > 15 ? '#ff7a00' : '#ff3366'
      ctx.beginPath()
      ctx.arc(sx, sy, R + 3, -Math.PI / 2, -Math.PI / 2 + batPct * Math.PI * 2)
      ctx.strokeStyle = batColor
      ctx.lineWidth   = 1.5
      ctx.stroke()
    })

    // ── Selected robot info overlay ───────────────────────────────────────
    if (selectedBot && robots[selectedBot]) {
      const r    = robots[selectedBot]
      const task = Object.values(tasks).find(t => t.robot_id === selectedBot)
      drawInfoPanel(ctx, r, task, W, H)
    }

    // ── Legend ────────────────────────────────────────────────────────────
    drawLegend(ctx, H)
  }, [snapshot, showTrails, showNodes, showLabels, selectedBot, hoveredBot, robotIndex])

  function drawLegend(ctx, H) {
    const items = [
      { color: '#00ff88', label: 'ACTIVE'   },
      { color: '#00d4ff', label: 'IDLE'     },
      { color: '#ff3366', label: 'CRASHED'  },
      { color: '#ffd700', label: 'CHARGING' },
    ]
    ctx.font = '8px "Share Tech Mono"'
    ctx.textBaseline = 'middle'
    let lx = 45
    items.forEach(({ color, label }) => {
      ctx.beginPath()
      ctx.arc(lx, H - 14, 3.5, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.fill()
      ctx.shadowColor = color; ctx.shadowBlur = 5
      ctx.fill()
      ctx.shadowBlur  = 0
      lx += 6
      ctx.fillStyle = 'rgba(200,216,240,0.7)'
      ctx.textAlign = 'left'
      ctx.fillText(label, lx, H - 14)
      lx += ctx.measureText(label).width + 14
    })
  }

  function drawInfoPanel(ctx, robot, task, W, H) {
    const lines = [
      `ID:     ${robot.robot_id}`,
      `STATUS: ${robot.status}`,
      `BATT:   ${Math.round(robot.battery ?? 0)}%`,
      `POS:    (${(robot.x ?? 0).toFixed(1)}, ${(robot.y ?? 0).toFixed(1)})`,
      task ? `TASK:   ${task.task_id}` : 'TASK:   —',
      task ? `GOAL:   (${task.goal_x?.toFixed(1)}, ${task.goal_y?.toFixed(1)})` : '',
    ].filter(Boolean)

    const pw = 160, lh = 14, ph = lines.length * lh + 16
    const px = W - pw - 10, py = H - ph - 10

    ctx.fillStyle = 'rgba(6,11,20,0.92)'
    ctx.strokeStyle = 'rgba(0,212,255,0.4)'
    ctx.lineWidth   = 1
    ctx.beginPath()
    ctx.roundRect(px, py, pw, ph, 3)
    ctx.fill()
    ctx.stroke()

    ctx.font      = '9px "Share Tech Mono"'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    lines.forEach((line, i) => {
      ctx.fillStyle = i === 1
        ? (STATUS_COLORS[robot.status] ?? '#fff')
        : 'rgba(200,216,240,0.9)'
      ctx.fillText(line, px + 8, py + 8 + i * lh)
    })
  }

  // ── Render loop ────────────────────────────────────────────────────────────
  useEffect(() => {
    const loop = () => {
      draw()
      animRef.current = requestAnimationFrame(loop)
    }
    animRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(animRef.current)
  }, [draw])

  // ── Resize observer ────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ro = new ResizeObserver(() => {
      const parent = canvas.parentElement
      canvas.width  = parent.clientWidth
      canvas.height = parent.clientHeight
    })
    ro.observe(canvas.parentElement)
    // Initial size
    const parent = canvas.parentElement
    canvas.width  = parent.clientWidth
    canvas.height = parent.clientHeight
    return () => ro.disconnect()
  }, [])

  // ── Mouse interaction ──────────────────────────────────────────────────────
  const handleMouseMove = useCallback((e) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect  = canvas.getBoundingClientRect()
    const mx    = e.clientX - rect.left
    const my    = e.clientY - rect.top
    const W     = canvas.width
    const H     = canvas.height
    const pad   = { l: 40, r: 20, t: 20, b: 30 }
    const sX    = (gx) => pad.l + (gx / GRID_W) * (W - pad.l - pad.r)
    const sY    = (gy) => H - pad.b - (gy / GRID_H) * (H - pad.t - pad.b)

    let found = null
    const robots = snapshot?.robots ?? {}
    Object.entries(robots).forEach(([id, robot]) => {
      const rx = sX(robot.x ?? 0)
      const ry = sY(robot.y ?? 0)
      if (Math.hypot(mx - rx, my - ry) < 14) found = id
    })
    setHoveredBot(found)
    canvas.style.cursor = found ? 'pointer' : 'default'
  }, [snapshot])

  const handleClick = useCallback((e) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect  = canvas.getBoundingClientRect()
    const mx    = e.clientX - rect.left
    const my    = e.clientY - rect.top
    const W     = canvas.width
    const H     = canvas.height
    const pad   = { l: 40, r: 20, t: 20, b: 30 }
    const sX    = (gx) => pad.l + (gx / GRID_W) * (W - pad.l - pad.r)
    const sY    = (gy) => H - pad.b - (gy / GRID_H) * (H - pad.t - pad.b)

    let found = null
    const robots = snapshot?.robots ?? {}
    Object.entries(robots).forEach(([id, robot]) => {
      const rx = sX(robot.x ?? 0)
      const ry = sY(robot.y ?? 0)
      if (Math.hypot(mx - rx, my - ry) < 14) found = id
    })
    setSelectedBot(prev => prev === found ? null : found)
  }, [snapshot])

  const robotCount = Object.keys(snapshot?.robots ?? {}).length

  return (
    <div className="flex flex-col h-full">
      {/* Panel header */}
      <div className="panel-header">
        <div
          className="w-2 h-2 rounded-full"
          style={{ background: 'var(--cyber-cyan)', boxShadow: '0 0 6px var(--cyber-cyan)' }}
        />
        <span className="panel-title">Fleet Map — Live</span>
        <span style={{ fontFamily: 'Share Tech Mono', fontSize: '0.6rem', color: 'var(--cyber-muted)', marginLeft: 4 }}>
          {robotCount} robots · 10Hz
        </span>
        <div className="flex-1" />
        <button
          onClick={() => setShowTrails(v => !v)}
          title="Toggle trails"
          style={{
            background: showTrails ? 'rgba(0,212,255,0.12)' : 'transparent',
            border:     '1px solid var(--cyber-border)',
            color:      showTrails ? 'var(--cyber-cyan)' : 'var(--cyber-muted)',
            padding:    '3px 7px',
            cursor:     'pointer',
            borderRadius: 2,
            fontSize:   '0.6rem',
            fontFamily: 'Share Tech Mono',
          }}
        >
          TRAILS
        </button>
        <button
          onClick={() => setShowNodes(v => !v)}
          title="Toggle nodes"
          style={{
            background:   showNodes ? 'rgba(0,212,255,0.12)' : 'transparent',
            border:       '1px solid var(--cyber-border)',
            color:        showNodes ? 'var(--cyber-cyan)' : 'var(--cyber-muted)',
            padding:      '3px 7px',
            cursor:       'pointer',
            borderRadius: 2,
            fontSize:     '0.6rem',
            fontFamily:   'Share Tech Mono',
            marginLeft:   4,
          }}
        >
          NODES
        </button>
        <button
          onClick={() => setShowLabels(v => !v)}
          style={{
            background:   showLabels ? 'rgba(0,212,255,0.12)' : 'transparent',
            border:       '1px solid var(--cyber-border)',
            color:        showLabels ? 'var(--cyber-cyan)' : 'var(--cyber-muted)',
            padding:      '3px 7px',
            cursor:       'pointer',
            borderRadius: 2,
            fontSize:     '0.6rem',
            fontFamily:   'Share Tech Mono',
            marginLeft:   4,
          }}
        >
          LABELS
        </button>
        {selectedBot && (
          <button
            onClick={() => setSelectedBot(null)}
            style={{
              background:   'rgba(255,51,102,0.1)',
              border:       '1px solid var(--cyber-red)',
              color:        'var(--cyber-red)',
              padding:      '3px 7px',
              cursor:       'pointer',
              borderRadius: 2,
              fontSize:     '0.6rem',
              fontFamily:   'Share Tech Mono',
              marginLeft:   4,
            }}
          >
            ✕ {selectedBot}
          </button>
        )}
      </div>

      {/* Canvas */}
      <div className="flex-1 relative overflow-hidden">
        <canvas
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoveredBot(null)}
          onClick={handleClick}
          style={{ display: 'block', width: '100%', height: '100%' }}
        />

        {/* No data overlay */}
        {!snapshot && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-3"
            style={{ background: 'rgba(6,11,20,0.8)' }}
          >
            <div style={{ fontFamily: 'Orbitron', fontSize: '0.7rem', color: 'var(--cyber-cyan)', letterSpacing: '0.2em' }}>
              AWAITING FLEET DATA
            </div>
            <div style={{ fontFamily: 'Share Tech Mono', fontSize: '0.6rem', color: 'var(--cyber-muted)' }}>
              Connecting to WebSocket...
            </div>
          </div>
        )}
      </div>
    </div>
  )
}