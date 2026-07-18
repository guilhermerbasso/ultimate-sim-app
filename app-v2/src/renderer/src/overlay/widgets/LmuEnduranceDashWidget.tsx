// LmuEnduranceDashWidget — full-frame endurance "race-engineer" dashboard, rebuilt on
// the v2.39 instrument KIT. One root <svg> (fixed viewBox + preserveAspectRatio); the
// shift band is the shared RevLedBar, the gear hero is auto-fit FitText, and every other
// readout is a DataField — so no value is ever sized from an element's height via CSS
// clamp() (the old overflow bug). Skin-token only so a per-dashboard skin swap works.
// Pure & presentational: a null/partial snapshot degrades each readout to "—" and never
// emits NaN / undefined / Infinity. Metric units throughout.
import type { ReactElement } from 'react'
import type { TelemetrySnapshot, TyreInfo } from '../../../../shared/telemetry'
import type { WidgetProps } from './types'
import { formatGear, formatTime, formatDelta, pct } from './format'
import { resolveSkin, FitText, type SkinToken } from '../../skins'
import { RevLedBar, DataField, type FieldState } from '../../instruments'
import { formatMeasurement } from '../../../../shared/units'
import { useUnitSystem } from '../../lib/units'
import { atShiftPoint } from '../../lib/rev-lights'

export const LMU_ENDURANCE_DASH_STREAM_SAFE = true

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

function fmtLevel(v: number | string | undefined): string {
  if (v === undefined || v === null) return '—'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '—'
  const t = v.trim()
  return t.length ? t : '—'
}

function tempState(c: number | undefined, warn: number, crit: number, cold?: number): FieldState {
  if (c === undefined || !Number.isFinite(c)) return 'normal'
  if (c >= crit) return 'crit'
  if (c >= warn) return 'warn'
  if (cold !== undefined && c < cold) return 'info'
  return 'normal'
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
  if (f?.red) return { text: 'RED FLAG', state: 'crit' }
  if (f?.yellow) return { text: 'FULL COURSE YELLOW', state: 'warn' }
  if (f?.blue) return { text: 'BLUE FLAG', state: 'info' }
  if (f?.checkered) return { text: 'CHEQUERED', state: 'normal' }
  if (f?.greenWhiteCheckered) return { text: 'GREEN WHITE CHEQUER', state: 'ok' }
  if (f?.green) return { text: 'GREEN', state: 'ok' }
  const st = s?.sessionType?.trim()
  return { text: st && st.length ? st.toUpperCase() : 'RUNNING', state: 'ok' }
}

