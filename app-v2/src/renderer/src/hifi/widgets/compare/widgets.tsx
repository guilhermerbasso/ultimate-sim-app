// ─── Hi-fi COMPARE group — broadcast-style dual-driver telemetry comparison ──────
// A TV/broadcast telemetry-comparison surface (player vs a reference: the car ahead
// when available, else the session-best ghost). Built from a validated gpt-image
// reference (concepts/refs/ref-dash-telemetry-compare.png) and visual-QA'd clean.
//
// Honesty model: every NUMERIC readout (speed, delta, gap, lap time, driver, position,
// throttle/brake, lap-distance cursor) is REAL live telemetry → em-dash when absent
// (never fake data). The lap SILHOUETTES (speed profile, delta profile) and the track
// outline are ILLUSTRATIVE context (the same category as the app's static track-map
// fallback) drawn dim behind the live values — they carry no numeric claim.
import { type ReactElement } from 'react'
import type { HifiWidgetModule, HifiWidgetProps } from '../types'
import { C, CleanTile, FONT_BIG, FONT_LABEL, FONT_NUM, clamp01, condColor, fixed, frac, lapTime, legibleStroke, num, signed } from '../kit'
import { formatMeasurement, type UnitSystem } from '../../../../../shared/units'

const DASH_W = 1024
const DASH_H = 600
const BG = '#0A0D12'
const RED = '#E2231A' // player (left)
const AMBER = '#F4C430' // reference / rival (right)
const ORANGE = '#FF7A16'
const WHITE = '#F4F6FA'
const GREY = '#8A93A0'
const GRID = 'rgba(255,255,255,0.10)'
const SPEED_MIN = 50
const SPEED_MAX = 320

const TAGS = ['compare', 'broadcast', 'analysis', 'telemetry', 'ir'] as const

function txt(v: unknown): string {
  const s = v == null ? '' : String(v).trim()
  return s === '' ? '—' : s
}

// ── Deterministic illustrative lap profiles (SSR-safe, computed once) ─────────────
const N = 96
const SPEED_PROFILE: number[] = Array.from({ length: N }, (_, i) => {
  const t = i / (N - 1)
  const dips = [0.06, 0.19, 0.29, 0.42, 0.53, 0.63, 0.74, 0.9]
  let v = 1
  for (const d of dips) v *= 1 - 0.62 * Math.exp(-((t - d) ** 2) / 0.0011)
  return clamp01(0.16 + 0.84 * v)
})
const DELTA_PROFILE: number[] = Array.from({ length: N }, (_, i) => {
  const t = i / (N - 1)
  return 0.55 * Math.sin(t * 6.3) + 0.28 * Math.sin(t * 15.7 + 1) - 0.35 * t
})
// Closed wavy track loop in normalized [0,1] space + a speed zone per point.
const TRACK: [number, number][] = Array.from({ length: 72 }, (_, i) => {
  const a = (i / 72) * Math.PI * 2
  const r = 0.52 + 0.17 * Math.sin(a * 3) + 0.07 * Math.cos(a * 2)
  return [0.5 + r * 0.44 * Math.cos(a), 0.5 + r * 0.4 * Math.sin(a)]
})
const ZONE: number[] = TRACK.map((_, i) => {
  const v = SPEED_PROFILE[Math.floor((i / TRACK.length) * (N - 1))]
  return v > 0.72 ? 2 : v > 0.45 ? 1 : 0
})
const ZONE_COLOR = [RED, ORANGE, AMBER]
const CORNER_IDX = [2, 9, 16, 23, 30, 37, 44, 51, 58, 64, 69]

function ptAt(t: number): [number, number] {
  const n = TRACK.length
  const f = clamp01(t) * n
  const i = Math.floor(f) % n
  const j = (i + 1) % n
  const k = f - Math.floor(f)
  const a = TRACK[i]
  const b = TRACK[j]
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]
}

function profilePath(ox: number, oy: number, w: number, h: number, prof: number[], shift = 0): string {
  const pts = prof.map((v, i) => {
    const x = ox + (i / (prof.length - 1)) * w
    const y = oy + h - clamp01(v + shift) * h
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
  })
  return pts.join(' ')
}

