import { type ReactElement, type ReactNode } from 'react'
import type { HifiWidgetModule, HifiWidgetProps } from '../types'
import { C, FONT_BIG, FONT_LABEL, FONT_NUM, Frame, VBar, fixed, num, tempColor } from '../kit'
import type { TyreInfo } from '../../../../../shared/telemetry'

const W = 420
const H = 286
const DETAIL_W = 680
const DETAIL_H = 286
const BLUE = '#2f7bff'
const GREEN = '#7ed957'
const RED = '#ff3737'
const WHITE = '#f4f5f7'
const DEG_C = '\u00b0C'
const MISSING = '\u2014'
const PSI_PER_KPA = 0.1450377377
const CORNERS = [
  { key: 'lf', label: 'FL', x: 70, y: 64 },
  { key: 'rf', label: 'FR', x: 278, y: 64 },
  { key: 'lr', label: 'RL', x: 70, y: 184 },
  { key: 'rr', label: 'RR', x: 278, y: 184 }
] as const

type CornerKey = (typeof CORNERS)[number]['key']

function tyre(snapshot: HifiWidgetProps['snapshot'], corner: CornerKey): TyreInfo | undefined {
  return snapshot?.tyres?.[corner]
}

function tyreTemp(snapshot: HifiWidgetProps['snapshot'], corner: CornerKey): number | undefined {
  return num(tyre(snapshot, corner)?.tempC)
}

function pressureKpa(snapshot: HifiWidgetProps['snapshot'], corner: CornerKey): number | undefined {
  return num(tyre(snapshot, corner)?.pressureKpa)
}

function wearPct(snapshot: HifiWidgetProps['snapshot'], corner: CornerKey): number | undefined {
  const raw = num(tyre(snapshot, corner)?.wearPct)
  if (raw == null) return undefined
  return raw <= 1 ? raw * 100 : raw
}

function safePct(v: number | undefined): number {
  if (v == null || !Number.isFinite(v)) return 0
  return Math.max(0, Math.min(100, v))
}

function pressurePsi(kpa: number | undefined): number | undefined {
  return kpa == null ? undefined : kpa * PSI_PER_KPA
}

function wearColor(v: number | undefined): string {
  if (v == null) return C.dim
  if (v <= 50) return RED
  if (v <= 70) return C.amber
  return GREEN
}

function pressureColor(kpa: number | undefined, corner: CornerKey): string {
  if (kpa == null) return C.dim
  const psi = pressurePsi(kpa) ?? 0
  if (psi < 26.5) return BLUE
  if (psi > 28.5) return RED
  return corner === 'lf' || corner === 'lr' ? BLUE : GREEN
}

function labelForCorner(corner: CornerKey): string {
  return CORNERS.find((c) => c.key === corner)?.label ?? 'FL'
}

function CelsiusUnit({ x, y, color, size }: { x: number; y: number; color: string; size: number }): ReactElement {
  return (
    <text x={x} y={y} fill={color} fontFamily="Arial, Helvetica, sans-serif" fontSize={size} fontWeight={800}>
      {DEG_C}
    </text>
  )
}

function TempReadout({ x, y, value, color, numSize, unitSize }: { x: number; y: number; value: number | undefined; color: string; numSize: number; unitSize: number }): ReactElement {
  if (value == null) {
    return (
      <text x={x} y={y} textAnchor="middle" fill={C.dim} fontFamily={FONT_BIG} fontSize={numSize} fontWeight={900}>
        {MISSING}
      </text>
    )
  }
  const digits = fixed(value)
  const unitX = x + digits.length * numSize * 0.34 + numSize * 0.03
  return (
    <g>
      <text x={x + numSize * 0.1} y={y} textAnchor="middle" fill={color} fontFamily={FONT_BIG} fontSize={numSize} fontWeight={900}>
        {digits}
      </text>
      <CelsiusUnit x={unitX} y={y - numSize * 0.02} color={color} size={unitSize} />
    </g>
  )
}

