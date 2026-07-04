// Reusable GT3-cluster tile primitives shared by the full-frame dashboard replicas
// (gridStackDash, gridProDash, bosch296Dash, ringDash). These mirror the visual
// language of real GT3 dashes (Bosch / Cosworth ICD / AiM): black surfaces, thin
// per-metric accent borders, a small UPPERCASE condensed label over a big DSEG
// numeric value, colour-coded by metric/state. Pure presentational — every input is
// optional and degrades to "—" so a null snapshot never renders NaN/undefined.
import type { CSSProperties, ReactElement, ReactNode } from 'react'
import './dashboard-replicas.css'

// ── Tokens (warm chrome / state-coded, per the GT3 colour rule) ────────────────
export const DASH = {
  black: '#000000',
  panel: '#0a0a0a',
  stroke: '#202020',
  text: '#F4F4F4',
  textDim: '#8A8A8A',
  white: '#FFFFFF',
  yellow: '#FFD400',
  green: '#1AFF6E',
  magenta: '#FF2DD0',
  red: '#FF3B30',
  blue: '#2B7BFF',
  cyan: '#00E5FF',
  amber: '#FFB800',
  orange: '#FF7A00',
  cold: '#00BFFF',
  hot: '#FF3B30'
} as const

export const FONT_NUM = "var(--rc-num, 'DSEG7Classic-Regular', 'Cascadia Code', monospace)"
export const FONT_COND = "var(--rc-cond, 'Chakra Petch', 'Michroma', sans-serif)"
export const FONT_TECH = "var(--rc-heavy, 'Rajdhani', 'Barlow Condensed', sans-serif)"

// ── Numeral-only DSEG discipline ──────────────────────────────────────────────
// DSEG 7-seg renders garbled for letters/symbols, and has NO glyph for %, + or ±.
// Use DSEG (FONT_NUM) for pure numeric readouts ONLY; route any letter/label/unit
// text OR a %/+/± symbol to the condensed face (FONT_COND) / DSEG14 unit slot.
export function isNumericReadout(v: unknown): boolean {
  return typeof v === 'string' && /^\s*[-−]?\d[\d.,:\s]*$/.test(v)
}

export function readoutFont(v: ReactNode): string {
  return typeof v === 'string' && !isNumericReadout(v) ? FONT_COND : FONT_NUM
}

export function gearFont(g: string): string {
  return /^\d$/.test(g) ? FONT_NUM : FONT_COND
}

export function num(value: number | undefined, digits = 0): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  return value.toFixed(digits)
}

export function tempColor(c: number | undefined, cold = 70, hot = 105): string {
  if (c === undefined || !Number.isFinite(c)) return DASH.textDim
  if (c <= cold) return DASH.cold
  if (c >= hot) return DASH.hot
  return DASH.text
}

// ── StatTile: the universal bordered box (label + value [+ unit]) ──────────────
export interface StatTileProps {
  label: string
  value: ReactNode
  unit?: string
  accent?: string // border + label colour
  valueColor?: string // overrides value colour (state)
  fill?: string // tile background
  align?: 'left' | 'center' | 'right'
  valueFont?: string
  valueScale?: number // 0..1 of tile height for the value font
  style?: CSSProperties
}

export function StatTile({
  label,
  value,
  unit,
  accent = DASH.stroke,
  valueColor,
  fill = DASH.black,
  align = 'center',
  valueFont = undefined,
  valueScale = 0.46,
  style
}: StatTileProps): ReactElement {
  const effFont = valueFont ?? readoutFont(value)
  return (
    <div className="dr-tile" style={{ borderColor: accent, background: fill, textAlign: align, ...style }}>
      <span className="dr-tile-label" style={{ color: accent, fontFamily: FONT_COND }}>{label}</span>
      <span className="dr-tile-value" style={{ color: valueColor ?? DASH.text, fontFamily: effFont, fontSize: `clamp(12px, ${Math.round(valueScale * 100)}cqh, 96px)` }}>
        {value}
        {unit ? <small className="dr-tile-unit" style={{ fontFamily: FONT_COND }}>{unit}</small> : null}
      </span>
    </div>
  )
}

