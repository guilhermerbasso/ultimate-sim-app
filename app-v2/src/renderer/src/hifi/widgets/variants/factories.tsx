import type { ReactElement } from 'react'
import type { HifiWidgetProps } from '../types'
import {
  convertMeasurement,
  DEFAULT_UNIT_SYSTEM,
  formatCanonicalMeasurement,
  measurementKindForUnit,
  type UnitSystem
} from '../../../../../shared/units'
import type {
  DescriptorBound,
  DescriptorThreshold,
  PreparedTelemetryReading,
  TelemetryArchetype,
  TelemetryDatum,
  TelemetryDescriptor,
  TelemetryTone,
  TelemetryVariant
} from './types'

const TEXT = '#F5F7FA'
const DIM = '#8D98A3'
const MUTED = '#58636E'
const TRACK = 'rgba(255,255,255,0.13)'
const COMP_STRUCT = '#F5F7FA'
const FUTURE_STRUCT = '#35C8E8'
const DDU_STRUCT = '#FFB000'
const FONT_DATA = "var(--overlay-font, 'Chakra Petch', 'Bahnschrift', monospace)"
const FONT_LABEL = "var(--overlay-font, 'Rajdhani', 'Barlow Condensed', sans-serif)"
const GOOD = 'var(--widget-good, #22E06A)'
const INFO = 'var(--widget-info, #2F7BFF)'
const WARNING = 'var(--widget-warn, #FFB020)'
const DANGER = 'var(--widget-danger, #FF3B30)'

interface CanvasSize {
  w: number
  h: number
}