function Tile({ width, height, label, children, accent = C.cyan }: { width?: number; height?: number; label: string; children: ReactNode; accent?: string }): ReactElement {
  const w = width ?? W
  const h = height ?? H
  const id = `tyres-${label.replace(/\W+/g, '-').toLowerCase()}-${Math.round(w)}-${Math.round(h)}`
  return (
    <Frame w={w} h={h} label={label} accent={accent}>
      <defs>
        <radialGradient id={`${id}-glow`} cx="50%" cy="42%" r="68%">
          <stop offset="0" stopColor="rgba(255,255,255,0.08)" />
          <stop offset="1" stopColor="rgba(0,0,0,0)" />
        </radialGradient>
        <linearGradient id={`${id}-tyre`} x1="0" x2="1">
          <stop offset="0" stopColor="#060709" />
          <stop offset="0.45" stopColor="#50555b" />
          <stop offset="0.55" stopColor="#15181c" />
          <stop offset="1" stopColor="#050607" />
        </linearGradient>
        <filter id={`${id}-soft`} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <rect x={10} y={30} width={w - 20} height={h - 40} rx={16} fill={`url(#${id}-glow)`} />
      <text x={w / 2} y={38} textAnchor="middle" fill={WHITE} fontFamily={FONT_LABEL} fontSize={22} fontWeight={800} letterSpacing={4}>
        {label.toUpperCase()}
      </text>
      {children}
    </Frame>
  )
}

function CarPlan({ cx = 210, cy = 160, scale = 1 }: { cx?: number; cy?: number; scale?: number }): ReactElement {
  const s = scale
  return (
    <g transform={`translate(${cx} ${cy}) scale(${s})`} opacity={0.55}>
      <path d="M0 -92 C35 -86 43 -66 38 -40 C31 -20 30 35 34 82 C23 96 -23 96 -34 82 C-30 35 -31 -20 -38 -40 C-43 -66 -35 -86 0 -92 Z" fill="rgba(10,12,15,0.86)" stroke="rgba(255,255,255,0.28)" strokeWidth={2} />
      <path d="M-21 -42 C-12 -55 12 -55 21 -42 L18 38 C8 44 -8 44 -18 38 Z" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.18)" strokeWidth={1.5} />
      <path d="M-23 60 H23 M-25 -64 H25 M-31 -18 H31" stroke="rgba(255,255,255,0.18)" strokeWidth={2} />
      {[-68, 52].map((y) => (
        <g key={y}>
          <rect x={-72} y={y} width={30} height={54} rx={10} fill="#262b31" stroke="rgba(255,255,255,0.18)" />
          <rect x={42} y={y} width={30} height={54} rx={10} fill="#262b31" stroke="rgba(255,255,255,0.18)" />
        </g>
      ))}
    </g>
  )
}

function CornerShell({ x, y, color, children, wide = false }: { x: number; y: number; color: string; children: ReactNode; wide?: boolean }): ReactElement {
  const w = wide ? 88 : 74
  return (
    <g>
      <rect x={x} y={y} width={w} height={76} rx={12} fill="rgba(5,8,13,0.92)" stroke={color} strokeWidth={1.6} />
      <rect x={x + 5} y={y + 5} width={w - 10} height={66} rx={9} fill={color} opacity={0.14} />
      {children}
    </g>
  )
}

function TyreTempWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  return (
    <Tile width={width} height={height} label="Tyre Temp" accent={C.cyan}>
      <CarPlan />
      {CORNERS.map((corner) => {
        const t = tyreTemp(snapshot, corner.key)
        const color = tempColor(t)
        return (
          <g key={corner.key}>
            <text x={corner.x + 37} y={corner.y - 10} textAnchor="middle" fill={WHITE} fontFamily={FONT_LABEL} fontSize={21} fontWeight={800} letterSpacing={2}>
              {corner.label}
            </text>
            <CornerShell x={corner.x} y={corner.y} color={color}>
              <TempReadout x={corner.x + 30} y={corner.y + 47} value={t} color={WHITE} numSize={28} unitSize={14} />
            </CornerShell>
          </g>
        )
      })}
    </Tile>
  )
}

function TyrePressureWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  return (
    <Tile width={width} height={height} label="Tyre Pressure" accent={GREEN}>
      <CarPlan />
      {CORNERS.map((corner) => {
        const kpa = pressureKpa(snapshot, corner.key)
        const psi = pressurePsi(kpa)
        const color = pressureColor(kpa, corner.key)
        return (
          <g key={corner.key}>
            <text x={corner.x + 37} y={corner.y - 10} textAnchor="middle" fill={WHITE} fontFamily={FONT_LABEL} fontSize={21} fontWeight={800} letterSpacing={2}>
              {corner.label}
            </text>
            <CornerShell x={corner.x} y={corner.y} color={color}>
              <text x={corner.x + 36} y={corner.y + 38} textAnchor="middle" fill={psi == null ? C.dim : WHITE} fontFamily={FONT_NUM} fontSize={29} fontWeight={900}>
                {fixed(psi, 1)}
              </text>
              <text x={corner.x + 36} y={corner.y + 60} textAnchor="middle" fill={psi == null ? C.dim : WHITE} fontFamily={FONT_LABEL} fontSize={18} fontWeight={800}>
                psi
              </text>
              <text x={corner.x + 36} y={corner.y + 73} textAnchor="middle" fill={C.muted} fontFamily={FONT_LABEL} fontSize={10} fontWeight={700}>
                {kpa == null ? `${MISSING} kPa` : `${fixed(kpa)} kPa`}
              </text>
            </CornerShell>
          </g>
        )
      })}
    </Tile>
  )
}

function TyreWearWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  return (
    <Tile width={width} height={height} label="Tyre Wear" accent={GREEN}>
      <CarPlan />
      {CORNERS.map((corner) => {
        const wear = wearPct(snapshot, corner.key)
        const color = wearColor(wear)
        return (
          <g key={corner.key}>
            <text x={corner.x + 37} y={corner.y - 10} textAnchor="middle" fill={WHITE} fontFamily={FONT_LABEL} fontSize={21} fontWeight={800} letterSpacing={2}>
              {corner.label}
            </text>
            <CornerShell x={corner.x} y={corner.y} color={wear == null ? C.dim : 'rgba(255,255,255,0.46)'}>
              <VBar x={corner.x + 11} y={corner.y + 12} w={14} h={52} f={safePct(wear) / 100} color={color} />
              <text x={corner.x + 50} y={corner.y + 45} textAnchor="middle" fill={wear == null ? C.dim : WHITE} fontFamily={FONT_NUM} fontSize={25} fontWeight={900}>
                {fixed(wear)}
                <tspan fontFamily={FONT_LABEL} fontSize={13}>%</tspan>
              </text>
            </CornerShell>
          </g>
        )
      })}
    </Tile>
  )
}

function SingleTempWidget({ snapshot, width, height, corner }: HifiWidgetProps & { corner: CornerKey }): ReactElement {
  const t = tyreTemp(snapshot, corner)
  const color = tempColor(t)
  const label = `Tyre ${labelForCorner(corner)}`
  return (
    <Tile width={width} height={height} label={label} accent={color}>
      <g transform="translate(210 148)">
        <rect x={-88} y={-86} width={176} height={172} rx={26} fill="rgba(4,8,13,0.96)" stroke={color} strokeWidth={2.5} />
        <rect x={-72} y={-70} width={144} height={140} rx={20} fill={color} opacity={0.16} />
        <path d="M-50 -56 C-18 -72 18 -72 50 -56 M-50 56 C-18 72 18 72 50 56" stroke="rgba(255,255,255,0.16)" strokeWidth={3} fill="none" />
        <text x={0} y={-38} textAnchor="middle" fill={WHITE} fontFamily={FONT_LABEL} fontSize={28} fontWeight={800} letterSpacing={4}>
          {labelForCorner(corner)}
        </text>
        <TempReadout x={-10} y={38} value={t} color={WHITE} numSize={64} unitSize={24} />
      </g>
    </Tile>
  )
}

function bandValue(info: TyreInfo | undefined, band: 'Left' | 'Middle' | 'Right'): number | undefined {
  const core = num(info?.[`temp${band}C` as keyof TyreInfo])
  const surface = num(info?.[`surfaceTemp${band}C` as keyof TyreInfo])
  return core ?? surface
}

function TyreTread({ x, y, values, fallback }: { x: number; y: number; values: Array<number | undefined>; fallback: number | undefined }): ReactElement {
  const colors = values.map((v) => tempColor(v))
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={0} y={0} width={190} height={160} rx={34} fill="#050607" stroke="rgba(255,255,255,0.20)" strokeWidth={2} />
      {values.every((v) => v == null) ? (
        <rect x={12} y={8} width={166} height={144} rx={26} fill={tempColor(fallback)} opacity={fallback == null ? 0.12 : 0.36} />
      ) : (
        values.map((v, i) => <rect key={i} x={12 + i * 55} y={8} width={50} height={144} rx={i === 0 || i === 2 ? 20 : 3} fill={colors[i]} opacity={v == null ? 0.12 : 0.42} />)
      )}
      {Array.from({ length: 7 }, (_, i) => <path key={i} d={`M22 ${25 + i * 18} h146`} stroke="rgba(0,0,0,0.44)" strokeWidth={2} />)}
      <path d="M67 8 v144 M123 8 v144" stroke="rgba(255,255,255,0.28)" strokeDasharray="5 5" />
    </g>
  )
}

