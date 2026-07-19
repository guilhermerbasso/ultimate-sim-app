// Full-frame GT3 dashboard in the visual language of a neon Bosch GT3 wheel display,
// rebuilt on the v2.39 instrument KIT so telemetry can NEVER overflow: one root <svg>
// with a fixed viewBox + preserveAspectRatio; every value routed through FitText /
// DataField / RevLedBar (auto-fit SVG text) instead of element-height CSS clamp()
// fonts (the specific bug that made the old div grid overflow).
//
// Anatomy (real DDU): top blue-redline RevLedBar; RPM · SESSION banner · TIME strip;
// left column water/oil temps + tyre temps; big central GEAR + SPEED; right column
// last/delta/fuel/laps + a 2×2 of ahead/behind/pos/inc; bottom strip TC/ABS/MAP/BIAS/
// AIR/TRACK. Brand-neutral, skin-token only. Null/partial snapshot degrades to "—".
import type { ReactElement } from 'react'
import './dashboard-replicas.css'
import type { TyreInfo } from '../../../../shared/telemetry'
import type { WidgetProps } from './types'
import { formatDelta, formatGear, formatTime } from './format'
import { resolveSkin, FitText, type SkinToken } from '../../skins'
import { RevLedBar, DataField, type FieldState } from '../../instruments'
import { formatMeasurement } from '../../../../shared/units'
import { useUnitSystem } from '../../lib/units'
import { atShiftPoint, resolveRevLightPct } from '../../lib/rev-lights'

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

function tempState(c: number | undefined, warn: number, crit: number, cold?: number): FieldState {
  if (c === undefined || !Number.isFinite(c)) return 'normal'
  if (c >= crit) return 'crit'
  if (c >= warn) return 'warn'
  if (cold !== undefined && c < cold) return 'info'
  return 'normal'
}

