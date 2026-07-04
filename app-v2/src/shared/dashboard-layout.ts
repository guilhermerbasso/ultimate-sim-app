// Dashboard LAYOUT ENGINE (PURE, dependency-free).
//
// Turns a curated BLUEPRINT (dashboard-blueprints.ts) into a final, beautiful
// Dashboard for a chosen DESIGN FAMILY, applying emphasis (enlarge / add / trim)
// and guaranteeing a valid, non-overlapping, in-canvas layout.
//
// Responsibilities:
//   1. selectVariantForConcept — pick the best catalog VARIANT for a concept IN
//      the requested design family, so the whole dashboard is cohesive and uses
//      the redesigned v2.19.0 variants (analog dials for `analog`, LED bars for
//      `neon`, dense cells for `heatmap`, …).
//   2. applyFamilyTheme — give every element a coherent surface (background,
//      border, radius, font) per family, while keeping each variant's own accent
//      (warm chrome; cool/green only marks a "good" state — the app colour rule).
//   3. buildDashboardFromBlueprint — instantiate slots, apply emphasis, place any
//      extra widgets into free space without overlaps, then validate + repair.
//
// React/Electron/node-free so it is importable by main, the renderer AND tests.

import {
  createDashboardId,
  createElementId,
  type Dashboard,
  type DashboardElement,
  type DashboardElementStyle
} from './dashboards'
import {
  conceptForElement,
  DASHBOARD_CONCEPTS,
  resolveWidgetIdForConcept,
  type CatalogWidget,
  type DashboardConcept,
  type DetailLevel
} from './dashboard-nl'
import type { WidgetStyleFamily } from './widget-taxonomy'
import { OVERLAY_DESIGN_FAMILIES, type OverlayDesignFamily } from './overlays'
import {
  blueprintConcepts,
  type BlueprintSlot,
  type DashboardBlueprint,
  type SlotRole
} from './dashboard-blueprints'

// ─── Catalog shape ───────────────────────────────────────────────────────────
// The renderer's NormalizedVariant carries `styleFamily`; the pure CatalogWidget
// does not. We read it when present and fall back to a type-derived guess.
export interface LayoutCatalogWidget extends CatalogWidget {
  styleFamily?: WidgetStyleFamily
}

// ─── Design-family → variant style preference ────────────────────────────────
// Ordered list of widget styleFamilies preferred for each of the 8 design
// families (mirrors src/shared/overlays.ts OVERLAY_DESIGN_FAMILIES so dashboards
// and overlays share one vocabulary). The first present styleFamily wins.
export const DESIGN_FAMILY_STYLE_PREF: Record<OverlayDesignFamily, WidgetStyleFamily[]> = {
  minimal: ['clean', 'digital', 'status', 'gauge', 'ring', 'bar', 'table'],
  neon: ['led', 'ring', 'bar', 'graph', 'gauge', 'digital', 'clean'],
  glass: ['clean', 'gauge', 'ring', 'digital', 'chart', 'table'],
  broadcast: ['table', 'clean', 'status', 'bar', 'digital'],
  terminal: ['digital', 'clean', 'table', 'status', 'bar'],
  bauhaus: ['digital', 'clean', 'bar', 'led', 'gauge'],
  analog: ['analog', 'ring', 'gauge', 'chart', 'clean'],
  heatmap: ['heatmap', 'chart', 'graph', 'table', 'bar', 'clean']
}

export function isDesignFamily(value: unknown): value is OverlayDesignFamily {
  return typeof value === 'string' && (OVERLAY_DESIGN_FAMILIES as readonly string[]).includes(value)
}

// ─── Family theme (coherent chrome) ──────────────────────────────────────────

const FONT_TECH = '"Avenir Next", "Bahnschrift", "Segoe UI", system-ui, sans-serif'
const FONT_COND = '"Avenir Next Condensed", "DIN Condensed", "Arial Narrow", system-ui, sans-serif'
const FONT_MONO = '"Cascadia Mono", "Consolas", "SF Mono", ui-monospace, monospace'

export interface FamilyTheme {
  bg: string
  panelBackground: string
  panelBorder: string
  panelBorderWidth: number
  panelRadius: number
  fontFamily: string
  /** Warm chrome accent used for the top strip / dividers. */
  accent: string
}