function BandBox({ x, label, value }: { x: number; label: string; value: number | undefined }): ReactElement {
  const color = tempColor(value)
  return (
    <g>
      <text x={x + 58} y={96} textAnchor="middle" fill={WHITE} fontFamily={FONT_LABEL} fontSize={20} fontWeight={800} letterSpacing={3}>
        {label}
      </text>
      <rect x={x} y={116} width={116} height={58} rx={10} fill="rgba(5,8,13,0.96)" stroke={color} strokeWidth={1.7} />
      <rect x={x + 5} y={121} width={106} height={48} rx={8} fill={color} opacity={0.14} />
      <TempReadout x={x + 51} y={154} value={value} color={WHITE} numSize={33} unitSize={15} />
    </g>
  )
}

function TyreDetailWidget({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const info = tyre(snapshot, 'lf')
  const fallback = num(info?.tempC)
  const values = [bandValue(info, 'Left'), bandValue(info, 'Middle'), bandValue(info, 'Right')]
  const hasBands = values.some((v) => v != null)
  return (
    <Tile width={width ?? DETAIL_W} height={height ?? DETAIL_H} label="Tyre Temp Detail" accent={C.cyan}>
      <TyreTread x={52} y={78} values={values} fallback={fallback} />
      {hasBands ? (
        <>
          <BandBox x={292} label="INNER" value={values[0]} />
          <BandBox x={424} label="MIDDLE" value={values[1]} />
          <BandBox x={556} label="OUTER" value={values[2]} />
          <path d="M416 108 v76 M548 108 v76" stroke="rgba(255,255,255,0.18)" strokeWidth={1.5} />
        </>
      ) : (
        <g>
          <text x={490} y={108} textAnchor="middle" fill={WHITE} fontFamily={FONT_LABEL} fontSize={22} fontWeight={800} letterSpacing={4}>
            FL AVERAGE
          </text>
          <rect x={382} y={128} width={216} height={72} rx={14} fill="rgba(5,8,13,0.96)" stroke={tempColor(fallback)} strokeWidth={2} />
          <rect x={390} y={136} width={200} height={56} rx={11} fill={tempColor(fallback)} opacity={0.14} />
          <TempReadout x={480} y={175} value={fallback} color={WHITE} numSize={46} unitSize={19} />
        </g>
      )}
      <path d="M286 218 h342" stroke="rgba(255,255,255,0.18)" />
      <g transform="translate(438 235) scale(0.42)">
        <CarPlan cx={0} cy={0} scale={1} />
      </g>
    </Tile>
  )
}

const common = {
  category: 'tyres',
  requires: ['tyres'] as const
}

export const TYRES_WIDGETS: HifiWidgetModule[] = [
  {
    id: 'tyreTemp',
    title: 'Tyre Temp',
    description: 'Four-corner tyre temperature heatmap in Celsius.',
    category: common.category,
    tags: ['tyre-temp', 'heatmap', 'grid'],
    requires: [...common.requires],
    defaultSize: { w: W, h: H },
    render: (props) => <TyreTempWidget {...props} />
  },
  {
    id: 'tyrePressure',
    title: 'Tyre Pressure',
    description: 'Four-corner tyre pressure grid with psi and kPa readouts.',
    category: common.category,
    tags: ['tyre-pressure', 'grid'],
    requires: [...common.requires],
    defaultSize: { w: W, h: H },
    render: (props) => <TyrePressureWidget {...props} />
  },
  {
    id: 'tyreWear',
    title: 'Tyre Wear',
    description: 'Four-corner tyre wear percentage with vertical bars.',
    category: common.category,
    tags: ['tyre-wear', 'grid', 'bar'],
    requires: [...common.requires],
    defaultSize: { w: W, h: H },
    render: (props) => <TyreWearWidget {...props} />
  },
  ...CORNERS.map((corner): HifiWidgetModule => ({
    id: `tyreTemp${corner.label}`,
    title: `Tyre Temp ${corner.label}`,
    description: `${corner.label} tyre temperature big-number tile.`,
    category: common.category,
    tags: ['tyre-temp', 'bignum'],
    requires: [...common.requires],
    defaultSize: { w: W, h: H },
    render: (props) => <SingleTempWidget {...props} corner={corner.key} />
  })),
  {
    id: 'tyreDetail',
    title: 'Tyre Detail',
    description: 'Front-left tyre inner, middle, and outer temperature bands with average fallback.',
    category: common.category,
    tags: ['tyre-temp', 'heatmap'],
    requires: [...common.requires],
    defaultSize: { w: DETAIL_W, h: DETAIL_H },
    render: (props) => <TyreDetailWidget {...props} />
  }
]
