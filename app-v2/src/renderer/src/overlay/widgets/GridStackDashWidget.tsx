// Full-frame "GridStack" GT3 dashboard — a SimHub-style grid dash rebuilt on the
// v2.39 instrument KIT so telemetry can NEVER overflow: one root <svg> with a fixed
// viewBox + preserveAspectRatio, every value routed through FitText / DataField /
// RevLedBar (auto-fit SVG text) instead of element-height-derived CSS clamp() fonts,
// which was the specific bug that made the previous div/grid version overflow.
//
// Anatomy (real DDU): top full-width blue-redline RevLedBar; a BEHIND · proximity ·
// AHEAD strip; left column vehicle telemetry (track/air temps + tyre temps); big
// central GEAR + SPEED; right column race metrics (last/session-best/PB/delta + fuel
// strategy 2×2); bottom strip ABS/TC/SOF/TIME/MAP/BIAS/PIT. Brand-neutral, skin-token
// only. Every input is optional and degrades to "—", so a null snapshot never NaNs.
import type { ReactElement } from 'react'
import './dashboard-replicas.css'
import type { TelemetrySnapshot, TyreInfo } from '../../../../shared/telemetry'
import type { WidgetProps } from './types'
import { formatDelta, formatGear, formatTime, pct } from './format'
import { resolveSkin, FitText, type SkinToken } from '../../skins'
import { RevLedBar, DataField, type FieldState } from '../../instruments'

// ── pure, NaN-safe helpers ────────────────────────────────────────────────────
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

function tempState(c: number | undefined, warn: number, crit: number, cold?: number): FieldState {
  if (c === undefined || !Number.isFinite(c)) return 'normal'
  if (c >= crit) return 'crit'
  if (c >= warn) return 'warn'
  if (cold !== undefined && c < cold) return 'info'
  return 'normal'
}

function levelText(v: number | string | undefined): string {
  if (v === undefined || v === null) return '—'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '—'
  const t = String(v).trim()
  return t.length ? t : '—'
}

function gapStr(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return '—'
  return Math.abs(seconds).toFixed(1)
}

function lapsToEmpty(s: TelemetrySnapshot | null): number | undefined {
  const fuel = s?.fuelLiters
  const perLap = s?.fuelPerLap
  if (fuel === undefined || perLap === undefined) return undefined
  if (!Number.isFinite(fuel) || !Number.isFinite(perLap) || perLap <= 0) return undefined
  return fuel / perLap
}

function lapsLeftInRace(s: TelemetrySnapshot | null): number | undefined {
  const laps = s?.lapsRemaining
  if (laps !== undefined && Number.isFinite(laps)) return laps
  const time = s?.sessionTimeRemainingSec
  const lapTime = s?.bestLapTimeSec ?? s?.estimatedLapTimeSec ?? s?.lastLapTimeSec
  if (time !== undefined && Number.isFinite(time) && lapTime !== undefined && Number.isFinite(lapTime) && lapTime > 0) {
    return time / lapTime
  }
  return undefined
}

function refuelLiters(s: TelemetrySnapshot | null): number | undefined {
  const perLap = s?.fuelPerLap
  const have = s?.fuelLiters
  const laps = lapsLeftInRace(s)
  if (perLap === undefined || have === undefined || laps === undefined) return undefined
  if (!Number.isFinite(perLap) || !Number.isFinite(have) || !Number.isFinite(laps)) return undefined
  const need = perLap * laps - have
  return need > 0 ? need : 0
}

function sessionBestSec(s: TelemetrySnapshot | null): number | undefined {
  let best: number | undefined
  const drivers = s?.drivers
  if (drivers) {
    for (const driver of drivers) {
      const lap = driver.lastLapTimeSec
      if (lap !== undefined && Number.isFinite(lap) && lap > 0 && (best === undefined || lap < best)) best = lap
    }
  }
  return best ?? s?.bestLapTimeSec
}

