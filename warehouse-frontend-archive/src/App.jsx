import { useState, useCallback, useEffect, useRef } from 'react'
import useWarehouse from './useWarehouse.js'
import WarehouseMap from './WarehouseMap.jsx'
import { api } from './api.js'
import {
  AreaChart, Area, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer
} from 'recharts'

// ── Colour helpers ────────────────────────────────────────────────────────────
const PALETTE = ['#00d4ff','#00ff88','#ffd700','#ff7a00','#9b59ff',
                 '#ff3366','#4fc3f7','#80cbc4','#ffb74d','#ce93d8']
const rColor  = id => PALETTE[((parseInt((id||'').replace(/\D/g,''),10)||1)-1+PALETTE.length)%PALETTE.length]
const batColor= p  => p>50?'#00ff88':p>25?'#ffd700':'#ff3366'
const statCol = s  => ({ACTIVE:'#00d4ff',IDLE:'#00ff88',CRASHED:'#ff3366',
                         CHARGING:'#ffd700',RECHARGING:'#ffd700'}[s]||'#4a6080')

// ── Tiny UI primitives ────────────────────────────────────────────────────────
const Label = ({children,color='#4a6080'}) => (
  <div style={{fontSize:9,fontFamily:'JetBrains Mono,monospace',
    letterSpacing:1.5,color,marginBottom:3,textTransform:'uppercase'}}>{children}</div>
)

const Value = ({children,color='#c8d8f0',size=20,font='Orbitron,monospace'}) => (
  <div style={{fontSize:size,fontWeight:700,fontFamily:font,color,lineHeight:1}}>{children}</div>
)

