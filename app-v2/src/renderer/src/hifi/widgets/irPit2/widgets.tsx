import type { ReactElement, ReactNode } from 'react'
import type { HifiWidgetModule, HifiWidgetProps } from '../types'
import { BigNum, C, FONT_LABEL, LEGIBLE, legibleStroke, num } from '../kit'

const W = 340
const H = 300

type ServiceToken = 'fuel' | 'lf' | 'rf' | 'lr' | 'rr'

function Root({ width, height, children }: HifiWidgetProps & { children: ReactNode }): ReactElement {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={width ?? W} height={height ?? H} preserveAspectRatio="xMidYMid meet" role="img">
      {children}
    </svg>
  )
}

function hasService(snapshot: HifiWidgetProps['snapshot'], token: ServiceToken): boolean {
  return snapshot?.pitServiceFlags?.includes(token) === true
}

function LimiterGlyph({ active, x, y }: { active: boolean; x: number; y: number }): ReactElement | null {
  if (!active) return null
  return (
    <g transform={`translate(${x} ${y})`} stroke={C.amber} strokeLinecap="round" strokeLinejoin="round">
      <path d="M-38 26 A44 44 0 1 1 38 26" fill="none" strokeWidth={8} opacity={0.95} />
      <path d="M0 26 L24 0" strokeWidth={8} />
      <circle cx={0} cy={26} r={8} fill={C.amber} stroke="none" />
      {[-34, 0, 34].map((tx, i) => <path key={i} d={`M${tx} ${i === 1 ? -18 : -2} v${i === 1 ? 17 : 14}`} strokeWidth={6} />)}
      <path d="M-15 -68 h30 v22 h21 l-36 32 l-36 -32 h21 z" fill="rgba(255,176,32,0.18)" strokeWidth={6} />
    </g>
  )
}

function PitRoad({ width, height, snapshot }: HifiWidgetProps): ReactElement {
  const onRoad = snapshot?.onPitRoad === true
  const limiter = snapshot?.pitLimiter === true
  const active = onRoad || limiter
  const color = active ? C.amber : C.dim
  return (
    <Root width={width} height={height} snapshot={snapshot}>
      {active ? (
        <g>
          <rect x={18} y={74} width={304} height={142} rx={44} fill="rgba(255,176,32,0.16)" />
          <rect x={6} y={61} width={328} height={168} rx={54} fill="rgba(255,176,32,0.08)" />
        </g>
      ) : null}
      <rect x={24} y={84} width={292} height={124} rx={38} fill={active ? 'rgba(255,176,32,0.08)' : 'rgba(154,163,173,0.045)'} stroke={color} strokeWidth={8} opacity={active ? 1 : 0.42} />
      <BigNum x={132} y={168} value="PIT" color={color} size={78} />
      <g opacity={limiter ? 1 : 0.22}>
        <LimiterGlyph active={limiter} x={254} y={132} />
        {!limiter ? (
          <g transform="translate(254 132)" stroke={C.dim} strokeLinecap="round" strokeLinejoin="round">
            <path d="M-34 24 A40 40 0 1 1 34 24" fill="none" strokeWidth={7} />
            <path d="M0 24 L22 2" strokeWidth={7} />
            <circle cx={0} cy={24} r={7} fill={C.dim} stroke="none" />
          </g>
        ) : null}
      </g>
      <text x={170} y={253} textAnchor="middle" fill={color} fontFamily={FONT_LABEL} fontSize={25} fontWeight={900} letterSpacing={2.4} opacity={active ? 0.95 : 0.38} {...LEGIBLE}>
        {limiter ? 'LIMITER' : onRoad ? 'PIT ROAD' : 'OFF'}
      </text>
    </Root>
  )
}

function FuelGlyph({ x, y, active }: { x: number; y: number; active: boolean }): ReactElement {
  const color = active ? C.cyan : C.dim
  return (
    <g transform={`translate(${x} ${y})`} fill="none" stroke={color} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" opacity={active ? 1 : 0.42}>
      <path d="M-12 -18 h21 a5 5 0 0 1 5 5 v34 h-31 v-34 a5 5 0 0 1 5 -5 z" fill={active ? 'rgba(34,195,255,0.18)' : 'rgba(154,163,173,0.06)'} />
      <path d="M14 -9 c11 6 10 17 10 27 c0 9 11 9 11 0 v-17 c0 -7 -6 -10 -10 -11" />
      <path d="M-20 21 h38" />
    </g>
  )
}

function TyreGlyph({ x, y, active }: { x: number; y: number; active: boolean }): ReactElement {
  const color = active ? C.cyan : C.dim
  return (
    <g transform={`translate(${x} ${y})`} fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" opacity={active ? 1 : 0.42}>
      <ellipse cx={0} cy={0} rx={20} ry={25} strokeWidth={6} fill={active ? 'rgba(34,195,255,0.08)' : 'rgba(154,163,173,0.04)'} />
      <circle cx={0} cy={0} r={12} strokeWidth={3.5} />
      {[0, 60, 120, 180, 240, 300].map((a) => {
        const rad = (a * Math.PI) / 180
        return <line key={a} x1={Math.cos(rad) * 4} y1={Math.sin(rad) * 4} x2={Math.cos(rad) * 12} y2={Math.sin(rad) * 12} strokeWidth={3.4} />
      })}
      <path d="M-25 -15 q-7 15 0 31" strokeWidth={2.8} opacity={0.75} />
      <path d="M-29 -7 h7 M-29 4 h7 M-28 14 h7" strokeWidth={2.8} opacity={0.75} />
    </g>
  )
}

