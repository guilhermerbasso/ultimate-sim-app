import type { ReactElement, SVGProps } from 'react'

function Svg({ children, ...rest }: SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg
      viewBox="0 0 22 22"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={20}
      height={20}
      {...rest}
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

const iconMap: Record<string, () => ReactElement> = {
  // ── Sim Racing ───────────────────────────────────────────────
  telemetry: () => (
    <Svg>
      {/* speedometer arc + needle + pivot */}
      <path d="M4 17a8 8 0 1 1 14 0" />
      <path d="M11 17 9 12" />
      <circle cx="11" cy="17" r="1.5" fill="currentColor" stroke="none" />
    </Svg>
  ),
  dashboards: () => (
    <Svg>
      {/* monitor frame + stand + bar chart */}
      <rect x="2" y="3" width="18" height="13" rx="2" />
      <path d="M8 20h6M11 16v4" />
      <path d="M7 12V9M11 12V7M15 12V10" />
    </Svg>
  ),
  streaming: () => (
    <Svg>
      <rect x="3" y="5" width="12" height="10" rx="2" />
      <path d="M7 18h4M9 15v3" />
      <path d="M17 8a4 4 0 0 1 0 4M19 6a7 7 0 0 1 0 8" />
    </Svg>
  ),
  'touch-controls': () => (
    <Svg>
      {/* button-box grid of keys + a finger tap */}
      <rect x="3" y="3" width="7" height="7" rx="1.6" />
      <rect x="12" y="3" width="7" height="7" rx="1.6" />
      <rect x="3" y="12" width="7" height="7" rx="1.6" />
      <path d="M13 13l4 1.5-1.7.8 1.4 2.4-1.4.8-1.4-2.4-1.2 1.4z" fill="currentColor" stroke="none" />
    </Svg>
  ),
  'oled-dash': () => (
    <Svg>
      {/* wide OLED panel with data lines + vertical readout */}
      <rect x="2" y="5" width="18" height="12" rx="3" />
      <path d="M6 10h4M6 13h8" />
      <path d="M14 9v5" />
    </Svg>
  ),
  overlays: () => (
    <Svg>
      {/* two offset transparent panes */}
      <rect x="6" y="7" width="13" height="11" rx="2" />
      <rect x="3" y="4" width="13" height="11" rx="2" />
    </Svg>
  ),
  fuel: () => (
    <Svg>
      {/* fuel droplet */}
      <path d="M11 3L6 10a5 5 0 1 0 10 0L11 3z" />
      <path d="M8.5 13a2.5 2.5 0 0 0 2.5 2.5" strokeWidth={1.2} />
    </Svg>
  ),
  coach: () => (
    <Svg>
      {/* line chart with axes + data points (lap analysis / coaching) */}
      <path d="M3 18h16M3 18V4" />
      <path d="M6 14l4-5 3 3 5-7" />
      <circle cx="6" cy="14" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="10" cy="9" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="13" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="18" cy="5" r="1.2" fill="currentColor" stroke="none" />
    </Svg>
  ),
  engineer: () => (
    <Svg>
      {/* radio headset (race engineer) */}
      <path d="M4 12v-1a7 7 0 0 1 14 0v1" />
      <rect x="3" y="12" width="3" height="5" rx="1" />
      <rect x="16" y="12" width="3" height="5" rx="1" />
      <path d="M17 17a4 3 0 0 1-4 3h-2" />
    </Svg>
  ),
  alerts: () => (
    <Svg>
      {/* bell body + clapper dome */}
      <path d="M4 17v-7a7 7 0 0 1 14 0v7H4z" />
      <path d="M9 17v1a2 2 0 0 0 4 0v-1" />
    </Svg>
  ),
  expr: () => (
    <Svg>
      {/* curly braces { } */}
      <path d="M8 3Q5 3 5 6v3Q5 11 3 11Q5 11 5 14v3Q5 19 8 19" />
      <path d="M14 3Q17 3 17 6v3Q17 11 19 11Q17 11 17 14v3Q17 19 14 19" />
    </Svg>
  ),
  'race-profiles': () => (
    <Svg>
      {/* map pin (car/track profile) */}
      <path d="M11 2a5 5 0 0 0-5 5c0 4.5 5 10 5 10s5-5.5 5-10a5 5 0 0 0-5-5z" />
      <circle cx="11" cy="7" r="2" />
    </Svg>
  ),
  search: () => (
    <Svg>
      {/* magnifier (semantic search) */}
      <circle cx="9" cy="9" r="6" />
      <path d="M13.5 13.5L19 19" />
    </Svg>
  ),
  voice: () => (
    <Svg>
      {/* microphone (TTS / voice) */}
      <rect x="8" y="2" width="6" height="11" rx="3" />
      <path d="M5 10a6 6 0 0 0 12 0" />
      <path d="M11 16v4M8 20h6" />
    </Svg>
  ),
  strategy: () => (
    <Svg>
      {/* checkered flag (strategy) */}
      <path d="M5 3v17" />
      <path d="M5 4h12l-2.5 3.5L17 11H5" />
    </Svg>
  ),
  'dashboard-builder': () => (
    <Svg>
      {/* monitor + AI sparkle */}
      <rect x="2" y="3" width="18" height="13" rx="2" />
      <path d="M8 20h6M11 16v4" />
      <path d="M11 6.5l.8 1.7 1.7.8-1.7.8-.8 1.7-.8-1.7-1.7-.8 1.7-.8z" />
    </Svg>
  ),
  biometrics: () => (
    <Svg>
      {/* heart + pulse line */}
      <path d="M11 18C6 14.5 3 11.5 3 8.5A3.5 3.5 0 0 1 10 7a3.5 3.5 0 0 1 7 1.5c0 1.3-.6 2.6-1.6 3.9" />
      <path d="M12 12.5h2l1-2 1.5 3 1-1.5" />
    </Svg>
  ),
  community: () => (
    <Svg>
      {/* two people (community) */}
      <circle cx="8" cy="8" r="3" />
      <path d="M3 18a5 5 0 0 1 10 0" />
      <circle cx="16" cy="9" r="2.2" />
      <path d="M14.5 18a4.5 4.5 0 0 1 5.5-4.4" />
    </Svg>
  ),
  haptics: () => (
    <Svg>
      {/* shaker body + vibration waves */}
      <rect x="8" y="5" width="6" height="12" rx="2" />
      <path d="M4 8v6M18 8v6" />
    </Svg>
  ),
  'haptics-zonal': () => (
    <Svg>
      {/* four zones, one active */}
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="12" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="12" width="7" height="7" rx="1" />
      <rect x="12" y="12" width="7" height="7" rx="1" fill="currentColor" stroke="none" />
    </Svg>
  ),
  'spotter-3d': () => (
    <Svg>
      {/* radar sweep (spatial spotter) */}
      <circle cx="11" cy="11" r="8" />
      <circle cx="11" cy="11" r="3.5" />
      <path d="M11 11l5.5-4" />
    </Svg>
  ),
  career: () => (
    <Svg>
      {/* trophy (career / ratings) */}
      <path d="M7 4h8v3a4 4 0 0 1-8 0V4z" />
      <path d="M7 5H4v1a3 3 0 0 0 3 3M15 5h3v1a3 3 0 0 1-3 3" />
      <path d="M11 11v4M8 19h6M9 19l.5-4M13 19l-.5-4" />
    </Svg>
  ),
  about: () => (
    <Svg>
      {/* info circle */}
      <circle cx="11" cy="11" r="8" />
      <path d="M11 10v5" />
      <circle cx="11" cy="7" r="0.9" fill="currentColor" stroke="none" />
    </Svg>
  ),

  // ── ButtonBox ────────────────────────────────────────────────
  devices: () => (
    <Svg>
      {/* USB plug: two prongs, connector body, cable, socket */}
      <path d="M8 3v4M14 3v4" />
      <rect x="4" y="7" width="14" height="5" rx="2" />
      <path d="M11 12v4" />
      <circle cx="11" cy="17" r="2" />
    </Svg>
  ),
  arduinos: () => (
    <Svg>
      {/* IC chip with 8 pins */}
      <rect x="6" y="6" width="10" height="10" rx="2" />
      <rect x="9" y="9" width="4" height="4" rx="1" />
      <path d="M6 9H3M6 13H3M16 9h3M16 13h3M9 6V3M13 6V3M9 16v3M13 16v3" />
    </Svg>
  ),
  revlights: () => (
    <Svg>
      {/* 5 LED segments */}
      <rect x="1" y="9" width="3" height="4" rx="1" />
      <rect x="5" y="9" width="3" height="4" rx="1" />
      <rect x="9" y="9" width="3" height="4" rx="1" />
      <rect x="13" y="9" width="3" height="4" rx="1" />
      <rect x="17" y="9" width="3" height="4" rx="1" />
    </Svg>
  ),
  inputs: () => (
    <Svg>
      {/* controller: rounded body, D-pad cross, two face buttons */}
      <rect x="3" y="7" width="16" height="10" rx="5" />
      <path d="M9 12v-2M8 11h2" />
      <circle cx="14" cy="10" r="1.2" />
      <circle cx="14" cy="13" r="1.2" />
    </Svg>
  ),
  profiles: () => (
    <Svg>
      {/* stack of 3 preset cards */}
      <rect x="4" y="9" width="14" height="9" rx="2" />
      <path d="M7 6h12a1 1 0 0 1 1 1v9" />
      <path d="M9 3h10a1 1 0 0 1 1 1v9" />
    </Svg>
  ),

  sounds: () => (
    <Svg>
      {/* speaker + upshift arrow */}
      <path d="M3 9v4h3l4 3V6L6 9H3z" />
      <path d="M14 13l2-2 2 2M16 11v5" />
    </Svg>
  ),
  setups: () => (
    <Svg>
      {/* tuning sliders */}
      <path d="M5 4v5M5 13v5M11 4v3M11 11v7M17 4v7M17 15v3" />
      <circle cx="5" cy="11" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="11" cy="9" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="17" cy="13" r="1.6" fill="currentColor" stroke="none" />
    </Svg>
  ),
  tire: () => (
    <Svg>
      {/* tyre: outer + inner ring + tread ticks */}
      <circle cx="11" cy="11" r="8" />
      <circle cx="11" cy="11" r="3.4" />
      <path d="M11 3v2.4M11 16.6V19M3 11h2.4M16.6 11H19M5.3 5.3l1.7 1.7M15 15l1.7 1.7M16.7 5.3L15 7M7 15l-1.7 1.7" strokeWidth={1.2} />
    </Svg>
  ),
  controls: () => (
    <Svg>
      {/* keyboard with keys */}
      <rect x="2" y="6" width="18" height="11" rx="2" />
      <path d="M5 9h.01M8 9h.01M11 9h.01M14 9h.01M17 9h.01M5 12h.01M8 12h.01M14 12h.01M17 12h.01M8 15h6" />
    </Svg>
  ),
  pinout: () => (
    <Svg>
      {/* MCU chip with pins */}
      <rect x="6" y="6" width="10" height="10" rx="1.5" />
      <path d="M9 6V3M13 6V3M9 19v-3M13 19v-3M6 9H3M6 13H3M19 9h-3M19 13h-3" strokeWidth={1.3} />
    </Svg>
  ),
  esp32: () => (
    <Svg>
      {/* wifi waves + node */}
      <path d="M3 8a13 13 0 0 1 16 0M6 11.5a8 8 0 0 1 10 0M9 15a3.5 3.5 0 0 1 4 0" />
      <circle cx="11" cy="18" r="1.3" fill="currentColor" stroke="none" />
    </Svg>
  ),

  // ── App ──────────────────────────────────────────────────────
  'accessibility-cues': () => (
    <Svg>
      <path d="M3 11s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5Z" />
      <circle cx="11" cy="11" r="2.2" />
      <path d="M17.5 4.5v3M19 6h-3M4.5 17.5v-3M3 16h3" />
    </Svg>
  ),
  settings: () => (
    <Svg>
      {/* gear: hub circle + 8 teeth (4 cardinal + 4 diagonal) */}
      <circle cx="11" cy="11" r="3" />
      <path d="M11 2v3M11 17v3M2 11h3M17 11h3" />
      <path d="M4.8 4.8l2.1 2.1M15.1 15.1l2.1 2.1M4.8 17.2l2.1-2.1M15.1 6.9l2.1-2.1" />
    </Svg>
  ),
}

function FallbackIcon(): ReactElement {
  return (
    <Svg>
      <circle cx="11" cy="11" r="5" />
      <circle cx="11" cy="11" r="1.5" fill="currentColor" stroke="none" />
    </Svg>
  )
}

export function ViewIcon({ id }: { id: string }): ReactElement {
  const Icon = iconMap[id] ?? FallbackIcon
  return <Icon />
}
