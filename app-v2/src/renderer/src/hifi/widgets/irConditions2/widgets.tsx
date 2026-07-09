// ── irConditions2 — weather/track condition tell-tales (v6, gpt-image referenced) ──
// Clean, transparent, title-less condition badges: rain state, steward wet declared,
// and current track surface. Off/null states stay dim; active conditions glow strongly.
import type { ReactElement, ReactNode } from 'react'
import { trackSurfaceMaterialLabel } from '../../../../../shared/telemetry'
import type { HifiWidgetModule, HifiWidgetProps } from '../types'
import { BigNum, C, FONT_LABEL, LEGIBLE, legibleStroke, num } from '../kit'

const W = 360
const H = 300

function Root({ width, height, children }: HifiWidgetProps & { children: ReactNode }): ReactElement {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={width ?? W} height={height ?? H} preserveAspectRatio="xMidYMid meet" role="img">
      {children}
    </svg>
  )
}

function Drop({ x, y, color, active }: { x: number; y: number; color: string; active: boolean }): ReactElement {
  return (
    <path
      d={`M${x} ${y - 30} C${x + 20} ${y - 2} ${x + 23} ${y + 9} ${x + 23} ${y + 22} A23 23 0 0 1 ${x - 23} ${y + 22} C${x - 23} ${y + 9} ${x - 20} ${y - 2} ${x} ${y - 30} Z`}
      fill={active ? 'rgba(34,195,255,0.18)' : 'rgba(154,163,173,0.08)'}
      stroke={color}
      strokeWidth={8}
      strokeLinejoin="round"
      opacity={active ? 1 : 0.42}
    />
  )
}

function RainGlyph({ width, height, snapshot }: HifiWidgetProps): ReactElement {
  const active = snapshot?.isRaining === true
  const color = active ? C.cyan : C.dim
  const glowOpacity = active ? 0.86 : 0
  return (
    <Root width={width} height={height} snapshot={snapshot}>
      <defs>
        <filter id="irConditions2RainGlow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="8" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g transform="translate(8 22) scale(0.72)" filter={active ? 'url(#irConditions2RainGlow)' : undefined}>
        <path
          d="M87 146 C87 114 112 88 145 88 C156 49 190 31 226 44 C258 56 278 84 281 121 C313 120 335 144 335 174 C335 207 309 229 276 229 H92 C57 229 31 204 31 172 C31 139 55 114 88 113"
          fill={active ? 'rgba(34,195,255,0.10)' : 'rgba(154,163,173,0.05)'}
          stroke={color}
          strokeWidth={12}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={active ? 1 : 0.36}
        />
        <g>
          <Drop x={108} y={253} color={color} active={active} />
          <Drop x={181} y={253} color={color} active={active} />
          <Drop x={254} y={253} color={color} active={active} />
        </g>
      </g>
      {active ? <ellipse cx={140} cy={146} rx={112} ry={82} fill="none" stroke={C.cyan} strokeWidth={2} opacity={glowOpacity * 0.18} /> : null}
      <text x={W - 20} y={254} textAnchor="end" fill={color} fontFamily={FONT_LABEL} fontSize={54} fontWeight={800} letterSpacing={2} opacity={active ? 1 : 0.5} {...legibleStroke(54)}>
        {active ? 'WET' : 'DRY'}
      </text>
    </Root>
  )
}

function WetDeclaredBadge({ width, height, snapshot }: HifiWidgetProps): ReactElement {
  const active = snapshot?.weatherDeclaredWet === true
  const color = active ? C.amber : C.dim
  return (
    <Root width={width} height={height} snapshot={snapshot}>
      <defs>
        <filter id="irConditions2WetDeclaredGlow" x="-70%" y="-70%" width="240%" height="240%">
          <feGaussianBlur stdDeviation="10" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g transform="translate(180 122)" filter={active ? 'url(#irConditions2WetDeclaredGlow)' : undefined} opacity={active ? 1 : 0.38}>
        <path d="M0 -78 L76 -44 V18 C76 63 43 94 0 112 C-43 94 -76 63 -76 18 V-44 Z" fill={active ? 'rgba(255,176,32,0.14)' : 'rgba(154,163,173,0.06)'} stroke={color} strokeWidth={8} strokeLinejoin="round" />
        <path d="M-34 -42 V52" stroke={color} strokeWidth={8} strokeLinecap="round" />
        <path d="M-25 -42 C1 -58 22 -28 51 -44 V16 C22 32 1 2 -25 18 Z" fill={active ? 'rgba(255,176,32,0.30)' : 'rgba(154,163,173,0.10)'} stroke={color} strokeWidth={6} strokeLinejoin="round" />
        <circle cx="0" cy="76" r="13" fill={color} opacity={active ? 0.95 : 0.72} />
      </g>
      <text x={W / 2} y={264} textAnchor="middle" fill={color} fontFamily={FONT_LABEL} fontSize={36} fontWeight={900} letterSpacing={2.2} opacity={active ? 1 : 0.5} {...LEGIBLE}>
        WET DECLARED
      </text>
    </Root>
  )
}

