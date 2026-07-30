// Regression guard for audit P0-11 (remote renderer hardening).
//
// ELECTRON_RENDERER_URL is an environment variable, and an environment variable
// is not a trust boundary. Before this change, anything able to set one on a
// user's machine could point a PACKAGED, SIGNED build at an attacker-controlled
// renderer origin — and `registerProductionContentSecurityPolicy()` returned
// early whenever the variable was set, so the app dropped its CSP at the very
// same moment. That is a remote-code-execution path in a shipped desktop app.
//
// These tests simulate a packaged app with the variable set and assert:
//   • the gate refuses the URL and every caller falls back to the bundled renderer;
//   • the CSP is never relaxed in a packaged build, across the FULL matrix of
//     environment values — the invariant, not one example;
//   • the developer workflow is unchanged for an unpackaged loopback dev server.
//
// The URLs below are obvious synthetic fakes.
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  createBrowserWindow: vi.fn(),
  getAllDisplays: vi.fn(),
  getPrimaryDisplay: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: class {
    constructor(options: unknown) {
      return electronMocks.createBrowserWindow(options) as object
    }
  },
  screen: {
    getAllDisplays: electronMocks.getAllDisplays,
    getPrimaryDisplay: electronMocks.getPrimaryDisplay
  }
}))

import {
  configureDevRenderer,
  devRendererDiagnostics,
  devRendererOrigin,
  devRendererUrl,
  isDevRendererActive,
  isPackagedBuild,
  mayRelaxContentSecurityPolicy,
  resetDevRendererForTests
} from './dev-renderer'
import { openPitPanelWindowForTest } from './pitpanel/window'
import type { ModuleContext } from './module-context'

const DEV_LOOPBACK = 'http://127.0.0.1:5174/'
const DEV_LOCALHOST = 'http://localhost:5174/'
const HOSTILE_REMOTE = 'https://renderer.attacker-controlled.invalid/'
const HOSTILE_LAN = 'http://192.168.1.66:8080/'

const display = { id: 1, label: 'Primary', bounds: { x: 0, y: 0, width: 1920, height: 1080 }, size: { width: 1920, height: 1080 } }

class FakeWebContents extends EventEmitter {
  readonly send = vi.fn()
  readonly setWindowOpenHandler = vi.fn()
  readonly id = 7
  isDestroyed(): boolean {
    return false
  }
}

class FakePanelWindow extends EventEmitter {
  readonly webContents = new FakeWebContents()
  readonly loadURL = vi.fn(async (_url: string) => undefined)
  readonly loadFile = vi.fn(async (_path: string, _options?: unknown) => undefined)
  readonly show = vi.fn()
  readonly focus = vi.fn()
  readonly setMenuBarVisibility = vi.fn()
  readonly setFullScreen = vi.fn()
  readonly destroy = vi.fn()
  readonly id = 1
  isDestroyed(): boolean {
    return false
  }
}

let panel: FakePanelWindow

beforeEach(() => {
  vi.unstubAllEnvs()
  resetDevRendererForTests()
  panel = new FakePanelWindow()
  electronMocks.createBrowserWindow.mockReset()
  electronMocks.createBrowserWindow.mockImplementation(() => panel)
  electronMocks.getAllDisplays.mockReturnValue([display])
  electronMocks.getPrimaryDisplay.mockReturnValue(display)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()
  resetDevRendererForTests()
  vi.restoreAllMocks()
})

function fakeCtx(): ModuleContext {
  return { broadcast: () => undefined } as unknown as ModuleContext
}

