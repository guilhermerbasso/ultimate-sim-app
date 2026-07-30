// Canonical render-capability contract for dashboard elements.
//
// A dashboard is rendered by one canonical renderer (`renderDashboardElement`) in five
// environments: the runtime dashboard window, the canvas editor, the overlay compositor,
// a plain browser (streaming / OBS browser source) and the inert gallery preview.
// Electron IPC only exists in the first three. Everything else has to work from the
// telemetry snapshot alone.
//
// This module is the single source of truth for "which elements need something the
// browser cannot give them". It is declared here — in `shared` — so the main process
// (stream target validation) and the renderer (inert previews, browser fallbacks) agree
// instead of each keeping a private copy. `dashboard-render-capability.test.ts` reconciles
// this manifest against the overlay widget registry and against the widget sources, so a
// widget that starts calling `window.ipc` without declaring itself here fails the build.

import { DASHBOARD_ELEMENT_TYPES, type Dashboard, type DashboardElementType } from './dashboards'

export const DASHBOARD_RENDER_ENVIRONMENTS = [
  'runtime',
  'editor',
  'compositor',
  'browser',
  'preview'
] as const

export type DashboardRenderEnvironment = (typeof DASHBOARD_RENDER_ENVIRONMENTS)[number]

/** Environments that expose `window.ipc`. */
export const IPC_RENDER_ENVIRONMENTS: readonly DashboardRenderEnvironment[] = [
  'runtime',
  'editor',
  'compositor'
]

export function environmentHasIpc(environment: DashboardRenderEnvironment): boolean {
  return IPC_RENDER_ENVIRONMENTS.includes(environment)
}

/**
 * How an element behaves where `window.ipc` is absent.
 * - `degraded`: renders its frame, but without the IPC-sourced data (placeholder/empty).
 * - `unsupported`: cannot render at all; streaming such a dashboard is blocked.
 */
export type BrowserSupportLevel = 'degraded' | 'unsupported'

/**
 * Overlay widgets whose data comes from Electron IPC instead of the telemetry snapshot.
 * These are exactly the widgets the gallery has to stub out to stay at zero IPC, and
 * exactly the widgets that lose their data in a browser source.
 */
export const IPC_SOURCED_OVERLAY_WIDGET_SUPPORT = {
  coachHeatmap: 'degraded',
  coachTips: 'degraded',
  coachFindings: 'degraded',
  coachSectorGraph: 'degraded',
  engineerFeed: 'degraded',
  trackMap: 'degraded',
  trackMapNav3D: 'degraded',
  customValue: 'degraded',
  teamFuel: 'degraded',
  tireWear: 'degraded',
  predCatchAhead: 'degraded',
  predCaughtBehind: 'degraded',
  predFuelMargin: 'degraded',
  predTireWear: 'degraded',
  predPaceProjected: 'degraded'
} as const satisfies Record<string, BrowserSupportLevel>

export type IpcSourcedOverlayWidgetId = keyof typeof IPC_SOURCED_OVERLAY_WIDGET_SUPPORT

export const IPC_SOURCED_OVERLAY_WIDGET_IDS = Object.keys(
  IPC_SOURCED_OVERLAY_WIDGET_SUPPORT
) as readonly IpcSourcedOverlayWidgetId[]

const IPC_SOURCED_OVERLAY_WIDGET_ID_SET: ReadonlySet<string> = new Set<string>(
  IPC_SOURCED_OVERLAY_WIDGET_IDS
)

export function isIpcSourcedOverlayWidgetId(value: unknown): value is IpcSourcedOverlayWidgetId {
  return typeof value === 'string' && IPC_SOURCED_OVERLAY_WIDGET_ID_SET.has(value)
}

/**
 * Element types whose data comes from IPC. Derived from the canonical element manifest so
 * a new `coach-*` / `pred-*` type is covered without touching this file.
 */
