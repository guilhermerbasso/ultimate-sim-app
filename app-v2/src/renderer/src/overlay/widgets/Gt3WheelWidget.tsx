// Gt3WheelWidget — a brand-neutral GT3 steering-wheel FACE, rebuilt on the v2.39
// instrument KIT. One root <svg> (fixed viewBox + preserveAspectRatio); the telltale
// bank (FIA flags + TC activity + rain) is the shared TelltaleBank primitive, the pit
// limiter is an auto-fitting FitText chip (never the KIT's sub-10px embedded glyph) and
// the four rotary-knob levels (TC / ABS / MAP / BB) are DataFields — so no glyph text or
// value is sized from an element's height via CSS clamp() (the old overflow bug).
// Skin-token only. A null snapshot degrades every level to "—".
import type { ReactElement } from 'react'
import type { Flags } from '../../../../shared/telemetry'
import type { WidgetProps } from './types'
import { numberOrDash } from './format'
import { resolveSkin, FitText, type SkinToken } from '../../skins'
import { TelltaleBank, DataField, type TelltaleLamp, type FieldState } from '../../instruments'
import type { MotorsportIconId } from '../../icons/motorsport'

export const GT3_WHEEL_STREAM_SAFE = true

function dims(config: WidgetProps['config']): { W: number; H: number } {
  const w = config?.position?.width
  const h = config?.position?.height
  return {
    W: typeof w === 'number' && w > 0 ? w : 360,
    H: typeof h === 'number' && h > 0 ? h : 240
  }
}

function levelStr(v: number | string | undefined): string {
  if (v === undefined) return '—'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '—'
  const t = v.trim()
  return t.length ? t : '—'
}

function flagColor(key: keyof Flags, skin: SkinToken): string {
  const p = skin.palette
  switch (key) {
    case 'green':
      return p.ok
    case 'yellow':
      return p.warn
    case 'blue':
      return p.info
    case 'meatball':
      return p.warn
    case 'black':
      return p.crit
    default:
      return p.text
  }
}

const FLAG_LAMPS: { key: keyof Flags; icon: MotorsportIconId }[] = [
  { key: 'green', icon: 'flag-green' },
  { key: 'yellow', icon: 'flag-yellow' },
  { key: 'blue', icon: 'flag-blue' },
  { key: 'white', icon: 'flag-white' },
  { key: 'meatball', icon: 'flag-meatball' },
  { key: 'black', icon: 'flag-black' },
  { key: 'checkered', icon: 'flag-checkered' }
]

export function Gt3WheelWidget({ snapshot, config }: WidgetProps): ReactElement {
  const s = snapshot
  const skin = resolveSkin('gt3', 'generic')
  const { palette } = skin
  const { W, H } = dims(config)

  const flags = s?.flags
  const tcActive = !!s?.tcActive
  const absActive = !!s?.absActive
  const pit = !!s?.pitLimiter
  const rain = !!s?.isRaining

  const lamps: TelltaleLamp[] = [
    ...FLAG_LAMPS.map((f) => ({ icon: f.icon, active: !!flags?.[f.key], activeColor: flagColor(f.key, skin) })),
    { icon: 'tc', active: tcActive, activeColor: palette.warn },
    { icon: 'rain', active: rain, activeColor: palette.info }
  ]
  // The pit-limiter occupies the next grid cell after the lamps, drawn as an
  // auto-fitting FitText chip so its label never falls under the tiny-text floor.
  const pitCellIndex = lamps.length

  const P = Math.max(8, Math.round(Math.min(W, H) * 0.04))
  const G = Math.max(6, Math.round(Math.min(W, H) * 0.03))
  const cols = 6
  const rows = Math.ceil((lamps.length + 1) / cols)
  const gapL = 8
  const maxByW = (W - 2 * P - (cols - 1) * gapL) / cols
  const lampSize = Math.max(34, Math.min(52, Math.floor(maxByW)))
  const bankW = cols * lampSize + (cols - 1) * gapL
  const bankH = rows * lampSize + (rows - 1) * gapL
  const bankX = (W - bankW) / 2
  const bankY = P
  const pitCol = pitCellIndex % cols
  const pitRow = Math.floor(pitCellIndex / cols)
  const pitX = pitCol * (lampSize + gapL)
  const pitY = pitRow * (lampSize + gapL)
  const pitColor = pit ? palette.info : palette.textDim

  const knobY = bankY + bankH + G
  const knobH = H - P - knobY
  const kCols = 4
  const kW = (W - 2 * P - G * (kCols - 1)) / kCols
  const kx = (i: number): number => P + i * (kW + G)

  const df = (i: number, label: string, value: string, st: FieldState): ReactElement => (
    <DataField x={kx(i)} y={knobY} width={kW} height={knobH} label={label} value={value} state={st} ghost={false} skin={skin} />
  )

  return (
    <div className="overlay-card dr-root rd-gt3-wheel" data-overlay-id={config?.id} data-widget="gt3Wheel" style={{ width: '100%', height: '100%', overflow: 'hidden', background: palette.bg }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" width="100%" height="100%" style={{ display: 'block' }}>
        <rect x={0} y={0} width={W} height={H} rx={skin.material.radius} fill={palette.bg} />
        <g transform={`translate(${bankX}, ${bankY})`}>
          <TelltaleBank lamps={lamps} size={lampSize} gap={gapL} columns={cols} glow idPrefix="gt3wheel-bank" />
          <rect x={pitX} y={pitY} width={lampSize} height={lampSize} rx={skin.material.radius} fill={palette.surface} stroke={pitColor} strokeWidth={pit ? 2 : 1} opacity={pit ? 1 : 0.5} />
          <FitText x={pitX + lampSize / 2} y={pitY + lampSize / 2} boxW={lampSize} boxH={lampSize} text="PIT" fontFamily={skin.typography.label} fill={pitColor} minFontPx={11} maxFontPx={Math.max(12, Math.floor(lampSize * 0.42))} weight={700} anchor="middle" baseline="middle" />
        </g>
        {df(0, 'TC', levelStr(s?.tcLevel), tcActive ? 'warn' : 'normal')}
        {df(1, 'ABS', levelStr(s?.absLevel), absActive ? 'warn' : 'normal')}
        {df(2, 'MAP', levelStr(s?.engineMap), 'normal')}
        {df(3, 'BB', numberOrDash(s?.brakeBiasPct, 1), 'accent')}
      </svg>
    </div>
  )
}
