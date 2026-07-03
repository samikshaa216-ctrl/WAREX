import { useState, useEffect, useRef } from 'react'

const GRID = 30

function range(a, b) { return Array.from({ length: b - a }, (_, i) => i + a) }

const SHELF_CELLS = new Set([
  ...range(3, 11).flatMap(x => [3, 5, 7].map(y => `${x},${y}`)),
  ...range(18, 26).flatMap(x => [3, 5, 7].map(y => `${x},${y}`)),
  ...range(3, 11).flatMap(x => [13, 15].map(y => `${x},${y}`)),
  ...range(18, 26).flatMap(x => [13, 15].map(y => `${x},${y}`)),
  ...range(22, 28).flatMap(x => [21, 23].map(y => `${x},${y}`)),
])

function isBlocked(x, y) {
  return SHELF_CELLS.has(`${Math.round(x)},${Math.round(y)}`)
}

const CHARGING_DOCKS = [
  { x: 1,  y: 1  }, { x: 2,  y: 1  }, { x: 1,  y: 2  }, { x: 2,  y: 2  },
  { x: 27, y: 1  }, { x: 28, y: 1  }, { x: 27, y: 2  }, { x: 28, y: 2  },
  { x: 1,  y: 27 }, { x: 2,  y: 27 }, { x: 1,  y: 28 }, { x: 2,  y: 28 },
  { x: 27, y: 27 }, { x: 28, y: 27 }, { x: 27, y: 28 }, { x: 28, y: 28 },
]

const DROP_ZONES = [
  { x: 13, y: 28 }, { x: 14, y: 28 }, { x: 15, y: 28 }, { x: 16, y: 28 },
]

const PICKUP_POINTS = [
  { x: 4,  y: 2  }, { x: 7,  y: 2  }, { x: 10, y: 2  },
  { x: 2,  y: 3  }, { x: 11, y: 3  },
  { x: 4,  y: 4  }, { x: 7,  y: 4  }, { x: 10, y: 4  },
  { x: 2,  y: 5  }, { x: 11, y: 5  },
  { x: 4,  y: 6  }, { x: 7,  y: 6  }, { x: 10, y: 6  },
  { x: 2,  y: 7  }, { x: 11, y: 7  },
  { x: 5,  y: 8  }, { x: 8,  y: 8  },
  { x: 19, y: 2  }, { x: 22, y: 2  }, { x: 25, y: 2  },
  { x: 17, y: 3  }, { x: 26, y: 3  },
  { x: 19, y: 4  }, { x: 22, y: 4  }, { x: 25, y: 4  },
  { x: 17, y: 5  }, { x: 26, y: 5  },
  { x: 19, y: 6  }, { x: 22, y: 6  }, { x: 25, y: 6  },
  { x: 17, y: 7  }, { x: 26, y: 7  },
  { x: 20, y: 8  }, { x: 23, y: 8  },
  { x: 4,  y: 12 }, { x: 7,  y: 12 }, { x: 10, y: 12 },
  { x: 2,  y: 13 }, { x: 11, y: 13 },
  { x: 4,  y: 14 }, { x: 7,  y: 14 }, { x: 10, y: 14 },
  { x: 2,  y: 15 }, { x: 11, y: 15 },
  { x: 5,  y: 16 }, { x: 8,  y: 16 },
  { x: 19, y: 12 }, { x: 22, y: 12 }, { x: 25, y: 12 },
  { x: 17, y: 13 }, { x: 26, y: 13 },
  { x: 19, y: 14 }, { x: 22, y: 14 }, { x: 25, y: 14 },
  { x: 17, y: 15 }, { x: 26, y: 15 },
  { x: 20, y: 16 }, { x: 23, y: 16 },
  { x: 23, y: 20 }, { x: 25, y: 20 }, { x: 27, y: 20 },
  { x: 21, y: 21 }, { x: 28, y: 21 },
  { x: 23, y: 22 }, { x: 25, y: 22 }, { x: 27, y: 22 },
  { x: 21, y: 23 }, { x: 28, y: 23 },
  { x: 23, y: 24 }, { x: 25, y: 24 },
]

