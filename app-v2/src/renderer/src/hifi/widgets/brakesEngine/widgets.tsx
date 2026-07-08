import { type ReactElement, type ReactNode } from 'react'
import type { HifiWidgetModule, HifiWidgetProps } from '../types'
import { Bar, BigNum, C, FONT_BIG, FONT_LABEL, FONT_NUM, Frame, GaugeArc, LedRow, fixed, num, tempColor } from '../kit'

const W = 420
const H = 286
const CYAN = '#15c9ff'
const AMBER = '#ff9f0a'
const ORANGE = '#ff6a1a'
const RED = '#ff2b24'
const WHITE = '#f3f4f7'
const KPA_TO_BAR = 0.01

type CornerKey = 'lf' | 'rf' | 'lr' | 'rr'

interface CornerSpec {
  id: CornerKey
  label: string
  name: string
}

interface GaugeSpec {
  label: string
  value: number | undefined
  unit: string
  min: number
  max: number
  ticks: number[]
  color: string
}

const CORNERS: CornerSpec[] = [
  { id: 'lf', label: 'FL', name: 'Front Left' },
  { id: 'rf', label: 'FR', name: 'Front Right' },
  { id: 'lr', label: 'RL', name: 'Rear Left' },
  { id: 'rr', label: 'RR', name: 'Rear Right' }
]

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0
}

function fraction(value: number | undefined, min: number, max: number): number {
  return value == null || max === min ? 0 : clamp01((value - min) / (max - min))
}

function valueText(value: unknown, digits = 0): string {
  const parsed = num(value)
  if (parsed != null) return fixed(parsed, digits)
  return typeof value === 'string' && value.trim() ? value.trim() : '—'
}

function brakeTemp(snapshot: HifiWidgetProps['snapshot'], corner: CornerKey): number | undefined {
  return num(snapshot?.brakeTempC?.[corner])
}

function brakeColor(temp: number | undefined): string {
  return tempColor(temp, 300, 650)
}

function tempGlow(temp: number | undefined): number {
  return temp == null ? 0.16 : 0.28 + fraction(temp, 250, 760) * 0.55
}

function idBase(label: string, width: number, height: number): string {
  return `brakes-engine-${label.replace(/\W+/g, '-').toLowerCase()}-${Math.round(width)}-${Math.round(height)}`
}

