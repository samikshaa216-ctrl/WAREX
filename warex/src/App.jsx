import { useState, useCallback, useEffect, useRef } from 'react'
import useWarehouse from './useWarehouse.js'
import WarehouseMap from './WarehouseMap.jsx'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

const PALETTE = ['#00d4ff','#00ff88','#ffd700','#ff7a00','#9b59ff',
                 '#ff3366','#4fc3f7','#80cbc4','#ffb74d','#ce93d8']
const rColor  = id => PALETTE[((parseInt((id||'').replace(/\D/g,''),10)||1)-1+PALETTE.length)%PALETTE.length]
const batColor= p  => p>50?'#00ff88':p>25?'#ffd700':'#ff3366'
const statCol = s  => ({ACTIVE:'#00d4ff',IDLE:'#00ff88',CRASHED:'#ff3366',
                         CHARGING:'#ffd700',TO_DOCK:'#ffd700'}[s]||'#4a6080')

const Label = ({children,color='#4a6080'}) => (
  <div style={{fontSize:9,fontFamily:'JetBrains Mono,monospace',
    letterSpacing:1.5,color,marginBottom:3,textTransform:'uppercase'}}>{children}</div>
)
const Value = ({children,color='#c8d8f0',size=20}) => (
  <div style={{fontSize:size,fontWeight:700,fontFamily:'Orbitron,monospace',color,lineHeight:1}}>{children}</div>
)

function KCard({label,value,color='#00d4ff',sub,blink=false}) {
  return (
    <div style={{background:'#0a1628',border:`1px solid ${color}22`,borderRadius:8,
      padding:'10px 14px',flex:'1 1 80px',minWidth:80}}>
      <Label color='#4a6080'>{label}</Label>
      <Value color={color} size={22}>{value??'—'}</Value>
      {sub&&<div style={{fontSize:9,color:'#4a6080',marginTop:3,fontFamily:'JetBrains Mono,monospace'}}>{sub}</div>}
    </div>
  )
}

function BatBar({pct}) {
  const c = batColor(pct)
  return (
    <div style={{height:3,background:'#0a1628',borderRadius:2,overflow:'hidden',marginTop:5}}>
      <div style={{width:`${Math.max(0,Math.min(100,pct))}%`,height:'100%',
        background:c,borderRadius:2,transition:'width 0.5s',
        boxShadow:pct<25?`0 0 5px ${c}`:'none'}}/>
    </div>
  )
}

function RobotCard({rid,r,selected,onClick}) {
  const col     = rColor(rid)
  const sc      = statCol(r.status)
  const crashed = r.status==='CRASHED'
  const lowBat  = (r.battery??100)<25
  return (
    <div onClick={onClick} style={{
      background: selected?'#0f1e35':'#090f1e',
      border:`1px solid ${selected?col:crashed?'#ff336633':'#1a3050'}`,
      borderRadius:8,padding:'9px 11px',cursor:'pointer',marginBottom:6,
      boxShadow:selected?`0 0 14px ${col}33`:crashed?'0 0 8px #ff336620':'none',
      transition:'all 0.2s'
    }}>
      <div style={{height:2,background:col,borderRadius:1,marginBottom:8,opacity:.8}}/>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:5}}>
        <span style={{fontFamily:'Orbitron,monospace',fontWeight:700,fontSize:12,color:col}}>
          {rid.replace('robot_','R')}
        </span>
        <span style={{fontSize:8,fontFamily:'JetBrains Mono,monospace',letterSpacing:1,
          color:sc,background:`${sc}18`,padding:'2px 6px',borderRadius:3,border:`1px solid ${sc}33`}}>
          {r.status}
        </span>
      </div>
      <div style={{fontSize:10,color:'#4a6080',fontFamily:'JetBrains Mono,monospace',marginBottom:4}}>
        ({Math.round(r.x)},{Math.round(r.y)})
      </div>
      {r.task_id
        ? <div style={{fontSize:10,marginBottom:4}}>
            🎯 <span style={{color:'#00d4ff',fontFamily:'JetBrains Mono,monospace'}}>
              {r.task_id.replace('task_','T')}
            </span>
          </div>
        : <div style={{fontSize:10,color:'#1e3050',marginBottom:4}}>no task</div>
      }
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <span style={{fontSize:9,color:'#4a6080'}}>BAT</span>
        <span style={{fontSize:10,fontFamily:'JetBrains Mono,monospace',
          color:batColor(r.battery??100),fontWeight:600}}>
          {Math.round(r.battery??0)}%
          {lowBat&&<span style={{color:'#ff3366',marginLeft:3}}>⚠</span>}
        </span>
      </div>
      <BatBar pct={r.battery??100}/>
      {crashed&&(
        <div style={{marginTop:6,fontSize:9,color:'#ff3366',fontFamily:'JetBrains Mono,monospace',
          textAlign:'center',letterSpacing:1}}>✕ FAULT</div>
      )}
    </div>
  )
}

