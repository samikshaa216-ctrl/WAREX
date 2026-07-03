import { useState } from 'react'
import { FlaskConical, Play, CheckCircle, AlertTriangle, Clock, Zap } from 'lucide-react'
import { useScenarios } from '../hooks/useScenarios'

const NET_COLORS = {
  GOOD:     'var(--cyber-green)',
  DEGRADED: 'var(--cyber-yellow)',
  POOR:     'var(--cyber-orange)',
  OFFLINE:  'var(--cyber-red)',
}

function ScenarioCard({ scenario, selected, onSelect }) {
  const netColor = NET_COLORS[scenario.network] ?? 'var(--cyber-muted)'
  return (
    <div
      onClick={() => onSelect(scenario.name)}
      className="cyber-card cursor-pointer transition-all"
      style={{
        padding:    12,
        border:     selected ? '1px solid var(--cyber-cyan)' : '1px solid var(--cyber-border)',
        background: selected ? 'rgba(0,212,255,0.05)' : 'var(--cyber-card)',
        boxShadow:  selected ? '0 0 16px rgba(0,212,255,0.15)' : 'none',
        transform:  selected ? 'scale(1.01)' : 'scale(1)',
        transition: 'all 0.2s',
      }}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span style={{ fontFamily: 'Orbitron', fontSize: '0.65rem', fontWeight: 700, color: selected ? 'var(--cyber-cyan)' : 'var(--cyber-text)', letterSpacing: '0.04em' }}>
          {scenario.name}
        </span>
        {selected && (
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--cyber-cyan)', boxShadow: '0 0 6px var(--cyber-cyan)' }} />
        )}
      </div>

      <div style={{ fontFamily: 'Share Tech Mono', fontSize: '0.6rem', color: 'var(--cyber-muted)', marginBottom: 8, lineHeight: 1.5 }}>
        {scenario.description || '—'}
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1">
          <Zap size={9} style={{ color: 'var(--cyber-cyan)' }} />
          <span style={{ fontFamily: 'Share Tech Mono', fontSize: '0.58rem', color: 'var(--cyber-cyan)' }}>
            {scenario.num_robots}R
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Clock size={9} style={{ color: 'var(--cyber-muted)' }} />
          <span style={{ fontFamily: 'Share Tech Mono', fontSize: '0.58rem', color: 'var(--cyber-muted)' }}>
            {scenario.duration_s}s
          </span>
        </div>
        {scenario.network && (
          <span className="badge" style={{
            background: `${netColor}15`,
            color:       netColor,
            border:      `1px solid ${netColor}40`,
            fontSize:    '0.5rem',
          }}>
            {scenario.network}
          </span>
        )}
      </div>
    </div>
  )
}

function ResultPanel({ result }) {
  return (
    <div
      className="cyber-card p-4"
      style={{ border: '1px solid rgba(0,255,136,0.3)', background: 'rgba(0,255,136,0.03)' }}
    >
      <div className="flex items-center gap-2 mb-3">
        <CheckCircle size={14} style={{ color: 'var(--cyber-green)' }} />
        <span style={{ fontFamily: 'Orbitron', fontSize: '0.65rem', color: 'var(--cyber-green)', letterSpacing: '0.08em' }}>
          EXPERIMENT DISPATCHED
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        {[
          { label: 'SCENARIO',   value: result.started },
          { label: 'DURATION',   value: `${result.duration_s}s` },
          { label: 'STATUS',     value: result.message ?? 'Running in background', color: 'var(--cyber-green)' },
        ].map(r => (
          <div key={r.label} className="flex items-center justify-between py-1" style={{ borderBottom: '1px solid rgba(0,255,136,0.1)' }}>
            <span style={{ fontFamily: 'Share Tech Mono', fontSize: '0.6rem', color: 'var(--cyber-muted)', letterSpacing: '0.08em' }}>
              {r.label}
            </span>
            <span style={{ fontFamily: 'Share Tech Mono', fontSize: '0.65rem', color: r.color ?? 'var(--cyber-cyan)' }}>
              {r.value}
            </span>
          </div>
        ))}
      </div>

      <div
        className="mt-3 flex items-center gap-2 px-3 py-2"
        style={{ background: 'rgba(0,212,255,0.05)', border: '1px solid rgba(0,212,255,0.2)', borderRadius: 2 }}
      >
        <span style={{ fontFamily: 'Share Tech Mono', fontSize: '0.6rem', color: 'var(--cyber-muted)' }}>
          Monitor fleet map and KPI bar for live results. Check Analytics panel for MTTR/MTBF after completion.
        </span>
      </div>
    </div>
  )
}