function Tile({ label, width, height, accent = CYAN, children }: { label: string; width?: number; height?: number; accent?: string; children: ReactNode }): ReactElement {
  const w = width ?? W
  const h = height ?? H
  const id = idBase(label, w, h)
  return (
    <Frame w={w} h={h} label={label} accent={WHITE}>
      <defs>
        <radialGradient id={`${id}-halo`} cx="50%" cy="42%" r="65%">
          <stop offset="0" stopColor={accent} stopOpacity="0.12" />
          <stop offset="0.48" stopColor={accent} stopOpacity="0.035" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-rim`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="rgba(255,255,255,0.42)" />
          <stop offset="0.52" stopColor="rgba(255,255,255,0.08)" />
          <stop offset="1" stopColor="rgba(255,255,255,0.28)" />
        </linearGradient>
        <filter id={`${id}-glow`} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <rect x={5} y={5} width={w - 10} height={h - 10} rx={18} fill={`url(#${id}-halo)`} stroke={`url(#${id}-rim)`} strokeWidth={1.4} />
      <rect x={15} y={42} width={w - 30} height={h - 58} rx={12} fill="rgba(0,0,0,0.34)" stroke="rgba(255,255,255,0.06)" />
      <g filter={`url(#${id}-glow)`}>{children}</g>
    </Frame>
  )
}

function BrakeDisc({ cx, cy, r, temp }: { cx: number; cy: number; r: number; temp: number | undefined }): ReactElement {
  const color = brakeColor(temp)
  const glow = tempGlow(temp)
  return (
    <g>
      <circle cx={cx} cy={cy} r={r + 15} fill={color} opacity={glow * 0.3} />
      <circle cx={cx} cy={cy} r={r + 7} fill="none" stroke={color} strokeWidth={7} opacity={glow} />
      <circle cx={cx} cy={cy} r={r} fill="#151515" stroke="rgba(255,255,255,0.26)" strokeWidth={2} />
      <circle cx={cx} cy={cy} r={r * 0.68} fill="#0a0b0c" stroke="rgba(255,255,255,0.15)" />
      {Array.from({ length: 18 }, (_, i) => {
        const a = (Math.PI * 2 * i) / 18
        const x = cx + Math.cos(a) * r * 0.78
        const y = cy + Math.sin(a) * r * 0.78
        return <circle key={i} cx={x} cy={y} r={1.8} fill="#050505" stroke="rgba(255,255,255,0.18)" strokeWidth={0.8} />
      })}
      <circle cx={cx} cy={cy} r={r * 0.23} fill="#020202" stroke="rgba(255,255,255,0.22)" />
      <circle cx={cx - r * 0.33} cy={cy - r * 0.16} r={3} fill="rgba(255,255,255,0.2)" />
      <circle cx={cx + r * 0.34} cy={cy + r * 0.16} r={3} fill="rgba(255,255,255,0.2)" />
      <path d={`M${cx + r * 0.78} ${cy - r * 0.72} c${r * 0.35} ${r * 0.1} ${r * 0.38} ${r * 1.38} 0 ${r * 1.55}`} fill="none" stroke="#3b3d3f" strokeWidth={8} strokeLinecap="round" />
      <path d={`M${cx + r * 0.9} ${cy - r * 0.62} c${r * 0.2} ${r * 0.18} ${r * 0.22} ${r * 1.04} 0 ${r * 1.25}`} fill="none" stroke="rgba(255,255,255,0.26)" strokeWidth={2.4} strokeLinecap="round" />
    </g>
  )
}

function BrakeCornerReadout({ x, y, corner, temp, compact = false }: { x: number; y: number; corner: CornerSpec; temp: number | undefined; compact?: boolean }): ReactElement {
  const color = brakeColor(temp)
  return (
    <g>
      <text x={x} y={y} fill={WHITE} fontFamily={FONT_LABEL} fontSize={compact ? 18 : 20} fontWeight={900} letterSpacing={3}>
        {corner.label}
      </text>
      <text x={x} y={y + (compact ? 43 : 54)} fill={temp == null ? C.dim : color} fontFamily={FONT_NUM} fontSize={compact ? 42 : 28} fontWeight={900}>
        {fixed(temp)}
      </text>
      <text x={x + (compact ? 86 : 48)} y={y + (compact ? 43 : 54)} fill={WHITE} fontFamily={FONT_LABEL} fontSize={compact ? 18 : 14} fontWeight={800}>
        °C
      </text>
    </g>
  )
}

function BrakeTempWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const temps = CORNERS.map((corner) => ({ corner, temp: brakeTemp(snapshot, corner.id) }))
  return (
    <Tile label="Brake Temp" width={width} height={height} accent={ORANGE}>
      <path d="M210 52 v178 M26 139 h368" stroke="rgba(255,255,255,0.12)" />
      {temps.map(({ corner, temp }, i) => {
        const left = i % 2 === 0
        const top = i < 2
        const discX = left ? 126 : 286
        const discY = top ? 94 : 196
        const textX = left ? 24 : 346
        const textY = top ? 76 : 178
        return (
          <g key={corner.id}>
            <BrakeDisc cx={discX} cy={discY} r={30} temp={temp} />
            <BrakeCornerReadout x={textX} y={textY} corner={corner} temp={temp} />
          </g>
        )
      })}
    </Tile>
  )
}

function BrakeTempSingleWidget({ snapshot, width, height, corner }: HifiWidgetProps & { corner: CornerSpec }): ReactElement {
  const temp = brakeTemp(snapshot, corner.id)
  return (
    <Tile label={`Brake ${corner.label}`} width={width} height={height} accent={brakeColor(temp)}>
      <BrakeDisc cx={146} cy={158} r={68} temp={temp} />
      <BrakeCornerReadout x={248} y={112} corner={corner} temp={temp} compact />
      <Bar x={250} y={190} w={112} h={12} f={fraction(temp, 250, 760)} color={brakeColor(temp)} />
      <text x={250} y={226} fill={C.dim} fontFamily={FONT_LABEL} fontSize={17} fontWeight={800} letterSpacing={2}>
        {corner.name.toUpperCase()}
      </text>
    </Tile>
  )
}

function BiasWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const bias = num(snapshot?.brakeBiasPct)
  const front = bias == null ? undefined : Math.max(0, Math.min(100, bias))
  const rear = front == null ? undefined : 100 - front
  const f = front == null ? 0.5 : front / 100
  return (
    <Tile label="Brake Bias" width={width} height={height} accent={CYAN}>
      <BigNum x={210} y={132} value={fixed(front, 1)} unit="%" color={front == null ? C.dim : WHITE} size={78} />
      <text x={210} y={172} textAnchor="middle" fill={WHITE} fontFamily={FONT_LABEL} fontSize={30} fontWeight={900} letterSpacing={5}>
        FRONT
      </text>
      <text x={70} y={222} fill={CYAN} fontFamily={FONT_LABEL} fontSize={18} fontWeight={900} letterSpacing={2}>
        FRONT
      </text>
      <text x={350} y={222} textAnchor="end" fill={AMBER} fontFamily={FONT_LABEL} fontSize={18} fontWeight={900} letterSpacing={2}>
        REAR
      </text>
      <rect x={138} y={204} width={144} height={24} fill={CYAN} opacity={0.16} stroke="rgba(255,255,255,0.25)" />
      <Bar x={138} y={204} w={144} h={24} f={f} color={CYAN} />
      <g transform={`translate(${138 + 144 * f} 0)`}>
        <rect x={0} y={198} width={3} height={36} fill={WHITE} />
      </g>
      <rect x={282} y={204} width={92} height={24} fill={AMBER} opacity={rear == null ? 0.18 : 0.9} stroke="rgba(255,255,255,0.25)" />
    </Tile>
  )
}

function GaugeTicks({ cx, cy, r, min, max, ticks }: { cx: number; cy: number; r: number; min: number; max: number; ticks: number[] }): ReactElement {
  return (
    <g>
      {Array.from({ length: 31 }, (_, i) => {
        const pct = i / 30
        const a = (-180 + pct * 180) * (Math.PI / 180)
        const major = i % 5 === 0
        const color = pct < 0.2 ? CYAN : pct > 0.82 ? RED : pct > 0.68 ? AMBER : WHITE
        return <path key={i} d={`M${cx + Math.cos(a) * (r - (major ? 18 : 11))} ${cy + Math.sin(a) * (r - (major ? 18 : 11))} L${cx + Math.cos(a) * r} ${cy + Math.sin(a) * r}`} stroke={color} strokeWidth={major ? 3 : 1.4} opacity={major ? 0.95 : 0.7} />
      })}
      {ticks.map((tick) => {
        const pct = (tick - min) / (max - min)
        const a = (-180 + pct * 180) * (Math.PI / 180)
        return (
          <text key={tick} x={cx + Math.cos(a) * (r - 38)} y={cy + Math.sin(a) * (r - 38) + 5} textAnchor="middle" fill={WHITE} fontFamily={FONT_NUM} fontSize={14} fontWeight={800}>
            {tick}
          </text>
        )
      })}
    </g>
  )
}

function GaugeWidget({ width, height, label, value, unit, min, max, ticks, color }: HifiWidgetProps & GaugeSpec): ReactElement {
  const f = fraction(value, min, max)
  const angle = (-180 + f * 180) * (Math.PI / 180)
  const cx = 210
  const cy = 170
  const r = 82
  const needleR = 62
  return (
    <Tile label={label} width={width} height={height} accent={color}>
      <GaugeArc cx={cx} cy={cy} r={r} thickness={8} f={value == null ? 0 : f} color={value == null ? C.dim : color} />
      <GaugeTicks cx={cx} cy={cy} r={r} min={min} max={max} ticks={ticks} />
      <path d={`M${cx} ${cy} L${cx + Math.cos(angle) * needleR} ${cy + Math.sin(angle) * needleR}`} stroke={value == null ? C.dim : WHITE} strokeWidth={9} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={17} fill="#17191d" stroke="rgba(255,255,255,0.2)" />
      <BigNum x={cx} y={252} value={fixed(value, unit === 'bar' ? 1 : 0)} unit={unit} color={value == null ? C.dim : WHITE} size={52} />
    </Tile>
  )
}