export const FAMILY_THEME: Record<OverlayDesignFamily, FamilyTheme> = {
  minimal: { bg: '#0A0A0B', panelBackground: 'transparent', panelBorder: 'transparent', panelBorderWidth: 0, panelRadius: 16, fontFamily: FONT_TECH, accent: '#FF6A2B' },
  neon: { bg: '#05060B', panelBackground: 'rgba(10,14,26,0.55)', panelBorder: '#22325A', panelBorderWidth: 1, panelRadius: 12, fontFamily: FONT_TECH, accent: '#FF3B1F' },
  glass: { bg: '#0B0D13', panelBackground: 'rgba(22,28,42,0.45)', panelBorder: 'rgba(255,255,255,0.12)', panelBorderWidth: 1, panelRadius: 22, fontFamily: FONT_TECH, accent: '#FF7A33' },
  broadcast: { bg: '#0A0B0E', panelBackground: '#101319', panelBorder: '#242C3A', panelBorderWidth: 1, panelRadius: 8, fontFamily: FONT_COND, accent: '#FF4D1C' },
  terminal: { bg: '#04060A', panelBackground: '#080D0A', panelBorder: '#143A24', panelBorderWidth: 1, panelRadius: 2, fontFamily: FONT_MONO, accent: '#FFA133' },
  bauhaus: { bg: '#0C0C0C', panelBackground: '#141414', panelBorder: '#0A0A0A', panelBorderWidth: 0, panelRadius: 0, fontFamily: FONT_COND, accent: '#FF3B1F' },
  analog: { bg: '#08090C', panelBackground: 'transparent', panelBorder: '#1B2029', panelBorderWidth: 1, panelRadius: 18, fontFamily: FONT_TECH, accent: '#FFB000' },
  heatmap: { bg: '#070809', panelBackground: '#0D1015', panelBorder: '#1C2530', panelBorderWidth: 1, panelRadius: 6, fontFamily: FONT_TECH, accent: '#FF5A2C' }
}

/** Merge a variant's base style with the family chrome (keeps the variant accent). */
export function applyFamilyTheme(base: DashboardElementStyle, theme: FamilyTheme, role: SlotRole): DashboardElementStyle {
  const next: DashboardElementStyle = {
    ...base,
    fontFamily: theme.fontFamily,
    background: theme.panelBackground,
    border: theme.panelBorder,
    borderWidth: theme.panelBorderWidth,
    radius: theme.panelRadius
  }
  // The top accent strip (shift/rev bar) is chrome — let it bleed (no panel).
  if (role === 'accent') {
    next.background = 'transparent'
    next.border = 'transparent'
    next.borderWidth = 0
  }
  return next
}

// ─── Concept → catalog variants ──────────────────────────────────────────────

const CONCEPT_PREFERRED: Record<string, string[]> = DASHBOARD_CONCEPTS.reduce(
  (acc, def) => {
    acc[def.concept] = def.preferredIds
    return acc
  },
  {} as Record<string, string[]>
)

function styleFamilyOf(w: LayoutCatalogWidget): WidgetStyleFamily {
  if (w.styleFamily) return w.styleFamily
  // Coarse fallback when the catalog item didn't carry an explicit styleFamily.
  const t = w.type
  if (t === 'standings' || t === 'table') return 'table'
  if (t === 'analoggauge' || t === 'gforcemeter' || t === 'linearmeter') return 'analog'
  if (t === 'segment7' || t === 'digitalclock') return 'digital'
  if (t === 'ringgauge' || t === 'donut') return 'ring'
  if (t === 'ledbar' || t === 'shiftbar' || t === 'shiftlights') return 'led'
  if (t === 'heatmap') return 'heatmap'
  if (t === 'historygraph' || t === 'inputtrace') return 'graph'
  if (t === 'barchart' || t === 'radialbars' || t === 'tyregrid' || t === 'brakegrid' || t === 'cornerstack') return 'chart'
  return 'clean'
}

