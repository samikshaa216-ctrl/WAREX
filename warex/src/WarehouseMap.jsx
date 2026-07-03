import { useEffect, useRef, useCallback, memo } from 'react'

const CELL = 20
const GRID = 30
const W    = CELL * GRID
const H    = CELL * GRID

function range(a, b) { return Array.from({length: b-a}, (_,i) => i+a) }

const SHELVES = [
  ...range(3,11).flatMap(x => [3,5,7].map(y => [x,y])),
  ...range(18,26).flatMap(x => [3,5,7].map(y => [x,y])),
  ...range(3,11).flatMap(x => [13,15].map(y => [x,y])),
  ...range(18,26).flatMap(x => [13,15].map(y => [x,y])),
  ...range(22,28).flatMap(x => [21,23].map(y => [x,y])),
]

const DOCKS = [
  [1,1],[1,2],[2,1],[2,2],
  [27,1],[27,2],[28,1],[28,2],
  [1,27],[1,28],[2,27],[2,28],
  [27,27],[27,28],[28,27],[28,28],
]

const DROPS = [[13,28],[14,28],[15,28],[16,28]]

const PICKUP_STATIONS = [
  [4,8],[7,8],[10,8],[19,8],[22,8],[25,8],
  [4,12],[7,12],[10,12],[19,12],[22,12],[25,12],
  [23,20],[26,20],
]

const PALETTE = ['#00d4ff','#00ff88','#ffd700','#ff7a00','#9b59ff',
                 '#ff3366','#4fc3f7','#80cbc4','#ffb74d','#ce93d8']

function rColor(id) {
  const n = parseInt((id||'').replace(/\D/g,''), 10) || 0
  return PALETTE[(n - 1 + PALETTE.length) % PALETTE.length]
}
function batColor(p) { return p > 50 ? '#00ff88' : p > 25 ? '#ffd700' : '#ff3366' }
function lerp(a, b, t) { return a + (b - a) * t }

