import { type ReactElement } from 'react'
import type { HifiWidgetModule, HifiWidgetProps } from '../types'
import { C, CleanTile, FONT_BIG, FONT_LABEL, FONT_NUM, GaugeArc, fixed, frac, gearLabel, legibleStroke, num } from '../kit'

const REV_W = 960
const REV_H = 90
const CLUSTER_W = 460
const CLUSTER_H = 300

const PAL = {
  ferrari: { main: '#DC0000', accent: '#FFD21F', aux: '#1B7CFF', text: '#fff7e6', dim: '#4a2721', ramp: ['#00e676', '#ffd21f', '#ff8a00', '#DC0000'] },
  porsche: { main: '#F5F7FA', accent: '#E30613', aux: '#ffffff', text: '#f6f6f6', dim: '#33363a', ramp: ['#ffffff', '#f5f7fa', '#ff3845', '#E30613'] },
  amg: { main: '#00A19B', accent: '#D6FFF9', aux: '#ff3045', text: '#effffd', dim: '#123431', ramp: ['#00A19B', '#58ffe8', '#ffd42a', '#ff3045'] },
  mclaren: { main: '#FF8000', accent: '#FFE15A', aux: '#00e5ff', text: '#fff2df', dim: '#43290f', ramp: ['#00ffd0', '#8cff00', '#ffd600', '#FF8000', '#ff2b1f'] },
  corvette: { main: '#FFD700', accent: '#F33A22', aux: '#f8f8f8', text: '#fff7c2', dim: '#40380f', ramp: ['#20ff60', '#FFD700', '#ff9a00', '#F33A22'] },
  lambo: { main: '#A6D608', accent: '#7A3CFF', aux: '#ff2f45', text: '#f3ffd0', dim: '#2f3b10', ramp: ['#A6D608', '#dfff35', '#7A3CFF', '#ff2f45'] }
} as const

type Family = keyof typeof PAL

function safeShift(snapshot: HifiWidgetProps['snapshot']): { f: number; missing: boolean } {
  const shift = num(snapshot?.shiftIndicatorPct)
  if (shift != null) return { f: frac(shift, 0, 1), missing: false }
  const rpm = num(snapshot?.rpm)
  const max = num(snapshot?.maxRpm)
  if (rpm != null && max != null && max > 0) return { f: frac(rpm, 0, max), missing: false }
  return { f: 0, missing: true }
}

function activeCount(f: number, count: number, missing: boolean): number {
  return missing ? 0 : Math.round(frac(f, 0, 1) * count)
}

function pickRamp(family: Family, pct: number): string {
  const ramp = PAL[family].ramp
  const i = Math.min(ramp.length - 1, Math.floor(pct * ramp.length))
  return ramp[i]
}

function GlowDefs({ id, color }: { id: string; color: string }): ReactElement {
  return (
    <defs>
      <filter id={`${id}-glow`} x="-80%" y="-180%" width="260%" height="460%">
        <feGaussianBlur stdDeviation="5" result="blur" />
        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
      <linearGradient id={`${id}-grad`} x1="0" x2="1" y1="0" y2="0">
        <stop offset="0%" stopColor={PAL.mclaren.ramp[0]} />
        <stop offset="34%" stopColor={PAL.mclaren.ramp[1]} />
        <stop offset="58%" stopColor={PAL.mclaren.ramp[2]} />
        <stop offset="78%" stopColor={PAL.mclaren.main} />
        <stop offset="100%" stopColor={PAL.mclaren.ramp[4]} />
      </linearGradient>
      <linearGradient id={`${id}-fade`} x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stopColor={color} stopOpacity="0.95" />
        <stop offset="100%" stopColor={color} stopOpacity="0.35" />
      </linearGradient>
    </defs>
  )
}