/** All catalog widgets that represent a concept (preferred ids + type/binding map). */
export function widgetsForConcept(concept: DashboardConcept, catalog: readonly LayoutCatalogWidget[]): LayoutCatalogWidget[] {
  const preferred = CONCEPT_PREFERRED[concept] ?? []
  const preferredSet = new Set(preferred)
  const byId = new Map(catalog.map((w) => [w.id, w]))
  const out: LayoutCatalogWidget[] = []
  const seen = new Set<string>()
  const add = (w: LayoutCatalogWidget | undefined): void => {
    if (w && !seen.has(w.id)) {
      seen.add(w.id)
      out.push(w)
    }
  }
  // Curated preferred ids first (in their authored priority order).
  for (const id of preferred) add(byId.get(id))
  // Then any catalog widget that maps to the same concept by type/binding.
  for (const w of catalog) {
    if (seen.has(w.id)) continue
    if (preferredSet.has(w.id)) continue
    if (conceptForElement({ type: w.type, binding: w.binding }) === concept) add(w)
  }
  return out
}

/**
 * Pick the best catalog VARIANT for a concept in the chosen design family. Ranks
 * candidates by how early their styleFamily appears in the family preference,
 * biased by the requested detail and the concept's curated priority order. Falls
 * back to the category resolver, then undefined.
 */
export function selectVariantForConcept(
  concept: DashboardConcept,
  family: OverlayDesignFamily,
  catalog: readonly LayoutCatalogWidget[],
  detail: DetailLevel = 'auto'
): LayoutCatalogWidget | undefined {
  const candidates = widgetsForConcept(concept, catalog)
  if (candidates.length === 0) {
    const id = resolveWidgetIdForConcept(concept, catalog, detail)
    return id ? catalog.find((w) => w.id === id) : undefined
  }
  const pref = DESIGN_FAMILY_STYLE_PREF[family] ?? []
  const preferredOrder = CONCEPT_PREFERRED[concept] ?? []
  const detailSuffix = detail === 'elaborate' ? '-elaborate' : detail === 'clean' ? '-clean' : ''
  const score = (w: LayoutCatalogWidget): number => {
    const famIdx = pref.indexOf(styleFamilyOf(w))
    const fam = famIdx < 0 ? 40 : famIdx
    const detailBonus = detailSuffix && w.id.endsWith(detailSuffix) ? -3 : 0
    const prefIdx = preferredOrder.indexOf(w.id)
    const prefScore = prefIdx < 0 ? 8 : prefIdx * 0.25
    return fam + detailBonus + prefScore
  }
  return candidates.slice().sort((a, b) => score(a) - score(b))[0]
}

// ─── Geometry: solver + validator + repair ───────────────────────────────────

export interface CanvasBox {
  width: number
  height: number
  margin: number
}

const DEFAULT_BOX: CanvasBox = { width: 1024, height: 600, margin: 16 }
const MIN_W = 56
const MIN_H = 36

interface Box {
  x: number
  y: number
  w: number
  h: number
}

function boxesOverlap(a: Box, b: Box, gap = 0): boolean {
  return a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y
}

function withinCanvas(b: Box, box: CanvasBox): boolean {
  return b.x >= box.margin && b.y >= box.margin && b.x + b.w <= box.width - box.margin && b.y + b.h <= box.height - box.margin
}

/**
 * Find a free top-left position for a w×h widget that doesn't overlap any of the
 * existing rects (with a small gap) and stays in-canvas. Returns null if none.
 */
export function placeIntoFreeSpace(
  existing: readonly Box[],
  w: number,
  h: number,
  box: CanvasBox = DEFAULT_BOX,
  gap = 8,
  step = 8
): { x: number; y: number } | null {
  const maxX = box.width - box.margin - w
  const maxY = box.height - box.margin - h
  if (maxX < box.margin || maxY < box.margin) return null
  for (let y = box.margin; y <= maxY; y += step) {
    for (let x = box.margin; x <= maxX; x += step) {
      const candidate: Box = { x, y, w, h }
      if (!existing.some((e) => boxesOverlap(candidate, e, gap))) return { x, y }
    }
  }
  return null
}

export interface LayoutIssue {
  kind: 'out-of-bounds' | 'overlap' | 'too-small'
  index: number
  detail: string
}