// ── A* pathfinder ─────────────────────────────────────────────────────────────
function astar(sx, sy, tx, ty) {
  const key  = (x, y) => `${x},${y}`
  const h    = (x, y) => Math.abs(x - tx) + Math.abs(y - ty)
  const dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]
  const open     = new Map()
  const closed   = new Set()
  const cameFrom = new Map()
  const gScore   = new Map()
  const startKey = key(sx, sy)
  gScore.set(startKey, 0)
  open.set(startKey, { x: sx, y: sy, f: h(sx, sy) })

  while (open.size > 0) {
    let bestKey = null, bestF = Infinity
    for (const [k, n] of open) { if (n.f < bestF) { bestF = n.f; bestKey = k } }
    const cur = open.get(bestKey)
    open.delete(bestKey)
    if (cur.x === tx && cur.y === ty) {
      const path = []
      let k = bestKey
      while (cameFrom.has(k)) {
        const [cx, cy] = k.split(',').map(Number)
        path.unshift({ x: cx, y: cy })
        k = cameFrom.get(k)
      }
      path.push({ x: tx, y: ty })
      return path
    }
    closed.add(bestKey)
    for (const [dx, dy] of dirs) {
      const nx = cur.x + dx, ny = cur.y + dy
      if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) continue
      if (isBlocked(nx, ny) && !(nx === tx && ny === ty)) continue
      if (dx !== 0 && dy !== 0) {
        if (isBlocked(cur.x + dx, cur.y) || isBlocked(cur.x, cur.y + dy)) continue
      }
      const nk = key(nx, ny)
      if (closed.has(nk)) continue
      const cost  = (dx !== 0 && dy !== 0) ? 1.4 : 1
      const tentG = (gScore.get(bestKey) ?? Infinity) + cost
      if (tentG < (gScore.get(nk) ?? Infinity)) {
        cameFrom.set(nk, bestKey)
        gScore.set(nk, tentG)
        open.set(nk, { x: nx, y: ny, f: tentG + h(nx, ny) })
      }
    }
  }
  return [{ x: tx, y: ty }]
}

const randomFrom   = arr => arr[Math.floor(Math.random() * arr.length)]
const randomPickup = ()  => randomFrom(PICKUP_POINTS)
const randomDrop   = ()  => randomFrom(DROP_ZONES)

function nearestDock(x, y) {
  return CHARGING_DOCKS.reduce((best, dock) => {
    const d = Math.abs(dock.x - x) + Math.abs(dock.y - y)
    return d < best.dist ? { ...dock, dist: d } : best
  }, { ...CHARGING_DOCKS[0], dist: Infinity })
}

function planPath(fromX, fromY, toX, toY) {
  return astar(Math.round(fromX), Math.round(fromY), Math.round(toX), Math.round(toY))
}

function assignGoal(bot, goal) {
  bot.goal   = goal
  bot.goal_x = goal.x
  bot.goal_y = goal.y
  bot.path   = planPath(bot.x, bot.y, goal.x, goal.y)
}

const SPEED = 0.8

function stepAlongPath(bot) {
  if (!bot.path || bot.path.length === 0) return { x: bot.x, y: bot.y, path: [] }
  let { x, y } = bot
  let path = [...bot.path]
  let remaining = SPEED
  while (remaining > 0 && path.length > 0) {
    const wp = path[0]
    const dx = wp.x - x, dy = wp.y - y
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist <= remaining) { x = wp.x; y = wp.y; remaining -= dist; path.shift() }
    else { x += (dx / dist) * remaining; y += (dy / dist) * remaining; remaining = 0 }
  }
  return { x, y, path }
}

// Fixed spawn positions — safe open aisle cells
const SPAWN_POSITIONS = [
  { x: 5,  y: 10 }, { x: 9,  y: 10 }, { x: 14, y: 5  },
  { x: 14, y: 14 }, { x: 20, y: 10 }, { x: 24, y: 10 },
  { x: 5,  y: 18 }, { x: 9,  y: 18 }, { x: 14, y: 18 },
  { x: 14, y: 25 }, { x: 5,  y: 25 }, { x: 9,  y: 25 },
  { x: 14, y: 1  }, { x: 20, y: 18 }, { x: 24, y: 18 },
]

