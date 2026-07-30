// ── irAids — iRacing driver aids and warning tell-tales (v6) ──────────────────
// Clean, transparent, title-less aid badges and lamp clusters. Active lamps glow;
// null/off states remain dim and readable over cockpit video.
import { useSurfaceRole } from '../a11y'
import type { ReactElement, ReactNode } from 'react'
import type { HifiWidgetModule, HifiWidgetProps } from '../types'
import { Bar, BigNum, C, FONT_LABEL, LEGIBLE, VBar, legibleStroke, num } from '../kit'

const BADGE_W = 320
const BADGE_H = 240
const V_W = 220
const V_H = 300
const WARN_W = 320
const WARN_H = 240

function Root({ width, height, w, h, children }: { width: number | undefined; height: number | undefined; w: number; h: number; children: ReactNode }): ReactElement {
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={width ?? w} height={height ?? h} preserveAspectRatio="xMidYMid meet" {...useSurfaceRole()}>
      {children}
    </svg>
  )
}

function AidBadge({
  width,
  height,
  label,
  active,
  enabled,
  cutPct
}: HifiWidgetProps & { label: 'ABS' | 'TC'; active: boolean; enabled: boolean | undefined; cutPct?: number | undefined }): ReactElement {
  const color = active ? C.amber : C.dim
  const isEnabled = enabled !== false
  const opacity = active ? 1 : isEnabled ? 0.42 : 0.28
  const cut = cutPct == null ? undefined : Math.max(0, Math.min(100, cutPct <= 1 ? cutPct * 100 : cutPct))
  const showCut = label === 'ABS' && active && cut != null && cut > 0.5
  const filterId = label === 'ABS' ? 'irAidsAbsGlow' : 'irAidsTcGlow'
  return (
    <Root width={width} height={height} w={BADGE_W} h={BADGE_H}>
      <defs>
        <filter id={filterId} x="-70%" y="-70%" width="240%" height="240%">
          <feGaussianBlur stdDeviation="7" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g filter={active ? `url(#${filterId})` : undefined} opacity={opacity}>
        {label === 'ABS' ? (
          <g>
            <path d="M64 168 A98 98 0 1 1 252 168" fill="none" stroke={color} strokeWidth={18} strokeLinecap="round" />
            <path d="M33 78 A126 126 0 0 0 33 162" fill="none" stroke={color} strokeWidth={18} strokeLinecap="round" opacity={active ? 0.9 : 0.72} />
            <path d="M287 78 A126 126 0 0 1 287 162" fill="none" stroke={color} strokeWidth={18} strokeLinecap="round" opacity={active ? 0.9 : 0.72} />
          </g>
        ) : (
          <g>
            <path d="M38 58 H262 Q294 58 282 92 L254 174 Q247 194 221 194 H58 Q30 194 37 166 L56 88 Q63 58 94 58 Z" fill={active ? 'rgba(255,176,32,0.12)' : 'rgba(154,163,173,0.05)'} stroke={color} strokeWidth={7} strokeLinejoin="round" />
            <path d="M206 116 q24 -34 48 0 M202 145 q28 -34 56 0" fill="none" stroke={color} strokeWidth={7} strokeLinecap="round" opacity={active ? 0.95 : 0.62} />
          </g>
        )}
        <text x={label === 'ABS' ? 160 : 126} y={142} textAnchor="middle" fill={color} fontFamily="'Michroma','Chakra Petch',sans-serif" fontSize={label === 'ABS' ? 58 : 72} fontWeight={900} letterSpacing={2} {...legibleStroke(label === 'ABS' ? 58 : 72)}>
          {label}
        </text>
      </g>
      {showCut ? (
        <g>
          <rect x={220} y={154} width={76} height={58} rx={18} fill="rgba(255,176,32,0.12)" stroke={C.amber} strokeWidth={5} />
          <text x={258} y={193} textAnchor="middle" fill={C.amber} fontFamily={FONT_LABEL} fontSize={38} fontWeight={900} {...legibleStroke(38)}>
            {cut.toFixed(0)}
          </text>
          <Bar x={226} y={204} w={64} h={5} f={cut / 100} color={C.amber} />
        </g>
      ) : null}
      {isEnabled ? null : (
        <text x={BADGE_W / 2} y={218} textAnchor="middle" fill={C.dim} fontFamily={FONT_LABEL} fontSize={18} fontWeight={800} letterSpacing={1.8} {...LEGIBLE}>
          OFF
        </text>
      )}
    </Root>
  )
}