/** Report any out-of-bounds / overlapping / undersized elements. */
export function validateLayout(elements: readonly DashboardElement[], box: CanvasBox = DEFAULT_BOX): LayoutIssue[] {
  const issues: LayoutIssue[] = []
  for (let i = 0; i < elements.length; i++) {
    const e = elements[i]
    if (!withinCanvas(e, box)) issues.push({ kind: 'out-of-bounds', index: i, detail: `${e.name ?? e.type} @ ${e.x},${e.y} ${e.w}×${e.h}` })
    if (e.w < MIN_W || e.h < MIN_H) issues.push({ kind: 'too-small', index: i, detail: `${e.name ?? e.type} ${e.w}×${e.h}` })
    for (let j = i + 1; j < elements.length; j++) {
      if (boxesOverlap(e, elements[j])) issues.push({ kind: 'overlap', index: j, detail: `${e.name ?? e.type} ∩ ${elements[j].name ?? elements[j].type}` })
    }
  }
  return issues
}

/**
 * Auto-repair a layout: clamp sizes/positions into the canvas, enforce minimum
 * sizes, then resolve overlaps by relocating the offending element to free space
 * (or shrinking it as a last resort). Returns a new array; never throws.
 */
export function repairLayout(elements: readonly DashboardElement[], box: CanvasBox = DEFAULT_BOX): DashboardElement[] {
  const maxW = box.width - 2 * box.margin
  const maxH = box.height - 2 * box.margin
  const placed: DashboardElement[] = []
  for (const original of elements) {
    let e: DashboardElement = { ...original }
    // Clamp size into the canvas and enforce minimums.
    e.w = Math.max(MIN_W, Math.min(e.w, maxW))
    e.h = Math.max(MIN_H, Math.min(e.h, maxH))
    // Clamp position into the canvas.
    e.x = Math.min(Math.max(e.x, box.margin), box.width - box.margin - e.w)
    e.y = Math.min(Math.max(e.y, box.margin), box.height - box.margin - e.h)
    // Resolve overlap with already-kept elements.
    if (placed.some((p) => boxesOverlap(e, p))) {
      const spot = placeIntoFreeSpace(placed, e.w, e.h, box)
      if (spot) {
        e = { ...e, x: spot.x, y: spot.y }
      } else {
        // Shrink and retry once.
        const sw = Math.max(MIN_W, Math.round(e.w * 0.7))
        const sh = Math.max(MIN_H, Math.round(e.h * 0.7))
        const spot2 = placeIntoFreeSpace(placed, sw, sh, box)
        if (spot2) e = { ...e, x: spot2.x, y: spot2.y, w: sw, h: sh }
        else continue // drop as a last resort rather than overlap
      }
    }
    placed.push(e)
  }
  return placed
}

// ─── Emphasis ────────────────────────────────────────────────────────────────

export type EmphasisModifier = 'dense' | 'minimal'
export type EmphasisTag = DashboardConcept | EmphasisModifier

const EMPHASIS_MODIFIERS: readonly EmphasisModifier[] = ['dense', 'minimal']
const CONCEPT_SET = new Set<string>(DASHBOARD_CONCEPTS.map((c) => c.concept))

/** All accepted emphasis tags (the LLM enum + the deterministic vocabulary). */
export const EMPHASIS_TAGS: EmphasisTag[] = [...DASHBOARD_CONCEPTS.map((c) => c.concept), ...EMPHASIS_MODIFIERS]

export function isEmphasisTag(value: unknown): value is EmphasisTag {
  return typeof value === 'string' && (CONCEPT_SET.has(value) || (EMPHASIS_MODIFIERS as readonly string[]).includes(value))
}

// Concepts the `dense` modifier may use to fill leftover space (small, useful).
const DENSE_FILLERS: DashboardConcept[] = ['relatives', 'inputs', 'tyres', 'enginetemps', 'flags', 'trackmap', 'position', 'fuel']

// ─── Build ───────────────────────────────────────────────────────────────────

export interface LayoutOptions {
  family: OverlayDesignFamily
  emphasis?: EmphasisTag[]
  detail?: DetailLevel
  catalog: readonly LayoutCatalogWidget[]
  name?: string
  description?: string
  /** Override the canvas background (otherwise the family theme background). */
  bg?: string
}

export interface LayoutResult {
  dashboard: Dashboard
  widgetIds: string[]
  placedConcepts: DashboardConcept[]
}

function detailForRole(role: SlotRole, slotDetail: BlueprintSlot['detail'], global: DetailLevel): DetailLevel {
  if (slotDetail) return slotDetail
  if (global !== 'auto') return global
  if (role === 'primary') return 'elaborate'
  if (role === 'tertiary') return 'clean'
  return 'auto'
}

