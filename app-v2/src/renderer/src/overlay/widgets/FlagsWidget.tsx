import type { ReactElement } from 'react'
import { overlayDesignFamily } from '../../../../shared/overlays'
import type { Flags } from '../../../../shared/telemetry'
import type { WidgetProps } from './types'
import { MotorsportGlyph, type MotorsportIconId } from '../../icons/motorsport'
import { TelltaleIcon } from '../../instruments'
import { DASH } from './dashboard-tiles'
import './redesign-core.css'

const FLAG_LABELS: Array<[keyof Flags, string]> = [
  ['green', 'GREEN'],
  ['yellow', 'YELLOW'],
  ['blue', 'BLUE'],
  ['white', 'WHITE'],
  ['checkered', 'CHECKERED'],
  ['red', 'RED'],
  ['black', 'BLACK'],
  ['meatball', 'DAMAGE']
]

export interface FlagInfo {
  color: string
  ink: string
  danger: number // 0 calm → 1 critical
  glyph: MotorsportIconId
}

// ── Unified flag palette — single source of truth, shared with SymbolStatusWidget.
// The flag itself is the data; green/clear is the only genuinely "go/good" state,
// warm hues escalate to danger. Colours align to the GT3 theme tokens (DASH) and
// each flag maps to a glyph in the shared motorsport icon registry.
export const FLAG_PALETTE: Record<string, FlagInfo> = {
  green: { color: DASH.green, ink: '#042016', danger: 0, glyph: 'flag-green' },
  clear: { color: DASH.green, ink: '#042016', danger: 0, glyph: 'flag-green' },
  white: { color: '#E8EEF6', ink: '#10151d', danger: 0.2, glyph: 'flag-white' },
  checkered: { color: '#E8EEF6', ink: '#10151d', danger: 0.15, glyph: 'flag-checkered' },
  blue: { color: DASH.blue, ink: '#FFFFFF', danger: 0.35, glyph: 'flag-blue' },
  yellow: { color: DASH.amber, ink: '#1a1202', danger: 0.55, glyph: 'flag-yellow' },
  pit: { color: DASH.amber, ink: '#1a1202', danger: 0.5, glyph: 'pit-limiter' },
  meatball: { color: DASH.orange, ink: '#160800', danger: 0.72, glyph: 'flag-meatball' },
  red: { color: DASH.red, ink: '#FFFFFF', danger: 0.9, glyph: 'flag-red' },
  black: { color: '#222831', ink: '#ff6a6a', danger: 0.95, glyph: 'flag-black' }
}

const FLAG_FALLBACK: FlagInfo = { color: '#8aa4c8', ink: '#0a0e15', danger: 0.1, glyph: 'flag-white' }

export function flagInfo(key: string): FlagInfo {
  return FLAG_PALETTE[key] ?? FLAG_FALLBACK
}

/** Glow only on caution/alert flags (yellow and worse) — never clear/green/white. */
export function flagHasGlow(info: FlagInfo): boolean {
  return info.danger >= 0.5
}

/** Shared tell-tale lamp: the FIA flag glyph from the motorsport registry, lit in
 *  the flag's colour, glowing only when it is a caution/alert flag. Replaces the
 *  old hand-rolled marshal-beacon <svg> and the text-only flag labels. */
function TellTaleLamp({ info, size = 40, color }: { info: FlagInfo; size?: number; color?: string }): ReactElement {
  const glow = flagHasGlow(info)
  return (
    <span
      className="rc-flag-lamp"
      aria-hidden="true"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: 'none',
        color: color ?? info.color,
        filter: glow ? `drop-shadow(0 0 8px ${info.color})` : undefined
      }}
    >
      <TelltaleIcon
        icon={info.glyph}
        active
        size={size}
        activeColor={color ?? info.color}
        glow={glow}
        label={info.glyph}
        idPrefix={`flag-${info.glyph}`}
      />
      <span aria-hidden="true" style={{ display: 'none' }}>
        <MotorsportGlyph id={info.glyph} style={{ width: size, height: size }} />
      </span>
    </span>
  )
}