const EVT = {
  CRASH:          {icon:'💥',col:'#ff3366'},
  RECOVERY:       {icon:'🔧',col:'#00ff88'},
  TASK_ASSIGNED:  {icon:'📋',col:'#00d4ff'},
  TASK_COMPLETED: {icon:'✅',col:'#00ff88'},
  LOW_BATTERY:    {icon:'🔋',col:'#ffd700'},
  REROUTE:        {icon:'🔀',col:'#ff7a00'},
}
const fmtT = ts => new Date(ts*1000).toLocaleTimeString('en',{hour12:false})

function EventRow({ev}) {
  if (ev.event_type==='ROBOT_UPDATED') return null
  const s = EVT[ev.event_type]||{icon:'•',col:'#4a6080'}
  const c = ev.robot_id ? rColor(ev.robot_id) : s.col
  return (
    <div style={{display:'flex',gap:7,alignItems:'flex-start',
      padding:'5px 0',borderBottom:'1px solid #0a1628',fontSize:11}}>
      <span style={{fontSize:13,flexShrink:0}}>{s.icon}</span>
      <span style={{color:'#2a3f60',fontFamily:'JetBrains Mono,monospace',fontSize:9,minWidth:56,flexShrink:0}}>
        {fmtT(ev.timestamp)}
      </span>
      <span style={{color:c,fontFamily:'JetBrains Mono,monospace',fontSize:9,fontWeight:700,minWidth:24,flexShrink:0}}>
        {ev.robot_id?.replace('robot_','R')||''}
      </span>
      <span style={{color:s.col,fontSize:10,flex:1}}>
        {ev.event_type.replace(/_/g,' ')}
        {ev.task_id&&<span style={{color:'#2a3f60'}}> · {ev.task_id.replace('task_','T')}</span>}
      </span>
    </div>
  )
}

function LogRow({entry}) {
  const msg  = entry.msg||entry.message||''
  const isE  = /ERROR|CRASH/i.test(msg)
  const isW  = /WARN|LOW.BAT/i.test(msg)
  const isOk = /RECOV|COMPLET|ASSIGN/i.test(msg)
  const col  = isE?'#ff3366':isW?'#ffd700':isOk?'#00ff88':'#3a5070'
  return (
    <div style={{fontSize:9,fontFamily:'JetBrains Mono,monospace',color:col,
      padding:'2px 0',lineHeight:1.5,borderBottom:'1px solid #09101e'}}>
      <span style={{color:'#1e3050',marginRight:6}}>{fmtT(entry.ts||0)}</span>
      {entry.level&&<span style={{color:'#2a4060',marginRight:6}}>[{entry.level}]</span>}
      {msg}
    </div>
  )
}

