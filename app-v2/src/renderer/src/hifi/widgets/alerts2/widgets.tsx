import { type ReactElement } from 'react'
import { trackSurfaceMaterialLabel, type TelemetrySnapshot, type TyreInfo } from '../../../../../shared/telemetry'
import type { HifiWidgetModule, HifiWidgetProps } from '../types'
import { Bar, C, CleanTile, FONT_BIG, FONT_LABEL, FONT_NUM, fixed, frac, legibleStroke, num } from '../kit'

const RED = '#ff2626'
const AMBER = '#ffb000'
const BLUE = '#157cff'
const CYAN = '#00d8ff'
const WHITE = '#f8fbff'

function empty(width: number, height: number): ReactElement {
  return <CleanTile width={width} height={height}>{null}</CleanTile>
}

function warningLamp({ width, height, color, label, value, unit, icon }: { width: number; height: number; color: string; label: string; value: string; unit?: string; icon: string }): ReactElement {
  const valueSize = value.length > 4 ? 58 : 74
  return (
    <CleanTile width={width} height={height}>
      <defs>
        <filter id={`alerts2-${label.toLowerCase().replace(/[^a-z0-9]/g, '-')}-glow`} x="-50%" y="-70%" width="200%" height="240%">
          <feDropShadow dx="0" dy="0" stdDeviation="5" floodColor={color} floodOpacity="0.92" />
          <feDropShadow dx="0" dy="0" stdDeviation="16" floodColor={color} floodOpacity="0.5" />
        </filter>
      </defs>
      <g filter={`url(#alerts2-${label.toLowerCase().replace(/[^a-z0-9]/g, '-')}-glow)`}>
        <rect x="24" y="24" width={width - 48} height={height - 48} rx="26" fill="rgba(0,0,0,0.08)" stroke={color} strokeWidth="5" />
        <text x="72" y="98" textAnchor="middle" fill={color} fontFamily={FONT_BIG} fontSize="58" fontWeight="900" {...legibleStroke(58)}>
          {icon}
        </text>
        <text x={width / 2 + 38} y="76" textAnchor="middle" fill={color} fontFamily={FONT_LABEL} fontSize="34" fontWeight="900" letterSpacing="5" {...legibleStroke(34)}>
          {label}
        </text>
        <text x={width / 2 + 38} y="148" textAnchor="middle" fill={WHITE} fontFamily={FONT_NUM} fontSize={valueSize} fontWeight="900" letterSpacing="-2" {...legibleStroke(valueSize)}>
          {value}
          {unit ? <tspan fill={color} fontFamily={FONT_LABEL} fontSize={valueSize * 0.36}> {unit}</tspan> : null}
        </text>
      </g>
    </CleanTile>
  )
}

function anyEngineWarning(snapshot: TelemetrySnapshot | null): boolean {
  const warnings = snapshot?.engineWarnings
  return Boolean(warnings && Object.values(warnings).some(Boolean))
}

function maxTyreTemp(tyre: TyreInfo | undefined): number | undefined {
  const values = [
    num(tyre?.tempC),
    num(tyre?.tempLeftC),
    num(tyre?.tempMiddleC),
    num(tyre?.tempRightC),
    num(tyre?.surfaceTempLeftC),
    num(tyre?.surfaceTempMiddleC),
    num(tyre?.surfaceTempRightC)
  ].filter((v): v is number => v != null)
  return values.length > 0 ? Math.max(...values) : undefined
}

function hottestTyre(snapshot: TelemetrySnapshot | null): { corner: string; temp: number } | null {
  const tyres = snapshot?.tyres
  if (!tyres) return null
  const entries = [
    { corner: 'LF', temp: maxTyreTemp(tyres.lf) },
    { corner: 'RF', temp: maxTyreTemp(tyres.rf) },
    { corner: 'LR', temp: maxTyreTemp(tyres.lr) },
    { corner: 'RR', temp: maxTyreTemp(tyres.rr) }
  ].filter((v): v is { corner: string; temp: number } => v.temp != null)
  if (entries.length === 0) return null
  return entries.reduce((hot, item) => (item.temp > hot.temp ? item : hot), entries[0])
}

function brakeLineValues(snapshot: TelemetrySnapshot | null): number[] {
  const p = snapshot?.brakeLinePressBar
  if (!p) return []
  return [num(p.lf), num(p.rf), num(p.lr), num(p.rr)].filter((v): v is number => v != null)
}

