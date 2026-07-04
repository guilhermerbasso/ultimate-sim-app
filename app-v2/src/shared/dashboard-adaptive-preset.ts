// Ready-to-use ADAPTIVE dashboard preset (PURE, dependency-free).
//
// This is the single, discoverable "Dashboard Adaptativo" built-in. It is a
// normal, fully-valid `Dashboard` (so it renders with the existing widgets and
// import/export contracts) that the runtime ALSO drives live: while you are
// driving, DashboardRoot feeds the live telemetry snapshot through
// `race-moment.ts` + `dashboard-adaptive.ts` to re-rank / emphasize / hide the
// most relevant widgets for the current race moment (fuel + delta on out-laps,
// gaps + position in traffic, tyres/temps on long runs, pit window near stops…).
//
// CROSS-AGENT CONTRACT: the owner of `src/shared/dashboards.ts` imports
// `ADAPTIVE_DASHBOARD_PRESET` from here and registers it into `BUILTIN_PRESETS`.
// Nothing in `dashboards.ts` needs to change beyond that one import + one entry.
//
// Adaptiveness is NOT a new field on `Dashboard` (that type is owned elsewhere).
// Instead it is encoded durably so it survives "duplicate & edit":
//   • a stable preset id (`ADAPTIVE_DASHBOARD_ID`), AND
//   • a marker token embedded in `description` (`ADAPTIVE_MARKER`).
// `isAdaptiveDashboard()` recognises either, so the runtime gate works for the
// shipped preset, a materialised copy, or a user-duplicated variant.
//
// React/Electron/node-free: importable by main, renderer and unit tests.

import type { Dashboard, DashboardElement, DashboardElementStyle, DashboardElementType } from './dashboards'

// ─── Adaptive markers (the durable "this is the adaptive board" signal) ──────

/** Stable id of the shipped adaptive preset. */
export const ADAPTIVE_DASHBOARD_ID = 'adaptive_dashboard'

/**
 * Token embedded in the dashboard `description`. It survives clone/duplicate
 * (description is copied verbatim) so a user-edited copy still adapts live.
 */
export const ADAPTIVE_MARKER = '[adaptive:v1]'

/** Every id that should be treated as the adaptive board (extensible). */
export const ADAPTIVE_DASHBOARD_IDS: ReadonlySet<string> = new Set<string>([ADAPTIVE_DASHBOARD_ID])

/** Tags the dashboards.ts owner should register the preset with. */
export const ADAPTIVE_DASHBOARD_TAGS: readonly string[] = [
  'adaptive',
  'Adaptativo',
  'IA',
  'race',
  'fuel',
  'tyres',
  'traffic',
  'motorsport'
]

/**
 * True when `dash` is the live-adaptive board. Robust to duplication: matches a
 * known id OR the embedded description marker. The runtime uses this to gate the
 * adaptive engine so NORMAL dashboards are completely unaffected.
 */
export function isAdaptiveDashboard(dash: Pick<Dashboard, 'id' | 'description'> | null | undefined): boolean {
  if (!dash) return false
  if (ADAPTIVE_DASHBOARD_IDS.has(dash.id)) return true
  return typeof dash.description === 'string' && dash.description.includes(ADAPTIVE_MARKER)
}

// ─── Warm palette (cool/green reserved for positive states only) ─────────────

const BG = '#000000'
const PANEL = '#000000'
const STROKE = '#1F1F1F'
const WARM_WHITE = '#F4F4F4'
const ORANGE = '#FF7A00'
const AMBER = '#FFB800'
const RED = '#FF2200'
const FONT = '"Avenir Next", "Bahnschrift", "Segoe UI", system-ui, sans-serif'

function st(label: string, accent: string, extra: Partial<DashboardElementStyle> = {}): DashboardElementStyle {
  return {
    background: PANEL,
    border: STROKE,
    borderWidth: 1,
    radius: 12,
    color: WARM_WHITE,
    fontFamily: FONT,
    label,
    title: label,
    accentColor: accent,
    warnColor: AMBER,
    dangerColor: RED,
    minFontSize: 14,
    maxFontSize: 92,
    ...extra
  }
}

interface Spec {
  id: string
  type: DashboardElementType
  x: number
  y: number
  w: number
  h: number
  label: string
  accent: string
  name: string
  binding?: string
  extra?: Partial<DashboardElementStyle>
}