export default function ExperimentLauncher() {
  const { scenarios, running, lastResult, error, launch } = useScenarios()
  const [selected,  setSelected]  = useState(null)
  const [duration,  setDuration]  = useState('')

  const selectedScenario = scenarios.find(s => s.name === selected)

  const handleLaunch = () => {
    if (!selected) return
    launch(selected, duration ? parseFloat(duration) : undefined)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="panel-header">
        <FlaskConical size={12} style={{ color: 'var(--cyber-cyan)' }} />
        <span className="panel-title">Experiment Launcher</span>
        <span style={{ fontFamily: 'Share Tech Mono', fontSize: '0.6rem', color: 'var(--cyber-muted)' }}>
          {scenarios.length} scenarios
        </span>
      </div>

      <div className="flex-1 panel-scroll p-4 flex flex-col gap-4">
        {/* Scenario grid */}
        <div>
          <div style={{ fontFamily: 'Share Tech Mono', fontSize: '0.58rem', color: 'var(--cyber-muted)', letterSpacing: '0.1em', marginBottom: 10 }}>
            SELECT SCENARIO
          </div>
          <div
            style={{
              display:             'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
              gap:                 8,
            }}
          >
            {scenarios.length === 0 ? (
              <div style={{ fontFamily: 'Share Tech Mono', fontSize: '0.65rem', color: 'var(--cyber-muted)', gridColumn: '1/-1', padding: '16px 0' }}>
                Loading scenarios...
              </div>
            ) : (
              scenarios.map(s => (
                <ScenarioCard
                  key={s.name}
                  scenario={s}
                  selected={selected === s.name}
                  onSelect={setSelected}
                />
              ))
            )}
          </div>
        </div>

        {/* Launch config */}
        {selected && selectedScenario && (
          <div className="cyber-card p-4 flex flex-col gap-3">
            <div style={{ fontFamily: 'Share Tech Mono', fontSize: '0.58rem', color: 'var(--cyber-muted)', letterSpacing: '0.1em' }}>
              LAUNCH CONFIGURATION
            </div>

            <div className="flex items-center gap-4">
              <div>
                <div style={{ fontFamily: 'Share Tech Mono', fontSize: '0.58rem', color: 'var(--cyber-muted)', marginBottom: 4 }}>
                  CUSTOM DURATION (s) — leave blank for default
                </div>
                <input
                  type="number"
                  placeholder={`Default: ${selectedScenario.duration_s}s`}
                  value={duration}
                  onChange={e => setDuration(e.target.value)}
                  className="cyber-input"
                  style={{ width: 180, fontSize: '0.65rem' }}
                  min={5}
                  max={600}
                />
              </div>

              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: 'Share Tech Mono', fontSize: '0.58rem', color: 'var(--cyber-muted)', marginBottom: 4 }}>
                  SUMMARY
                </div>
                <div style={{ fontFamily: 'Share Tech Mono', fontSize: '0.62rem', color: 'var(--cyber-text)', lineHeight: 1.7 }}>
                  {selectedScenario.num_robots} robots ·{' '}
                  {duration || selectedScenario.duration_s}s ·{' '}
                  <span style={{ color: NET_COLORS[selectedScenario.network] ?? 'var(--cyber-muted)' }}>
                    {selectedScenario.network ?? 'GOOD'} network
                  </span>
                </div>
              </div>
            </div>

            <button
              onClick={handleLaunch}
              disabled={running}
              className="cyber-btn success"
              style={{
                padding:  '10px 20px',
                fontSize: '0.72rem',
                width:    '100%',
                opacity:  running ? 0.6 : 1,
                cursor:   running ? 'not-allowed' : 'pointer',
              }}
            >
              {running ? (
                <>⟳ RUNNING EXPERIMENT...</>
              ) : (
                <><Play size={11} style={{ display: 'inline', marginRight: 6 }} />LAUNCH — {selected}</>
              )}
            </button>
          </div>
        )}

        {/* Error */}
        {error && (
          <div
            className="flex items-start gap-2 px-3 py-2 rounded-sm"
            style={{ background: 'rgba(255,51,102,0.08)', border: '1px solid rgba(255,51,102,0.35)' }}
          >
            <AlertTriangle size={12} style={{ color: 'var(--cyber-red)', flexShrink: 0 }} />
            <span style={{ fontFamily: 'Share Tech Mono', fontSize: '0.62rem', color: 'var(--cyber-red)' }}>
              {error}
            </span>
          </div>
        )}

        {/* Result */}
        {lastResult && <ResultPanel result={lastResult} />}

        {/* How it works */}
        <div className="cyber-card p-4">
          <div style={{ fontFamily: 'Share Tech Mono', fontSize: '0.58rem', color: 'var(--cyber-muted)', letterSpacing: '0.1em', marginBottom: 10 }}>
            HOW IT WORKS
          </div>
          <div style={{ fontFamily: 'Share Tech Mono', fontSize: '0.62rem', color: 'var(--cyber-muted)', lineHeight: 1.8 }}>
            Experiments drive the live backend via REST API. They configure network conditions, inject crash scenarios, and measure throughput / MTTR / MTBF. Results appear live in the Fleet Map and Analytics panel. Scenarios run in background — navigate freely while the experiment runs.
          </div>
        </div>
      </div>
    </div>
  )
}