// ── irIncidents — iRacing damage counters (incidents / fast repairs) ──────────
// Clean, transparent, title-less SVG readouts inspired by ref-ir-incidents.png and
// ref-ir-fastrepair.png. Undefined/invalid telemetry renders neutral dashes only.
import type { ReactElement, ReactNode } from 'react'
import type { HifiWidgetModule, HifiWidgetProps } from '../types'
import { BigNum, C, FONT_LABEL, LEGIBLE, legibleStroke, num } from '../kit'

const W = 340
const H = 240
const BAD_TOKENS_SAFE_DASH = '—'

function Root({ width, height, children }: HifiWidgetProps & { children: ReactNode }): ReactElement {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={width ?? W} height={height ?? H} preserveAspectRatio="xMidYMid meet" role="img">
      {children}
    </svg>
  )
}

function countLabel(value: number | undefined): string {
  return value == null ? BAD_TOKENS_SAFE_DASH : `${Math.round(value)}x`
}

function incidentColor(value: number | undefined, limit: number | undefined): string {
  if (value == null) return C.dim
  if (limit == null || limit <= 0) return C.text
  const ratio = value / limit
  if (ratio >= 1) return C.red
  if (ratio > 0.75) return C.amber
  return C.text
}

function Glow({ id, color, strength = 8 }: { id: string; color: string; strength?: number }): ReactElement {
  return (
    <filter id={id} x="-70%" y="-70%" width="240%" height="240%">
      <feFlood floodColor={color} floodOpacity="0.95" result="flood" />
      <feComposite in="flood" in2="SourceAlpha" operator="in" result="mask" />
      <feGaussianBlur in="mask" stdDeviation={strength} result="blur" />
      <feMerge>
        <feMergeNode in="blur" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>
  )
}

