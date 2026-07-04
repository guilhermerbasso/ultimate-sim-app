// Full-frame Bosch-Motorsport-296-style GT3 DDU replica, rebuilt on the v2.39
// instrument KIT so telemetry can NEVER overflow: one root <svg> with a fixed
// viewBox + preserveAspectRatio, every value routed through FitText / DataField /
// RevLedBar (auto-fit SVG text) instead of element-height-derived CSS fonts.
//
// Anatomy (real DDU): top full-width blue-redline RevLedBar; big central segmented
// GEAR flanked by a warning-lamp TelltaleBank; left column = vehicle telemetry
// (water/oil temp+press, tyre temps); right column = race metrics (lap/last/best/
// delta/fuel); bottom strip = MAP/ABS/TC/BB/PIT + a status banner. Brand-neutral.
// Every input is optional and degrades to "—", so a null snapshot never renders NaN.

import type { ReactElement } from 'react'
import './dashboard-replicas.css'
import { formatDelta, formatGear, formatTime } from './format'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import type { WidgetProps } from './types'
import { resolveSkin, FitText, type SkinToken } from '../../skins'
import { RevLedBar, DataField, TelltaleBank, type FieldState, type TelltaleLamp } from '../../instruments'

export const BOSCH296_DASH_STREAM_SAFE = true

