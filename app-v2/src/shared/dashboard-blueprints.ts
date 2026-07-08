// Curated dashboard BLUEPRINTS (PURE, dependency-free).
//
// The deterministic core of the redesigned "Dashboard AI" builder. A blueprint
// is a hand-tuned LAYOUT with real visual hierarchy on the standard 1024×600
// canvas: a PRIMARY zone (gear/speed/rpm — large, central/top), a SECONDARY zone
// (delta/fuel/position/laptimes — medium) and a TERTIARY zone (inputs/tyres/temps/
// flags/relatives — small). Each blueprint declares an ordered list of slots that
// reference a telemetry CONCEPT (not a concrete widget) plus an absolute rect.
//
// The layout engine (dashboard-layout.ts) instantiates a blueprint by resolving
// every concept to the best catalog VARIANT for the chosen design family, so the
// same blueprint can render minimal / neon / glass / broadcast / terminal /
// bauhaus / analog / heatmap and stay cohesive.
//
// Geometry is computed by a handful of split helpers (columns/rows divided by
// weight) so positions are guaranteed disjoint and inside the canvas — yet the
// COMPOSITION (which concepts, which zone, which weight) is hand-authored per
// archetype to give each a distinct, native-looking layout. The proportions are
// derived from the shipped curated presets in dashboards.ts.
//
// React/Electron/node-free so it is importable by main, the renderer AND tests.

import type { OverlayDesignFamily } from './overlays'
import type { DashboardConcept } from './dashboard-nl'

// ─── Archetypes ──────────────────────────────────────────────────────────────

export type DashboardArchetype =
  | 'sprint'
  | 'endurance'
  | 'qualifying'
  | 'practice'
  | 'oval'
  | 'dirt'
  | 'formula'
  | 'gt3'
  | 'minimal'
  | 'futuristic'
  | 'dataheavy'
  | 'streaming'

export type SlotRole = 'primary' | 'secondary' | 'tertiary' | 'accent'

/** Optional per-slot detail hint that biases variant selection. */
export type SlotDetail = 'clean' | 'elaborate'

export interface BlueprintSlot {
  role: SlotRole
  concept: DashboardConcept
  x: number
  y: number
  w: number
  h: number
  detail?: SlotDetail
}

export interface DashboardBlueprint {
  id: DashboardArchetype
  label: string
  archetype: DashboardArchetype
  /** Design family/theme used when the request doesn't ask for a specific one. */
  defaultFamily: OverlayDesignFamily
  width: number
  height: number
  /** Optional explicit background; otherwise the family theme background wins. */
  bg?: string
  description: string
  slots: BlueprintSlot[]
}

// ─── Canvas + geometry helpers ───────────────────────────────────────────────

export const CANVAS_W = 1024
export const CANVAS_H = 600
const M = 16 // outer margin
const G = 12 // gap between cells

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

interface SlotSpec {
  role: SlotRole
  concept: DashboardConcept
  weight?: number
  detail?: SlotDetail
}

/**
 * Split an extent into n integer segments by weight, separated by `gap`. The
 * last segment absorbs rounding remainder so segments are exactly disjoint and
 * together span `extent` (sum of sizes + gaps === extent). Never overlaps.
 */
function divide(start: number, extent: number, weights: number[], gap: number): Array<{ start: number; size: number }> {
  const n = weights.length
  if (n === 0) return []
  const total = weights.reduce((a, b) => a + b, 0) || n
  const inner = extent - gap * (n - 1)
  const sizes = weights.map((w) => Math.max(1, Math.round((w / total) * inner)))
  // Fix rounding drift on the last cell so the sum is exact.
  const drift = inner - sizes.reduce((a, b) => a + b, 0)
  sizes[n - 1] = Math.max(1, sizes[n - 1] + drift)
  const out: Array<{ start: number; size: number }> = []
  let cursor = start
  for (let i = 0; i < n; i++) {
    out.push({ start: cursor, size: sizes[i] })
    cursor += sizes[i] + gap
  }
  return out
}

/** Divide a region into vertical columns by weight. */
function splitCols(region: Rect, weights: number[], gap = G): Rect[] {
  return divide(region.x, region.w, weights, gap).map((c) => ({ x: c.start, y: region.y, w: c.size, h: region.h }))
}

/** Divide a region into horizontal rows by weight. */
function splitRows(region: Rect, weights: number[], gap = G): Rect[] {
  return divide(region.y, region.h, weights, gap).map((r) => ({ x: region.x, y: r.start, w: region.w, h: r.size }))
}