// ── Hook ──────────────────────────────────────────────────────────────────────
export default function useWarehouse({ robotCount = null } = {}) {
  const [snap, setSnap]     = useState(null)
  const robotsRef           = useRef({})
  const taskCounter         = useRef(1)
  const logsRef             = useRef([])
  const eventsRef           = useRef([])
  const metricsRef          = useRef({ fleet_mttr_s: 0, fleet_mtbf_s: 99999 })
  const networkRef          = useRef('GOOD')   // GOOD | DEGRADED | POOR | OFFLINE
  const scenarioRef         = useRef(null)

  const addLog = (msg, level = 'INFO') => {
    logsRef.current = [{ ts: Date.now() / 1000, msg, level }, ...logsRef.current.slice(0, 149)]
  }
  const addEvent = (type, robot_id, task_id = null) => {
    eventsRef.current = [{ event_type: type, robot_id, task_id, timestamp: Date.now() / 1000 }, ...eventsRef.current.slice(0, 149)]
  }

  useEffect(() => {
    if (robotCount === null) return  // wait for user to pick a count

    // Reset on robotCount change
    taskCounter.current = 1
    logsRef.current     = []
    eventsRef.current   = []

    const robots = {}
    const count  = Math.min(robotCount, SPAWN_POSITIONS.length)
    for (let i = 0; i < count; i++) {
      const id     = `robot_${String(i + 1).padStart(3, '0')}`
      const pos    = SPAWN_POSITIONS[i]
      const pickup = randomPickup()
      const taskId = `task_${taskCounter.current++}`
      robots[id] = {
        robot_id:      id,
        x: pos.x, y: pos.y,
        battery:       80 + Math.random() * 20,
        status:        'ACTIVE',
        task_id:       taskId,
        phase:         'PICKUP',
        label:         'PICK',
        goal:          pickup,
        goal_x:        pickup.x,
        goal_y:        pickup.y,
        path:          planPath(pos.x, pos.y, pickup.x, pickup.y),
        path_history:  [[pos.x, pos.y]],
        chargingDock:  null,
        chargeWait:    0,
        crashCount:    0,
        totalDowntime: 0,
        crashedAt:     null,
        manualCrash:   false,
      }
    }
    robotsRef.current = robots

    const loop = setInterval(() => {
      const bots = { ...robotsRef.current }

      Object.values(bots).forEach(bot => {

        // CRASHED — only recover via RECOVER button (manualCrash flag)
        if (bot.status === 'CRASHED') return

        // CHARGING — sit and recharge
        if (bot.status === 'CHARGING') {
          bot.chargeWait -= 1
          bot.battery     = Math.min(100, bot.battery + 5)
          if (bot.chargeWait <= 0 || bot.battery >= 100) {
            bot.battery = 100
            bot.status  = 'IDLE'
            bot.label   = 'READY'
            addLog(`${bot.robot_id} fully charged → 100%`, 'INFO')
            setTimeout(() => {
              const cur = robotsRef.current[bot.robot_id]
              if (!cur || cur.status !== 'IDLE' || cur.manualCrash) return
              const pickup  = randomPickup()
              cur.task_id   = `task_${taskCounter.current++}`
              cur.phase     = 'PICKUP'
              cur.label     = 'PICK'
              cur.status    = 'ACTIVE'
              assignGoal(cur, pickup)
              robotsRef.current = { ...robotsRef.current }
              addEvent('TASK_ASSIGNED', bot.robot_id, cur.task_id)
            }, 1200)
          }
          return
        }

        // TO_DOCK — move to charger
        if (bot.status === 'TO_DOCK') {
          const stepped = stepAlongPath(bot)
          bot.x = stepped.x; bot.y = stepped.y; bot.path = stepped.path
          bot.battery = Math.max(0, bot.battery - 0.08)
          bot.path_history = [...(bot.path_history || []), [bot.x, bot.y]].slice(-60)
          if (bot.battery <= 0) {
            bot.battery = 0; bot.status = 'CRASHED'; bot.label = 'CRASH'
            bot.task_id = null; bot.path = []
            bot.crashedAt = Date.now() / 1000; bot.crashCount++
            bot.manualCrash = true
            addLog(`CRASH: ${bot.robot_id} died en-route to dock!`, 'ERROR')
            addEvent('CRASH', bot.robot_id)
            return
          }
          if (bot.path.length === 0) {
            bot.x = bot.chargingDock.x; bot.y = bot.chargingDock.y
            bot.status = 'CHARGING'; bot.label = 'CHARGING'; bot.chargeWait = 14
            addLog(`${bot.robot_id} docked at (${bot.x},${bot.y}) — charging`, 'INFO')
          }
          return
        }

        // ACTIVE / IDLE — execute task
        const netMult = { GOOD: 1, DEGRADED: 1.3, POOR: 1.7, OFFLINE: 2.2 }[networkRef.current] ?? 1
        // OFFLINE/POOR: simulate lost comms — robot keeps moving but task reassignment is delayed
        const stepped = stepAlongPath(bot)
        bot.x = stepped.x; bot.y = stepped.y; bot.path = stepped.path
        bot.battery = Math.max(0, bot.battery - 0.3 * netMult)
        bot.path_history = [...(bot.path_history || []), [bot.x, bot.y]].slice(-60)

        if (bot.battery <= 0) {
          bot.battery = 0; bot.status = 'CRASHED'; bot.label = 'CRASH'
          bot.task_id = null; bot.path = []
          bot.crashedAt = Date.now() / 1000; bot.crashCount++
          bot.manualCrash = true
          addLog(`CRASH: ${bot.robot_id} battery depleted`, 'ERROR')
          addEvent('CRASH', bot.robot_id)
          return
        }

        // Low battery → nearest dock
        if (bot.battery <= 22 && bot.status !== 'TO_DOCK') {
          const prevTask  = bot.task_id
          const prevGoal  = bot.goal
          const prevPhase = bot.phase
          const dock = nearestDock(bot.x, bot.y)
          bot.chargingDock = dock; bot.status = 'TO_DOCK'; bot.label = 'CHARGE'
          bot.task_id = null
          assignGoal(bot, dock)
          addLog(`LOW BAT: ${bot.robot_id} (${bot.battery.toFixed(0)}%) → dock (${dock.x},${dock.y})`, 'WARN')
          addEvent('LOW_BATTERY', bot.robot_id, prevTask)
          const relief = Object.values(bots).find(b =>
            b.robot_id !== bot.robot_id && b.status === 'IDLE' && b.battery > 40
          )
          if (relief && prevGoal) {
            const tid = `task_${taskCounter.current++}`
            relief.task_id = tid; relief.phase = prevPhase ?? 'PICKUP'
            relief.label   = prevPhase === 'DELIVER' ? 'DROP' : 'PICK'
            relief.status  = 'ACTIVE'
            assignGoal(relief, prevGoal)
            addLog(`REROUTE: ${prevTask} → ${relief.robot_id}`, 'INFO')
            addEvent('REROUTE', relief.robot_id, tid)
          }
          return
        }

        // Reached goal
        if (bot.path.length === 0) {
          if (bot.phase === 'PICKUP') {
            bot.phase = 'DELIVER'; bot.label = 'DROP'
            const drop = randomDrop()
            assignGoal(bot, drop)
            addLog(`${bot.robot_id} PICKED UP → delivering ${bot.task_id}`, 'INFO')
          } else {
            if (bot.phase === 'DELIVER') {
              addEvent('TASK_COMPLETED', bot.robot_id, bot.task_id)
              addLog(`COMPLETE: ${bot.robot_id} finished ${bot.task_id}`, 'INFO')
            }
            const pickup = randomPickup()
            bot.task_id  = `task_${taskCounter.current++}`
            bot.phase    = 'PICKUP'; bot.label = 'PICK'; bot.status = 'ACTIVE'
            assignGoal(bot, pickup)
            addEvent('TASK_ASSIGNED', bot.robot_id, bot.task_id)
          }
        }
      })

      robotsRef.current = bots

      const evts     = eventsRef.current
      const metCount = evts.filter(e => e.event_type === 'TASK_COMPLETED').length
      const totalT   = taskCounter.current - 1
      const missed   = Math.max(0, evts.filter(e => e.event_type === 'CRASH').length)
      const rate     = metCount + missed > 0
        ? Math.round((metCount / (metCount + missed)) * 100) : 100
      const allBots  = Object.values(bots)
      const crashers = allBots.filter(b => b.crashCount > 0)
      metricsRef.current = {
        fleet_mttr_s: crashers.length > 0
          ? parseFloat((crashers.reduce((s, b) => s + b.totalDowntime / Math.max(1, b.crashCount), 0) / crashers.length).toFixed(2))
          : 0,
        fleet_mtbf_s: 99999,
      }

      setSnap({
        robots: { ...bots },
        tasks: Object.fromEntries(
          Object.entries(bots)
            .filter(([, r]) => r.task_id && r.goal_x != null)
            .map(([, r]) => [r.task_id, {
              task_id: r.task_id, robot_id: r.robot_id,
              goal_x: r.goal_x, goal_y: r.goal_y, phase: r.phase,
            }])
        ),
        stats:          { total: totalT, met: metCount, missed, rate },
        active_robots:  allBots.filter(r => r.status === 'ACTIVE').length,
        idle_robots:    allBots.filter(r => r.status === 'IDLE').length,
        crashed_robots: allBots.filter(r => r.status === 'CRASHED').length,
        timestamp:      Date.now() / 1000,
      })
    }, 400)

    return () => clearInterval(loop)
  }, [robotCount])

  function crashRobot(robotId) {
    const bots = robotsRef.current, bot = bots[robotId]
    if (!bot || bot.status === 'CRASHED') return
    bot.battery = 0; bot.status = 'CRASHED'; bot.label = 'CRASH'
    bot.task_id = null; bot.path = []
    bot.crashedAt = Date.now() / 1000; bot.crashCount++
    bot.manualCrash = true
    robotsRef.current = { ...bots }
    addLog(`MANUAL CRASH: ${robotId} forced offline`, 'ERROR')
    addEvent('CRASH', robotId)
  }

  function drainBattery(robotId) {
    const bots = robotsRef.current, bot = bots[robotId]
    if (!bot || bot.status === 'CRASHED') return
    bot.battery = Math.max(5, (bot.battery ?? 100) - 50)
    robotsRef.current = { ...bots }
    addLog(`DRAIN: ${robotId} battery → ${Math.round(bot.battery)}%`, 'WARN')
    addEvent('LOW_BATTERY', robotId, bot.task_id)
  }

  function recoverRobot(robotId) {
    const bots = robotsRef.current, bot = bots[robotId]
    if (!bot || bot.status !== 'CRASHED') return
    const pickup = randomPickup()
    const taskId = `task_${taskCounter.current++}`
    bot.battery     = 100
    bot.status      = 'ACTIVE'
    bot.label       = 'PICK'
    bot.phase       = 'PICKUP'
    bot.task_id     = taskId
    bot.manualCrash = false
    bot.crashedAt   = null
    assignGoal(bot, pickup)
    robotsRef.current = { ...bots }
    addLog(`RECOVERY: ${robotId} back online`, 'INFO')
    addEvent('RECOVERY', robotId, taskId)
  }

  function setNetwork(condition) {
    networkRef.current = condition
    addLog(`NETWORK → ${condition}`, 'WARN')
    addEvent('NETWORK_CHANGE', null, null)
  }

  // Standalone scenarios that work without a backend
  function runScenario(name) {
    const bots = robotsRef.current
    const ids  = Object.keys(bots)
    if (ids.length === 0) return

    if (name === 'mass_battery_drain') {
      addLog(`SCENARIO: Mass battery drain started`, 'WARN')
      ids.forEach(id => {
        const b = bots[id]
        if (b && b.status !== 'CRASHED') b.battery = Math.max(5, b.battery - 60)
      })
      robotsRef.current = { ...bots }
    }

    else if (name === 'cascade_crash') {
      addLog(`SCENARIO: Cascade crash — disabling 50% of fleet`, 'ERROR')
      const half = Math.ceil(ids.length / 2)
      ids.slice(0, half).forEach(id => {
        const b = bots[id]
        if (b && b.status !== 'CRASHED') {
          b.battery = 0; b.status = 'CRASHED'; b.label = 'CRASH'
          b.task_id = null; b.path = []; b.manualCrash = true
          b.crashedAt = Date.now() / 1000; b.crashCount++
          addEvent('CRASH', id)
        }
      })
      robotsRef.current = { ...bots }
    }

    else if (name === 'fleet_recovery') {
      addLog(`SCENARIO: Fleet recovery — reviving all crashed robots`, 'INFO')
      ids.forEach(id => {
        const b = bots[id]
        if (b && b.status === 'CRASHED') {
          const pickup = randomPickup()
          const taskId = `task_${taskCounter.current++}`
          b.battery = 100; b.status = 'ACTIVE'; b.label = 'PICK'
          b.phase = 'PICKUP'; b.task_id = taskId; b.manualCrash = false
          b.crashedAt = null
          assignGoal(b, pickup)
          addEvent('RECOVERY', id, taskId)
        }
      })
      robotsRef.current = { ...bots }
    }

    else if (name === 'network_storm') {
      addLog(`SCENARIO: Network storm — degrading comms for 15s`, 'WARN')
      setNetwork('POOR')
      setTimeout(() => { setNetwork('GOOD'); addLog(`SCENARIO: Network storm cleared`, 'INFO') }, 15000)
    }

    else if (name === 'peak_load') {
      addLog(`SCENARIO: Peak load — all idle robots activated`, 'INFO')
      ids.forEach(id => {
        const b = bots[id]
        if (b && b.status === 'IDLE' && !b.manualCrash) {
          const pickup = randomPickup()
          const taskId = `task_${taskCounter.current++}`
          b.status = 'ACTIVE'; b.label = 'PICK'; b.phase = 'PICKUP'; b.task_id = taskId
          assignGoal(b, pickup)
          addEvent('TASK_ASSIGNED', id, taskId)
        }
      })
      robotsRef.current = { ...bots }
    }
  }

  return {
    snap,
    events:       eventsRef.current,
    logs:         logsRef.current,
    metrics:      metricsRef.current,
    connected:    true,
    network:      networkRef.current,
    crashRobot,
    drainBattery,
    recoverRobot,
    setNetwork,
    runScenario,
  }
}