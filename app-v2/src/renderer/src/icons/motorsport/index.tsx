// Central, reusable motorsport icon set — single source of truth for FIA flags
// and dashboard warning lights across overlays and dashboards.
//
// Conventions (match the existing inline icons in SymbolStatusWidget):
//   • 24×24 viewBox, monochrome via `currentColor` so the parent controls the hue.
//   • No copyrighted assets — every glyph is hand-drawn primitive geometry.
//   • Each icon spreads `props` so callers can pass className / style / width / aria.
//
// Usage:
//   import { MotorsportGlyph } from '../../icons/motorsport'
//   <MotorsportGlyph id="flag-yellow" style={{ color: '#ffb000', width: 28 }} />
// or pull a single component:
//   import { FlagYellow } from '../../icons/motorsport'

import type { FC, ReactElement, SVGProps } from 'react'

export type MotorsportIcon = FC<SVGProps<SVGSVGElement>>

const svg = (children: ReactElement, props?: SVGProps<SVGSVGElement>, filled = false): ReactElement => (
  <svg viewBox="0 0 24 24" fill={filled ? undefined : 'none'} aria-hidden="true" {...props}>
    {children}
  </svg>
)

// ─── Driver aids / electronics ────────────────────────────────────────────────
export const Tc: MotorsportIcon = (p) =>
  svg(
    <>
      <circle cx="12" cy="8" r="4.5" stroke="currentColor" strokeWidth="2" />
      <path d="M4 16q4-2.5 8 0t8 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M2 20q5-3 10 0t10 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </>,
    p
  )

export const TcOff: MotorsportIcon = (p) =>
  svg(
    <>
      <circle cx="12" cy="8" r="4.5" stroke="currentColor" strokeWidth="2" />
      <path d="M4 16q4-2.5 8 0t8 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M3 3l18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </>,
    p
  )

export const Abs: MotorsportIcon = (p) =>
  svg(
    <>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
      <text x="12" y="16" textAnchor="middle" fontSize="8" fontWeight="900" fill="currentColor" fontFamily="'Chakra Petch', 'Michroma', sans-serif">ABS</text>
    </>,
    p
  )

export const AbsOff: MotorsportIcon = (p) =>
  svg(
    <>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
      <text x="12" y="16" textAnchor="middle" fontSize="8" fontWeight="900" fill="currentColor" fontFamily="'Chakra Petch', 'Michroma', sans-serif">ABS</text>
      <path d="M3 3l18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </>,
    p
  )

export const Drs: MotorsportIcon = (p) =>
  svg(
    <>
      <path d="M4 16l2-5h12l2 5H4z" fill="currentColor" fillOpacity="0.85" />
      <path d="M7 16v2M17 16v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M5 10h14" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <circle cx="12" cy="7.5" r="1.5" fill="currentColor" opacity="0.6" />
    </>,
    p
  )

export const Ers: MotorsportIcon = (p) =>
  svg(
    <path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" fill="currentColor" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />,
    p
  )

export const PushToPass: MotorsportIcon = (p) =>
  svg(
    <>
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 8l6 4-6 4V8z" fill="currentColor" />
      <path d="M16 8v8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </>,
    p
  )

// ─── Engine / fluids ──────────────────────────────────────────────────────────
export const Engine: MotorsportIcon = (p) =>
  svg(
    <>
      <rect x="5" y="8" width="11" height="8" rx="1.5" stroke="currentColor" strokeWidth="2" />
      <path d="M8 8V5M12 8V5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M16 12h3M5 12H2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M19 10v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </>,
    p
  )

export const OilPressure: MotorsportIcon = (p) =>
  svg(
    <>
      <path d="M3 16h4l2-3h8a3 3 0 013 3v2H3v-2z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M9 13l-1-3M12 13l0-3M15 13l1-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="5" cy="20" r="1.4" fill="currentColor" />
    </>,
    p
  )

export const OilTemp: MotorsportIcon = (p) =>
  svg(
    <>
      <path d="M12 3c0 5-6 7.5-6 12a6 6 0 0012 0c0-4.5-6-7-6-12z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M9 16h6M10 19h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </>,
    p
  )

export const WaterTemp: MotorsportIcon = (p) =>
  svg(
    <>
      <path d="M12 3c0 5-6 7.5-6 12a6 6 0 0012 0c0-4.5-6-7-6-12z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M6.5 17q2-1.6 4 0t4 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </>,
    p
  )

export const Temp: MotorsportIcon = (p) =>
  svg(
    <>
      <path d="M12 3a2 2 0 00-2 2v8.5A4.5 4.5 0 1014 13.5V5a2 2 0 00-2-2z" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="17" r="2.5" fill="currentColor" />
      <path d="M12 12V7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </>,
    p
  )