function elementFromVariant(variant: LayoutCatalogWidget, rect: Box, theme: FamilyTheme, role: SlotRole): DashboardElement {
  return {
    id: createElementId(),
    type: variant.type,
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
    binding: variant.binding,
    name: variant.name ?? variant.label ?? variant.id,
    style: applyFamilyTheme(variant.style, theme, role)
  }
}

/** Grow an element by `factor` if the extra footprint stays free + in-canvas. */
function growElement(el: DashboardElement, others: readonly Box[], box: CanvasBox, factor = 1.18): DashboardElement {
  const maxW = box.width - box.margin - el.x
  const maxH = box.height - box.margin - el.y
  const w = Math.min(Math.round(el.w * factor), maxW)
  const h = Math.min(Math.round(el.h * factor), maxH)
  const grown: Box = { x: el.x, y: el.y, w, h }
  if (others.some((o) => boxesOverlap(grown, o))) return el
  return { ...el, w, h }
}

// Rough glyph count of the PRIMARY readout per concept, so a tile is never sized
// smaller than its content needs. Concepts with complex internal layouts (grids,
// tables, gauges, maps) are intentionally omitted — their widgets self-fit.
const CONTENT_CHARS: Partial<Record<DashboardConcept, number>> = {
  gear: 1,
  speed: 3,
  rpm: 5,
  delta: 7,
  laptime: 8,
  position: 5,
  gaps: 7,
  fuel: 5,
  steering: 4,
  incidents: 3
}

// Minimum legible primary-numeral size (px) and mono digit advance (em). Used to
// derive the smallest tile width/height a value can occupy before it must clip.
const MIN_LEGIBLE_PX = 22
const DIGIT_EM = 0.62
const CONTENT_PAD = 18

/**
 * Content-aware sizing: make sure no tile is smaller than the space its primary
 * value needs at a legible size. AI-built dashboards only (the curated
 * BUILTIN_PRESETS bypass this engine, so they can't regress). For each measurable
 * element we first try to GROW the tile into adjacent free space; if it can't grow
 * we lower the authored font floor (style.minFontSize) so the fill engine can
 * still shrink the value to fit instead of overflowing. Never adds/removes/moves
 * elements and never introduces an overlap, so validateLayout stays clean.
 */
function fitContentToTiles(elements: readonly DashboardElement[], box: CanvasBox): DashboardElement[] {
  const result = elements.map((e) => ({ ...e }))
  for (let i = 0; i < result.length; i++) {
    const el = result[i]
    const concept = conceptForElement({ type: el.type, binding: el.binding })
    const chars = concept ? CONTENT_CHARS[concept] ?? 0 : 0
    if (chars <= 0) continue

    const needW = Math.ceil(chars * DIGIT_EM * MIN_LEGIBLE_PX) + CONTENT_PAD
    const needH = MIN_LEGIBLE_PX + CONTENT_PAD
    if (el.w >= needW && el.h >= needH) continue

    const others = result.filter((_, j) => j !== i)
    const maxW = box.width - box.margin - el.x
    const maxH = box.height - box.margin - el.y
    const targetW = Math.min(Math.max(el.w, needW), maxW)
    const targetH = Math.min(Math.max(el.h, needH), maxH)
    const grown: Box = { x: el.x, y: el.y, w: targetW, h: targetH }
    // 6px breathing gap when testing growth keeps a margin even though
    // validateLayout only forbids true (gap=0) overlaps.
    if ((targetW > el.w || targetH > el.h) && !others.some((o) => boxesOverlap(grown, o, 6))) {
      el.w = targetW
      el.h = targetH
    }

    // Whatever width we ended up with, lower the authored font floor so the fill
    // engine can shrink the value into the tile rather than clip it.
    const fitFloor = Math.max(10, Math.floor((el.w - CONTENT_PAD) / Math.max(1, chars * DIGIT_EM)))
    const style: DashboardElementStyle = { ...el.style }
    if (style.minFontSize === undefined || style.minFontSize > fitFloor) style.minFontSize = fitFloor
    el.style = style
  }
  return result
}

/**
 * Instantiate a blueprint into a finished Dashboard for the chosen design family,
 * applying emphasis and guaranteeing a valid, non-overlapping, in-canvas layout.
 */
