import type { ReactElement } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bell,
  Bookmark,
  Camera,
  ChevronLeft,
  ChevronRight,
  CloudRain,
  Droplet,
  Flag,
  Fuel,
  Gauge,
  LayoutDashboard,
  Lightbulb,
  Map as MapIcon,
  Mic,
  MicOff,
  Monitor,
  Power,
  Radio,
  Rewind,
  RotateCcw,
  Settings,
  SkipBack,
  SkipForward,
  Snowflake,
  SquareStack,
  ThumbsUp,
  Timer,
  Volume1,
  Volume2,
  VolumeX,
  Wind,
  Wrench,
  X,
  Zap,
  type LucideIcon
} from 'lucide-react'

// ─────────────────────────────────────────────────────────────────────────────
// Key icon registry — Lucide (MIT) + custom race SVGs. Every icon renders as a
// NESTED <svg x y width height viewBox="0 0 24 24"> so it can be positioned inside
// the KeyFace parent <svg>. Opensource only; no external network fetch.
// ─────────────────────────────────────────────────────────────────────────────

export interface KeyIconProps {
  id: string
  x: number
  y: number
  size: number
  color: string
  strokeWidth?: number
}

// Custom race pictograms drawn in a 0..24 box, honouring stroke `color`.
type CustomRender = (p: { color: string; strokeWidth: number }) => ReactElement

const CUSTOM_ICONS: Record<string, CustomRender> = {
  // Racing slick tyre: outer wall + hub + tread hints.
  tyre: ({ color, strokeWidth }) => (
    <g fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3.4" />
      <path d="M12 3v3.2M12 17.8V21M3 12h3.2M17.8 12H21M5.6 5.6l2.3 2.3M16.1 16.1l2.3 2.3M18.4 5.6l-2.3 2.3M7.9 16.1l-2.3 2.3" />
    </g>
  ),
  // Tear-off strip peeling off a visor.
  'tear-off': ({ color, strokeWidth }) => (
    <g fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="5.5" width="17" height="10" rx="2" />
      <path d="M3.5 12h17" />
      <path d="M15 15.5l3.5 3.5 2-2-2.2-2.2" />
    </g>
  ),
  // Fuel pump with a warning slash (fuel alarm / low fuel).
  'fuel-alarm': ({ color, strokeWidth }) => (
    <g fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 20V6a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v14" />
      <path d="M4 20h11" />
      <path d="M7 9h4" />
      <path d="M14 8l3 3v6a2 2 0 0 0 2-2v-5l-3-3" />
      <path d="M4 4l16 16" stroke={color} />
    </g>
  ),
  // Brake bias: disc + directional adjust arrow.
  'brake-bias': ({ color, strokeWidth }) => (
    <g fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 4v3M12 17v3M4 12h3M17 12h3" />
    </g>
  ),
  // Pit sign: a "P" board on a post.
  'pit-sign': ({ color, strokeWidth }) => (
    <g fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="3.5" width="12" height="12" rx="2" />
      <path d="M8 6.5h3a2 2 0 0 1 0 4H8V13M8 6.5V13" />
      <path d="M6 15.5v5" />
    </g>
  ),
  // Downforce / wing adjust.
  wing: ({ color, strokeWidth }) => (
    <g fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8h18l-2 4H5z" />
      <path d="M6 12v4M18 12v4M12 12v4" />
    </g>
  )
}

// Semantic id → Lucide icon.
const LUCIDE_ICONS: Record<string, LucideIcon> = {
  power: Power,
  engine: Power,
  'engine-warn': AlertTriangle,
  warn: AlertTriangle,
  reset: RotateCcw,
  esc: X,
  mark: Bookmark,
  delta: Activity,
  fuel: Fuel,
  'fast-repair': Wrench,
  wrench: Wrench,
  limiter: Gauge,
  gauge: Gauge,
  radio: Radio,
  mic: Mic,
  'mic-mute': MicOff,
  'volume-up': Volume2,
  'volume-down': Volume1,
  mute: VolumeX,
  camera: Camera,
  'camera-next': SkipForward,
  'camera-prev': SkipBack,
  replay: Rewind,
  monitor: Monitor,
  flag: Flag,
  'yellow-flag': AlertTriangle,
  'pass-left': ChevronLeft,
  'pass-right': ChevronRight,
  'arrow-left': ArrowLeft,
  'arrow-right': ArrowRight,
  headlight: Lightbulb,
  highbeam: Zap,
  rain: CloudRain,
  wet: Droplet,
  cold: Snowflake,
  wiper: Wind,
  flash: Zap,
  map: MapIcon,
  dash: LayoutDashboard,
  'dash-next': ChevronRight,
  'dash-prev': ChevronLeft,
  overlay: SquareStack,
  'good-race': ThumbsUp,
  timer: Timer,
  horn: Bell,
  settings: Settings
}