// ── CoinButton: a rounded colour-coded control coin (Aston bottom row) ─────────
export function CoinButton({ label, value, color }: { label: string; value: ReactNode; color: string }): ReactElement {
  return (
    <div className="dr-coin-wrap">
      <span className="dr-coin" style={{ borderColor: color, color }}>
        <b style={{ fontFamily: readoutFont(value) }}>{value}</b>
      </span>
      <span className="dr-coin-label" style={{ fontFamily: FONT_COND }}>{label}</span>
    </div>
  )
}

// ── TyreGrid2x2: per-corner temp or pressure with cold/hot/warn colour ─────────
export interface TyreCell {
  value: number | undefined
  color?: string
}

export function TyreGrid2x2({
  label,
  cells,
  digits = 0,
  unit
}: {
  label?: string
  cells: { lf: TyreCell; rf: TyreCell; lr: TyreCell; rr: TyreCell }
  digits?: number
  unit?: string
}): ReactElement {
  const Cell = ({ c }: { c: TyreCell }): ReactElement => (
    <span className="dr-tyre-cell" style={{ color: c.color ?? DASH.text, fontFamily: FONT_NUM }}>
      {num(c.value, digits)}
    </span>
  )
  return (
    <div className="dr-tyre-grid">
      {label ? <span className="dr-tyre-title" style={{ fontFamily: FONT_COND }}>{label}{unit ? ` ${unit}` : ''}</span> : null}
      <div className="dr-tyre-cells">
        <Cell c={cells.lf} />
        <Cell c={cells.rf} />
        <Cell c={cells.lr} />
        <Cell c={cells.rr} />
      </div>
    </div>
  )
}

// ── LapTimesStack: LL / SB / PB (or LAST / BEST) colour-coded rows ─────────────
export interface LapRow {
  label: string
  value: string
  color: string
}

export function LapTimesStack({ rows }: { rows: LapRow[] }): ReactElement {
  return (
    <div className="dr-laps">
      {rows.map((r) => (
        <div key={r.label} className="dr-lap-row" style={{ borderColor: r.color }}>
          <span className="dr-lap-label" style={{ fontFamily: FONT_TECH }}>{r.label}</span>
          <span className="dr-lap-value" style={{ color: r.color, fontFamily: FONT_NUM }}>{r.value}</span>
        </div>
      ))}
    </div>
  )
}

// ── GapBar: vertical gap-to-car indicator (Ferrari right pod) ──────────────────
export function GapBar({ gapSec, max = 2, label = 'GAP' }: { gapSec: number | undefined; max?: number; label?: string }): ReactElement {
  const has = gapSec !== undefined && Number.isFinite(gapSec)
  const frac = has ? Math.max(0, Math.min(1, Math.abs(gapSec as number) / max)) : 0
  return (
    <div className="dr-gapbar">
      <span className="dr-gapbar-label" style={{ color: DASH.amber, fontFamily: FONT_COND }}>{label}</span>
      <div className="dr-gapbar-track">
        <i className="dr-gapbar-fill" style={{ height: `${frac * 100}%`, background: DASH.amber }} />
      </div>
      <span className="dr-gapbar-value" style={{ fontFamily: FONT_NUM }}>{has ? Math.abs(gapSec as number).toFixed(2) : '—'}</span>
    </div>
  )
}

// ── DualPedalBar: throttle (green) + brake (red) mini bars ─────────────────────
export function DualPedalBar({ throttle, brake }: { throttle: number; brake: number }): ReactElement {
  return (
    <div className="dr-pedals">
      <div className="dr-pedal"><i style={{ width: `${Math.max(0, Math.min(1, throttle)) * 100}%`, background: DASH.green }} /></div>
      <div className="dr-pedal"><i style={{ width: `${Math.max(0, Math.min(1, brake)) * 100}%`, background: DASH.red }} /></div>
    </div>
  )
}