export const IPC_SOURCED_ELEMENT_TYPES: readonly DashboardElementType[] =
  DASHBOARD_ELEMENT_TYPES.filter((type) =>
    type === 'map' ||
    type === 'trackmap-clean' ||
    type === 'trackmap-elaborate' ||
    type === 'engineer-feed' ||
    type.startsWith('coach-') ||
    type.startsWith('pred-')
  )

const IPC_SOURCED_ELEMENT_TYPE_SET: ReadonlySet<string> = new Set<string>(IPC_SOURCED_ELEMENT_TYPES)

export function isIpcSourcedElementType(value: unknown): value is DashboardElementType {
  return typeof value === 'string' && IPC_SOURCED_ELEMENT_TYPE_SET.has(value)
}

export type DashboardStreamCompatibilityStatus = 'ok' | 'degraded' | 'unsupported'

export interface DashboardStreamCompatibilityEntry {
  elementId: string
  type: DashboardElementType
  widgetId?: string
  level: BrowserSupportLevel
  reason: string
}

export interface DashboardStreamCompatibility {
  status: DashboardStreamCompatibilityStatus
  degraded: DashboardStreamCompatibilityEntry[]
  unsupported: DashboardStreamCompatibilityEntry[]
}

interface CompatibilityOptions {
  /**
   * Override the declared support levels. Used by callers that know about widgets outside
   * the shared manifest, and by tests that need a genuinely unsupported widget.
   */
  overlayWidgetSupport?: Readonly<Record<string, BrowserSupportLevel>>
}

/**
 * Classify how a dashboard will render in a plain browser (streaming / OBS browser source).
 * `unsupported` entries cannot render at all and must block the stream; `degraded` entries
 * render without their IPC-sourced data and are only worth surfacing to the user.
 */
export function dashboardStreamCompatibility(
  dashboard: Pick<Dashboard, 'elements'> | null | undefined,
  options: CompatibilityOptions = {}
): DashboardStreamCompatibility {
  const support: Readonly<Record<string, BrowserSupportLevel>> = {
    ...IPC_SOURCED_OVERLAY_WIDGET_SUPPORT,
    ...options.overlayWidgetSupport
  }
  const degraded: DashboardStreamCompatibilityEntry[] = []
  const unsupported: DashboardStreamCompatibilityEntry[] = []

  for (const element of dashboard?.elements ?? []) {
    if (element.type === 'overlaywidget') {
      const widgetId = element.widgetId ?? (element.hifiModuleId ? `hifi:${element.hifiModuleId}` : undefined)
      if (!widgetId) continue
      const level = support[widgetId]
      if (!level) continue
      const entry: DashboardStreamCompatibilityEntry = {
        elementId: element.id,
        type: element.type,
        widgetId,
        level,
        reason: `Overlay widget "${widgetId}" reads its data over Electron IPC, which a browser source does not have.`
      }
      ;(level === 'unsupported' ? unsupported : degraded).push(entry)
      continue
    }
    if (isIpcSourcedElementType(element.type)) {
      degraded.push({
        elementId: element.id,
        type: element.type,
        level: 'degraded',
        reason: `Element type "${element.type}" reads its data over Electron IPC, which a browser source does not have.`
      })
    }
  }

  return {
    status: unsupported.length > 0 ? 'unsupported' : degraded.length > 0 ? 'degraded' : 'ok',
    degraded,
    unsupported
  }
}

/** Human-readable reason a dashboard may not be streamed, or null when it may. */
export function dashboardStreamBlockReason(
  dashboard: Pick<Dashboard, 'elements'> | null | undefined,
  options: CompatibilityOptions = {}
): string | null {
  const compatibility = dashboardStreamCompatibility(dashboard, options)
  if (compatibility.status !== 'unsupported') return null
  const names = compatibility.unsupported.map((entry) => entry.widgetId ?? entry.type)
  const unique = [...new Set(names)]
  return `This dashboard cannot be streamed: ${unique.join(', ')} cannot render outside the app.`
}
