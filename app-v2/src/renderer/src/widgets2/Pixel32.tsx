// ── Pixel32 ───────────────────────────────────────────────────────────────────
// A retro "32-bit"/pixel-matrix readout primitive for the widget-matrix factory.
// Renders a blocky pixel bar (fraction → lit cells) plus a chunky pixel value,
// giving the distinct 8/16/32-bit arcade-cluster look requested for the "pixel"
// widget form. Pure SVG, SSR-safe (renderToStaticMarkup) and NaN-safe: any null /
// extreme telemetry value clamps to the 0..1 range and never emits NaN markup.
import { type ReactElement } from 'react'
import { INSTRUMENT_COLORS, clamp01, revZoneColor, safe, type InstrumentColors } from '../instruments/tokens'

export interface Pixel32Props {
  /** Fill fraction 0..1 (NaN/undefined → 0). */
  fraction: number
  /** Preformatted value text drawn under the pixel bar (e.g. "247"). */
  valueText?: string
  label?: string
  unit?: string
  width?: number
  height?: number
  /** Number of pixel columns in the bar (default 16). */
  cols?: number
  /** Number of pixel rows in the bar (default 4). */
  rows?: number
  /** Low value = bad (e.g. fuel): inverts the green→red ramp. */
  invert?: boolean
  colors?: Partial<InstrumentColors>
}

/**
 * Pixel-matrix telemetry readout. The bar lights `round(fraction * cols)` columns
 * with a green→amber→red ramp (or reversed when `invert`), each column a stack of
 * square "pixels" with a 1px gutter, over a recessed dark grid.
 */
export function Pixel32({
  fraction,
  valueText,
  label,
  unit,
  width = 180,
  height = 96,
  cols = 16,
  rows = 4,
  invert = false,
  colors
}: Pixel32Props): ReactElement {
  const c: InstrumentColors = { ...INSTRUMENT_COLORS, ...(colors ?? {}) }
  const frac = clamp01(fraction)
  const nCols = Math.max(1, Math.trunc(safe(cols, 16)))
  const nRows = Math.max(1, Math.trunc(safe(rows, 4)))
  const lit = Math.round(frac * nCols)

  const padX = 6
  const padTop = label ? 16 : 6
  const barH = Math.max(8, Math.round(height * 0.42))
  const gutter = 2
  const barAvailW = Math.max(0, width - padX * 2 - gutter * (nCols - 1))
  const barAvailH = Math.max(0, barH - gutter * (nRows - 1))
  const cellW = barAvailW / nCols
  const cellH = barAvailH / nRows

  const cells: ReactElement[] = []
  for (let ci = 0; ci < nCols; ci++) {
    const on = ci < lit
    // Colour each lit column by its position along the bar so the ramp reads L→R.
    const rampFrac = invert ? 1 - (ci + 0.5) / nCols : (ci + 0.5) / nCols
    const onColor = revZoneColor(rampFrac, c)
    for (let ri = 0; ri < nRows; ri++) {
      const x = padX + ci * (cellW + gutter)
      const y = padTop + ri * (cellH + gutter)
      cells.push(
        <rect
          key={`${ci}-${ri}`}
          x={x}
          y={y}
          width={cellW}
          height={cellH}
          rx={1}
          fill={on ? onColor : c.recess}
          stroke={on ? onColor : c.stroke}
          strokeWidth={0.5}
          opacity={on ? 1 : 0.6}
        />
      )
    }
  }

  const valueY = padTop + barH + Math.min(34, height - padTop - barH - 4)

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={label ?? 'pixel readout'}
    >
      <rect x={0.5} y={0.5} width={width - 1} height={height - 1} rx={6} fill={c.surface} stroke={c.stroke} />
      {label ? (
        <text x={padX} y={12} fill={c.textMuted} fontFamily="'Rajdhani','Barlow Condensed',sans-serif" fontSize={10} letterSpacing={1.5}>
          {label.toUpperCase()}
        </text>
      ) : null}
      {cells}
      {valueText != null ? (
        <text
          x={width / 2}
          y={valueY}
          fill={c.text}
          textAnchor="middle"
          fontFamily="'Chakra Petch','Michroma',monospace"
          fontSize={Math.min(30, Math.round((height - barH - padTop) * 0.8))}
          fontWeight={700}
          letterSpacing={1}
        >
          {valueText}
          {unit ? <tspan fill={c.textDim} fontSize={11}> {unit}</tspan> : null}
        </text>
      ) : null}
    </svg>
  )
}
