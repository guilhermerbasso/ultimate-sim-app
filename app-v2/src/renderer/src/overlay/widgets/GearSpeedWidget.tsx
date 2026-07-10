import { overlayDesignFamily } from '../../../../shared/overlays'
import type { WidgetProps } from './types'
import { formatGear } from './format'
import { AnalogDial, SegmentReadout } from '../../instruments'
import './redesign-core.css'

const MAX_SPEED = 350

function speedHeat(p: number): string {
  if (p < 0.3) return '#ffd166'
  if (p < 0.6) return '#ffb000'
  if (p < 0.85) return '#ff6a00'
  return '#ff3b30'
}

export function GearSpeedWidget({ snapshot, config }: WidgetProps) {
  const family = overlayDesignFamily(config.stylePreset)
  const gear = formatGear(snapshot?.gear)
  const hasSpeed = snapshot?.speedKmh !== undefined && Number.isFinite(snapshot.speedKmh)
  const speed = hasSpeed ? Math.round(snapshot!.speedKmh) : undefined
  const speedStr = hasSpeed ? String(speed) : '—'
  const abs = Boolean(snapshot?.absActive)
  const tc = Boolean(snapshot?.tcActive)
  const drs = Boolean(snapshot?.drs)
  const speedPct = hasSpeed ? Math.min(1, (speed as number) / MAX_SPEED) : 0

  if (family === 'minimal') {
    return (
      <div className="overlay-card rc-card rc-fam-minimal">
        <div className="rc-min" style={{ justifyItems: 'start', alignContent: 'stretch', gridTemplateRows: 'minmax(0, 1fr) auto auto', gap: 'clamp(2px, 1vh, 6px)', padding: 'clamp(6px, 3%, 12px)', minHeight: 0 }}>
          <div className="rc-min-hero">
            <SegmentReadout value={gear} ghost={false} height={46} align="left" idPrefix="gsw-min-gear" />
          </div>
          <div className="rc-min-row" style={{ width: '100%', borderTop: 'none', padding: 'clamp(2px, 0.8vh, 5px) 0' }}>
            <span className="rc-min-label">Speed</span>
            <span className="rc-min-val">
              <SegmentReadout value={speedStr} mode={speedStr === '—' ? undefined : '7'} unit="km/h" ghost={false} height={17} idPrefix="gsw-min-spd" />
            </span>
          </div>
          <div className="rc-min-dots" style={{ flexWrap: 'nowrap', lineHeight: 1 }}>
            <span className={`rc-min-dot${abs ? ' on' : ''}`}>ABS</span>
            <span className={`rc-min-dot${tc ? ' on' : ''}`}>TC</span>
            <span className="rc-min-dot" style={drs ? { color: 'var(--rc-good)' } : undefined}>DRS</span>
          </div>
        </div>
      </div>
    )
  }

  if (family === 'neon') {
    return (
      <div className="overlay-card rc-card rc-fam-neon">
        <div className="rc-neon" style={{ alignContent: 'stretch', gridTemplateRows: 'minmax(0, 1fr) auto auto auto', gap: 'clamp(2px, 1vh, 6px)', padding: 'clamp(6px, 3%, 12px)', minHeight: 0 }}>
          <div className="rc-neon-num">
            <SegmentReadout value={gear} ghost={false} height={50} align="center" color="#fff" idPrefix="gsw-neon-gear" />
          </div>
          <div className="rc-neon-bar" style={{ height: 'clamp(8px, 14%, 16px)' }}><div className="rc-neon-bar-fill" style={{ width: `${speedPct * 100}%` }} /></div>
          <div className="rc-cond" style={{ color: '#fff', fontWeight: 700, fontSize: 'clamp(14px, 4vh, 22px)', lineHeight: 1 }}>
            {speedStr} <span style={{ fontSize: '0.45em', color: 'var(--rc-muted)', letterSpacing: '0.14em' }}>KM/H</span>
          </div>
          <div className="rc-neon-tags" style={{ flexWrap: 'nowrap', gap: 4, lineHeight: 1 }}>
            <span className={`rc-neon-tag${abs ? ' on' : ''}`} style={{ padding: '2px 6px' }}>ABS</span>
            <span className={`rc-neon-tag${tc ? ' on' : ''}`} style={{ padding: '2px 6px' }}>TC</span>
            <span className={`rc-neon-tag${drs ? ' good' : ''}`} style={{ padding: '2px 6px' }}>DRS</span>
          </div>
        </div>
      </div>
    )
  }

  if (family === 'glass') {
    return (
      <div className="overlay-card rc-card rc-fam-glass">
        <div className="rc-glass" style={{ justifyItems: 'center', textAlign: 'center', alignContent: 'stretch', gridTemplateRows: 'minmax(0, 1fr) auto auto auto', gap: 'clamp(3px, 1.2vh, 7px)', padding: 'clamp(8px, 4%, 14px)', minHeight: 0 }}>
          <div className="rc-glass-hero">
            <SegmentReadout value={gear} ghost={false} height={50} align="center" idPrefix="gsw-glass-gear" />
          </div>
          <div className="rc-glass-hero">
            <SegmentReadout value={speedStr} mode={speedStr === '—' ? undefined : '7'} unit="km/h" ghost={false} height={18} align="center" idPrefix="gsw-glass-speed" />
          </div>
          <div className="rc-glass-bar" style={{ height: 'clamp(6px, 12%, 10px)' }}><i style={{ width: `${speedPct * 100}%` }} /></div>
          <div className="rc-neon-tags" style={{ flexWrap: 'nowrap', gap: 4, lineHeight: 1 }}>
            <span className="rc-glass-row" style={{ padding: '2px 7px', opacity: abs ? 1 : 0.5 }}>ABS</span>
            <span className="rc-glass-row" style={{ padding: '2px 7px', opacity: tc ? 1 : 0.5 }}>TC</span>
            <span className="rc-glass-row" style={{ padding: '2px 7px', opacity: drs ? 1 : 0.5, color: drs ? 'var(--rc-good)' : undefined }}>DRS</span>
          </div>
        </div>
      </div>
    )
  }

  if (family === 'broadcast') {
    return (
      <div className="overlay-card rc-card rc-fam-broadcast">
        <div className="rc-bc">
          <div className="rc-bc-cell">
            <div className="rc-bc-tab">Gear</div>
            <div className="rc-bc-field" style={{ justifyContent: 'center' }}>
              <SegmentReadout value={gear} ghost={false} height={34} align="center" idPrefix="gsw-broadcast-gear" />
            </div>
          </div>
          <div className="rc-bc-cell grow2">
            <div className="rc-bc-tab neutral">Speed</div>
            <div className="rc-bc-field">{speedStr}<small>km/h</small></div>
          </div>
          <div className="rc-bc-cell">
            <div className="rc-bc-tab neutral">Assist</div>
            <div className="rc-bc-field" style={{ padding: '3px' }}>
              <div className="rc-bc-chips">
                <span className={`rc-bc-chip${abs ? ' on' : ''}`}>ABS</span>
                <span className={`rc-bc-chip${tc ? ' on' : ''}`}>TC</span>
                <span className={`rc-bc-chip${drs ? ' good' : ''}`}>DRS</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (family === 'terminal') {
    const onOff = (v: boolean) => (v ? 'ON ' : 'OFF')
    return (
      <div className="overlay-card rc-card rc-fam-terminal">
        <pre className="rc-trm">
          {'> GEAR  '}<b>{gear.padStart(3)}</b>{'\n'}
          {'> SPD   '}<b>{speedStr.padStart(3)}</b>{' KM/H\n'}
          {'  ABS['}<span className={abs ? 'warn' : ''}>{onOff(abs)}</span>{'] TC['}<span className={tc ? 'warn' : ''}>{onOff(tc)}</span>{'] DRS['}<span className={drs ? 'ok' : ''}>{onOff(drs)}</span>{']'}
        </pre>
      </div>
    )
  }

  if (family === 'bauhaus') {
    return (
      <div className="overlay-card rc-card rc-fam-bauhaus">
        <div className="rc-bhs" style={{ gridTemplateColumns: '0.85fr 1.15fr', gridTemplateRows: 'minmax(0, 1fr) auto', minHeight: 0 }}>
          <div className="rc-bhs-hero" style={{ gridRow: '1 / span 2' }}>
            <span className="n"><SegmentReadout value={gear} ghost={false} height={50} align="center" idPrefix="gsw-bauhaus-gear" /></span>
          </div>
          <div className="rc-bhs-block" style={{ background: '#fff', color: '#0a0a0a', minHeight: 0, padding: 3 }}>
            <span className="k" style={{ color: 'rgba(10,10,10,0.6)' }}>KM/H</span>
            <span className="v"><SegmentReadout value={speedStr} mode={speedStr === '—' ? undefined : '7'} ghost={false} height={22} align="center" color="#0a0a0a" idPrefix="gsw-bauhaus-speed" /></span>
          </div>
          <div className="rc-bhs-row" style={{ minHeight: 18 }}>
            <div className={`rc-bhs-block${abs ? ' accent' : ''}`} style={{ flex: '1', padding: '2px 4px' }}><span className="v" style={{ fontSize: '11px', textAlign: 'center', lineHeight: 1 }}>ABS</span></div>
            <div className={`rc-bhs-block${tc ? ' accent' : ''}`} style={{ flex: '1', padding: '2px 4px' }}><span className="v" style={{ fontSize: '11px', textAlign: 'center', lineHeight: 1 }}>TC</span></div>
            <div className={`rc-bhs-block${drs ? ' good' : ''}`} style={{ flex: '1', padding: '2px 4px' }}><span className="v" style={{ fontSize: '11px', textAlign: 'center', lineHeight: 1 }}>DRS</span></div>
          </div>
        </div>
      </div>
    )
  }

  if (family === 'analog') {
    return (
      <div className="overlay-card rc-card rc-fam-analog">
        <div className="rc-ang" style={{ gridTemplateRows: 'minmax(0, 1fr) auto', padding: 'clamp(3px, 1.5%, 6px)' }}>
          <div style={{ position: 'relative', width: 82, height: 66 }}>
            <AnalogDial
              value={hasSpeed ? (speed as number) : 0}
              min={0}
              max={MAX_SPEED}
              size={82}
              startAngleDeg={-135}
              endAngleDeg={135}
              showValue={false}
              showTicks={false}
              bezel="none"
              material="matte"
              needleColor={speedHeat(speedPct)}
              idPrefix="gsw-ang-dial"
            />
            <div style={{ position: 'absolute', left: 0, right: 0, top: '38%', display: 'flex', flexDirection: 'column', alignItems: 'center', pointerEvents: 'none' }}>
              <SegmentReadout value={gear} ghost={false} height={22} align="center" idPrefix="gsw-ang-gear" />
              <SegmentReadout value={speedStr} mode={speedStr === '—' ? undefined : '7'} ghost={false} height={11} align="center" idPrefix="gsw-ang-kph" />
            </div>
          </div>
          <div className="rc-neon-tags" style={{ position: 'absolute', bottom: '2px', flexWrap: 'nowrap', gap: 3, lineHeight: 1 }}>
            <span className={`rc-neon-tag${abs ? ' on' : ''}`} style={{ fontSize: '9px', padding: '1px 5px' }}>ABS</span>
            <span className={`rc-neon-tag${tc ? ' on' : ''}`} style={{ fontSize: '9px', padding: '1px 5px' }}>TC</span>
            <span className={`rc-neon-tag${drs ? ' good' : ''}`} style={{ fontSize: '9px', padding: '1px 5px' }}>DRS</span>
          </div>
        </div>
      </div>
    )
  }

  const heat = speedHeat(speedPct)
  const SEGS = 18
  return (
    <div className="overlay-card rc-card rc-fam-heatmap">
      <div className="rc-hm" style={{ gridTemplateColumns: 'auto 1fr', gridTemplateRows: 'minmax(0, 1fr) auto', alignItems: 'center', gap: 'clamp(4px, 2vw, 8px)', padding: 'clamp(6px, 3%, 10px)', minHeight: 0 }}>
        <div style={{ lineHeight: 0.8, gridRow: '1 / span 2' }}>
          <SegmentReadout value={gear} ghost={false} height={46} align="center" color={heat} idPrefix="gsw-heatmap-gear" />
        </div>
        <div className="rc-hm-segs" style={{ height: 'clamp(10px, 20%, 18px)' }}>
          {Array.from({ length: SEGS }, (_, i) => {
            const on = speedPct >= (i + 1) / SEGS
            const c = speedHeat(i / (SEGS - 1))
            return <i key={i} className="rc-hm-seg" style={on ? { background: c } : undefined} />
          })}
        </div>
        <div className="rc-hm-head">
          <span style={{ color: heat }}>{speedStr} km/h</span>
          <div className="rc-bc-chips" style={{ flexWrap: 'nowrap', gap: 3, lineHeight: 1 }}>
            <span className={`rc-bc-chip${abs ? ' on' : ''}`} style={{ padding: '2px 5px' }}>ABS</span>
            <span className={`rc-bc-chip${tc ? ' on' : ''}`} style={{ padding: '2px 5px' }}>TC</span>
            <span className={`rc-bc-chip${drs ? ' good' : ''}`} style={{ padding: '2px 5px' }}>DRS</span>
          </div>
        </div>
      </div>
    </div>
  )
}
