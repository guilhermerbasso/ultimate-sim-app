// LmuStintDashWidget — full-frame endurance STRATEGY board (fuel & stint focused),
// rebuilt on the v2.39 instrument KIT. One root <svg> (fixed viewBox + preserveAspect-
// Ratio); the headline fuel level is auto-fit FitText, the fuel-level bar is the shared
// BarGraph, and every surrounding datum is a DataField — nothing is sized from an
// element's height via CSS clamp() (the old overflow bug). Skin-token only so a per-
// dashboard skin swap works. Pure & presentational: a null/partial snapshot degrades
// each readout to "—" and never emits NaN / undefined / Infinity. Metric units.
import type { ReactElement } from 'react'
import type { TelemetrySnapshot, TyreInfo } from '../../../../shared/telemetry'
import type { WidgetProps } from './types'
import { formatTime, formatDelta } from './format'
import { resolveSkin, FitText, type SkinToken } from '../../skins'
import { BarGraph, DataField, type FieldState } from '../../instruments'
import { formatMeasurement } from '../../../../shared/units'
import { useUnitSystem } from '../../lib/units'

export const LMU_STINT_DASH_STREAM_SAFE = true

function dims(config: WidgetProps['config']): { W: number; H: number } {
  const w = config?.position?.width
  const h = config?.position?.height
  return {
    W: typeof w === 'number' && w > 0 ? w : 1024,
    H: typeof h === 'number' && h > 0 ? h : 600
  }
}

function n0(v: number | undefined): string {
  return v === undefined || !Number.isFinite(v) ? '—' : String(Math.round(v))
}
function n1(v: number | undefined): string {
  return v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(1)
}
function n2(v: number | undefined): string {
  return v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(2)
}