describe('remote renderer gate — packaged builds ignore ELECTRON_RENDERER_URL (audit P0-11)', () => {
  it.each([HOSTILE_REMOTE, HOSTILE_LAN, DEV_LOOPBACK, DEV_LOCALHOST])(
    'refuses %s in a packaged build',
    (candidate) => {
      configureDevRenderer({ isPackaged: true })
      vi.stubEnv('ELECTRON_RENDERER_URL', candidate)

      expect(devRendererUrl()).toBeNull()
      expect(devRendererOrigin()).toBeNull()
      expect(isDevRendererActive()).toBe(false)
      expect(devRendererDiagnostics().refusedReason).toBe('packaged-build')
    }
  )

  it('loads the bundled renderer from disk instead of the injected origin', () => {
    configureDevRenderer({ isPackaged: true })
    vi.stubEnv('ELECTRON_RENDERER_URL', HOSTILE_REMOTE)

    openPitPanelWindowForTest(fakeCtx(), {})

    expect(panel.loadURL).not.toHaveBeenCalled()
    expect(panel.loadFile).toHaveBeenCalledTimes(1)
    expect(panel.loadFile.mock.calls[0][0]).toMatch(/pitpanel\.html$/)
  })

  it('fails closed when nothing configured the gate at all', () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', HOSTILE_REMOTE)

    expect(isPackagedBuild()).toBe(true)
    expect(devRendererUrl()).toBeNull()
  })
})

describe('remote renderer gate — CSP can never be dropped in a packaged build (audit P0-11)', () => {
  const candidates = [undefined, '', DEV_LOOPBACK, DEV_LOCALHOST, HOSTILE_REMOTE, HOSTILE_LAN, 'not a url']

  it.each(candidates)('keeps the production CSP for ELECTRON_RENDERER_URL=%s when packaged', (candidate) => {
    configureDevRenderer({ isPackaged: true })
    if (candidate === undefined) vi.stubEnv('ELECTRON_RENDERER_URL', '')
    else vi.stubEnv('ELECTRON_RENDERER_URL', candidate)

    expect(mayRelaxContentSecurityPolicy()).toBe(false)
  })

  it('holds the invariant "packaged implies CSP applied" across the whole matrix', () => {
    for (const packaged of [true, false]) {
      for (const candidate of candidates) {
        for (const killSwitch of [undefined, '1']) {
          resetDevRendererForTests({ isPackaged: packaged })
          vi.stubEnv('ELECTRON_RENDERER_URL', candidate ?? '')
          vi.stubEnv('ULTIMATE_SIM_DISABLE_DEV_RENDERER', killSwitch ?? '')

          // The one thing that must never be true at the same time.
          expect(isPackagedBuild() && mayRelaxContentSecurityPolicy()).toBe(false)
          // And relaxation is only ever possible when a dev renderer is live.
          expect(mayRelaxContentSecurityPolicy()).toBe(isDevRendererActive())
        }
      }
    }
  })
})

describe('remote renderer gate — unpackaged builds are still restricted (audit P0-11)', () => {
  it.each([HOSTILE_REMOTE, HOSTILE_LAN])('refuses non-loopback origin %s even unpackaged', (candidate) => {
    configureDevRenderer({ isPackaged: false })
    vi.stubEnv('ELECTRON_RENDERER_URL', candidate)

    expect(devRendererUrl()).toBeNull()
    expect(devRendererDiagnostics().refusedReason).toBe('not-loopback')
  })

  it('refuses a malformed URL', () => {
    configureDevRenderer({ isPackaged: false })
    vi.stubEnv('ELECTRON_RENDERER_URL', 'not a url')

    expect(devRendererUrl()).toBeNull()
    expect(devRendererDiagnostics().refusedReason).toBe('malformed')
  })

  it('honours the explicit kill switch', () => {
    configureDevRenderer({ isPackaged: false })
    vi.stubEnv('ELECTRON_RENDERER_URL', DEV_LOOPBACK)
    vi.stubEnv('ULTIMATE_SIM_DISABLE_DEV_RENDERER', '1')

    expect(devRendererUrl()).toBeNull()
    expect(devRendererDiagnostics().refusedReason).toBe('explicitly-disabled')
  })
})

describe('remote renderer gate — the developer workflow is unchanged (audit P0-11)', () => {
  it.each([DEV_LOOPBACK, DEV_LOCALHOST, 'http://[::1]:5174/'])(
    'still serves %s to an unpackaged build',
    (candidate) => {
      configureDevRenderer({ isPackaged: false })
      vi.stubEnv('ELECTRON_RENDERER_URL', candidate)

      expect(devRendererUrl()).toBe(candidate)
      expect(isDevRendererActive()).toBe(true)
      expect(mayRelaxContentSecurityPolicy()).toBe(true)
    }
  )

  it('still loads the dev-server document into a window in an unpackaged build', () => {
    configureDevRenderer({ isPackaged: false })
    vi.stubEnv('ELECTRON_RENDERER_URL', DEV_LOOPBACK)

    openPitPanelWindowForTest(fakeCtx(), {})

    expect(panel.loadFile).not.toHaveBeenCalled()
    expect(panel.loadURL).toHaveBeenCalledWith('http://127.0.0.1:5174/pitpanel.html')
  })
})

