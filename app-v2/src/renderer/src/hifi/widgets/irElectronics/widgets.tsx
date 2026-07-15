// ── irElectronics — iRacing electronics tell-tales (v6, gpt-image referenced) ──
// Clean, transparent, title-less DRS and push-to-pass controls. Active states glow;
// null/off states stay dim and legible over cockpit video.
import type { ReactElement, ReactNode } from 'react'
import type { HifiWidgetModule, HifiWidgetProps } from '../types'
import { BigNum, C, FONT_LABEL, LEGIBLE, legibleStroke, num } from '../kit'

const W = 320
const H = 220
const P2P_CYAN = '#00f5ff'
const OFF_FILL = 'rgba(154,163,173,0.08)'
const OFF_STROKE = 'rgba(154,163,173,0.58)'

function Root({ width, height, children }: HifiWidgetProps & { children: ReactNode }): ReactElement {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={width ?? W} height={height ?? H} preserveAspectRatio="xMidYMid meet" role="img">
      {children}
    </svg>
  )
}

function Glow({ id, color }: { id: string; color: string }): ReactElement {
  return (
    <filter id={id} x="-70%" y="-70%" width="240%" height="240%">
      <feFlood floodColor={color} floodOpacity="0.95" result="flood" />
      <feComposite in="flood" in2="SourceAlpha" operator="in" result="mask" />
      <feGaussianBlur in="mask" stdDeviation="9" result="blur" />
      <feMerge>
        <feMergeNode in="blur" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>
  )
}

function DrsBadge({ width, height, snapshot, visibility }: HifiWidgetProps): ReactElement {
  const state = snapshot?.drsState
  const deactivated = visibility?.phase === 'drs-deactivated'
  const label = deactivated
    ? 'DEACTIVATED'
    : state === 1
      ? 'AVAILABLE'
      : state === 2
        ? 'ZONE'
        : state === 3
          ? 'ACTIVE'
          : '—'
  const active = deactivated || state === 1 || state === 2 || state === 3
  const color = state === 3 && !deactivated
    ? C.green
    : state === 2 && !deactivated
      ? C.amber
      : active
        ? C.cyan
        : OFF_STROKE
  const fill = active ? `${color}38` : OFF_FILL
  return (
    <Root width={width} height={height} snapshot={snapshot}>
      <defs>
        <Glow id="irElectronicsDrsGlow" color={C.green} />
      </defs>
      <g filter={active ? 'url(#irElectronicsDrsGlow)' : undefined} opacity={active ? 1 : 0.42}>
        <rect x={29} y={55} width={262} height={111} rx={32} fill={fill} stroke={color} strokeWidth={8} />
        <text x={160} y={121} textAnchor="middle" fill={active ? color : C.dim} fontFamily={FONT_LABEL} fontSize={70} fontWeight={900} letterSpacing={5} {...legibleStroke(70)}>
          DRS
        </text>
        {label !== '—' ? (
          <text x={160} y={151} textAnchor="middle" fill={active ? color : C.dim} fontFamily={FONT_LABEL} fontSize={18} fontWeight={900} letterSpacing={2.5} {...LEGIBLE}>
            {label}
          </text>
        ) : null}
        <rect x={45} y={71} width={230} height={79} rx={24} fill="none" stroke={active ? 'rgba(255,255,255,0.76)' : 'rgba(255,255,255,0.18)'} strokeWidth={3} opacity={active ? 0.9 : 0.35} />
      </g>
    </Root>
  )
}

function Lightning({ color, active }: { color: string; active: boolean }): ReactElement {
  return (
    <path
      d="M249 48 L214 112 H244 L208 178 L219 126 H191 L226 48 Z"
      fill={active ? 'rgba(0,245,255,0.18)' : 'rgba(154,163,173,0.08)'}
      stroke={color}
      strokeWidth={8}
      strokeLinejoin="round"
      strokeLinecap="round"
    />
  )
}