function LevelWidget({ snapshot, width, height, label, field, accent }: HifiWidgetProps & { label: string; field: 'tcLevel' | 'absLevel' | 'engineMap'; accent: string }): ReactElement {
  const raw = snapshot?.[field]
  const parsed = num(raw)
  const display = valueText(raw)
  return (
    <Tile label={label} width={width} height={height} accent={accent}>
      <LedRow x={76} y={74} w={268} h={4} f={parsed == null ? 0 : parsed / 10} count={12} />
      <text x={210} y={202} textAnchor="middle" fill={display === '—' ? C.dim : accent} fontFamily={FONT_BIG} fontSize={128} fontWeight={900}>
        {display}
      </text>
      <path d="M76 230 h268" stroke={accent} strokeWidth={1} opacity={display === '—' ? 0.22 : 0.55} />
    </Tile>
  )
}

function SegmentedBattery({ x, y, w, h, f, missing }: { x: number; y: number; w: number; h: number; f: number; missing: boolean }): ReactElement {
  const count = 11
  const gap = 3
  const cellW = (w - gap * (count - 1)) / count
  const lit = Math.round(clamp01(f) * count)
  return (
    <g>
      <rect x={x - 10} y={y - 10} width={w + 22} height={h + 20} rx={9} fill="none" stroke="rgba(255,255,255,0.52)" strokeWidth={3} />
      <path d={`M${x + w + 12} ${y + h * 0.28} h11 v${h * 0.44} h-11`} fill="none" stroke="rgba(255,255,255,0.52)" strokeWidth={3} strokeLinejoin="round" />
      {Array.from({ length: count }, (_, i) => {
        const pct = i / (count - 1)
        const color = pct < 0.42 ? CYAN : pct < 0.55 ? '#d7f8ff' : pct < 0.78 ? AMBER : RED
        const on = !missing && i < lit
        return <rect key={i} x={x + i * (cellW + gap)} y={y} width={cellW} height={h} rx={1.5} fill={on ? color : C.recess} opacity={on ? 1 : 0.6} stroke="rgba(255,255,255,0.10)" />
      })}
    </g>
  )
}

function ErsWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const raw = num(snapshot?.ersBatteryPct)
  const pct = raw == null ? undefined : raw <= 1 ? raw * 100 : raw
  const f = pct == null ? 0 : pct / 100
  return (
    <Tile label="ERS / Hybrid" width={width} height={height} accent={CYAN}>
      <SegmentedBattery x={91} y={94} w={238} h={50} f={f} missing={pct == null} />
      <BigNum x={210} y={218} value={fixed(pct)} unit="%" color={pct == null ? C.dim : WHITE} size={62} />
      <text x={210} y={248} textAnchor="middle" fill={CYAN} fontFamily={FONT_LABEL} fontSize={24} fontWeight={900} letterSpacing={3}>
        DEPLOY
      </text>
    </Tile>
  )
}

export const brakeTempWidget: HifiWidgetModule = {
  id: 'brakeTemp',
  title: 'Brake Temp',
  description: 'Four-corner glowing brake temperature heatmap.',
  category: 'brakesEngine',
  tags: ['brake-temp', 'heatmap', 'grid'],
  requires: ['brakeTempC'],
  defaultSize: { w: W, h: H },
  render: (props) => <BrakeTempWidget {...props} />
}

export const brakeTempFLWidget: HifiWidgetModule = {
  id: 'brakeTempFL',
  title: 'Brake Temp FL',
  description: 'Front-left brake temperature big-number tile.',
  category: 'brakesEngine',
  tags: ['brake-temp', 'bignum'],
  requires: ['brakeTempC'],
  defaultSize: { w: W, h: H },
  render: (props) => <BrakeTempSingleWidget {...props} corner={CORNERS[0]} />
}

export const brakeTempFRWidget: HifiWidgetModule = {
  id: 'brakeTempFR',
  title: 'Brake Temp FR',
  description: 'Front-right brake temperature big-number tile.',
  category: 'brakesEngine',
  tags: ['brake-temp', 'bignum'],
  requires: ['brakeTempC'],
  defaultSize: { w: W, h: H },
  render: (props) => <BrakeTempSingleWidget {...props} corner={CORNERS[1]} />
}

export const brakeTempRLWidget: HifiWidgetModule = {
  id: 'brakeTempRL',
  title: 'Brake Temp RL',
  description: 'Rear-left brake temperature big-number tile.',
  category: 'brakesEngine',
  tags: ['brake-temp', 'bignum'],
  requires: ['brakeTempC'],
  defaultSize: { w: W, h: H },
  render: (props) => <BrakeTempSingleWidget {...props} corner={CORNERS[2]} />
}