// ── small pure helpers (NaN-safe) ─────────────────────────────────────────────
function dims(config: WidgetProps['config']): { W: number; H: number } {
  const w = config?.position?.width
  const h = config?.position?.height
  return {
    W: typeof w === 'number' && w > 0 ? w : 800,
    H: typeof h === 'number' && h > 0 ? h : 480
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

function shiftFraction(s: TelemetrySnapshot | null): number {
  const raw = s?.shiftIndicatorPct ?? (s?.maxRpm ? (s?.rpm ?? 0) / s.maxRpm : 0)
  return Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0
}

function levelText(v: number | string | undefined): string {
  if (v === undefined) return '—'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '—'
  const t = v.trim()
  return t.length ? t : '—'
}

function aidOff(level: number | string | undefined, enabled: boolean | undefined): boolean {
  if (enabled === false) return true
  if (typeof level === 'number') return level <= 0
  if (typeof level === 'string') {
    const t = level.trim().toUpperCase()
    return t === '0' || t === 'OFF'
  }
  return false
}

function fuelState(s: TelemetrySnapshot | null): FieldState {
  if (!s || s.fuelLiters === undefined || !Number.isFinite(s.fuelLiters)) return 'normal'
  const frac = s.fuelCapacityLiters && s.fuelCapacityLiters > 0 ? s.fuelLiters / s.fuelCapacityLiters : undefined
  if (s.fuelLiters < 2.5 || (frac !== undefined && frac < 0.05)) return 'crit'
  if (s.fuelLiters < 6 || (frac !== undefined && frac < 0.1)) return 'warn'
  return 'normal'
}

interface Banner {
  text: string
  state: FieldState
}
function bannerFor(s: TelemetrySnapshot | null): Banner {
  const f = s?.flags
  if (f?.red) return { text: 'RED FLAG', state: 'crit' }
  if (f?.yellow) return { text: 'FULL COURSE YELLOW', state: 'warn' }
  if (f?.blue) return { text: 'BLUE FLAG', state: 'info' }
  if (f?.checkered) return { text: 'CHEQUERED', state: 'normal' }
  if (f?.greenWhiteCheckered) return { text: 'GREEN WHITE CHEQUER', state: 'ok' }
  if (f?.green) return { text: 'GREEN', state: 'ok' }
  const st = s?.sessionType?.trim()
  return { text: st && st.length ? st.toUpperCase() : 'RECOVERY', state: 'normal' }
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

// Vertical stack of equal rects inside (x,y,w,h).
function vstack(x: number, y: number, w: number, h: number, count: number, gap: number): Array<{ x: number; y: number; w: number; h: number }> {
  const n = Math.max(1, count)
  const ch = (h - gap * (n - 1)) / n
  return Array.from({ length: n }, (_, i) => ({ x, y: y + i * (ch + gap), w, h: ch }))
}

export function Bosch296DashWidget({ snapshot, config }: WidgetProps): ReactElement {
  const s = snapshot
  const skin = resolveSkin('gt3', 'generic')
  const { palette, segment, typography, material } = skin
  const { W, H } = dims(config)

  const P = Math.max(6, Math.round(Math.min(W, H) * 0.02))
  const G = Math.max(4, Math.round(Math.min(W, H) * 0.014))

  const shiftPct = shiftFraction(s)
  const redline = shiftPct >= 0.95
  const gear = formatGear(s?.gear)

  // ── vertical bands ──────────────────────────────────────────────────────────
  const revH = Math.max(22, Math.min(48, Math.round(H * 0.08)))
  const scaleH = Math.max(12, Math.min(22, Math.round(H * 0.035)))
  const topH = revH + scaleH
  const botH = Math.max(52, Math.min(112, Math.round(H * 0.17)))
  const cTop = P + topH + G
  const cBot = H - P - botH - G
  const cH = cBot - cTop

  // ── columns ─────────────────────────────────────────────────────────────────
  const sideW = Math.max(120, Math.min(270, Math.round(W * 0.24)))
  const leftX = P
  const rightX = W - P - sideW
  const midX = leftX + sideW + G
  const midW = rightX - G - midX

  // Left column: 3 vehicle temps + 2×2 tyre-temp grid.
  const leftTopH = cH * 0.46
  const leftBotY = cTop + leftTopH + G
  const leftBotH = cBot - leftBotY
  const [wRect, oRect, opRect] = vstack(leftX, cTop, sideW, leftTopH, 3, G)
  const tyreCellW = (sideW - G) / 2
  const tyreCellH = (leftBotH - G) / 2
  const ty = s?.tyres

  // Right column: 5 race metrics.
  const [lapR, lastR, bestR, deltaR, fuelR] = vstack(rightX, cTop, sideW, cH, 5, G)

  // Centre: telltale bank, gear, speed.
  const ttH = Math.max(34, Math.min(58, Math.round(cH * 0.16)))
  const gearY = cTop + ttH + G
  const gearH = Math.round(cH * 0.5)
  const speedY = gearY + gearH + G
  const speedH = cBot - speedY

  const lamps: TelltaleLamp[] = [
    { icon: 'headlight', active: !!(s?.isRaining || s?.connected), activeColor: palette.text, label: 'lights' },
    { icon: 'rain', active: !!s?.isRaining, activeColor: skin.telltale.colors.rain, label: 'rain' },
    { icon: 'fuel', active: fuelState(s) !== 'normal', activeColor: palette.crit, label: 'fuel' },
    { icon: 'tc', active: !!s?.tcActive, activeColor: skin.telltale.colors.tc, label: 'tc' }
  ]
  // The pit limiter is an auto-fitting FitText chip appended to the bank row, so its
  // label never falls under the tiny-text floor (unlike the KIT's embedded glyph text).
  const pitCellIndex = lamps.length
  const cellCount = lamps.length + 1
  const ttSize = Math.max(20, Math.min(46, Math.min(ttH, (midW - (cellCount - 1) * 6) / cellCount)))
  const bankW = ttSize * cellCount + 6 * (cellCount - 1)
  const bankX = midX + (midW - bankW) / 2
  const pitOn = !!s?.pitLimiter
  const pitColor = pitOn ? palette.info : palette.textDim

  const absOff = aidOff(s?.absLevel, s?.absEnabled)
  const tcOff = aidOff(s?.tcLevel, s?.tcEnabled)
  const banner = bannerFor(s)

  const deltaKnown = s?.deltaToBestSec !== undefined && Number.isFinite(s.deltaToBestSec)
  const deltaState: FieldState = !deltaKnown ? 'normal' : s!.deltaToBestSec! <= 0 ? 'ok' : 'warn'

  // Bottom strip: aid cells + wide banner.
  const stripCells = 6
  const stripW = (W - 2 * P - G * (stripCells - 1)) / stripCells
  const stripY = H - P - botH
  const bx = (i: number): number => P + i * (stripW + G)
  const bannerX = bx(4)
  const bannerW = stripW * 2 + G

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
    <div className="overlay-card dr-root rd-bosch296-dash" data-overlay-id={config?.id} data-widget="bosch296Dash" style={{ width: '100%', height: '100%', overflow: 'hidden', background: palette.bg }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" width="100%" height="100%" style={{ display: 'block' }}>
        <rect x={0} y={0} width={W} height={H} fill={palette.bg} />

        {/* ── Top: blue-redline rev bar + x1000 scale ─────────────────────── */}
        <RevLedBar pct={shiftPct} profile={skin.led} x={P} y={P} width={W - 2 * P} height={revH} flashOn />
        <FitText
          x={P}
          y={P + revH + scaleH / 2}
          boxW={78}
          boxH={scaleH}
          text={`RPM ${n0(s?.rpm)}`}
          anchor="start"
          fontFamily={typography.label}
          fill={redline ? palette.crit : palette.textDim}
          minFontPx={11}
          maxFontPx={scaleH}
          weight={700}
        />
        {['4', '6', '8', '10', '12', '14'].map((t, i, a) => (
          <FitText
            key={t}
            x={W - P - ((a.length - 1 - i) / (a.length - 1)) * (W - 2 * P) * 0.5}
            y={P + revH + scaleH / 2}
            boxW={22}
            boxH={scaleH}
            text={t}
            anchor="middle"
            fontFamily={segment.numeric}
            fill={palette.textDim}
            minFontPx={11}
            maxFontPx={scaleH}
          />
        ))}

        {/* ── Left column: vehicle telemetry ──────────────────────────────── */}
        {df(wRect, 'WATER', n0(s?.waterTempC), tempState(s?.waterTempC, 108, 120), '°')}
        {df(oRect, 'OIL', n0(s?.oilTempC), tempState(s?.oilTempC, 125, 140), '°')}
        {df(opRect, 'OIL P', s?.oilPressureKpa !== undefined ? n1(s.oilPressureKpa / 100) : '—', 'normal', 'b')}
        {df({ x: leftX, y: leftBotY, w: tyreCellW, h: tyreCellH }, 'LF', n0(ty?.lf?.tempC), tempState(ty?.lf?.tempC, 100, 110, 70), '°')}
        {df({ x: leftX + tyreCellW + G, y: leftBotY, w: tyreCellW, h: tyreCellH }, 'RF', n0(ty?.rf?.tempC), tempState(ty?.rf?.tempC, 100, 110, 70), '°')}
        {df({ x: leftX, y: leftBotY + tyreCellH + G, w: tyreCellW, h: tyreCellH }, 'LR', n0(ty?.lr?.tempC), tempState(ty?.lr?.tempC, 100, 110, 70), '°')}
        {df({ x: leftX + tyreCellW + G, y: leftBotY + tyreCellH + G, w: tyreCellW, h: tyreCellH }, 'RR', n0(ty?.rr?.tempC), tempState(ty?.rr?.tempC, 100, 110, 70), '°')}

        {/* ── Right column: race metrics ──────────────────────────────────── */}
        {df(lapR, 'LAP', n0(s?.currentLap), 'accent')}
        {df(lastR, 'LAST', formatTime(s?.lastLapTimeSec))}
        {df(bestR, 'BEST', formatTime(s?.bestLapTimeSec), 'info')}
        {df(deltaR, 'DELTA', formatDelta(s?.deltaToBestSec), deltaState)}
        {df(fuelR, 'FUEL', n1(s?.fuelLiters), fuelState(s), 'L')}

        {/* ── Centre: telltales, gear, speed ──────────────────────────────── */}
        <g transform={`translate(${bankX}, ${cTop + (ttH - ttSize) / 2})`}>
          <TelltaleBank lamps={lamps} size={ttSize} gap={6} glow={false} idPrefix="b296-tt" />
          <rect x={pitCellIndex * (ttSize + 6)} y={0} width={ttSize} height={ttSize} rx={material.radius} fill={material.base} stroke={pitColor} strokeWidth={pitOn ? material.borderWidth : 1} opacity={pitOn ? 1 : 0.55} />
          <FitText x={pitCellIndex * (ttSize + 6) + ttSize / 2} y={ttSize / 2} boxW={ttSize} boxH={ttSize} text="PIT" fontFamily={typography.label} fill={pitColor} minFontPx={11} maxFontPx={Math.max(12, Math.floor(ttSize * 0.42))} weight={700} anchor="middle" baseline="middle" />
        </g>

        <rect
          x={midX}
          y={gearY}
          width={midW}
          height={gearH}
          rx={material.radius}
          fill={material.base}
          stroke={redline ? palette.crit : palette.text}
          strokeWidth={3}
        />
        <FitText
          x={midX + midW / 2}
          y={gearY + gearH * 0.16}
          boxW={midW * 0.5}
          boxH={gearH * 0.16}
          text="GEAR"
          anchor="middle"
          fontFamily={typography.label}
          fill={palette.textDim}
          minFontPx={11}
          maxFontPx={Math.max(12, gearH * 0.14)}
          weight={700}
          letterSpacing={2}
        />
        <FitText
          x={midX + midW / 2}
          y={gearY + gearH * 0.6}
          boxW={midW * 0.62}
          boxH={gearH * 0.66}
          text={gear}
          anchor="middle"
          fontFamily={/^\d$/.test(gear) ? segment.numeric : segment.alpha}
          fill={redline ? palette.crit : palette.text}
          minFontPx={24}
          maxFontPx={gearH * 0.7}
        />
        <DataField
          x={midX}
          y={speedY}
          width={midW}
          height={speedH}
          label="SPEED  KM/H"
          value={n0(s?.speedKmh)}
          state="normal"
          ghost={false}
          skin={skin}
        />

        {/* ── Bottom strip: aids + status banner ──────────────────────────── */}
        {df({ x: bx(0), y: stripY, w: stripW, h: botH }, 'MAP', levelText(s?.engineMap), 'accent')}
        {df({ x: bx(1), y: stripY, w: stripW, h: botH }, 'ABS', levelText(s?.absLevel), absOff ? 'crit' : 'normal')}
        {df({ x: bx(2), y: stripY, w: stripW, h: botH }, 'TC', levelText(s?.tcLevel), tcOff ? 'crit' : 'normal')}
        {df({ x: bx(3), y: stripY, w: stripW, h: botH }, 'BB %', n1(s?.brakeBiasPct))}
        <rect
          x={bannerX}
          y={stripY}
          width={bannerW}
          height={botH}
          rx={material.radius}
          fill={material.base}
          stroke={stateColor(banner.state, skin)}
          strokeWidth={material.borderWidth}
        />
        <FitText
          x={bannerX + bannerW / 2}
          y={stripY + botH * 0.3}
          boxW={bannerW * 0.9}
          boxH={botH * 0.28}
          text="STATUS"
          anchor="middle"
          fontFamily={typography.label}
          fill={palette.textDim}
          minFontPx={11}
          maxFontPx={Math.max(12, botH * 0.24)}
          weight={700}
          letterSpacing={2}
        />
        <FitText
          x={bannerX + bannerW / 2}
          y={stripY + botH * 0.68}
          boxW={bannerW * 0.92}
          boxH={botH * 0.44}
          text={banner.text}
          anchor="middle"
          fontFamily={typography.label}
          fill={stateColor(banner.state, skin)}
          minFontPx={12}
          maxFontPx={Math.max(14, botH * 0.4)}
          weight={800}
          overflowStrategy="squeeze"
        />
      </svg>
    </div>
  )
}
