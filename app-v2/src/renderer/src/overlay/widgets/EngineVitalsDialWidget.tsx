// ENGINE VITALS dial overlay — three compact GT3 MoTeC/AiM-style arc gauges for the
// core engine vitals: water temperature, oil temperature and oil pressure. Warm-only
// severity: neutral chrome when healthy, amber = caution, red = danger. Oil pressure is
// only judged once the engine is spinning (rpm > 1200) so a stationary car never
// false-alarms. Brand-neutral, metric (°C / bar).
//
// v2.39 rebuild: one root <svg> (fixed viewBox) laid out with makeGrid. Each gauge is a
// real AnalogDial instrument (bezel + ticks + needle + value arc) with a DSEG
// SegmentReadout centre face; titles / status / labels / units are FitText so nothing
// overflows, clips or renders sub-legible. Every input is optional and degrades to "—"
// so a null snapshot never renders NaN / undefined / Infinity. Colours are skin tokens.
import { type ReactElement } from 'react'
import { AnalogDial, SegmentReadout, INSTRUMENT_COLORS } from '../../instruments'
import { resolveSkin, FitText, makeGrid } from '../../skins'
import type { SkinId, BrandId, SkinToken, Rect } from '../../skins'
import type { WidgetProps } from './types'
import { numberOrDash } from './format'

export const ENGINE_VITALS_DIAL_STREAM_SAFE = true

const DEFAULT_W = 360
const DEFAULT_H = 180

type Sev = 'ok' | 'amber' | 'red'

interface DialModel {
  label: string
  value: string
  unit: string
  numericValue?: number
  min: number
  max: number
  sev: Sev
}

function widgetSkin(config: WidgetProps['config']): SkinToken {
  const style = (config?.style ?? {}) as { skin?: SkinId; brand?: BrandId }
  return resolveSkin(style.skin ?? 'gt3', style.brand ?? 'generic')
}

function sevColor(sev: Sev, skin: SkinToken): string {
  return sev === 'red' ? skin.palette.crit : sev === 'amber' ? skin.palette.warn : skin.palette.textDim
}
function sevValueColor(sev: Sev, skin: SkinToken): string {
  return sev === 'red' ? skin.palette.crit : sev === 'amber' ? skin.palette.warn : skin.palette.text
}
function needleColor(sev: Sev): string {
  return sev === 'red' ? INSTRUMENT_COLORS.danger : sev === 'amber' ? INSTRUMENT_COLORS.warn : INSTRUMENT_COLORS.good
}

function offset(area: Rect, cell: Rect): Rect {
  return { x: area.x + cell.x, y: area.y + cell.y, w: cell.w, h: cell.h }
}

function DialCell({ rect, d, skin }: { rect: Rect; d: DialModel; skin: SkinToken }): ReactElement {
  const { typography } = skin
  const size = Math.max(24, Math.min(rect.w - 6, rect.h - 30))
  const dialX = rect.x + (rect.w - size) / 2
  const dialY = rect.y
  const valW = size * 0.66
  const valH = Math.max(12, size * 0.22)
  const valX = dialX + (size - valW) / 2
  const valY = dialY + size * 0.46
  const labelY = dialY + size + 10
  return (
    <g>
      <svg x={dialX} y={dialY} width={size} height={size} overflow="visible">
        <AnalogDial
          value={d.numericValue ?? 0}
          min={d.min}
          max={d.max}
          size={size}
          startAngleDeg={-135}
          endAngleDeg={135}
          majorTicks={5}
          minorPerMajor={2}
          showValue={false}
          showTicks
          bezel="thin"
          material="matte"
          needleColor={needleColor(d.sev)}
          idPrefix={`evd-${d.label.replace(/\s+/g, '')}`}
        />
      </svg>
      <svg x={valX} y={valY} width={valW} height={valH} overflow="visible">
        <SegmentReadout
          value={d.value}
          mode={d.numericValue !== undefined ? '7' : undefined}
          ghost={false}
          height={valH}
          width={valW}
          align="center"
          color={sevValueColor(d.sev, skin)}
          idPrefix={`evd-${d.label.replace(/\s+/g, '')}-v`}
        />
      </svg>
      <FitText x={dialX + size / 2} y={valY + valH + 6} boxW={size * 0.6} boxH={9} text={d.unit} fontFamily={typography.label} fill={skin.palette.textDim} weight={600} minFontPx={7} maxFontPx={10} />
      <FitText x={rect.x + rect.w / 2} y={labelY} boxW={rect.w} boxH={13} text={d.label} fontFamily={typography.label} fill={d.sev === 'ok' ? skin.palette.textDim : sevColor(d.sev, skin)} weight={800} letterSpacing={0.8} minFontPx={10} maxFontPx={14} />
    </g>
  )
}

