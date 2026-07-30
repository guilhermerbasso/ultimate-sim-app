// Regression coverage for audit P1-06 / §24-4: switching the cockpit to a touch panel
// used to close every dashboard window BEFORE confirming the panel opened. When the open
// failed the driver was left staring at nothing, with no rollback — the cockpit was gone
// and the only signal was a thrown error or a null return.
//
// These tests drive `activate()` and `cycle()` through a touch bridge whose `openWindow`
// fails, and assert the previous cockpit is still up afterwards.

import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModuleContext } from '../module-context'
import type { Dashboard } from '../../shared/dashboards'

const electronMocks = vi.hoisted(() => ({
  createBrowserWindow: vi.fn(),
  getAllDisplays: vi.fn(),
  getPrimaryDisplay: vi.fn()
}))

const touchMocks = vi.hoisted(() => ({
  getTouchPanelManager: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: class {
    constructor(options: unknown) {
      return electronMocks.createBrowserWindow(options) as object
    }
  },
  dialog: {},
  screen: {
    on: vi.fn(),
    off: vi.fn(),
    getAllDisplays: electronMocks.getAllDisplays,
    getPrimaryDisplay: electronMocks.getPrimaryDisplay
  },
  shell: { openExternal: vi.fn() }
}))

vi.mock('../touchpanel/manager', () => ({
  getTouchPanelManager: touchMocks.getTouchPanelManager
}))

vi.mock('../modules/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

const { DashboardManager } = await import('./manager')
type DashboardManagerType = InstanceType<typeof DashboardManager>

const primaryDisplay = {
  id: 1,
  label: 'Primary',
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1040 },
  scaleFactor: 1
}

class FakeWebContents extends EventEmitter {
  destroyed = false
  readonly send = vi.fn()
  readonly setWindowOpenHandler = vi.fn()
  isDestroyed(): boolean {
    return this.destroyed
  }
}

class FakeDashboardWindow extends EventEmitter {
  readonly webContents = new FakeWebContents()
  readonly loadURL = vi.fn(() => Promise.resolve())
  readonly loadFile = vi.fn(() => Promise.resolve())
  readonly show = vi.fn()
  readonly hide = vi.fn()
  readonly focus = vi.fn()
  readonly setFullScreen = vi.fn()
  readonly setBounds = vi.fn()
  readonly close = vi.fn(() => {
    if (this.destroyed) return
    this.destroyed = true
    this.webContents.destroyed = true
    this.emit('closed')
  })
  destroyed = false

  constructor(readonly options: Record<string, unknown> = {}) {
    super()
    queueMicrotask(() => this.webContents.emit('did-finish-load'))
  }

  isDestroyed(): boolean {
    return this.destroyed
  }

  getBounds(): { x: number; y: number; width: number; height: number } {
    return { x: 0, y: 0, width: 1920, height: 1080 }
  }
}

interface TouchBridge {
  openWindow: ReturnType<typeof vi.fn>
  closeWindow: ReturnType<typeof vi.fn>
  currentOpenPanelId: () => string | null
  has: (id: string) => boolean
  list: () => Array<{ id: string }>
}

let userData: string
let touch: TouchBridge

function dashboard(id: string): Dashboard {
  return {
    id,
    name: id,
    width: 1024,
    height: 600,
    bg: '#000',
    elements: [{ id: `${id}-el`, type: 'gauge', x: 0, y: 0, w: 10, h: 10, style: {} }]
  }
}

function makeManager(): DashboardManagerType {
  const manager = new DashboardManager({
    app: { getPath: () => userData },
    ipcMain: { handle: () => {} },
    broadcast: () => {},
    telemetryHub: { getLatest: () => null },
    getMainWindow: () => null
  } as unknown as ModuleContext)
  ;(manager as unknown as { registerScreenListeners: () => void }).registerScreenListeners = () => {}
  return manager
}

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'dash-touch-lifecycle-'))
  electronMocks.createBrowserWindow.mockReset()
  electronMocks.createBrowserWindow.mockImplementation(
    (options: Record<string, unknown>) => new FakeDashboardWindow(options)
  )
  electronMocks.getAllDisplays.mockReturnValue([primaryDisplay])
  electronMocks.getPrimaryDisplay.mockReturnValue(primaryDisplay)
  vi.stubEnv('ELECTRON_RENDERER_URL', 'http://127.0.0.1:5174/')

  touch = {
    // Fails to open: the panel disappeared between resolving the target and opening it.
    openWindow: vi.fn(() => undefined),
    closeWindow: vi.fn(),
    currentOpenPanelId: () => null,
    has: (id: string) => id === 'panel-1',
    list: () => [{ id: 'panel-1' }]
  }
  touchMocks.getTouchPanelManager.mockReturnValue(touch)
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(userData, { recursive: true, force: true })
})

// Loading the manager seeds every built-in preset to disk, so these tests do real I/O.
describe('touch panel cockpit switch', { timeout: 30_000 }, () => {
  it('keeps the current dashboard open when the touch panel fails to open', async () => {
    const manager = makeManager()
    await manager.load()
    await manager.save(dashboard('cockpit-a'))
    await manager.openWindow('cockpit-a', { displayId: 1, fullscreen: true })
    expect(manager.listOpen().map((open) => open.id)).toEqual(['cockpit-a'])

    await expect(manager.activate('panel-1')).rejects.toThrow(/Touch panel/i)

    // The failed open must not have cost the driver the cockpit.
    expect(manager.listOpen().map((open) => open.id)).toEqual(['cockpit-a'])
    expect(touch.openWindow).toHaveBeenCalledTimes(1)
  })

  it('closes the dashboard only after the touch panel is confirmed open', async () => {
    const opened: string[] = []
    touch.openWindow = vi.fn((args: { panelId: string }) => {
      opened.push(args.panelId)
      return { displayId: 1, fullscreen: true }
    })
    const manager = makeManager()
    await manager.load()
    await manager.save(dashboard('cockpit-a'))
    await manager.openWindow('cockpit-a', { displayId: 1, fullscreen: true })

    const state = await manager.activate('panel-1')
    expect(state.id).toBe('panel-1')
    expect(opened).toEqual(['panel-1'])
    expect(manager.listOpen()).toEqual([])
  })

  it('keeps the current dashboard open when a playlist cycle to a touch panel fails', async () => {
    const manager = makeManager()
    await manager.load()
    await manager.save(dashboard('cockpit-a'))
    await manager.setPlaylist({
      items: [{ dashboardId: 'cockpit-a' }, { dashboardId: 'panel-1', touchPanelId: 'panel-1', kind: 'touch-panel' }],
      updatedAt: Date.now()
    })
    await manager.openWindow('cockpit-a', { displayId: 1, fullscreen: true })
    expect(manager.listOpen().map((open) => open.id)).toEqual(['cockpit-a'])

    await manager.cycle('next')

    expect(manager.listOpen().map((open) => open.id)).toEqual(['cockpit-a'])
  })
})