/** Stack slots vertically inside a region (one slot per row, sized by weight). */
function column(region: Rect, items: SlotSpec[], gap = G): BlueprintSlot[] {
  const rows = splitRows(region, items.map((i) => i.weight ?? 1), gap)
  return items.map((item, i) => ({ role: item.role, concept: item.concept, detail: item.detail, ...rows[i] }))
}

/** Lay slots horizontally inside a region (one slot per column, sized by weight). */
function row(region: Rect, items: SlotSpec[], gap = G): BlueprintSlot[] {
  const cols = splitCols(region, items.map((i) => i.weight ?? 1), gap)
  return items.map((item, i) => ({ role: item.role, concept: item.concept, detail: item.detail, ...cols[i] }))
}

/** A single explicit slot occupying a whole region (the hero / a top strip). */
function single(region: Rect, role: SlotRole, concept: DashboardConcept, detail?: SlotDetail): BlueprintSlot {
  return { role, concept, detail, x: region.x, y: region.y, w: region.w, h: region.h }
}

/** Full-width body region below an optional top accent strip. */
function body(topStripH = 0): Rect {
  const y = M + (topStripH > 0 ? topStripH + G : 0)
  return { x: M, y, w: CANVAS_W - 2 * M, h: CANVAS_H - y - M }
}

const TOP_STRIP: Rect = { x: M, y: M, w: CANVAS_W - 2 * M, h: 20 }

// ─── Blueprints ──────────────────────────────────────────────────────────────
// Each composition is authored by zone so the hierarchy reads clearly. Helpers
// guarantee non-overlap, so editing weights is safe.

function sprintBlueprint(): DashboardBlueprint {
  const strip = single(TOP_STRIP, 'accent', 'shift')
  const [left, center, right] = splitCols(body(TOP_STRIP.h), [1, 1.18, 1])
  const slots: BlueprintSlot[] = [
    strip,
    ...column(left, [
      { role: 'secondary', concept: 'delta', detail: 'elaborate' },
      { role: 'secondary', concept: 'laptime' },
      { role: 'secondary', concept: 'position' },
      { role: 'tertiary', concept: 'inputs', weight: 1.1 }
    ]),
    ...column(center, [
      { role: 'primary', concept: 'gear', weight: 2.5, detail: 'elaborate' },
      { role: 'secondary', concept: 'speed', weight: 0.85 },
      { role: 'tertiary', concept: 'tyres', weight: 1.5 }
    ]),
    ...column(right, [
      { role: 'secondary', concept: 'fuel' },
      { role: 'tertiary', concept: 'relatives', weight: 2, detail: 'elaborate' },
      { role: 'tertiary', concept: 'flags' }
    ])
  ]
  return {
    id: 'sprint',
    label: 'Sprint / Race',
    archetype: 'sprint',
    defaultFamily: 'broadcast',
    width: CANVAS_W,
    height: CANVAS_H,
    description: 'Race curta: central gear, delta/times on the left, fuel e relatives on the right.',
    slots
  }
}

function enduranceBlueprint(): DashboardBlueprint {
  const strip = single(TOP_STRIP, 'accent', 'shift')
  const [left, center, right] = splitCols(body(TOP_STRIP.h), [1.1, 1, 1.1])
  const slots: BlueprintSlot[] = [
    strip,
    ...column(left, [
      { role: 'primary', concept: 'fuel', weight: 1.3, detail: 'elaborate' },
      { role: 'secondary', concept: 'laptime' },
      { role: 'tertiary', concept: 'enginetemps' }
    ]),
    ...column(center, [
      { role: 'primary', concept: 'gear', weight: 2.2 },
      { role: 'secondary', concept: 'delta' },
      { role: 'tertiary', concept: 'position' }
    ]),
    ...column(right, [
      { role: 'secondary', concept: 'tyres', weight: 1.6, detail: 'elaborate' },
      { role: 'tertiary', concept: 'relatives', weight: 1.4 }
    ])
  ]
  return {
    id: 'endurance',
    label: 'Endurance',
    archetype: 'endurance',
    defaultFamily: 'minimal',
    width: CANVAS_W,
    height: CANVAS_H,
    description: 'Stint longo: fuel e tires em destaque, tempos, delta e relativos calmos.',
    slots
  }
}