export function buildDashboardFromBlueprint(blueprint: DashboardBlueprint, opts: LayoutOptions): LayoutResult {
  const theme = FAMILY_THEME[opts.family] ?? FAMILY_THEME.broadcast
  const detail = opts.detail ?? 'auto'
  const emphasis = (opts.emphasis ?? []).filter(isEmphasisTag)
  const box: CanvasBox = { width: blueprint.width, height: blueprint.height, margin: 16 }
  const trimTertiary = emphasis.includes('minimal')
  const dense = emphasis.includes('dense')
  const emphasisConcepts = emphasis.filter((t): t is DashboardConcept => CONCEPT_SET.has(t))

  // Parallel arrays keep each element's source catalog id (for widgetIds).
  const placedConcepts = new Set<DashboardConcept>()
  let elements: DashboardElement[] = []
  const variantIds: string[] = []
  const pushElement = (variant: LayoutCatalogWidget, rect: Box, role: SlotRole, concept: DashboardConcept): void => {
    elements.push(elementFromVariant(variant, rect, theme, role))
    variantIds.push(variant.id)
    placedConcepts.add(concept)
  }

  // 1. Instantiate blueprint slots (skip tertiary when "minimal" is requested).
  for (const slot of blueprint.slots) {
    if (trimTertiary && slot.role === 'tertiary') continue
    const variant = selectVariantForConcept(slot.concept, opts.family, opts.catalog, detailForRole(slot.role, slot.detail, detail))
    if (!variant) continue
    pushElement(variant, slot, slot.role, slot.concept)
  }

  // 2. Emphasis on existing concepts → grow them slightly into adjacent space.
  for (const concept of emphasisConcepts) {
    if (!placedConcepts.has(concept)) continue
    const idx = elements.findIndex((e) => conceptForElement({ type: e.type, binding: e.binding }) === concept)
    if (idx >= 0) {
      const others = elements.filter((_, i) => i !== idx)
      elements[idx] = growElement(elements[idx], others, box)
    }
  }

  // 3. Emphasis on missing concepts → add them into free space.
  for (const concept of emphasisConcepts) {
    if (placedConcepts.has(concept)) continue
    const variant = selectVariantForConcept(concept, opts.family, opts.catalog, detail)
    if (!variant) continue
    const w = Math.min(variant.w, 360)
    const h = Math.min(variant.h, 240)
    const spot = placeIntoFreeSpace(elements, w, h, box)
    if (!spot) continue
    pushElement(variant, { ...spot, w, h }, 'tertiary', concept)
  }

  // 4. "dense" → fill remaining free space with a few useful filler widgets.
  if (dense) {
    for (const concept of DENSE_FILLERS) {
      if (placedConcepts.has(concept)) continue
      const variant = selectVariantForConcept(concept, opts.family, opts.catalog, 'clean')
      if (!variant) continue
      const w = Math.min(variant.w, 300)
      const h = Math.min(variant.h, 180)
      const spot = placeIntoFreeSpace(elements, w, h, box)
      if (!spot) continue
      pushElement(variant, { ...spot, w, h }, 'tertiary', concept)
    }
  }

  // 4b. Content-aware sizing: ensure no tile is too small for its primary value.
  // (AI-built dashboards only; curated presets bypass this engine.)
  elements = fitContentToTiles(elements, box)

  // 5. Validate + repair (idempotent safety net; blueprints are already valid).
  // Repair preserves element order, so the variantIds stay aligned (any dropped
  // element is removed from the tail of free-space additions).
  let finalIds = variantIds
  if (validateLayout(elements, box).length > 0) {
    const repaired = repairLayout(elements, box)
    const keptIds = new Set(repaired.map((e) => e.id))
    finalIds = elements.map((e, i) => ({ id: e.id, vid: variantIds[i] })).filter((p) => keptIds.has(p.id)).map((p) => p.vid)
    elements = repaired
  }

  const now = Date.now()
  const dashboard: Dashboard = {
    id: createDashboardId(),
    name: opts.name ?? blueprint.label,
    width: blueprint.width,
    height: blueprint.height,
    bg: opts.bg ?? blueprint.bg ?? theme.bg,
    elements,
    scaleMode: 'fit',
    description: opts.description ?? blueprint.description,
    author: 'Dashboard AI',
    createdAt: now,
    updatedAt: now
  }

  return { dashboard, widgetIds: finalIds, placedConcepts: [...placedConcepts] }
}