function fuelState(s: TelemetrySnapshot | null): FieldState {
  const laps = lapsToEmpty(s)
  if (laps === undefined) return 'normal'
  if (laps <= 2) return 'crit'
  if (laps <= 3.5) return 'warn'
  return 'normal'
}

function proximityFor(s: TelemetrySnapshot | null): { text: string; state: FieldState } {
  const side = s?.carLeftRight
  if (side === undefined || side === 'clear') return { text: 'CLEAR', state: 'normal' }
  if (side === 'both') return { text: 'CAR L+R', state: 'crit' }
  if (side === 'left') return { text: 'CAR LEFT', state: 'warn' }
  return { text: 'CAR RIGHT', state: 'warn' }
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

export function GridStackDashWidget({ snapshot, config }: WidgetProps): ReactElement {
  const s = snapshot
  const skin = resolveSkin('gt3', 'generic')
  const { palette, segment } = skin
  const { W, H } = dims(config)

  const P = Math.max(6, Math.round(Math.min(W, H) * 0.02))
  const G = Math.max(4, Math.round(Math.min(W, H) * 0.014))

  const shiftPct = pct(s?.shiftIndicatorPct ?? s?.revLights?.pct)
  const redline = Boolean(s?.revLights?.blink) || shiftPct >= 0.985
  const gear = formatGear(s?.gear)

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

  // Left column: 2 vehicle temps + 2×2 tyre temps.
  const leftTopH = cH * 0.4
  const leftBotY = cTop + leftTopH + G
  const leftBotH = cBot - leftBotY
  const [trackR, airR] = vstack(leftX, cTop, sideW, leftTopH, 2, G)
  const tCellW = (sideW - G) / 2
  const tCellH = (leftBotH - G) / 2
  const ty = s?.tyres

  // Right column: 4 lap metrics + 2×2 fuel strategy.
  const rightTopH = cH * 0.52
  const rightBotY = cTop + rightTopH + G
  const rightBotH = cBot - rightBotY
  const [lastR, sbR, pbR, deltaR] = vstack(rightX, cTop, sideW, rightTopH, 4, G)
  const fCellW = (sideW - G) / 2
  const fCellH = (rightBotH - G) / 2

  // Centre: gear + speed.
  const gearH = Math.round(cH * 0.62)
  const speedY = cTop + gearH + G
  const speedH = cBot - speedY

  const delta = s?.deltaToBestSec
  const deltaKnown = delta !== undefined && Number.isFinite(delta)
  const deltaState: FieldState = !deltaKnown ? 'normal' : delta! <= 0 ? 'ok' : 'warn'

  const prox = proximityFor(s)

  // Top strip: BEHIND · proximity banner · AHEAD.
  const stripThirds = (W - 2 * P - 2 * G) / 3
  const behindR = { x: P, y: stripY0, w: stripThirds, h: stripH0 }
  const proxR = { x: P + stripThirds + G, y: stripY0, w: stripThirds, h: stripH0 }
  const aheadR = { x: P + 2 * (stripThirds + G), y: stripY0, w: stripThirds, h: stripH0 }

  // Bottom strip: 7 aids/session cells.
  const bCells = 7
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
    <div className="overlay-card dr-root" data-widget="gridStackDash" style={{ width: '100%', height: '100%', overflow: 'hidden', background: palette.bg }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" width="100%" height="100%" style={{ display: 'block' }}>
        <rect x={0} y={0} width={W} height={H} fill={palette.bg} />

        <RevLedBar pct={shiftPct} profile={skin.led} x={P} y={P} width={W - 2 * P} height={revH} flashOn={redline} />

        {/* Top strip */}
        {df(behindR, 'BEHIND', gapStr(s?.relatives?.behind?.gapSec), 'normal', 's')}
        <rect x={proxR.x} y={proxR.y} width={proxR.w} height={proxR.h} rx={skin.material.radius} fill={skin.material.base} stroke={stateColor(prox.state, skin)} strokeWidth={skin.material.borderWidth} />
        <FitText
          x={proxR.x + proxR.w / 2}
          y={proxR.y + proxR.h / 2}
          boxW={proxR.w * 0.9}
          boxH={proxR.h * 0.7}
          text={prox.text}
          anchor="middle"
          fontFamily={skin.typography.label}
          fill={stateColor(prox.state, skin)}
          minFontPx={12}
          maxFontPx={Math.max(14, proxR.h * 0.5)}
          weight={800}
          letterSpacing={1}
        />
        {df(aheadR, 'AHEAD', gapStr(s?.relatives?.ahead?.gapSec), 'normal', 's')}

        {/* Left column: temps + tyres */}
        {df(trackR, 'TRACK', n0(s?.trackTempC), tempState(s?.trackTempC, 40, 55), '°')}
        {df(airR, 'AIR', n0(s?.airTempC), tempState(s?.airTempC, 32, 42), '°')}
        {df({ x: leftX, y: leftBotY, w: tCellW, h: tCellH }, 'LF', n0(tempC(ty?.lf)), tempState(tempC(ty?.lf), 100, 110, 70), '°')}
        {df({ x: leftX + tCellW + G, y: leftBotY, w: tCellW, h: tCellH }, 'RF', n0(tempC(ty?.rf)), tempState(tempC(ty?.rf), 100, 110, 70), '°')}
        {df({ x: leftX, y: leftBotY + tCellH + G, w: tCellW, h: tCellH }, 'LR', n0(tempC(ty?.lr)), tempState(tempC(ty?.lr), 100, 110, 70), '°')}
        {df({ x: leftX + tCellW + G, y: leftBotY + tCellH + G, w: tCellW, h: tCellH }, 'RR', n0(tempC(ty?.rr)), tempState(tempC(ty?.rr), 100, 110, 70), '°')}

        {/* Right column: lap metrics + fuel strategy */}
        {df(lastR, 'LAST', formatTime(s?.lastLapTimeSec))}
        {df(sbR, 'SESSION BEST', formatTime(sessionBestSec(s)), 'ok')}
        {df(pbR, 'PB', formatTime(s?.bestLapTimeSec), 'info')}
        {df(deltaR, 'DELTA', formatDelta(delta), deltaState)}
        {df({ x: rightX, y: rightBotY, w: fCellW, h: fCellH }, 'FUEL/LAP', n2(s?.fuelPerLap), 'accent', 'L')}
        {df({ x: rightX + fCellW + G, y: rightBotY, w: fCellW, h: fCellH }, 'TO EMPTY', n1(lapsToEmpty(s)), fuelState(s))}
        {df({ x: rightX, y: rightBotY + fCellH + G, w: fCellW, h: fCellH }, 'REFUEL', n1(refuelLiters(s)), 'accent', 'L')}
        {df({ x: rightX + fCellW + G, y: rightBotY + fCellH + G, w: fCellW, h: fCellH }, 'FUEL', n1(s?.fuelLiters), fuelState(s), 'L')}

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
        <DataField x={midX} y={speedY} width={midW} height={speedH} label="SPEED  KM/H" value={n0(s?.speedKmh)} state="normal" ghost={false} skin={skin} />

        {/* Bottom strip */}
        {df({ x: bx(0), y: bY, w: bW, h: botH }, 'ABS', levelText(s?.absLevel))}
        {df({ x: bx(1), y: bY, w: bW, h: botH }, 'TC', levelText(s?.tcLevel))}
        {df({ x: bx(2), y: bY, w: bW, h: botH }, 'SOF', n0(s?.strengthOfField))}
        {df({ x: bx(3), y: bY, w: bW, h: botH }, 'TIME', formatTime(s?.sessionTimeRemainingSec))}
        {df({ x: bx(4), y: bY, w: bW, h: botH }, 'MAP', levelText(s?.engineMap), 'accent')}
        {df({ x: bx(5), y: bY, w: bW, h: botH }, 'BIAS', n1(s?.brakeBiasPct), 'normal', '%')}
        {df({ x: bx(6), y: bY, w: bW, h: botH }, 'LAP', n0(s?.currentLap), 'accent')}
      </svg>
    </div>
  )
}
