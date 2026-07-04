// Dependency-free SVG charts for the Career & Ratings Hub.
//
// Pure presentational components — no external charting library, no data
// fetching, no business logic. They take already-normalized series (human units
// from the main process) and draw clean, hairline motorsport-style line/bar
// charts that inherit the app's theme tokens via CSS-variable colours.

import { type CSSProperties, type ReactElement, useId } from 'react'
import type { CareerChartPoint, CareerIncidentPoint } from '../../../../shared/career'

const GRID_STROKE = 'rgba(255,255,255,0.05)'
const BASELINE_STROKE = 'rgba(255,255,255,0.10)'
const AXIS_TEXT = 'rgba(240,235,224,0.42)'

const emptyBox: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: 132,
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--surface-sunken)',
  color: 'var(--text-muted)',
  fontSize: 12,
  letterSpacing: '0.04em',
  textTransform: 'uppercase'
}

// Even-stride downsample that always keeps the final point, so very long series
// (hundreds of races) stay light without dropping the latest rating.
function downsample<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items
  const out: T[] = []
  const step = items.length / max
  for (let i = 0; i < max; i += 1) out.push(items[Math.floor(i * step)])
  const last = items[items.length - 1]
  if (out[out.length - 1] !== last) out.push(last)
  return out
}

function fmtAxisDate(when: string): string {
  const ms = Date.parse(when)
  if (!Number.isFinite(ms)) return ''
  return new Date(ms).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })
}

interface HistoryChartProps {
  points: CareerChartPoint[]
  // CSS colour (a `var(--…)` token or literal) for the line + area.
  color: string
  // Decimal places for the Y labels + latest value (0 for iRating, 2 for SR).
  valueDigits: number
  ariaLabel: string
  height?: number
}