function fmtLevel(v: number | string | undefined): string {
  if (v === undefined || v === null) return '—'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '—'
  const t = String(v).trim()
  return t.length ? t : '—'
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

function gapStr(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return '—'
  return formatDelta(seconds)
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

function vstack(x: number, y: number, w: number, h: number, count: number, gap: number): Array<{ x: number; y: number; w: number; h: number }> {
  const n = Math.max(1, count)
  const ch = (h - gap * (n - 1)) / n
  return Array.from({ length: n }, (_, i) => ({ x, y: y + i * (ch + gap), w, h: ch }))
}

function tempC(t: TyreInfo | undefined): number | undefined {
  return t?.tempC
}

export function GridProDashWidget({ snapshot, config }: WidgetProps): ReactElement {
  const unitSystem = useUnitSystem()
  const s = snapshot
  const skin = resolveSkin('gt3', 'generic')
  const { palette, segment } = skin
  const { W, H } = dims(config)

  const P = Math.max(6, Math.round(Math.min(W, H) * 0.02))
  const G = Math.max(4, Math.round(Math.min(W, H) * 0.014))

  const shiftPct = resolveRevLightPct(s)
  const redline = atShiftPoint(shiftPct, s?.revLights?.blink, 0.95)
  const gear = formatGear(s?.gear)
  const sessionLabel = (s?.sessionType && s.sessionType.length > 0 ? s.sessionType : 'TESTING').toUpperCase()

  const revH = Math.max(22, Math.min(48, Math.round(H * 0.08)))
  const stripY0 = P + revH + G
  const stripH0 = Math.max(46, Math.min(84, Math.round(H * 0.13)))
  const botH = Math.max(52, Math.min(112, Math.round(H * 0.16)))
  const cTop = stripY0 + stripH0 + G
  const cBot = H - P - botH - G
  const cH = cBot - cTop

  const sideW = Math.max(150, Math.min(300, Math.round(W * 0.26)))
  const leftX = P
  const rightX = W - P - sideW
  const midX = leftX + sideW + G
  const midW = rightX - G - midX

  const leftTopH = cH * 0.4
  const leftBotY = cTop + leftTopH + G
  const leftBotH = cBot - leftBotY
  const [waterR, oilR] = vstack(leftX, cTop, sideW, leftTopH, 2, G)
  const tCellW = (sideW - G) / 2
  const tCellH = (leftBotH - G) / 2
  const ty = s?.tyres

  const rightTopH = cH * 0.52
  const rightBotY = cTop + rightTopH + G
  const rightBotH = cBot - rightBotY
  const [lastR, deltaR, fuelR, lapsR] = vstack(rightX, cTop, sideW, rightTopH, 4, G)
  const rCellW = (sideW - G) / 2
  const rCellH = (rightBotH - G) / 2

  const gearH = Math.round(cH * 0.62)
  const speedY = cTop + gearH + G
  const speedH = cBot - speedY

  const delta = s?.deltaToBestSec
  const deltaKnown = delta !== undefined && Number.isFinite(delta)
  const deltaState: FieldState = !deltaKnown ? 'normal' : delta! <= 0 ? 'ok' : 'warn'

  const fuelLow = (s?.fuelLiters !== undefined && Number.isFinite(s.fuelLiters) && s.fuelLiters < 6)
  const fuelState: FieldState = fuelLow ? 'crit' : 'normal'
  const temp = (value: number | undefined) => formatMeasurement(value, 'temperature-c', unitSystem, { decimals: 0 })
  const tempUnit = temp(undefined).unit
  const fuel = formatMeasurement(s?.fuelLiters, 'fuel-volume-l', unitSystem, { decimals: 1 })
  const speed = formatMeasurement(s?.speedKmh, 'speed-kmh', unitSystem, { decimals: 0 })

  const stripThirds = (W - 2 * P - 2 * G) / 3
  const rpmR = { x: P, y: stripY0, w: stripThirds, h: stripH0 }
  const sessR = { x: P + stripThirds + G, y: stripY0, w: stripThirds, h: stripH0 }
  const timeR = { x: P + 2 * (stripThirds + G), y: stripY0, w: stripThirds, h: stripH0 }

  const bCells = 6
  const bW = (W - 2 * P - G * (bCells - 1)) / bCells
  const bY = H - P - botH
  const bx = (i: number): number => P + i * (bW + G)

  const df = (
    r: { x: number; y: number; w: number; h: number },
    label: string,
    value: string,
    st: FieldState = 'normal',
    unit?: string
  ): ReactElement => (
    <DataField x={r.x} y={r.y} width={r.w} height={r.h} label={label} value={value} unit={unit} state={st} ghost={false} skin={skin} />
  )

  return (
    <div className="overlay-card dr-root" data-widget="gridProDash" style={{ width: '100%', height: '100%', overflow: 'hidden', background: palette.bg }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" width="100%" height="100%" style={{ display: 'block' }}>
        <rect x={0} y={0} width={W} height={H} fill={palette.bg} />

        <RevLedBar pct={shiftPct} profile={skin.led} x={P} y={P} width={W - 2 * P} height={revH} shiftActive={redline} />

        {/* Top strip: RPM · SESSION · TIME */}
        {df(rpmR, 'RPM', n0(s?.rpm), redline ? 'crit' : 'normal')}
        <rect x={sessR.x} y={sessR.y} width={sessR.w} height={sessR.h} rx={skin.material.radius} fill={skin.material.base} stroke={palette.accent} strokeWidth={skin.material.borderWidth} />
        <FitText
          x={sessR.x + sessR.w / 2}
          y={sessR.y + sessR.h / 2}
          boxW={sessR.w * 0.9}
          boxH={sessR.h * 0.7}
          text={sessionLabel}
          anchor="middle"
          fontFamily={skin.typography.label}
          fill={palette.accent}
          minFontPx={12}
          maxFontPx={Math.max(14, sessR.h * 0.5)}
          weight={800}
          letterSpacing={1}
          overflowStrategy="squeeze"
        />
        {df(timeR, 'TIME', formatClock(s?.sessionTimeRemainingSec))}

        {/* Left column: water/oil + tyre temps */}
        {df(waterR, 'WATER', temp(s?.waterTempC).display, tempState(s?.waterTempC, 108, 120), tempUnit)}
        {df(oilR, 'OIL', temp(s?.oilTempC).display, tempState(s?.oilTempC, 125, 140), tempUnit)}
        {df({ x: leftX, y: leftBotY, w: tCellW, h: tCellH }, 'LF', temp(tempC(ty?.lf)).display, tempState(tempC(ty?.lf), 100, 110, 70), tempUnit)}
        {df({ x: leftX + tCellW + G, y: leftBotY, w: tCellW, h: tCellH }, 'RF', temp(tempC(ty?.rf)).display, tempState(tempC(ty?.rf), 100, 110, 70), tempUnit)}
        {df({ x: leftX, y: leftBotY + tCellH + G, w: tCellW, h: tCellH }, 'LR', temp(tempC(ty?.lr)).display, tempState(tempC(ty?.lr), 100, 110, 70), tempUnit)}
        {df({ x: leftX + tCellW + G, y: leftBotY + tCellH + G, w: tCellW, h: tCellH }, 'RR', temp(tempC(ty?.rr)).display, tempState(tempC(ty?.rr), 100, 110, 70), tempUnit)}

        {/* Right column: race metrics + relatives */}
        {df(lastR, 'LAST', formatTime(s?.lastLapTimeSec))}
        {df(deltaR, 'DELTA', formatDelta(delta), deltaState)}
        {df(fuelR, 'FUEL', fuel.display, fuelState, fuel.unit)}
        {df(lapsR, 'LAPS LEFT', n0(s?.lapsRemaining))}
        {df({ x: rightX, y: rightBotY, w: rCellW, h: rCellH }, 'AHEAD', gapStr(s?.relatives?.ahead?.gapSec))}
        {df({ x: rightX + rCellW + G, y: rightBotY, w: rCellW, h: rCellH }, 'BEHIND', gapStr(s?.relatives?.behind?.gapSec))}
        {df({ x: rightX, y: rightBotY + rCellH + G, w: rCellW, h: rCellH }, 'POS', n0(s?.position), 'accent')}
        {df({ x: rightX + rCellW + G, y: rightBotY + rCellH + G, w: rCellW, h: rCellH }, 'INC', n0(s?.incidentCount), 'warn')}

        {/* Centre: gear + speed */}
        <rect x={midX} y={cTop} width={midW} height={gearH} rx={skin.material.radius} fill={skin.material.base} stroke={redline ? palette.crit : palette.text} strokeWidth={3} />
        <FitText
          x={midX + midW / 2}
          y={cTop + gearH * 0.15}
          boxW={midW * 0.5}
          boxH={gearH * 0.16}
          text="GEAR"
          anchor="middle"
          fontFamily={skin.typography.label}
          fill={palette.textDim}
          minFontPx={11}
          maxFontPx={Math.max(12, gearH * 0.14)}
          weight={700}
          letterSpacing={2}
        />
        <FitText
          x={midX + midW / 2}
          y={cTop + gearH * 0.6}
          boxW={midW * 0.62}
          boxH={gearH * 0.66}
          text={gear}
          anchor="middle"
          fontFamily={/^\d$/.test(gear) ? segment.numeric : segment.alpha}
          fill={redline ? palette.crit : palette.text}
          minFontPx={24}
          maxFontPx={gearH * 0.7}
        />
        <DataField x={midX} y={speedY} width={midW} height={speedH} label={`SPEED  ${speed.unit.toUpperCase()}`} value={speed.display} state="normal" ghost={false} skin={skin} />

        {/* Bottom strip */}
        {df({ x: bx(0), y: bY, w: bW, h: botH }, 'TC', fmtLevel(s?.tcLevel))}
        {df({ x: bx(1), y: bY, w: bW, h: botH }, 'ABS', fmtLevel(s?.absLevel))}
        {df({ x: bx(2), y: bY, w: bW, h: botH }, 'MAP', fmtLevel(s?.engineMap), 'accent')}
        {df({ x: bx(3), y: bY, w: bW, h: botH }, 'BIAS', n1(s?.brakeBiasPct), 'normal', '%')}
        {df({ x: bx(4), y: bY, w: bW, h: botH }, 'AIR', temp(s?.airTempC).display, tempState(s?.airTempC, 32, 42), tempUnit)}
        {df({ x: bx(5), y: bY, w: bW, h: botH }, 'TRACK', temp(s?.trackTempC).display, tempState(s?.trackTempC, 40, 55), tempUnit)}
      </svg>
    </div>
  )
}