function ServiceRow({ label, token, y, fuel, snapshot }: { label: string; token: ServiceToken; y: number; fuel?: boolean; snapshot: HifiWidgetProps['snapshot'] }): ReactElement {
  const active = hasService(snapshot, token)
  const color = active ? C.cyan : C.dim
  return (
    <g opacity={active ? 1 : 0.48}>
      <text x={54} y={y + 10} textAnchor="middle" fill={color} fontFamily={FONT_LABEL} fontSize={32} fontWeight={900} letterSpacing={1.8} {...LEGIBLE}>{label}</text>
      {fuel ? <FuelGlyph x={126} y={y - 3} active={active} /> : <TyreGlyph x={126} y={y - 3} active={active} />}
      <path d="M184 0 h46" transform={`translate(0 ${y})`} stroke={color} strokeWidth={5.5} strokeLinecap="round" opacity={active ? 0.95 : 0.55} />
      <path d="M263 0 l16 16 l35 -39" transform={`translate(0 ${y + 4})`} fill="none" stroke={color} strokeWidth={8} strokeLinecap="square" strokeLinejoin="miter" />
    </g>
  )
}

function PitService({ width, height, snapshot }: HifiWidgetProps): ReactElement {
  const rows: Array<{ label: string; token: ServiceToken; fuel?: boolean }> = [
    { label: '', token: 'fuel', fuel: true },
    { label: 'LF', token: 'lf' },
    { label: 'RF', token: 'rf' },
    { label: 'LR', token: 'lr' },
    { label: 'RR', token: 'rr' }
  ]
  return (
    <Root width={width} height={height} snapshot={snapshot}>
      {rows.map((row, i) => <ServiceRow key={row.token} {...row} y={42 + i * 53} snapshot={snapshot} />)}
    </Root>
  )
}

function StatusChip({ x, y, label, active, color, wide = 236 }: { x: number; y: number; label: string; active: boolean; color: string; wide?: number }): ReactElement {
  return (
    <g opacity={active ? 1 : 0.36}>
      {active ? <rect x={x - 7} y={y - 28} width={wide + 14} height={56} rx={18} fill={`${color}24`} /> : null}
      <rect x={x} y={y - 22} width={wide} height={44} rx={14} fill={active ? `${color}18` : 'rgba(154,163,173,0.045)'} stroke={color} strokeWidth={3} />
      <text x={x + wide / 2} y={y + 11} textAnchor="middle" fill={color} fontFamily={FONT_LABEL} fontSize={32} fontWeight={900} letterSpacing={1.8} {...LEGIBLE}>{label}</text>
    </g>
  )
}

function PitStatus({ width, height, snapshot }: HifiWidgetProps): ReactElement {
  const pit = snapshot?.pit
  const known = pit != null
  const pitsOpen = pit?.pitsOpen === true
  const inStall = pit?.inPitStall === true
  const repair = pit?.repairNeeded === true || pit?.optRepairNeeded === true
  const sv = num(pit?.svStatus)
  return (
    <Root width={width} height={height} snapshot={snapshot}>
      <StatusChip x={44} y={70} wide={252} label={known ? (pitsOpen ? 'PITS OPEN' : 'PITS CLOSED') : '—'} active={known} color={known ? (pitsOpen ? C.green : C.amber) : C.dim} />
      <StatusChip x={44} y={150} wide={252} label={known ? 'IN STALL' : '—'} active={inStall} color={inStall ? C.cyan : C.dim} />
      <StatusChip x={44} y={230} wide={252} label={known ? 'REPAIR' : '—'} active={repair} color={repair ? C.red : C.dim} />
      <text x={W - 26} y={286} textAnchor="end" fill={known && sv != null ? C.dim : 'rgba(154,163,173,0.36)'} fontFamily={FONT_LABEL} fontSize={18} fontWeight={800} letterSpacing={1.2} {...LEGIBLE}>
        SV {known && sv != null ? sv.toFixed(0) : '—'}
      </text>
    </Root>
  )
}

export const pitRoadWidget: HifiWidgetModule = {
  id: 'pitRoad',
  title: 'Pit Road',
  description: 'Amber PIT badge that glows when the car is on pit road or the limiter is active.',
  category: 'pit',
  tags: ['pit', 'pit-road', 'limiter', 'badge', 'clean'],
  requires: ['onPitRoad', 'pitLimiter'],
  defaultSize: { w: W, h: H },
  render: (props) => <PitRoad {...props} />
}

export const pitServiceWidget: HifiWidgetModule = {
  id: 'pitService',
  title: 'Pit Service',
  description: 'Fuel and tyre service checklist lit from iRacing PitSvFlags tokens.',
  category: 'pit',
  tags: ['pit', 'service', 'fuel', 'tyres', 'checklist', 'clean'],
  requires: ['pitServiceFlags'],
  defaultSize: { w: W, h: H },
  render: (props) => <PitService {...props} />
}

export const pitStatusWidget: HifiWidgetModule = {
  id: 'pitStatus',
  title: 'Pit Status',
  description: 'Compact pit-open, stall, and repair status indicators from iRacing pit telemetry.',
  category: 'pit',
  tags: ['pit', 'status', 'stall', 'repair', 'badge', 'clean'],
  requires: ['pit'],
  defaultSize: { w: W, h: H },
  render: (props) => <PitStatus {...props} />
}
