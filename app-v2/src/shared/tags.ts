// ── Tag taxonomy + auto sim-tags ──────────────────────────────────────────────
// Central place for the widget/overlay/dashboard tag vocabulary and the helper that
// merges an item's manual tags with the SIM tags derived automatically from the
// telemetry fields it needs (`requires`) via the sim-coverage map. So an item that
// reads `tyres` is auto-tagged IR/ACC/LMU, one that reads `drivers` is auto-tagged
// IR, etc. — never hand-maintained.
import type { TelemetrySnapshot } from './telemetry'
import { simLabel, widgetSupportedSims } from './sim-coverage'

export type TelemetryField = keyof TelemetrySnapshot

/** Sim tags (e.g. ['IR','ACC','LMU']) that a widget supports, from its required fields. */
export function simTagsFor(requires: readonly TelemetryField[] | undefined): string[] {
  return widgetSupportedSims(requires).map((s) => simLabel(s))
}

/** Manual tags + optional category + auto sim tags, de-duplicated, stable order. */
export function mergeTags(
  manual: readonly string[] | undefined,
  requires: readonly TelemetryField[] | undefined,
  category?: string
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const add = (t: string | undefined): void => {
    if (!t) return
    const v = t.trim()
    if (!v || seen.has(v)) return
    seen.add(v)
    out.push(v)
  }
  if (category) add(category)
  for (const t of manual ?? []) add(t)
  for (const s of simTagsFor(requires)) add(s)
  return out
}

// ── Vocabulary (for pickers / documentation; not exhaustive) ──────────────────
export const SIM_TAGS = ['IR', 'ACC', 'AC', 'AMS2', 'LMU'] as const

export const CATEGORY_TAGS = [
  'inputs', 'delta', 'gap', 'speed', 'rpm', 'gear', 'revlights', 'shift', 'fuel',
  'tyres', 'tyre-pressure', 'tyre-wear', 'brakes', 'brake-bias', 'tc', 'abs',
  'engine', 'engine-map', 'ers', 'oil', 'water', 'weather', 'wetness', 'grip',
  'standings', 'relative', 'radar', 'map', 'sectors', 'laps', 'position',
  'incidents', 'flags', 'pit', 'g-force', 'steering', 'session', 'clock'
] as const

export const STYLE_TAGS = [
  'clean', 'minimal', 'gauge', 'dial', 'needle', 'led', 'bar', 'barv', 'segment',
  'digital', 'analog', 'pixel', 'ring', 'arc', 'heatmap', 'neon', 'broadcast',
  'tile', 'bignum', 'icon', '3d'
] as const

export const META_TAGS = ['overlay', 'widget', 'dashboard', 'touch', 'hifi', '1024x600', 'portrait'] as const

/** All known tags (for the filter picklist source). */
export const ALL_TAG_VOCAB: string[] = [...SIM_TAGS, ...CATEGORY_TAGS, ...STYLE_TAGS, ...META_TAGS]