export const Battery: MotorsportIcon = (p) =>
  svg(
    <>
      <rect x="3" y="8" width="18" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M7 8V6h3v2M14 8V6h3v2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M7.5 12.5h3M9 11v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M13.5 12.5h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </>,
    p
  )

export const Fuel: MotorsportIcon = (p) =>
  svg(
    <>
      <path d="M3 21V6a1 1 0 011-1h8a1 1 0 011 1v15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M5 11h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M13 8l3-3 2 2v10a1 1 0 01-2 0v-4h-1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </>,
    p
  )

// ─── Brakes / chassis ─────────────────────────────────────────────────────────
export const Brake: MotorsportIcon = (p) =>
  svg(
    <>
      <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.7" />
    </>,
    p
  )

export const BrakeBias: MotorsportIcon = (p) =>
  svg(
    <>
      <rect x="3" y="9" width="18" height="6" rx="3" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="9" cy="12" r="2.4" fill="currentColor" />
      <path d="M16 7v10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.7" />
    </>,
    p
  )

export const Handbrake: MotorsportIcon = (p) =>
  svg(
    <>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 7v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <text x="12" y="18.5" textAnchor="middle" fontSize="6.5" fontWeight="900" fill="currentColor" fontFamily="'Chakra Petch', 'Michroma', sans-serif">P</text>
    </>,
    p
  )

export const Tyre: MotorsportIcon = (p) =>
  svg(
    <>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="3.4" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 3v3.6M12 17.4V21M3 12h3.6M17.4 12H21M5.6 5.6l2.5 2.5M15.9 15.9l2.5 2.5M18.4 5.6l-2.5 2.5M8.1 15.9l-2.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity="0.65" />
    </>,
    p
  )

// ─── Lights / weather ─────────────────────────────────────────────────────────
export const Headlight: MotorsportIcon = (p) =>
  svg(
    <>
      <path d="M4 6h7a6 6 0 010 12H4a14 14 0 000-12z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M16 8h3M16 12h4M16 16h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </>,
    p
  )

export const Rain: MotorsportIcon = (p) =>
  svg(
    <>
      <path d="M6 12a4 4 0 01.5-7.9A5 5 0 0116 6a3.5 3.5 0 01.5 7" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M8 16l-1 3M12 16l-1 3M16 16l-1 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </>,
    p
  )

export const PitLimiter: MotorsportIcon = (p) =>
  svg(
    <>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
      <text x="12" y="15.5" textAnchor="middle" fontSize="7" fontWeight="900" fill="currentColor" fontFamily="'Chakra Petch', 'Michroma', sans-serif">PIT</text>
    </>,
    p
  )

export const Ignition: MotorsportIcon = (p) =>
  svg(
    <>
      <path d="M12 3v8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M7 7a7 7 0 109.9 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </>,
    p
  )

export const Damage: MotorsportIcon = (p) =>
  svg(
    <path d="M14.7 6.3a3.5 3.5 0 00-4.6 4.6L3 18l3 3 7.1-7.1a3.5 3.5 0 004.6-4.6l-2.3 2.3-2-2 2.3-2.3z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />,
    p
  )

// ─── FIA flags ────────────────────────────────────────────────────────────────
// Flags are monochrome silhouettes (pole + cloth); the parent applies the flag's
// colour via `currentColor`. Pattern flags (checkered / meatball / double-yellow)
// encode their pattern with opacity so they read at small sizes.
const pole = <path d="M4 22V3" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
const cloth = 'M4 3c2 3 6 3 8 0s6-3 8 0v10c-2 3-6 3-8 0s-6-3-8 0'

export const FlagGreen: MotorsportIcon = (p) =>
  svg(<>{pole}<path d={cloth} fill="currentColor" fillOpacity="0.85" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></>, p)

export const FlagRed: MotorsportIcon = (p) =>
  svg(
    <>
      {pole}
      <path d={cloth} fill="currentColor" fillOpacity="0.85" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M10 7l4 4M14 7l-4 4" stroke="rgba(255,255,255,0.85)" strokeWidth="2" strokeLinecap="round" />
    </>,
    p
  )

export const FlagWhite: MotorsportIcon = (p) =>
  svg(<>{pole}<path d={cloth} fill="currentColor" fillOpacity="0.8" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></>, p)

export const FlagYellow: MotorsportIcon = (p) =>
  svg(
    <>
      <path d="M12 3L2 21h20L12 3z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M12 10v4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="12" cy="17" r="1" fill="currentColor" />
    </>,
    p
  )

export const FlagDoubleYellow: MotorsportIcon = (p) =>
  svg(
    <>
      <path d="M8 4L2 20h12L8 4z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M16 4l-6 16h12L16 4z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" opacity="0.85" />
    </>,
    p
  )