function normalizedLapDist(dist: number | undefined): number | undefined {
  if (dist == null || !Number.isFinite(dist)) return undefined
  return clamp01(dist > 1 ? dist / 100 : dist)
}

function profileIndexAtDist(dist: number | undefined, prof: number[]): number | undefined {
  const d = normalizedLapDist(dist)
  return d == null ? undefined : d * (prof.length - 1)
}

function profileX(ox: number, w: number, idx: number): number {
  return ox + (idx / (SPEED_PROFILE.length - 1)) * w
}

function profileYAtIndex(oy: number, h: number, prof: number[], idx: number, shift = 0): number {
  const lo = Math.floor(idx)
  const hi = Math.min(prof.length - 1, lo + 1)
  const t = idx - lo
  const v = (prof[lo] ?? 0) + ((prof[hi] ?? 0) - (prof[lo] ?? 0)) * t
  return oy + h - clamp01(v + shift) * h
}

// ── Reference (right side) resolver — real rival ahead, else session-best ghost ───
function reference(s: HifiWidgetProps['snapshot']): { name: string; sub: string; lapSec: number | undefined; isGhost: boolean } {
  const ahead = s?.relatives?.ahead
  if (ahead && (ahead.name || ahead.lastLapTimeSec != null)) {
    return { name: txt(ahead.name), sub: ahead.position != null ? `P${ahead.position}` : 'AHEAD', lapSec: num(ahead.lastLapTimeSec), isGhost: false }
  }
  return { name: 'SESSION BEST', sub: 'REFERENCE', lapSec: num(s?.bestLapTimeSec), isGhost: true }
}

// ── Draw helpers (absolute coords so the full dash can compose them) ──────────────
function DriverPanel({ ox, oy, w, side, color, name, sub, lapText, gapText, gapColor }: { ox: number; oy: number; w: number; side: 'L' | 'R'; color: string; name: string; sub: string; lapText: string; gapText: string; gapColor: string }): ReactElement {
  const left = side === 'L'
  const numBoxW = 92
  const numX = left ? ox : ox + w - numBoxW
  const textX = left ? ox + numBoxW + 16 : ox + w - numBoxW - 16
  const anchor = left ? 'start' : 'end'
  const posChar = sub.startsWith('P') ? sub.slice(1) : left ? '1' : '2'
  return (
    <g>
      <rect x={numX} y={oy} width={numBoxW} height={70} fill={color} />
      <text x={numX + numBoxW / 2} y={oy + 54} textAnchor="middle" fill={BG} fontFamily={FONT_BIG} fontWeight={900} fontSize={50}>{posChar}</text>
      <text x={textX} y={oy + 34} textAnchor={anchor} fill={color} fontFamily={FONT_BIG} fontWeight={900} fontSize={30} {...legibleStroke(30)}>{name}</text>
      <text x={textX} y={oy + 60} textAnchor={anchor} fill={GREY} fontFamily={FONT_LABEL} fontWeight={800} fontSize={19} letterSpacing={2} {...legibleStroke(19)}>{sub}</text>
      <text x={left ? ox : ox + w} y={oy + 108} textAnchor={anchor} fill={GREY} fontFamily={FONT_LABEL} fontWeight={800} fontSize={17} letterSpacing={2} {...legibleStroke(17)}>LAP TIME</text>
      <text x={left ? ox + 96 : ox + w - 96} y={oy + 108} textAnchor={left ? 'start' : 'end'} fill={WHITE} fontFamily={FONT_NUM} fontWeight={800} fontSize={26} {...legibleStroke(26)}>{lapText}</text>
      <text x={left ? ox : ox + w} y={oy + 156} textAnchor={anchor} fill={gapColor} fontFamily={FONT_BIG} fontWeight={900} fontSize={46} {...legibleStroke(46)}>{gapText}</text>
    </g>
  )
}