// Single time-series line chart with a subtle area fill, min/max Y labels, a
// few date ticks and a highlighted latest point.
export function HistoryChart({ points, color, valueDigits, ariaLabel, height = 184 }: HistoryChartProps): ReactElement {
  // useId can contain ':' which is awkward inside url(#…) refs — strip to keep a
  // clean, unique gradient id.
  const gradientId = `career-grad-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  if (points.length === 0) {
    return <div style={emptyBox}>sem dados</div>
  }

  const width = 720
  const pad = { top: 16, right: 16, bottom: 26, left: 48 }
  const innerW = width - pad.left - pad.right
  const innerH = height - pad.top - pad.bottom

  const series = downsample(points, 320)
  const values = series.map((point) => point.value)
  const rawMin = Math.min(...values)
  const rawMax = Math.max(...values)
  const margin = Math.max((rawMax - rawMin) * 0.08, valueDigits === 0 ? 20 : 0.1)
  const min = rawMin - margin
  const max = rawMax + margin
  const span = max - min || 1

  // Position points by time when every timestamp parses and spans a range;
  // otherwise fall back to even index spacing.
  const times = series.map((point) => Date.parse(point.when))
  const timesOk = times.every((time) => Number.isFinite(time))
  const tMin = timesOk ? Math.min(...times) : 0
  const tMax = timesOk ? Math.max(...times) : 0
  const tSpan = tMax - tMin
  const xAt = (index: number): number => {
    if (timesOk && tSpan > 0) return ((times[index] - tMin) / tSpan) * innerW
    return series.length > 1 ? (index / (series.length - 1)) * innerW : innerW / 2
  }
  const yAt = (value: number): number => innerH - ((value - min) / span) * innerH

  const linePoints = series.map((point, index) => `${xAt(index).toFixed(1)},${yAt(point.value).toFixed(1)}`).join(' ')
  const areaPath = `M${xAt(0).toFixed(1)},${innerH.toFixed(1)} L${series
    .map((point, index) => `${xAt(index).toFixed(1)},${yAt(point.value).toFixed(1)}`)
    .join(' L')} L${xAt(series.length - 1).toFixed(1)},${innerH.toFixed(1)} Z`

  const last = series[series.length - 1]
  const lastX = xAt(series.length - 1)
  const lastY = yAt(last.value)
  const dateTicks = series.length > 1 ? [0, Math.floor((series.length - 1) / 2), series.length - 1] : [0]

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label={ariaLabel} style={{ display: 'block' }}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: color }} stopOpacity={0.22} />
          <stop offset="100%" style={{ stopColor: color }} stopOpacity={0} />
        </linearGradient>
      </defs>
      <g transform={`translate(${pad.left} ${pad.top})`}>
        {[0, 0.5, 1].map((tick) => {
          const y = tick * innerH
          const value = max - tick * span
          return (
            <g key={tick}>
              <line x1={0} y1={y} x2={innerW} y2={y} stroke={tick === 1 ? BASELINE_STROKE : GRID_STROKE} />
              <text x={-8} y={y + 3} fill={AXIS_TEXT} fontSize={10} textAnchor="end" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {value.toFixed(valueDigits)}
              </text>
            </g>
          )
        })}
        <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
        <polyline points={linePoints} fill="none" style={{ stroke: color }} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={lastX} cy={lastY} r={3.2} style={{ fill: color }} />
        {dateTicks.map((index) => (
          <text
            key={index}
            x={xAt(index)}
            y={innerH + 18}
            fill={AXIS_TEXT}
            fontSize={10}
            textAnchor={index === 0 ? 'start' : index === series.length - 1 ? 'end' : 'middle'}
          >
            {fmtAxisDate(series[index].when)}
          </text>
        ))}
      </g>
    </svg>
  )
}

// Colour bands for per-race incident counts (iRacing "x" points). Clean (0) is
// success, a couple is fine, more trends toward warning/danger.
function incidentColor(incidents: number): string {
  if (incidents <= 0) return 'var(--accent-success)'
  if (incidents <= 4) return 'var(--text-secondary)'
  if (incidents <= 8) return 'var(--accent-warning)'
  return 'var(--accent-danger)'
}

interface IncidentTrendChartProps {
  points: CareerIncidentPoint[]
  height?: number
}

// Per-race incident bars (oldest → newest) with a dashed average line.
export function IncidentTrendChart({ points, height = 168 }: IncidentTrendChartProps): ReactElement {
  if (points.length === 0) {
    return <div style={emptyBox}>sem corridas recentes</div>
  }

  const width = 720
  const pad = { top: 14, right: 16, bottom: 22, left: 32 }
  const innerW = width - pad.left - pad.right
  const innerH = height - pad.top - pad.bottom

  const series = downsample(points, 80)
  const maxIncidents = Math.max(...series.map((point) => point.incidents), 1)
  const avg = series.reduce((sum, point) => sum + point.incidents, 0) / series.length
  const slot = innerW / series.length
  const barW = Math.max(2, Math.min(16, slot * 0.62))
  const yAt = (value: number): number => innerH - (value / maxIncidents) * innerH
  const avgY = yAt(avg)

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label="Tendência de incidentes por corrida" style={{ display: 'block' }}>
      <g transform={`translate(${pad.left} ${pad.top})`}>
        {[0, 0.5, 1].map((tick) => {
          const y = tick * innerH
          return (
            <g key={tick}>
              <line x1={0} y1={y} x2={innerW} y2={y} stroke={tick === 1 ? BASELINE_STROKE : GRID_STROKE} />
              <text x={-8} y={y + 3} fill={AXIS_TEXT} fontSize={10} textAnchor="end" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {Math.round(maxIncidents - tick * maxIncidents)}
              </text>
            </g>
          )
        })}
        {series.map((point, index) => {
          const x = index * slot + (slot - barW) / 2
          const y = yAt(point.incidents)
          return (
            <rect
              key={`${index}-${point.subsessionId}`}
              x={x}
              y={y}
              width={barW}
              height={Math.max(0, innerH - y)}
              rx={1}
              style={{ fill: incidentColor(point.incidents) }}
              fillOpacity={0.9}
            />
          )
        })}
        <line x1={0} y1={avgY} x2={innerW} y2={avgY} strokeWidth={1} strokeDasharray="4 3" style={{ stroke: 'var(--accent-primary)' }} />
        <text x={innerW} y={Math.max(10, avgY - 4)} fontSize={10} textAnchor="end" style={{ fill: 'var(--accent-primary)', fontVariantNumeric: 'tabular-nums' }}>
          méd {avg.toFixed(1)}
        </text>
      </g>
    </svg>
  )
}
