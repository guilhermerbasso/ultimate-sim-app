import { useSurfaceRole } from '../a11y'
import type { ReactElement } from 'react'
import type { HifiWidgetProps } from '../types'
import type {
  ComplexCornersModel,
  ComplexMapModel,
  ComplexRadarModel,
  ComplexStatusModel,
  ComplexSteeringModel,
  ComplexTableModel,
  ComplexTelemetryArchetype,
  ComplexTelemetryDescriptor,
  ComplexTelemetryModel,
  ComplexVectorAxis,
  ComplexVectorModel
} from './complex-types'
import type { TelemetryTone, TelemetryVariant } from './types'
import {
  convertMeasurement,
  DEFAULT_UNIT_SYSTEM,
  formatMeasurement,
  measurementKindForUnit,
  measurementUnit,
  type UnitSystem
} from '../../../../../shared/units'

const TEXT = '#F5F7FA'
const DIM = '#8D98A3'
const MUTED = '#56616C'
const TRACK = 'rgba(255,255,255,0.13)'
const COMP = 'var(--overlay-accent, #F5F7FA)'
const FUTURE = 'var(--overlay-accent, #35C8E8)'
const DDU = 'var(--overlay-accent, #FFB000)'
const GOOD = 'var(--widget-good, #22E06A)'
const INFO = 'var(--widget-info, #2F7BFF)'
const WARNING = 'var(--widget-warn, #FFB020)'
const DANGER = 'var(--widget-danger, #FF3B30)'
const PURPLE = 'var(--widget-purple, #B05CFF)'
const FONT_DATA = "var(--overlay-font, 'Chakra Petch', 'Bahnschrift', monospace)"
const FONT_LABEL = "var(--overlay-font, 'Rajdhani', 'Barlow Condensed', sans-serif)"

interface CanvasSize {
  w: number
  h: number
}