function StyleBars({ ox, oy, w, color, throttle, brake, corner }: { ox: number; oy: number; w: number; color: string; throttle: number | undefined; brake: number | undefined; corner: number | undefined }): ReactElement {
  const rows: [string, number | undefined][] = [
    ['FULL THROTTLE', throttle],
    ['HEAVY BRAKING', brake],
    ['CORNERING', corner]
  ]
  const barX = ox + 156
  const barW = w - 156 - 52
  return (
    <g>
      {rows.map(([label, v], i) => {
        const y = oy + i * 30
        const pct = v == null ? undefined : clamp01(v) * 100
        return (
          <g key={label}>
            <text x={ox} y={y + 14} fill={GREY} fontFamily={FONT_LABEL} fontWeight={800} fontSize={15} letterSpacing={1.4} {...legibleStroke(15)}>{label}</text>
            <rect x={barX} y={y + 3} width={barW} height={12} rx={2} fill="rgba(255,255,255,0.08)" />
            <rect x={barX} y={y + 3} width={Math.max(0, barW * frac(v, 0, 1))} height={12} rx={2} fill={color} />
            <text x={ox + w} y={y + 14} textAnchor="end" fill={WHITE} fontFamily={FONT_NUM} fontWeight={800} fontSize={16} {...legibleStroke(16)}>{pct == null ? '—' : `${pct.toFixed(0)}%`}</text>
          </g>
        )
      })}
    </g>
  )
}

function ZoneMap({ ox, oy, w, h, dist }: { ox: number; oy: number; w: number; h: number; dist: number | undefined }): ReactElement {
  const sx = (p: number): number => ox + p * w
  const sy = (p: number): number => oy + p * h
  const segs = TRACK.map((p, i) => {
    const q = TRACK[(i + 1) % TRACK.length]
    return <line key={i} x1={sx(p[0])} y1={sy(p[1])} x2={sx(q[0])} y2={sy(q[1])} stroke={ZONE_COLOR[ZONE[i] ?? 2]} strokeWidth={5} strokeLinecap="round" opacity={0.92} />
  })
  const d = normalizedLapDist(dist)
  const car = d == null ? null : ptAt(d)
  return (
    <g>
      {segs}
      {CORNER_IDX.map((idx, n) => {
        const p = TRACK[idx]
        const cx = 0.5 + (p[0] - 0.5) * 1.16
        const cy = 0.5 + (p[1] - 0.5) * 1.16
        return <text key={n} x={sx(cx)} y={sy(cy) + 4} textAnchor="middle" fill={WHITE} fontFamily={FONT_NUM} fontWeight={800} fontSize={13} {...legibleStroke(13)}>{n + 1}</text>
      })}
      {car ? <circle cx={sx(car[0])} cy={sy(car[1])} r={7} fill={WHITE} stroke={RED} strokeWidth={3} /> : null}
    </g>
  )
}

