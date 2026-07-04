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
        <div className="rc-min" style={{ justifyItems: 'start' }}>
          <div className="rc-min-hero">
            <SegmentReadout value={gear} ghost={false} height={56} align="left" idPrefix="gsw-min-gear" />
          </div>
          <div className="rc-min-row" style={{ width: '100%', borderTop: 'none' }}>
            <span className="rc-min-label">Velocidade</span>
            <span className="rc-min-val">
              <SegmentReadout value={speedStr} mode={speedStr === '—' ? undefined : '7'} unit="km/h" ghost={false} height={20} idPrefix="gsw-min-spd" />
            </span>
          </div>
          <div className="rc-min-dots">
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
        <div className="rc-neon">
          <div className="rc-neon-num">
            <SegmentReadout value={gear} ghost={false} height={62} align="center" color="#fff" idPrefix="gsw-neon-gear" />
          </div>
          <div className="rc-neon-bar"><div className="rc-neon-bar-fill" style={{ width: `${speedPct * 100}%` }} /></div>
          <div className="rc-cond" style={{ color: '#fff', fontWeight: 700, fontSize: 'clamp(16px, 5vh, 26px)' }}>
            {speedStr} <span style={{ fontSize: '0.45em', color: 'var(--rc-muted)', letterSpacing: '0.14em' }}>KM/H</span>
          </div>
          <div className="rc-neon-tags">
            <span className={`rc-neon-tag${abs ? ' on' : ''}`}>ABS</span>
            <span className={`rc-neon-tag${tc ? ' on' : ''}`}>TC</span>
            <span className={`rc-neon-tag${drs ? ' good' : ''}`}>DRS</span>
          </div>
        </div>
      </div>
    )
  }

  if (family === 'glass') {
    return (
      <div className="overlay-card rc-card rc-fam-glass">
        <div className="rc-glass" style={{ justifyItems: 'center', textAlign: 'center' }}>
          <div className="rc-glass-hero">
            <SegmentReadout value={gear} ghost={false} height={64} align="center" idPrefix="gsw-glass-gear" />
          </div>
          <div className="rc-glass-hero">
            <SegmentReadout value={speedStr} mode={speedStr === '—' ? undefined : '7'} unit="km/h" ghost={false} height={24} align="center" idPrefix="gsw-glass-speed" />
          </div>
          <div className="rc-glass-bar"><i style={{ width: `${speedPct * 100}%` }} /></div>
          <div className="rc-neon-tags">
            <span className="rc-glass-row" style={{ padding: '3px 9px', opacity: abs ? 1 : 0.5 }}>ABS</span>
            <span className="rc-glass-row" style={{ padding: '3px 9px', opacity: tc ? 1 : 0.5 }}>TC</span>
            <span className="rc-glass-row" style={{ padding: '3px 9px', opacity: drs ? 1 : 0.5, color: drs ? 'var(--rc-good)' : undefined }}>DRS</span>
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
        <div className="rc-bhs" style={{ gridTemplateColumns: '1fr 1.1fr', gridTemplateRows: '1fr auto' }}>
          <div className="rc-bhs-hero" style={{ gridRow: '1 / span 2' }}>
            <span className="n"><SegmentReadout value={gear} ghost={false} height={60} align="center" idPrefix="gsw-bauhaus-gear" /></span>
          </div>
          <div className="rc-bhs-block" style={{ background: '#fff', color: '#0a0a0a' }}>
            <span className="k" style={{ color: 'rgba(10,10,10,0.6)' }}>KM/H</span>
            <span className="v"><SegmentReadout value={speedStr} mode={speedStr === '—' ? undefined : '7'} ghost={false} height={26} align="center" color="#0a0a0a" idPrefix="gsw-bauhaus-speed" /></span>
          </div>
          <div className="rc-bhs-row">
            <div className={`rc-bhs-block${abs ? ' accent' : ''}`} style={{ flex: '1', padding: '4px' }}><span className="v" style={{ fontSize: '12px', textAlign: 'center' }}>ABS</span></div>
            <div className={`rc-bhs-block${tc ? ' accent' : ''}`} style={{ flex: '1', padding: '4px' }}><span className="v" style={{ fontSize: '12px', textAlign: 'center' }}>TC</span></div>
            <div className={`rc-bhs-block${drs ? ' good' : ''}`} style={{ flex: '1', padding: '4px' }}><span className="v" style={{ fontSize: '12px', textAlign: 'center' }}>DRS</span></div>
          </div>
        </div>
      </div>
    )
  }

  if (family === 'analog') {
    return (
      <div className="overlay-card rc-card rc-fam-analog">
        <div className="rc-ang">
          <div style={{ position: 'relative', width: 90, height: 72 }}>
            <AnalogDial
              value={hasSpeed ? (speed as number) : 0}
              min={0}
              max={MAX_SPEED}
              size={90}
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
          <div className="rc-neon-tags" style={{ position: 'absolute', bottom: '6px' }}>
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
      <div className="rc-hm" style={{ gridTemplateColumns: 'auto 1fr', alignItems: 'center', gap: '10px' }}>
        <div style={{ lineHeight: 0.8, gridRow: '1 / span 2' }}>
          <SegmentReadout value={gear} ghost={false} height={52} align="center" color={heat} idPrefix="gsw-heatmap-gear" />
        </div>
        <div className="rc-hm-segs" style={{ height: 'clamp(14px, 26%, 24px)' }}>
          {Array.from({ length: SEGS }, (_, i) => {
            const on = speedPct >= (i + 1) / SEGS
            const c = speedHeat(i / (SEGS - 1))
            return <i key={i} className="rc-hm-seg" style={on ? { background: c } : undefined} />
          })}
        </div>
        <div className="rc-hm-head">
          <span style={{ color: heat }}>{speedStr} km/h</span>
          <div className="rc-bc-chips">
            <span className={`rc-bc-chip${abs ? ' on' : ''}`}>ABS</span>
            <span className={`rc-bc-chip${tc ? ' on' : ''}`}>TC</span>
            <span className={`rc-bc-chip${drs ? ' good' : ''}`}>DRS</span>
          </div>
        </div>
      </div>
    </div>
  )
}