function FerrariRev({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const { f, missing } = safeShift(snapshot)
  const lit = activeCount(f, 29, missing)
  const w = width ?? REV_W
  const h = height ?? REV_H
  return (
    <CleanTile width={w} height={h}>
      <GlowDefs id="themed-ferrari-rev" color={PAL.ferrari.accent} />
      {Array.from({ length: 29 }, (_, i) => {
        const pct = i / 28
        const x = 84 + pct * (w - 168)
        const y = 62 - Math.sin(pct * Math.PI) * 42
        const on = i < lit
        const blue = pct > 0.44 && pct < 0.56 && f > 0.92 && !missing
        return <circle key={i} cx={x} cy={y} r={blue ? 13 : 10.5} fill={on || blue ? (blue ? PAL.ferrari.aux : pickRamp('ferrari', pct)) : C.recess} opacity={on || blue ? 1 : 0.42} filter={on || blue ? 'url(#themed-ferrari-rev-glow)' : undefined} />
      })}
    </CleanTile>
  )
}

function PorscheRev({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const { f, missing } = safeShift(snapshot)
  const count = 22
  const lit = activeCount(f, count, missing)
  const w = width ?? REV_W
  const h = height ?? REV_H
  const x = 72
  const gap = 9
  const cell = (w - x * 2 - gap * (count - 1)) / count
  return (
    <CleanTile width={w} height={h}>
      <GlowDefs id="themed-porsche-rev" color={PAL.porsche.main} />
      {[0, 1].map((side) => <rect key={side} x={side === 0 ? 18 : w - 52} y={21} width={34} height={48} rx={7} fill={!missing && f > 0.9 ? PAL.porsche.aux : C.recess} opacity={!missing && f > 0.9 ? 1 : 0.38} filter={!missing && f > 0.9 ? 'url(#themed-porsche-rev-glow)' : undefined} />)}
      {Array.from({ length: count }, (_, i) => {
        const pct = i / (count - 1)
        const on = i < lit
        return <rect key={i} x={x + i * (cell + gap)} y={25} width={cell} height={40} rx={3} fill={on ? (pct < 0.72 ? PAL.porsche.main : PAL.porsche.accent) : C.recess} opacity={on ? 1 : 0.44} />
      })}
    </CleanTile>
  )
}

function AmgRev({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const { f, missing } = safeShift(snapshot)
  const count = 24
  const lit = activeCount(f, count, missing)
  const w = width ?? REV_W
  const h = height ?? REV_H
  const gap = 8
  const clusterGap = 42
  const x0 = 58
  const cell = (w - 116 - gap * (count - 3) - clusterGap * 2) / count
  return (
    <CleanTile width={w} height={h}>
      <GlowDefs id="themed-amg-rev" color={PAL.amg.main} />
      {Array.from({ length: count }, (_, i) => {
        const cluster = Math.floor(i / 8)
        const local = i % 8
        const x = x0 + i * (cell + gap) + cluster * clusterGap
        const on = i < lit
        const color = cluster === 0 ? PAL.amg.main : cluster === 1 ? '#ffd42a' : PAL.amg.aux
        return <rect key={i} x={x} y={18 + (local % 2) * 9} width={cell} height={45} rx={6} fill={on ? color : C.recess} opacity={on ? 1 : 0.42} filter={on ? 'url(#themed-amg-rev-glow)' : undefined} />
      })}
      <rect x={w / 2 - 5} y={15} width={10} height={60} rx={5} fill="rgba(255,255,255,0.16)" />
    </CleanTile>
  )
}

function MclarenRev({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const { f, missing } = safeShift(snapshot)
  const w = width ?? REV_W
  const h = height ?? REV_H
  const x = 46
  const y = 39
  const bw = w - x * 2
  const litW = missing ? 0 : bw * f
  return (
    <CleanTile width={w} height={h}>
      <GlowDefs id="themed-mclaren-rev" color={PAL.mclaren.main} />
      <rect x={x} y={y} width={bw} height={13} rx={6.5} fill={C.recess} opacity={0.55} />
      <rect x={x} y={y} width={litW} height={13} rx={6.5} fill="url(#themed-mclaren-rev-grad)" filter={litW > 0 ? 'url(#themed-mclaren-rev-glow)' : undefined} />
      {Array.from({ length: 54 }, (_, i) => <rect key={i} x={x + i * (bw / 54)} y={32} width={2} height={27} fill="rgba(0,0,0,0.44)" />)}
    </CleanTile>
  )
}

function CorvetteRev({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const { f, missing } = safeShift(snapshot)
  const perRow = 16
  const lit = activeCount(f, perRow * 2, missing)
  const w = width ?? REV_W
  const h = height ?? REV_H
  const gap = 8
  const centerGap = 46
  const cell = (w - 92 - centerGap - gap * (perRow - 2)) / perRow
  return (
    <CleanTile width={w} height={h}>
      <GlowDefs id="themed-corvette-rev" color={PAL.corvette.main} />
      {[0, 1].map((row) => Array.from({ length: perRow }, (_, i) => {
        const rightHalf = i >= perRow / 2
        const x = 46 + i * (cell + gap) + (rightHalf ? centerGap : 0)
        const y = row === 0 ? 19 : 50
        const idx = row * perRow + i
        const pct = idx / (perRow * 2 - 1)
        const on = idx < lit
        return <rect key={`${row}-${i}`} x={x} y={y} width={cell} height={20} rx={4} fill={on ? pickRamp('corvette', pct) : C.recess} opacity={on ? 1 : 0.42} filter={on ? 'url(#themed-corvette-rev-glow)' : undefined} />
      }))}
      <rect x={w / 2 - 7} y={14} width={14} height={62} rx={4} fill="rgba(255,255,255,0.13)" />
    </CleanTile>
  )
}

function LamboRev({ snapshot, width, height }: HifiWidgetProps): ReactElement {
  const { f, missing } = safeShift(snapshot)
  const count = 20
  const lit = activeCount(f, count, missing)
  const w = width ?? REV_W
  const h = height ?? REV_H
  const cellW = 34
  const gap = 10
  const x0 = (w - count * cellW - (count - 1) * gap) / 2
  return (
    <CleanTile width={w} height={h}>
      <GlowDefs id="themed-lambo-rev" color={PAL.lambo.main} />
      {Array.from({ length: count }, (_, i) => {
        const pct = i / (count - 1)
        const x = x0 + i * (cellW + gap)
        const y = 18 + (i % 2) * 7
        const on = i < lit
        const color = pct < 0.5 ? PAL.lambo.main : pct < 0.78 ? PAL.lambo.accent : PAL.lambo.aux
        const points = `${x + 8},${y} ${x + cellW - 6},${y} ${x + cellW},${y + 18} ${x + cellW - 8},${y + 38} ${x + 6},${y + 38} ${x},${y + 18}`
        return <polygon key={i} points={points} fill={on ? color : C.recess} stroke={on ? color : 'rgba(255,255,255,0.12)'} strokeWidth={2} opacity={on ? 1 : 0.48} filter={on ? 'url(#themed-lambo-rev-glow)' : undefined} />
      })}
    </CleanTile>
  )
}

function MiniStrip({ family, f, missing, x, y, w }: { family: Family; f: number; missing: boolean; x: number; y: number; w: number }): ReactElement {
  const count = 18
  const gap = 4
  const cell = (w - gap * (count - 1)) / count
  const lit = activeCount(f, count, missing)
  return <g>{Array.from({ length: count }, (_, i) => <rect key={i} x={x + i * (cell + gap)} y={y} width={cell} height={10} rx={2} fill={i < lit ? pickRamp(family, i / (count - 1)) : C.recess} opacity={i < lit ? 1 : 0.46} />)}</g>
}

function TempBox({ x, label, value, color }: { x: number; label: string; value: number | undefined; color: string }): ReactElement {
  return (
    <g>
      <path d={`M${x} 236 h78 l-10 16 h-58 z`} fill="rgba(0,0,0,0.28)" stroke={color} strokeWidth={1.5} opacity={0.95} />
      <text x={x + 13} y={247} fill={C.dim} fontFamily={FONT_LABEL} fontSize={13} fontWeight={700}>{label}</text>
      <text x={x + 64} y={248} textAnchor="end" fill={value == null ? C.dim : color} fontFamily={FONT_NUM} fontSize={17} fontWeight={800} {...legibleStroke(17)}>{fixed(value)}°</text>
    </g>
  )
}

function SignatureCluster({ snapshot, width, height, family }: HifiWidgetProps & { family: Family }): ReactElement {
  const p = PAL[family]
  const speed = num(snapshot?.speedKmh)
  const gear = num(snapshot?.gear)
  const rpm = num(snapshot?.rpm)
  const max = num(snapshot?.maxRpm)
  const water = num(snapshot?.waterTempC)
  const oil = num(snapshot?.oilTempC)
  const { f, missing } = safeShift(snapshot)
  const rpmF = rpm != null && max != null && max > 0 ? frac(rpm, 0, max) : f
  return (
    <CleanTile width={width ?? CLUSTER_W} height={height ?? CLUSTER_H}>
      <GlowDefs id={`themed-${family}-cluster`} color={p.main} />
      <MiniStrip family={family} f={f} missing={missing} x={52} y={28} w={356} />
      <path d="M48 62 h92 l20 18 h140 l20 -18 h92" fill="none" stroke={p.main} strokeWidth={2.5} opacity={0.75} />
      <GaugeArc cx={230} cy={177} r={101} thickness={8} f={rpmF} color={rpm == null && missing ? C.dim : p.main} />
      <path d="M118 180 A112 112 0 0 1 342 180" fill="none" stroke={p.accent} strokeWidth={1.5} opacity={0.45} strokeDasharray={family === 'lambo' ? '12 8' : family === 'porsche' ? '4 10' : '2 7'} />
      <text x={230} y={159} textAnchor="middle" fill={gear == null ? C.dim : p.text} fontFamily={FONT_BIG} fontSize={96} fontWeight={900} {...legibleStroke(96)}>{gear == null ? '–' : gearLabel(gear)}</text>
      <text x={230} y={204} textAnchor="middle" fill={speed == null ? C.dim : p.main} fontFamily={FONT_BIG} fontSize={42} fontWeight={900} letterSpacing={-2} {...legibleStroke(42)}>{fixed(speed)}</text>
      <text x={230} y={226} textAnchor="middle" fill={speed == null ? C.dim : p.accent} fontFamily={FONT_LABEL} fontSize={22} fontWeight={800} letterSpacing={1}>km/h</text>
      <TempBox x={72} label="W" value={water} color={p.main} />
      <TempBox x={310} label="O" value={oil} color={p.accent} />
      {family === 'ferrari' ? <path d="M96 76 C150 48 310 48 364 76" fill="none" stroke={p.accent} strokeWidth={5} opacity={0.7} /> : null}
      {family === 'porsche' ? <path d="M80 84 H380" stroke={p.accent} strokeWidth={4} strokeDasharray="34 8" /> : null}
      {family === 'amg' ? <path d="M94 82 H182 M204 82 H256 M278 82 H366" stroke={p.main} strokeWidth={5} strokeLinecap="round" /> : null}
      {family === 'mclaren' ? <path d="M76 83 H384" stroke={p.main} strokeWidth={6} strokeLinecap="round" opacity={0.88} /> : null}
      {family === 'corvette' ? <path d="M86 82 H190 M270 82 H374 M86 96 H190 M270 96 H374" stroke={p.main} strokeWidth={4} /> : null}
      {family === 'lambo' ? <path d="M92 92 l18 -20 h240 l18 20" fill="none" stroke={p.accent} strokeWidth={4} strokeLinejoin="round" /> : null}
    </CleanTile>
  )
}

const revRequires: HifiWidgetModule['requires'] = ['shiftIndicatorPct', 'rpm', 'maxRpm']
const clusterRequires: HifiWidgetModule['requires'] = ['gear', 'speedKmh', 'rpm', 'maxRpm', 'shiftIndicatorPct', 'waterTempC', 'oilTempC']

export const revThemedFerrari: HifiWidgetModule = { id: 'revThemedFerrari', title: 'Ferrari themed rev lights', description: 'Ferrari-inspired round LED arc with blue top shift cue.', category: 'themed', tags: ['rev-lights', 'themed', 'ferrari'], requires: revRequires, defaultSize: { w: REV_W, h: REV_H }, render: (props) => <FerrariRev {...props} /> }
export const revThemedPorsche: HifiWidgetModule = { id: 'revThemedPorsche', title: 'Porsche themed rev lights', description: 'Porsche Cup-inspired rectangular bar with white end flashers.', category: 'themed', tags: ['rev-lights', 'themed', 'porsche'], requires: revRequires, defaultSize: { w: REV_W, h: REV_H }, render: (props) => <PorscheRev {...props} /> }
export const revThemedAmg: HifiWidgetModule = { id: 'revThemedAmg', title: 'AMG themed rev lights', description: 'AMG-inspired three-cluster green/yellow/red shift lights.', category: 'themed', tags: ['rev-lights', 'themed', 'amg'], requires: revRequires, defaultSize: { w: REV_W, h: REV_H }, render: (props) => <AmgRev {...props} /> }
export const revThemedMclaren: HifiWidgetModule = { id: 'revThemedMclaren', title: 'McLaren themed rev lights', description: 'McLaren-inspired thin continuous gradient shift strip.', category: 'themed', tags: ['rev-lights', 'themed', 'mclaren'], requires: revRequires, defaultSize: { w: REV_W, h: REV_H }, render: (props) => <MclarenRev {...props} /> }
export const revThemedCorvette: HifiWidgetModule = { id: 'revThemedCorvette', title: 'Corvette themed rev lights', description: 'Corvette-inspired dual stacked LED rows with center split.', category: 'themed', tags: ['rev-lights', 'themed', 'corvette'], requires: revRequires, defaultSize: { w: REV_W, h: REV_H }, render: (props) => <CorvetteRev {...props} /> }
export const revThemedLambo: HifiWidgetModule = { id: 'revThemedLambo', title: 'Lamborghini themed rev lights', description: 'Lamborghini-inspired angular hex segment rev lights.', category: 'themed', tags: ['rev-lights', 'themed', 'lamborghini'], requires: revRequires, defaultSize: { w: REV_W, h: REV_H }, render: (props) => <LamboRev {...props} /> }

export const clusterFerrari: HifiWidgetModule = { id: 'clusterFerrari', title: 'Ferrari cluster signature', description: 'Ferrari palette compact gear, speed, RPM, temps, and rev strip.', category: 'themed', tags: ['cluster', 'themed', 'ferrari'], requires: clusterRequires, defaultSize: { w: CLUSTER_W, h: CLUSTER_H }, render: (props) => <SignatureCluster {...props} family="ferrari" /> }
export const clusterPorsche: HifiWidgetModule = { id: 'clusterPorsche', title: 'Porsche cluster signature', description: 'Porsche palette compact gear, speed, RPM, temps, and rev strip.', category: 'themed', tags: ['cluster', 'themed', 'porsche'], requires: clusterRequires, defaultSize: { w: CLUSTER_W, h: CLUSTER_H }, render: (props) => <SignatureCluster {...props} family="porsche" /> }
export const clusterAmg: HifiWidgetModule = { id: 'clusterAmg', title: 'AMG cluster signature', description: 'AMG teal compact gear, speed, RPM, temps, and rev strip.', category: 'themed', tags: ['cluster', 'themed', 'amg'], requires: clusterRequires, defaultSize: { w: CLUSTER_W, h: CLUSTER_H }, render: (props) => <SignatureCluster {...props} family="amg" /> }
export const clusterMclaren: HifiWidgetModule = { id: 'clusterMclaren', title: 'McLaren cluster signature', description: 'McLaren papaya compact gear, speed, RPM, temps, and rev strip.', category: 'themed', tags: ['cluster', 'themed', 'mclaren'], requires: clusterRequires, defaultSize: { w: CLUSTER_W, h: CLUSTER_H }, render: (props) => <SignatureCluster {...props} family="mclaren" /> }
export const clusterCorvette: HifiWidgetModule = { id: 'clusterCorvette', title: 'Corvette cluster signature', description: 'Corvette yellow compact gear, speed, RPM, temps, and rev strip.', category: 'themed', tags: ['cluster', 'themed', 'corvette'], requires: clusterRequires, defaultSize: { w: CLUSTER_W, h: CLUSTER_H }, render: (props) => <SignatureCluster {...props} family="corvette" /> }
export const clusterLambo: HifiWidgetModule = { id: 'clusterLambo', title: 'Lamborghini cluster signature', description: 'Lamborghini lime/violet compact gear, speed, RPM, temps, and rev strip.', category: 'themed', tags: ['cluster', 'themed', 'lamborghini'], requires: clusterRequires, defaultSize: { w: CLUSTER_W, h: CLUSTER_H }, render: (props) => <SignatureCluster {...props} family="lambo" /> }