function Alert2EngineWarning({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const w = width ?? 380
  const h = height ?? 190
  if (!anyEngineWarning(snapshot)) return empty(w, h)
  return warningLamp({ width: w, height: h, color: RED, label: 'ENGINE', value: 'WARN', icon: '!' })
}

function Alert2WaterTempCritical({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const w = width ?? 360
  const h = height ?? 190
  const temp = num(snapshot?.waterTempC)
  const active = snapshot?.engineWarnings?.waterTemp === true || (temp != null && temp >= 105)
  if (!active) return empty(w, h)
  return warningLamp({ width: w, height: h, color: RED, label: 'WATER', value: fixed(temp, 0), unit: 'C', icon: '~' })
}

function Alert2OilTempCritical({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const w = width ?? 360
  const h = height ?? 190
  const temp = num(snapshot?.oilTempC)
  const active = snapshot?.engineWarnings?.oilTemp === true || (temp != null && temp >= 125)
  if (!active) return empty(w, h)
  return warningLamp({ width: w, height: h, color: RED, label: 'OIL TEMP', value: fixed(temp, 0), unit: 'C', icon: '°' })
}

function Alert2OilPressureLow({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const w = width ?? 380
  const h = height ?? 190
  const pressure = num(snapshot?.oilPressureKpa)
  const active = snapshot?.engineWarnings?.oilPressure === true || (pressure != null && pressure <= 140)
  if (!active) return empty(w, h)
  return warningLamp({ width: w, height: h, color: RED, label: 'OIL KPA', value: fixed(pressure, 0), unit: 'KPA', icon: '!' })
}

function Alert2BadSurface({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const w = width ?? 420
  const h = height ?? 190
  const label = trackSurfaceMaterialLabel(num(snapshot?.trackSurfaceMaterial))
  const active = label != null && !['asphalt', 'concrete', 'paint', 'kerb'].includes(label)
  if (!active) return empty(w, h)
  return warningLamp({ width: w, height: h, color: AMBER, label: 'SURFACE', value: label.toUpperCase(), icon: '!' })
}

function Alert2BlueFlag({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const w = width ?? 360
  const h = height ?? 210
  if (snapshot?.flags?.blue !== true) return empty(w, h)
  return (
    <CleanTile width={w} height={h}>
      <defs>
        <filter id="alerts2-blue-flag-glow" x="-50%" y="-70%" width="200%" height="240%">
          <feDropShadow dx="0" dy="0" stdDeviation="5" floodColor={BLUE} floodOpacity="0.95" />
          <feDropShadow dx="0" dy="0" stdDeviation="16" floodColor={BLUE} floodOpacity="0.5" />
        </filter>
      </defs>
      <g filter="url(#alerts2-blue-flag-glow)">
        <path d="M64 38 C124 54 154 78 214 72 C246 69 274 78 306 96 L306 176 C268 160 234 150 190 154 C144 158 108 142 64 136 Z" fill={BLUE} />
        <path d="M86 48 C112 82 112 112 88 136 M150 68 C178 98 176 128 158 154 M224 75 C252 104 254 132 236 160" fill="none" stroke="rgba(255,255,255,0.32)" strokeWidth="8" />
        <text x="180" y="122" textAnchor="middle" fill={WHITE} fontFamily={FONT_LABEL} fontSize="46" fontWeight="900" letterSpacing="5" {...legibleStroke(46)}>
          BLUE FLAG
        </text>
      </g>
    </CleanTile>
  )
}

function Alert2TyreTempCritical({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const w = width ?? 380
  const h = height ?? 200
  const hottest = hottestTyre(snapshot)
  if (!hottest || hottest.temp < 115) return empty(w, h)
  return (
    <CleanTile width={w} height={h}>
      <defs>
        <filter id="alerts2-tyre-temp-glow" x="-50%" y="-70%" width="200%" height="240%">
          <feDropShadow dx="0" dy="0" stdDeviation="5" floodColor={RED} floodOpacity="0.9" />
          <feDropShadow dx="0" dy="0" stdDeviation="15" floodColor={RED} floodOpacity="0.45" />
        </filter>
      </defs>
      <g filter="url(#alerts2-tyre-temp-glow)">
        <ellipse cx="78" cy="102" rx="44" ry="66" fill="none" stroke={RED} strokeWidth="16" />
        <ellipse cx="78" cy="102" rx="20" ry="36" fill="rgba(0,0,0,0.34)" stroke={AMBER} strokeWidth="5" />
        <text x="238" y="70" textAnchor="middle" fill={RED} fontFamily={FONT_LABEL} fontSize="34" fontWeight="900" letterSpacing="4" {...legibleStroke(34)}>
          TYRE TEMP
        </text>
        <text x="238" y="140" textAnchor="middle" fill={WHITE} fontFamily={FONT_NUM} fontSize="72" fontWeight="900" letterSpacing="-2" {...legibleStroke(72)}>
          {hottest.corner} {fixed(hottest.temp, 0)}<tspan fill={RED} fontFamily={FONT_LABEL} fontSize="28"> C</tspan>
        </text>
        <Bar x={150} y={162} w={176} h={14} f={frac(hottest.temp, 90, 130)} color={RED} />
      </g>
    </CleanTile>
  )
}

function Alert2BrakePressureLow({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const w = width ?? 420
  const h = height ?? 190
  const brake = num(snapshot?.brake)
  const values = brakeLineValues(snapshot)
  const maxPressure = values.length > 0 ? Math.max(...values) : undefined
  const active = brake != null && brake >= 0.35 && maxPressure != null && maxPressure < 25
  if (!active) return empty(w, h)
  return warningLamp({ width: w, height: h, color: AMBER, label: 'BRAKE BAR', value: fixed(maxPressure, 0), unit: 'BAR', icon: '!' })
}

export const alert2EngineWarningWidget: HifiWidgetModule = {
  id: 'alert2EngineWarning',
  title: 'Alert2 Engine Warning',
  description: 'Trigger-only red engine warning lamp gated by decoded engine tell-tales.',
  category: 'alerts2',
  tags: ['alert', 'trigger', 'clean', 'engine', 'warning'],
  requires: ['engineWarnings'],
  defaultSize: { w: 380, h: 190 },
  defaultTrigger: { kind: 'always' },
  render: Alert2EngineWarning
}

export const alert2WaterTempCriticalWidget: HifiWidgetModule = {
  id: 'alert2WaterTempCritical',
  title: 'Alert2 Water Temp Critical',
  description: 'Trigger-only coolant overheat overlay using water temperature and tell-tale state.',
  category: 'alerts2',
  tags: ['alert', 'trigger', 'clean', 'water', 'temperature'],
  requires: ['waterTempC', 'engineWarnings'],
  defaultSize: { w: 360, h: 190 },
  defaultTrigger: { kind: 'always' },
  render: Alert2WaterTempCritical
}

export const alert2OilTempCriticalWidget: HifiWidgetModule = {
  id: 'alert2OilTempCritical',
  title: 'Alert2 Oil Temp Critical',
  description: 'Trigger-only oil overheat overlay using oil temperature and tell-tale state.',
  category: 'alerts2',
  tags: ['alert', 'trigger', 'clean', 'oil', 'temperature'],
  requires: ['oilTempC', 'engineWarnings'],
  defaultSize: { w: 360, h: 190 },
  defaultTrigger: { kind: 'always' },
  render: Alert2OilTempCritical
}

export const alert2OilPressureLowWidget: HifiWidgetModule = {
  id: 'alert2OilPressureLow',
  title: 'Alert2 Oil Pressure Low',
  description: 'Trigger-only low oil-pressure overlay using pressure telemetry and tell-tale state.',
  category: 'alerts2',
  tags: ['alert', 'trigger', 'clean', 'oil', 'pressure'],
  requires: ['oilPressureKpa', 'engineWarnings'],
  defaultSize: { w: 380, h: 190 },
  defaultTrigger: { kind: 'always' },
  render: Alert2OilPressureLow
}

export const alert2BadSurfaceWidget: HifiWidgetModule = {
  id: 'alert2BadSurface',
  title: 'Alert2 Bad Surface',
  description: 'Trigger-only off-track/bad-surface warning for grass, dirt, sand, gravel, or astroturf.',
  category: 'alerts2',
  tags: ['alert', 'trigger', 'clean', 'surface', 'off-track'],
  requires: ['trackSurfaceMaterial'],
  defaultSize: { w: 420, h: 190 },
  defaultTrigger: { kind: 'always' },
  render: Alert2BadSurface
}

export const alert2BlueFlagWidget: HifiWidgetModule = {
  id: 'alert2BlueFlag',
  title: 'Alert2 Blue Flag',
  description: 'Trigger-only blue-flag approaching overlay from race-control flags.',
  category: 'alerts2',
  tags: ['alert', 'trigger', 'clean', 'flag', 'blue-flag'],
  requires: ['flags'],
  defaultSize: { w: 360, h: 210 },
  defaultTrigger: { kind: 'flag' },
  render: Alert2BlueFlag
}

export const alert2TyreTempCriticalWidget: HifiWidgetModule = {
  id: 'alert2TyreTempCritical',
  title: 'Alert2 Tyre Temp Critical',
  description: 'Trigger-only tyre overheat overlay for the hottest live tyre channel.',
  category: 'alerts2',
  tags: ['alert', 'trigger', 'clean', 'tyre', 'temperature'],
  requires: ['tyres'],
  defaultSize: { w: 380, h: 200 },
  defaultTrigger: { kind: 'always' },
  render: Alert2TyreTempCritical
}

export const alert2BrakePressureLowWidget: HifiWidgetModule = {
  id: 'alert2BrakePressureLow',
  title: 'Alert2 Brake Pressure Low',
  description: 'Trigger-only low hydraulic brake-line pressure overlay while the brake pedal is applied.',
  category: 'alerts2',
  tags: ['alert', 'trigger', 'clean', 'brake', 'pressure'],
  requires: ['brake', 'brakeLinePressBar'],
  defaultSize: { w: 420, h: 190 },
  defaultTrigger: { kind: 'always' },
  render: Alert2BrakePressureLow
}
