// ─── Hi-fi composition kit ────────────────────────────────────────────────────
// Shared, self-contained toolkit for building 1024×600 COMPOSITION dashboards out
// of the hi-fi per-telemetry widgets (registry `HIFI_WIDGETS`, ids `hifi:<id>`).
//
// A composition dashboard is a `Dashboard` whose elements are `overlaywidget`
// boxes, each mounting ONE hi-fi widget by id. The renderer resolves
// `WIDGET_COMPONENTS`/`resolveWidgetComponent('hifi:<id>')` → `HifiWidgetHost`,
// which renders the live, NaN-safe hi-fi SVG. This module imports ONLY TYPES from
// `./dashboards`, so it stays a compile-time leaf with no runtime import cycle and
// is safe in BOTH the main and renderer processes (it never imports React).
//
// Each per-theme module (`dashboards-hifi-<theme>.ts`) owns its own file and simply
// exports an array of `HifiCompPreset`. `shared/dashboards.ts` spreads those arrays
// into `BUILTIN_PRESETS`. Because every theme module edits only its own file, the
// theme modules can be authored fully in parallel with zero shared-file conflict.
import type {
  Dashboard,
  DashboardElement,
  DashboardElementStyle,
  DashboardElementType
} from './dashboards'
import type { OverlayWidgetId } from './overlays'

const TARGET_W = 1024
const TARGET_H = 600

// ── Colour tokens (match the hi-fi widgets: black stage, cool accents, warm alerts).
export const HK = {
  bg: '#000000',
  panel: '#0b0d10',
  panelAlt: '#070809',
  stroke: 'rgba(255,255,255,0.10)',
  strokeSoft: 'rgba(255,255,255,0.06)',
  text: '#f5f7fa',
  dim: '#9aa3ad',
  muted: '#5b636c',
  cyan: '#22c3ff',
  amber: '#ffb020',
  red: '#ff3b30',
  green: '#22e06a',
  blue: '#2f7bff'
} as const

const FONT_TECH = '"Rajdhani", "Chakra Petch", "Segoe UI", system-ui, sans-serif'

let elSeq = 0
function createElementId(): string {
  elSeq += 1
  return `hkel-${Date.now().toString(36)}-${elSeq.toString(36)}`
}
function createDashboardId(): string {
  return `hkdash-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function style(extra: Partial<DashboardElementStyle> = {}): DashboardElementStyle {
  return { background: HK.panel, border: HK.stroke, borderWidth: 1, radius: 14, color: HK.text, fontFamily: FONT_TECH, ...extra }
}

/** Generic element factory (mirrors the private `w()` in dashboards.ts). */
export function w(
  type: DashboardElementType,
  x: number,
  y: number,
  width: number,
  height: number,
  st: DashboardElementStyle,
  options: { binding?: string; name?: string } = {}
): DashboardElement {
  return { id: createElementId(), type, x, y, w: width, h: height, style: st, binding: options.binding, name: options.name }
}

/** Full-black backplate — the first element of every composition. */
export function bg(): DashboardElement {
  return w('rect', 0, 0, TARGET_W, TARGET_H, { background: HK.bg, borderWidth: 0, radius: 0 }, { name: 'Backplate' })
}

/** A framed sub-panel (optional visual grouping behind a cluster of widgets). */
export function panel(x: number, y: number, width: number, height: number, extra: Partial<DashboardElementStyle> = {}): DashboardElement {
  return w('rect', x, y, width, height, { background: HK.panelAlt, border: HK.strokeSoft, borderWidth: 1, radius: 16, ...extra }, { name: 'Panel' })
}

/** A thin hairline divider. */
export function hairline(x: number, y: number, width: number, height: number): DashboardElement {
  return w('rect', x, y, width, height, { background: HK.stroke, borderWidth: 0, radius: 0 }, { name: 'Hairline' })
}

/** A static text label (section header / dashboard title). Content is the `name`. */
export function title(textValue: string, x: number, y: number, width: number, height: number, extra: Partial<DashboardElementStyle> = {}): DashboardElement {
  return w(
    'text',
    x,
    y,
    width,
    height,
    { background: 'transparent', borderWidth: 0, color: HK.dim, fontFamily: FONT_TECH, fontSize: 18, ...extra },
    { name: textValue }
  )
}

/**
 * Mount ONE hi-fi widget (registry id, WITHOUT the `hifi:` prefix) as an
 * `overlaywidget` element at (x, y, width, height). The widget fills the box and
 * scales to it; the hi-fi SVG letterboxes on its own viewBox.
 */
export function hifiEl(moduleId: string, x: number, y: number, width: number, height: number, extra: Partial<DashboardElementStyle> = {}): DashboardElement {
  return {
    ...w('overlaywidget', x, y, width, height, { background: '#000000', borderWidth: 0, radius: 12, ...extra }, { name: moduleId }),
    widgetId: `hifi:${moduleId}` as OverlayWidgetId,
    hifiModuleId: moduleId
  }
}

/**
 * Full-width rev-lights strip pinned CORNER-TO-CORNER across the TOP edge. Height
 * 96 matches the rev-lights widget aspect (960×90) so it fills edge-to-edge with no
 * letterbox margins. Pass any rev-lights module id ('revlightsLedStrip',
 * 'revlightsGradient', 'revlightsLedBar', or a themed one like 'revThemedFerrari').
 * NOT for the centered Mustang-style cluster (which is not edge-to-edge by design).
 */
export function revTop(moduleId = 'revlightsLedStrip'): DashboardElement {
  return hifiEl(moduleId, 0, 0, TARGET_W, 96)
}

/** Assemble a 1024×600 composition Dashboard. Elements are authored in native px. */
export function dashboard(name: string, description: string, elements: DashboardElement[]): Dashboard {
  const now = Date.now()
  const cleanName = name.replace(/\s*·\s*\d+\s*[×x]\s*\d+\s*$/i, '').trim()
  return {
    id: createDashboardId(),
    name: `${cleanName} · ${TARGET_W}×${TARGET_H}`,
    width: TARGET_W,
    height: TARGET_H,
    bg: HK.bg,
    scaleMode: 'fit',
    description,
    elements,
    createdAt: now,
    updatedAt: now
  }
}

/** A registered composition preset (spread into BUILTIN_PRESETS). */
export interface HifiCompPreset {
  id: string
  name: string
  build: () => Dashboard
  tags: string[]
}

/** Base tags carried by every hi-fi composition dashboard. */
export const HIFI_COMP_BASE_TAGS = ['hifi', 'dashboard', 'composition', '1024x600', 'fullscreen'] as const

/** Small helper to declare a preset with the base tags merged in (deduped). */
export function comp(id: string, name: string, description: string, extraTags: string[], build: () => Dashboard): HifiCompPreset {
  return { id, name, build, tags: [...new Set([...HIFI_COMP_BASE_TAGS, ...extraTags])] }
}