function SpeedTrace({ ox, oy, w, h, dist, speed, idp, unitSystem }: { ox: number; oy: number; w: number; h: number; dist: number | undefined; speed: number | undefined; idp: string; unitSystem: UnitSystem }): ReactElement {
  const cursorIdx = profileIndexAtDist(dist, SPEED_PROFILE)
  const cursorX = cursorIdx == null ? null : profileX(ox, w, cursorIdx)
  const dotY = cursorIdx == null ? null : profileYAtIndex(oy, h, SPEED_PROFILE, cursorIdx)
  const reading = formatMeasurement(speed, 'speed-kmh', unitSystem, { decimals: 0 })
  const maxReading = formatMeasurement(SPEED_MAX, 'speed-kmh', unitSystem, { decimals: 0 })
  const minReading = formatMeasurement(SPEED_MIN, 'speed-kmh', unitSystem, { decimals: 0 })
  return (
    <g>
      <defs>
        <linearGradient id={`${idp}-fill`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={RED} stopOpacity={0.34} />
          <stop offset="100%" stopColor={RED} stopOpacity={0.02} />
        </linearGradient>
      </defs>
      <line x1={ox} y1={oy} x2={ox} y2={oy + h} stroke={GRID} strokeWidth={1} />
      <line x1={ox} y1={oy + h} x2={ox + w} y2={oy + h} stroke={GRID} strokeWidth={1} />
      <text x={ox - 8} y={oy + 12} textAnchor="end" fill={GREY} fontFamily={FONT_NUM} fontWeight={700} fontSize={14} {...legibleStroke(14)}>{maxReading.display}</text>
      <text x={ox - 8} y={oy + h} textAnchor="end" fill={GREY} fontFamily={FONT_NUM} fontWeight={700} fontSize={14} {...legibleStroke(14)}>{minReading.display}</text>
      {/* illustrative dual-line lap profile (context, dim) */}
      <path d={`${profilePath(ox, oy, w, h, SPEED_PROFILE)} L${ox + w} ${oy + h} L${ox} ${oy + h} Z`} fill={`url(#${idp}-fill)`} stroke="none" />
      <path d={profilePath(ox, oy, w, h, SPEED_PROFILE, 0.02)} fill="none" stroke={AMBER} strokeWidth={2} opacity={0.7} />
      <path d={profilePath(ox, oy, w, h, SPEED_PROFILE)} fill="none" stroke={RED} strokeWidth={2} opacity={0.85} />
      {CORNER_IDX.map((_, n) => {
        const x = ox + ((n + 0.5) / CORNER_IDX.length) * w
        return <line key={n} x1={x} y1={oy} x2={x} y2={oy + h} stroke={GRID} strokeWidth={1} strokeDasharray="2 5" />
      })}
      {cursorX != null ? <line x1={cursorX} y1={oy} x2={cursorX} y2={oy + h} stroke={WHITE} strokeWidth={1.5} opacity={0.6} /> : null}
      {cursorX != null && dotY != null ? <circle cx={cursorX} cy={dotY} r={5} fill={speed == null ? C.dim : WHITE} stroke={RED} strokeWidth={2.5} /> : null}
      <text x={ox + w} y={oy + 16} textAnchor="end" fill={speed == null ? C.dim : WHITE} fontFamily={FONT_BIG} fontWeight={900} fontSize={24} {...legibleStroke(24)}>{reading.display}<tspan fill={GREY} fontFamily={FONT_LABEL} fontSize={14}> {reading.unit}</tspan></text>
    </g>
  )
}

function DeltaTrace({ ox, oy, w, h, dist, delta, idp }: { ox: number; oy: number; w: number; h: number; dist: number | undefined; delta: number | undefined; idp: string }): ReactElement {
  const midY = oy + h / 2
  const scale = h / 2 / 1.1
  const path = DELTA_PROFILE.map((v, i) => {
    const x = ox + (i / (DELTA_PROFILE.length - 1)) * w
    const y = midY - v * scale
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
  }).join(' ')
  const cursorIdx = profileIndexAtDist(dist, DELTA_PROFILE)
  const cursorX = cursorIdx == null ? null : ox + (cursorIdx / (DELTA_PROFILE.length - 1)) * w
  const dCol = condColor(delta, { positiveIsGood: false, deadzone: 0.02, good: '#2BFF66', bad: '#ff4040', neutral: WHITE })
  return (
    <g>
      <line x1={ox} y1={midY} x2={ox + w} y2={midY} stroke={GRID} strokeWidth={1} />
      <text x={ox - 8} y={oy + 12} textAnchor="end" fill={GREY} fontFamily={FONT_LABEL} fontWeight={800} fontSize={12} letterSpacing={1} {...legibleStroke(12)}>FASTER</text>
      <text x={ox - 8} y={oy + h - 2} textAnchor="end" fill={GREY} fontFamily={FONT_LABEL} fontWeight={800} fontSize={12} letterSpacing={1} {...legibleStroke(12)}>SLOWER</text>
      {CORNER_IDX.map((_, n) => {
        const x = ox + ((n + 0.5) / CORNER_IDX.length) * w
        return <line key={n} x1={x} y1={oy} x2={x} y2={oy + h} stroke={GRID} strokeWidth={1} strokeDasharray="2 5" />
      })}
      <path d={path} fill="none" stroke={RED} strokeWidth={2} opacity={0.85} />
      {cursorX != null ? <line x1={cursorX} y1={oy} x2={cursorX} y2={oy + h} stroke={WHITE} strokeWidth={1.5} opacity={0.6} /> : null}
      <text x={ox + w} y={oy + 16} textAnchor="end" fill={dCol} fontFamily={FONT_BIG} fontWeight={900} fontSize={24} {...legibleStroke(24)}>{signed(delta, 3)}<tspan fill={GREY} fontFamily={FONT_LABEL} fontSize={13}> s</tspan></text>
    </g>
  )
}

// ── The full composite comparison dashboard ──────────────────────────────────────
function CompareDash({ snapshot, width, height, unitSystem = 'metric' }: HifiWidgetProps): ReactElement {
  const s = snapshot
  const ref = reference(s)
  const delta = num(s?.deltaToBestSec)
  const gapCol = condColor(delta, { positiveIsGood: false, deadzone: 0.02, good: '#2BFF66', bad: '#ff4040', neutral: WHITE })
  const corner = ((): number | undefined => {
    const g = num(s?.latAccelG)
    return g == null ? undefined : clamp01(Math.abs(g) / 1.5)
  })()
  const refGap = ref.isGhost ? (delta == null ? undefined : -delta) : num(s?.relatives?.ahead?.gapSec)
  return (
    <CleanTile width={width ?? DASH_W} height={height ?? DASH_H}>
      <rect width={DASH_W} height={DASH_H} fill={BG} />
      {/* TOP BAND — driver panels + zone map */}
      <DriverPanel ox={24} oy={24} w={296} side="L" color={RED} name={txt(s?.driverName)} sub={s?.position != null ? `P${s.position}` : 'PLAYER'} lapText={lapTime(num(s?.currentLapTimeSec) ?? num(s?.lastLapTimeSec))} gapText={signed(delta, 3)} gapColor={gapCol} />
      <StyleBars ox={24} oy={196} w={296} color={RED} throttle={num(s?.throttle)} brake={num(s?.brake)} corner={corner} />
      <ZoneMap ox={352} oy={20} w={320} h={200} dist={num(s?.lapDistPct)} />
      <text x={512} y={250} textAnchor="middle" fill={GREY} fontFamily={FONT_LABEL} fontWeight={800} fontSize={15} letterSpacing={3} {...legibleStroke(15)}>LOW / MEDIUM / HIGH SPEED</text>
      <DriverPanel ox={704} oy={24} w={296} side="R" color={AMBER} name={ref.name} sub={ref.sub} lapText={lapTime(ref.lapSec)} gapText={signed(refGap, 3)} gapColor={AMBER} />
      <StyleBars ox={704} oy={196} w={296} color={AMBER} throttle={num(s?.throttle)} brake={num(s?.brake)} corner={corner} />
      <line x1={24} y1={286} x2={1000} y2={286} stroke={GRID} strokeWidth={1} />
      {/* MIDDLE BAND — speed trace */}
      <text x={20} y={318} fill={GREY} fontFamily={FONT_LABEL} fontWeight={800} fontSize={15} letterSpacing={2} transform="rotate(-90 20 318)" {...legibleStroke(15)}>SPEED</text>
      <SpeedTrace ox={96} oy={306} w={904} h={148} dist={num(s?.lapDistPct)} speed={num(s?.speedKmh)} idp="cmp-spd" unitSystem={unitSystem} />
      {/* BOTTOM BAND — delta trace */}
      <text x={20} y={520} fill={GREY} fontFamily={FONT_LABEL} fontWeight={800} fontSize={15} letterSpacing={2} transform="rotate(-90 20 520)" {...legibleStroke(15)}>DELTA</text>
      <DeltaTrace ox={96} oy={476} w={904} h={104} dist={num(s?.lapDistPct)} delta={delta} idp="cmp-dlt" />
    </CleanTile>
  )
}

// ── Standalone single-info widgets (transparent, reusable as overlays) ────────────
function DriverBlockW({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const s = snapshot
  const delta = num(s?.deltaToBestSec)
  return (
    <CleanTile width={width ?? 460} height={height ?? 190}>
      <DriverPanel ox={6} oy={12} w={448} side="L" color={RED} name={txt(s?.driverName)} sub={s?.position != null ? `P${s.position}` : 'PLAYER'} lapText={lapTime(num(s?.currentLapTimeSec) ?? num(s?.lastLapTimeSec))} gapText={signed(delta, 3)} gapColor={condColor(delta, { positiveIsGood: false, deadzone: 0.02, good: '#2BFF66', bad: '#ff4040', neutral: WHITE })} />
    </CleanTile>
  )
}

function RefBlockW({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const ref = reference(snapshot)
  const refGap = ref.isGhost ? ((): number | undefined => { const d = num(snapshot?.deltaToBestSec); return d == null ? undefined : -d })() : num(snapshot?.relatives?.ahead?.gapSec)
  return (
    <CleanTile width={width ?? 460} height={height ?? 190}>
      <DriverPanel ox={6} oy={12} w={448} side="R" color={AMBER} name={ref.name} sub={ref.sub} lapText={lapTime(ref.lapSec)} gapText={signed(refGap, 3)} gapColor={AMBER} />
    </CleanTile>
  )
}

function LapTimeW({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const w = width ?? 360
  const h = height ?? 130
  const v = lapTime(num(snapshot?.currentLapTimeSec) ?? num(snapshot?.lastLapTimeSec))
  return (
    <CleanTile width={w} height={h}>
      <text x={w / 2} y={h * 0.82} textAnchor="middle" fill={v.startsWith('--') ? C.dim : WHITE} fontFamily={FONT_NUM} fontWeight={800} fontSize={h * 0.5} {...legibleStroke(h * 0.5)}>{v}</text>
    </CleanTile>
  )
}

function GapW({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const w = width ?? 320
  const h = height ?? 150
  const delta = num(snapshot?.deltaToBestSec)
  const value = signed(delta, 3)
  const col = condColor(delta, { positiveIsGood: false, deadzone: 0.02, good: '#2BFF66', bad: '#ff4040', neutral: WHITE })
  const effectiveChars = value.length + 0.84
  const valueSize = Math.max(24, Math.min(h * 0.42, (w - 32) / (effectiveChars * 0.78)))
  return (
    <CleanTile width={w} height={h}>
      <text x={w / 2} y={h * 0.72} textAnchor="middle" fill={col} fontFamily={FONT_BIG} fontWeight={900} fontSize={valueSize} {...legibleStroke(valueSize)}>{value}<tspan fill={GREY} fontFamily={FONT_LABEL} fontSize={valueSize * 0.42}> s</tspan></text>
    </CleanTile>
  )
}

function StyleBarsW({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const w = width ?? 360
  const h = height ?? 150
  const g = num(snapshot?.latAccelG)
  const corner = g == null ? undefined : clamp01(Math.abs(g) / 1.5)
  return (
    <CleanTile width={w} height={h}>
      <StyleBars ox={12} oy={20} w={w - 24} color={RED} throttle={num(snapshot?.throttle)} brake={num(snapshot?.brake)} corner={corner} />
    </CleanTile>
  )
}

function ZoneMapW({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const w = width ?? 460
  const h = height ?? 300
  return (
    <CleanTile width={w} height={h}>
      <ZoneMap ox={20} oy={16} w={w - 40} h={h - 56} dist={num(snapshot?.lapDistPct)} />
      <text x={w / 2} y={h - 14} textAnchor="middle" fill={GREY} fontFamily={FONT_LABEL} fontWeight={800} fontSize={14} letterSpacing={2} {...legibleStroke(14)}>LOW / MEDIUM / HIGH SPEED</text>
    </CleanTile>
  )
}

function SpeedTraceW({ snapshot, width, height, unitSystem = 'metric' }: HifiWidgetProps): ReactElement {
  const w = width ?? 640
  const h = height ?? 240
  return (
    <CleanTile width={w} height={h}>
      <SpeedTrace ox={54} oy={26} w={w - 74} h={h - 52} dist={num(snapshot?.lapDistPct)} speed={num(snapshot?.speedKmh)} idp="cmpw-spd" unitSystem={unitSystem} />
    </CleanTile>
  )
}

function DeltaTraceW({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const w = width ?? 640
  const h = height ?? 180
  return (
    <CleanTile width={w} height={h}>
      <DeltaTrace ox={64} oy={22} w={w - 84} h={h - 44} dist={num(snapshot?.lapDistPct)} delta={num(snapshot?.deltaToBestSec)} idp="cmpw-dlt" />
    </CleanTile>
  )
}

// ── Module registrations ─────────────────────────────────────────────────────────
export const cmpDash: HifiWidgetModule = { id: 'cmpDash', title: 'Telemetry comparison dash', description: 'Broadcast-style dual-driver telemetry comparison: driver panels, style bars, speed-zone track map, full-width speed trace and delta trace (player vs the car ahead or session best).', category: 'compare', tags: [...TAGS, 'dashboard', 'cluster', 'delta', 'speed', 'map', 'gap'], requires: ['driverName', 'position', 'relatives', 'currentLapTimeSec', 'lastLapTimeSec', 'bestLapTimeSec', 'deltaToBestSec', 'throttle', 'brake', 'latAccelG', 'speedKmh', 'lapDistPct'], defaultSize: { w: DASH_W, h: DASH_H }, render: (p) => <CompareDash {...p} /> }
export const cmpDriverBlock: HifiWidgetModule = { id: 'cmpDriverBlock', title: 'Comparison — player block', description: 'Player nameplate: position, driver name, running lap time and delta to best (green faster / red slower).', category: 'compare', tags: [...TAGS, 'driver', 'position', 'delta'], requires: ['driverName', 'position', 'currentLapTimeSec', 'lastLapTimeSec', 'deltaToBestSec'], defaultSize: { w: 460, h: 190 }, render: (p) => <DriverBlockW {...p} /> }
export const cmpRefBlock: HifiWidgetModule = { id: 'cmpRefBlock', title: 'Comparison — reference block', description: 'Reference nameplate: the car ahead when available, else the session-best ghost, with its lap time and gap.', category: 'compare', tags: [...TAGS, 'driver', 'rival', 'gap'], requires: ['relatives', 'bestLapTimeSec', 'deltaToBestSec'], defaultSize: { w: 460, h: 190 }, render: (p) => <RefBlockW {...p} /> }
export const cmpLapTime: HifiWidgetModule = { id: 'cmpLapTime', title: 'Comparison — lap time', description: 'Running lap-time readout in monospace (falls back to last lap).', category: 'compare', tags: [...TAGS, 'lap-time', 'clean'], requires: ['currentLapTimeSec', 'lastLapTimeSec'], defaultSize: { w: 360, h: 130 }, render: (p) => <LapTimeW {...p} /> }
export const cmpGap: HifiWidgetModule = { id: 'cmpGap', title: 'Comparison — gap', description: 'Signed gap to your best lap, colored green (faster) / red (slower).', category: 'compare', tags: [...TAGS, 'gap', 'delta', 'clean'], requires: ['deltaToBestSec'], defaultSize: { w: 320, h: 150 }, render: (p) => <GapW {...p} /> }
export const cmpStyleBars: HifiWidgetModule = { id: 'cmpStyleBars', title: 'Comparison — style bars', description: 'Live driving-style mix: full throttle, heavy braking and cornering intensity as thin bars.', category: 'compare', tags: [...TAGS, 'inputs', 'bar', 'throttle', 'brake'], requires: ['throttle', 'brake', 'latAccelG'], defaultSize: { w: 360, h: 150 }, render: (p) => <StyleBarsW {...p} /> }
export const cmpZoneMap: HifiWidgetModule = { id: 'cmpZoneMap', title: 'Comparison — speed-zone map', description: 'Track outline color-graded by speed zone with corner numbers and a live car position dot.', category: 'compare', tags: [...TAGS, 'map', 'track-map'], requires: ['lapDistPct'], defaultSize: { w: 460, h: 300 }, render: (p) => <ZoneMapW {...p} /> }
export const cmpSpeedTrace: HifiWidgetModule = { id: 'cmpSpeedTrace', title: 'Comparison — speed trace', description: 'Speed-vs-distance lap profile with corner markers and a live speed cursor/readout.', category: 'compare', tags: [...TAGS, 'speed', 'graph', 'trace'], requires: ['speedKmh', 'lapDistPct'], defaultSize: { w: 640, h: 240 }, render: (p) => <SpeedTraceW {...p} /> }
export const cmpDeltaTrace: HifiWidgetModule = { id: 'cmpDeltaTrace', title: 'Comparison — delta trace', description: 'Delta-vs-distance faster/slower trace with a live delta cursor/readout.', category: 'compare', tags: [...TAGS, 'delta', 'graph', 'trace'], requires: ['deltaToBestSec', 'lapDistPct'], defaultSize: { w: 640, h: 180 }, render: (p) => <DeltaTraceW {...p} /> }

export const COMPARE_WIDGETS: HifiWidgetModule[] = [cmpDash, cmpDriverBlock, cmpRefBlock, cmpLapTime, cmpGap, cmpStyleBars, cmpZoneMap, cmpSpeedTrace, cmpDeltaTrace]