function HandbrakeBar({ width, height, snapshot }: HifiWidgetProps): ReactElement {
  const raw = num(snapshot?.handbrake)
  const pct = raw == null ? undefined : Math.max(0, Math.min(100, raw * 100))
  const f = pct == null ? 0 : pct / 100
  const color = pct == null ? C.dim : C.amber
  const tickYs = [62, 111, 160, 209, 258]
  return (
    <Root width={width} height={height} w={V_W} h={V_H}>
      <g transform="translate(89 14) rotate(21)" fill="none" stroke={C.amber} strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" opacity={pct == null ? 0.38 : 0.96}>
        <path d="M0 86 L28 0" />
        <path d="M14 0 H38" />
        <path d="M0 86 H-24" />
        <circle cx="0" cy="86" r="9" />
        <path d="M23 16 H42 M16 36 H36 M10 56 H29" strokeWidth={6} />
      </g>
      <VBar x={86} y={58} w={42} h={204} f={f} color={color} />
      {Array.from({ length: 16 }, (_, i) => (
        <rect key={i} x={89} y={251 - i * 12} width={36} height={1.4} fill="rgba(0,0,0,0.55)" opacity={0.7} />
      ))}
      {tickYs.map((y, i) => (
        <g key={i}>
          <line x1={68} y1={y} x2={82} y2={y} stroke={C.text} strokeWidth={4} strokeLinecap="round" opacity={0.78} />
          <line x1={132} y1={y} x2={142} y2={y} stroke={C.dim} strokeWidth={3} strokeLinecap="round" opacity={0.42} />
        </g>
      ))}
      <text x={58} y={69} textAnchor="end" fill={C.text} fontFamily={FONT_LABEL} fontSize={31} fontWeight={900} {...LEGIBLE}>100</text>
      <text x={58} y={166} textAnchor="end" fill={C.text} fontFamily={FONT_LABEL} fontSize={31} fontWeight={900} {...LEGIBLE}>50</text>
      <text x={58} y={263} textAnchor="end" fill={C.text} fontFamily={FONT_LABEL} fontSize={31} fontWeight={900} {...LEGIBLE}>0</text>
      <BigNum x={171} y={156} value={pct == null ? '—' : pct.toFixed(0)} color={color} size={58} />
      <text x={171} y={204} textAnchor="middle" fill={color} fontFamily={FONT_LABEL} fontSize={46} fontWeight={900} {...legibleStroke(46)}>%</text>
    </Root>
  )
}

type WarningKey = 'waterTemp' | 'fuelPressure' | 'oilPressure' | 'oilTemp' | 'stalled' | 'pitLimiter' | 'revLimiter' | 'mandRepair' | 'optRepair'

const WARNING_LAMPS: Array<{ key: WarningKey; label: string; color: string; icon: 'thermo' | 'fuel' | 'oil' | 'engine' | 'rev' | 'wrench' }> = [
  { key: 'oilPressure', label: 'OIL', color: C.red, icon: 'oil' },
  { key: 'waterTemp', label: 'H2O', color: C.red, icon: 'thermo' },
  { key: 'fuelPressure', label: 'FUEL', color: C.amber, icon: 'fuel' },
  { key: 'pitLimiter', label: 'PIT', color: C.amber, icon: 'fuel' },
  { key: 'stalled', label: 'ENG', color: C.red, icon: 'engine' },
  { key: 'revLimiter', label: 'REV', color: C.amber, icon: 'rev' },
  { key: 'oilTemp', label: 'TEMP', color: C.red, icon: 'thermo' },
  { key: 'mandRepair', label: 'FIX', color: C.red, icon: 'wrench' },
  { key: 'optRepair', label: 'OPT', color: C.amber, icon: 'wrench' }
]