function formatClock(sec: number | undefined): string {
  if (sec === undefined || !Number.isFinite(sec)) return '—'
  const total = Math.max(0, Math.floor(sec))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`
}

function lapsToEmpty(fuel: number | undefined, perLap: number | undefined): number | undefined {
  if (fuel === undefined || !Number.isFinite(fuel)) return undefined
  if (perLap === undefined || !Number.isFinite(perLap) || perLap <= 0) return undefined
  return fuel / perLap
}

function fuelFraction(s: TelemetrySnapshot | null): number | undefined {
  const f = s?.fuelLiters
  const cap = s?.fuelCapacityLiters
  if (f === undefined || !Number.isFinite(f) || cap === undefined || !Number.isFinite(cap) || cap <= 0) return undefined
  return Math.max(0, Math.min(1, f / cap))
}

function isLowFuel(s: TelemetrySnapshot | null): boolean {
  if (!s) return false
  const frac = fuelFraction(s)
  return (s.fuelLiters !== undefined && Number.isFinite(s.fuelLiters) && s.fuelLiters < 5) || (frac !== undefined && frac < 0.08)
}

function lifePct(v: number | undefined): number | undefined {
  if (v === undefined || !Number.isFinite(v)) return undefined
  return v <= 1 ? v * 100 : v
}
function wearState(life: number | undefined): FieldState {
  if (life === undefined || !Number.isFinite(life)) return 'normal'
  if (life <= 30) return 'crit'
  if (life <= 55) return 'warn'
  return 'ok'
}

function wetnessPct(s: TelemetrySnapshot | null): number | undefined {
  const w = s?.trackWetnessPct
  if (w === undefined || !Number.isFinite(w)) return undefined
  return Math.max(0, Math.min(1, w)) * 100
}

function positionText(s: TelemetrySnapshot | null): string {
  const p = s?.position
  if (p === undefined || !Number.isFinite(p)) return '—'
  const total = s?.totalCars
  return total !== undefined && Number.isFinite(total) ? `P${p}/${total}` : `P${p}`
}

interface FlagState {
  text: string
  state: FieldState
}
function flagStateFor(s: TelemetrySnapshot | null): FlagState {
  const f = s?.flags
  if (f?.red) return { text: 'RED', state: 'crit' }
  if (f?.yellow) return { text: 'FCY', state: 'warn' }
  if (f?.blue) return { text: 'BLUE', state: 'info' }
  if (f?.checkered) return { text: 'CHEQUER', state: 'normal' }
  if (f?.greenWhiteCheckered) return { text: 'GWC', state: 'ok' }
  if (f?.green) return { text: 'GREEN', state: 'ok' }
  return { text: 'GREEN', state: 'ok' }
}

function stateColor(state: FieldState, skin: SkinToken): string {
  const p = skin.palette
  return state === 'ok'
    ? p.ok
    : state === 'warn'
      ? p.warn
      : state === 'crit'
        ? p.crit
        : state === 'info'
          ? p.info
          : state === 'accent'
            ? p.accent
            : p.textDim
}

function wearOf(t: TyreInfo | undefined): number | undefined {
  return lifePct(t?.wearPct)
}

export function LmuStintDashWidget({ snapshot, config }: WidgetProps): ReactElement {
  const unitSystem = useUnitSystem()
  const s = snapshot
  const skin = resolveSkin('gt3', 'generic')
  const { palette } = skin
  const { W, H } = dims(config)

  const P = Math.max(8, Math.round(Math.min(W, H) * 0.02))
  const G = Math.max(4, Math.round(Math.min(W, H) * 0.014))

  const flag = flagStateFor(s)
  const lowFuel = isLowFuel(s)
  const frac = fuelFraction(s)
  const toEmpty = lapsToEmpty(s?.fuelLiters, s?.fuelPerLap)
  const toEmptyState: FieldState = toEmpty !== undefined && toEmpty < 3 ? 'crit' : toEmpty !== undefined && toEmpty < 6 ? 'warn' : 'ok'
  const ty = s?.tyres
  const wet = wetnessPct(s)
  const wetState: FieldState = wet !== undefined && wet > 5 ? 'warn' : 'info'
  const fuel = formatMeasurement(s?.fuelLiters, 'fuel-volume-l', unitSystem, { decimals: 1 })
  const fuelPerLap = formatMeasurement(s?.fuelPerLap, 'fuel-per-lap-l', unitSystem, { decimals: 2 })
  const air = formatMeasurement(s?.airTempC, 'temperature-c', unitSystem, { decimals: 0 })
  const track = formatMeasurement(s?.trackTempC, 'temperature-c', unitSystem, { decimals: 0 })

  const topH = Math.max(52, Math.round(H * 0.13))
  const topY = P
  const mainTop = topY + topH + G
  const mainBot = H - P
  const mainH = mainBot - mainTop
  const innerW = W - 2 * P

  // Top strip: SESSION | POS | flag | STINT LEFT
  const sessW = innerW * 0.32
  const posW = innerW * 0.16
  const flagW = innerW * 0.18
  const stintW = innerW - sessW - posW - flagW - 3 * G
  const t0 = P
  const t1 = t0 + sessW + G
  const t2 = t1 + posW + G
  const t3 = t2 + flagW + G

  // Columns
  const leftW = innerW * 0.36
  const midW = innerW * 0.34
  const rightW = innerW - leftW - midW - 2 * G
  const leftX = P
  const midX = leftX + leftW + G
  const rightX = midX + midW + G

  // Left: fuel block + (laps-to-empty | fuel/lap)
  const fuelBlockH = mainH * 0.56
  const fuelRowY = mainTop + fuelBlockH + G
  const fuelRowH = mainH - fuelBlockH - G
  const fbPad = Math.max(8, leftW * 0.06)
  const fuelColorState: FieldState = lowFuel ? 'crit' : 'accent'

  // Centre: tyre wear 2×2 + (AIR | TRACK | WET)
  const wearHeadH = Math.max(16, mainH * 0.09)
  const wearGridH = mainH * 0.5
  const wearGridY = mainTop + wearHeadH
  const condY = wearGridY + wearGridH + G
  const condH = mainBot - condY
  const cw = (midW - G) / 2
  const chh = (wearGridH - G) / 2
  const condW = (midW - 2 * G) / 3

  // Right: AHEAD | BEHIND | LAST | BEST
  const rGap = G
  const rH = (mainH - 3 * rGap) / 4

  const df = (
    x: number, y: number, w: number, h: number,
    label: string, value: string, st: FieldState = 'normal', unit?: string
  ): ReactElement => (
    <DataField x={x} y={y} width={w} height={h} label={label} value={value} unit={unit} state={st} ghost={false} skin={skin} />
  )

  return (
    <div className="overlay-card dr-root rd-lmu-stint" data-overlay-id={config?.id} data-widget="lmuStintDash" style={{ width: '100%', height: '100%', overflow: 'hidden', background: palette.bg }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" width="100%" height="100%" style={{ display: 'block' }}>
        <rect x={0} y={0} width={W} height={H} fill={palette.bg} />

        {/* Top strip */}
        {df(t0, topY, sessW, topH, 'SESSION', (s?.sessionType?.trim() || '—').toUpperCase())}
        {df(t1, topY, posW, topH, 'POS', positionText(s), 'accent')}
        <rect x={t2} y={topY} width={flagW} height={topH} rx={skin.material.radius} fill={skin.material.base} stroke={stateColor(flag.state, skin)} strokeWidth={skin.material.borderWidth} />
        <FitText x={t2 + flagW / 2} y={topY + topH / 2} boxW={flagW * 0.9} boxH={topH * 0.6} text={flag.text} anchor="middle" baseline="middle" fontFamily={skin.typography.label} fill={stateColor(flag.state, skin)} minFontPx={12} maxFontPx={Math.max(14, topH * 0.5)} weight={700} letterSpacing={2} overflowStrategy="squeeze" />
        {df(t3, topY, stintW, topH, 'STINT LEFT', formatClock(s?.sessionTimeRemainingSec), 'accent')}

        {/* Left: headline FUEL block */}
        <rect x={leftX} y={mainTop} width={leftW} height={fuelBlockH} rx={skin.material.radius} fill={skin.material.base} stroke={lowFuel ? palette.crit : palette.accent} strokeWidth={skin.material.borderWidth} />
        <FitText x={leftX + fbPad} y={mainTop + fuelBlockH * 0.16} boxW={leftW * 0.6} boxH={fuelBlockH * 0.14} text="FUEL LEFT" anchor="start" baseline="middle" fontFamily={skin.typography.label} fill={lowFuel ? palette.crit : palette.accent} minFontPx={11} maxFontPx={Math.max(12, fuelBlockH * 0.12)} weight={700} letterSpacing={2} />
        <FitText x={leftX + leftW / 2} y={mainTop + fuelBlockH * 0.44} boxW={leftW * 0.82} boxH={fuelBlockH * 0.34} text={fuel.display} anchor="middle" baseline="middle" fontFamily={skin.segment.numeric} fill={lowFuel ? palette.crit : palette.text} minFontPx={24} maxFontPx={fuelBlockH * 0.34} />
        <FitText x={leftX + leftW / 2} y={mainTop + fuelBlockH * 0.65} boxW={leftW * 0.55} boxH={fuelBlockH * 0.1} text={fuel.unit} anchor="middle" baseline="middle" fontFamily={skin.typography.label} fill={palette.textDim} minFontPx={11} maxFontPx={fuelBlockH * 0.09} />
        <BarGraph x={leftX + fbPad} y={mainTop + fuelBlockH * 0.76} width={leftW - 2 * fbPad} height={fuelBlockH * 0.16} fraction={frac ?? 0} warnAt={0.15} critAt={0.08} invert skin={skin} />
        {df(leftX, fuelRowY, (leftW - G) / 2, fuelRowH, 'LAPS EMPTY', n1(toEmpty), toEmptyState)}
        {df(leftX + (leftW - G) / 2 + G, fuelRowY, (leftW - G) / 2, fuelRowH, 'FUEL/LAP', fuelPerLap.display, 'normal', fuelPerLap.unit)}

        {/* Centre: tyre wear + conditions */}
        <FitText x={midX + midW / 2} y={mainTop + wearHeadH / 2} boxW={midW * 0.9} boxH={wearHeadH * 0.8} text="TYRE WEAR %" anchor="middle" baseline="middle" fontFamily={skin.typography.label} fill={palette.textDim} minFontPx={11} maxFontPx={Math.max(12, wearHeadH * 0.7)} weight={700} letterSpacing={2} />
        {df(midX, wearGridY, cw, chh, 'LF', n0(wearOf(ty?.lf)), wearState(wearOf(ty?.lf)), '%')}
        {df(midX + cw + G, wearGridY, cw, chh, 'RF', n0(wearOf(ty?.rf)), wearState(wearOf(ty?.rf)), '%')}
        {df(midX, wearGridY + chh + G, cw, chh, 'LR', n0(wearOf(ty?.lr)), wearState(wearOf(ty?.lr)), '%')}
        {df(midX + cw + G, wearGridY + chh + G, cw, chh, 'RR', n0(wearOf(ty?.rr)), wearState(wearOf(ty?.rr)), '%')}
        {df(midX, condY, condW, condH, 'AIR', air.display, 'info', air.unit)}
        {df(midX + condW + G, condY, condW, condH, 'TRACK', track.display, 'warn', track.unit)}
        {df(midX + 2 * (condW + G), condY, condW, condH, 'WET', n0(wet), wetState, '%')}

        {/* Right: running order + reference laps */}
        {df(rightX, mainTop, rightW, rH, 'AHEAD', formatDelta(s?.relatives?.ahead?.gapSec), 'accent', 's')}
        {df(rightX, mainTop + rH + rGap, rightW, rH, 'BEHIND', formatDelta(s?.relatives?.behind?.gapSec), 'normal', 's')}
        {df(rightX, mainTop + 2 * (rH + rGap), rightW, rH, 'LAST LAP', formatTime(s?.lastLapTimeSec))}
        {df(rightX, mainTop + 3 * (rH + rGap), rightW, rH, 'BEST LAP', formatTime(s?.bestLapTimeSec), 'accent')}
      </svg>
    </div>
  )
}
