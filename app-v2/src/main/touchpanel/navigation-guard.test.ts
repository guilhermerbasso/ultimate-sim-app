// Regression guard for audit P0-11 (follow-up): the touch-panel navigation guard
// must compare ORIGINS, not match a `file://` prefix.
//
// The touch-panel window carries a privileged preload (`touchpanel.mjs` exposes
// `window.ipc` over the touch-action channel allowlist), and a preload survives
// same-window navigation. The guard previously read:
//
//   const allowed = process.env.ELECTRON_RENDERER_URL ?? 'file://'
//   if (!url.startsWith(allowed)) event.preventDefault()
//
// A `file://` PREFIX test is not an origin check. In a packaged build it admitted
// EVERY `file:` URL on the machine — a page sitting in the user's Downloads
// folder, any HTML on any mounted volume — and on Windows `file://host/share`
// resolves to a UNC path, so it admitted REMOTE documents as well. Every sibling
// module (overlays/manager.ts, dashboards/manager.ts, overlays/compositor.ts)
// already compared origin + exact pathname; this brings the touch panel in line.
//
// These tests exercise the real predicate and the real `will-navigate` wiring.
import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
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

import { createButtonBoxPanel } from '../../shared/touch-panel'
import type { ModuleContext } from '../module-context'
import { isAllowedTouchPanelNavigation, TouchPanelManager } from './manager'

// The document this window is actually allowed to be on, resolved the same way
// the guard resolves it (so the test stays correct on any checkout path/OS).
const OWN_DOCUMENT = pathToFileURL(join(__dirname, '../renderer/touchpanel.html')).href

const display = {
  id: 1,
  label: 'Primary',
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  size: { width: 1920, height: 1080 }
}

class FakeWebContents extends EventEmitter {
  readonly send = vi.fn()
  readonly setWindowOpenHandler = vi.fn()
  readonly id = 42
  isDestroyed(): boolean {
    return false
  }
}

class FakeTouchWindow extends EventEmitter {
  readonly webContents = new FakeWebContents()
  readonly loadURL = vi.fn(async () => undefined)
  readonly loadFile = vi.fn(async () => undefined)
  readonly focus = vi.fn()
  readonly setBounds = vi.fn()
  readonly setFullScreen = vi.fn()
  readonly id = 3
  isDestroyed(): boolean {
    return false
  }
}

beforeEach(() => {
  vi.unstubAllEnvs()
  electronMocks.getAllDisplays.mockReturnValue([display])
  electronMocks.getPrimaryDisplay.mockReturnValue(display)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('touch-panel navigation guard — packaged build (audit P0-11 follow-up)', () => {
  it('allows the window to stay on its own bundled document', () => {
    expect(isAllowedTouchPanelNavigation(OWN_DOCUMENT)).toBe(true)
  })

  it('allows an in-page navigation that only changes the panel query', () => {
    expect(isAllowedTouchPanelNavigation(`${OWN_DOCUMENT}?panel=pit`)).toBe(true)
    expect(isAllowedTouchPanelNavigation(`${OWN_DOCUMENT}?panel=race#top`)).toBe(true)
  })

  it.each([
    ['a downloaded page in the user profile', 'file:///C:/Users/driver/Downloads/evil.html'],
    ['any other document on the volume', 'file:///C:/Windows/Temp/payload.html'],
    ['a sibling renderer document', pathToFileURL(join(__dirname, '../renderer/index.html')).href],
    ['a Windows UNC path, i.e. a REMOTE document', 'file://attacker.invalid/share/evil.html'],
    ['a path that merely starts with the right prefix', `${OWN_DOCUMENT}.evil.html`],
    ['a remote https origin', 'https://renderer.attacker-controlled.invalid/panel.html'],
    ['a remote http origin', 'http://192.168.1.66:8080/panel.html'],
    ['a data URL', 'data:text/html,<script>1</script>'],
    ['a malformed URL', 'not a url']
  ])('refuses %s', (_label, url) => {
    expect(isAllowedTouchPanelNavigation(url)).toBe(false)
  })

  it('refuses every hostile candidate that the old startsWith test would have allowed', () => {
    // Exactly the inputs `url.startsWith('file://')` returned true for.
    const admittedByThePrefixTest = [
      'file:///C:/Users/driver/Downloads/evil.html',
      'file:///etc/passwd',
      'file://attacker.invalid/share/evil.html',
      `${OWN_DOCUMENT}.evil.html`
    ]
    for (const url of admittedByThePrefixTest) {
      expect(url.startsWith('file://')).toBe(true)
      expect(isAllowedTouchPanelNavigation(url)).toBe(false)
    }
  })
})

describe('touch-panel navigation guard — dev server (audit P0-11 follow-up)', () => {
  it('allows any document on the dev-server origin', () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://127.0.0.1:5174/')

    expect(isAllowedTouchPanelNavigation('http://127.0.0.1:5174/touchpanel.html?panel=pit')).toBe(true)
    expect(isAllowedTouchPanelNavigation('http://127.0.0.1:5174/@vite/client')).toBe(true)
  })

  it('refuses a different origin while the dev server is configured', () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://127.0.0.1:5174/')

    expect(isAllowedTouchPanelNavigation('http://127.0.0.1:9999/evil.html')).toBe(false)
    expect(isAllowedTouchPanelNavigation('https://renderer.attacker-controlled.invalid/')).toBe(false)
    expect(isAllowedTouchPanelNavigation('file:///C:/Users/driver/Downloads/evil.html')).toBe(false)
  })
})

// The predicate above is only worth anything if the window actually uses it, so
// this drives the REAL openWindow path and emits on the REAL 'will-navigate'
// listener the manager registered.
describe('touch-panel window wires the guard to will-navigate (audit P0-11 follow-up)', () => {
  async function openRealWindow(): Promise<FakeTouchWindow> {
    const win = new FakeTouchWindow()
    electronMocks.createBrowserWindow.mockReturnValue(win)

    const manager = new TouchPanelManager({
      app: { getPath: () => join(process.cwd(), 'touchpanel-nav-test-store') },
      broadcast: () => undefined
    } as unknown as ModuleContext)

    const panel = createButtonBoxPanel({ id: 'pit', name: 'Pit' })
    ;(manager as unknown as { panels: Map<string, unknown>; loaded: boolean }).panels = new Map([['pit', panel]])
    ;(manager as unknown as { loaded: boolean }).loaded = true

    expect(manager.openWindow({ panelId: 'pit' })).not.toBeNull()
    return win
  }

  function navigate(win: FakeTouchWindow, url: string): boolean {
    let prevented = false
    win.webContents.emit('will-navigate', { preventDefault: () => (prevented = true) }, url)
    return prevented
  }

  it('blocks a hostile file:// navigation on the live window', async () => {
    const win = await openRealWindow()

    expect(navigate(win, 'file:///C:/Users/driver/Downloads/evil.html')).toBe(true)
    expect(navigate(win, 'file://attacker.invalid/share/evil.html')).toBe(true)
    expect(navigate(win, 'https://renderer.attacker-controlled.invalid/')).toBe(true)
  })

  it('still permits the legitimate panel document on the live window', async () => {
    const win = await openRealWindow()

    expect(navigate(win, OWN_DOCUMENT)).toBe(false)
    expect(navigate(win, `${OWN_DOCUMENT}?panel=pit`)).toBe(false)
  })
})
