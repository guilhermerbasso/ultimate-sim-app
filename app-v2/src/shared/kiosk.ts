import type { DashboardOpenOptions } from './dashboards'

// Pure helpers shared between the main process (which builds the dashboard
// window URL / loadFile query) and the renderer (which builds the open options
// for the 7" touch launch buttons). Keeping them here makes the kiosk-flag
// wiring unit-testable without booting Electron.

/**
 * Builds the query params for a dashboard window. `dash` is always present;
 * `kiosk=1` is appended only when kiosk mode is requested so `getKioskFromQuery`
 * in the dashboard renderer mounts the touch gesture layer.
 */
export function buildDashboardQuery(id: string, kiosk?: boolean): Record<string, string> {
  const query: Record<string, string> = { dash: id }
  if (kiosk) query.kiosk = '1'
  return query
}

/**
 * Applies the dashboard query params onto a URL's search params. Used by the
 * main process for the dev-server (`ELECTRON_RENDERER_URL`) load path.
 */
export function applyDashboardQuery(url: URL, id: string, kiosk?: boolean): URL {
  for (const [key, value] of Object.entries(buildDashboardQuery(id, kiosk))) {
    url.searchParams.set(key, value)
  }
  return url
}

/**
 * Open options for launching a dashboard as a fullscreen 7" touch kiosk on a
 * specific display.
 */
export function buildKioskOpenOptions(displayId: number): DashboardOpenOptions {
  return { displayId, fullscreen: true, kiosk: true }
}