function WarehouseMap({ snap, selectedRobot, onSelect }) {
  const canvasRef = useRef(null)
  const smooth    = useRef({})
  const frame     = useRef(0)
  const rafRef    = useRef(null)
  const snapRef   = useRef(snap)
  const selRef    = useRef(selectedRobot)
  snapRef.current = snap
  selRef.current  = selectedRobot

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const data = snapRef.current
    const sel  = selRef.current

    ctx.fillStyle = '#050c1a'
    ctx.fillRect(0, 0, W, H)

    ctx.strokeStyle = '#0a1628'
    ctx.lineWidth   = 0.5
    for (let i = 0; i <= GRID; i++) {
      ctx.beginPath(); ctx.moveTo(i*CELL,0); ctx.lineTo(i*CELL,H); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0,i*CELL); ctx.lineTo(W,i*CELL); ctx.stroke()
    }

    // drop zones
    DROPS.forEach(([x,y]) => {
      ctx.fillStyle = 'rgba(0,255,136,0.15)'
      ctx.fillRect(x*CELL+1, y*CELL+1, CELL-2, CELL-2)
      ctx.strokeStyle = '#00ff8888'; ctx.lineWidth = 1
      ctx.strokeRect(x*CELL+1, y*CELL+1, CELL-2, CELL-2)
      ctx.font = `${CELL*0.55}px serif`; ctx.textAlign='center'; ctx.textBaseline='middle'
      ctx.fillText('📦', x*CELL+CELL/2, y*CELL+CELL/2+1)
    })

    // shelves
    SHELVES.forEach(([x,y]) => {
      const grd = ctx.createLinearGradient(x*CELL, y*CELL, x*CELL, y*CELL+CELL)
      grd.addColorStop(0, '#162540')
      grd.addColorStop(1, '#0c1a30')
      ctx.fillStyle = grd
      ctx.fillRect(x*CELL+1, y*CELL+1, CELL-2, CELL-2)
      ctx.strokeStyle = '#1e3a5a'; ctx.lineWidth = 0.8
      ctx.strokeRect(x*CELL+1, y*CELL+1, CELL-2, CELL-2)
      ctx.strokeStyle = '#1a3050'; ctx.lineWidth = 0.4
      ctx.beginPath(); ctx.moveTo(x*CELL+3, y*CELL+CELL/2)
      ctx.lineTo(x*CELL+CELL-3, y*CELL+CELL/2); ctx.stroke()
    })

    // charging docks — drawn after shelves so nothing covers them
    DOCKS.forEach(([x,y]) => {
      ctx.fillStyle = 'rgba(255,200,0,0.28)'
      ctx.fillRect(x*CELL+1, y*CELL+1, CELL-2, CELL-2)
      ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 10
      ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 1.5
      ctx.strokeRect(x*CELL+1, y*CELL+1, CELL-2, CELL-2)
      ctx.shadowBlur = 0
      ctx.font = `${CELL*0.6}px serif`; ctx.textAlign='center'; ctx.textBaseline='middle'
      ctx.fillText('⚡', x*CELL+CELL/2, y*CELL+CELL/2+1)
    })

    frame.current++
    const pulse = Math.sin(frame.current * 0.06) * 0.5 + 0.5

    const robots = data?.robots ?? {}
    const tasks  = data?.tasks  ?? {}

    for (const [rid, r] of Object.entries(robots)) {
      if (!smooth.current[rid]) smooth.current[rid] = { x: r.x, y: r.y }
      else {
        smooth.current[rid].x = lerp(smooth.current[rid].x, r.x, 0.15)
        smooth.current[rid].y = lerp(smooth.current[rid].y, r.y, 0.15)
      }
    }
    for (const k of Object.keys(smooth.current)) {
      if (!robots[k]) delete smooth.current[k]
    }

    // task goal crosshairs
    for (const [, t] of Object.entries(tasks)) {
      const col = rColor(t.robot_id)
      const gx  = t.goal_x * CELL + CELL/2
      const gy  = t.goal_y * CELL + CELL/2
      ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.globalAlpha = 0.55
      const sz = 5
      ctx.beginPath()
      ctx.moveTo(gx-sz, gy); ctx.lineTo(gx+sz, gy)
      ctx.moveTo(gx, gy-sz); ctx.lineTo(gx, gy+sz)
      ctx.stroke()
      ctx.strokeRect(gx-sz, gy-sz, sz*2, sz*2)
      ctx.globalAlpha = 1
    }

    // path trails
    for (const [rid, r] of Object.entries(robots)) {
      const trail = r.path_history || []
      if (trail.length < 2) continue
      const col = rColor(rid)
      ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.globalAlpha = 0.18
      ctx.setLineDash([2,5])
      ctx.beginPath()
      trail.forEach(([px,py], i) => {
        const cx = px*CELL+CELL/2, cy = py*CELL+CELL/2
        i===0 ? ctx.moveTo(cx,cy) : ctx.lineTo(cx,cy)
      })
      ctx.stroke()
      ctx.setLineDash([]); ctx.globalAlpha = 1
    }

    // robot → goal lines
    for (const [rid, r] of Object.entries(robots)) {
      if (!r.task_id || !tasks[r.task_id]) continue
      const t  = tasks[r.task_id]
      const sp = smooth.current[rid] || r
      const col = rColor(rid)
      ctx.strokeStyle = col; ctx.lineWidth = 0.7; ctx.globalAlpha = 0.22
      ctx.setLineDash([4,7])
      ctx.beginPath()
      ctx.moveTo(sp.x*CELL+CELL/2, sp.y*CELL+CELL/2)
      ctx.lineTo(t.goal_x*CELL+CELL/2, t.goal_y*CELL+CELL/2)
      ctx.stroke()
      ctx.setLineDash([]); ctx.globalAlpha = 1
    }

    // robots
    for (const [rid, r] of Object.entries(robots)) {
      const sp      = smooth.current[rid] || r
      const px      = sp.x * CELL + CELL/2
      const py      = sp.y * CELL + CELL/2
      const col     = rColor(rid)
      const crashed = r.status === 'CRASHED'
      const charging= r.status === 'CHARGING' || r.status === 'RECHARGING'
      const active  = r.status === 'ACTIVE'
      const isSel   = rid === sel
      const R       = 7

      if (crashed)       { ctx.shadowColor='#ff3366'; ctx.shadowBlur = 14*(0.5+pulse*0.5) }
      else if (charging) { ctx.shadowColor='#ffd700'; ctx.shadowBlur = 10*(0.5+pulse*0.5) }
      else if (active)   { ctx.shadowColor=col;       ctx.shadowBlur = 7 }
      else               { ctx.shadowBlur = 0 }

      if (isSel) {
        ctx.strokeStyle='#fff'; ctx.lineWidth=1.5; ctx.globalAlpha=0.5*(0.6+pulse*0.4)
        ctx.beginPath(); ctx.arc(px, py, R+5, 0, Math.PI*2); ctx.stroke()
        ctx.globalAlpha=1
      }

      ctx.fillStyle = col
      ctx.beginPath(); ctx.arc(px, py, R, 0, Math.PI*2); ctx.fill()
      ctx.shadowBlur = 0

      ctx.fillStyle='#050c1a'; ctx.font='bold 6px JetBrains Mono,monospace'
      ctx.textAlign='center'; ctx.textBaseline='middle'
      ctx.fillText(rid.replace('robot_','R'), px, py)

      const phaseLabel = r.label || r.phase || ''
      const phaseCol = ({
        PICK:'#00d4ff', DROP:'#00ff88', RETURN:'#ff7a00',
        CHARGE:'#ffd700', CHARGING:'#ffd700', CRASH:'#ff3366', READY:'#9b59ff'
      })[phaseLabel] || '#4a6080'
      ctx.font = 'bold 6px JetBrains Mono,monospace'
      ctx.fillStyle = phaseCol
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'
      ctx.fillText(phaseLabel, px, py - R - 1)

      if (r.task_id) {
        ctx.font = '5px JetBrains Mono,monospace'
        ctx.fillStyle = '#2a4060'
        ctx.fillText(r.task_id.replace('task_', 'T'), px, py - R - 8)
      }

      const bpct = (r.battery ?? 100)/100
      const bw = 13, bh = 2.5
      const bx = px-bw/2, by = py+R+3
      ctx.fillStyle='#0a1628'; ctx.fillRect(bx, by, bw, bh)
      ctx.fillStyle = batColor(r.battery??100)
      ctx.fillRect(bx, by, bw*bpct, bh)
    }
    ctx.shadowBlur=0
  }, [])

  useEffect(() => {
    const loop = () => { draw(); rafRef.current = requestAnimationFrame(loop) }
    rafRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafRef.current)
  }, [draw])

  const handleClick = useCallback(e => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const sx = canvas.width / rect.width
    const sy = canvas.height / rect.height
    const mx = (e.clientX - rect.left) * sx
    const my = (e.clientY - rect.top)  * sy
    const gx = Math.floor(mx / CELL)
    const gy = Math.floor(my / CELL)
    const robots = snapRef.current?.robots ?? {}
    let best = null, bestD = 2.5
    for (const [rid, r] of Object.entries(robots)) {
      const d = Math.hypot(r.x - gx, r.y - gy)
      if (d < bestD) { bestD = d; best = rid }
    }
    onSelect?.(best)
  }, [onSelect])

  return (
    <canvas
      ref={canvasRef}
      width={W} height={H}
      onClick={handleClick}
      style={{ width:'100%', height:'100%', cursor:'crosshair',
               maxWidth: W, maxHeight: H, display:'block' }}
    />
  )
}

export default memo(WarehouseMap)