export const FlagBlue: MotorsportIcon = (p) =>
  svg(
    <>
      <rect x="3" y="4" width="18" height="14" rx="2.5" stroke="currentColor" strokeWidth="2" fill="currentColor" fillOpacity="0.18" />
      <path d="M12 15V9M9 12l3-3 3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </>,
    p
  )

export const FlagBlack: MotorsportIcon = (p) =>
  svg(
    <>
      {pole}
      <path d={cloth} fill="currentColor" fillOpacity="0.95" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </>,
    p
  )

export const FlagMeatball: MotorsportIcon = (p) =>
  svg(
    <>
      {pole}
      <path d={cloth} fill="currentColor" fillOpacity="0.95" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="12" cy="8.5" r="3.1" fill="rgba(255,255,255,0.9)" />
    </>,
    p
  )

export const FlagCheckered: MotorsportIcon = (p) =>
  svg(
    <>
      {pole}
      <g fill="currentColor" opacity="0.9">
        <rect x="6" y="3" width="3.5" height="4.5" />
        <rect x="13" y="3" width="3.5" height="4.5" />
        <rect x="9.5" y="7.5" width="3.5" height="4.5" />
        <rect x="16.5" y="7.5" width="3.5" height="4.5" />
      </g>
      <g fill="currentColor" opacity="0.32">
        <rect x="9.5" y="3" width="3.5" height="4.5" />
        <rect x="16.5" y="3" width="3.5" height="4.5" />
        <rect x="6" y="7.5" width="3.5" height="4.5" />
        <rect x="13" y="7.5" width="3.5" height="4.5" />
      </g>
    </>,
    p
  )

export const FlagGreenWhiteCheckered: MotorsportIcon = (p) =>
  svg(
    <>
      {pole}
      <g fill="currentColor">
        <rect x="6" y="3" width="14" height="3" opacity="0.85" />
        <rect x="6" y="6" width="14" height="2.4" opacity="0.25" />
        <rect x="6" y="8.4" width="3.5" height="3" opacity="0.9" />
        <rect x="13" y="8.4" width="3.5" height="3" opacity="0.9" />
        <rect x="9.5" y="11.4" width="3.5" height="3" opacity="0.9" />
        <rect x="16.5" y="11.4" width="3.5" height="3" opacity="0.9" />
      </g>
    </>,
    p
  )

export type MotorsportIconId =
  | 'tc'
  | 'tc-off'
  | 'abs'
  | 'abs-off'
  | 'drs'
  | 'ers'
  | 'push-to-pass'
  | 'engine'
  | 'oil-pressure'
  | 'oil-temp'
  | 'water-temp'
  | 'temp'
  | 'battery'
  | 'fuel'
  | 'brake'
  | 'brake-bias'
  | 'handbrake'
  | 'tyre'
  | 'headlight'
  | 'rain'
  | 'pit-limiter'
  | 'ignition'
  | 'damage'
  | 'flag-green'
  | 'flag-yellow'
  | 'flag-double-yellow'
  | 'flag-blue'
  | 'flag-white'
  | 'flag-checkered'
  | 'flag-red'
  | 'flag-black'
  | 'flag-meatball'
  | 'flag-gws'

export const MOTORSPORT_ICONS: Record<MotorsportIconId, MotorsportIcon> = {
  tc: Tc,
  'tc-off': TcOff,
  abs: Abs,
  'abs-off': AbsOff,
  drs: Drs,
  ers: Ers,
  'push-to-pass': PushToPass,
  engine: Engine,
  'oil-pressure': OilPressure,
  'oil-temp': OilTemp,
  'water-temp': WaterTemp,
  temp: Temp,
  battery: Battery,
  fuel: Fuel,
  brake: Brake,
  'brake-bias': BrakeBias,
  handbrake: Handbrake,
  tyre: Tyre,
  headlight: Headlight,
  rain: Rain,
  'pit-limiter': PitLimiter,
  ignition: Ignition,
  damage: Damage,
  'flag-green': FlagGreen,
  'flag-yellow': FlagYellow,
  'flag-double-yellow': FlagDoubleYellow,
  'flag-blue': FlagBlue,
  'flag-white': FlagWhite,
  'flag-checkered': FlagCheckered,
  'flag-red': FlagRed,
  'flag-black': FlagBlack,
  'flag-meatball': FlagMeatball,
  'flag-gws': FlagGreenWhiteCheckered
}

export const MOTORSPORT_ICON_IDS = Object.keys(MOTORSPORT_ICONS) as MotorsportIconId[]

export function MotorsportGlyph({ id, ...props }: { id: MotorsportIconId } & SVGProps<SVGSVGElement>): ReactElement | null {
  const Icon = MOTORSPORT_ICONS[id]
  return Icon ? <Icon {...props} /> : null
}