function ThroughputChart({snap}) {
  const hist = useRef([])
  useEffect(() => {
    if (!snap?.stats) return
    const s = snap.stats
    hist.current = [...hist.current.slice(-29), {
      t: new Date().toLocaleTimeString('en',{hour12:false}),
      met: s.met||0, missed: s.missed||0,
    }]
  }, [snap?.stats?.met, snap?.stats?.missed])
  return (
    <ResponsiveContainer width='100%' height='100%'>
      <AreaChart data={hist.current} margin={{top:4,right:4,left:-28,bottom:0}}>
        <defs>
          <linearGradient id='gMet' x1='0' y1='0' x2='0' y2='1'>
            <stop offset='0%' stopColor='#00ff88' stopOpacity={0.4}/>
            <stop offset='100%' stopColor='#00ff88' stopOpacity={0}/>
          </linearGradient>
          <linearGradient id='gMiss' x1='0' y1='0' x2='0' y2='1'>
            <stop offset='0%' stopColor='#ff3366' stopOpacity={0.3}/>
            <stop offset='100%' stopColor='#ff3366' stopOpacity={0}/>
          </linearGradient>
        </defs>
        <XAxis dataKey='t' hide/>
        <YAxis tick={{fontSize:8,fill:'#3a5070'}}/>
        <Tooltip contentStyle={{background:'#0a1628',border:'1px solid #1a3050',fontSize:10,borderRadius:4}}/>
        <Area type='monotone' dataKey='met'    stroke='#00ff88' fill='url(#gMet)'  strokeWidth={1.5}/>
        <Area type='monotone' dataKey='missed' stroke='#ff3366' fill='url(#gMiss)' strokeWidth={1.5}/>
      </AreaChart>
    </ResponsiveContainer>
  )
}

