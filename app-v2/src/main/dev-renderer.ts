// Single source of truth for "may this process trust ELECTRON_RENDERER_URL?".
//
// Audit P0-11 (remote renderer hardening).
//
// ELECTRON_RENDERER_URL is an ENVIRONMENT VARIABLE, and an environment variable
// is not a trust boundary: anything able to set one on the user's machine — a
// shortcut, a launcher, a login script, another installer, malware without
// admin rights — previously got full renderer control of a packaged, signed
// build. Every one of these was reachable that way:
//
//   • the main window, dashboard, overlay, compositor, pit-panel, touch-panel
//     and iRacing-login windows all did `loadURL(process.env.ELECTRON_RENDERER_URL)`;
//   • every navigation guard treated that origin as same-app, so the privileged
//     preload survived navigation to it;
//   • `registerProductionContentSecurityPolicy()` returned early whenever the
//     variable was set, so the app lost its CSP at the same moment;
//   • the streaming server added the origin to the `script-src` of pages served
//     to phones/OBS, and skipped its packaged asset-integrity checks.
//
// That is a remote-code-execution path in a shipped desktop app, so the gate is
// deliberately layered and none of the layers is an environment variable on its
// own:
//
//   1. `app.isPackaged` must be false. Electron derives that from the executable
//      path, NOT from the environment, so it cannot be flipped by setting a
//      variable. A packaged build ignores the URL ENTIRELY.
//   2. The URL must be loopback http(s). Even an unpackaged build can no longer
//      be aimed at a remote origin by a stray variable — electron-vite always
//      serves the dev renderer on loopback, so this costs developers nothing.
//   3. `ULTIMATE_SIM_DISABLE_DEV_RENDERER=1` turns it off unconditionally.
//
// The module is configured once from the main entrypoint and FAILS CLOSED until
// it is: an unconfigured process is treated as packaged. It intentionally has NO
// imports so that adding it to a module can never drag `electron` or the logger
// into a module graph that did not already have them.

export interface DevRendererConfig {
  /** Electron's `app.isPackaged`. Derived from the executable path, not the env. */
  readonly isPackaged: boolean
}

export interface DevRendererDiagnostics {
  readonly packaged: boolean
  readonly envVarPresent: boolean
  readonly active: boolean
  /** Why a present ELECTRON_RENDERER_URL was refused, or null when it was accepted. */
  readonly refusedReason: 'packaged-build' | 'explicitly-disabled' | 'not-loopback' | 'malformed' | null
}

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])
const DEV_RENDERER_KILL_SWITCH = 'ULTIMATE_SIM_DISABLE_DEV_RENDERER'

let config: DevRendererConfig | null = null
let warnedAboutPackagedOverride = false

/** Called once from the main entrypoint with Electron's real `app.isPackaged`. */
export function configureDevRenderer(next: DevRendererConfig): void {
  config = next
  warnedAboutPackagedOverride = false
}

/** Test seam. `null` restores the fail-closed (packaged) default. */
export function resetDevRendererForTests(next: DevRendererConfig | null = null): void {
  config = next
  warnedAboutPackagedOverride = false
}

/**
 * True unless we have positively been told this is an unpackaged build. Fails
 * closed: an unconfigured process is treated as packaged, so a module that is
 * somehow reached before `configureDevRenderer` cannot load a remote renderer.
 */
export function isPackagedBuild(): boolean {
  return config?.isPackaged !== false
}

function classify(): DevRendererDiagnostics {
  const raw = process.env.ELECTRON_RENDERER_URL
  const envVarPresent = typeof raw === 'string' && raw.length > 0
  const packaged = isPackagedBuild()

  if (!envVarPresent) {
    return { packaged, envVarPresent: false, active: false, refusedReason: null }
  }
  if (packaged) {
    return { packaged, envVarPresent: true, active: false, refusedReason: 'packaged-build' }
  }
  if (process.env[DEV_RENDERER_KILL_SWITCH] === '1') {
    return { packaged, envVarPresent: true, active: false, refusedReason: 'explicitly-disabled' }
  }
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return { packaged, envVarPresent: true, active: false, refusedReason: 'malformed' }
  }
  const httpScheme = parsed.protocol === 'http:' || parsed.protocol === 'https:'
  if (!httpScheme || !LOOPBACK_HOSTNAMES.has(parsed.hostname)) {
    return { packaged, envVarPresent: true, active: false, refusedReason: 'not-loopback' }
  }
  return { packaged, envVarPresent: true, active: true, refusedReason: null }
}

export function devRendererDiagnostics(): DevRendererDiagnostics {
  return classify()
}

/**
 * The dev-server renderer URL, or null when this process must not use one.
 * Every caller MUST fall back to the locally bundled renderer on null.
 */
export function devRendererUrl(): string | null {
  const diagnostics = classify()
  if (diagnostics.active) return process.env.ELECTRON_RENDERER_URL ?? null
  if (diagnostics.refusedReason !== null && !warnedAboutPackagedOverride) {
    warnedAboutPackagedOverride = true
    // Deliberately console (not the diagnostic logger): this module must stay
    // import-free, and this fires at most once per process.
    console.warn(
      `[security] Ignoring ELECTRON_RENDERER_URL (${diagnostics.refusedReason}) and loading the bundled renderer instead.`
    )
  }
  return null
}

/** Origin of the dev renderer, or null when this process must not trust one. */
export function devRendererOrigin(): string | null {
  const url = devRendererUrl()
  if (!url) return null
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/** True only when a dev renderer is genuinely allowed AND configured. */
export function isDevRendererActive(): boolean {
  return devRendererUrl() !== null
}

/**
 * The ONLY condition under which the production Content-Security-Policy may be
 * relaxed. Deriving it from the same gate makes "packaged build with no CSP"
 * unreachable by construction rather than by coincidence — see
 * `packaged-renderer-hardening.test.ts`, which asserts the invariant across the
 * full matrix of environment values.
 */
export function mayRelaxContentSecurityPolicy(): boolean {
  return isDevRendererActive()
}
