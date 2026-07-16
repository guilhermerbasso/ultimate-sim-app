import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Dashboard, DashboardElement, DashboardPlaylistItem } from '../../shared/dashboards'
import { BUILTIN_PRESETS, DASHBOARD_ELEMENT_TYPES, dashboardStorageValidationResult } from '../../shared/dashboards'
import { buttonPanelPlaylistItem } from '../../shared/touch-panel'
import type { ModuleContext } from '../module-context'
import {
  DashboardManager,
  openablePlaylistItems,
  resolveCycleStep,
  sameCockpitTarget,
  touchPanelIdOf
} from './manager'

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
  dialog: {},
  screen: {
    on: vi.fn(),
    off: vi.fn(),
    getAllDisplays: electronMocks.getAllDisplays,
    getPrimaryDisplay: electronMocks.getPrimaryDisplay
  },
  shell: { openExternal: vi.fn() }
}))

vi.mock('../modules/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn() }
}))

const primaryDisplay = {
  id: 1,
  label: 'Primary',
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1040 },
  scaleFactor: 1
}

const secondaryDisplay = {
  id: 2,
  label: 'Secondary',
  bounds: { x: 1920, y: 0, width: 1280, height: 720 },
  workArea: { x: 1920, y: 0, width: 1280, height: 680 },
  scaleFactor: 1
}