export function EngineVitalsDialWidget({ snapshot, config }: WidgetProps): ReactElement {
  const skin = widgetSkin(config)
  const W = Math.max(1, Math.round(config?.position?.width ?? DEFAULT_W))
  const H = Math.max(1, Math.round(config?.position?.height ?? DEFAULT_H))
  const { palette, material, typography } = skin

  const s = snapshot
  const water = s?.waterTempC
  const oilT = s?.oilTempC
  const oilBar = s?.oilPressureKpa !== undefined && Number.isFinite(s.oilPressureKpa) ? s.oilPressureKpa / 100 : undefined
  const spinning = (s?.rpm ?? 0) > 1200

  const waterSev: Sev = water === undefined ? 'ok' : water >= 110 ? 'red' : water >= 100 ? 'amber' : 'ok'
  const oilTSev: Sev = oilT === undefined ? 'ok' : oilT >= 140 ? 'red' : oilT >= 125 ? 'amber' : 'ok'
  const oilPSev: Sev = oilBar === undefined || !spinning ? 'ok' : oilBar < 2.5 ? 'red' : oilBar < 3.5 ? 'amber' : 'ok'

  const worst: Sev = [waterSev, oilTSev, oilPSev].includes('red')
    ? 'red'
    : [waterSev, oilTSev, oilPSev].includes('amber')
      ? 'amber'
      : 'ok'
  const statusText = worst === 'red' ? 'ALARM' : worst === 'amber' ? 'WATCH' : 'OK'

  const dials: DialModel[] = [
    { label: 'Water', value: numberOrDash(water, 0), unit: '°C', numericValue: water, min: 60, max: 130, sev: waterSev },
    { label: 'Oil T', value: numberOrDash(oilT, 0), unit: '°C', numericValue: oilT, min: 70, max: 150, sev: oilTSev },
    { label: 'Oil P', value: numberOrDash(oilBar, 1), unit: 'bar', numericValue: oilBar, min: 0, max: 7, sev: oilPSev }
  ]

  const pad = 10
  const headerH = 24
  const area: Rect = { x: pad, y: headerH + 4, w: W - pad * 2, h: H - headerH - pad - 4 }
  const grid = makeGrid(3, 1, area.w, area.h, 8)

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      style={{ display: 'block' }}
      data-widget="engineVitalsDial"
    >
      <rect x={1} y={1} width={W - 2} height={H - 2} rx={material.radius} fill={material.base} stroke={material.border} strokeWidth={material.borderWidth} />
      <FitText x={pad} y={pad + 5} boxW={W * 0.6} boxH={headerH * 0.8} text="Engine Vitals" anchor="start" fontFamily={typography.label} fill={palette.textDim} weight={800} letterSpacing={1.2} minFontPx={11} maxFontPx={16} />
      <FitText x={W - pad} y={pad + 5} boxW={W * 0.28} boxH={headerH * 0.8} text={statusText} anchor="end" fontFamily={typography.label} fill={worst === 'ok' ? palette.textDim : sevColor(worst, skin)} weight={800} letterSpacing={1} minFontPx={11} maxFontPx={15} />
      {dials.map((d, i) => (
        <DialCell key={d.label} rect={offset(area, grid.cell(i, 0))} d={d} skin={skin} />
      ))}
    </svg>
  )
}