function isLowFuel(s: TelemetrySnapshot | null): boolean {
  if (!s) return false
  const frac = s.fuelCapacityLiters && s.fuelCapacityLiters > 0 ? (s.fuelLiters ?? 0) / s.fuelCapacityLiters : undefined
  return (s.fuelLiters !== undefined && Number.isFinite(s.fuelLiters) && s.fuelLiters < 5) || (frac !== undefined && frac < 0.08)
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

function tC(t: TyreInfo | undefined): number | undefined {
  return t?.tempC
}

export function LmuEnduranceDashWidget({ snapshot, config }: WidgetProps): ReactElement {
  const unitSystem = useUnitSystem()
  const s = snapshot
  const skin = resolveSkin('gt3', 'generic')
  const { palette } = skin
  const { W, H } = dims(config)

  const P = Math.max(8, Math.round(Math.min(W, H) * 0.02))
  const G = Math.max(4, Math.round(Math.min(W, H) * 0.014))

  const rawShift = s?.shiftIndicatorPct ?? (s?.maxRpm ? (s?.rpm ?? 0) / s.maxRpm : undefined)
  const shiftPct = pct(rawShift)
  const redline = atShiftPoint(shiftPct, s?.revLights?.blink, 0.95)
  const gear = formatGear(s?.gear)
  const flag = flagStateFor(s)
  const lowFuel = isLowFuel(s)
  const ty = s?.tyres
  const bt = s?.brakeTempC
  const delta = s?.deltaToBestSec
  const deltaState: FieldState = delta !== undefined && Number.isFinite(delta) && delta <= 0 ? 'ok' : 'warn'
  const temp = (value: number | undefined) => formatMeasurement(value, 'temperature-c', unitSystem, { decimals: 0 })
  const tempUnit = temp(undefined).unit
  const speed = formatMeasurement(s?.speedKmh, 'speed-kmh', unitSystem, { decimals: 0 })
  const fuel = formatMeasurement(s?.fuelLiters, 'fuel-volume-l', unitSystem, { decimals: 1 })
  const fuelPerLap = formatMeasurement(s?.fuelPerLap, 'fuel-per-lap-l', unitSystem, { decimals: 2 })

  const ledH = Math.max(26, Math.round(H * 0.06))
  const topH = Math.max(48, Math.round(H * 0.1))
  const botH = Math.max(56, Math.round(H * 0.16))
  const ledY = P
  const topY = ledY + ledH + G
  const cTop = topY + topH + G
  const botY = H - P - botH
  const cBot = botY - G
  const cH = cBot - cTop
  const innerW = W - 2 * P

  // Top strip: SESSION | flag banner | LAP | POS
  const tsW = innerW
  const sessW = tsW * 0.24
  const lapW = tsW * 0.13
  const posW = tsW * 0.13
  const bannerW = tsW - sessW - lapW - posW - 3 * G
  const tsx = { sess: P, banner: P + sessW + G, lap: P + sessW + G + bannerW + G, pos: P + sessW + G + bannerW + G + lapW + G }

  // Columns
  const leftW = innerW * 0.3
  const rightW = innerW * 0.3
  const midW = innerW - leftW - rightW - 2 * G
  const leftX = P
  const midX = leftX + leftW + G
  const rightX = midX + midW + G

  // Left: two labelled 2×2 grids (tyre °C, brake °C)
  const grpH = (cH - G) / 2
  const grpHeadH = Math.max(16, grpH * 0.2)
  const cellGridH = grpH - grpHeadH
  const cw = (leftW - G) / 2
  const chh = (cellGridH - G) / 2

  const grid2x2 = (gx: number, gy: number, cells: Array<{ label: string; value: string; state: FieldState }>): ReactElement[] => {
    const pos = [
      { x: gx, y: gy },
      { x: gx + cw + G, y: gy },
      { x: gx, y: gy + chh + G },
      { x: gx + cw + G, y: gy + chh + G }
    ]
    return cells.map((c, i) => (
      <DataField key={c.label} x={pos[i].x} y={pos[i].y} width={cw} height={chh} label={c.label} value={c.value} unit={tempUnit} state={c.state} ghost={false} skin={skin} />
    ))
  }

  const sectionHeader = (hx: number, hy: number, hw: number, text: string): ReactElement => (
    <FitText x={hx + hw / 2} y={hy + grpHeadH / 2} boxW={hw * 0.9} boxH={grpHeadH * 0.8} text={text} anchor="middle" baseline="middle" fontFamily={skin.typography.label} fill={palette.textDim} minFontPx={11} maxFontPx={Math.max(12, grpHeadH * 0.7)} weight={700} letterSpacing={2} />
  )

  // Centre: RPM field, big gear, speed
  const midRpmH = cH * 0.16
  const midGearY = cTop + midRpmH + G
  const midSpeedH = cH * 0.24
  const midGearH = cBot - midSpeedH - G - midGearY
  const midCx = midX + midW / 2

  // Right: LAST/BEST/DELTA stacked
  const rGap = G
  const rH = (cH - 2 * rGap) / 3

  // Bottom strip 7 fields
  const bCells = 7
  const bW = (innerW - G * (bCells - 1)) / bCells
  const bx = (i: number): number => P + i * (bW + G)

  const df = (
    x: number, y: number, w: number, h: number,
    label: string, value: string, st: FieldState = 'normal', unit?: string
  ): ReactElement => (
    <DataField x={x} y={y} width={w} height={h} label={label} value={value} unit={unit} state={st} ghost={false} skin={skin} />
  )

  return (
    <div className="overlay-card dr-root rd-lmu-endurance" data-overlay-id={config?.id} data-widget="lmuEnduranceDash" style={{ width: '100%', height: '100%', overflow: 'hidden', background: palette.bg }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" width="100%" height="100%" style={{ display: 'block' }}>
        <rect x={0} y={0} width={W} height={H} fill={palette.bg} />

        <RevLedBar pct={shiftPct} profile={skin.led} x={P} y={ledY} width={innerW} height={ledH} shiftActive={redline} />

        {/* Top strip */}
        {df(tsx.sess, topY, sessW, topH, 'SESSION', (s?.sessionType?.trim() || '—').toUpperCase())}
        <rect x={tsx.banner} y={topY} width={bannerW} height={topH} rx={skin.material.radius} fill={skin.material.base} stroke={stateColor(flag.state, skin)} strokeWidth={skin.material.borderWidth} />
        <FitText x={tsx.banner + bannerW / 2} y={topY + topH / 2} boxW={bannerW * 0.92} boxH={topH * 0.6} text={flag.text} anchor="middle" baseline="middle" fontFamily={skin.typography.label} fill={stateColor(flag.state, skin)} minFontPx={12} maxFontPx={Math.max(14, topH * 0.5)} weight={700} letterSpacing={2} overflowStrategy="squeeze" />
        {df(tsx.lap, topY, lapW, topH, 'LAP', n0(s?.currentLap), 'accent')}
        {df(tsx.pos, topY, posW, topH, 'POS', positionText(s), 'accent')}

        {/* Left: tyre + brake temps */}
        {sectionHeader(leftX, cTop, leftW, `TYRE ${tempUnit}`)}
        {grid2x2(leftX, cTop + grpHeadH, [
          { label: 'LF', value: temp(tC(ty?.lf)).display, state: tempState(tC(ty?.lf), 100, 110, 70) },
          { label: 'RF', value: temp(tC(ty?.rf)).display, state: tempState(tC(ty?.rf), 100, 110, 70) },
          { label: 'LR', value: temp(tC(ty?.lr)).display, state: tempState(tC(ty?.lr), 100, 110, 70) },
          { label: 'RR', value: temp(tC(ty?.rr)).display, state: tempState(tC(ty?.rr), 100, 110, 70) }
        ])}
        {sectionHeader(leftX, cTop + grpH + G, leftW, `BRAKE ${tempUnit}`)}
        {grid2x2(leftX, cTop + grpH + G + grpHeadH, [
          { label: 'LF', value: temp(bt?.lf).display, state: tempState(bt?.lf, 550, 650, 250) },
          { label: 'RF', value: temp(bt?.rf).display, state: tempState(bt?.rf, 550, 650, 250) },
          { label: 'LR', value: temp(bt?.lr).display, state: tempState(bt?.lr, 550, 650, 250) },
          { label: 'RR', value: temp(bt?.rr).display, state: tempState(bt?.rr, 550, 650, 250) }
        ])}

        {/* Centre: RPM, GEAR, SPEED */}
        {df(midX, cTop, midW, midRpmH, 'RPM', n0(s?.rpm), redline ? 'crit' : 'normal')}
        <rect x={midX} y={midGearY} width={midW} height={midGearH} rx={skin.material.radius} fill={palette.bg} stroke={redline ? palette.crit : palette.accent} strokeWidth={skin.material.borderWidth} />
        <FitText x={midCx} y={midGearY + midGearH * 0.16} boxW={midW * 0.7} boxH={midGearH * 0.16} text="GEAR" anchor="middle" baseline="middle" fontFamily={skin.typography.label} fill={palette.textDim} minFontPx={11} maxFontPx={Math.max(12, midGearH * 0.12)} weight={700} letterSpacing={4} />
        <FitText x={midCx} y={midGearY + midGearH * 0.58} boxW={midW * 0.6} boxH={midGearH * 0.64} text={gear} anchor="middle" baseline="middle" fontFamily={/^\d$/.test(gear) ? skin.segment.numeric : skin.segment.alpha} fill={redline ? palette.crit : palette.text} minFontPx={24} maxFontPx={midGearH * 0.64} />
        {df(midX, cBot - midSpeedH, midW, midSpeedH, 'SPEED', speed.display, 'accent', speed.unit.toUpperCase())}

        {/* Right: LAST / BEST / DELTA */}
        {df(rightX, cTop, rightW, rH, 'LAST', formatTime(s?.lastLapTimeSec))}
        {df(rightX, cTop + rH + rGap, rightW, rH, 'BEST', formatTime(s?.bestLapTimeSec), 'info')}
        {df(rightX, cTop + 2 * (rH + rGap), rightW, rH, 'DELTA', formatDelta(delta), deltaState, 's')}

        {/* Bottom strip */}
        {df(bx(0), botY, bW, botH, 'FUEL', fuel.display, lowFuel ? 'crit' : 'ok', fuel.unit)}
        {df(bx(1), botY, bW, botH, 'FUEL/LAP', fuelPerLap.display, 'normal', fuelPerLap.unit)}
        {df(bx(2), botY, bW, botH, 'LAPS LEFT', n0(s?.lapsRemaining), 'accent')}
        {df(bx(3), botY, bW, botH, 'STINT', formatClock(s?.sessionTimeRemainingSec))}
        {df(bx(4), botY, bW, botH, 'ABS', fmtLevel(s?.absLevel))}
        {df(bx(5), botY, bW, botH, 'TC', fmtLevel(s?.tcLevel))}
        {df(bx(6), botY, bW, botH, 'BBAL', n1(s?.brakeBiasPct), 'warn', '%')}
      </svg>
    </div>
  )
}