// Layout authored natively at 1024×600 (the built-in canvas size). Widget
// `type`s are chosen so the adaptive engine's `conceptForElement()` maps each one
// to a distinct concept, giving the live re-ranking real targets to promote /
// demote / hide across every race phase and micro moment.
const SPECS: Spec[] = [
  // Top rail — shift lights (always visible chrome).
  { id: 'adp-shift', type: 'shiftbar', x: 16, y: 10, w: 992, h: 40, label: 'SHIFT', accent: ORANGE, name: 'AdaptiveShift', binding: 'shiftPct', extra: { segments: 26, flashAt: 0.98, warnAt: 0.66, dangerAt: 0.86, glow: true, segmentShape: 'bar', fillColor: ORANGE, warnColor: AMBER, dangerColor: RED, radius: 999, maxFontSize: 26 } },

  // Row A — timing band: delta · lap timing · position+gaps.
  { id: 'adp-delta', type: 'delta-clean', x: 16, y: 60, w: 320, h: 120, label: 'DELTA', accent: RED, name: 'Delta', binding: 'deltaSec', extra: { deltaRangeSec: 1, maxFontSize: 64 } },
  { id: 'adp-laptiming', type: 'laptiming', x: 348, y: 60, w: 360, h: 120, label: 'LAPS', accent: AMBER, name: 'LapTiming', extra: { showCurrent: true, showLast: true, showBest: true, showEstimated: true, maxFontSize: 40 } },
  { id: 'adp-position', type: 'positiongaps', x: 720, y: 60, w: 288, h: 120, label: 'POSITION', accent: AMBER, name: 'PositionGaps', extra: { maxFontSize: 56 } },

  // Row B — core driving: speed · gear (hero) · rpm · fuel · pit.
  { id: 'adp-speed', type: 'speed-clean', x: 16, y: 190, w: 180, h: 180, label: 'SPEED', accent: WARM_WHITE, name: 'Speed', extra: { maxFontSize: 72 } },
  { id: 'adp-gear', type: 'gear-clean', x: 208, y: 190, w: 300, h: 180, label: 'GEAR', accent: AMBER, name: 'Gear', extra: { maxFontSize: 132 } },
  { id: 'adp-rpm', type: 'rpm-clean', x: 520, y: 190, w: 150, h: 180, label: 'RPM', accent: ORANGE, name: 'Rpm', extra: { maxFontSize: 58 } },
  { id: 'adp-fuel', type: 'fuel-clean', x: 682, y: 190, w: 160, h: 180, label: 'FUEL', accent: AMBER, name: 'Fuel', extra: { maxFontSize: 64 } },
  { id: 'adp-pit', type: 'pitlimiter-clean', x: 854, y: 190, w: 154, h: 180, label: 'PIT', accent: ORANGE, name: 'PitLimiter', extra: { maxFontSize: 56 } },

  // Row C — traffic + condition: relatives · radar · track map · tyres.
  { id: 'adp-relatives', type: 'relatives-clean', x: 16, y: 380, w: 320, h: 150, label: 'TRAFFIC', accent: AMBER, name: 'Relatives', extra: { maxFontSize: 30 } },
  { id: 'adp-radar', type: 'radar-clean', x: 348, y: 380, w: 180, h: 150, label: 'RADAR', accent: RED, name: 'Radar', extra: { maxFontSize: 34 } },
  { id: 'adp-trackmap', type: 'trackmap-clean', x: 540, y: 380, w: 180, h: 150, label: 'TRACK', accent: AMBER, name: 'TrackMap', binding: 'lapDistPct', extra: { maxFontSize: 34 } },
  { id: 'adp-tyres', type: 'tyres-clean', x: 732, y: 380, w: 276, h: 150, label: 'TYRES', accent: ORANGE, name: 'Tyres', extra: { coldAt: 72, optimalAt: 88, hotAt: 104, criticalAt: 118, maxFontSize: 34 } },

  // Row D — status strip: flags · incidents · engine temps · weather · brakes · inputs.
  { id: 'adp-flags', type: 'flags-clean', x: 16, y: 540, w: 155, h: 52, label: 'FLAGS', accent: AMBER, name: 'Flags', extra: { maxFontSize: 28 } },
  { id: 'adp-incidents', type: 'incidents-clean', x: 183, y: 540, w: 155, h: 52, label: 'INC', accent: RED, name: 'Incidents', extra: { maxFontSize: 28 } },
  { id: 'adp-temps', type: 'temps-clean', x: 350, y: 540, w: 155, h: 52, label: 'ENGINE', accent: ORANGE, name: 'EngineTemps', extra: { maxFontSize: 24 } },
  { id: 'adp-weather', type: 'weather', x: 517, y: 540, w: 155, h: 52, label: 'TRACK', accent: AMBER, name: 'Weather', extra: { maxFontSize: 24 } },
  { id: 'adp-brakes', type: 'brakegrid', x: 684, y: 540, w: 155, h: 52, label: 'BRAKES', accent: ORANGE, name: 'Brakes', extra: { showAverage: true, maxFontSize: 24 } },
  { id: 'adp-inputs', type: 'inputs-clean', x: 851, y: 540, w: 157, h: 52, label: 'INPUTS', accent: ORANGE, name: 'Inputs', extra: { channels: ['throttle', 'brake'], maxFontSize: 22 } }
]

const DESCRIPTION = [
  'Dashboard adaptativo: re-ordena e destaca os widgets mais relevantes ao vivo,',
  'conforme a fase da sessão (treino, quali, corrida, pit) e o "momento" da volta',
  '(out-lap, sob pressão, atacando, combustível crítico, última volta).',
  ADAPTIVE_MARKER
].join(' ')

function specToElement(s: Spec): DashboardElement {
  return {
    id: s.id,
    type: s.type,
    x: s.x,
    y: s.y,
    w: s.w,
    h: s.h,
    binding: s.binding,
    name: s.name,
    style: st(s.label, s.accent, s.extra)
  }
}

/**
 * Build a FRESH adaptive dashboard object. Prefer this in `BUILTIN_PRESETS`'
 * `build()` so each materialisation is an independent object (no shared mutable
 * state across renders / saves).
 */
export function createAdaptiveDashboardPreset(): Dashboard {
  return {
    id: ADAPTIVE_DASHBOARD_ID,
    name: 'Dashboard Adaptativo · 1024×600',
    width: 1024,
    height: 600,
    bg: BG,
    scaleMode: 'fit',
    description: DESCRIPTION,
    elements: SPECS.map(specToElement)
  }
}

/**
 * The ready-to-register adaptive preset. The `dashboards.ts` owner imports THIS
 * and adds one `BUILTIN_PRESETS` entry (see the integration contract).
 */
export const ADAPTIVE_DASHBOARD_PRESET: Dashboard = createAdaptiveDashboardPreset()
