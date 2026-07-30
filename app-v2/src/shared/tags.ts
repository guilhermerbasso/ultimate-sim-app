// ── Tag taxonomy + auto sim-tags ──────────────────────────────────────────────
// Central place for the widget/overlay/dashboard tag vocabulary and the helper that
// merges an item's manual tags with the SIM tags derived automatically from the
// telemetry fields it needs (`requires`) via the sim-coverage map. So an item that
// reads `tyres` is auto-tagged IR/ACC/LMU, one that reads `drivers` is auto-tagged
// IR, etc. — never hand-maintained.
import {
  simLabel,
  widgetSupportedSims,
  type TelemetryRequirement
} from './sim-coverage'

export type TelemetryField = TelemetryRequirement

/** Sim tags (e.g. ['IR','ACC','LMU']) that a widget supports, from its required fields. */
export function simTagsFor(
  requires: readonly TelemetryField[] | undefined,
  alternativeRequires: readonly (readonly TelemetryField[])[] = []
): string[] {
  return widgetSupportedSims(requires, alternativeRequires).map((s) => simLabel(s))
}

/**
 * Comparison key for a tag. Tags arrive from hand-authored catalogs, user input
 * and imported panel JSON, so `Rain`, `rain` and `RAIN` all denote one tag and
 * must dedupe and match as one. The original spelling is kept for display.
 */
export function normalizeTagKey(tag: string): string {
  return tag.trim().toLowerCase()
}

/** Manual tags + optional category + auto sim tags, de-duplicated, stable order. */
export function mergeTags(
  manual: readonly string[] | undefined,
  requires: readonly TelemetryField[] | undefined,
  category?: string,
  alternativeRequires: readonly (readonly TelemetryField[])[] = []
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const add = (t: string | undefined): void => {
    if (!t) return
    const v = t.trim()
    if (!v) return
    const key = normalizeTagKey(v)
    if (seen.has(key)) return
    seen.add(key)
    out.push(v)
  }
  if (category) add(category)
  for (const t of manual ?? []) add(t)
  for (const s of simTagsFor(requires, alternativeRequires)) add(s)
  return out
}

// ── Controlled vocabulary ─────────────────────────────────────────────────────
export const SIM_TAGS = ['IR', 'ACC', 'AC', 'AMS2', 'LMU'] as const

export const SOURCE_TAGS = ['iRacing', 'iracing', 'source-iracing'] as const

export const CATEGORY_TAGS = [
  'abs', 'acceleration', 'anti-roll', 'attitude', 'battery', 'best', 'boost', 'bop',
  'brake-bias', 'brakes', 'camera', 'capacity', 'car', 'chassis', 'class', 'clock',
  'clutch', 'cold', 'completed', 'consumption', 'controls', 'count', 'damage', 'delta',
  'density', 'derived', 'distance', 'drive', 'driver', 'driver-input', 'drs',
  'electric', 'electrical', 'energy', 'engine', 'engine-braking', 'engine-map', 'ers',
  'estimated', 'evidence', 'field', 'flags', 'fog', 'formation', 'fuel', 'g-force',
  'gap', 'gear', 'grip',
  'handbrake', 'heading', 'humidity', 'identity', 'incidents', 'inputs',
  'intervention', 'irating', 'lap-time', 'laps', 'level', 'license', 'limiter',
  'lock', 'map', 'multiclass', 'number', 'oil', 'pace', 'pacenotes', 'pit', 'points',
  'position', 'power', 'pressure', 'push-to-pass', 'race-control', 'radar', 'rain',
  'rating', 'relative', 'repair', 'replay', 'restart', 'revlights', 'rotation', 'rpm',
  'sectors', 'service', 'session',
  'setup', 'shift', 'skies', 'solar', 'speed', 'standings', 'steering', 'strategy',
  'surface', 'tc', 'team', 'temperature', 'thermal', 'throttle', 'timeline', 'timing',
  'torque', 'track', 'traffic', 'tyre-pressure', 'tyre-wear', 'tyres', 'velocity',
  'voltage', 'warning', 'water', 'weather', 'weight', 'weight-jacker', 'wetness',
  'wind'
] as const

export const STYLE_TAGS = [
  '3d', 'analog', 'arc', 'bar', 'barv', 'bignum', 'broadcast', 'clean',
  'corner-grid', 'ddu-inspired', 'dial', 'digital', 'gauge', 'graph', 'heatmap',
  'icon', 'indicator', 'led', 'linear', 'matrix', 'minimal', 'needle', 'neon', 'pixel',
  'radial', 'ring', 'scatter', 'segment', 'status', 'table', 'text', 'tile',
  'track-map', 'vector'
] as const

export const TYPE_TAGS = [
  'overlay', 'widget', 'dashboard', 'touch', 'hifi', 'telemetry', 'telemetry-framework',
  'trigger-only', 'trigger-edge', 'trigger-hold', 'release-a', 'release-b'
] as const

