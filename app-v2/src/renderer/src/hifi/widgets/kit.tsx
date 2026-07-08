// ── Hi-fi widget kit ──────────────────────────────────────────────────────────
// Shared SSR-safe SVG toolkit for the per-telemetry hi-fi widgets: colour tokens,
// NaN-safe number helpers, and small composable primitives (Frame, Bar, VBar,
// Gauge, LedRow, BigNum, Tile). Warm hues = decoration/alert; cool/green = good.
import { arc } from 'd3-shape'
import { type ReactElement, type ReactNode } from 'react'

export const C = {
  bg: '#000000',
  panel: '#0b0d10',
  stroke: 'rgba(255,255,255,0.10)',
  text: '#f5f7fa',
  dim: '#9aa3ad',
  muted: '#5b636c',
  cyan: '#22c3ff',
  amber: '#ffb020',
  red: '#ff3b30',
  green: '#22e06a',
  blue: '#2f7bff',
  recess: '#15181c'
}

export const FONT_NUM = "'Chakra Petch','Michroma',monospace"
export const FONT_BIG = "'Michroma','Chakra Petch',sans-serif"
export const FONT_LABEL = "'Rajdhani','Barlow Condensed',sans-serif"

export function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const p = Number.parseFloat(v)
    return Number.isFinite(p) ? p : undefined
  }
  return undefined
}
export function clamp01(x: number): number {
  return Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0
}
/** 0..1 fraction of value within [min,max] (NaN-safe). */
export function frac(v: number | undefined, min: number, max: number): number {
  if (v == null || !Number.isFinite(v) || max === min) return 0
  return clamp01((v - min) / (max - min))
}
export function fixed(v: number | undefined, d = 0): string {
  return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(d) : '—'
}
export function lapTime(sec: number | undefined): string {
  if (typeof sec !== 'number' || !Number.isFinite(sec) || sec <= 0) return '--:--.---'
  const m = Math.floor(sec / 60)
  const s = sec - m * 60
  return `${m}:${s.toFixed(3).padStart(6, '0')}`
}
export function signed(v: number | undefined, d = 2): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—'
  return `${v >= 0 ? '+' : ''}${v.toFixed(d)}`
}
export function gearLabel(g: number | undefined): string {
  if (typeof g !== 'number' || !Number.isFinite(g)) return '–'
  if (g < 0) return 'R'
  if (g === 0) return 'N'
  return String(Math.trunc(g))
}
/** Cold→hot temperature colour (blue→green→amber→red). */
export function tempColor(t: number | undefined, cold = 70, hot = 95): string {
  if (typeof t !== 'number' || !Number.isFinite(t)) return C.dim
  if (t < cold) return C.cyan
  if (t < (cold + hot) / 2) return C.green
  if (t < hot) return C.amber
  return C.red
}

/** Standard widget frame: rounded panel + small top label; content via children. */
export function Frame({
  w,
  h,
  label,
  children,
  accent
}: {
  w: number
  h: number
  label?: string
  children?: ReactNode
  accent?: string
}): ReactElement {
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} preserveAspectRatio="xMidYMid meet" role="img" aria-label={label ?? 'widget'}>
      <rect x={0.5} y={0.5} width={w - 1} height={h - 1} rx={12} fill={C.panel} stroke={C.stroke} />
      {label ? (
        <text x={14} y={22} fill={accent ?? C.dim} fontFamily={FONT_LABEL} fontSize={13} fontWeight={700} letterSpacing={2}>
          {label.toUpperCase()}
        </text>
      ) : null}
      {children}
    </svg>
  )
}

/** Horizontal fill bar (0..1) with colour. */
export function Bar({ x, y, w, h, f, color }: { x: number; y: number; w: number; h: number; f: number; color: string }): ReactElement {
  return (
    <>
      <rect x={x} y={y} width={w} height={h} rx={h / 2} fill={C.recess} stroke={C.stroke} strokeWidth={0.5} />
      <rect x={x} y={y} width={Math.max(0, w * clamp01(f))} height={h} rx={h / 2} fill={color} />
    </>
  )
}

/** Vertical fill bar (0..1), fills bottom-up. */
export function VBar({ x, y, w, h, f, color }: { x: number; y: number; w: number; h: number; f: number; color: string }): ReactElement {
  const fh = Math.max(0, h * clamp01(f))
  return (
    <>
      <rect x={x} y={y} width={w} height={h} rx={w / 2} fill={C.recess} stroke={C.stroke} strokeWidth={0.5} />
      <rect x={x} y={y + h - fh} width={w} height={fh} rx={w / 2} fill={color} />
    </>
  )
}

/** Radial gauge arc (0..1) centred at cx,cy; sweep −135°→135°. */
export function GaugeArc({ cx, cy, r, thickness, f, color }: { cx: number; cy: number; r: number; thickness: number; f: number; color: string }): ReactElement {
  const start = -Math.PI * 0.75
  const end = Math.PI * 0.75
  const inner = r - thickness
  const track = arc()({ innerRadius: inner, outerRadius: r, startAngle: start, endAngle: end }) ?? ''
  const val = arc()({ innerRadius: inner, outerRadius: r, startAngle: start, endAngle: start + (end - start) * clamp01(f) }) ?? ''
  return (
    <g transform={`translate(${cx},${cy})`}>
      <path d={track} fill={C.recess} stroke={C.stroke} strokeWidth={0.5} />
      <path d={val} fill={color} />
    </g>
  )
}

/** LED segment row (0..1) with green→amber→red ramp. */
export function LedRow({ x, y, w, h, f, count = 12 }: { x: number; y: number; w: number; h: number; f: number; count?: number }): ReactElement {
  const lit = Math.round(clamp01(f) * count)
  const gap = 3
  const cw = (w - gap * (count - 1)) / count
  const cells: ReactElement[] = []
  for (let i = 0; i < count; i++) {
    const z = i / (count - 1)
    const color = z < 0.5 ? C.green : z < 0.8 ? C.amber : C.red
    cells.push(<rect key={i} x={x + i * (cw + gap)} y={y} width={cw} height={h} rx={2} fill={i < lit ? color : C.recess} opacity={i < lit ? 1 : 0.5} />)
  }
  return <g>{cells}</g>
}

/** Big centred numeric value + optional unit. */
export function BigNum({ x, y, value, unit, color, size }: { x: number; y: number; value: string; unit?: string; color: string; size: number }): ReactElement {
  return (
    <text x={x} y={y} textAnchor="middle" fill={color} fontFamily={FONT_BIG} fontWeight={800} fontSize={size}>
      {value}
      {unit ? <tspan fill={C.dim} fontFamily={FONT_LABEL} fontSize={size * 0.32}> {unit}</tspan> : null}
    </text>
  )
}
