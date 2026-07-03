import { memo } from 'react'

export default memo(function Header({ connected, robotCount, ts }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '10px 16px',
      background: '#060b14',
      borderBottom: '1px solid #1a2e50',
      flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          fontFamily: 'Orbitron, monospace',
          fontWeight: 900,
          fontSize: 18,
          color: '#00d4ff',
          letterSpacing: 3,
          textShadow: '0 0 12px #00d4ff88',
        }}>
          WAREX
        </div>
        <div style={{
          fontFamily: 'monospace',
          fontSize: 10,
          color: '#4a6080',
          letterSpacing: 2,
          borderLeft: '1px solid #1a2e50',
          paddingLeft: 12,
        }}>
          WAREHOUSE FLEET COMMAND CENTER
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{
            width: 7, height: 7, borderRadius: '50%',
            background: connected ? '#00ff88' : '#ff3366',
            boxShadow: connected ? '0 0 6px #00ff88' : '0 0 6px #ff3366',
          }} className={connected ? '' : 'blink'} />
          <span style={{
            fontFamily: 'monospace',
            fontSize: 10,
            color: connected ? '#00ff88' : '#ff3366',
          }}>
            {connected ? 'LIVE' : 'OFFLINE'}
          </span>
        </div>
        <div style={{ fontFamily: 'monospace', fontSize: 10, color: '#4a6080' }}>
          {robotCount} ROBOT{robotCount !== 1 ? 'S' : ''}
        </div>
        <div style={{ fontFamily: 'monospace', fontSize: 10, color: '#2a3f60' }}>
          {ts ? new Date(ts * 1000).toLocaleTimeString('en', { hour12: false }) : '--:--:--'}
        </div>
      </div>
    </div>
  )
})