const SIZES: Record<TelemetryVariant, Record<ComplexTelemetryArchetype, CanvasSize>> = {
  competition: {
    table: { w: 560, h: 330 },
    radar: { w: 360, h: 340 },
    map: { w: 460, h: 300 },
    vector: { w: 400, h: 320 },
    corners: { w: 460, h: 320 },
    status: { w: 360, h: 180 },
    steering: { w: 420, h: 220 }
  },
  futuristic: {
    table: { w: 580, h: 330 },
    radar: { w: 380, h: 350 },
    map: { w: 480, h: 300 },
    vector: { w: 420, h: 320 },
    corners: { w: 480, h: 320 },
    status: { w: 380, h: 180 },
    steering: { w: 440, h: 220 }
  },
  ddu: {
    table: { w: 520, h: 300 },
    radar: { w: 340, h: 310 },
    map: { w: 440, h: 270 },
    vector: { w: 380, h: 290 },
    corners: { w: 420, h: 290 },
    status: { w: 340, h: 160 },
    steering: { w: 400, h: 200 }
  }
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function toneColor(tone: TelemetryTone | undefined, accent: string): string {
  switch (tone) {
    case 'good':
      return GOOD
    case 'info':
      return INFO
    case 'warning':
      return WARNING
    case 'danger':
      return DANGER
    case 'neutral':
      return DIM
    default:
      return accent
  }
}

function textStroke(size: number): {
  stroke: string
  strokeWidth: number
  paintOrder: 'stroke'
  strokeLinejoin: 'round'
} {
  return {
    stroke: 'rgba(0,0,0,0.64)',
    strokeWidth: Math.max(1.5, size * 0.045),
    paintOrder: 'stroke',
    strokeLinejoin: 'round'
  }
}

function fitText(text: string, base: number, maxChars: number, floor = 11): number {
  return Math.max(floor, base * Math.min(1, maxChars / Math.max(1, text.length)))
}

function labelText(text: string | undefined, x: number, y: number, color: string, anchor: 'start' | 'middle' | 'end' = 'start', size = 14): ReactElement | null {
  if (!text) return null
  return (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      fill={color}
      fontFamily={FONT_LABEL}
      fontSize={size}
      fontWeight={800}
      letterSpacing={1.6}
      {...textStroke(size)}
    >
      {text.toUpperCase()}
    </text>
  )
}

function Root({
  descriptor,
  variant,
  size,
  props,
  children
}: {
  descriptor: ComplexTelemetryDescriptor
  variant: TelemetryVariant
  size: CanvasSize
  props: HifiWidgetProps
  children: ReactElement
}): ReactElement {
  return (
    <svg
      viewBox={`0 0 ${size.w} ${size.h}`}
      width={props.width ?? size.w}
      height={props.height ?? size.h}
      preserveAspectRatio="xMidYMid meet"
      {...useSurfaceRole()}
      aria-label={`${descriptor.label} ${variant}`}
      style={{ display: 'block' }}
    >
      {children}
    </svg>
  )
}

function emptyModel(archetype: ComplexTelemetryArchetype): ComplexTelemetryModel {
  switch (archetype) {
    case 'table':
      return { kind: 'table', column: '', rows: [], available: false }
    case 'radar':
      return { kind: 'radar', cars: [], side: 'clear', available: false }
    case 'map':
      return { kind: 'map', available: false }
    case 'vector':
      return { kind: 'vector', axes: [], available: false }
    case 'corners':
      return { kind: 'corners', unit: '', decimals: 0, cells: [], available: false }
    case 'status':
      return { kind: 'status', primary: '—', tone: 'neutral', available: false }
    default:
      return { kind: 'steering', available: false }
  }
}

function safeRead(
  descriptor: ComplexTelemetryDescriptor,
  snapshot: HifiWidgetProps['snapshot'],
  unitSystem: UnitSystem
): ComplexTelemetryModel {
  try {
    const model = descriptor.read(snapshot)
    if (model?.kind !== descriptor.archetype) return emptyModel(descriptor.archetype)
    if (model.kind === 'vector') {
      return {
        ...model,
        axes: model.axes.map((axis) => {
          const kind = measurementKindForUnit(axis.unit)
          return kind
            ? {
                ...axis,
                value: convertMeasurement(axis.value, kind, unitSystem),
                unit: measurementUnit(kind, unitSystem)
              }
            : axis
        })
      }
    }
    if (model.kind === 'corners') {
      const kind = measurementKindForUnit(model.unit)
      if (!kind) return model
      return {
        ...model,
        unit: measurementUnit(kind, unitSystem),
        cells: model.cells.map((cell) => ({
          ...cell,
          values: cell.values.map((value) => convertMeasurement(value, kind, unitSystem))
        }))
      }
    }
    return model
  } catch {
    return emptyModel(descriptor.archetype)
  }
}

function rowValueColor(tone: TelemetryTone | undefined, accent: string, available: boolean): string {
  if (!available) return DIM
  return toneColor(tone, accent)
}

function CompetitionTable({
  descriptor,
  model,
  size
}: {
  descriptor: ComplexTelemetryDescriptor
  model: ComplexTableModel
  size: CanvasSize
}): ReactElement {
  const rows = model.rows.slice(0, 7)
  const top = 39
  const rowH = 39
  return (
    <g>
      {labelText(descriptor.context ?? model.column, 18, 23, COMP)}
      <text x={size.w - 18} y={23} textAnchor="end" fill={DIM} fontFamily={FONT_LABEL} fontSize={12} fontWeight={800} letterSpacing={1.4} {...textStroke(12)}>
        POS · CAR · DRIVER
      </text>
      {rows.length ? rows.map((row, index) => {
        const y = top + index * rowH
        const accent = row.isPlayer ? COMP : row.classColor ?? DIM
        const valueColor = rowValueColor(row.tone, accent, row.value !== '—')
        return (
          <g key={row.key}>
            <rect x={12} y={y + 4} width={row.isPlayer ? 6 : 3} height={rowH - 8} rx={1.5} fill={accent} />
            <line x1={24} y1={y + rowH - 2} x2={size.w - 14} y2={y + rowH - 2} stroke={TRACK} strokeWidth={1} />
            <text x={28} y={y + 27} fill={TEXT} fontFamily={FONT_DATA} fontSize={18} fontWeight={900} {...textStroke(18)}>
              {row.position == null ? '—' : `P${Math.trunc(row.position)}`}
            </text>
            <text x={94} y={y + 27} fill={accent} fontFamily={FONT_DATA} fontSize={17} fontWeight={900} {...textStroke(17)}>
              {row.carNumber ? `#${row.carNumber}` : '—'}
            </text>
            <text x={158} y={y + 27} fill={row.isPlayer ? TEXT : DIM} fontFamily={FONT_LABEL} fontSize={18} fontWeight={800} {...textStroke(18)}>
              {row.name ?? '—'}
            </text>
            <text x={size.w - 18} y={y + 28} textAnchor="end" fill={valueColor} fontFamily={FONT_DATA} fontSize={20} fontWeight={900} {...textStroke(20)}>
              {row.value}
            </text>
          </g>
        )
      }) : (
        <text x={size.w / 2} y={size.h / 2 + 12} textAnchor="middle" fill={DIM} fontFamily={FONT_DATA} fontSize={54} fontWeight={800} {...textStroke(54)}>—</text>
      )}
    </g>
  )
}

function FuturisticTable({
  descriptor,
  model,
  size
}: {
  descriptor: ComplexTelemetryDescriptor
  model: ComplexTableModel
  size: CanvasSize
}): ReactElement {
  const rows = model.rows.slice(0, 7)
  const top = 37
  const rowH = 40
  return (
    <g>
      <path d={`M 10 28 H 160 L 172 16 H ${size.w - 12}`} fill="none" stroke={FUTURE} strokeWidth={2} opacity={0.72} />
      {labelText(descriptor.context ?? model.column, 18, 22, FUTURE)}
      {rows.length ? rows.map((row, index) => {
        const y = top + index * rowH
        const accent = row.isPlayer ? FUTURE : row.classColor ?? MUTED
        const fraction = finite(row.fraction)
        return (
          <g key={row.key}>
            <polygon points={`12,${y + 8} 20,${y + 2} 20,${y + rowH - 4} 12,${y + rowH - 10}`} fill={accent} opacity={row.isPlayer ? 1 : 0.6} />
            <line x1={28} y1={y + rowH - 3} x2={size.w - 12} y2={y + rowH - 3} stroke={FUTURE} strokeWidth={1} opacity={0.22} />
            <text x={30} y={y + 26} fill={TEXT} fontFamily={FONT_DATA} fontSize={17} fontWeight={900} {...textStroke(17)}>
              {row.position == null ? '—' : String(Math.trunc(row.position)).padStart(2, '0')}
            </text>
            <text x={77} y={y + 26} fill={accent} fontFamily={FONT_DATA} fontSize={16} fontWeight={900} {...textStroke(16)}>
              {row.carNumber ? `#${row.carNumber}` : '—'}
            </text>
            <text x={140} y={y + 26} fill={row.isPlayer ? TEXT : DIM} fontFamily={FONT_LABEL} fontSize={17} fontWeight={800} {...textStroke(17)}>
              {row.name ?? '—'}
            </text>
            {fraction != null ? (
              <>
                <rect x={size.w - 190} y={y + 31} width={84} height={3} fill={TRACK} />
                <rect x={size.w - 190} y={y + 31} width={84 * clamp(fraction, 0, 1)} height={3} fill={accent} />
              </>
            ) : null}
            <text x={size.w - 16} y={y + 26} textAnchor="end" fill={rowValueColor(row.tone, accent, row.value !== '—')} fontFamily={FONT_DATA} fontSize={19} fontWeight={900} {...textStroke(19)}>
              {row.value}
            </text>
          </g>
        )
      }) : (
        <text x={size.w / 2} y={size.h / 2 + 10} textAnchor="middle" fill={DIM} fontFamily={FONT_DATA} fontSize={52} {...textStroke(52)}>—</text>
      )}
    </g>
  )
}

function DduTable({
  descriptor,
  model,
  size
}: {
  descriptor: ComplexTelemetryDescriptor
  model: ComplexTableModel
  size: CanvasSize
}): ReactElement {
  const rows = model.rows.slice(0, 7)
  const top = 34
  const rowH = 36
  return (
    <g>
      {labelText(descriptor.context ?? model.column, 14, 21, DDU)}
      <text x={size.w - 14} y={21} textAnchor="end" fill={MUTED} fontFamily={FONT_DATA} fontSize={11} fontWeight={700} letterSpacing={1} {...textStroke(11)}>POS / NO / DRIVER / VALUE</text>
      <line x1={12} y1={28} x2={size.w - 12} y2={28} stroke={DDU} strokeWidth={2} />
      {rows.length ? rows.map((row, index) => {
        const y = top + index * rowH
        const accent = row.isPlayer ? DDU : row.classColor ?? MUTED
        return (
          <g key={row.key}>
            <rect x={12} y={y + 5} width={row.isPlayer ? 7 : 3} height={24} fill={accent} />
            <line x1={24} y1={y + rowH - 1} x2={size.w - 12} y2={y + rowH - 1} stroke={TRACK} strokeWidth={1} />
            <text x={28} y={y + 25} fill={TEXT} fontFamily={FONT_DATA} fontSize={16} fontWeight={800} {...textStroke(16)}>
              {row.position == null ? '--' : String(Math.trunc(row.position)).padStart(2, '0')}
            </text>
            <text x={72} y={y + 25} fill={accent} fontFamily={FONT_DATA} fontSize={15} fontWeight={800} {...textStroke(15)}>
              {row.carNumber ? row.carNumber.padStart(3, '0') : '---'}
            </text>
            <text x={122} y={y + 25} fill={DIM} fontFamily={FONT_LABEL} fontSize={16} fontWeight={800} {...textStroke(16)}>
              {row.name ?? '—'}
            </text>
            <text x={size.w - 14} y={y + 25} textAnchor="end" fill={rowValueColor(row.tone, row.isPlayer ? DDU : TEXT, row.value !== '—')} fontFamily={FONT_DATA} fontSize={17} fontWeight={900} {...textStroke(17)}>
              {row.value}
            </text>
          </g>
        )
      }) : (
        <text x={size.w / 2} y={size.h / 2 + 8} textAnchor="middle" fill={DIM} fontFamily={FONT_DATA} fontSize={48} {...textStroke(48)}>—</text>
      )}
    </g>
  )
}

function radarPoint(car: ComplexRadarModel['cars'][number], size: CanvasSize): { x: number; y: number } {
  const cx = size.w / 2
  const cy = size.h / 2
  return {
    x: cx + clamp(car.x, -5, 5) * ((size.w - 86) / 10),
    y: cy - clamp(car.y, -50, 50) * ((size.h - 82) / 100)
  }
}

function PlayerCar({ cx, cy, color }: { cx: number; cy: number; color: string }): ReactElement {
  return (
    <g>
      <path d={`M ${cx} ${cy - 28} L ${cx + 15} ${cy - 16} L ${cx + 19} ${cy + 21} L ${cx + 8} ${cy + 29} H ${cx - 8} L ${cx - 19} ${cy + 21} L ${cx - 15} ${cy - 16} Z`} fill="rgba(255,255,255,0.05)" stroke={color} strokeWidth={2.5} />
      <line x1={cx} y1={cy - 22} x2={cx} y2={cy + 23} stroke={color} strokeWidth={2} opacity={0.7} />
    </g>
  )
}

function RadarCars({
  model,
  size,
  accent,
  futuristic = false,
  ddu = false
}: {
  model: ComplexRadarModel
  size: CanvasSize
  accent: string
  futuristic?: boolean
  ddu?: boolean
}): ReactElement {
  return (
    <g>
      {model.cars.map((car) => {
        const p = radarPoint(car, size)
        const color = car.isAlongside ? WARNING : car.color ?? accent
        const labelY = clamp(p.y - 10, 18, size.h - 12)
        return (
          <g key={car.key}>
            {futuristic ? <circle cx={p.x} cy={p.y} r={car.isAlongside ? 13 : 9} fill="none" stroke={color} strokeWidth={2} opacity={0.55} /> : null}
            <rect x={p.x - (ddu ? 6 : 8)} y={p.y - (ddu ? 10 : 13)} width={ddu ? 12 : 16} height={ddu ? 20 : 26} rx={ddu ? 1 : 4} fill={color} opacity={0.94} />
            <text x={p.x} y={labelY} textAnchor="middle" fill={TEXT} fontFamily={FONT_DATA} fontSize={10} fontWeight={800} {...textStroke(10)}>
              {car.gapSec == null ? car.label ?? '' : `${car.gapSec >= 0 ? '+' : ''}${car.gapSec.toFixed(1)}`}
            </text>
          </g>
        )
      })}
    </g>
  )
}

function CompetitionRadar({
  descriptor,
  model,
  size
}: {
  descriptor: ComplexTelemetryDescriptor
  model: ComplexRadarModel
  size: CanvasSize
}): ReactElement {
  const cx = size.w / 2
  const cy = size.h / 2
  return (
    <g>
      {labelText(descriptor.context, 16, 23, COMP)}
      <line x1={cx} y1={32} x2={cx} y2={size.h - 24} stroke={TRACK} strokeWidth={1} />
      <line x1={36} y1={cy} x2={size.w - 36} y2={cy} stroke={TRACK} strokeWidth={1} />
      {[42, 82, 122].map((radius) => <ellipse key={radius} cx={cx} cy={cy} rx={radius * 0.72} ry={radius} fill="none" stroke={TRACK} strokeWidth={1} />)}
      <PlayerCar cx={cx} cy={cy} color={COMP} />
      <RadarCars model={model} size={size} accent={COMP} />
      <text x={cx} y={size.h - 8} textAnchor="middle" fill={model.side === 'clear' ? DIM : WARNING} fontFamily={FONT_LABEL} fontSize={15} fontWeight={900} letterSpacing={2} {...textStroke(15)}>
        {model.available ? (model.side === 'both' ? 'THREE WIDE' : model.side === 'clear' ? 'CLEAR' : `${model.side.toUpperCase()} SIDE`) : '—'}
      </text>
    </g>
  )
}

function FuturisticRadar({
  descriptor,
  model,
  size
}: {
  descriptor: ComplexTelemetryDescriptor
  model: ComplexRadarModel
  size: CanvasSize
}): ReactElement {
  const cx = size.w / 2
  const cy = size.h / 2
  return (
    <g>
      {labelText(descriptor.context, 18, 23, FUTURE)}
      {[46, 86, 126].map((radius, index) => (
        <polygon
          key={radius}
          points={`${cx},${cy - radius} ${cx + radius * 0.72},${cy} ${cx},${cy + radius} ${cx - radius * 0.72},${cy}`}
          fill="none"
          stroke={FUTURE}
          strokeWidth={index === 0 ? 2 : 1}
          opacity={0.18 + index * 0.08}
        />
      ))}
      <line x1={cx} y1={28} x2={cx} y2={size.h - 24} stroke={FUTURE} strokeWidth={1} opacity={0.35} />
      <line x1={28} y1={cy} x2={size.w - 28} y2={cy} stroke={FUTURE} strokeWidth={1} opacity={0.35} />
      <PlayerCar cx={cx} cy={cy} color={FUTURE} />
      <RadarCars model={model} size={size} accent={FUTURE} futuristic />
      <path d={`M 14 ${size.h - 26} H 90 L 102 ${size.h - 14} H ${size.w - 14}`} fill="none" stroke={FUTURE} strokeWidth={2} opacity={0.6} />
      <text x={size.w - 18} y={size.h - 17} textAnchor="end" fill={model.side === 'clear' ? DIM : WARNING} fontFamily={FONT_DATA} fontSize={14} fontWeight={900} {...textStroke(14)}>
        {model.available ? model.side.toUpperCase() : '—'}
      </text>
    </g>
  )
}

function DduRadar({
  descriptor,
  model,
  size
}: {
  descriptor: ComplexTelemetryDescriptor
  model: ComplexRadarModel
  size: CanvasSize
}): ReactElement {
  const cx = size.w / 2
  const cy = size.h / 2 + 4
  return (
    <g>
      {labelText(descriptor.context, 14, 20, DDU)}
      <rect x={42} y={34} width={size.w - 84} height={size.h - 68} fill="none" stroke={TRACK} strokeWidth={2} />
      <line x1={cx} y1={34} x2={cx} y2={size.h - 34} stroke={TRACK} strokeWidth={1} />
      <line x1={42} y1={cy} x2={size.w - 42} y2={cy} stroke={TRACK} strokeWidth={1} />
      <line x1={cx - 36} y1={34} x2={cx - 36} y2={size.h - 34} stroke={TRACK} strokeWidth={1} strokeDasharray="3 5" />
      <line x1={cx + 36} y1={34} x2={cx + 36} y2={size.h - 34} stroke={TRACK} strokeWidth={1} strokeDasharray="3 5" />
      <PlayerCar cx={cx} cy={cy} color={DDU} />
      <RadarCars model={model} size={size} accent={DDU} ddu />
      <text x={size.w - 14} y={20} textAnchor="end" fill={model.side === 'clear' ? DIM : WARNING} fontFamily={FONT_DATA} fontSize={13} fontWeight={900} {...textStroke(13)}>
        {model.available ? model.side.toUpperCase() : '—'}
      </text>
    </g>
  )
}

const TRACK_POINTS: Array<[number, number]> = Array.from({ length: 72 }, (_, index) => {
  const angle = (index / 72) * Math.PI * 2
  const radius = 0.51 + 0.13 * Math.sin(angle * 3) + 0.055 * Math.cos(angle * 5)
  return [
    0.5 + Math.cos(angle) * radius * 0.44,
    0.5 + Math.sin(angle) * radius * 0.37
  ]
})

const SECTOR_COLORS = [PURPLE, FUTURE, GOOD]

function trackPoint(progress: number): [number, number] {
  const normalized = ((progress % 1) + 1) % 1
  const scaled = normalized * TRACK_POINTS.length
  const index = Math.floor(scaled) % TRACK_POINTS.length
  const next = (index + 1) % TRACK_POINTS.length
  const mix = scaled - Math.floor(scaled)
  const a = TRACK_POINTS[index]
  const b = TRACK_POINTS[next]
  return [a[0] + (b[0] - a[0]) * mix, a[1] + (b[1] - a[1]) * mix]
}

function MapTrack({
  model,
  x,
  y,
  width,
  height,
  strokeWidth,
  accent,
  opacity = 1,
  ddu = false
}: {
  model: ComplexMapModel
  x: number
  y: number
  width: number
  height: number
  strokeWidth: number
  accent: string
  opacity?: number
  ddu?: boolean
}): ReactElement {
  const sx = (value: number): number => x + value * width
  const sy = (value: number): number => y + value * height
  const progress = finite(model.progress)
  const marker = progress == null ? null : trackPoint(progress)
  return (
    <g opacity={opacity}>
      {TRACK_POINTS.map((point, index) => {
        const next = TRACK_POINTS[(index + 1) % TRACK_POINTS.length]
        const sector = Math.min(2, Math.floor(index / (TRACK_POINTS.length / 3)))
        return (
          <line
            key={index}
            x1={sx(point[0])}
            y1={sy(point[1])}
            x2={sx(next[0])}
            y2={sy(next[1])}
            stroke={ddu ? (sector === 0 ? accent : sector === 1 ? TEXT : DIM) : SECTOR_COLORS[sector]}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />
        )
      })}
      {[0, 1, 2].map((sector) => {
        const point = trackPoint(sector / 3 + 0.025)
        return (
          <text key={sector} x={sx(point[0])} y={sy(point[1]) - 9} textAnchor="middle" fill={ddu ? accent : SECTOR_COLORS[sector]} fontFamily={FONT_DATA} fontSize={11} fontWeight={900} {...textStroke(11)}>
            S{sector + 1}
          </text>
        )
      })}
      {marker ? (
        <g>
          <circle cx={sx(marker[0])} cy={sy(marker[1])} r={ddu ? 7 : 9} fill={accent} stroke={ddu ? TEXT : DANGER} strokeWidth={3} />
          <circle cx={sx(marker[0])} cy={sy(marker[1])} r={ddu ? 12 : 15} fill="none" stroke={accent} strokeWidth={1} opacity={0.45} />
        </g>
      ) : null}
    </g>
  )
}

function mapPrimary(model: ComplexMapModel, unitSystem: UnitSystem): string {
  if (finite(model.distanceM) != null) {
    return formatMeasurement(model.distanceM, 'distance-m', unitSystem, {
      decimals: 0,
      includeUnit: true
    }).display
  }
  if (finite(model.trackLengthKm) != null) {
    return formatMeasurement(model.trackLengthKm, 'distance-km', unitSystem, {
      decimals: 3,
      includeUnit: true
    }).display
  }
  if (finite(model.lat) != null && finite(model.lon) != null) return `${model.lat?.toFixed(4)} · ${model.lon?.toFixed(4)}`
  return '—'
}

function mapSecondary(model: ComplexMapModel, unitSystem: UnitSystem): string {
  if (finite(model.progress) != null) return `${((model.progress ?? 0) * 100).toFixed(1)}% LAP`
  if (finite(model.altitudeM) != null) {
    return `${formatMeasurement(model.altitudeM, 'distance-m', unitSystem, {
      decimals: 0,
      includeUnit: true
    }).display} ALT`
  }
  return ''
}

function CompetitionMap({
  descriptor,
  model,
  size,
  unitSystem
}: {
  descriptor: ComplexTelemetryDescriptor
  model: ComplexMapModel
  size: CanvasSize
  unitSystem: UnitSystem
}): ReactElement {
  return (
    <g>
      {labelText(descriptor.context, 16, 23, COMP)}
      <MapTrack model={model} x={44} y={30} width={size.w - 88} height={size.h - 82} strokeWidth={6} accent={COMP} opacity={model.available ? 1 : 0.34} />
      <text x={16} y={size.h - 18} fill={model.available ? COMP : DIM} fontFamily={FONT_DATA} fontSize={20} fontWeight={900} {...textStroke(20)}>{mapPrimary(model, unitSystem)}</text>
      <text x={size.w - 16} y={size.h - 18} textAnchor="end" fill={DIM} fontFamily={FONT_LABEL} fontSize={14} fontWeight={800} letterSpacing={1.5} {...textStroke(14)}>{mapSecondary(model, unitSystem)}</text>
    </g>
  )
}

function FuturisticMap({
  descriptor,
  model,
  size,
  unitSystem
}: {
  descriptor: ComplexTelemetryDescriptor
  model: ComplexMapModel
  size: CanvasSize
  unitSystem: UnitSystem
}): ReactElement {
  return (
    <g>
      {labelText(descriptor.context, 18, 22, FUTURE)}
      <path d={`M 12 31 H 118 L 132 17 H ${size.w - 12}`} fill="none" stroke={FUTURE} strokeWidth={2} opacity={0.62} />
      <MapTrack model={model} x={46} y={32} width={size.w - 92} height={size.h - 86} strokeWidth={5} accent={FUTURE} opacity={model.available ? 1 : 0.3} />
      <line x1={size.w / 2} y1={43} x2={size.w / 2} y2={size.h - 52} stroke={FUTURE} strokeWidth={1} opacity={0.12} />
      <line x1={44} y1={(size.h - 20) / 2} x2={size.w - 44} y2={(size.h - 20) / 2} stroke={FUTURE} strokeWidth={1} opacity={0.12} />
      <text x={18} y={size.h - 18} fill={model.available ? FUTURE : DIM} fontFamily={FONT_DATA} fontSize={19} fontWeight={900} {...textStroke(19)}>{mapPrimary(model, unitSystem)}</text>
      <text x={size.w - 18} y={size.h - 18} textAnchor="end" fill={TEXT} fontFamily={FONT_DATA} fontSize={15} fontWeight={800} {...textStroke(15)}>{mapSecondary(model, unitSystem)}</text>
    </g>
  )
}

function DduMap({
  descriptor,
  model,
  size,
  unitSystem
}: {
  descriptor: ComplexTelemetryDescriptor
  model: ComplexMapModel
  size: CanvasSize
  unitSystem: UnitSystem
}): ReactElement {
  return (
    <g>
      {labelText(descriptor.context, 14, 20, DDU)}
      <text x={size.w - 14} y={20} textAnchor="end" fill={DIM} fontFamily={FONT_DATA} fontSize={12} fontWeight={700} {...textStroke(12)}>S1 / S2 / S3</text>
      <MapTrack model={model} x={52} y={26} width={size.w - 104} height={size.h - 76} strokeWidth={5} accent={DDU} opacity={model.available ? 1 : 0.32} ddu />
      <line x1={12} y1={size.h - 38} x2={size.w - 12} y2={size.h - 38} stroke={DDU} strokeWidth={2} />
      <text x={14} y={size.h - 13} fill={model.available ? TEXT : DIM} fontFamily={FONT_DATA} fontSize={18} fontWeight={900} {...textStroke(18)}>{mapPrimary(model, unitSystem)}</text>
      <text x={size.w - 14} y={size.h - 13} textAnchor="end" fill={DDU} fontFamily={FONT_DATA} fontSize={14} fontWeight={900} {...textStroke(14)}>{mapSecondary(model, unitSystem)}</text>
    </g>
  )
}

function axisText(axis: ComplexVectorAxis): string {
  const value = finite(axis.value)
  if (value == null) return '—'
  const decimals = clamp(Math.trunc(axis.decimals ?? 2), 0, 3)
  const sign = axis.signed !== false && value > 0 ? '+' : ''
  return `${sign}${value.toFixed(decimals)}${axis.unit ? ` ${axis.unit}` : ''}`
}

function VectorValues({
  model,
  size,
  y,
  accent,
  compact = false
}: {
  model: ComplexVectorModel
  size: CanvasSize
  y: number
  accent: string
  compact?: boolean
}): ReactElement {
  const axes = model.axes.slice(0, 3)
  const cellW = size.w / Math.max(1, axes.length)
  return (
    <g>
      {axes.map((axis, index) => {
        const x = cellW * index + cellW / 2
        return (
          <g key={`${axis.label}-${index}`}>
            <text x={x} y={y} textAnchor="middle" fill={accent} fontFamily={FONT_LABEL} fontSize={compact ? 11 : 13} fontWeight={800} letterSpacing={1.2} {...textStroke(compact ? 11 : 13)}>{axis.label}</text>
            <text x={x} y={y + (compact ? 18 : 23)} textAnchor="middle" fill={axis.value == null ? DIM : TEXT} fontFamily={FONT_DATA} fontSize={fitText(axisText(axis), compact ? 15 : 18, 11, 10)} fontWeight={900} {...textStroke(compact ? 15 : 18)}>{axisText(axis)}</text>
          </g>
        )
      })}
    </g>
  )
}

function VectorArrow({
  model,
  cx,
  cy,
  radius,
  color
}: {
  model: ComplexVectorModel
  cx: number
  cy: number
  radius: number
  color: string
}): ReactElement | null {
  const x = finite(model.x)
  const y = finite(model.y)
  if (x == null || y == null) return null
  const px = cx + clamp(x, -1, 1) * radius
  const py = cy + clamp(y, -1, 1) * radius
  return (
    <g>
      <line x1={cx} y1={cy} x2={px} y2={py} stroke={color} strokeWidth={4} strokeLinecap="round" />
      <circle cx={px} cy={py} r={8} fill={color} stroke={TEXT} strokeWidth={2} />
      <circle cx={px} cy={py} r={14} fill="none" stroke={color} strokeWidth={1} opacity={0.45} />
    </g>
  )
}

function HeadingPointer({ model, cx, cy, radius, color }: { model: ComplexVectorModel; cx: number; cy: number; radius: number; color: string }): ReactElement | null {
  const heading = finite(model.headingRad)
  if (heading == null) return null
  const x = cx + Math.sin(heading) * radius
  const y = cy - Math.cos(heading) * radius
  return <circle cx={x} cy={y} r={4} fill={color} />
}

function CompetitionVector({
  descriptor,
  model,
  size
}: {
  descriptor: ComplexTelemetryDescriptor
  model: ComplexVectorModel
  size: CanvasSize
}): ReactElement {
  const cx = size.w / 2
  const cy = 132
  return (
    <g>
      {labelText(descriptor.context, 16, 23, COMP)}
      {[42, 82, 112].map((radius) => <circle key={radius} cx={cx} cy={cy} r={radius} fill="none" stroke={TRACK} strokeWidth={1} />)}
      <line x1={cx - 120} y1={cy} x2={cx + 120} y2={cy} stroke={COMP} strokeWidth={1} opacity={0.5} />
      <line x1={cx} y1={cy - 120} x2={cx} y2={cy + 120} stroke={COMP} strokeWidth={1} opacity={0.5} />
      <VectorArrow model={model} cx={cx} cy={cy} radius={108} color={COMP} />
      <HeadingPointer model={model} cx={cx} cy={cy} radius={118} color={WARNING} />
      <VectorValues model={model} size={size} y={size.h - 42} accent={COMP} />
    </g>
  )
}

function FuturisticVector({
  descriptor,
  model,
  size
}: {
  descriptor: ComplexTelemetryDescriptor
  model: ComplexVectorModel
  size: CanvasSize
}): ReactElement {
  const cx = size.w / 2
  const cy = 130
  return (
    <g>
      {labelText(descriptor.context, 18, 22, FUTURE)}
      {[44, 84, 116].map((radius, index) => (
        <polygon key={radius} points={`${cx},${cy - radius} ${cx + radius},${cy} ${cx},${cy + radius} ${cx - radius},${cy}`} fill="none" stroke={FUTURE} strokeWidth={index === 2 ? 2 : 1} opacity={0.18 + index * 0.11} />
      ))}
      <line x1={cx - 124} y1={cy} x2={cx + 124} y2={cy} stroke={FUTURE} strokeWidth={1} opacity={0.4} />
      <line x1={cx} y1={cy - 124} x2={cx} y2={cy + 124} stroke={FUTURE} strokeWidth={1} opacity={0.4} />
      <VectorArrow model={model} cx={cx} cy={cy} radius={110} color={FUTURE} />
      <HeadingPointer model={model} cx={cx} cy={cy} radius={120} color={WARNING} />
      <VectorValues model={model} size={size} y={size.h - 42} accent={FUTURE} />
    </g>
  )
}

function DduVector({
  descriptor,
  model,
  size
}: {
  descriptor: ComplexTelemetryDescriptor
  model: ComplexVectorModel
  size: CanvasSize
}): ReactElement {
  const cx = size.w / 2
  const cy = 120
  return (
    <g>
      {labelText(descriptor.context, 14, 20, DDU)}
      <rect x={72} y={30} width={size.w - 144} height={180} fill="none" stroke={TRACK} strokeWidth={2} />
      <line x1={72} y1={cy} x2={size.w - 72} y2={cy} stroke={TRACK} strokeWidth={1} />
      <line x1={cx} y1={30} x2={cx} y2={210} stroke={TRACK} strokeWidth={1} />
      <rect x={cx - 45} y={cy - 45} width={90} height={90} fill="none" stroke={TRACK} strokeWidth={1} strokeDasharray="4 5" />
      <VectorArrow model={model} cx={cx} cy={cy} radius={84} color={DDU} />
      <HeadingPointer model={model} cx={cx} cy={cy} radius={91} color={TEXT} />
      <VectorValues model={model} size={size} y={size.h - 38} accent={DDU} compact />
    </g>
  )
}

function cornerPrimary(cell: ComplexCornersModel['cells'][number]): number | undefined {
  const values = cell.values.map(finite).filter((value): value is number => value != null)
  if (!values.length) return undefined
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function cornerText(value: number | undefined, decimals: number): string {
  return value == null ? '—' : value.toFixed(clamp(decimals, 0, 2))
}

function CornerValue({
  cell,
  model,
  x,
  y,
  accent,
  anchor = 'middle',
  futuristic = false
}: {
  cell: ComplexCornersModel['cells'][number]
  model: ComplexCornersModel
  x: number
  y: number
  accent: string
  anchor?: 'start' | 'middle' | 'end'
  futuristic?: boolean
}): ReactElement {
  const primary = cornerPrimary(cell)
  const zones = cell.values.length > 1
  return (
    <g>
      <text x={x} y={y} textAnchor={anchor} fill={accent} fontFamily={FONT_LABEL} fontSize={14} fontWeight={900} letterSpacing={1.2} {...textStroke(14)}>{cell.key.toUpperCase()}</text>
      <text x={x} y={y + 39} textAnchor={anchor} fill={primary == null ? DIM : TEXT} fontFamily={FONT_DATA} fontSize={32} fontWeight={900} {...textStroke(32)}>{cornerText(primary, model.decimals)}</text>
      {zones ? (
        <text x={x} y={y + 61} textAnchor={anchor} fill={futuristic ? FUTURE : DIM} fontFamily={FONT_DATA} fontSize={11} fontWeight={800} {...textStroke(11)}>
          {cell.values.map((value) => cornerText(finite(value), model.decimals)).join(' / ')}
        </text>
      ) : null}
    </g>
  )
}

function CarSilhouette({ cx, cy, color }: { cx: number; cy: number; color: string }): ReactElement {
  return (
    <g opacity={0.72}>
      <path d={`M ${cx - 22} ${cy - 58} Q ${cx} ${cy - 76} ${cx + 22} ${cy - 58} L ${cx + 30} ${cy + 46} Q ${cx} ${cy + 64} ${cx - 30} ${cy + 46} Z`} fill="none" stroke={color} strokeWidth={2} />
      <rect x={cx - 39} y={cy - 43} width={13} height={34} rx={4} fill={color} opacity={0.45} />
      <rect x={cx + 26} y={cy - 43} width={13} height={34} rx={4} fill={color} opacity={0.45} />
      <rect x={cx - 39} y={cy + 16} width={13} height={34} rx={4} fill={color} opacity={0.45} />
      <rect x={cx + 26} y={cy + 16} width={13} height={34} rx={4} fill={color} opacity={0.45} />
    </g>
  )
}

function CompetitionCorners({
  descriptor,
  model,
  size
}: {
  descriptor: ComplexTelemetryDescriptor
  model: ComplexCornersModel
  size: CanvasSize
}): ReactElement {
  const cells = new Map(model.cells.map((cell) => [cell.key, cell]))
  const cx = size.w / 2
  const cy = 157
  return (
    <g>
      {labelText(descriptor.context, 16, 23, COMP)}
      <text x={size.w - 16} y={23} textAnchor="end" fill={DIM} fontFamily={FONT_LABEL} fontSize={13} fontWeight={800} {...textStroke(13)}>{model.unit}</text>
      <CarSilhouette cx={cx} cy={cy} color={COMP} />
      {cells.get('lf') ? <CornerValue cell={cells.get('lf')!} model={model} x={86} y={84} accent={COMP} anchor="middle" /> : null}
      {cells.get('rf') ? <CornerValue cell={cells.get('rf')!} model={model} x={size.w - 86} y={84} accent={COMP} anchor="middle" /> : null}
      {cells.get('lr') ? <CornerValue cell={cells.get('lr')!} model={model} x={86} y={220} accent={COMP} anchor="middle" /> : null}
      {cells.get('rr') ? <CornerValue cell={cells.get('rr')!} model={model} x={size.w - 86} y={220} accent={COMP} anchor="middle" /> : null}
    </g>
  )
}

function FuturisticCorners({
  descriptor,
  model,
  size
}: {
  descriptor: ComplexTelemetryDescriptor
  model: ComplexCornersModel
  size: CanvasSize
}): ReactElement {
  const cells = new Map(model.cells.map((cell) => [cell.key, cell]))
  const cx = size.w / 2
  const cy = 158
  const wheel = (key: 'lf' | 'rf' | 'lr' | 'rr', x: number, y: number): ReactElement | null => {
    const cell = cells.get(key)
    if (!cell) return null
    return (
      <g>
        <circle cx={x} cy={y + 25} r={53} fill="none" stroke={FUTURE} strokeWidth={2} opacity={0.44} />
        <circle cx={x} cy={y + 25} r={43} fill="none" stroke={TRACK} strokeWidth={6} />
        <CornerValue cell={cell} model={model} x={x} y={y} accent={FUTURE} futuristic />
      </g>
    )
  }
  return (
    <g>
      {labelText(descriptor.context, 18, 22, FUTURE)}
      <text x={size.w - 18} y={22} textAnchor="end" fill={DIM} fontFamily={FONT_DATA} fontSize={12} fontWeight={800} {...textStroke(12)}>{model.unit}</text>
      <CarSilhouette cx={cx} cy={cy} color={FUTURE} />
      {wheel('lf', 91, 70)}
      {wheel('rf', size.w - 91, 70)}
      {wheel('lr', 91, 207)}
      {wheel('rr', size.w - 91, 207)}
    </g>
  )
}

function DduCorners({
  descriptor,
  model,
  size
}: {
  descriptor: ComplexTelemetryDescriptor
  model: ComplexCornersModel
  size: CanvasSize
}): ReactElement {
  const cells = new Map(model.cells.map((cell) => [cell.key, cell]))
  const cell = (key: 'lf' | 'rf' | 'lr' | 'rr', x: number, y: number): ReactElement | null => {
    const value = cells.get(key)
    if (!value) return null
    const primary = cornerPrimary(value)
    return (
      <g>
        <text x={x + 12} y={y + 22} fill={DDU} fontFamily={FONT_LABEL} fontSize={14} fontWeight={900} {...textStroke(14)}>{key.toUpperCase()}</text>
        <text x={x + 94} y={y + 58} textAnchor="middle" fill={primary == null ? DIM : TEXT} fontFamily={FONT_DATA} fontSize={36} fontWeight={900} {...textStroke(36)}>{cornerText(primary, model.decimals)}</text>
        {value.values.length > 1 ? (
          <text x={x + 94} y={y + 82} textAnchor="middle" fill={DIM} fontFamily={FONT_DATA} fontSize={12} fontWeight={800} {...textStroke(12)}>
            {value.values.map((zone) => cornerText(finite(zone), model.decimals)).join(' / ')}
          </text>
        ) : null}
      </g>
    )
  }
  const gridX = 16
  const gridY = 34
  const gridW = size.w - 32
  const gridH = size.h - 50
  return (
    <g>
      {labelText(descriptor.context, 14, 20, DDU)}
      <text x={size.w - 14} y={20} textAnchor="end" fill={DIM} fontFamily={FONT_DATA} fontSize={12} fontWeight={800} {...textStroke(12)}>{model.unit}</text>
      <rect x={gridX} y={gridY} width={gridW} height={gridH} fill="none" stroke={TRACK} strokeWidth={2} />
      <line x1={size.w / 2} y1={gridY} x2={size.w / 2} y2={gridY + gridH} stroke={TRACK} strokeWidth={2} />
      <line x1={gridX} y1={gridY + gridH / 2} x2={gridX + gridW} y2={gridY + gridH / 2} stroke={TRACK} strokeWidth={2} />
      {cell('lf', gridX, gridY)}
      {cell('rf', size.w / 2, gridY)}
      {cell('lr', gridX, gridY + gridH / 2)}
      {cell('rr', size.w / 2, gridY + gridH / 2)}
    </g>
  )
}

function statusPrimarySize(model: ComplexStatusModel, base: number, maxChars: number): number {
  return fitText(model.primary, base, maxChars, 20)
}

function CompetitionStatus({
  descriptor,
  model,
  size
}: {
  descriptor: ComplexTelemetryDescriptor
  model: ComplexStatusModel
  size: CanvasSize
}): ReactElement {
  const color = toneColor(model.tone, COMP)
  const fontSize = statusPrimarySize(model, 50, 8)
  return (
    <g>
      <polygon points={`18,${size.h / 2} 48,34 75,34 75,${size.h - 34} 48,${size.h - 34}`} fill={model.active ? color : TRACK} stroke={color} strokeWidth={2} />
      <text x={96} y={size.h / 2 + 15} fill={model.available ? color : DIM} fontFamily={FONT_LABEL} fontSize={fontSize} fontWeight={900} {...textStroke(fontSize)}>{model.primary}</text>
      {labelText(descriptor.context, 98, 32, COMP)}
      {model.secondary ? <text x={98} y={size.h - 25} fill={DIM} fontFamily={FONT_LABEL} fontSize={16} fontWeight={800} {...textStroke(16)}>{model.secondary}</text> : null}
      {(model.items ?? []).slice(0, 3).map((item, index) => (
        <text key={item.key} x={size.w - 14} y={28 + index * 24} textAnchor="end" fill={toneColor(item.tone, TEXT)} fontFamily={FONT_DATA} fontSize={12} fontWeight={800} {...textStroke(12)}>
          {item.label}{item.value ? ` · ${item.value}` : ''}
        </text>
      ))}
    </g>
  )
}

function FuturisticStatus({
  descriptor,
  model,
  size
}: {
  descriptor: ComplexTelemetryDescriptor
  model: ComplexStatusModel
  size: CanvasSize
}): ReactElement {
  const color = toneColor(model.tone, FUTURE)
  const fontSize = statusPrimarySize(model, 48, 9)
  return (
    <g>
      {[0, 1, 2].map((index) => (
        <polyline key={index} points={`${18 + index * 16},42 ${50 + index * 16},${size.h / 2} ${18 + index * 16},${size.h - 42}`} fill="none" stroke={index === 2 ? color : FUTURE} strokeWidth={index === 2 ? 7 : 3} opacity={model.active || index < 2 ? 0.95 - index * 0.2 : 0.3} />
      ))}
      {labelText(descriptor.context, 88, 30, FUTURE)}
      <text x={88} y={size.h / 2 + 15} fill={model.available ? color : DIM} fontFamily={FONT_DATA} fontSize={fontSize} fontWeight={900} {...textStroke(fontSize)}>{model.primary}</text>
      {model.secondary ? <text x={90} y={size.h - 24} fill={DIM} fontFamily={FONT_LABEL} fontSize={15} fontWeight={800} {...textStroke(15)}>{model.secondary}</text> : null}
      {(model.items ?? []).slice(0, 2).map((item, index) => (
        <text key={item.key} x={size.w - 12} y={28 + index * 22} textAnchor="end" fill={toneColor(item.tone, FUTURE)} fontFamily={FONT_DATA} fontSize={11} fontWeight={800} {...textStroke(11)}>
          {item.label}{item.value ? ` · ${item.value}` : ''}
        </text>
      ))}
    </g>
  )
}

function DduStatus({
  descriptor,
  model,
  size
}: {
  descriptor: ComplexTelemetryDescriptor
  model: ComplexStatusModel
  size: CanvasSize
}): ReactElement {
  const color = toneColor(model.tone, DDU)
  const fontSize = statusPrimarySize(model, 44, 11)
  return (
    <g>
      {labelText(descriptor.context, 14, 20, DDU)}
      {[0, 1, 2, 3].map((index) => (
        <rect key={index} x={14 + index * 22} y={39} width={15} height={15} rx={1} fill={model.active && index === 0 ? color : TRACK} stroke={index === 0 ? color : MUTED} strokeWidth={1} />
      ))}
      <text x={14} y={112} fill={model.available ? color : DIM} fontFamily={FONT_DATA} fontSize={fontSize} fontWeight={900} {...textStroke(fontSize)}>{model.primary}</text>
      {model.secondary ? <text x={size.w - 14} y={20} textAnchor="end" fill={DIM} fontFamily={FONT_LABEL} fontSize={13} fontWeight={800} {...textStroke(13)}>{model.secondary}</text> : null}
      <line x1={14} y1={size.h - 20} x2={size.w - 14} y2={size.h - 20} stroke={model.active ? color : TRACK} strokeWidth={4} />
      {(model.items ?? []).slice(0, 2).map((item, index) => (
        <text key={item.key} x={size.w - 14} y={74 + index * 22} textAnchor="end" fill={toneColor(item.tone, DDU)} fontFamily={FONT_DATA} fontSize={11} fontWeight={800} {...textStroke(11)}>
          {item.label}{item.value ? ` · ${item.value}` : ''}
        </text>
      ))}
    </g>
  )
}

function steeringFraction(model: ComplexSteeringModel): number {
  const angle = finite(model.angleDeg)
  const max = Math.abs(finite(model.maxDeg) ?? 540)
  if (angle == null || max <= 0) return 0
  return clamp(angle / max, -1, 1)
}

function SteeringWheel({ cx, cy, radius, rotation, color }: { cx: number; cy: number; radius: number; rotation: number; color: string }): ReactElement {
  return (
    <g transform={`rotate(${rotation} ${cx} ${cy})`}>
      <circle cx={cx} cy={cy} r={radius} fill="none" stroke={color} strokeWidth={7} />
      <circle cx={cx} cy={cy} r={radius * 0.28} fill="none" stroke={color} strokeWidth={5} />
      <line x1={cx} y1={cy - radius * 0.28} x2={cx} y2={cy - radius} stroke={color} strokeWidth={5} />
      <line x1={cx - radius * 0.24} y1={cy + radius * 0.12} x2={cx - radius * 0.82} y2={cy + radius * 0.48} stroke={color} strokeWidth={5} />
      <line x1={cx + radius * 0.24} y1={cy + radius * 0.12} x2={cx + radius * 0.82} y2={cy + radius * 0.48} stroke={color} strokeWidth={5} />
    </g>
  )
}

function CompetitionSteering({
  descriptor,
  model,
  size
}: {
  descriptor: ComplexTelemetryDescriptor
  model: ComplexSteeringModel
  size: CanvasSize
}): ReactElement {
  const fraction = steeringFraction(model)
  const angle = finite(model.angleDeg)
  const color = model.available ? COMP : DIM
  return (
    <g>
      {labelText(descriptor.context, 16, 23, COMP)}
      <SteeringWheel cx={126} cy={116} radius={64} rotation={fraction * 180} color={color} />
      <line x1={222} y1={116} x2={size.w - 24} y2={116} stroke={TRACK} strokeWidth={10} strokeLinecap="round" />
      <line x1={(size.w + 198) / 2} y1={100} x2={(size.w + 198) / 2} y2={132} stroke={COMP} strokeWidth={2} />
      <circle cx={(size.w + 198) / 2 + fraction * ((size.w - 246) / 2)} cy={116} r={8} fill={color} />
      <text x={size.w - 26} y={82} textAnchor="end" fill={color} fontFamily={FONT_DATA} fontSize={48} fontWeight={900} {...textStroke(48)}>
        {angle == null ? '—' : `${angle >= 0 ? '+' : ''}${angle.toFixed(0)}°`}
      </text>
      <text x={size.w - 26} y={157} textAnchor="end" fill={DIM} fontFamily={FONT_LABEL} fontSize={14} fontWeight={800} letterSpacing={1.4} {...textStroke(14)}>
        {fraction < -0.02 ? 'LEFT' : fraction > 0.02 ? 'RIGHT' : 'CENTER'}
      </text>
    </g>
  )
}

function FuturisticSteering({
  descriptor,
  model,
  size
}: {
  descriptor: ComplexTelemetryDescriptor
  model: ComplexSteeringModel
  size: CanvasSize
}): ReactElement {
  const fraction = steeringFraction(model)
  const angle = finite(model.angleDeg)
  const cx = 132
  const cy = 116
  return (
    <g>
      {labelText(descriptor.context, 18, 22, FUTURE)}
      <circle cx={cx} cy={cy} r={79} fill="none" stroke={FUTURE} strokeWidth={2} opacity={0.4} strokeDasharray="4 7" />
      <SteeringWheel cx={cx} cy={cy} radius={62} rotation={fraction * 180} color={model.available ? FUTURE : DIM} />
      <path d={`M 226 48 H ${size.w - 20} M 226 184 H ${size.w - 20}`} fill="none" stroke={FUTURE} strokeWidth={2} opacity={0.45} />
      <text x={size.w - 20} y={128} textAnchor="end" fill={model.available ? FUTURE : DIM} fontFamily={FONT_DATA} fontSize={58} fontWeight={900} {...textStroke(58)}>
        {angle == null ? '—' : `${angle >= 0 ? '+' : ''}${angle.toFixed(0)}°`}
      </text>
      <polygon points={`${226 + (fraction + 1) * ((size.w - 250) / 2)},160 ${218 + (fraction + 1) * ((size.w - 250) / 2)},174 ${234 + (fraction + 1) * ((size.w - 250) / 2)},174`} fill={model.available ? FUTURE : DIM} />
    </g>
  )
}

function DduSteering({
  descriptor,
  model,
  size
}: {
  descriptor: ComplexTelemetryDescriptor
  model: ComplexSteeringModel
  size: CanvasSize
}): ReactElement {
  const fraction = steeringFraction(model)
  const angle = finite(model.angleDeg)
  const cx = 102
  const cy = 105
  return (
    <g>
      {labelText(descriptor.context, 14, 20, DDU)}
      <SteeringWheel cx={cx} cy={cy} radius={52} rotation={fraction * 180} color={model.available ? DDU : DIM} />
      <text x={size.w - 16} y={118} textAnchor="end" fill={model.available ? TEXT : DIM} fontFamily={FONT_DATA} fontSize={62} fontWeight={900} {...textStroke(62)}>
        {angle == null ? '—' : `${angle >= 0 ? '+' : ''}${angle.toFixed(0)}°`}
      </text>
      <line x1={182} y1={size.h - 28} x2={size.w - 16} y2={size.h - 28} stroke={TRACK} strokeWidth={8} />
      <rect x={(size.w + 166) / 2 + fraction * ((size.w - 214) / 2) - 4} y={size.h - 36} width={8} height={16} fill={model.available ? DDU : DIM} />
    </g>
  )
}

function renderVariant(
  variant: TelemetryVariant,
  descriptor: ComplexTelemetryDescriptor,
  props: HifiWidgetProps
): ReactElement {
  const size = SIZES[variant][descriptor.archetype]
  const unitSystem = props.unitSystem ?? DEFAULT_UNIT_SYSTEM
  const model = safeRead(descriptor, props.snapshot, unitSystem)
  let content: ReactElement
  if (model.kind === 'table') {
    content =
      variant === 'competition'
        ? <CompetitionTable descriptor={descriptor} model={model} size={size} />
        : variant === 'futuristic'
          ? <FuturisticTable descriptor={descriptor} model={model} size={size} />
          : <DduTable descriptor={descriptor} model={model} size={size} />
  } else if (model.kind === 'radar') {
    content =
      variant === 'competition'
        ? <CompetitionRadar descriptor={descriptor} model={model} size={size} />
        : variant === 'futuristic'
          ? <FuturisticRadar descriptor={descriptor} model={model} size={size} />
          : <DduRadar descriptor={descriptor} model={model} size={size} />
  } else if (model.kind === 'map') {
    content =
      variant === 'competition'
        ? <CompetitionMap descriptor={descriptor} model={model} size={size} unitSystem={unitSystem} />
        : variant === 'futuristic'
          ? <FuturisticMap descriptor={descriptor} model={model} size={size} unitSystem={unitSystem} />
          : <DduMap descriptor={descriptor} model={model} size={size} unitSystem={unitSystem} />
  } else if (model.kind === 'vector') {
    content =
      variant === 'competition'
        ? <CompetitionVector descriptor={descriptor} model={model} size={size} />
        : variant === 'futuristic'
          ? <FuturisticVector descriptor={descriptor} model={model} size={size} />
          : <DduVector descriptor={descriptor} model={model} size={size} />
  } else if (model.kind === 'corners') {
    content =
      variant === 'competition'
        ? <CompetitionCorners descriptor={descriptor} model={model} size={size} />
        : variant === 'futuristic'
          ? <FuturisticCorners descriptor={descriptor} model={model} size={size} />
          : <DduCorners descriptor={descriptor} model={model} size={size} />
  } else if (model.kind === 'status') {
    content =
      variant === 'competition'
        ? <CompetitionStatus descriptor={descriptor} model={model} size={size} />
        : variant === 'futuristic'
          ? <FuturisticStatus descriptor={descriptor} model={model} size={size} />
          : <DduStatus descriptor={descriptor} model={model} size={size} />
  } else {
    content =
      variant === 'competition'
        ? <CompetitionSteering descriptor={descriptor} model={model} size={size} />
        : variant === 'futuristic'
          ? <FuturisticSteering descriptor={descriptor} model={model} size={size} />
          : <DduSteering descriptor={descriptor} model={model} size={size} />
  }
  return (
    <Root descriptor={descriptor} variant={variant} size={size} props={props}>
      {content}
    </Root>
  )
}

export function complexDefaultSizeFor(
  descriptor: ComplexTelemetryDescriptor,
  variant: TelemetryVariant
): CanvasSize {
  return { ...SIZES[variant][descriptor.archetype] }
}

export function createComplexRenderer(
  descriptor: ComplexTelemetryDescriptor,
  variant: TelemetryVariant
) {
  return (props: HifiWidgetProps): ReactElement => renderVariant(variant, descriptor, props)
}