function KCard({label,value,color='#00d4ff',sub,blink=false}) {
  return (
    <div style={{background:'#0a1628',border:`1px solid ${color}22`,borderRadius:8,
      padding:'10px 14px',flex:'1 1 80px',minWidth:80}}>
      <Label color='#4a6080'>{label}</Label>
      <Value color={color} size={22} className={blink?'blink':''}>{value??'—'}</Value>
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
    <div onClick={onClick} className='fade-up' style={{
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
          {lowBat&&<span className='blink' style={{color:'#ff3366',marginLeft:3}}>⚠</span>}
        </span>
      </div>
      <BatBar pct={r.battery??100}/>
      {crashed&&(
        <div style={{marginTop:6,fontSize:9,color:'#ff3366',fontFamily:'JetBrains Mono,monospace',
          textAlign:'center',letterSpacing:1}} className='blink'>
          ✕ FAULT
        </div>
      )}
    </div>
  )
}

// ── Event types ───────────────────────────────────────────────────────────────
const EVT = {
  CRASH:           {icon:'💥',col:'#ff3366'},
  RECOVERY:        {icon:'🔧',col:'#00ff88'},
  TASK_ASSIGNED:   {icon:'📋',col:'#00d4ff'},
  TASK_COMPLETED:  {icon:'✅',col:'#00ff88'},
  ROBOT_REGISTERED:{icon:'🤖',col:'#9b59ff'},
  LOW_BATTERY:     {icon:'🔋',col:'#ffd700'},
  REROUTE:         {icon:'🔀',col:'#ff7a00'},
  MISSED_DEADLINE: {icon:'⏰',col:'#ff3366'},
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
  const isE  = /ERROR|CRASH|DEPLET/i.test(msg)
  const isW  = /WARN|LOW.BAT|MISS|REROUTE|DRAIN/i.test(msg)
  const isOk = /RECOV|COMPLET|ASSIGN|RECHARG|REGISTER/i.test(msg)
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

// ── Throughput history chart ──────────────────────────────────────────────────
function ThroughputChart({snap}) {
  const hist = useRef([])
  useEffect(() => {
    if (!snap?.stats) return
    const s = snap.stats
    hist.current = [...hist.current.slice(-29), {
      t: new Date().toLocaleTimeString('en',{hour12:false}),
      met: s.met||0, missed: s.missed||0, rate: s.rate||0
    }]
  }, [snap?.stats?.met, snap?.stats?.missed])

  return (
    <ResponsiveContainer width='100%' height={90}>
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
        <Tooltip contentStyle={{background:'#0a1628',border:'1px solid #1a3050',
          fontSize:10,borderRadius:4}} labelStyle={{color:'#4a6080'}}/>
        <Area type='monotone' dataKey='met'    stroke='#00ff88' fill='url(#gMet)'  strokeWidth={1.5}/>
        <Area type='monotone' dataKey='missed' stroke='#ff3366' fill='url(#gMiss)' strokeWidth={1.5}/>
      </AreaChart>
    </ResponsiveContainer>
  )
}

// ── Controls panel ────────────────────────────────────────────────────────────
function Controls({snap,onFeedback}) {
  const [robots,     setRobots]     = useState([])
  const [selRobot,   setSelRobot]   = useState('')
  const [crashMode,  setCrashMode]  = useState('none')
  const [netCond,    setNetCond]    = useState('')
  const [scenarios,  setScenarios]  = useState([])
  const [scenario,   setScenario]   = useState('')
  const [busy,       setBusy]       = useState({})

  useEffect(()=>{ setRobots(Object.keys(snap?.robots||{})) },[snap])
  useEffect(()=>{ api.scenarios().then(r=>setScenarios(r.scenarios||[])).catch(()=>{}) },[])

  const run = (k,fn) => {
    setBusy(b=>({...b,[k]:true}))
    Promise.resolve(fn()).catch(e=>onFeedback(`Error: ${e}`))
      .finally(()=>setBusy(b=>({...b,[k]:false})))
  }

  const selStyle = {
    width:'100%',background:'#090f1e',border:'1px solid #1a3050',color:'#c8d8f0',
    padding:'6px 8px',borderRadius:4,fontFamily:'JetBrains Mono,monospace',fontSize:10,
    cursor:'pointer',marginBottom:7
  }
  const btnStyle = (col,dis) => ({
    width:'100%',background:'transparent',border:`1px solid ${dis?'#1a3050':col}`,
    color:dis?'#2a3f60':col,padding:'7px 12px',borderRadius:4,cursor:dis?'not-allowed':'pointer',
    fontFamily:'JetBrains Mono,monospace',fontSize:10,letterSpacing:1,
    marginBottom:6,transition:'background 0.15s'
  })

  const NET = ['GOOD','DEGRADED','POOR','OFFLINE'].map(v=>({v,l:{GOOD:'🟢 GOOD',DEGRADED:'🟡 DEGRADED',POOR:'🟠 POOR',OFFLINE:'🔴 OFFLINE'}[v]}))

  const sectionLabel = {
    fontSize:9,color:'#2a4060',fontFamily:'JetBrains Mono,monospace',
    letterSpacing:2,marginBottom:10,borderBottom:'1px solid #1a3050',paddingBottom:5
  }

  return (
    <div style={{padding:'10px 12px',overflowY:'auto',height:'100%'}}>

      {/* ── ROBOT section ── */}
      <div style={sectionLabel}>── ROBOT ──</div>
      <select style={selStyle} value={selRobot} onChange={e=>setSelRobot(e.target.value)}>
        <option value=''>Select robot…</option>
        {robots.map(id=><option key={id} value={id}>{id.replace('robot_','Robot ')}</option>)}
      </select>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:5,marginBottom:10}}>
        <button disabled={!selRobot||busy.crash} style={btnStyle('#ff3366',!selRobot||busy.crash)}
          onClick={()=>run('crash',async()=>{await api.crashRobot(selRobot);onFeedback(`💥 Crashed ${selRobot}`)})}>
          {busy.crash?'…':'💥 CRASH'}
        </button>
        <button disabled={!selRobot||busy.bat} style={btnStyle('#ffd700',!selRobot||busy.bat)}
          onClick={()=>run('bat',async()=>{await api.drainBattery(selRobot);onFeedback(`🔋 Drained ${selRobot}`)})}>
          {busy.bat?'…':'🔋 DRAIN'}
        </button>
      </div>

      {/* ── CRASH MODE section (NEW) ── */}
      <div style={sectionLabel}>── CRASH MODE ──</div>
      <select style={selStyle} value={crashMode}
        onChange={e=>{
          setCrashMode(e.target.value)
          run('cm',async()=>{
            await api.setCrashMode(e.target.value)
            onFeedback(`⚙️ Crash mode → ${e.target.value}`)
          })
        }}>
        <option value='none'>🟢 none — no faults</option>
        <option value='deterministic'>🔴 deterministic — crash at 50%</option>
        <option value='random'>🟡 random — 4% chance/task</option>
      </select>

      {/* ── NETWORK section ── */}
      <div style={sectionLabel}>── NETWORK ──</div>
      <select style={selStyle} value={netCond} onChange={e=>setNetCond(e.target.value)}>
        <option value=''>Select condition…</option>
        {NET.map(({v,l})=><option key={v} value={v}>{l}</option>)}
      </select>
      <button disabled={!netCond||busy.net} style={btnStyle('#9b59ff',!netCond||busy.net)}
        onClick={()=>run('net',async()=>{await api.setNetwork(netCond);onFeedback(`📡 Network → ${netCond}`)})}>
        {busy.net?'…':'APPLY'}
      </button>

      {/* ── EXPERIMENT section ── */}
      <div style={{...sectionLabel,margin:'12px 0 10px'}}>── EXPERIMENT ──</div>
      <select style={selStyle} value={scenario} onChange={e=>setScenario(e.target.value)}>
        <option value=''>Select scenario…</option>
        {scenarios.map(s=>(
          <option key={s.name} value={s.name}>
            {s.description || s.name}
          </option>
        ))}
      </select>
      <button disabled={!scenario||busy.exp} style={btnStyle('#00ff88',!scenario||busy.exp)}
        onClick={()=>run('exp',async()=>{await api.runExperiment(scenario);onFeedback(`▶ Started: ${scenario}`)})}>
        {busy.exp?'…':'▶ LAUNCH'}
      </button>

      {/* ── LEGEND ── */}
      <div style={{marginTop:12,borderTop:'1px solid #1a3050',paddingTop:12}}>
        <div style={{...sectionLabel,marginBottom:8}}>── LEGEND ──</div>
        {[['#ffd700','⚡ Charging Dock'],['#00ff88','📦 Drop Zone'],
          ['#162540','▪ Shelf/Obstacle'],['#00d4ff','━ Task Route'],
          ['#c8d8f0','● Robot (click)']].map(([c,l])=>(
          <div key={l} style={{display:'flex',alignItems:'center',gap:6,marginBottom:4}}>
            <div style={{width:9,height:9,background:c,borderRadius:2,flexShrink:0,opacity:.85}}/>
            <span style={{fontSize:9,color:'#3a5070',fontFamily:'JetBrains Mono,monospace'}}>{l}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const { snap, events, logs, metrics, faults, connected } = useWarehouse()
  const [selRobot, setSelRobot]   = useState(null)
  const [tab, setTab]             = useState('events')
  const [feedback, setFeedback]   = useState('')
  const fbTimer = useRef(null)

  const handleFeedback = useCallback(msg => {
    setFeedback(msg)
    clearTimeout(fbTimer.current)
    fbTimer.current = setTimeout(()=>setFeedback(''), 3000)
  }, [])

  const handleSelect = useCallback(id => setSelRobot(p => p===id?null:id), [])

  const st     = snap?.stats    ?? {}
  const robots = snap?.robots   ?? {}
  const active = snap?.active_robots  ?? 0
  const crashed= snap?.crashed_robots ?? 0
  const idle   = snap?.idle_robots    ?? 0
  const rCount = Object.keys(robots).length
  const rate   = (st.rate??0).toFixed(1)

  const filteredEvts = (events||[]).filter(e=>e.event_type!=='ROBOT_UPDATED').slice(-30).reverse()

  return (
    <div className='scanline' style={{
      display:'flex',flexDirection:'column',height:'100vh',
      overflow:'hidden',background:'#050c1a'
    }}>

      {/* ── TOP BAR ─────────────────────────────────────────────────────── */}
      <div style={{
        display:'flex',alignItems:'center',justifyContent:'space-between',
        padding:'8px 16px',background:'#070e1c',
        borderBottom:'1px solid #1a3050',flexShrink:0,zIndex:10
      }}>
        <div style={{display:'flex',alignItems:'center',gap:14}}>
          <span style={{fontFamily:'Orbitron,monospace',fontWeight:900,fontSize:20,
            color:'#00d4ff',letterSpacing:4,textShadow:'0 0 14px #00d4ff88'}}
            className='glow-txt'>WAREX</span>
          <span style={{fontFamily:'JetBrains Mono,monospace',fontSize:9,color:'#2a4060',
            letterSpacing:2,borderLeft:'1px solid #1a3050',paddingLeft:12}}>
            WAREHOUSE FLEET COMMAND CENTER
          </span>
          {/* Scenario badge */}
          {snap?.scenario && (
            <span style={{fontFamily:'JetBrains Mono,monospace',fontSize:8,
              color:'#00d4ff',background:'#00d4ff11',padding:'2px 8px',
              borderRadius:3,border:'1px solid #00d4ff22',letterSpacing:1}}>
              {snap.scenario.toUpperCase()}
            </span>
          )}
        </div>
        <div style={{display:'flex',alignItems:'center',gap:18}}>
          {feedback&&(
            <span style={{fontFamily:'JetBrains Mono,monospace',fontSize:10,
              color:'#00d4ff',background:'#00d4ff11',padding:'3px 10px',borderRadius:4,
              border:'1px solid #00d4ff22'}} className='fade-up'>
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
            <div style={{width:7,height:7,borderRadius:'50%',flexShrink:0,
              background:connected?'#00ff88':'#ff3366',
              boxShadow:connected?'0 0 7px #00ff88':'0 0 7px #ff3366'}}
              className={connected?'':'blink'}/>
            <span style={{fontFamily:'JetBrains Mono,monospace',fontSize:10,
              color:connected?'#00ff88':'#ff3366'}}>
              {connected?'LIVE':'OFFLINE'}
            </span>
          </div>
        </div>
      </div>

      {/* ── KPI STRIP ───────────────────────────────────────────────────── */}
      <div style={{
        display:'flex',gap:8,padding:'8px 12px',
        background:'#050c1a',borderBottom:'1px solid #1a3050',flexShrink:0,flexWrap:'wrap'
      }}>
        <KCard label='Total Tasks' value={st.total??0}     color='#00d4ff'/>
        <KCard label='Deadlines Met'  value={st.met??0}    color='#00ff88'/>
        <KCard label='Missed'  value={st.missed??0} color='#ff3366' blink={(st.missed??0)>0}/>
        <KCard label='Success %' value={`${rate}%`}
          color={parseFloat(rate)>=70?'#00ff88':'#ff7a00'}/>
        <div style={{width:1,background:'#1a3050',margin:'0 2px'}}/>
        <KCard label='Active'   value={active}  color='#00d4ff'/>
        <KCard label='Idle'     value={idle}    color='#00ff88'/>
        <KCard label='Crashed'  value={crashed} color='#ff3366' blink={crashed>0}/>
        <div style={{width:1,background:'#1a3050',margin:'0 2px'}}/>
        <KCard label='MTTR (s)'
          value={metrics?.fleet_mttr_s!=null ? metrics.fleet_mttr_s.toFixed(1) : '—'}
          color='#9b59ff' sub='mean time to recover'/>
        <KCard label='MTBF (s)'
          value={metrics?.fleet_mtbf_s!=null&&metrics.fleet_mtbf_s<99999
            ? metrics.fleet_mtbf_s.toFixed(0) : '∞'}
          color='#ff7a00' sub='mean time between fail'/>
      </div>

      {/* ── MAIN LAYOUT ─────────────────────────────────────────────────── */}
      <div style={{flex:1,display:'flex',overflow:'hidden',minHeight:0}}>

        {/* LEFT — robot cards */}
        <div style={{
          width:175,flexShrink:0,borderRight:'1px solid #1a3050',
          overflowY:'auto',padding:'8px 8px',background:'#050c1a'
        }}>
          <Label color='#2a4060'>FLEET STATUS</Label>
          {Object.keys(robots).length===0?(
            <div style={{textAlign:'center',padding:'30px 0',color:'#2a3f60',
              fontFamily:'JetBrains Mono,monospace',fontSize:10}}>
              <div style={{fontSize:28,marginBottom:8}} className='blink'>⟳</div>
              Awaiting robots…
            </div>
          ):Object.entries(robots).map(([rid,r])=>(
            <RobotCard key={rid} rid={rid} r={r}
              selected={rid===selRobot}
              onClick={()=>handleSelect(rid)}/>
          ))}
        </div>

        {/* CENTER — warehouse map */}
        <div style={{
          flex:1,display:'flex',flexDirection:'column',
          alignItems:'center',justifyContent:'center',
          background:'#050c1a',overflow:'hidden',position:'relative',minWidth:0
        }}>
          <div style={{
            position:'absolute',top:8,left:10,
            fontFamily:'JetBrains Mono,monospace',fontSize:8,
            color:'#1a3050',letterSpacing:2,zIndex:5,pointerEvents:'none'
          }}>WAREHOUSE GRID 30×30</div>

          {!connected&&(
            <div style={{position:'absolute',zIndex:10,textAlign:'center',
              color:'#4a6080',fontFamily:'JetBrains Mono,monospace',fontSize:11,
              pointerEvents:'none'}}>
              <div style={{fontSize:36,marginBottom:10}} className='blink'>⟳</div>
              <div>Connecting to backend…</div>
              <div style={{fontSize:9,marginTop:5,color:'#2a3f60'}}>ws://localhost:8080/ws</div>
            </div>
          )}

          <WarehouseMap snap={snap} selectedRobot={selRobot} onSelect={handleSelect}/>

          {/* throughput mini-chart */}
          <div style={{
            position:'absolute',bottom:8,left:8,right:8,
            background:'#070e1c99',border:'1px solid #1a3050',
            borderRadius:6,padding:'6px 10px',pointerEvents:'none'
          }}>
            <div style={{fontSize:8,color:'#2a4060',fontFamily:'JetBrains Mono,monospace',
              letterSpacing:1,marginBottom:4}}>
              THROUGHPUT — <span style={{color:'#00ff88'}}>■</span> MET &nbsp;
              <span style={{color:'#ff3366'}}>■</span> MISSED
            </div>
            <ThroughputChart snap={snap}/>
          </div>
        </div>

        {/* RIGHT — tabs */}
        <div style={{
          width:262,flexShrink:0,borderLeft:'1px solid #1a3050',
          display:'flex',flexDirection:'column',background:'#050c1a',overflow:'hidden'
        }}>
          {/* tab bar */}
          <div style={{display:'flex',borderBottom:'1px solid #1a3050',flexShrink:0}}>
            {[
              {id:'events',   label:'EVENTS'},
              {id:'logs',     label:'LOGS'},
              {id:'controls', label:'CTRL'},
            ].map(t=>(
              <button key={t.id} onClick={()=>setTab(t.id)} style={{
                flex:1,padding:'8px 0',background:tab===t.id?'#0a1628':'transparent',
                border:'none',cursor:'pointer',transition:'all 0.15s',
                borderBottom:`2px solid ${tab===t.id?'#00d4ff':'transparent'}`,
                color:tab===t.id?'#00d4ff':'#4a6080',
                fontFamily:'JetBrains Mono,monospace',fontSize:9,letterSpacing:2
              }}>{t.label}</button>
            ))}
          </div>

          {/* tab content */}
          <div style={{flex:1,overflow:'hidden',display:'flex',flexDirection:'column'}}>

            {tab==='events'&&(
              <>
                <div style={{flex:1,overflowY:'auto',padding:'4px 10px'}}>
                  {filteredEvts.length===0
                    ? <div style={{color:'#1e3050',fontFamily:'JetBrains Mono,monospace',
                        fontSize:10,padding:'12px 0',textAlign:'center'}}>No events yet…</div>
                    : filteredEvts.map((ev,i)=><EventRow key={i} ev={ev}/>)
                  }
                </div>
                <div style={{borderTop:'1px solid #1a3050',padding:'6px 10px',
                  background:'#070e1c',flexShrink:0}}>
                  <div style={{fontSize:8,color:'#2a4060',fontFamily:'JetBrains Mono,monospace',
                    letterSpacing:1,marginBottom:5}}>THROUGHPUT TREND</div>
                </div>
              </>
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
              <Controls snap={snap} onFeedback={handleFeedback}/>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}