function qualifyingBlueprint(): DashboardBlueprint {
  const strip = single(TOP_STRIP, 'accent', 'shift')
  const [top, bottom] = splitRows(body(TOP_STRIP.h), [2.2, 1])
  const slots: BlueprintSlot[] = [
    strip,
    ...row(top, [
      { role: 'primary', concept: 'delta', weight: 1.6, detail: 'elaborate' },
      { role: 'primary', concept: 'gear', weight: 1 }
    ]),
    ...row(bottom, [
      { role: 'secondary', concept: 'laptime' },
      { role: 'secondary', concept: 'speed' },
      { role: 'tertiary', concept: 'inputs' }
    ])
  ]
  return {
    id: 'qualifying',
    label: 'Qualifying',
    archetype: 'qualifying',
    defaultFamily: 'bauhaus',
    width: CANVAS_W,
    height: CANVAS_H,
    description: 'Qualifying lap: delta gigante, gear, tempos e inputs para a hot lap.',
    slots
  }
}

function practiceBlueprint(): DashboardBlueprint {
  const [left, right] = splitCols(body(), [1.25, 1])
  const slots: BlueprintSlot[] = [
    ...column(left, [
      { role: 'primary', concept: 'tyres', weight: 1.6, detail: 'elaborate' },
      { role: 'secondary', concept: 'enginetemps' },
      { role: 'tertiary', concept: 'inputs', weight: 1.1 }
    ]),
    ...column(right, [
      { role: 'secondary', concept: 'brakes', weight: 1.4 },
      { role: 'secondary', concept: 'delta' },
      { role: 'tertiary', concept: 'fuel' }
    ])
  ]
  return {
    id: 'practice',
    label: 'Practice / Setup',
    archetype: 'practice',
    defaultFamily: 'heatmap',
    width: CANVAS_W,
    height: CANVAS_H,
    description: 'Treino de engenharia: tires e brakes em grade, temperaturas, inputs e delta.',
    slots
  }
}

function ovalBlueprint(): DashboardBlueprint {
  const strip = single(TOP_STRIP, 'accent', 'shift')
  const [left, center, right] = splitCols(body(TOP_STRIP.h), [1, 1.2, 1])
  const slots: BlueprintSlot[] = [
    strip,
    ...column(left, [
      { role: 'secondary', concept: 'position', detail: 'elaborate' },
      { role: 'secondary', concept: 'fuel' }
    ]),
    ...column(center, [
      { role: 'primary', concept: 'speed', weight: 1.6, detail: 'elaborate' },
      { role: 'secondary', concept: 'relatives', weight: 1.3, detail: 'elaborate' }
    ]),
    ...column(right, [
      { role: 'secondary', concept: 'laptime' },
      { role: 'tertiary', concept: 'radar' }
    ])
  ]
  return {
    id: 'oval',
    label: 'Oval',
    archetype: 'oval',
    defaultFamily: 'broadcast',
    width: CANVAS_W,
    height: CANVAS_H,
    description: 'Oval: speed e relativos no centro, position/fuel e radar de traffic.',
    slots
  }
}

function dirtBlueprint(): DashboardBlueprint {
  const [left, center, right] = splitCols(body(), [1, 1.15, 1])
  const slots: BlueprintSlot[] = [
    ...column(left, [
      { role: 'secondary', concept: 'gforce', weight: 1.4, detail: 'elaborate' },
      { role: 'tertiary', concept: 'position' }
    ]),
    ...column(center, [
      { role: 'primary', concept: 'speed', weight: 1.5, detail: 'elaborate' },
      { role: 'secondary', concept: 'gear' }
    ]),
    ...column(right, [
      { role: 'secondary', concept: 'inputs', weight: 1.3, detail: 'elaborate' },
      { role: 'tertiary', concept: 'laptime' }
    ])
  ]
  return {
    id: 'dirt',
    label: 'Dirt / Rally',
    archetype: 'dirt',
    defaultFamily: 'analog',
    width: CANVAS_W,
    height: CANVAS_H,
    description: 'Terra/rally: g-force e inputs em destaque, speed e gear analog.',
    slots
  }
}

function formulaBlueprint(): DashboardBlueprint {
  const strip = single(TOP_STRIP, 'accent', 'shift')
  const [left, center, right] = splitCols(body(TOP_STRIP.h), [1, 1.15, 1])
  const slots: BlueprintSlot[] = [
    strip,
    ...column(left, [
      { role: 'secondary', concept: 'delta', detail: 'elaborate' },
      { role: 'secondary', concept: 'laptime' },
      { role: 'tertiary', concept: 'assists' }
    ]),
    ...column(center, [
      { role: 'primary', concept: 'gear', weight: 2.4, detail: 'elaborate' },
      { role: 'secondary', concept: 'speed', weight: 0.9 }
    ]),
    ...column(right, [
      { role: 'secondary', concept: 'position' },
      { role: 'secondary', concept: 'fuel' },
      { role: 'tertiary', concept: 'inputs' }
    ])
  ]
  return {
    id: 'formula',
    label: 'Formula / Open-wheel',
    archetype: 'formula',
    defaultFamily: 'neon',
    width: CANVAS_W,
    height: CANVAS_H,
    description: 'Formula: cluster central neon, delta e tempos, position, fuel e assistências.',
    slots
  }
}