export const brakeTempRRWidget: HifiWidgetModule = {
  id: 'brakeTempRR',
  title: 'Brake Temp RR',
  description: 'Rear-right brake temperature big-number tile.',
  category: 'brakesEngine',
  tags: ['brake-temp', 'bignum'],
  requires: ['brakeTempC'],
  defaultSize: { w: W, h: H },
  render: (props) => <BrakeTempSingleWidget {...props} corner={CORNERS[3]} />
}

export const brakeBiasWidget: HifiWidgetModule = {
  id: 'brakeBias',
  title: 'Brake Bias',
  description: 'Front brake bias percentage with front/rear split bar.',
  category: 'brakesEngine',
  tags: ['brake-bias', 'bar'],
  requires: ['brakeBiasPct'],
  defaultSize: { w: W, h: H },
  render: (props) => <BiasWidget {...props} />
}

export const oilTempWidget: HifiWidgetModule = {
  id: 'oilTemp',
  title: 'Oil Temp',
  description: 'Engine oil temperature semicircular gauge.',
  category: 'brakesEngine',
  tags: ['oil', 'gauge'],
  requires: ['oilTempC'],
  defaultSize: { w: W, h: H },
  render: (props) => <GaugeWidget {...props} label="Oil Temp" value={num(props.snapshot?.oilTempC)} unit="°C" min={60} max={160} ticks={[60, 100, 140]} color={AMBER} />
}

export const waterTempWidget: HifiWidgetModule = {
  id: 'waterTemp',
  title: 'Water Temp',
  description: 'Engine water temperature semicircular gauge.',
  category: 'brakesEngine',
  tags: ['water', 'gauge'],
  requires: ['waterTempC'],
  defaultSize: { w: W, h: H },
  render: (props) => <GaugeWidget {...props} label="Water Temp" value={num(props.snapshot?.waterTempC)} unit="°C" min={40} max={140} ticks={[40, 80, 120]} color={CYAN} />
}

export const oilPressureWidget: HifiWidgetModule = {
  id: 'oilPressure',
  title: 'Oil Pressure',
  description: 'Oil pressure gauge converted from kPa to bar.',
  category: 'brakesEngine',
  tags: ['oil-press', 'gauge'],
  requires: ['oilPressureKpa'],
  defaultSize: { w: W, h: H },
  render: (props) => {
    const kpa = num(props.snapshot?.oilPressureKpa)
    return <GaugeWidget {...props} label="Oil Press" value={kpa == null ? undefined : kpa * KPA_TO_BAR} unit="bar" min={0} max={5} ticks={[0, 1, 2, 3, 4, 5]} color={AMBER} />
  }
}

export const tcWidget: HifiWidgetModule = {
  id: 'tc',
  title: 'TC',
  description: 'Traction-control level big-number tile.',
  category: 'brakesEngine',
  tags: ['tc', 'bignum'],
  requires: ['tcLevel'],
  defaultSize: { w: W, h: H },
  render: (props) => <LevelWidget {...props} label="TC" field="tcLevel" accent={CYAN} />
}

export const absWidget: HifiWidgetModule = {
  id: 'abs',
  title: 'ABS',
  description: 'ABS level big-number tile.',
  category: 'brakesEngine',
  tags: ['abs', 'bignum'],
  requires: ['absLevel'],
  defaultSize: { w: W, h: H },
  render: (props) => <LevelWidget {...props} label="ABS" field="absLevel" accent={CYAN} />
}

export const engineMapWidget: HifiWidgetModule = {
  id: 'engineMap',
  title: 'Engine Map',
  description: 'Engine-map level big-number tile.',
  category: 'brakesEngine',
  tags: ['engine-map', 'bignum'],
  requires: ['engineMap'],
  defaultSize: { w: W, h: H },
  render: (props) => <LevelWidget {...props} label="Engine Map" field="engineMap" accent={AMBER} />
}

export const ersWidget: HifiWidgetModule = {
  id: 'ers',
  title: 'ERS / Hybrid',
  description: 'Hybrid ERS battery/deploy percentage segmented bar.',
  category: 'brakesEngine',
  tags: ['ers', 'hybrid', 'bar'],
  requires: ['ersBatteryPct'],
  defaultSize: { w: W, h: H },
  render: (props) => <ErsWidget {...props} />
}
