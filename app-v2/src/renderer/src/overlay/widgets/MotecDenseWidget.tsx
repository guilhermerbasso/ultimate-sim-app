// MotecDenseWidget — a tight rectangular multi-field logger panel (MoTeC / Cosworth /
// AiM spirit), rebuilt on the v2.39 instrument KIT. One root <svg> (fixed viewBox +
// preserveAspectRatio); every field is a DataField placed on an explicit 4-column grid,
// so no value is sized from an element's height via CSS clamp() (the old overflow bug).
// Skin-token only. Pure & presentational: a null/partial snapshot degrades each readout
// to "—" and never emits NaN / undefined / Infinity.
import type { ReactElement } from 'react'
import type { WidgetProps } from './types'
import { formatDelta, formatGear, numberOrDash } from './format'
import { fuelLaps } from './gt3Telemetry'
import { resolveSkin, FitText } from '../../skins'
import { DataField, type FieldState } from '../../instruments'
import { formatMeasurement } from '../../../../shared/units'
import { useUnitSystem } from '../../lib/units'

export const MOTEC_DENSE_STREAM_SAFE = true

function dims(config: WidgetProps['config']): { W: number; H: number } {
  const w = config?.position?.width
  const h = config?.position?.height
  return {
    W: typeof w === 'number' && w > 0 ? w : 420,
    H: typeof h === 'number' && h > 0 ? h : 260
  }
}

function n0(v: number | undefined): string {
  return v === undefined || !Number.isFinite(v) ? '—' : String(Math.round(v))
}
function levelStr(v: number | string | undefined): string {
  if (v === undefined) return '—'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '—'
  const t = v.trim()
  return t.length ? t : '—'
}

function tempState(c: number | undefined, warn: number, crit: number): FieldState {
  if (c === undefined || !Number.isFinite(c)) return 'normal'
  if (c >= crit) return 'crit'
  if (c >= warn) return 'warn'
  return 'ok'
}

export function MotecDenseWidget({ snapshot, config }: WidgetProps): ReactElement {
  const unitSystem = useUnitSystem()
  const s = snapshot
  const skin = resolveSkin('gt3', 'generic')
  const { palette } = skin
  const { W, H } = dims(config)

  const gear = formatGear(s?.gear)
  const delta = s?.deltaToBestSec
  const deltaState: FieldState = delta !== undefined && Number.isFinite(delta) && delta <= 0 ? 'ok' : 'warn'
  const laps = fuelLaps(s)
  const fuelState: FieldState = laps === undefined ? 'normal' : laps <= 2 ? 'crit' : laps <= 3.5 ? 'warn' : 'normal'
  const speed = formatMeasurement(s?.speedKmh, 'speed-kmh', unitSystem, { decimals: 0 })
  const fuel = formatMeasurement(s?.fuelLiters, 'fuel-volume-l', unitSystem, { decimals: 1 })
  const waterTemp = formatMeasurement(s?.waterTempC, 'temperature-c', unitSystem, { decimals: 0 })
  const oilTemp = formatMeasurement(s?.oilTempC, 'temperature-c', unitSystem, { decimals: 0 })
  const fuelPerLap = formatMeasurement(s?.fuelPerLap, 'fuel-per-lap-l', unitSystem, { decimals: 2 })

  const P = Math.max(6, Math.round(Math.min(W, H) * 0.03))
  const gap = Math.max(3, Math.round(Math.min(W, H) * 0.016))
  const headH = Math.max(16, Math.round(H * 0.09))
  const gridY = P + headH + gap
  const gridH = H - gridY - P
  const cols = 4
  const rows = 4
  const colW = (W - 2 * P - gap * (cols - 1)) / cols
  const rowH = (gridH - gap * (rows - 1)) / rows
  const colX = (i: number): number => P + i * (colW + gap)
  const rowY = (i: number): number => gridY + i * (rowH + gap)
  const spanW = (n: number): number => n * colW + (n - 1) * gap

  const df = (
    col: number, row: number, span: number,
    label: string, value: string, st: FieldState = 'normal', unit?: string
  ): ReactElement => (
    <DataField x={colX(col)} y={rowY(row)} width={spanW(span)} height={rowH} label={label} value={value} unit={unit} state={st} ghost={false} skin={skin} />
  )

  return (
    <div className="overlay-card dr-root rd-motec-dense" data-overlay-id={config?.id} data-widget="motecDense" style={{ width: '100%', height: '100%', overflow: 'hidden', background: palette.bg }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" width="100%" height="100%" style={{ display: 'block' }}>
        <rect x={0} y={0} width={W} height={H} fill={palette.bg} />
        <FitText x={P} y={P + headH / 2} boxW={W * 0.5} boxH={headH * 0.9} text="DATA" anchor="start" baseline="middle" fontFamily={skin.typography.label} fill={palette.textDim} minFontPx={11} maxFontPx={Math.max(12, headH * 0.8)} weight={800} letterSpacing={3} />

        {df(0, 0, 1, 'GEAR', gear, 'accent')}
        {df(1, 0, 2, 'SPEED', speed.display, 'normal', speed.unit.toUpperCase())}
        {df(3, 0, 1, 'RPM', n0(s?.rpm))}

        {df(0, 1, 2, 'DELTA', formatDelta(delta), deltaState, 's')}
        {df(2, 1, 1, 'LAP', n0(s?.currentLap))}
        {df(3, 1, 1, 'FUEL', fuel.display, fuelState, fuel.unit)}

        {df(0, 2, 1, 'WATER', waterTemp.display, tempState(s?.waterTempC, 100, 115), waterTemp.unit)}
        {df(1, 2, 1, 'OIL', oilTemp.display, tempState(s?.oilTempC, 110, 130), oilTemp.unit)}
        {df(2, 2, 2, 'FUEL/LAP', fuelPerLap.display, 'normal', fuelPerLap.unit)}

        {df(0, 3, 1, 'TC', levelStr(s?.tcLevel))}
        {df(1, 3, 1, 'ABS', levelStr(s?.absLevel))}
        {df(2, 3, 1, 'MAP', levelStr(s?.engineMap))}
        {df(3, 3, 1, 'BB', numberOrDash(s?.brakeBiasPct, 1), 'normal', '%')}
      </svg>
    </div>
  )
}