const SIZES: Record<TelemetryVariant, Record<TelemetryArchetype, CanvasSize>> = {
  competition: {
    radial: { w: 360, h: 240 },
    linear: { w: 420, h: 180 },
    digital: { w: 360, h: 180 },
    indicator: { w: 320, h: 160 }
  },
  futuristic: {
    radial: { w: 400, h: 220 },
    linear: { w: 420, h: 180 },
    digital: { w: 380, h: 180 },
    indicator: { w: 340, h: 160 }
  },
  ddu: {
    radial: { w: 360, h: 190 },
    linear: { w: 400, h: 170 },
    digital: { w: 360, h: 170 },
    indicator: { w: 320, h: 150 }
  }
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function resolveBound(
  bound: DescriptorBound | undefined,
  snapshot: HifiWidgetProps['snapshot']
): number | undefined {
  return finite(typeof bound === 'function' ? bound(snapshot) : bound)
}

function thresholdReached(
  numeric: number | undefined,
  threshold: DescriptorThreshold | undefined,
  snapshot: HifiWidgetProps['snapshot']
): boolean {
  if (numeric == null || !threshold) return false
  const value = resolveBound(threshold.value, snapshot)
  if (value == null) return false
  return threshold.when === 'above' ? numeric >= value : numeric <= value
}

function safeText(value: unknown): string {
  if (typeof value !== 'string') return '—'
  const text = value.trim()
  if (!text || /^(nan|undefined|infinity|-infinity)$/i.test(text)) return '—'
  return text
}

function datumAvailable(datum: TelemetryDatum): boolean {
  if (datum == null) return false
  if (typeof datum === 'number') return Number.isFinite(datum)
  if (typeof datum === 'string') return datum.trim().length > 0
  return true
}

function defaultNumeric(datum: TelemetryDatum): number | undefined {
  if (typeof datum === 'number') return finite(datum)
  if (typeof datum === 'string') {
    const parsed = Number.parseFloat(datum)
    return finite(parsed)
  }
  if (typeof datum === 'boolean') return datum ? 1 : 0
  return undefined
}

function defaultFormat(descriptor: TelemetryDescriptor, datum: TelemetryDatum): string {
  if (typeof datum === 'number' && Number.isFinite(datum)) {
    const decimals = Math.max(0, Math.min(4, descriptor.decimals ?? 0))
    const sign = descriptor.signed && datum > 0 ? '+' : ''
    return `${descriptor.prefix ?? ''}${sign}${datum.toFixed(decimals)}${descriptor.suffix ?? ''}`
  }
  if (typeof datum === 'boolean') return datum ? 'ON' : 'OFF'
  if (Array.isArray(datum)) return datum.length > 0 ? datum.join(' · ') : 'CLEAR'
  return safeText(datum)
}

function defaultActive(datum: TelemetryDatum): boolean | undefined {
  if (typeof datum === 'boolean') return datum
  if (Array.isArray(datum)) return datum.length > 0
  if (typeof datum === 'number' && Number.isFinite(datum)) return datum !== 0
  if (typeof datum === 'string') return datum.trim().length > 0
  return undefined
}

function toneFor(
  descriptor: TelemetryDescriptor,
  datum: TelemetryDatum,
  numeric: number | undefined,
  active: boolean | undefined,
  snapshot: HifiWidgetProps['snapshot']
): TelemetryTone {
  if (!datumAvailable(datum)) return 'neutral'
  if (descriptor.tone) return descriptor.tone(datum, snapshot)
  if (thresholdReached(numeric, descriptor.critical, snapshot)) return 'danger'
  const redline = resolveBound(descriptor.redline, snapshot)
  if (numeric != null && redline != null && numeric >= redline) return 'danger'
  if (thresholdReached(numeric, descriptor.warning, snapshot)) return 'warning'
  if (descriptor.signed && numeric != null) {
    if (Math.abs(numeric) < 0.005) return 'neutral'
    return numeric < 0 ? 'good' : 'danger'
  }
  if (descriptor.archetype === 'indicator' && active === false) return 'neutral'
  return 'accent'
}

export function prepareTelemetryReading(
  descriptor: TelemetryDescriptor,
  snapshot: HifiWidgetProps['snapshot'],
  unitSystem: UnitSystem = DEFAULT_UNIT_SYSTEM,
  visibility?: HifiWidgetProps['visibility']
): PreparedTelemetryReading {
  let datum: TelemetryDatum
  try {
    datum = descriptor.read(snapshot)
  } catch {
    datum = undefined
  }
  const canonicalNumeric = descriptor.numeric
    ? finite(descriptor.numeric(datum, snapshot))
    : defaultNumeric(datum)
  const available = datumAvailable(datum)
  const active = descriptor.active
    ? descriptor.active(datum, snapshot)
    : defaultActive(datum)
  let display = '—'
  let unit = descriptor.unit
  const measurementKind = measurementKindForUnit(descriptor.unit)
  if (available) {
    try {
      if (measurementKind && typeof datum === 'number') {
        const formatted = formatCanonicalMeasurement(datum, descriptor.unit, unitSystem, {
          decimals: descriptor.decimals ?? 0,
          signed: descriptor.signed
        })
        display = safeText(`${descriptor.prefix ?? ''}${formatted.display}${descriptor.suffix ?? ''}`)
        unit = formatted.unit
      } else {
        display = safeText(
          descriptor.format
            ? descriptor.format(datum, snapshot, visibility)
            : defaultFormat(descriptor, datum)
        )
      }
    } catch {
      display = '—'
    }
  }
  const resolvedMin = resolveBound(descriptor.min, snapshot)
  const resolvedMax = resolveBound(descriptor.max, snapshot)
  const canonicalMin = resolvedMin != null ? resolvedMin : 0
  const canonicalMax = resolvedMax != null && resolvedMax !== canonicalMin ? resolvedMax : canonicalMin + 1
  const numeric = measurementKind
    ? convertMeasurement(canonicalNumeric, measurementKind, unitSystem)
    : canonicalNumeric
  const convertedMin = measurementKind
    ? convertMeasurement(canonicalMin, measurementKind, unitSystem)
    : canonicalMin
  const convertedMax = measurementKind
    ? convertMeasurement(canonicalMax, measurementKind, unitSystem)
    : canonicalMax
  const min = convertedMin ?? canonicalMin
  const max = convertedMax != null && convertedMax !== min ? convertedMax : min + 1
  const fraction =
    numeric == null
      ? 0
      : Math.max(0, Math.min(1, (numeric - min) / (max - min)))
  return {
    datum,
    numeric,
    display,
    unit,
    available,
    active,
    fraction,
    min,
    max,
    tone: toneFor(descriptor, datum, canonicalNumeric, active, snapshot)
  }
}

function toneColor(tone: TelemetryTone, accent: string): string {
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

function polar(cx: number, cy: number, radius: number, degrees: number): [number, number] {
  const radians = (degrees * Math.PI) / 180
  return [cx + Math.cos(radians) * radius, cy + Math.sin(radians) * radius]
}

function arcPath(
  cx: number,
  cy: number,
  radius: number,
  startDegrees: number,
  endDegrees: number
): string {
  if (!Number.isFinite(endDegrees) || endDegrees <= startDegrees) return ''
  const [sx, sy] = polar(cx, cy, radius, startDegrees)
  const [ex, ey] = polar(cx, cy, radius, endDegrees)
  const largeArc = endDegrees - startDegrees > 180 ? 1 : 0
  return `M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${radius} ${radius} 0 ${largeArc} 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`
}

function fontSizeFor(display: string, base: number, floor = 20): number {
  const length = Math.max(1, display.length)
  return Math.max(floor, base * Math.min(1, 5.5 / length))
}

function commonTextStroke(size: number): {
  stroke: string
  strokeWidth: number
  paintOrder: 'stroke'
  strokeLinejoin: 'round'
} {
  return {
    stroke: 'rgba(0,0,0,0.62)',
    strokeWidth: Math.max(2, size * 0.045),
    paintOrder: 'stroke',
    strokeLinejoin: 'round'
  }
}

function Root({
  size,
  width,
  height,
  label,
  children
}: CanvasSize &
  Pick<HifiWidgetProps, 'width' | 'height'> & {
    size: CanvasSize
    label: string
    children: ReactElement | ReactElement[]
  }): ReactElement {
  return (
    <svg
      viewBox={`0 0 ${size.w} ${size.h}`}
      width={width ?? size.w}
      height={height ?? size.h}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={label}
      style={{ display: 'block' }}
    >
      {children}
    </svg>
  )
}

function Context({
  text,
  x,
  y,
  anchor = 'start',
  color = DIM
}: {
  text?: string
  x: number
  y: number
  anchor?: 'start' | 'middle' | 'end'
  color?: string
}): ReactElement | null {
  if (!text) return null
  return (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      fill={color}
      fontFamily={FONT_LABEL}
      fontSize={15}
      fontWeight={800}
      letterSpacing={1.8}
      {...commonTextStroke(15)}
    >
      {text.toUpperCase()}
    </text>
  )
}

function Unit({
  unit,
  x,
  y,
  anchor = 'middle'
}: {
  unit?: string
  x: number
  y: number
  anchor?: 'start' | 'middle' | 'end'
}): ReactElement | null {
  if (!unit) return null
  return (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      fill={DIM}
      fontFamily={FONT_LABEL}
      fontSize={15}
      fontWeight={700}
      letterSpacing={1}
      {...commonTextStroke(15)}
    >
      {unit}
    </text>
  )
}

function ValueText({
  reading,
  x,
  y,
  size,
  anchor = 'middle',
  color,
  mono = false
}: {
  reading: PreparedTelemetryReading
  x: number
  y: number
  size: number
  anchor?: 'start' | 'middle' | 'end'
  color: string
  mono?: boolean
}): ReactElement {
  const fitted = fontSizeFor(reading.display, size)
  return (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      fill={reading.available ? color : DIM}
      fontFamily={mono ? FONT_DATA : FONT_LABEL}
      fontSize={fitted}
      fontWeight={900}
      letterSpacing={reading.display.length <= 4 ? 1 : 0}
      {...commonTextStroke(fitted)}
    >
      {reading.display}
    </text>
  )
}

function segmentedRail(
  x: number,
  y: number,
  width: number,
  height: number,
  fraction: number,
  color: string,
  count = 16
): ReactElement[] {
  const gap = 3
  const cellWidth = (width - gap * (count - 1)) / count
  const lit = Math.round(Math.max(0, Math.min(1, fraction)) * count)
  return Array.from({ length: count }, (_, index) => (
    <rect
      key={index}
      x={x + index * (cellWidth + gap)}
      y={y}
      width={Math.max(1, cellWidth)}
      height={height}
      rx={1.5}
      fill={index < lit ? color : TRACK}
      opacity={index < lit ? 1 : 0.72}
    />
  ))
}

function linearFill(
  reading: PreparedTelemetryReading,
  x: number,
  width: number
): { x: number; width: number } {
  if (reading.min < 0 && reading.max > 0) {
    const zero = Math.max(0, Math.min(1, (0 - reading.min) / (reading.max - reading.min)))
    const start = Math.min(zero, reading.fraction)
    return { x: x + start * width, width: Math.abs(reading.fraction - zero) * width }
  }
  return { x, width: reading.fraction * width }
}

function CompetitionRadial({
  descriptor,
  reading,
  size
}: {
  descriptor: TelemetryDescriptor
  reading: PreparedTelemetryReading
  size: CanvasSize
}): ReactElement[] {
  const cx = size.w / 2
  const cy = 133
  const radius = 94
  const start = -220
  const sweep = 260
  const end = start + sweep
  const valueEnd = start + sweep * reading.fraction
  const pointer = polar(cx, cy, radius - 23, valueEnd)
  const color = toneColor(reading.tone, 'var(--overlay-accent, #F5F7FA)')
  return [
    <path
      key="track"
      d={arcPath(cx, cy, radius, start, end)}
      fill="none"
      stroke={TRACK}
      strokeWidth={14}
      strokeLinecap="round"
    />,
    reading.available && reading.numeric != null && reading.fraction > 0 ? (
      <path
        key="value"
        d={arcPath(cx, cy, radius, start, valueEnd)}
        fill="none"
        stroke={color}
        strokeWidth={14}
        strokeLinecap="round"
      />
    ) : (
      <g key="value" />
    ),
    <g key="ticks">
      {Array.from({ length: 11 }, (_, index) => {
        const angle = start + (sweep * index) / 10
        const outer = polar(cx, cy, radius + 10, angle)
        const inner = polar(cx, cy, radius + (index % 5 === 0 ? 0 : 4), angle)
        return (
          <line
            key={index}
            x1={inner[0]}
            y1={inner[1]}
            x2={outer[0]}
            y2={outer[1]}
            stroke={index % 5 === 0 ? COMP_STRUCT : MUTED}
            strokeWidth={index % 5 === 0 ? 2.5 : 1.2}
          />
        )
      })}
    </g>,
    reading.available && reading.numeric != null ? (
      <g key="needle">
        <line
          x1={cx}
          y1={cy}
          x2={pointer[0]}
          y2={pointer[1]}
          stroke={color}
          strokeWidth={4}
          strokeLinecap="round"
        />
        <circle cx={cx} cy={cy} r={7} fill={color} />
      </g>
    ) : (
      <g key="needle" />
    ),
    <ValueText
      key="text"
      reading={reading}
      x={cx}
      y={145}
      size={62}
      color={color}
    />,
    <Unit key="unit" unit={reading.unit} x={cx} y={190} />,
    <Context
      key="context"
      text={descriptor.context}
      x={cx}
      y={size.h - 15}
      anchor="middle"
      color={COMP_STRUCT}
    />
  ]
}

function CompetitionLinear({
  descriptor,
  reading,
  size
}: {
  descriptor: TelemetryDescriptor
  reading: PreparedTelemetryReading
  size: CanvasSize
}): ReactElement[] {
  const x = 28
  const width = size.w - 56
  const fill = linearFill(reading, x, width)
  const color = toneColor(reading.tone, 'var(--overlay-accent, #F5F7FA)')
  return [
    <Context key="context" text={descriptor.context} x={x} y={28} color={COMP_STRUCT} />,
    <ValueText
      key="value"
      reading={reading}
      x={size.w / 2}
      y={101}
      size={72}
      color={color}
    />,
    <Unit key="unit" unit={reading.unit} x={size.w - x} y={28} anchor="end" />,
    <line
      key="rail"
      x1={x}
      y1={136}
      x2={x + width}
      y2={136}
      stroke={TRACK}
      strokeWidth={12}
      strokeLinecap="round"
    />,
    reading.available && reading.numeric != null ? (
      <rect
        key="fill"
        x={fill.x}
        y={130}
        width={Math.max(2, fill.width)}
        height={12}
        rx={6}
        fill={color}
      />
    ) : (
      <g key="fill" />
    ),
    <g key="ticks">
      {Array.from({ length: 9 }, (_, index) => (
        <line
          key={index}
          x1={x + (width * index) / 8}
          y1={126}
          x2={x + (width * index) / 8}
          y2={146}
          stroke={index === 4 ? COMP_STRUCT : MUTED}
          strokeWidth={index === 4 ? 2 : 1}
        />
      ))}
    </g>
  ]
}

function CompetitionDigital({
  descriptor,
  reading,
  size
}: {
  descriptor: TelemetryDescriptor
  reading: PreparedTelemetryReading
  size: CanvasSize
}): ReactElement[] {
  const color = toneColor(reading.tone, 'var(--overlay-accent, #F5F7FA)')
  return [
    <Context key="context" text={descriptor.context} x={22} y={27} color={COMP_STRUCT} />,
    <ValueText
      key="value"
      reading={reading}
      x={size.w / 2}
      y={117}
      size={84}
      color={color}
      mono
    />,
    <Unit key="unit" unit={reading.unit} x={size.w - 22} y={27} anchor="end" />,
    <path
      key="left"
      d={`M 20 56 V 140 H 42`}
      fill="none"
      stroke={TRACK}
      strokeWidth={2}
    />,
    <path
      key="right"
      d={`M ${size.w - 20} 56 V 140 H ${size.w - 42}`}
      fill="none"
      stroke={TRACK}
      strokeWidth={2}
    />
  ]
}

function CompetitionIndicator({
  descriptor,
  reading,
  size
}: {
  descriptor: TelemetryDescriptor
  reading: PreparedTelemetryReading
  size: CanvasSize
}): ReactElement[] {
  const color = toneColor(
    reading.active === false ? 'neutral' : reading.tone,
    'var(--overlay-accent, #F5F7FA)'
  )
  return [
    <circle
      key="halo"
      cx={58}
      cy={size.h / 2}
      r={34}
      fill="none"
      stroke={reading.available ? color : TRACK}
      strokeWidth={reading.active ? 8 : 3}
      opacity={reading.active ? 1 : 0.68}
    />,
    <circle
      key="lamp"
      cx={58}
      cy={size.h / 2}
      r={18}
      fill={reading.active ? color : TRACK}
    />,
    <ValueText
      key="value"
      reading={reading}
      x={105}
      y={94}
      size={52}
      anchor="start"
      color={color}
    />,
    <Context
      key="context"
      text={descriptor.context}
      x={106}
      y={125}
      color={COMP_STRUCT}
    />
  ]
}

function FuturisticRadial({
  descriptor,
  reading,
  size
}: {
  descriptor: TelemetryDescriptor
  reading: PreparedTelemetryReading
  size: CanvasSize
}): ReactElement[] {
  const cx = size.w / 2
  const cy = 125
  const start = -205
  const sweep = 230
  const end = start + sweep
  const valueEnd = start + sweep * reading.fraction
  const color = toneColor(reading.tone, 'var(--overlay-accent, #35C8E8)')
  const point = polar(cx, cy, 84, valueEnd)
  const wingA = polar(cx, cy, 69, valueEnd - 4)
  const wingB = polar(cx, cy, 69, valueEnd + 4)
  return [
    <path
      key="outer"
      d={arcPath(cx, cy, 91, start, end)}
      fill="none"
      stroke={FUTURE_STRUCT}
      strokeWidth={2}
      opacity={0.64}
    />,
    <path
      key="inner"
      d={arcPath(cx, cy, 79, start, end)}
      fill="none"
      stroke={TRACK}
      strokeWidth={8}
      strokeLinecap="round"
    />,
    reading.available && reading.numeric != null && reading.fraction > 0 ? (
      <path
        key="active"
        d={arcPath(cx, cy, 79, start, valueEnd)}
        fill="none"
        stroke={color}
        strokeWidth={8}
        strokeLinecap="round"
      />
    ) : (
      <g key="active" />
    ),
    reading.available && reading.numeric != null ? (
      <polygon
        key="blade"
        points={`${point[0]},${point[1]} ${wingA[0]},${wingA[1]} ${wingB[0]},${wingB[1]}`}
        fill={color}
      />
    ) : (
      <g key="blade" />
    ),
    <ValueText
      key="value"
      reading={reading}
      x={cx}
      y={139}
      size={62}
      color={color}
      mono
    />,
    <Context key="context" text={descriptor.context} x={28} y={25} color={FUTURE_STRUCT} />,
    <Unit key="unit" unit={reading.unit} x={size.w - 28} y={25} anchor="end" />,
    <g key="datum">
      {Array.from({ length: 7 }, (_, index) => (
        <rect
          key={index}
          x={cx - 54 + index * 18}
          y={size.h - 17}
          width={index === 3 ? 10 : 5}
          height={index === 3 ? 4 : 2}
          fill={index === 3 ? color : FUTURE_STRUCT}
          opacity={index === 3 ? 1 : 0.45}
        />
      ))}
    </g>
  ]
}

function FuturisticLinear({
  descriptor,
  reading,
  size
}: {
  descriptor: TelemetryDescriptor
  reading: PreparedTelemetryReading
  size: CanvasSize
}): ReactElement[] {
  const x = 24
  const width = size.w - 48
  const pointerX = x + width * reading.fraction
  const fill = linearFill(reading, x, width)
  const color = toneColor(reading.tone, 'var(--overlay-accent, #35C8E8)')
  return [
    <Context key="context" text={descriptor.context} x={x} y={28} color={FUTURE_STRUCT} />,
    <ValueText
      key="value"
      reading={reading}
      x={size.w - x}
      y={82}
      size={62}
      anchor="end"
      color={color}
      mono
    />,
    <Unit key="unit" unit={reading.unit} x={x} y={79} anchor="start" />,
    <line
      key="rail-a"
      x1={x}
      y1={122}
      x2={x + width}
      y2={122}
      stroke={TRACK}
      strokeWidth={5}
    />,
    <line
      key="rail-b"
      x1={x}
      y1={145}
      x2={x + width}
      y2={145}
      stroke={FUTURE_STRUCT}
      strokeWidth={1}
      opacity={0.55}
    />,
    reading.available && reading.numeric != null ? (
      <rect
        key="fill"
        x={fill.x}
        y={118}
        width={Math.max(2, fill.width)}
        height={8}
        rx={2}
        fill={color}
      />
    ) : (
      <g key="fill" />
    ),
    reading.available && reading.numeric != null ? (
      <polygon
        key="cursor"
        points={`${pointerX},111 ${pointerX - 8},101 ${pointerX + 8},101`}
        fill={color}
      />
    ) : (
      <g key="cursor" />
    ),
    <g key="ticks">
      {Array.from({ length: 13 }, (_, index) => (
        <line
          key={index}
          x1={x + (width * index) / 12}
          y1={137}
          x2={x + (width * index) / 12}
          y2={153}
          stroke={index % 3 === 0 ? FUTURE_STRUCT : MUTED}
          strokeWidth={index % 3 === 0 ? 2 : 1}
        />
      ))}
    </g>
  ]
}

function FuturisticDigital({
  descriptor,
  reading,
  size
}: {
  descriptor: TelemetryDescriptor
  reading: PreparedTelemetryReading
  size: CanvasSize
}): ReactElement[] {
  const color = toneColor(reading.tone, 'var(--overlay-accent, #35C8E8)')
  return [
    <line
      key="datum"
      x1={32}
      y1={28}
      x2={32}
      y2={size.h - 22}
      stroke={FUTURE_STRUCT}
      strokeWidth={4}
    />,
    <Context key="context" text={descriptor.context} x={52} y={31} color={FUTURE_STRUCT} />,
    <ValueText
      key="value"
      reading={reading}
      x={size.w - 24}
      y={111}
      size={76}
      anchor="end"
      color={color}
      mono
    />,
    <Unit key="unit" unit={reading.unit} x={52} y={111} anchor="start" />,
    <line
      key="baseline"
      x1={52}
      y1={142}
      x2={size.w - 24}
      y2={142}
      stroke={TRACK}
      strokeWidth={2}
    />,
    <g key="marks">
      {Array.from({ length: 6 }, (_, index) => (
        <rect
          key={index}
          x={52 + index * 34}
          y={137}
          width={index === 0 ? 18 : 8}
          height={index === 0 ? 10 : 5}
          fill={index === 0 ? color : FUTURE_STRUCT}
          opacity={index === 0 ? 1 : 0.48}
        />
      ))}
    </g>
  ]
}

function FuturisticIndicator({
  descriptor,
  reading,
  size
}: {
  descriptor: TelemetryDescriptor
  reading: PreparedTelemetryReading
  size: CanvasSize
}): ReactElement[] {
  const color = toneColor(
    reading.active === false ? 'neutral' : reading.tone,
    'var(--overlay-accent, #35C8E8)'
  )
  const cy = size.h / 2
  return [
    <polyline
      key="chevron-a"
      points={`22,${cy - 38} 54,${cy} 22,${cy + 38}`}
      fill="none"
      stroke={FUTURE_STRUCT}
      strokeWidth={5}
      opacity={reading.active ? 1 : 0.35}
    />,
    <polyline
      key="chevron-b"
      points={`42,${cy - 30} 68,${cy} 42,${cy + 30}`}
      fill="none"
      stroke={color}
      strokeWidth={8}
      opacity={reading.active ? 1 : 0.45}
    />,
    <ValueText
      key="value"
      reading={reading}
      x={91}
      y={92}
      size={52}
      anchor="start"
      color={color}
      mono
    />,
    <Context
      key="context"
      text={descriptor.context}
      x={93}
      y={124}
      color={FUTURE_STRUCT}
    />
  ]
}

function DduScale({
  descriptor,
  reading,
  size,
  color
}: {
  descriptor: TelemetryDescriptor
  reading: PreparedTelemetryReading
  size: CanvasSize
  color: string
}): ReactElement[] {
  const x = 22
  const width = size.w - 44
  return [
    <g key="segments">
      {segmentedRail(x, size.h - 30, width, 12, reading.fraction, color, 18)}
    </g>,
    <text
      key="min"
      x={x}
      y={size.h - 39}
      fill={MUTED}
      fontFamily={FONT_DATA}
      fontSize={11}
      {...commonTextStroke(11)}
    >
      {Number.isFinite(reading.min) ? reading.min.toFixed(0) : ''}
    </text>,
    <text
      key="max"
      x={x + width}
      y={size.h - 39}
      textAnchor="end"
      fill={MUTED}
      fontFamily={FONT_DATA}
      fontSize={11}
      {...commonTextStroke(11)}
    >
      {Number.isFinite(reading.max) ? reading.max.toFixed(0) : ''}
    </text>,
    <Context key="context" text={descriptor.context} x={22} y={25} color={DDU_STRUCT} />,
    <Unit key="unit" unit={reading.unit} x={size.w - 22} y={25} anchor="end" />
  ]
}

function DduNumeric({
  descriptor,
  reading,
  size
}: {
  descriptor: TelemetryDescriptor
  reading: PreparedTelemetryReading
  size: CanvasSize
}): ReactElement[] {
  const color = toneColor(reading.tone, 'var(--overlay-accent, #FFB000)')
  const hasScale =
    reading.numeric != null &&
    descriptor.min != null &&
    descriptor.max != null &&
    descriptor.archetype !== 'digital'
  return [
    <ValueText
      key="value"
      reading={reading}
      x={size.w / 2}
      y={hasScale ? 105 : 116}
      size={82}
      color={color}
      mono
    />,
    ...(hasScale
      ? DduScale({ descriptor, reading, size, color })
      : [
          <Context
            key="context"
            text={descriptor.context}
            x={22}
            y={25}
            color={DDU_STRUCT}
          />,
          <Unit
            key="unit"
            unit={reading.unit}
            x={size.w - 22}
            y={25}
            anchor="end"
          />,
          <g key="datum">
            {Array.from({ length: 8 }, (_, index) => (
              <rect
                key={index}
                x={22 + index * ((size.w - 60) / 7)}
                y={size.h - 22}
                width={index === 0 ? 22 : 8}
                height={5}
                fill={index === 0 ? color : TRACK}
              />
            ))}
          </g>
        ])
  ]
}

function DduIndicator({
  descriptor,
  reading,
  size
}: {
  descriptor: TelemetryDescriptor
  reading: PreparedTelemetryReading
  size: CanvasSize
}): ReactElement[] {
  const color = toneColor(
    reading.active === false ? 'neutral' : reading.tone,
    'var(--overlay-accent, #FFB000)'
  )
  return [
    <Context key="context" text={descriptor.context} x={18} y={24} color={DDU_STRUCT} />,
    <g key="lamps">
      {[0, 1, 2].map((index) => (
        <rect
          key={index}
          x={18 + index * 25}
          y={53}
          width={17}
          height={17}
          rx={2}
          fill={reading.active && index === 0 ? color : TRACK}
          stroke={index === 0 ? color : MUTED}
          strokeWidth={1}
        />
      ))}
    </g>,
    <ValueText
      key="value"
      reading={reading}
      x={92}
      y={98}
      size={48}
      anchor="start"
      color={color}
      mono
    />,
    <line
      key="baseline"
      x1={18}
      y1={size.h - 20}
      x2={size.w - 18}
      y2={size.h - 20}
      stroke={reading.active ? color : TRACK}
      strokeWidth={4}
    />
  ]
}

function renderVariant(
  variant: TelemetryVariant,
  descriptor: TelemetryDescriptor,
  props: HifiWidgetProps
): ReactElement {
  const size = SIZES[variant][descriptor.archetype]
  const reading = prepareTelemetryReading(
    descriptor,
    props.snapshot,
    props.unitSystem ?? DEFAULT_UNIT_SYSTEM,
    props.visibility
  )
  let children: ReactElement[]
  if (variant === 'competition') {
    switch (descriptor.archetype) {
      case 'radial':
        children = CompetitionRadial({ descriptor, reading, size })
        break
      case 'linear':
        children = CompetitionLinear({ descriptor, reading, size })
        break
      case 'indicator':
        children = CompetitionIndicator({ descriptor, reading, size })
        break
      default:
        children = CompetitionDigital({ descriptor, reading, size })
    }
  } else if (variant === 'futuristic') {
    switch (descriptor.archetype) {
      case 'radial':
        children = FuturisticRadial({ descriptor, reading, size })
        break
      case 'linear':
        children = FuturisticLinear({ descriptor, reading, size })
        break
      case 'indicator':
        children = FuturisticIndicator({ descriptor, reading, size })
        break
      default:
        children = FuturisticDigital({ descriptor, reading, size })
    }
  } else {
    children =
      descriptor.archetype === 'indicator'
        ? DduIndicator({ descriptor, reading, size })
        : DduNumeric({ descriptor, reading, size })
  }
  return (
    <Root
      w={size.w}
      h={size.h}
      size={size}
      width={props.width}
      height={props.height}
      label={`${descriptor.label} ${variant}`}
    >
      {children}
    </Root>
  )
}

export function defaultSizeFor(
  descriptor: TelemetryDescriptor,
  variant: TelemetryVariant
): CanvasSize {
  return { ...SIZES[variant][descriptor.archetype] }
}

export function createCompetitionRenderer(descriptor: TelemetryDescriptor) {
  return (props: HifiWidgetProps): ReactElement =>
    renderVariant('competition', descriptor, props)
}

export function createFuturisticRenderer(descriptor: TelemetryDescriptor) {
  return (props: HifiWidgetProps): ReactElement =>
    renderVariant('futuristic', descriptor, props)
}

export function createDduRenderer(descriptor: TelemetryDescriptor) {
  return (props: HifiWidgetProps): ReactElement =>
    renderVariant('ddu', descriptor, props)
}