function PushToPassBadge({ width, height, snapshot }: HifiWidgetProps): ReactElement {
  const active = snapshot?.pushToPass === true
  const color = active ? P2P_CYAN : OFF_STROKE
  return (
    <Root width={width} height={height} snapshot={snapshot}>
      <defs>
        <Glow id="irElectronicsP2pGlow" color={P2P_CYAN} />
      </defs>
      <g filter={active ? 'url(#irElectronicsP2pGlow)' : undefined} opacity={active ? 1 : 0.4} transform="translate(23 0) skewX(-12)">
        <text x={143} y={135} textAnchor="middle" fill={active ? 'rgba(0,245,255,0.72)' : 'rgba(154,163,173,0.22)'} fontFamily={FONT_LABEL} fontSize={92} fontWeight={900} letterSpacing={2} stroke={color} strokeWidth={5} paintOrder="stroke" strokeLinejoin="round">
          P2P
        </text>
        <text x={143} y={135} textAnchor="middle" fill={active ? 'white' : C.dim} fontFamily={FONT_LABEL} fontSize={92} fontWeight={900} letterSpacing={2} opacity={active ? 0.96 : 0.6} {...LEGIBLE}>
          P2P
        </text>
      </g>
      <g filter={active ? 'url(#irElectronicsP2pGlow)' : undefined} opacity={active ? 1 : 0.42}>
        <Lightning color={color} active={active} />
      </g>
    </Root>
  )
}

function PushToPassCount({ width, height, snapshot }: HifiWidgetProps): ReactElement {
  const raw = num(snapshot?.pushToPassCount)
  const remaining = raw == null ? undefined : Math.max(0, Math.floor(raw))
  const display = remaining == null ? '—' : String(Math.min(99, remaining))
  const total = 8
  const lit = remaining == null ? 0 : Math.max(0, Math.min(total, remaining))
  const active = lit > 0
  return (
    <Root width={width} height={height} snapshot={snapshot}>
      <defs>
        <Glow id="irElectronicsP2pCountGlow" color={P2P_CYAN} />
      </defs>
      <g filter={active ? 'url(#irElectronicsP2pCountGlow)' : undefined}>
        <BigNum x={W / 2} y={128} value={display} color={active ? 'white' : C.dim} size={112} />
      </g>
      <g transform="translate(42 172)">
        {Array.from({ length: total }, (_, i) => {
          const on = i < lit
          return (
            <circle
              key={i}
              cx={i * 34}
              cy={0}
              r={12}
              fill={on ? 'rgba(0,245,255,0.78)' : 'rgba(154,163,173,0.46)'}
              stroke={on ? P2P_CYAN : 'rgba(120,128,136,0.82)'}
              strokeWidth={4}
              filter={on ? 'url(#irElectronicsP2pCountGlow)' : undefined}
            />
          )
        })}
      </g>
    </Root>
  )
}

export const drsWidget: HifiWidgetModule = {
  id: 'drs',
  title: 'DRS',
  description: 'Trigger-only DRS state badge for available, zone, active, and the five-second deactivated hold.',
  category: 'controls',
  tags: ['drs', 'controls', 'electronics', 'badge', 'telltale', 'clean'],
  requires: ['drsState'],
  defaultSize: { w: W, h: H },
  render: (props) => <DrsBadge {...props} />
}

export const pushToPassWidget: HifiWidgetModule = {
  id: 'pushToPass',
  title: 'Push To Pass',
  description: 'Electric-cyan P2P tell-tale with a lightning glyph while push-to-pass is active.',
  category: 'controls',
  tags: ['push-to-pass', 'p2p', 'controls', 'electronics', 'badge', 'telltale', 'clean'],
  requires: ['pushToPass'],
  defaultSize: { w: W, h: H },
  render: (props) => <PushToPassBadge {...props} />
}

export const pushToPassCountWidget: HifiWidgetModule = {
  id: 'pushToPassCount',
  title: 'Push To Pass Count',
  description: 'Remaining push-to-pass uses as a large number with cyan pip dots underneath.',
  category: 'controls',
  tags: ['push-to-pass', 'p2p', 'count', 'controls', 'electronics', 'pips', 'clean'],
  requires: ['pushToPassCount'],
  defaultSize: { w: W, h: H },
  render: (props) => <PushToPassCount {...props} />
}