function gt3Blueprint(): DashboardBlueprint {
  const strip = single(TOP_STRIP, 'accent', 'shift')
  const [left, center, right] = splitCols(body(TOP_STRIP.h), [1.05, 1, 1.05])
  const slots: BlueprintSlot[] = [
    strip,
    ...column(left, [
      { role: 'secondary', concept: 'delta', detail: 'elaborate' },
      { role: 'secondary', concept: 'fuel' },
      { role: 'tertiary', concept: 'position' }
    ]),
    ...column(center, [
      { role: 'primary', concept: 'gear', weight: 2.1 },
      { role: 'secondary', concept: 'tyres', weight: 1.5, detail: 'elaborate' }
    ]),
    ...column(right, [
      { role: 'secondary', concept: 'laptime' },
      { role: 'tertiary', concept: 'relatives', weight: 1.5, detail: 'elaborate' },
      { role: 'tertiary', concept: 'flags' }
    ])
  ]
  return {
    id: 'gt3',
    label: 'GT3 / Sportscar',
    archetype: 'gt3',
    defaultFamily: 'glass',
    width: CANVAS_W,
    height: CANVAS_H,
    description: 'GT3 equilibrado: gear e tires centrais, delta/fuel, tempos e relativos.',
    slots
  }
}

function minimalBlueprint(): DashboardBlueprint {
  const strip = single(TOP_STRIP, 'accent', 'shift')
  const [, mid] = splitCols(body(TOP_STRIP.h), [1, 2.4, 1])
  const slots: BlueprintSlot[] = [
    strip,
    ...column(mid, [
      { role: 'primary', concept: 'gear', weight: 2.6, detail: 'clean' },
      { role: 'secondary', concept: 'speed', weight: 0.9, detail: 'clean' },
      { role: 'secondary', concept: 'delta', weight: 0.9, detail: 'clean' }
    ])
  ]
  return {
    id: 'minimal',
    label: 'Minimal / Clean',
    archetype: 'minimal',
    defaultFamily: 'minimal',
    width: CANVAS_W,
    height: CANVAS_H,
    description: 'Minimal: gear dominante centralizada, speed e delta — nothing else.',
    slots
  }
}

function futuristicBlueprint(): DashboardBlueprint {
  const strip = single(TOP_STRIP, 'accent', 'shift')
  const [top, bottom] = splitRows(body(TOP_STRIP.h), [1.7, 1])
  const slots: BlueprintSlot[] = [
    strip,
    ...row(top, [
      { role: 'secondary', concept: 'speed', detail: 'elaborate' },
      { role: 'primary', concept: 'gear', weight: 1.3, detail: 'elaborate' },
      { role: 'secondary', concept: 'rpm', detail: 'elaborate' }
    ]),
    ...row(bottom, [
      { role: 'secondary', concept: 'delta' },
      { role: 'tertiary', concept: 'fuel' },
      { role: 'tertiary', concept: 'position' },
      { role: 'tertiary', concept: 'trackmap' }
    ])
  ]
  return {
    id: 'futuristic',
    label: 'Futuristic',
    archetype: 'futuristic',
    defaultFamily: 'neon',
    width: CANVAS_W,
    height: CANVAS_H,
    description: 'Futurista: trio speed/gear/RPM em arco, delta, fuel, position e mapa.',
    slots
  }
}

function dataHeavyBlueprint(): DashboardBlueprint {
  const strip = single(TOP_STRIP, 'accent', 'shift')
  const [top, bottom] = splitRows(body(TOP_STRIP.h), [1, 1])
  const slots: BlueprintSlot[] = [
    strip,
    ...row(top, [
      { role: 'primary', concept: 'tyres', weight: 1.2, detail: 'elaborate' },
      { role: 'secondary', concept: 'brakes', weight: 1.2 },
      { role: 'secondary', concept: 'enginetemps' },
      { role: 'tertiary', concept: 'delta' }
    ]),
    ...row(bottom, [
      { role: 'tertiary', concept: 'inputs', weight: 1.2 },
      { role: 'tertiary', concept: 'fuel' },
      { role: 'tertiary', concept: 'position' },
      { role: 'tertiary', concept: 'laptime' },
      { role: 'tertiary', concept: 'relatives', weight: 1.3 }
    ])
  ]
  return {
    id: 'dataheavy',
    label: 'Data / Engineer',
    archetype: 'dataheavy',
    defaultFamily: 'heatmap',
    width: CANVAS_W,
    height: CANVAS_H,
    description: 'Denso para engineer: tires, brakes, temperaturas e uma faixa cheia de canais.',
    slots
  }
}