beforeEach(() => {
  electronMocks.createBrowserWindow.mockReset()
  electronMocks.getAllDisplays.mockReset()
  electronMocks.getPrimaryDisplay.mockReset()
  electronMocks.getAllDisplays.mockReturnValue([primaryDisplay, secondaryDisplay])
  electronMocks.getPrimaryDisplay.mockReturnValue(primaryDisplay)
  vi.stubEnv('ELECTRON_RENDERER_URL', 'http://127.0.0.1:5174/')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

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
  readonly loadURL = vi.fn((_url: string) => this.loadPromise)
  readonly loadFile = vi.fn((_path: string, _options?: unknown) => this.loadPromise)
  readonly show = vi.fn(() => {
    this.shown = true
  })
  readonly hide = vi.fn(() => {
    this.shown = false
  })
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
  shown = false
  private resolveLoad!: () => void
  private rejectLoad!: (error: Error) => void
  private readonly loadPromise: Promise<void>

  constructor(readonly options: Record<string, unknown> = {}) {
    super()
    this.loadPromise = new Promise<void>((resolve, reject) => {
      this.resolveLoad = resolve
      this.rejectLoad = reject
    })
  }

  isDestroyed(): boolean {
    return this.destroyed
  }

  getBounds(): { x: number; y: number; width: number; height: number } {
    return {
      x: Number(this.options.x ?? 0),
      y: Number(this.options.y ?? 0),
      width: Number(this.options.width ?? 1),
      height: Number(this.options.height ?? 1)
    }
  }

  finishLoad(): void {
    this.webContents.emit('did-finish-load')
    this.resolveLoad()
  }

  failLoad(description = 'ERR_FAILED'): void {
    const error = new Error(description)
    this.webContents.emit('did-fail-load', {}, -2, description, 'dashboard.html', true)
    this.rejectLoad(error)
  }

  crash(reason = 'crashed'): void {
    this.webContents.emit('render-process-gone', {}, { reason })
  }

}

// Regression coverage for the "touch panels dead in the playlist" blocker. The
// pure routing helpers below are what the DashboardManager uses to keep + route
// touch-panel items instead of filtering them out against the dashboard store.

const dash = (id: string): DashboardPlaylistItem => ({ dashboardId: id })
const panel = (id: string): DashboardPlaylistItem => buttonPanelPlaylistItem(id)

describe('touchPanelIdOf', () => {
  it('prefers touchPanelId, falling back to dashboardId', () => {
    expect(touchPanelIdOf({ dashboardId: 'p1', touchPanelId: 'p1', kind: 'touch-panel' })).toBe('p1')
    expect(touchPanelIdOf({ dashboardId: 'p2', kind: 'touch-panel' })).toBe('p2')
  })
})

describe('openablePlaylistItems', () => {
  const items = [dash('d1'), panel('p1'), dash('missing'), panel('gone')]
  const hasDashboard = (id: string): boolean => id === 'd1'
  const hasTouchPanel = (id: string): boolean => id === 'p1'

  it('keeps dashboards that exist AND touch panels that exist', () => {
    const kept = openablePlaylistItems(items, hasDashboard, hasTouchPanel)
    expect(kept.map((i) => i.dashboardId)).toEqual(['d1', 'p1'])
  })

  it('does NOT drop a touch panel just because it is not a known dashboard', () => {
    // The bug: filtering every item against the dashboard store removed panels.
    const kept = openablePlaylistItems([panel('p1')], () => false, hasTouchPanel)
    expect(kept).toHaveLength(1)
    expect(kept[0].kind).toBe('touch-panel')
  })

  it('drops touch panels whose panel id no longer exists', () => {
    const kept = openablePlaylistItems([panel('gone')], hasDashboard, () => false)
    expect(kept).toHaveLength(0)
  })
})

describe('sameCockpitTarget', () => {
  it('treats any two touch panels as the same (single reused window)', () => {
    expect(sameCockpitTarget(panel('a'), panel('b'))).toBe(true)
  })
  it('treats same dashboard id as same, different ids as different', () => {
    expect(sameCockpitTarget(dash('d1'), dash('d1'))).toBe(true)
    expect(sameCockpitTarget(dash('d1'), dash('d2'))).toBe(false)
  })
  it('treats a dashboard and a touch panel as different', () => {
    expect(sameCockpitTarget(dash('d1'), panel('p1'))).toBe(false)
  })
})

describe('resolveCycleStep', () => {
  const items = [dash('d1'), panel('p1'), dash('d2')]

  it('opens the first item when nothing is open', () => {
    const step = resolveCycleStep(items, -1, () => false, 'next')
    expect(step).not.toBeNull()
    expect(step!.current).toBeNull()
    expect(step!.nextIndex).toBe(0)
    expect(step!.next).toEqual(items[0])
  })

  it('advances to the next item — including a touch panel — and reports the one to close', () => {
    const step = resolveCycleStep(items, 0, (i) => i.dashboardId === 'd1', 'next')
    expect(step!.currentIndex).toBe(0)
    expect(step!.current).toEqual(dash('d1'))
    expect(step!.nextIndex).toBe(1)
    expect(step!.next.kind).toBe('touch-panel')
    expect(touchPanelIdOf(step!.next)).toBe('p1')
  })

  it('routes forward FROM an open touch panel to the following dashboard', () => {
    const step = resolveCycleStep(items, 1, (i) => i.kind === 'touch-panel', 'next')
    expect(step!.current!.kind).toBe('touch-panel')
    expect(step!.nextIndex).toBe(2)
    expect(step!.next).toEqual(dash('d2'))
  })

  it('wraps around with prev', () => {
    const step = resolveCycleStep(items, 0, (i) => i.dashboardId === 'd1', 'prev')
    expect(step!.nextIndex).toBe(2)
    expect(step!.next).toEqual(dash('d2'))
  })

  it('recovers the index when the tracked item is no longer open', () => {
    // currentIndex points at d1 but the actually-open item is the touch panel.
    const step = resolveCycleStep(items, 0, (i) => i.kind === 'touch-panel', 'next')
    expect(step!.currentIndex).toBe(1)
    expect(step!.nextIndex).toBe(2)
  })

  it('returns null for an empty playlist', () => {
    expect(resolveCycleStep([], -1, () => false, 'next')).toBeNull()
  })
})

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown

interface DashboardManagerInternals {
  dashboards: Map<string, Dashboard>
  windows: Map<string, { window: unknown }>
  registerScreenListeners(): void
}

function managerInternals(manager: DashboardManager): DashboardManagerInternals {
  return manager as unknown as DashboardManagerInternals
}

function makeHeadlessManager(
  userData: string,
  handlers = new Map<string, IpcHandler>(),
  broadcast: (channel: string, payload: unknown) => void = () => {}
): DashboardManager {
  const manager = new DashboardManager({
    app: { getPath: () => userData },
    ipcMain: {
      handle: (channel: string, handler: IpcHandler) => {
        handlers.set(channel, handler)
      }
    },
    broadcast,
    telemetryHub: { getLatest: () => null },
    getMainWindow: () => null
  } as unknown as ModuleContext)
  managerInternals(manager).registerScreenListeners = () => {}
  return manager
}

function raceTrafficAttack(): Dashboard {
  const preset = BUILTIN_PRESETS.find((candidate) => candidate.id === 'gt3_dense50_race_traffic_attack')
  if (!preset) throw new Error('Race Traffic Attack preset is missing')
  return preset.build()
}

function persistDashboard(userData: string, dashboard: Dashboard): { path: string; raw: string } {
  const store = join(userData, 'dashboards')
  mkdirSync(store, { recursive: true })
  const path = join(store, `${dashboard.id}.json`)
  const raw = JSON.stringify(dashboard, null, 2)
  writeFileSync(path, raw, 'utf8')
  return { path, raw }
}

function persistRawDashboard(userData: string, file: string, value: unknown): { path: string; raw: string } {
  const store = join(userData, 'dashboards')
  mkdirSync(store, { recursive: true })
  const path = join(store, file)
  const raw = JSON.stringify(value, null, 2)
  writeFileSync(path, raw, 'utf8')
  return { path, raw }
}

describe('DashboardManager restart restoration', () => {
  let userData: string

  beforeEach(() => {
    userData = mkdtempSync(join(process.cwd(), 'dashboard-restart-test-'))
  })

  afterEach(() => {
    rmSync(userData, { recursive: true, force: true })
  })

  it('restores Race Traffic Attack overlay widgets without rewriting persisted data', async () => {
    const dashboard = raceTrafficAttack()
    const stored = persistDashboard(userData, dashboard)
    const manager = makeHeadlessManager(userData)

    const firstLoad = manager.load()
    expect(manager.load()).toBe(firstLoad)
    await firstLoad

    const restored = manager.getDashboard(dashboard.id)
    expect(restored?.elements).toHaveLength(18)
    expect(restored?.elements.map((element) => ({
      type: element.type,
      widgetId: element.widgetId,
      hifiModuleId: element.hifiModuleId
    }))).toEqual(dashboard.elements.map((element) => ({
      type: element.type,
      widgetId: element.widgetId,
      hifiModuleId: element.hifiModuleId
    })))
    expect(readFileSync(stored.path, 'utf8')).toBe(stored.raw)

    const restarted = makeHeadlessManager(userData)
    await restarted.load()
    expect(restarted.getDashboard(dashboard.id)?.elements).toHaveLength(18)
  })

  it('accepts every element type from the shared dashboard schema after a JSON restart', async () => {
    const dashboard: Dashboard = {
      id: 'all-shared-element-types',
      name: 'All shared element types',
      width: 1024,
      height: 600,
      bg: '#000',
      elements: DASHBOARD_ELEMENT_TYPES.map((type, index): DashboardElement => ({
        id: `element-${index}`,
        type,
        x: index,
        y: 0,
        w: 1,
        h: 1,
        style: {},
        ...(type === 'overlaywidget'
          ? { widgetId: 'hifi:speedGear', hifiModuleId: 'speedGear' }
          : {})
      }))
    }
    persistDashboard(userData, dashboard)

    const manager = makeHeadlessManager(userData)
    await manager.load()

    expect(manager.getDashboard(dashboard.id)?.elements.map((element) => element.type))
      .toEqual([...DASHBOARD_ELEMENT_TYPES])
  })

  it('validates every builtin before seeding an empty dashboard store', () => {
    for (const preset of BUILTIN_PRESETS) {
      const result = dashboardStorageValidationResult(preset.build())
      expect(result.status, preset.id).not.toBe('quarantine')
    }
  })

  it('quarantines malformed overlay, table, and element-list payloads without changing their bytes', async () => {
    const valid = raceTrafficAttack()
    const validStored = persistDashboard(userData, valid)

    const invalidOverlay = structuredClone(valid)
    invalidOverlay.id = 'invalid-overlay'
    ;(invalidOverlay.elements[0] as unknown as Record<string, unknown>).widgetId = 42
    const overlayStored = persistRawDashboard(userData, 'invalid-overlay.json', invalidOverlay)

    const invalidTable: Dashboard = {
      id: 'invalid-table',
      name: 'Invalid table',
      width: 1024,
      height: 600,
      bg: '#000',
      elements: [{
        id: 'table',
        type: 'table',
        x: 0,
        y: 0,
        w: 400,
        h: 300,
        style: {}
      }]
    }
    ;(invalidTable.elements[0].style as Record<string, unknown>).tableColumns = 'pos'
    const tableStored = persistRawDashboard(userData, 'invalid-table.json', invalidTable)

    const invalidElements = {
      id: 'invalid-elements',
      name: 'Invalid elements',
      width: 1024,
      height: 600,
      bg: '#000',
      elements: {}
    }
    const elementsStored = persistRawDashboard(userData, 'invalid-elements.json', invalidElements)

    const handlers = new Map<string, IpcHandler>()
    const manager = makeHeadlessManager(userData, handlers)
    manager.registerIpc()
    await manager.load()

    expect(manager.getDashboard(valid.id)?.elements).toHaveLength(18)
    expect(readFileSync(validStored.path, 'utf8')).toBe(validStored.raw)
    expect(manager.getDashboard('invalid-overlay')).toBeNull()
    expect(manager.getDashboard('invalid-table')).toBeNull()
    expect(manager.getDashboard('invalid-elements')).toBeNull()

    const issues = manager.listStorageIssues()
    expect(issues).toHaveLength(3)
    const storageIssuesHandler = handlers.get('app:dash:storageIssues')
    expect(storageIssuesHandler).toBeDefined()
    expect(await storageIssuesHandler!({})).toEqual(issues)
    expect(readdirSync(join(userData, 'dashboards', '.dashboard-quarantine'))).toHaveLength(3)
    expect(issues.find((issue) => issue.file === 'invalid-overlay.json')?.error).toMatch(/widgetId/)
    expect(issues.find((issue) => issue.file === 'invalid-table.json')?.error).toMatch(/tableColumns/)
    expect(issues.find((issue) => issue.file === 'invalid-elements.json')?.error).toMatch(/elements must be an array/)

    for (const [stored, file] of [
      [overlayStored, 'invalid-overlay.json'],
      [tableStored, 'invalid-table.json'],
      [elementsStored, 'invalid-elements.json']
    ] as const) {
      expect(existsSync(stored.path)).toBe(false)
      const issue = issues.find((candidate) => candidate.file === file)
      expect(issue).toBeDefined()
      expect(readFileSync(join(userData, 'dashboards', '.dashboard-quarantine', issue!.quarantinedFile), 'utf8'))
        .toBe(stored.raw)
    }
  })

  it('applies canonical legacy migrations in memory without rewriting persisted bytes', async () => {
    const legacy: Dashboard = {
      id: 'legacy-table',
      name: 'Legacy table',
      width: 1024,
      height: 600,
      bg: '#000',
      elements: [{
        id: 'table',
        type: 'table',
        x: 0,
        y: 0,
        w: 400,
        h: 300,
        style: {}
      }]
    }
    ;(legacy.elements[0].style as Record<string, unknown>).tableColumns = ['pos', 'last']
    const stored = persistDashboard(userData, legacy)

    const manager = makeHeadlessManager(userData)
    await manager.load()

    expect(manager.getDashboard(legacy.id)?.elements[0].style.tableColumns).toEqual(['pos', 'laps'])
    expect(readFileSync(stored.path, 'utf8')).toBe(stored.raw)
    expect(manager.listStorageIssues()).toEqual([])
  })

  it('waits for persisted dashboards to load before answering renderer bootstrap IPC', async () => {
    const handlers = new Map<string, IpcHandler>()
    const manager = makeHeadlessManager(userData, handlers)
    const dashboard = raceTrafficAttack()
    let releaseLoad!: () => void
    const loadGate = new Promise<void>((resolve) => {
      releaseLoad = resolve
    })
    manager.load = async () => {
      await loadGate
      managerInternals(manager).dashboards.set(dashboard.id, dashboard)
    }
    manager.registerIpc()

    const getDashboard = handlers.get('app:dash:get')
    if (!getDashboard) throw new Error('app:dash:get handler was not registered')
    let settled = false
    const pending = Promise.resolve(getDashboard({}, dashboard.id)).then((value) => {
      settled = true
      return value
    })

    await Promise.resolve()
    expect(settled).toBe(false)
    releaseLoad()
    expect(await pending).toEqual(dashboard)
  })
})

describe('DashboardManager window replacement lifecycle', () => {
  let userData: string
  let manager: DashboardManager
  let dashboard: Dashboard

  beforeEach(async () => {
    userData = mkdtempSync(join(process.cwd(), 'dashboard-window-test-'))
    dashboard = raceTrafficAttack()
    persistDashboard(userData, dashboard)
    manager = makeHeadlessManager(userData)
    await manager.load()
  })

  afterEach(() => {
    rmSync(userData, { recursive: true, force: true })
  })

  async function openOn(displayId: number): Promise<FakeDashboardWindow> {
    let window!: FakeDashboardWindow
    electronMocks.createBrowserWindow.mockImplementationOnce((options) => {
      window = new FakeDashboardWindow(options as Record<string, unknown>)
      return window
    })
    const opened = manager.openWindow(dashboard.id, { displayId, fullscreen: true })
    await vi.waitFor(() => expect(window).toBeDefined())
    expect(window.options.show).toBe(false)
    expect(window.shown).toBe(false)
    window.finishLoad()
    await opened
    return window
  }

  it('shows and registers a healthy replacement before closing the previous window', async () => {
    const previous = await openOn(primaryDisplay.id)
    let replacement!: FakeDashboardWindow
    electronMocks.createBrowserWindow.mockImplementationOnce((options) => {
      replacement = new FakeDashboardWindow(options as Record<string, unknown>)
      return replacement
    })

    const pending = manager.openWindow(dashboard.id, { displayId: secondaryDisplay.id, fullscreen: true })
    await vi.waitFor(() => expect(replacement).toBeDefined())
    expect(previous.close).not.toHaveBeenCalled()
    expect(replacement.show).not.toHaveBeenCalled()
    expect(managerInternals(manager).windows.get(dashboard.id)?.window).toBe(previous)
    replacement.show.mockImplementation(() => {
      expect(managerInternals(manager).windows.get(dashboard.id)?.window).toBe(replacement)
      replacement.shown = true
    })

    replacement.finishLoad()
    await pending

    expect(replacement.show).toHaveBeenCalledOnce()
    expect(previous.close).toHaveBeenCalledOnce()
    expect(replacement.show.mock.invocationCallOrder[0]).toBeLessThan(previous.close.mock.invocationCallOrder[0])
    expect(managerInternals(manager).windows.get(dashboard.id)?.window).toBe(replacement)
  })

  it('serializes overlapping replacements so no shown window becomes orphaned', async () => {
    const first = await openOn(primaryDisplay.id)
    let second!: FakeDashboardWindow
    let third!: FakeDashboardWindow
    electronMocks.createBrowserWindow
      .mockImplementationOnce((options) => {
        second = new FakeDashboardWindow(options as Record<string, unknown>)
        return second
      })
      .mockImplementationOnce((options) => {
        third = new FakeDashboardWindow(options as Record<string, unknown>)
        return third
      })

    const openSecond = manager.openWindow(dashboard.id, { displayId: secondaryDisplay.id, fullscreen: true })
    const openThird = manager.openWindow(dashboard.id, { displayId: primaryDisplay.id, fullscreen: true })
    await vi.waitFor(() => expect(second).toBeDefined())
    expect(third).toBeUndefined()

    second.finishLoad()
    await openSecond
    expect(first.close).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(third).toBeDefined())

    third.finishLoad()
    await openThird
    expect(second.close).toHaveBeenCalledOnce()
    expect(managerInternals(manager).windows.get(dashboard.id)?.window).toBe(third)
  })

  it('retains the healthy previous window when the replacement fails to load', async () => {
    const previous = await openOn(primaryDisplay.id)
    let replacement!: FakeDashboardWindow
    electronMocks.createBrowserWindow.mockImplementationOnce((options) => {
      replacement = new FakeDashboardWindow(options as Record<string, unknown>)
      return replacement
    })

    const pending = manager.openWindow(dashboard.id, { displayId: secondaryDisplay.id, fullscreen: true })
    await vi.waitFor(() => expect(replacement).toBeDefined())
    replacement.failLoad('ERR_FILE_NOT_FOUND')

    await expect(pending).rejects.toThrow(/failed to load/i)
    expect(previous.close).not.toHaveBeenCalled()
    expect(previous.shown).toBe(true)
    expect(replacement.show).not.toHaveBeenCalled()
    expect(replacement.close).toHaveBeenCalledOnce()
    expect(managerInternals(manager).windows.get(dashboard.id)?.window).toBe(previous)
    expect(manager.listOpen()).toEqual([{ id: dashboard.id, displayId: primaryDisplay.id, fullscreen: true }])
  })

  it('retains the healthy previous window when the replacement renderer exits during load', async () => {
    const previous = await openOn(primaryDisplay.id)
    let replacement!: FakeDashboardWindow
    electronMocks.createBrowserWindow.mockImplementationOnce((options) => {
      replacement = new FakeDashboardWindow(options as Record<string, unknown>)
      return replacement
    })

    const pending = manager.openWindow(dashboard.id, { displayId: secondaryDisplay.id, fullscreen: true })
    await vi.waitFor(() => expect(replacement).toBeDefined())
    replacement.crash('launch-failed')

    await expect(pending).rejects.toThrow(/exited before load completed/i)
    expect(previous.close).not.toHaveBeenCalled()
    expect(replacement.close).toHaveBeenCalledOnce()
    expect(managerInternals(manager).windows.get(dashboard.id)?.window).toBe(previous)
  })

  it('rolls back to the healthy window when the replacement crashes while being shown', async () => {
    const previous = await openOn(primaryDisplay.id)
    let replacement!: FakeDashboardWindow
    electronMocks.createBrowserWindow.mockImplementationOnce((options) => {
      replacement = new FakeDashboardWindow(options as Record<string, unknown>)
      replacement.show.mockImplementation(() => {
        replacement.shown = true
        replacement.crash('show-crash')
      })
      return replacement
    })

    const pending = manager.openWindow(dashboard.id, { displayId: secondaryDisplay.id, fullscreen: true })
    await vi.waitFor(() => expect(replacement).toBeDefined())
    replacement.finishLoad()

    await expect(pending).rejects.toThrow(/exited while.*shown/i)
    expect(previous.close).not.toHaveBeenCalled()
    expect(replacement.close).toHaveBeenCalledOnce()
    expect(managerInternals(manager).windows.get(dashboard.id)?.window).toBe(previous)
    expect(manager.listOpen()).toEqual([{ id: dashboard.id, displayId: primaryDisplay.id, fullscreen: true }])
  })

  it('marks a crashed renderer dead and replaces it even when reopening with the same options', async () => {
    const crashed = await openOn(primaryDisplay.id)
    crashed.crash()

    expect(crashed.hide).toHaveBeenCalledOnce()
    expect(manager.listOpen()).toEqual([])

    let replacement!: FakeDashboardWindow
    electronMocks.createBrowserWindow.mockImplementationOnce((options) => {
      replacement = new FakeDashboardWindow(options as Record<string, unknown>)
      return replacement
    })
    const pending = manager.openWindow(dashboard.id, { displayId: primaryDisplay.id, fullscreen: true })
    await vi.waitFor(() => expect(replacement).toBeDefined())
    replacement.finishLoad()
    await pending

    expect(crashed.focus).toHaveBeenCalledOnce()
    expect(crashed.close).toHaveBeenCalledOnce()
    expect(replacement.show).toHaveBeenCalledOnce()
    expect(managerInternals(manager).windows.get(dashboard.id)?.window).toBe(replacement)
  })

  it('does not send a captured dashboard seed after a save completes during renderer load', async () => {
    const broadcast = vi.fn()
    manager = makeHeadlessManager(userData, new Map(), broadcast)
    await manager.load()
    let window!: FakeDashboardWindow
    electronMocks.createBrowserWindow.mockImplementationOnce((options) => {
      window = new FakeDashboardWindow(options as Record<string, unknown>)
      return window
    })

    const pending = manager.openWindow(dashboard.id, { displayId: primaryDisplay.id, fullscreen: true })
    await vi.waitFor(() => expect(window).toBeDefined())
    const saved = { ...dashboard, name: 'Saved while loading' }
    await manager.save(saved)
    window.finishLoad()
    await pending

    expect(manager.getDashboard(dashboard.id)?.name).toBe('Saved while loading')
    expect(broadcast).toHaveBeenCalledWith('app:dash:updated', expect.objectContaining({ name: 'Saved while loading' }))
    expect(window.webContents.send).not.toHaveBeenCalled()
  })
})
