// CompactHudWidget — a wide compact HUD strip (gear + RPM ledbar + speed/pos/meta),
// rebuilt on the v2.39 instrument KIT and the HUD skin. One root <svg> (fixed viewBox +
// preserveAspectRatio); the shift band is the shared RevLedBar, the hero gear is auto-
// fit FitText and every readout is a DataField — so nothing is sized from an element's
// height via CSS clamp() (the old overflow bug). The design family (config.stylePreset →
// overlayDesignFamily) still drives the accent so the 7 presets stay visually distinct,
// while the structure is a single overflow-proof HUD scene. A null snapshot shows "—".
import type { ReactElement } from 'react'
import type { WidgetProps } from './types'
import { formatGear, pct } from './format'
import { overlayDesignFamily, type OverlayDesignFamily } from '../../../../shared/overlays'
import { resolveSkin, FitText, zoneColor } from '../../skins'
import { RevLedBar, DataField, type FieldState } from '../../instruments'
import { formatMeasurement } from '../../../../shared/units'
import { useUnitSystem } from '../../lib/units'
import { atShiftPoint } from '../../lib/rev-lights'

export const COMPACT_HUD_STREAM_SAFE = true

function dims(config: WidgetProps['config']): { W: number; H: number } {
  const w = config?.position?.width
  const h = config?.position?.height
  return {
    W: typeof w === 'number' && w > 0 ? w : 520,
    H: typeof h === 'number' && h > 0 ? h : 110
  }
}

function formatSession(secs?: number): string {
  if (secs === undefined || !Number.isFinite(secs) || secs < 0) return '—'
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function sofLabel(sof: number | undefined): string {
  if (sof === undefined || !Number.isFinite(sof)) return '—'
  return sof >= 1000 ? `${(sof / 1000).toFixed(1)}K` : String(sof)
}

// Design-family accent so the seven presets stay visually distinct atop the HUD skin.
function familyAccent(family: OverlayDesignFamily, fallback: string): string {
  switch (family) {
    case 'neon':
      return '#00E0FF'
    case 'terminal':
      return '#39FF87'
    case 'heatmap':
      return '#FF8C2B'
    case 'bauhaus':
      return '#FFB000'
    case 'broadcast':
      return '#38BDF8'
    case 'analog':
      return '#E8EDF2'
    default:
      return fallback
  }
}

export function CompactHudWidget({ snapshot, config }: WidgetProps): ReactElement {
  const unitSystem = useUnitSystem()
  const s = snapshot
  const skin = resolveSkin('hud', 'generic')
  const { palette } = skin
  const { W, H } = dims(config)
  const family = overlayDesignFamily(config?.stylePreset)
  const accent = familyAccent(family, palette.accent)

  const rpm = s?.rpm ?? 0
  const shiftPct = pct(s?.shiftIndicatorPct ?? rpm / (s?.maxRpm ?? 9000))
  const redline = atShiftPoint(shiftPct, s?.revLights?.blink, 0.95)
  const gear = formatGear(s?.gear)
  const speed = formatMeasurement(s?.speedKmh, 'speed-kmh', unitSystem, { decimals: 0 })
  const trackTemp = formatMeasurement(s?.trackTempC, 'temperature-c', unitSystem, { decimals: 0 })
  const pos = s?.position
  const posStr = pos !== undefined && Number.isFinite(pos) ? `P${pos}` : '—'
  const gearColor = redline ? palette.crit : zoneColor(skin.led, shiftPct)

  const P = Math.max(6, Math.round(Math.min(W, H) * 0.06))
  const G = Math.max(4, Math.round(Math.min(W, H) * 0.05))
  const innerW = W - 2 * P
  const ledH = Math.max(12, Math.round(H * 0.16))
  const ledY = P
  const bodyY = ledY + ledH + G
  const bodyH = H - P - bodyY
  const gw = Math.max(56, Math.round(W * 0.16))
  const fieldsX = P + gw + G
  const fieldsW = W - P - fieldsX
  const cols = 5
  const cW = (fieldsW - G * (cols - 1)) / cols
  const cx = (i: number): number => fieldsX + i * (cW + G)

  const df = (i: number, label: string, value: string, st: FieldState = 'normal', unit?: string): ReactElement => (
    <DataField x={cx(i)} y={bodyY} width={cW} height={bodyH} label={label} value={value} unit={unit} state={st} ghost={false} skin={skin} />
  )

  return (
    <div className="overlay-card dr-root rd-compact-hud" data-overlay-id={config?.id} data-widget="compactHud" data-family={family} data-skin={skin.id} style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" width="100%" height="100%" style={{ display: 'block' }}>
        <rect x={0} y={0} width={W} height={H} rx={skin.material.radius} fill={palette.bg} />

        <RevLedBar pct={shiftPct} profile={skin.led} x={P} y={ledY} width={innerW} height={ledH} shiftActive={redline} />

        <rect x={P} y={bodyY} width={gw} height={bodyH} rx={skin.material.radius} fill={palette.bg} stroke={redline ? palette.crit : accent} strokeWidth={Math.max(1, skin.material.borderWidth)} />
        <FitText x={P + gw / 2} y={bodyY + bodyH / 2} boxW={gw * 0.8} boxH={bodyH * 0.82} text={gear} anchor="middle" baseline="middle" fontFamily={/^\d$/.test(gear) ? skin.segment.numeric : skin.segment.alpha} fill={gearColor} minFontPx={20} maxFontPx={bodyH * 0.82} weight={700} />

        {df(0, 'SPEED', speed.display, 'normal', speed.unit.toUpperCase())}
        {df(1, 'POS', posStr, 'accent')}
        {df(2, 'TRACK', trackTemp.display, 'normal', trackTemp.unit)}
        {df(3, 'SOF', sofLabel(s?.strengthOfField))}
        {df(4, 'TIME', formatSession(s?.sessionTimeRemainingSec))}
      </svg>
    </div>
  )
}