export function hasIcon(id: string | undefined): boolean {
  return !!id && (id in LUCIDE_ICONS || id in CUSTOM_ICONS)
}

/** Render an icon nested inside the KeyFace <svg>. Returns null for unknown ids. */
export function KeyIcon({ id, x, y, size, color, strokeWidth = 2 }: KeyIconProps): ReactElement | null {
  const custom = CUSTOM_ICONS[id]
  if (custom) {
    return (
      <svg x={x} y={y} width={size} height={size} viewBox="0 0 24 24" overflow="visible">
        {custom({ color, strokeWidth })}
      </svg>
    )
  }
  const Lucide = LUCIDE_ICONS[id]
  if (Lucide) {
    return (
      <Lucide
        x={x}
        y={y}
        width={size}
        height={size}
        color={color}
        strokeWidth={strokeWidth}
        absoluteStrokeWidth
      />
    )
  }
  return null
}

// ── Editor picker options (grouped) ──────────────────────────────────────────
export interface IconOption {
  id: string
  label: string
  group: string
}

export const ICON_OPTIONS: ReadonlyArray<IconOption> = [
  { id: 'power', label: 'Engine / Power', group: 'System' },
  { id: 'engine-warn', label: 'Engine warning', group: 'System' },
  { id: 'reset', label: 'Reset', group: 'System' },
  { id: 'esc', label: 'ESC', group: 'System' },
  { id: 'mark', label: 'Mark lap', group: 'System' },
  { id: 'delta', label: 'Delta', group: 'System' },
  { id: 'settings', label: 'Settings', group: 'System' },
  { id: 'fuel', label: 'Fuel', group: 'Pit / Fuel' },
  { id: 'fuel-alarm', label: 'Fuel alarm', group: 'Pit / Fuel' },
  { id: 'fast-repair', label: 'Fast repair', group: 'Pit / Fuel' },
  { id: 'tear-off', label: 'Tear-off', group: 'Pit / Fuel' },
  { id: 'pit-sign', label: 'Pit request', group: 'Pit / Fuel' },
  { id: 'limiter', label: 'Pit limiter', group: 'Pit / Fuel' },
  { id: 'tyre', label: 'Tire', group: 'Tires / Setup' },
  { id: 'brake-bias', label: 'Brake bias', group: 'Tires / Setup' },
  { id: 'wing', label: 'Wing / Downforce', group: 'Tires / Setup' },
  { id: 'headlight', label: 'Headlight', group: 'Lights / Weather' },
  { id: 'highbeam', label: 'High beam', group: 'Lights / Weather' },
  { id: 'wiper', label: 'Wiper', group: 'Lights / Weather' },
  { id: 'rain', label: 'Rain', group: 'Lights / Weather' },
  { id: 'wet', label: 'Wet', group: 'Lights / Weather' },
  { id: 'cold', label: 'Cold', group: 'Lights / Weather' },
  { id: 'radio', label: 'Radio', group: 'Radio / Audio' },
  { id: 'mic', label: 'Microphone', group: 'Radio / Audio' },
  { id: 'mic-mute', label: 'Mic muted', group: 'Radio / Audio' },
  { id: 'volume-up', label: 'Volume +', group: 'Radio / Audio' },
  { id: 'volume-down', label: 'Volume −', group: 'Radio / Audio' },
  { id: 'mute', label: 'Mute', group: 'Radio / Audio' },
  { id: 'camera', label: 'Camera', group: 'Camera / Replay' },
  { id: 'camera-next', label: 'Camera +', group: 'Camera / Replay' },
  { id: 'camera-prev', label: 'Camera −', group: 'Camera / Replay' },
  { id: 'replay', label: 'Replay', group: 'Camera / Replay' },
  { id: 'monitor', label: 'Black box', group: 'Camera / Replay' },
  { id: 'flag', label: 'Flag', group: 'Flags / Marshal' },
  { id: 'yellow-flag', label: 'Yellow flag', group: 'Flags / Marshal' },
  { id: 'pass-left', label: 'Passar à esquerda', group: 'Flags / Marshal' },
  { id: 'pass-right', label: 'Passar à direita', group: 'Flags / Marshal' },
  { id: 'horn', label: 'Horn', group: 'Flags / Marshal' },
  { id: 'dash', label: 'Dashboard', group: 'Dash / Overlay' },
  { id: 'dash-next', label: 'Dash +', group: 'Dash / Overlay' },
  { id: 'dash-prev', label: 'Dash −', group: 'Dash / Overlay' },
  { id: 'overlay', label: 'Overlay', group: 'Dash / Overlay' },
  { id: 'map', label: 'Map', group: 'Dash / Overlay' },
  { id: 'good-race', label: 'Good race', group: 'Dash / Overlay' }
]