function streamingBlueprint(): DashboardBlueprint {
  const strip = single(TOP_STRIP, 'accent', 'shift')
  const [left, right] = splitCols(body(TOP_STRIP.h), [1.05, 1])
  const slots: BlueprintSlot[] = [
    ...column({ ...left }, [
      { role: 'primary', concept: 'standings', weight: 3, detail: 'elaborate' },
      { role: 'tertiary', concept: 'position' }
    ]),
    ...column(right, [
      { role: 'secondary', concept: 'relatives', weight: 1.4, detail: 'elaborate' },
      { role: 'secondary', concept: 'gaps' },
      { role: 'tertiary', concept: 'laptime' }
    ]),
    strip
  ]
  return {
    id: 'streaming',
    label: 'Streaming',
    archetype: 'streaming',
    defaultFamily: 'broadcast',
    width: CANVAS_W,
    height: CANVAS_H,
    description: 'Broadcast: large standings tower, relativos, gaps e times for the screen.',
    slots
  }
}

export const DASHBOARD_BLUEPRINTS: DashboardBlueprint[] = [
  sprintBlueprint(),
  enduranceBlueprint(),
  qualifyingBlueprint(),
  practiceBlueprint(),
  ovalBlueprint(),
  dirtBlueprint(),
  formulaBlueprint(),
  gt3Blueprint(),
  minimalBlueprint(),
  futuristicBlueprint(),
  dataHeavyBlueprint(),
  streamingBlueprint()
]

export const BLUEPRINT_BY_ID: Record<DashboardArchetype, DashboardBlueprint> = DASHBOARD_BLUEPRINTS.reduce(
  (acc, bp) => {
    acc[bp.id] = bp
    return acc
  },
  {} as Record<DashboardArchetype, DashboardBlueprint>
)

export const DASHBOARD_ARCHETYPES: DashboardArchetype[] = DASHBOARD_BLUEPRINTS.map((bp) => bp.id)

export function isArchetype(value: unknown): value is DashboardArchetype {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(BLUEPRINT_BY_ID, value)
}

export function getBlueprint(id: DashboardArchetype): DashboardBlueprint {
  return BLUEPRINT_BY_ID[id] ?? BLUEPRINT_BY_ID.sprint
}

/** Distinct concepts referenced by a blueprint (handy for tests + filler logic). */
export function blueprintConcepts(bp: DashboardBlueprint): DashboardConcept[] {
  const seen = new Set<DashboardConcept>()
  const out: DashboardConcept[] = []
  for (const s of bp.slots) {
    if (!seen.has(s.concept)) {
      seen.add(s.concept)
      out.push(s.concept)
    }
  }
  return out
}

// ─── Geometry validation (used by tests) ─────────────────────────────────────

export interface GeometryIssue {
  kind: 'out-of-bounds' | 'overlap' | 'too-small'
  detail: string
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

/** Validate one blueprint's geometry: in-canvas, non-overlapping, sane sizes. */
export function validateBlueprint(bp: DashboardBlueprint): GeometryIssue[] {
  const issues: GeometryIssue[] = []
  const minW = 40
  const minH = 18
  for (let i = 0; i < bp.slots.length; i++) {
    const s = bp.slots[i]
    if (s.x < 0 || s.y < 0 || s.x + s.w > bp.width || s.y + s.h > bp.height) {
      issues.push({ kind: 'out-of-bounds', detail: `${bp.id} slot ${i} (${s.concept}) at ${s.x},${s.y} ${s.w}×${s.h}` })
    }
    if (s.w < minW || s.h < minH) {
      issues.push({ kind: 'too-small', detail: `${bp.id} slot ${i} (${s.concept}) ${s.w}×${s.h}` })
    }
    for (let j = i + 1; j < bp.slots.length; j++) {
      if (overlaps(s, bp.slots[j])) {
        issues.push({ kind: 'overlap', detail: `${bp.id} slots ${i}(${s.concept}) & ${j}(${bp.slots[j].concept})` })
      }
    }
  }
  return issues
}