// The CSP branch itself lives in `index.ts`, which cannot be imported in a unit
// test (its module body boots the whole Electron app). The behavioural invariant
// above pins the predicate; this pins the fact that `index.ts` actually USES that
// predicate and no longer reads the raw environment variable anywhere — the same
// source-shape guard pattern as `social-connectors/no-egress.test.ts`.
describe('remote renderer gate — no main-process module reads the raw variable (audit P0-11)', () => {
  const GATED_SOURCES = [
    'index.ts',
    'dashboards/manager.ts',
    'overlays/compositor.ts',
    'overlays/manager.ts',
    'pitpanel/window.ts',
    'touchpanel/manager.ts',
    'track-map/browser-login.ts',
    'modules/streaming.ts'
  ] as const

  it.each(GATED_SOURCES)('%s contains no direct process.env.ELECTRON_RENDERER_URL read', (relative) => {
    const source = readFileSync(fileURLToPath(new URL(`./${relative}`, import.meta.url)), 'utf8')
    const withoutComments = source.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

    expect(withoutComments).not.toContain('process.env.ELECTRON_RENDERER_URL')
  })

  it('gates the production CSP on mayRelaxContentSecurityPolicy()', () => {
    const source = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8')
    const fn = /function registerProductionContentSecurityPolicy\(\)[\s\S]*?\n}/.exec(source)?.[0] ?? ''

    expect(fn).toContain('mayRelaxContentSecurityPolicy()')
    expect(fn).not.toContain('process.env')
  })
})

// Every app window still runs with `sandbox: false`, because Electron cannot run
// an ESM preload in a sandboxed renderer and all five preloads are built as
// `.mjs` (package.json is `"type": "module"`). Turning the flag on without first
// migrating the preload build to CommonJS would silently destroy `window.ipc` at
// runtime — a failure no unit test can see. See the PR body for the per-window
// assessment and the migration path.
//
// While the sandbox is off, these two flags are what actually keep renderer
// content out of the Node context. They must never regress silently, so they are
// pinned here for every window that opts out of the sandbox.
describe('windows without the sandbox keep their compensating controls (audit P0-11)', () => {
  const WINDOW_SOURCES = [
    'index.ts',
    'dashboards/manager.ts',
    'overlays/compositor.ts',
    'overlays/manager.ts',
    'pitpanel/window.ts',
    'touchpanel/manager.ts',
    'track-map/browser-login.ts'
  ] as const

  it.each(WINDOW_SOURCES)('%s pairs every sandbox:false with contextIsolation/nodeIntegration', (relative) => {
    const source = readFileSync(fileURLToPath(new URL(`./${relative}`, import.meta.url)), 'utf8')
    const blocks = source.split(/sandbox:\s*false/).slice(0, -1)

    expect(blocks.length).toBeGreaterThan(0)
    for (const block of blocks) {
      // The webPreferences literal immediately preceding this sandbox flag.
      const preferences = block.slice(block.lastIndexOf('webPreferences'))
      expect(preferences).toContain('contextIsolation: true')
      expect(preferences).toContain('nodeIntegration: false')
    }
  })

  it('creates the pit-panel window with contextIsolation on and nodeIntegration off', () => {
    configureDevRenderer({ isPackaged: true })

    openPitPanelWindowForTest(fakeCtx(), {})

    const options = electronMocks.createBrowserWindow.mock.calls[0][0] as {
      webPreferences: { contextIsolation: boolean; nodeIntegration: boolean; preload: string }
    }
    expect(options.webPreferences.contextIsolation).toBe(true)
    expect(options.webPreferences.nodeIntegration).toBe(false)
    // Documents WHY the sandbox is still off: an ESM preload cannot be sandboxed.
    expect(options.webPreferences.preload).toMatch(/\.mjs$/)
  })
})
