// ── renderForm ────────────────────────────────────────────────────────────────
// Given a telemetry VARIABLE, a FORM and a size, render the reading as pure SVG.
// Reuses the SSR-safe @simx/instruments primitives (AnalogDial, RevLedBar,
// SegmentReadout, DataTile) plus the new Pixel32, and hand-rolls compact SVG for
// bignum/bar/barv/ring so the whole matrix renders under renderToStaticMarkup and
// never emits NaN/undefined markup.
import { arc } from 'd3-shape'
import { type ReactElement } from 'react'
import { AnalogDial } from '../instruments/AnalogDial'
import { RevLedBar } from '../instruments/RevLedBar'
import { SegmentReadout } from '../instruments/SegmentReadout'
import { DataTile } from '../instruments/DataTile'
import { INSTRUMENT_COLORS, clamp01, type InstrumentColors } from '../instruments/tokens'
import { Pixel32 } from './Pixel32'
import type { WidgetForm } from './forms'
import { readVariable, type ReadingState, type WidgetVariable } from './variables'
import type { TelemetrySnapshot } from '../../../shared/telemetry'

export interface RenderFormOptions {
  width?: number
  height?: number
  colors?: Partial<InstrumentColors>
}

function stateColor(state: ReadingState, c: InstrumentColors): string {
  switch (state) {
    case 'crit':
      return c.danger
    case 'warn':
      return c.warn
    case 'ok':
      return c.good
    default:
      return c.text
  }
}

/** Render one variable in one visual form as a self-contained SVG element. */
export function renderForm(
  variable: WidgetVariable,
  form: WidgetForm,
  snapshot: TelemetrySnapshot,
  opts: RenderFormOptions = {}
): ReactElement {
  const c: InstrumentColors = { ...INSTRUMENT_COLORS, ...(opts.colors ?? {}) }
  const w = opts.width ?? 200
  const h = opts.height ?? 120
  const r = readVariable(variable, snapshot)
  const valueColor = stateColor(r.state, c)
  const label = variable.label
  const warnValue = variable.warnFrom != null ? variable.min + variable.warnFrom * (variable.max - variable.min) : undefined
  const redlineValue = variable.redlineFrom != null ? variable.min + variable.redlineFrom * (variable.max - variable.min) : undefined

  switch (form) {
    case 'gauge':
      return (
        <AnalogDial
          value={r.value}
          min={variable.min}
          max={variable.max}
          size={Math.min(w, h)}
          unit={variable.unit}
          label={label}
          decimals={variable.decimals}
          warnFrom={variable.invert ? undefined : warnValue}
          redlineFrom={variable.invert ? undefined : redlineValue}
          needleColor={variable.invert ? valueColor : undefined}
          colors={opts.colors}
        />
      )

    case 'led':
      return (
        <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={label}>
          <rect x={0.5} y={0.5} width={w - 1} height={h - 1} rx={6} fill={c.surface} stroke={c.stroke} />
          <text x={8} y={16} fill={c.textMuted} fontFamily="'Rajdhani',sans-serif" fontSize={10} letterSpacing={1.5}>
            {label.toUpperCase()}
          </text>
          <RevLedBar pct={r.fraction} x={8} y={24} width={w - 16} height={Math.max(14, h * 0.3)} colors={opts.colors} />
          <text x={w / 2} y={h - 12} fill={valueColor} textAnchor="middle" fontFamily="'Chakra Petch',monospace" fontSize={Math.min(26, h * 0.28)} fontWeight={700}>
            {r.text}
            {r.unit ? <tspan fill={c.textDim} fontSize={11}> {r.unit}</tspan> : null}
          </text>
        </svg>
      )

    case 'segment7':
      return (
        <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={label}>
          <rect x={0.5} y={0.5} width={w - 1} height={h - 1} rx={6} fill={c.surface} stroke={c.stroke} />
          <text x={8} y={16} fill={c.textMuted} fontFamily="'Rajdhani',sans-serif" fontSize={10} letterSpacing={1.5}>
            {label.toUpperCase()}
          </text>
          <g transform={`translate(${w / 2}, ${h / 2 + 6})`}>
            <SegmentReadout value={r.text} height={Math.min(46, h * 0.5)} color={valueColor} align="center" unit={r.unit} />
          </g>
        </svg>
      )

    case 'tile':
      return <DataTile label={label} value={r.text} unit={r.unit} width={w} height={h} color={valueColor} accent={c.accent} />

    case 'pixel32':
      return <Pixel32 fraction={r.fraction} valueText={r.text} label={label} unit={r.unit} width={w} height={h} invert={variable.invert} colors={opts.colors} />

    case 'bar':
      return barForm(r.text, r.fraction, r.unit, valueColor, c, w, h, label, 'h')

    case 'barv':
      return barForm(r.text, r.fraction, r.unit, valueColor, c, w, h, label, 'v')

    case 'ring':
      return ringForm(r.text, r.fraction, r.unit, valueColor, c, w, h, label)

    case 'bignum':
    default:
      return (
        <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={label}>
          <rect x={0.5} y={0.5} width={w - 1} height={h - 1} rx={6} fill={c.surface} stroke={c.stroke} />
          <text x={8} y={18} fill={c.textMuted} fontFamily="'Rajdhani',sans-serif" fontSize={11} letterSpacing={1.5}>
            {label.toUpperCase()}
          </text>
          <text x={w / 2} y={h / 2 + h * 0.18} fill={valueColor} textAnchor="middle" fontFamily="'Michroma','Chakra Petch',sans-serif" fontWeight={700} fontSize={Math.min(h * 0.5, w * 0.34)}>
            {r.text}
          </text>
          {r.unit ? (
            <text x={w - 8} y={h - 8} fill={c.textDim} textAnchor="end" fontFamily="'Rajdhani',sans-serif" fontSize={12}>
              {r.unit}
            </text>
          ) : null}
        </svg>
      )
  }
}