function WarningGlyph({ x, y, active, color }: { x: number; y: number; active: boolean; color: string }): ReactElement | null {
  if (!active) return null
  return (
    <g transform={`translate(${x} ${y})`} fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" filter="url(#irIncidentsMineGlow)">
      <path d="M0 -28 L29 24 H-29 Z" fill="rgba(255,176,32,0.13)" strokeWidth={5} />
      <path d="M0 -9 V8" strokeWidth={6} />
      <circle cx="0" cy="18" r="3.5" fill={color} stroke="none" />
    </g>
  )
}

function IncidentsMine({ width, height, snapshot }: HifiWidgetProps): ReactElement {
  const mine = num(snapshot?.incidentCountMy)
  const rawLimit = num(snapshot?.incidentLimit)
  const limit = rawLimit != null && rawLimit > 0 ? rawLimit : undefined
  const color = incidentColor(mine, limit)
  const warning = mine != null && limit != null && mine / limit > 0.75
  const limitLegibility = warning ? legibleStroke(48) : LEGIBLE
  return (
    <Root width={width} height={height} snapshot={snapshot}>
      <defs><Glow id="irIncidentsMineGlow" color={color} strength={warning ? 7 : 5} /></defs>
      <g filter={mine == null ? undefined : 'url(#irIncidentsMineGlow)'}>
        <BigNum x={W / 2} y={132} value={countLabel(mine)} color={color} size={112} />
      </g>
      {limit == null ? null : (
        <text x={warning ? W / 2 - 20 : W / 2} y={185} textAnchor="middle" fill={C.dim} fontFamily={FONT_LABEL} fontSize={48} fontWeight={800} letterSpacing={1.2} {...limitLegibility}>
          / {Math.round(limit)}x
        </text>
      )}
      <WarningGlyph x={260} y={166} active={warning} color={color === C.red ? C.red : C.amber} />
    </Root>
  )
}

function TeamGlyph({ x, y, color }: { x: number; y: number; color: string }): ReactElement {
  return (
    <g transform={`translate(${x} ${y})`} fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" opacity={0.82}>
      <circle cx="0" cy="-20" r="13" strokeWidth={7} />
      <path d="M-27 30 C-22 7 -10 -1 0 -1 C10 -1 22 7 27 30" strokeWidth={8} />
      <circle cx="-38" cy="-13" r="10" strokeWidth={6} opacity={0.68} />
      <path d="M-58 29 C-55 13 -47 7 -38 7 C-31 7 -25 10 -20 18" strokeWidth={6} opacity={0.68} />
      <circle cx="38" cy="-13" r="10" strokeWidth={6} opacity={0.68} />
      <path d="M58 29 C55 13 47 7 38 7 C31 7 25 10 20 18" strokeWidth={6} opacity={0.68} />
    </g>
  )
}

function IncidentsTeam({ width, height, snapshot }: HifiWidgetProps): ReactElement {
  const team = num(snapshot?.incidentCountTeam)
  const color = team == null ? C.dim : C.text
  return (
    <Root width={width} height={height} snapshot={snapshot}>
      <defs><Glow id="irIncidentsTeamGlow" color={C.cyan} strength={5} /></defs>
      <TeamGlyph x={78} y={144} color={team == null ? C.dim : C.cyan} />
      <g filter={team == null ? undefined : 'url(#irIncidentsTeamGlow)'}>
        <BigNum x={210} y={138} value={countLabel(team)} color={color} size={102} />
      </g>
    </Root>
  )
}

function WrenchGlyph({ x, y, color, active }: { x: number; y: number; color: string; active: boolean }): ReactElement {
  return (
    <g transform={`translate(${x} ${y}) rotate(-16) scale(0.8)`} fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" opacity={active ? 1 : 0.42}>
      <path d="M-19 -66 C-44 -48 -50 -12 -29 11 L-62 89 C-67 101 -58 115 -44 117 C-33 119 -24 112 -20 102 L13 23 C45 20 66 -8 60 -39 C58 -52 52 -64 43 -74 L28 -38 L4 -44 L18 -81 C5 -82 -8 -77 -19 -66 Z" strokeWidth={9} />
      <path d="M-29 64 L-12 25" strokeWidth={9} opacity={0.9} />
      <circle cx="-42" cy="90" r="10" strokeWidth={8} />
    </g>
  )
}

function FastRepairPips({ available, used }: { available: number | undefined; used: number | undefined }): ReactElement {
  const lit = available == null ? 0 : Math.max(0, Math.round(available))
  const dim = used == null ? 0 : Math.max(0, Math.round(used))
  const total = Math.max(1, Math.min(8, lit + dim))
  const w = 54
  const gap = 12
  const start = W / 2 - (total * w + (total - 1) * gap) / 2
  return (
    <g transform="translate(0 188)">
      {Array.from({ length: total }, (_, i) => {
        const on = i < lit
        const x = start + i * (w + gap)
        return <path key={i} d={`M${x + 12} 0 H${x + w} L${x + w - 12} 26 H${x} Z`} fill={on ? C.cyan : C.muted} opacity={on ? 1 : 0.58} />
      })}
    </g>
  )
}

function FastRepairs({ width, height, snapshot }: HifiWidgetProps): ReactElement {
  const available = num(snapshot?.fastRepairsAvailable)
  const used = num(snapshot?.fastRepairsUsed)
  const active = available != null
  const display = available == null ? BAD_TOKENS_SAFE_DASH : `${Math.max(0, Math.round(available))}`
  return (
    <Root width={width} height={height} snapshot={snapshot}>
      <defs><Glow id="irIncidentsFastRepairGlow" color={C.cyan} strength={6} /></defs>
      <g filter={active ? 'url(#irIncidentsFastRepairGlow)' : undefined}>
        <WrenchGlyph x={103} y={94} color={active ? C.cyan : C.dim} active={active} />
        <BigNum x={224} y={132} value={display} color={active ? C.cyan : C.dim} size={106} />
      </g>
      <FastRepairPips available={available} used={used} />
    </Root>
  )
}

export const incidentsMineWidget: HifiWidgetModule = {
  id: 'incidentsMine',
  title: 'My Incidents',
  description: 'Personal iRacing incident count with optional session limit and threshold colour.',
  category: 'damage',
  tags: ['incidents', 'damage', 'limit', 'clean', 'iracing'],
  requires: ['incidentCountMy', 'incidentLimit'],
  defaultSize: { w: W, h: H },
  render: (props) => <IncidentsMine {...props} />
}

export const incidentsTeamWidget: HifiWidgetModule = {
  id: 'incidentsTeam',
  title: 'Team Incidents',
  description: 'Team incident count with a compact people glyph.',
  category: 'damage',
  tags: ['incidents', 'team', 'damage', 'clean', 'iracing'],
  requires: ['incidentCountTeam'],
  defaultSize: { w: W, h: H },
  render: (props) => <IncidentsTeam {...props} />
}

export const fastRepairsWidget: HifiWidgetModule = {
  id: 'fastRepairs',
  title: 'Fast Repairs',
  description: 'Fast repairs available with wrench glyph and available/used pips.',
  category: 'damage',
  tags: ['fast-repair', 'wrench', 'damage', 'pit', 'clean', 'iracing'],
  requires: ['fastRepairsAvailable', 'fastRepairsUsed'],
  defaultSize: { w: W, h: H },
  render: (props) => <FastRepairs {...props} />
}
