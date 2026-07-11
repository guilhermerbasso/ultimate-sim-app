// ENGINE VITALS strip overlay — a wide single-row bar of the four core vitals (water
// temp, oil temp, oil pressure, fuel) for a broadcast-style lower third. Warm-only
// severity: quiet neutral chrome when healthy, amber = caution, red = danger. Oil
// pressure is only judged once the engine is spinning (rpm > 1200) so a stationary car
// never false-alarms. Brand-neutral, metric.
//
// v2.39 rebuild: one root <svg> (fixed viewBox) laid out with makeGrid(4,1). Each vital
// is a DataField instrument (label + auto-fit DSEG value + unit on a bezelled panel)
// over a token-coloured level bar. Every input is optional and degrades to "—" so a
// null snapshot never renders NaN / undefined / Infinity. Colours are skin tokens.
import { type ReactElement } from 'react'
import { DataField } from '../../instruments'
import { resolveSkin, makeGrid } from '../../skins'
import type { SkinId, BrandId, SkinToken, Rect } from '../../skins'
import type { FieldState } from '../../instruments'
import { pct } from './format'
import { fuelLevelPct, GT3_STREAM_SAFE, type Gt3Severity } from './gt3Telemetry'
import type { WidgetProps } from './types'
import { formatMeasurement } from '../../../../shared/units'
import { useUnitSystem } from '../../lib/units'

export const ENGINE_VITALS_STRIP_STREAM_SAFE = GT3_STREAM_SAFE

const DEFAULT_W = 640
const DEFAULT_H = 92

function severity(value: number | undefined, amberAt: number, redAt: number, lowRedAt?: number): Gt3Severity {
  if (value === undefined) return 'ok'
  if (lowRedAt !== undefined && value <= lowRedAt) return 'red'
  if (value >= redAt) return 'red'
  if (value >= amberAt) return 'amber'
  return 'ok'
}

function vitalPct(value: number | undefined, min: number, max: number): number {
  if (value === undefined) return 0
  return pct((value - min) / (max - min))
}

function pressureSeverity(value: number | undefined, rpm: number | undefined): Gt3Severity {
  if (value === undefined || (rpm ?? 0) <= 1200) return 'ok'
  if (value < 2.5) return 'red'
  if (value < 3.5) return 'amber'
  return 'ok'
}

function widgetSkin(config: WidgetProps['config']): SkinToken {
  const style = (config?.style ?? {}) as { skin?: SkinId; brand?: BrandId }
  return resolveSkin(style.skin ?? 'gt3', style.brand ?? 'generic')
}

// ok = quiet neutral chrome (never green), amber = caution, red = danger.
function barColor(sev: Gt3Severity, skin: SkinToken): string {
  return sev === 'red' ? skin.palette.crit : sev === 'amber' ? skin.palette.warn : skin.palette.textDim
}
function fieldState(sev: Gt3Severity): FieldState {
  return sev === 'red' ? 'crit' : sev === 'amber' ? 'warn' : 'normal'
}

interface Vital {
  label: string
  value: string
  unit: string
  level: number
  sev: Gt3Severity
}

function offset(area: Rect, cell: Rect): Rect {
  return { x: area.x + cell.x, y: area.y + cell.y, w: cell.w, h: cell.h }
}

export function EngineVitalsStripWidget({ snapshot, config }: WidgetProps): ReactElement {
  const unitSystem = useUnitSystem()
  const skin = widgetSkin(config)
  const W = Math.max(1, Math.round(config?.position?.width ?? DEFAULT_W))
  const H = Math.max(1, Math.round(config?.position?.height ?? DEFAULT_H))
  const { palette, material } = skin

  const oilBar = snapshot?.oilPressureKpa !== undefined ? snapshot.oilPressureKpa / 100 : undefined
  const fuelPct = fuelLevelPct(snapshot)
  const water = formatMeasurement(snapshot?.waterTempC, 'temperature-c', unitSystem, { decimals: 0 })
  const oil = formatMeasurement(snapshot?.oilTempC, 'temperature-c', unitSystem, { decimals: 0 })
  const oilPressure = formatMeasurement(oilBar, 'pressure-bar', unitSystem, { decimals: 1 })

  const vitals: Vital[] = [
    { label: 'Water T', value: water.display, unit: water.unit, level: vitalPct(snapshot?.waterTempC, 60, 120), sev: severity(snapshot?.waterTempC, 105, 115) },
    { label: 'Oil T', value: oil.display, unit: oil.unit, level: vitalPct(snapshot?.oilTempC, 70, 145), sev: severity(snapshot?.oilTempC, 125, 140) },
    { label: 'Oil P', value: oilPressure.display, unit: oilPressure.unit, level: vitalPct(oilBar, 0, 7), sev: pressureSeverity(oilBar, snapshot?.rpm) },
    { label: 'Fuel', value: fuelPct === undefined ? '—' : Math.round(fuelPct * 100).toString(), unit: '%', level: pct(fuelPct), sev: fuelPct !== undefined && fuelPct <= 0.1 ? 'red' : fuelPct !== undefined && fuelPct <= 0.18 ? 'amber' : 'ok' }
  ]

  const pad = 8
  const area: Rect = { x: pad, y: pad, w: W - pad * 2, h: H - pad * 2 }
  const grid = makeGrid(4, 1, area.w, area.h, 8)

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      style={{ display: 'block' }}
      data-widget="engineVitalsStrip"
    >
      <rect x={1} y={1} width={W - 2} height={H - 2} rx={material.radius} fill={material.base} stroke={material.border} strokeWidth={material.borderWidth} />
      {vitals.map((v, i) => {
        const cell = offset(area, grid.cell(i, 0))
        const fieldH = cell.h * 0.7
        const barY = cell.y + cell.h * 0.8
        const barH = Math.max(5, cell.h * 0.13)
        const barX = cell.x + 4
        const barW = cell.w - 8
        const col = barColor(v.sev, skin)
        return (
          <g key={v.label}>
            <DataField x={cell.x} y={cell.y} width={cell.w} height={fieldH} label={v.label} value={v.value} unit={v.unit} state={fieldState(v.sev)} ghost={false} skin={skin} />
            <rect x={barX} y={barY} width={barW} height={barH} rx={barH / 2} fill={palette.bg} stroke={material.border} strokeWidth={1} />
            {v.level > 0 && <rect x={barX} y={barY} width={Math.max(0, barW * pct(v.level))} height={barH} rx={barH / 2} fill={col} />}
          </g>
        )
      })}
    </svg>
  )
}