function Controls({snap, onFeedback, crashRobot, drainBattery, recoverRobot, setNetwork, runScenario, network}) {
  const [selRobot, setSelRobot] = useState('')
  const [netCond,  setNetCond]  = useState(network || 'GOOD')
  const [scenario, setScenario] = useState('')
  const robots    = Object.keys(snap?.robots||{})
  const isCrashed = selRobot && snap?.robots?.[selRobot]?.status === 'CRASHED'

  const selStyle = {
    width:'100%',background:'#090f1e',border:'1px solid #1a3050',color:'#c8d8f0',
    padding:'6px 8px',borderRadius:4,fontFamily:'JetBrains Mono,monospace',fontSize:10,
    cursor:'pointer',marginBottom:7
  }
  const btnStyle = (col,dis) => ({
    width:'100%',background: dis?'transparent':`${col}11`,
    border:`1px solid ${dis?'#1a3050':col}`,
    color:dis?'#2a3f60':col,padding:'7px 12px',borderRadius:4,
    cursor:dis?'not-allowed':'pointer',
    fontFamily:'JetBrains Mono,monospace',fontSize:10,letterSpacing:1,
    marginBottom:6,transition:'background 0.15s'
  })

  const NET_CONDITIONS = ['GOOD','DEGRADED','POOR','OFFLINE']
  const SCENARIOS = [
    { name: 'mass_battery_drain', label: '🔋 Mass Battery Drain'  },
    { name: 'cascade_crash',      label: '💥 Cascade Crash (50%)' },
    { name: 'fleet_recovery',     label: '🔧 Fleet Recovery'       },
    { name: 'network_storm',      label: '📡 Network Storm (15s)'  },
    { name: 'peak_load',          label: '⚡ Peak Load Burst'      },
  ]

  return (
    <div style={{padding:'10px 12px',overflowY:'auto',height:'100%'}}>
      <div style={{fontSize:9,color:'#2a4060',fontFamily:'JetBrains Mono,monospace',
        letterSpacing:2,marginBottom:10,borderBottom:'1px solid #1a3050',paddingBottom:5}}>
        ── ROBOT ──
      </div>
      <select style={selStyle} value={selRobot} onChange={e=>setSelRobot(e.target.value)}>
        <option value=''>Select robot…</option>
        {robots.map(id=><option key={id} value={id}>{id.replace('robot_','Robot ')}</option>)}
      </select>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:5,marginBottom:6}}>
        <button disabled={!selRobot||isCrashed} style={btnStyle('#ff3366',!selRobot||isCrashed)}
          onClick={()=>{ crashRobot(selRobot); onFeedback(`💥 Crashed ${selRobot}`) }}>
          💥 CRASH
        </button>
        <button disabled={!selRobot||isCrashed} style={btnStyle('#ffd700',!selRobot||isCrashed)}
          onClick={()=>{ drainBattery(selRobot); onFeedback(`🔋 Drained ${selRobot}`) }}>
          🔋 DRAIN
        </button>
      </div>
      <button
        disabled={!isCrashed}
        style={{...btnStyle('#00ff88',!isCrashed), boxShadow: isCrashed?'0 0 8px #00ff8833':'none'}}
        onClick={()=>{ recoverRobot(selRobot); onFeedback(`🔧 Recovering ${selRobot}`) }}>
        🔧 RECOVER
      </button>

      {/* NETWORK */}
      <div style={{fontSize:9,color:'#2a4060',fontFamily:'JetBrains Mono,monospace',
        letterSpacing:2,margin:'14px 0 10px',borderBottom:'1px solid #1a3050',paddingBottom:5}}>
        ── NETWORK ──
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:4,marginBottom:8}}>
        {NET_CONDITIONS.map(c => {
          const active = netCond === c
          const col = {GOOD:'#00ff88',DEGRADED:'#ffd700',POOR:'#ff7a00',OFFLINE:'#ff3366'}[c]
          return (
            <button key={c} onClick={()=>{ setNetCond(c); setNetwork(c); onFeedback(`📡 Network → ${c}`) }}
              style={{
                background: active?`${col}22`:'transparent',
                border:`1px solid ${active?col:'#1a3050'}`,
                color: active?col:'#2a4060',
                padding:'5px 4px',borderRadius:4,cursor:'pointer',
                fontFamily:'JetBrains Mono,monospace',fontSize:8,letterSpacing:1,
              }}>
              {c}
            </button>
          )
        })}
      </div>
      <div style={{fontSize:8,color:'#1e3050',fontFamily:'JetBrains Mono,monospace',marginBottom:10,lineHeight:1.6}}>
        {netCond==='GOOD'    && 'Full speed • no delay'}
        {netCond==='DEGRADED'&& '30% slower • random delays'}
        {netCond==='POOR'    && '60% slower • frequent stalls'}
        {netCond==='OFFLINE' && 'Robots freeze — no cloud sync'}
      </div>

      {/* EXPERIMENT / SCENARIO */}
      <div style={{fontSize:9,color:'#2a4060',fontFamily:'JetBrains Mono,monospace',
        letterSpacing:2,marginBottom:10,borderBottom:'1px solid #1a3050',paddingBottom:5}}>
        ── EXPERIMENT ──
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:5,marginBottom:8}}>
        {SCENARIOS.map(s=>(
          <button key={s.name}
            onClick={()=>{ setScenario(s.name); runScenario(s.name); onFeedback(`▶ ${s.label}`) }}
            style={{
              background: scenario===s.name?'#9b59ff22':'transparent',
              border:`1px solid ${scenario===s.name?'#9b59ff':'#1a3050'}`,
              color: scenario===s.name?'#9b59ff':'#4a6080',
              padding:'6px 10px',borderRadius:4,cursor:'pointer',textAlign:'left',
              fontFamily:'JetBrains Mono,monospace',fontSize:9,
            }}>
            {s.label}
          </button>
        ))}
      </div>

      {/* LEGEND */}
      <div style={{marginTop:4,borderTop:'1px solid #1a3050',paddingTop:12}}>
        <div style={{fontSize:9,color:'#2a4060',fontFamily:'JetBrains Mono,monospace',
          letterSpacing:2,marginBottom:8}}>── LEGEND ──</div>
        {[
          ['#ffd700','⚡ Charging Dock'],
          ['#00ff88','📦 Drop Zone'],
          ['#00d4ff','📥 Pickup Station'],
          ['#162540','▪ Shelf/Obstacle'],
          ['#00d4ff','━ Task Route'],
          ['#c8d8f0','● Robot (click to select)'],
        ].map(([c,l])=>(
          <div key={l} style={{display:'flex',alignItems:'center',gap:6,marginBottom:4}}>
            <div style={{width:9,height:9,background:c,borderRadius:2,flexShrink:0,opacity:.85}}/>
            <span style={{fontSize:9,color:'#3a5070',fontFamily:'JetBrains Mono,monospace'}}>{l}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Setup Screen ──────────────────────────────────────────────────────────────
function SetupScreen({onStart}) {
  const [count, setCount] = useState(6)
  return (
    <div style={{
      position:'fixed',inset:0,zIndex:100,background:'rgba(5,12,26,0.97)',
      display:'flex',alignItems:'center',justifyContent:'center',
    }}>
      <div style={{
        background:'#070e1c',border:'1px solid #1a3050',borderRadius:12,
        padding:'40px 48px',display:'flex',flexDirection:'column',
        alignItems:'center',gap:24,boxShadow:'0 0 60px #00d4ff18',minWidth:340
      }}>
        <div style={{fontFamily:'Orbitron,monospace',fontWeight:900,fontSize:28,
          color:'#00d4ff',letterSpacing:6,textShadow:'0 0 20px #00d4ff55'}}>
          WAREX
        </div>
        <div style={{fontFamily:'JetBrains Mono,monospace',fontSize:10,
          color:'#2a4060',letterSpacing:3}}>
          WAREHOUSE FLEET COMMAND CENTER
        </div>

        <div style={{width:'100%',borderTop:'1px solid #1a3050',paddingTop:20}}>
          <div style={{fontFamily:'JetBrains Mono,monospace',fontSize:9,
            color:'#4a6080',letterSpacing:2,marginBottom:12,textAlign:'center'}}>
            NUMBER OF ROBOTS (MAX 15)
          </div>
          <div style={{display:'flex',flexWrap:'wrap',gap:6,justifyContent:'center',marginBottom:16}}>
            {Array.from({length:15},(_,i)=>i+1).map(n=>(
              <div key={n} onClick={()=>setCount(n)} style={{
                width:34,height:34,borderRadius:6,cursor:'pointer',
                display:'flex',alignItems:'center',justifyContent:'center',
                fontFamily:'Orbitron,monospace',fontWeight:700,fontSize:11,
                background: n<=count?'#00d4ff22':'#0a1628',
                border:`1px solid ${n<=count?'#00d4ff':'#1a3050'}`,
                color: n<=count?'#00d4ff':'#2a4060',
                transition:'all 0.15s',
              }}>{n}</div>
            ))}
          </div>
          <div style={{textAlign:'center',fontFamily:'Orbitron,monospace',
            fontSize:40,fontWeight:900,color:'#00d4ff',letterSpacing:4,marginBottom:4}}>
            {count}
          </div>
          <div style={{textAlign:'center',fontFamily:'JetBrains Mono,monospace',
            fontSize:9,color:'#2a4060'}}>robots selected</div>
        </div>

        <button
          onClick={()=>onStart(count)}
          style={{
            background:'transparent',border:'2px solid #00d4ff',color:'#00d4ff',
            padding:'14px 52px',borderRadius:6,cursor:'pointer',
            fontFamily:'JetBrains Mono,monospace',fontSize:12,letterSpacing:4,
            boxShadow:'0 0 20px #00d4ff22',transition:'all 0.2s',
          }}
          onMouseEnter={e=>{e.currentTarget.style.background='#00d4ff18'}}
          onMouseLeave={e=>{e.currentTarget.style.background='transparent'}}
        >
          ▶ START SIMULATION
        </button>
      </div>
    </div>
  )
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [robotCount, setRobotCount] = useState(null)
  const activeCount = robotCount ?? 0   // 0 = hook spawns nothing until started

  const { snap, events, logs, metrics, connected, crashRobot, drainBattery, recoverRobot, setNetwork, runScenario, network } =
    useWarehouse({ robotCount })

  const [selRobot, setSelRobot] = useState(null)
  const [tab, setTab]           = useState('events')
  const [feedback, setFeedback] = useState('')
  const fbTimer = useRef(null)

  const handleFeedback = useCallback(msg => {
    setFeedback(msg)
    clearTimeout(fbTimer.current)
    fbTimer.current = setTimeout(()=>setFeedback(''), 3000)
  }, [])

  const handleSelect = useCallback(id => setSelRobot(p=>p===id?null:id), [])
  const handleStart  = (count) => setRobotCount(count)
  const handleReset  = () => { setRobotCount(null); setSelRobot(null) }

  const st     = snap?.stats ?? {}
  const robots = snap?.robots ?? {}
  const active = snap?.active_robots  ?? 0
  const crashed= snap?.crashed_robots ?? 0
  const idle   = snap?.idle_robots    ?? 0
  const rCount = Object.keys(robots).length
  const rate   = (st.rate??0).toFixed(1)
  const filteredEvts = (events||[]).filter(e=>e.event_type!=='ROBOT_UPDATED').slice(-30).reverse()

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100vh',overflow:'hidden',background:'#050c1a'}}>

      {robotCount === null && <SetupScreen onStart={handleStart}/>}

      {/* TOP BAR */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',
        padding:'8px 16px',background:'#070e1c',
        borderBottom:'1px solid #1a3050',flexShrink:0,zIndex:10}}>
        <div style={{display:'flex',alignItems:'center',gap:14}}>
          <span style={{fontFamily:'Orbitron,monospace',fontWeight:900,fontSize:20,
            color:'#00d4ff',letterSpacing:4,textShadow:'0 0 14px #00d4ff88'}}>WAREX</span>
          <span style={{fontFamily:'JetBrains Mono,monospace',fontSize:9,color:'#2a4060',
            letterSpacing:2,borderLeft:'1px solid #1a3050',paddingLeft:12}}>
            WAREHOUSE FLEET COMMAND CENTER
          </span>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:14}}>
          {feedback&&(
            <span style={{fontFamily:'JetBrains Mono,monospace',fontSize:10,
              color:'#00d4ff',background:'#00d4ff11',padding:'3px 10px',borderRadius:4,
              border:'1px solid #00d4ff22'}}>
              {feedback}
            </span>
          )}
          <span style={{fontFamily:'JetBrains Mono,monospace',fontSize:10,color:'#2a4060'}}>
            {snap?.timestamp ? new Date(snap.timestamp*1000).toLocaleTimeString('en',{hour12:false}) : '--:--:--'}
          </span>
          <span style={{fontFamily:'JetBrains Mono,monospace',fontSize:10,color:'#2a4060'}}>
            {rCount} ROBOTS
          </span>
          <div style={{display:'flex',alignItems:'center',gap:5}}>
            <div style={{width:7,height:7,borderRadius:'50%',
              background:'#00ff88',boxShadow:'0 0 7px #00ff88'}}/>
            <span style={{fontFamily:'JetBrains Mono,monospace',fontSize:10,color:'#00ff88'}}>LIVE</span>
          </div>
          <button onClick={handleReset} style={{
            background:'transparent',border:'1px solid #1a3050',color:'#4a6080',
            padding:'4px 12px',borderRadius:4,cursor:'pointer',
            fontFamily:'JetBrains Mono,monospace',fontSize:9,letterSpacing:2
          }}>⟳ RESET</button>
        </div>
      </div>

      {/* KPI STRIP */}
      <div style={{display:'flex',gap:8,padding:'8px 12px',
        background:'#050c1a',borderBottom:'1px solid #1a3050',flexShrink:0,flexWrap:'wrap'}}>
        <KCard label='Total Tasks'   value={st.total??0}  color='#00d4ff'/>
        <KCard label='Deadlines Met' value={st.met??0}    color='#00ff88'/>
        <KCard label='Missed'        value={st.missed??0} color='#ff3366' blink={(st.missed??0)>0}/>
        <KCard label='Success %'     value={`${rate}%`}   color={parseFloat(rate)>=70?'#00ff88':'#ff7a00'}/>
        <div style={{width:1,background:'#1a3050',margin:'0 2px'}}/>
        <KCard label='Active'  value={active}  color='#00d4ff'/>
        <KCard label='Idle'    value={idle}    color='#00ff88'/>
        <KCard label='Crashed' value={crashed} color='#ff3366' blink={crashed>0}/>
        <div style={{width:1,background:'#1a3050',margin:'0 2px'}}/>
        <KCard label='MTTR (s)'
          value={metrics?.fleet_mttr_s!=null ? metrics.fleet_mttr_s.toFixed(1) : '—'}
          color='#9b59ff' sub='mean time to recover'/>
        <KCard label='MTBF (s)'
          value={metrics?.fleet_mtbf_s!=null&&metrics.fleet_mtbf_s<99999
            ? metrics.fleet_mtbf_s.toFixed(0) : '∞'}
          color='#ff7a00' sub='mean time between fail'/>
      </div>

      {/* MAIN LAYOUT */}
      <div style={{flex:1,display:'flex',overflow:'hidden',minHeight:0}}>

        {/* LEFT */}
        <div style={{width:175,flexShrink:0,borderRight:'1px solid #1a3050',
          overflowY:'auto',padding:'8px',background:'#050c1a'}}>
          <Label color='#2a4060'>FLEET STATUS</Label>
          {Object.keys(robots).length===0
            ? <div style={{textAlign:'center',padding:'30px 0',color:'#2a3f60',
                fontFamily:'JetBrains Mono,monospace',fontSize:10}}>
                <div style={{fontSize:28,marginBottom:8}}>⟳</div>Awaiting robots…
              </div>
            : Object.entries(robots).map(([rid,r])=>(
                <RobotCard key={rid} rid={rid} r={r}
                  selected={rid===selRobot} onClick={()=>handleSelect(rid)}/>
              ))
          }
        </div>

        {/* CENTER */}
        <div style={{flex:1,display:'flex',flexDirection:'column',
          alignItems:'center',justifyContent:'center',
          background:'#050c1a',overflow:'hidden',position:'relative',minWidth:0}}>
          <div style={{position:'absolute',top:8,left:10,
            fontFamily:'JetBrains Mono,monospace',fontSize:8,
            color:'#1a3050',letterSpacing:2,zIndex:5,pointerEvents:'none'}}>
            WAREHOUSE GRID 30×30
          </div>
          <WarehouseMap snap={snap} selectedRobot={selRobot} onSelect={handleSelect}/>
        </div>

        {/* RIGHT */}
        <div style={{width:262,flexShrink:0,borderLeft:'1px solid #1a3050',
          display:'flex',flexDirection:'column',background:'#050c1a',overflow:'hidden'}}>
          <div style={{display:'flex',borderBottom:'1px solid #1a3050',flexShrink:0}}>
            {[{id:'events',label:'EVENTS'},{id:'logs',label:'LOGS'},{id:'controls',label:'CTRL'}]
              .map(t=>(
                <button key={t.id} onClick={()=>setTab(t.id)} style={{
                  flex:1,padding:'8px 0',background:tab===t.id?'#0a1628':'transparent',
                  border:'none',cursor:'pointer',
                  borderBottom:`2px solid ${tab===t.id?'#00d4ff':'transparent'}`,
                  color:tab===t.id?'#00d4ff':'#4a6080',
                  fontFamily:'JetBrains Mono,monospace',fontSize:9,letterSpacing:2
                }}>{t.label}</button>
              ))}
          </div>
          <div style={{flex:1,overflow:'hidden',display:'flex',flexDirection:'column'}}>
            {tab==='events'&&(
              <div style={{flex:1,overflowY:'auto',padding:'4px 10px'}}>
                {filteredEvts.length===0
                  ? <div style={{color:'#1e3050',fontFamily:'JetBrains Mono,monospace',
                      fontSize:10,padding:'12px 0',textAlign:'center'}}>No events yet…</div>
                  : filteredEvts.map((ev,i)=><EventRow key={i} ev={ev}/>)
                }
              </div>
            )}
            {tab==='logs'&&(
              <div style={{flex:1,overflowY:'auto',padding:'4px 10px'}}>
                {(logs||[]).length===0
                  ? <div style={{color:'#1e3050',fontFamily:'JetBrains Mono,monospace',
                      fontSize:10,padding:'12px 0',textAlign:'center'}}>Waiting for logs…</div>
                  : [...logs].reverse().map((l,i)=><LogRow key={i} entry={l}/>)
                }
              </div>
            )}
            {tab==='controls'&&(
              <Controls snap={snap} onFeedback={handleFeedback}
                crashRobot={crashRobot} drainBattery={drainBattery} recoverRobot={recoverRobot}
                setNetwork={setNetwork} runScenario={runScenario} network={network}/>
            )}
          </div>
        </div>
      </div>

      {/* THROUGHPUT BAR */}
      <div style={{flexShrink:0,borderTop:'1px solid #1a3050',background:'#070e1c',
        padding:'6px 16px',display:'flex',alignItems:'center',gap:12}}>
        <div style={{fontSize:8,color:'#2a4060',fontFamily:'JetBrains Mono,monospace',
          letterSpacing:1,whiteSpace:'nowrap'}}>
          THROUGHPUT&nbsp;
          <span style={{color:'#00ff88'}}>■</span> MET&nbsp;
          <span style={{color:'#ff3366'}}>■</span> MISSED
        </div>
        <div style={{flex:1,height:60}}>
          <ThroughputChart snap={snap}/>
        </div>
      </div>
    </div>
  )
}