export function FlagsWidget({ snapshot, config }: WidgetProps) {
  const family = overlayDesignFamily(config.stylePreset)
  const active = FLAG_LABELS.filter(([key]) => snapshot?.flags?.[key])
  const label = active[0]?.[1] ?? (snapshot?.pitLimiter ? 'PIT LIMITER' : 'CLEAR')
  const key = String(active[0]?.[0] ?? (snapshot?.pitLimiter ? 'pit' : 'clear'))
  const info = flagInfo(key)
  const session = snapshot?.onPitRoad ? 'Pit road' : snapshot?.sessionType ?? 'Sessão'
  const sessionUp = session.toUpperCase()

  // ── minimal ──
  if (family === 'minimal') {
    return (
      <div className="overlay-card rc-card rc-fam-minimal">
        <div className="rc-min" style={{ alignContent: 'center', justifyItems: 'center', gap: '8px' }}>
          <TellTaleLamp info={info} size={48} />
          <div className="rc-min-hero" style={{ color: info.color, fontWeight: 500, fontSize: 'clamp(24px, 16vh, 46px)' }}>{label}</div>
          <div className="rc-min-row" style={{ borderTop: 'none', paddingTop: 0 }}>
            <span className="rc-min-label">{sessionUp}</span>
          </div>
        </div>
      </div>
    )
  }

  // ── neon ──
  if (family === 'neon') {
    return (
      <div className="overlay-card rc-card rc-fam-neon">
        <div className="rc-neon">
          <TellTaleLamp info={info} size={52} />
          <div className="rc-neon-num" style={{ color: '#fff', fontSize: 'clamp(26px, 20vh, 54px)', textShadow: flagHasGlow(info) ? `0 0 12px ${info.color}, 0 0 30px ${info.color}` : undefined }}>{label}</div>
          <div className="rc-neon-tags"><span className="rc-neon-tag on" style={{ borderColor: info.color, color: info.color }}>{sessionUp}</span></div>
        </div>
      </div>
    )
  }

  // ── glass ──
  if (family === 'glass') {
    return (
      <div className="overlay-card rc-card rc-fam-glass">
        <div className="rc-glass" style={{ alignContent: 'center', justifyItems: 'start', gap: '8px' }}>
          <TellTaleLamp info={info} size={44} />
          <div className="rc-glass-hero" style={{ color: info.color, fontWeight: 500 }}>{label}</div>
          <div className="rc-glass-label">{sessionUp}</div>
        </div>
      </div>
    )
  }

  // ── broadcast — TV flag bug ──
  if (family === 'broadcast') {
    return (
      <div className="overlay-card rc-card rc-fam-broadcast" style={{ borderBottomColor: info.color }}>
        <div className="rc-bc">
          <div className="rc-bc-cell grow2">
            <div className="rc-bc-tab" style={{ background: info.color, color: info.ink }}>Flag</div>
            <div className="rc-bc-field" style={{ color: info.color, fontWeight: 800, display: 'flex', alignItems: 'center', gap: '8px' }}><TellTaleLamp info={info} size={28} />{label}</div>
          </div>
          <div className="rc-bc-cell">
            <div className="rc-bc-tab neutral">Session</div>
            <div className="rc-bc-field" style={{ fontSize: 'clamp(12px, 4vh, 18px)' }}>{sessionUp}</div>
          </div>
        </div>
      </div>
    )
  }

  // ── terminal ──
  if (family === 'terminal') {
    const tag = key === 'clear' || key === 'green' ? '[ OK ]' : key === 'yellow' || key === 'pit' ? '[WARN]' : '[!!!!]'
    const cls = key === 'clear' || key === 'green' ? 'ok' : key === 'yellow' || key === 'pit' ? 'warn' : 'bad'
    return (
      <div className="overlay-card rc-card rc-fam-terminal">
        <pre className="rc-trm">
          <span className={cls}>{tag} {label}</span>{'\n'}
          {`>>> ${sessionUp} <<<`}
        </pre>
      </div>
    )
  }

  // ── bauhaus — giant flag word on a saturated block ──
  if (family === 'bauhaus') {
    const blackFlag = key === 'black'
    return (
      <div className="overlay-card rc-card rc-fam-bauhaus">
        <div className="rc-bhs" style={{ gridTemplateRows: '1fr auto' }}>
          <div className="rc-bhs-hero" style={{ background: info.color, color: info.ink, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
            <TellTaleLamp info={info} size={40} color={info.ink} />
            <span className="n" style={{ fontSize: 'clamp(24px, 16vh, 56px)', fontFamily: 'var(--rc-cond)', fontWeight: 700, letterSpacing: '0.02em' }}>{label}</span>
          </div>
          <div className="rc-bhs-row">
            <div className="rc-bhs-block" style={blackFlag ? { background: '#222831', color: '#ff6a6a' } : undefined}><span className="v" style={{ fontSize: 'clamp(11px,3vh,15px)' }}>{sessionUp}</span></div>
          </div>
        </div>
      </div>
    )
  }

  // ── analog — marshal tell-tale lamp (shared registry glyph) ──
  if (family === 'analog') {
    return (
      <div className="overlay-card rc-card rc-fam-analog">
        <div className="rc-ang-row" style={{ justifyContent: 'flex-start', gap: '14px', paddingLeft: '16px' }}>
          <TellTaleLamp info={info} size={64} />
          <div style={{ display: 'grid', gap: '2px' }}>
            <div className="rc-cond" style={{ color: info.color, fontWeight: 700, fontSize: 'clamp(20px, 14vh, 38px)', lineHeight: 0.95 }}>{label}</div>
            <div className="rc-ang-sub" style={{ fontSize: 'clamp(10px, 3vh, 13px)', letterSpacing: '0.14em' }}>{sessionUp}</div>
          </div>
        </div>
      </div>
    )
  }

  // ── heatmap — severity tile ──
  const dangerPct = Math.round(info.danger * 100)
  return (
    <div className="overlay-card rc-card rc-fam-heatmap">
      <div className="rc-hm" style={{ alignContent: 'center', gap: '6px' }}>
        <div style={{ position: 'relative', borderRadius: '6px', padding: 'clamp(8px,5%,16px)', background: `color-mix(in srgb, ${info.color} ${30 + info.danger * 45}%, #06080d)`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <TellTaleLamp info={info} size={40} color={info.danger > 0.6 ? '#fff' : info.color} />
            <span className="rc-cond" style={{ color: info.danger > 0.6 ? '#fff' : info.color, fontWeight: 700, fontSize: 'clamp(22px, 15vh, 44px)', textShadow: flagHasGlow(info) ? `0 0 18px ${info.color}` : undefined }}>{label}</span>
          </span>
          <span className="rc-cond" style={{ color: 'rgba(255,255,255,0.78)', fontSize: 'clamp(10px, 3vh, 13px)', textAlign: 'right' }}>{sessionUp}<br />risco {dangerPct}%</span>
        </div>
      </div>
    </div>
  )
}