function LampIcon({ icon, x, y, color, lit }: { icon: 'thermo' | 'fuel' | 'oil' | 'engine' | 'rev' | 'wrench'; x: number; y: number; color: string; lit: boolean }): ReactElement {
  const common = { stroke: color, strokeWidth: 5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none', opacity: lit ? 1 : 0.46 }
  if (icon === 'thermo') {
    return (
      <g {...common}>
        <path d={`M${x} ${y - 18} V${y + 10}`} />
        <circle cx={x} cy={y + 18} r={8} fill={lit ? color : 'none'} />
        <path d={`M${x + 9} ${y - 9} h10 M${x + 9} ${y + 2} h8 M${x - 18} ${y + 31} q18 -9 36 0`} />
      </g>
    )
  }
  if (icon === 'fuel') {
    return (
      <g {...common}>
        <path d={`M${x - 12} ${y - 19} h20 q6 0 6 6 v36 h-32 v-36 q0 -6 6 -6 Z`} />
        <path d={`M${x + 14} ${y - 7} q13 7 13 20 v12`} />
      </g>
    )
  }
  if (icon === 'oil') {
    return (
      <g {...common}>
        <path d={`M${x - 25} ${y + 2} h29 l22 -14 -8 26 h-38 Z`} />
        <path d={`M${x - 18} ${y - 7} l-10 -7 M${x + 30} ${y + 17} q8 9 0 17 q-8 -8 0 -17 Z`} />
      </g>
    )
  }
  if (icon === 'engine') {
    return (
      <g {...common}>
        <path d={`M${x - 24} ${y - 9} h13 l8 -9 h25 v8 h9 v28 h-12 l-8 8 h-25 l-11 -10 h-8 v-18 h9 Z`} />
        <path d={`M${x - 8} ${y - 22} h18`} />
      </g>
    )
  }
  if (icon === 'rev') {
    return (
      <g {...common}>
        <path d={`M${x - 26} ${y + 18} A28 28 0 0 1 ${x + 26} ${y + 18}`} />
        <path d={`M${x} ${y + 12} l18 -23`} />
        <circle cx={x} cy={y + 12} r={5} fill={lit ? color : 'none'} />
      </g>
    )
  }
  return (
    <g {...common}>
      <path d={`M${x - 18} ${y - 18} l36 36 M${x + 18} ${y - 18} l-36 36`} />
      <path d={`M${x - 25} ${y + 22} h50`} />
    </g>
  )
}

function EngineWarningsCluster({ width, height, snapshot }: HifiWidgetProps): ReactElement {
  const warnings = snapshot?.engineWarnings ?? null
  return (
    <Root width={width} height={height} w={WARN_W} h={WARN_H}>
      <defs>
        <filter id="irAidsWarningGlow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {WARNING_LAMPS.map((lamp, i) => {
        const col = i % 3
        const row = Math.floor(i / 3)
        const x = 58 + col * 102
        const y = 47 + row * 67
        const lit = warnings?.[lamp.key] === true
        const color = lit ? lamp.color : C.dim
        return (
          <g key={lamp.key} filter={lit ? 'url(#irAidsWarningGlow)' : undefined} opacity={lit ? 1 : 0.34}>
            <LampIcon icon={lamp.icon} x={x} y={y} color={color} lit={lit} />
            <text x={x} y={y + 49} textAnchor="middle" fill={color} fontFamily={FONT_LABEL} fontSize={17} fontWeight={900} letterSpacing={1.1} {...LEGIBLE}>
              {lamp.label}
            </text>
          </g>
        )
      })}
    </Root>
  )
}

export const absStateWidget: HifiWidgetModule = {
  id: 'absState',
  title: 'ABS State',
  description: 'ABS tell-tale badge that glows amber while ABS is intervening and shows brake-cut percent.',
  category: 'controls',
  tags: ['abs', 'brake', 'aid', 'badge', 'clean', 'telltale'],
  requires: ['absActive', 'absEnabled', 'absCutPct'],
  defaultSize: { w: BADGE_W, h: BADGE_H },
  render: (props) => <AidBadge {...props} label="ABS" active={props.snapshot?.absActive === true} enabled={props.snapshot?.absEnabled} cutPct={num(props.snapshot?.absCutPct)} />
}

export const tcStateWidget: HifiWidgetModule = {
  id: 'tcState',
  title: 'TC State',
  description: 'Traction-control tell-tale badge that glows amber while TC is intervening.',
  category: 'controls',
  tags: ['tc', 'traction-control', 'aid', 'badge', 'clean', 'telltale'],
  requires: ['tcActive', 'tcEnabled'],
  defaultSize: { w: BADGE_W, h: BADGE_H },
  render: (props) => <AidBadge {...props} label="TC" active={props.snapshot?.tcActive === true} enabled={props.snapshot?.tcEnabled} />
}

export const handbrakeWidget: HifiWidgetModule = {
  id: 'handbrake',
  title: 'Handbrake',
  description: 'Vertical handbrake percentage fill bar.',
  category: 'controls',
  tags: ['handbrake', 'bar', 'percent', 'controls', 'clean'],
  requires: ['handbrake'],
  defaultSize: { w: V_W, h: V_H },
  render: (props) => <HandbrakeBar {...props} />
}

export const engineWarningsWidget: HifiWidgetModule = {
  id: 'engineWarnings',
  title: 'Engine Warnings',
  description: 'iRacing engine warning lamp cluster using decoded per-lamp EngineWarnings flags.',
  category: 'controls',
  tags: ['engine', 'warnings', 'lamps', 'telltale', 'controls', 'clean'],
  requires: ['engineWarnings'],
  defaultSize: { w: BADGE_W, h: BADGE_H },
  render: (props) => <EngineWarningsCluster {...props} />
}