function surfaceColor(label: string | undefined): string {
  if (label === 'grass' || label === 'grasscrete' || label === 'astroturf') return C.green
  if (label === 'sand' || label === 'gravel' || label === 'dirt' || label === 'racing dirt') return C.amber
  if (label === 'kerb' || label === 'paint') return C.cyan
  if (label === 'concrete') return C.text
  if (label === 'asphalt') return C.cyan
  return C.dim
}

function SurfaceGlyph({ label, color }: { label: string | undefined; color: string }): ReactElement {
  const active = label != null
  if (label === 'kerb' || label === 'paint') {
    return (
      <g opacity={active ? 1 : 0.32}>
        <path d="M112 46 H248 L292 162 H68 Z" fill="rgba(255,255,255,0.82)" stroke={active ? C.red : C.dim} strokeWidth={2} strokeLinejoin="round" />
        {[0, 1, 2].map((i) => (
          <path key={i} d={`M${118 + i * 38} ${46 + i * 39} H${248 - i * 16} L${262 + i * 15} ${83 + i * 39} H${103 + i * 24} Z`} fill={active ? C.red : C.dim} opacity={active ? 0.95 : 0.55} />
        ))}
      </g>
    )
  }
  if (label === 'grass' || label === 'grasscrete' || label === 'astroturf') {
    return (
      <g stroke={color} strokeWidth={6} strokeLinecap="round" opacity={active ? 0.95 : 0.3}>
        {Array.from({ length: 9 }, (_, i) => {
          const x = 86 + i * 23
          return <path key={i} d={`M${x} 164 C${x - 9} 125 ${x + 4} 92 ${x + 24} 58`} />
        })}
      </g>
    )
  }
  if (label === 'sand' || label === 'gravel' || label === 'dirt' || label === 'racing dirt') {
    return (
      <g fill={color} opacity={active ? 0.9 : 0.28}>
        {Array.from({ length: 18 }, (_, i) => <circle key={i} cx={70 + (i % 6) * 42} cy={60 + Math.floor(i / 6) * 42 + (i % 2) * 8} r={6 + (i % 3)} />)}
      </g>
    )
  }
  return (
    <g opacity={active ? 0.9 : 0.3}>
      <path d="M72 76 H288 L264 162 H96 Z" fill="rgba(34,195,255,0.08)" stroke={color} strokeWidth={5} strokeLinejoin="round" />
      <path d="M116 99 H244 M104 130 H256" stroke={color} strokeWidth={4} strokeLinecap="round" opacity={0.62} />
    </g>
  )
}

function TrackSurface({ width, height, snapshot }: HifiWidgetProps): ReactElement {
  const raw = num(snapshot?.trackSurfaceMaterial)
  const label = trackSurfaceMaterialLabel(raw)
  const display = label == null ? '—' : label.toUpperCase()
  const color = surfaceColor(label)
  const fontSize = display.length > 10 ? 47 : display.length > 7 ? 58 : 70
  return (
    <Root width={width} height={height} snapshot={snapshot}>
      <defs>
        <filter id="irConditions2SurfaceGlow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="7" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g filter={label ? 'url(#irConditions2SurfaceGlow)' : undefined}>
        <SurfaceGlyph label={label} color={color} />
      </g>
      <BigNum x={W / 2} y={244} value={display} color={color} size={fontSize} />
      {raw == null || label != null ? null : (
        <text x={W / 2} y={280} textAnchor="middle" fill={C.dim} fontFamily={FONT_LABEL} fontSize={20} fontWeight={800} letterSpacing={1.4} {...LEGIBLE}>
          SURFACE {raw == null ? '' : raw.toFixed(0)}
        </text>
      )}
    </Root>
  )
}

export const rainStateWidget: HifiWidgetModule = {
  id: 'rainState',
  title: 'Rain State',
  description: 'Rain-cloud tell-tale that glows cyan when iRacing reports active rain.',
  category: 'weather',
  tags: ['rain', 'weather', 'condition', 'telltale', 'clean'],
  requires: ['isRaining'],
  defaultSize: { w: W, h: H },
  render: (props) => <RainGlyph {...props} />
}

export const wetDeclaredWidget: HifiWidgetModule = {
  id: 'wetDeclared',
  title: 'Wet Declared',
  description: 'Steward wet-declared badge that lights amber when the session is declared wet.',
  category: 'weather',
  tags: ['wet', 'declared', 'steward', 'badge', 'condition', 'clean'],
  requires: ['weatherDeclaredWet'],
  defaultSize: { w: W, h: H },
  render: (props) => <WetDeclaredBadge {...props} />
}

export const trackSurfaceWidget: HifiWidgetModule = {
  id: 'trackSurface',
  title: 'Track Surface',
  description: 'Current iRacing track surface material label with a matching glyph.',
  category: 'weather',
  tags: ['surface', 'track', 'kerb', 'asphalt', 'condition', 'clean'],
  requires: ['trackSurfaceMaterial'],
  defaultSize: { w: W, h: H },
  render: (props) => <TrackSurface {...props} />
}