export const UNIT_TAGS = [
  'unit-bar', 'unit-celsius', 'unit-degrees', 'unit-frame', 'unit-hg', 'unit-kg',
  'unit-kg-h', 'unit-kg-lap', 'unit-kg-m', 'unit-km-h', 'unit-kpa', 'unit-l',
  'unit-percent', 'unit-rpm', 'unit-s', 'unit-v'
] as const

export function unitTagFor(unit: string | undefined): string | undefined {
  if (!unit) return undefined
  const normalized = unit
    .toLowerCase()
    .replace(/°c/g, 'celsius')
    .replace(/%/g, 'percent')
    .replace(/°/g, 'degrees')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return normalized ? `unit-${normalized}` : undefined
}

export const ORIENTATION_LAYOUT_TAGS = [
  '1024x600', 'portrait', 'landscape', 'dense'
] as const

/** Stable Release B dashboard-family facets exposed to shared UI filters. */
export const DASHBOARD_PORTFOLIO_FAMILY_TAGS = [
  'family-a', 'family-b', 'family-c', 'family-d', 'family-e',
  'family-f', 'family-g', 'family-h', 'family-i', 'family-j'
] as const

export const META_TAGS = [
  ...TYPE_TAGS,
  ...ORIENTATION_LAYOUT_TAGS,
  ...DASHBOARD_PORTFOLIO_FAMILY_TAGS
] as const

export const DISCIPLINE_TAGS = [
  'GT3', 'gt', 'open-wheel', 'oval', 'prototype', 'rally', 'historic', 'club'
] as const

export const SESSION_TAGS = ['quali', 'sprint', 'race', 'endurance', 'stage'] as const

export const TRACK_CONDITION_TAGS = ['dry', 'wet', 'night'] as const

export const RUN_MODE_TAGS = ['fuel-save', 'tyre-save'] as const

export const CONDITION_TAGS = [...TRACK_CONDITION_TAGS, ...RUN_MODE_TAGS] as const

export const PURPOSE_TAGS = [
  'analysis', 'battle', 'coach', 'comparison', 'consistency', 'driver-coaching',
  'engineer', 'forecast', 'launch', 'navigation', 'operations', 'pace', 'safety',
  'spotter', 'steward', 'stint', 'story', 'strategy', 'traffic', 'workflow'
] as const

export const ACCESSIBILITY_TAGS = [
  'accessibility', 'captions', 'cognitive', 'color-safe', 'haptic', 'low-vision'
] as const

export const FOCUS_TAGS = [
  'brakes', 'chassis', 'consistency', 'controls', 'delta', 'engine', 'engineer',
  'fuel', 'g-force', 'incidents', 'pace', 'race-control', 'session', 'setup',
  'stint', 'strategy', 'timing', 'track', 'traffic', 'tyres', 'weather',
  'focus-brakes', 'focus-chassis', 'focus-consistency', 'focus-controls',
  'focus-delta', 'focus-engine', 'focus-engineer', 'focus-fuel', 'focus-g-force',
  'focus-incidents', 'focus-pace', 'focus-race-control', 'focus-session',
  'focus-setup', 'focus-stint', 'focus-strategy', 'focus-timing', 'focus-track',
  'focus-traffic', 'focus-tyres', 'focus-weather'
] as const

export const ALERT_LEVEL_TAGS = [
  'alert-info', 'alert-warning', 'alert-critical', 'info', 'warning', 'critical',
  'low', 'medium', 'high'
] as const

export const DASHBOARD_STYLE_TAGS = [
  'competition', 'ddu', 'futuristic', 'dense', 'style-competition', 'style-ddu',
  'style-futuristic'
] as const

/** Static tags for filter picklists. Per-channel `telemetry-<id>` tags are namespaced. */
export const ALL_TAG_VOCAB: string[] = [...new Set([
  ...SIM_TAGS, ...SOURCE_TAGS, ...CATEGORY_TAGS, ...STYLE_TAGS, ...META_TAGS,
  ...UNIT_TAGS, ...DISCIPLINE_TAGS, ...SESSION_TAGS, ...CONDITION_TAGS,
  ...PURPOSE_TAGS, ...ACCESSIBILITY_TAGS, ...FOCUS_TAGS, ...ALERT_LEVEL_TAGS,
  ...DASHBOARD_STYLE_TAGS
])]

const CONTROLLED_TAGS = new Set(ALL_TAG_VOCAB)
const TELEMETRY_ID_TAG = /^telemetry-[a-z][A-Za-z0-9]*$/

export function isTelemetryIdTag(tag: string): boolean {
  return tag !== 'telemetry-framework' && TELEMETRY_ID_TAG.test(tag)
}

export function isControlledTag(tag: string): boolean {
  const normalized = tag.trim()
  return normalized === tag && (CONTROLLED_TAGS.has(tag) || isTelemetryIdTag(tag))
}