function barForm(
  text: string,
  fraction: number,
  unit: string,
  valueColor: string,
  c: InstrumentColors,
  w: number,
  h: number,
  label: string,
  orientation: 'h' | 'v'
): ReactElement {
  // `invert` variables (fuel/wear/grip) only flip the WARN/CRIT colour via state —
  // the bar still fills to the real fraction (never fuller as the value drops).
  const frac = clamp01(fraction)
  const horizontalTrackWidth = Math.max(0, w - 16)
  const horizontalTrackY = Math.max(0, h - 30)
  const verticalTrackX = Math.max(0, w - 26)
  const verticalTrackY = Math.max(0, Math.min(22, h))
  const verticalTrackHeight = Math.max(0, h - 34)
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={label}>
      <rect x={0.5} y={0.5} width={w - 1} height={h - 1} rx={6} fill={c.surface} stroke={c.stroke} />
      <text x={8} y={16} fill={c.textMuted} fontFamily="'Rajdhani',sans-serif" fontSize={10} letterSpacing={1.5}>
        {label.toUpperCase()}
      </text>
      {orientation === 'h' ? (
        <>
          <rect x={8} y={horizontalTrackY} width={horizontalTrackWidth} height={12} rx={4} fill={c.recess} stroke={c.stroke} strokeWidth={0.5} />
          <rect x={8} y={horizontalTrackY} width={horizontalTrackWidth * frac} height={12} rx={4} fill={valueColor} />
          <text x={8} y={h * 0.5} fill={valueColor} fontFamily="'Chakra Petch',monospace" fontWeight={700} fontSize={Math.min(24, h * 0.32)}>
            {text}
            {unit ? <tspan fill={c.textDim} fontSize={11}> {unit}</tspan> : null}
          </text>
        </>
      ) : (
        <>
          <rect x={verticalTrackX} y={verticalTrackY} width={14} height={verticalTrackHeight} rx={4} fill={c.recess} stroke={c.stroke} strokeWidth={0.5} />
          <rect x={verticalTrackX} y={verticalTrackY + verticalTrackHeight * (1 - frac)} width={14} height={verticalTrackHeight * frac} rx={4} fill={valueColor} />
          <text x={8} y={h * 0.55} fill={valueColor} fontFamily="'Chakra Petch',monospace" fontWeight={700} fontSize={Math.min(22, h * 0.26)}>
            {text}
          </text>
          {unit ? (
            <text x={8} y={h * 0.55 + 16} fill={c.textDim} fontFamily="'Rajdhani',sans-serif" fontSize={11}>
              {unit}
            </text>
          ) : null}
        </>
      )}
    </svg>
  )
}

function ringForm(
  text: string,
  fraction: number,
  unit: string,
  valueColor: string,
  c: InstrumentColors,
  w: number,
  h: number,
  label: string
): ReactElement {
  const size = Math.min(w, h)
  const cx = w / 2
  const cy = h / 2 + 4
  const outer = size * 0.42
  const inner = size * 0.32
  const start = -Math.PI * 0.75
  const end = Math.PI * 0.75
  const frac = clamp01(fraction)
  const trackPath = arc()({ innerRadius: inner, outerRadius: outer, startAngle: start, endAngle: end }) ?? ''
  const valuePath = arc()({ innerRadius: inner, outerRadius: outer, startAngle: start, endAngle: start + (end - start) * frac }) ?? ''
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={label}>
      <rect x={0.5} y={0.5} width={w - 1} height={h - 1} rx={6} fill={c.surface} stroke={c.stroke} />
      <text x={8} y={16} fill={c.textMuted} fontFamily="'Rajdhani',sans-serif" fontSize={10} letterSpacing={1.5}>
        {label.toUpperCase()}
      </text>
      <g transform={`translate(${cx}, ${cy})`}>
        <path d={trackPath} fill={c.recess} stroke={c.stroke} strokeWidth={0.5} />
        <path d={valuePath} fill={valueColor} />
        <text y={4} fill={valueColor} textAnchor="middle" fontFamily="'Chakra Petch',monospace" fontWeight={700} fontSize={Math.min(22, size * 0.2)}>
          {text}
        </text>
        {unit ? (
          <text y={20} fill={c.textDim} textAnchor="middle" fontFamily="'Rajdhani',sans-serif" fontSize={10}>
            {unit}
          </text>
        ) : null}
      </g>
    </svg>
  )
}