// Re-export for convenience so callers only import this module.
export { blueprintConcepts }

// ─── Editable-canvas geometry helpers (PURE) ─────────────────────────────────
// Shared, dependency-free geometry math for the editable dashboard canvas
// (DashboardCanvasEditor) and the per-moment FRAME editor. These mirror the math
// the legacy in-view editor uses, but live here so they are unit-testable and
// reusable across editors without coupling to any React view.

/** The eight resize anchors of a selection box. */
export type CanvasResizeHandle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'

export const CANVAS_RESIZE_HANDLES: readonly CanvasResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

/** Smallest width/height an element may be resized to (px, canvas units). */
export const MIN_CANVAS_ELEMENT_SIZE = 8

/** Geometry subset every canvas element exposes. */
export interface CanvasGeometry {
  x: number
  y: number
  w: number
  h: number
}

export function snapValue(value: number, step: number): number {
  if (step <= 1) return Math.round(value)
  return Math.round(value / step) * step
}

function clampNum(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** Keep a geometry inside the board and at/above the minimum size. */
export function constrainCanvasGeometry(
  geometry: CanvasGeometry,
  board: { width: number; height: number }
): CanvasGeometry {
  const maxW = Math.max(MIN_CANVAS_ELEMENT_SIZE, board.width)
  const maxH = Math.max(MIN_CANVAS_ELEMENT_SIZE, board.height)
  const w = clampNum(geometry.w, MIN_CANVAS_ELEMENT_SIZE, maxW)
  const h = clampNum(geometry.h, MIN_CANVAS_ELEMENT_SIZE, maxH)
  return {
    x: clampNum(geometry.x, 0, Math.max(0, board.width - w)),
    y: clampNum(geometry.y, 0, Math.max(0, board.height - h)),
    w,
    h
  }
}

/** New geometry after dragging a resize `handle` by (dx, dy) canvas units. */
export function computeCanvasResize(
  start: CanvasGeometry,
  handle: CanvasResizeHandle,
  dx: number,
  dy: number,
  board: { width: number; height: number },
  step: number
): CanvasGeometry {
  let left = start.x
  let top = start.y
  let right = start.x + start.w
  let bottom = start.y + start.h

  if (handle.includes('w')) left = snapValue(start.x + dx, step)
  if (handle.includes('e')) right = snapValue(start.x + start.w + dx, step)
  if (handle.includes('n')) top = snapValue(start.y + dy, step)
  if (handle.includes('s')) bottom = snapValue(start.y + start.h + dy, step)

  if (right - left < MIN_CANVAS_ELEMENT_SIZE) {
    if (handle.includes('w')) left = right - MIN_CANVAS_ELEMENT_SIZE
    else right = left + MIN_CANVAS_ELEMENT_SIZE
  }
  if (bottom - top < MIN_CANVAS_ELEMENT_SIZE) {
    if (handle.includes('n')) top = bottom - MIN_CANVAS_ELEMENT_SIZE
    else bottom = top + MIN_CANVAS_ELEMENT_SIZE
  }

  if (left < 0) left = 0
  if (top < 0) top = 0
  if (right > board.width) right = board.width
  if (bottom > board.height) bottom = board.height

  if (right - left < MIN_CANVAS_ELEMENT_SIZE) {
    if (handle.includes('w')) left = Math.max(0, right - MIN_CANVAS_ELEMENT_SIZE)
    else right = Math.min(board.width, left + MIN_CANVAS_ELEMENT_SIZE)
  }
  if (bottom - top < MIN_CANVAS_ELEMENT_SIZE) {
    if (handle.includes('n')) top = Math.max(0, bottom - MIN_CANVAS_ELEMENT_SIZE)
    else bottom = Math.min(board.height, top + MIN_CANVAS_ELEMENT_SIZE)
  }

  return constrainCanvasGeometry({ x: left, y: top, w: right - left, h: bottom - top }, board)
}

/** New geometry after dragging an element body by (dx, dy) canvas units. */
export function computeCanvasMove(
  start: CanvasGeometry,
  dx: number,
  dy: number,
  board: { width: number; height: number },
  step: number
): CanvasGeometry {
  return constrainCanvasGeometry(
    { ...start, x: snapValue(start.x + dx, step), y: snapValue(start.y + dy, step) },
    board
  )
}
