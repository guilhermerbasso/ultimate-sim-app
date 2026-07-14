import { createHash } from 'node:crypto'
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, utimesSync, writeFileSync
} from 'node:fs'
import { link, mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BUILTIN_PRESETS, DASHBOARD_ELEMENT_TYPES, dashboardValidationError,
  dashboardIdRecord, dashboardStorageVersion, editorRefreshAction, editorVersionConflict,
  isDashboardElementType, observedDashboardMutationToken,
  type Dashboard, type DashboardPlaylist, type DashboardPlaylistItem, type DashboardPreset,
  type DashboardStorageValidationResult
} from '../../shared/dashboards'
import { ADAPTIVE_DASHBOARD_ID, createAdaptiveDashboardPreset } from '../../shared/dashboard-adaptive-preset'
import { buttonPanelPlaylistItem } from '../../shared/touch-panel'
import type { ModuleContext } from '../module-context'
const electron = vi.hoisted(() => ({ on: vi.fn(), off: vi.fn() }))
const loggerMocks = vi.hoisted(() => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn()
}))
const simhubMocks = vi.hoisted(() => ({
  importDash: vi.fn(),
  exportDash: vi.fn()
}))
interface SchemaAdapterMocks {
  calls: Array<{ input: unknown; output: DashboardStorageValidationResult }>
  mapOutput: ((input: unknown, output: DashboardStorageValidationResult) => DashboardStorageValidationResult) | null
}
const schemaAdapterMocks = vi.hoisted((): SchemaAdapterMocks => ({
  calls: [],
  mapOutput: null
}))
const storageLockMocks = vi.hoisted(() => ({
  onListen: null as ((address: unknown) => void) | null
}))
vi.mock('../../shared/dashboards', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/dashboards')>()
  return {
    ...actual,
    dashboardStorageValidationResult: (value: unknown) => {
      const output = actual.dashboardStorageValidationResult(value)
      schemaAdapterMocks.calls.push({ input: value, output })
      return schemaAdapterMocks.mapOutput?.(value, output) ?? output
    }
  }
})
vi.mock('node:net', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:net')>()
  return {
    ...actual,
    createServer: (...args: unknown[]) => {
      const server = Reflect.apply(actual.createServer, undefined, args) as ReturnType<typeof actual.createServer>
      const listen = server.listen
      server.listen = function (
        this: ReturnType<typeof actual.createServer>,
        ...listenArgs: unknown[]
      ) {
        storageLockMocks.onListen?.(listenArgs[0])
        return Reflect.apply(listen, this, listenArgs)
      } as typeof server.listen
      return server
    }
  }
})
vi.mock('electron', () => ({
  BrowserWindow: vi.fn(), dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  screen: { on: electron.on, off: electron.off, getAllDisplays: () => [], getPrimaryDisplay: () => ({
    id: 1, label: 'Primary', bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 0, width: 1920, height: 1040 }, scaleFactor: 1
  }) }, shell: { openExternal: vi.fn() }
}))
vi.mock('../touchpanel/manager', () => ({ getTouchPanelManager: () => null }))
vi.mock('../modules/logger', () => ({ logger: loggerMocks }))
vi.mock('./simhubdash', () => ({
  importSimhubDash: simhubMocks.importDash,
  exportSimhubDash: simhubMocks.exportDash
}))
import {
  DashboardManager, dashboardFileNameForId, openablePlaylistItems, resolveCycleStep,
  sameCockpitTarget, touchPanelIdOf, type DashboardStorageFs
} from './manager'
const item = (id: string): DashboardPlaylistItem => ({ dashboardId: id })
const panel = (id: string): DashboardPlaylistItem => buttonPanelPlaylistItem(id)
const dashboard = (id: string, name = id): Dashboard => ({
  id, name, width: 100.5, height: 60.5, bg: '#05070a',
  elements: [{ id: 'fractional', type: 'text', x: 1.25, y: 2.5, w: 10.75, h: 8.25, style: { text: '42' } }],
  createdAt: 10, updatedAt: 20
})
type Handler = (...args: unknown[]) => unknown
function setup(root: string, options: { fs?: Partial<DashboardStorageFs>; presets?: readonly DashboardPreset[] } = {}) {
  const handlers = new Map<string, Handler>()
  const broadcast = vi.fn()
  const ctx = {
    app: { getPath: () => root }, ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
    getMainWindow: () => null, broadcast, telemetryHub: { getLatest: () => null }
  } as unknown as ModuleContext
  return { manager: new DashboardManager(ctx, { storeDir: root, presets: options.presets ?? [], fs: options.fs }), handlers, broadcast }
}
const prettyJson = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`
const writeDash = (root: string, file: string, value: Dashboard): void =>
  writeFileSync(join(root, file), prettyJson(value))
function filesBelow(root: string): string[] {
  const files: string[] = []
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) visit(path)
      else files.push(path)
    }
  }
  visit(root)
  return files
}
function storedDashboardPaths(root: string, id: string, name?: string): string[] {
  return filesBelow(root).filter((path) => {
    try {
      const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<Dashboard>
      return value.id === id && Array.isArray(value.elements) && (name === undefined || value.name === name)
    } catch {
      return false
    }
  })
}
function storedPlaylistPaths(root: string): string[] {
  return filesBelow(root).filter((path) => {
    try {
      const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<DashboardPlaylist>
      return Array.isArray(value.items) && typeof value.updatedAt === 'number'
    } catch {
      return false
    }
  })
}
function snapshotDashboard(snapshot: { files: Record<string, unknown> }, id: string): Dashboard | undefined {
  return Object.values(snapshot.files).find((value): value is Dashboard =>
    Boolean(value && typeof value === 'object' && (value as Partial<Dashboard>).id === id &&
      Array.isArray((value as Partial<Dashboard>).elements)))
}
interface ManifestDocument {
  path: string
  raw: string
  value: {
    version: number
    sequence: number
    generation: string
    dashboards: Record<string, {
      file: string
      exportName: string
      hash: string
      generation: string
      sizeBytes: number
    }>
    playlist: {
      file: string
      exportName: string
      hash: string
      generation: string
      sizeBytes: number
    }
    tombstones: Record<string, string>
  }
}
interface ImmutableManifestDocument extends ManifestDocument {
  addressHash: string
  fileNameSequence: number
}
interface CommitMarkerDocument {
  path: string
  raw: string
  markerHash: string
  fileNameSequence: number
  value: {
    version: 1
    sequence: number
    manifestHash: string
    parentMarkerHash: string | null
  }
}
const MANIFEST_OBJECT_NAME = /^m\.(0|[1-9]\d*)\.([A-Za-z0-9_-]{43})\.json$/
const COMMIT_MARKER_NAME = /^c\.(0|[1-9]\d*)\.([A-Za-z0-9_-]{43})\.json$/
const COMMIT_MARKER_TEMP_NAME = /^\.tmp-commit-marker-[A-Za-z0-9_-]+(?:\.json)?$/
function manifestDocuments(root: string): ManifestDocument[] {
  return filesBelow(root).flatMap((path) => {
    try {
      const raw = readFileSync(path, 'utf8')
      const value = JSON.parse(raw) as ManifestDocument['value']
      if (value.version !== 1 || !Number.isInteger(value.sequence) || typeof value.generation !== 'string' ||
        !value.dashboards || typeof value.dashboards !== 'object' ||
        !value.playlist || typeof value.playlist !== 'object' ||
        !value.tombstones || typeof value.tombstones !== 'object') return []
      return [{ path, raw, value }]
    } catch {
      return []
    }
  })
}
function immutableManifestDocuments(root: string): ImmutableManifestDocument[] {
  const objectDir = join(root, '.dashboard-manifests')
  if (!existsSync(objectDir)) return []
  return readdirSync(objectDir, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isFile()) return []
    const match = MANIFEST_OBJECT_NAME.exec(entry.name)
    if (!match) return []
    const path = join(objectDir, entry.name)
    try {
      const raw = readFileSync(path, 'utf8')
      const value = JSON.parse(raw) as ManifestDocument['value']
      if (value.version !== 1 || !Number.isInteger(value.sequence) || typeof value.generation !== 'string' ||
        !value.dashboards || typeof value.dashboards !== 'object' ||
        !value.playlist || typeof value.playlist !== 'object' ||
        !value.tombstones || typeof value.tombstones !== 'object') return []
      return [{
        path,
        raw,
        value,
        fileNameSequence: Number(match[1]),
        addressHash: match[2]
      }]
    } catch {
      return []
    }
  })
}
function highestManifestDocument(root: string): ManifestDocument {
  const [latest] = manifestDocuments(root).sort((a, b) => b.value.sequence - a.value.sequence)
  if (!latest) throw new Error('No complete dashboard storage manifest was found.')
  return latest
}
function highestImmutableManifestDocument(root: string): ImmutableManifestDocument {
  const [latest] = immutableManifestDocuments(root).sort((a, b) => b.value.sequence - a.value.sequence)
  if (!latest) throw new Error('No canonical immutable dashboard manifest object was found.')
  return latest
}
function commitMarkerDocuments(root: string): CommitMarkerDocument[] {
  const objectDir = join(root, '.dashboard-manifests')
  if (!existsSync(objectDir)) return []
  return readdirSync(objectDir, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isFile()) return []
    const match = COMMIT_MARKER_NAME.exec(entry.name)
    if (!match) return []
    const path = join(objectDir, entry.name)
    try {
      const raw = readFileSync(path, 'utf8')
      const value = JSON.parse(raw) as CommitMarkerDocument['value']
      if (value.version !== 1 || !Number.isSafeInteger(value.sequence) || value.sequence < 1 ||
        typeof value.manifestHash !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.manifestHash) ||
        (value.parentMarkerHash !== null &&
          (typeof value.parentMarkerHash !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.parentMarkerHash))) ||
        Number(match[1]) !== value.sequence || match[2] !== exactTestHash(raw)) return []
      return [{
        path,
        raw,
        value,
        markerHash: match[2],
        fileNameSequence: Number(match[1])
      }]
    } catch {
      return []
    }
  })
}
function highestCommitMarkerDocument(root: string): CommitMarkerDocument {
  const [latest] = commitMarkerDocuments(root).sort((a, b) => b.value.sequence - a.value.sequence)
  if (!latest) throw new Error('No canonical dashboard commit marker was found.')
  return latest
}
function exactTestHash(raw: string): string {
  return createHash('sha256').update(Buffer.from(raw, 'utf8')).digest('base64url')
}
function writeManifestObject(root: string, value: ManifestDocument['value']): ImmutableManifestDocument {
  const raw = prettyJson(value)
  const addressHash = exactTestHash(raw)
  const objectDir = join(root, '.dashboard-manifests')
  mkdirSync(objectDir, { recursive: true })
  const path = join(objectDir, `m.${value.sequence}.${addressHash}.json`)
  writeFileSync(path, raw)
  return { path, raw, value, fileNameSequence: value.sequence, addressHash }
}
function writeCommitMarker(
  root: string,
  value: CommitMarkerDocument['value']
): CommitMarkerDocument {
  const raw = prettyJson(value)
  const markerHash = exactTestHash(raw)
  const objectDir = join(root, '.dashboard-manifests')
  mkdirSync(objectDir, { recursive: true })
  const path = join(objectDir, `c.${value.sequence}.${markerHash}.json`)
  writeFileSync(path, raw)
  return { path, raw, value, markerHash, fileNameSequence: value.sequence }
}
function ensureCommitMarkerChain(root: string): CommitMarkerDocument[] {
  const objects = immutableManifestDocuments(root)
    .sort((a, b) => a.value.sequence - b.value.sequence)
  const markers: CommitMarkerDocument[] = []
  let parentMarkerHash: string | null = null
  for (const object of objects) {
    const existing = commitMarkerDocuments(root).find((marker) =>
      marker.value.sequence === object.value.sequence &&
      marker.value.manifestHash === object.addressHash &&
      marker.value.parentMarkerHash === parentMarkerHash)
    const marker: CommitMarkerDocument = existing ?? writeCommitMarker(root, {
      version: 1,
      sequence: object.value.sequence,
      manifestHash: object.addressHash,
      parentMarkerHash
    })
    markers.push(marker)
    parentMarkerHash = marker.markerHash
  }
  return markers
}
function writeDashboardManifestCandidate(
  root: string,
  parent: ImmutableManifestDocument,
  nextDashboard: Dashboard,
  token: string,
  sequence = parent.value.sequence + 1
): ImmutableManifestDocument {
  const next = structuredClone(parent.value)
  const raw = prettyJson(nextDashboard)
  const file = writeRawGeneration(root, raw, token)
  next.sequence = sequence
  next.generation = token
  next.dashboards[nextDashboard.id] = {
    ...parent.value.dashboards[nextDashboard.id],
    file,
    exportName: parent.value.dashboards[nextDashboard.id]?.exportName ??
      dashboardFileNameForId(root, nextDashboard.id),
    hash: exactTestHash(raw),
    generation: `cas-v2:${token}`,
    sizeBytes: Buffer.byteLength(raw, 'utf8')
  }
  return writeManifestObject(root, next)
}
function writeRawGeneration(root: string, raw: string, token: string): string {
  const hash = exactTestHash(raw)
  const file = `g.cycle3.${token}.${hash}.json`
  const generationDir = join(root, '.dashboard-generations')
  mkdirSync(generationDir, { recursive: true })
  writeFileSync(join(generationDir, file), raw)
  return file
}
function writeUncommittedGeneration(root: string, value: Dashboard, token: string): string {
  const raw = prettyJson(value)
  return writeRawGeneration(root, raw, token)
}
function manifestPointerFrom(renames: ReadonlyArray<{ from: string; to: string }>): string {
  return [...renames].reverse().find(({ to }) => to.endsWith('dashboard-storage-manifest.json'))?.to ?? ''
}
function writePlaylist(root: string, file = 'dashboard-playlist.json'): DashboardPlaylist {
  const value = { items: [{ dashboardId: 'legacy' }], updatedAt: 5 }
  writeFileSync(join(root, file), prettyJson(value))
  return value
}
describe('dashboard pure contracts', () => {
  it('keeps touch panels in mixed playlist routing', () => {
    expect(touchPanelIdOf({ dashboardId: 'p', kind: 'touch-panel' })).toBe('p')
    expect(openablePlaylistItems([item('d'), panel('p'), item('x')], (id) => id === 'd', (id) => id === 'p')
      .map((entry) => entry.dashboardId)).toEqual(['d', 'p'])
    expect(sameCockpitTarget(panel('a'), panel('b'))).toBe(true)
    expect(resolveCycleStep([item('d'), panel('p')], 0, (entry) => entry.dashboardId === 'd', 'next')?.next).toEqual(panel('p'))
  })
  it('uses one unique 140-type runtime tuple and every built-in passes the canonical guard', () => {
    expect(DASHBOARD_ELEMENT_TYPES).toHaveLength(140)
    expect(new Set(DASHBOARD_ELEMENT_TYPES).size).toBe(140)
    expect(DASHBOARD_ELEMENT_TYPES.every(isDashboardElementType)).toBe(true)
    expect(isDashboardElementType('future-unknown')).toBe(false)
    for (const preset of BUILTIN_PRESETS) expect(dashboardValidationError(preset.build()), preset.id).toBeNull()
  })
  it('preserves fractional geometry and rejects invalid base/adaptive/style shapes without clamping', () => {
    const valid = dashboard('fractional')
    expect(dashboardValidationError(valid)).toBeNull()
    expect(valid.elements[0]).toMatchObject({ x: 1.25, y: 2.5, w: 10.75, h: 8.25 })
    const badBase = structuredClone(valid)
    badBase.elements.push({ id: 'bad', type: 'text', x: 99, y: 0, w: 2, h: 2, style: {} })
    expect(dashboardValidationError(badBase)).toMatch(/without clamping/)
    const badAdaptive = structuredClone(valid)
    badAdaptive.adaptive = { rules: [{ moment: 'yellow', frame: {
      elements: [{ id: 'bad', type: 'text', x: Number.NaN, y: 0, w: 1, h: 1, style: {} }]
    } }] }
    expect(dashboardValidationError(badAdaptive)).toMatch(/finite/)
    for (const [field, value] of [
      ['channels', 'throttle'], ['tableColumns', ['pos', 7]], ['slots', []],
      ['instrument', { parts: { led: { shape: 'triangle' } } }], ['fontWeight', { bold: true }],
      ['segments', 1_000_000], ['decimals', 101], ['tableColumns', ['prototype']],
      ['channels', Array(65).fill('throttle')], ['instrument', { parts: { dial: { majorTicks: 0 } } }]
    ] as Array<[string, unknown]>) {
      const badStyle = dashboard(`bad-${field}`)
      Object.assign(badStyle.elements[0].style, { [field]: value })
      expect(dashboardValidationError(badStyle), field).not.toBeNull()
    }
    const overlay = dashboard('overlay')
    overlay.elements[0].type = 'overlaywidget'
    expect(dashboardValidationError(overlay)).toMatch(/requires widgetId/)
    ;(overlay.elements[0] as unknown as Record<string, unknown>).widgetId = 42
    expect(dashboardValidationError(overlay)).toMatch(/widgetId/)
    delete (overlay.elements[0] as unknown as Record<string, unknown>).widgetId
    overlay.elements[0].hifiModuleId = 'fuelDelta'
    expect(dashboardValidationError(overlay)).toBeNull()
    for (const id of ['__proto__', 'prototype', 'constructor', 'toString']) {
      const unsafe = dashboard(`unsafe-${id}`)
      unsafe.id = id
      expect(dashboardValidationError(unsafe), id).toMatch(/dangerous/)
    }
    const unsafeElement = dashboard('unsafe-element')
    unsafeElement.elements[0].id = 'constructor'
    expect(dashboardValidationError(unsafeElement)).toMatch(/dangerous/)
    const unsafeRule = dashboard('unsafe-rule')
    unsafeRule.adaptive = JSON.parse('{"rules":[{"moment":"race","elements":{"__proto__":{"visible":true}}}]}')
    expect(dashboardValidationError(unsafeRule)).toMatch(/dangerous/)
    const reactChild = dashboard('react-child')
    ;(reactChild.elements[0] as unknown as Record<string, unknown>).name = { unsafe: true }
    expect(dashboardValidationError(reactChild)).toMatch(/name must be a string/)
    const idMap = dashboardIdRecord({ safe: 1, constructor: 2 })
    expect(Object.getPrototypeOf(idMap)).toBeNull()
    expect(idMap).toEqual({ safe: 1 })
  })
  it('reloads clean editors but preserves dirty drafts for revision/import/delete conflicts', () => {
    const v1 = dashboardStorageVersion({ storageEpoch: 'epoch', storageRevision: 'one' })
    const v2 = dashboardStorageVersion({ storageEpoch: 'epoch', storageRevision: 'two' })
    expect(editorRefreshAction(false, v1, v2)).toBe('reload')
    expect(editorRefreshAction(true, v1, v2)).toBe('conflict')
    expect(editorRefreshAction(true, v1, v1)).toBe('none')
    expect(editorRefreshAction(false, v1, null)).toBe('reload')
    expect(editorRefreshAction(true, v1, null)).toBe('conflict')
    expect(editorVersionConflict('dash', null)).toMatchObject({ code: 'EDITOR_VERSION_CONFLICT', kind: 'deleted' })
  })
})
describe('DashboardManager storage', () => {
  let root: string
  beforeEach(() => { root = mkdtempSync(join(process.cwd(), 'dashboard-storage-test-')) })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    schemaAdapterMocks.calls.length = 0
    schemaAdapterMocks.mapOutput = null
    storageLockMocks.onListen = null
    vi.clearAllMocks()
  })
  it('single-flights early IPC reads until load completes', async () => {
    writeDash(root, 'legacy.json', dashboard('legacy'))
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let reads = 0
    const { manager, handlers } = setup(root, { fs: { readdir: async (path) => { reads += 1; await gate; return readdir(path) } } })
    manager.registerIpc()
    let settled = false
    const list = Promise.resolve(handlers.get('app:dash:list')?.({})).then((value) => { settled = true; return value })
    const get = Promise.resolve(handlers.get('app:dash:get')?.({}, 'legacy'))
    await vi.waitFor(() => expect(reads).toBe(1))
    expect(settled).toBe(false)
    release()
    expect(await list).toMatchObject([{ id: 'legacy' }])
    expect(await get).toMatchObject({ id: 'legacy', storageRevision: expect.any(String) })
    expect(reads).toBe(7)
  })

  it('enters typed recovery on read/schema errors and loads neither duplicate id', async () => {
    writeDash(root, 'a.json', dashboard('duplicate', 'A'))
    writeDash(root, 'b.json', dashboard('duplicate', 'B'))
    const duplicate = setup(root).manager
    await duplicate.load()
    expect(duplicate.getStorageStatus()).toMatchObject({ state: 'recovery', reason: expect.stringContaining('Duplicate dashboard id') })
    expect(() => duplicate.getDashboard('duplicate')).toThrow(/STORAGE_UNAVAILABLE/)

    const deniedRoot = mkdtempSync(join(process.cwd(), 'dashboard-storage-test-'))
    try {
      writeDash(deniedRoot, 'blocked.json', dashboard('blocked'))
      const denied = setup(deniedRoot, { fs: { readFile: async () => {
        throw Object.assign(new Error('access denied'), { code: 'EACCES' })
      } } }).manager
      await denied.load(); await expect(denied.observe('blocked')).rejects
        .toMatchObject({ code: 'DASHBOARD_STORAGE_UNAVAILABLE' })
      expect(JSON.parse(readFileSync(join(deniedRoot, 'blocked.json'), 'utf8')).id).toBe('blocked')
    } finally { rmSync(deniedRoot, { recursive: true, force: true }) }
  })
  it('retries post-enumeration ENOENT and recovers or recreates a vanished playlist consistently', async () => {
    let scans = 0
    const vanished = setup(root, { fs: {
      readdir: async (path) => {
        if (path.includes('.dashboard-generations')) return []
        scans += 1
        return ['vanish.json']
      },
      readFile: async () => { throw Object.assign(new Error('vanished'), { code: 'ENOENT' }) }
    } }).manager
    await vanished.load()
    expect(scans).toBe(7)
    expect(vanished.getStorageStatus()).toMatchObject({ state: 'recovery', reason: expect.stringContaining('repeatedly vanished') })
    expect(vanished.listOpen()).toEqual([])
    expect(vanished.listDisplays()).toEqual([])
    await expect(vanished.closeWindow('missing')).resolves.toEqual([])

    const playlistRoot = mkdtempSync(join(process.cwd(), 'dashboard-storage-test-'))
    try {
      writeDash(playlistRoot, 'legacy.json', dashboard('legacy'))
      let first = true
      let playlistVanished = true
      const recreated = setup(playlistRoot, { fs: {
        readdir: async (path) => path.includes('.dashboard-generations')
          ? readdir(path)
          : first ? (first = false, ['legacy.json', 'dashboard-playlist.json']) : readdir(path),
        readFile: async (path) => {
          if (path.endsWith('dashboard-playlist.json') && playlistVanished) {
            playlistVanished = false
            throw Object.assign(new Error('gone'), { code: 'ENOENT' })
          }
          return readFileSync(path, 'utf8')
        }
      } }).manager
      await recreated.load()
      expect(recreated.getStorageStatus()).toMatchObject({ state: 'ready', reason: null })
      expect(Object.keys((await recreated.exportSnapshot()).files)).toContain('dashboard-playlist.json')
    } finally { rmSync(playlistRoot, { recursive: true, force: true }) }
  })

  it('derives durable per-file revisions from exact bytes across reloads and raw-byte changes', async () => {
    const legacy = dashboard('legacy', 'Before')
    writeDash(root, 'legacy.json', legacy)
    writePlaylist(root)

    const first = setup(root).manager
    await first.load()
    const firstRevision = first.getDashboard('legacy')!.storageRevision
    const firstPlaylistRevision = first.getPlaylist().storageRevision

    const second = setup(root).manager
    await second.load()
    expect(second.getDashboard('legacy')!.storageRevision).toBe(firstRevision)
    expect(second.getPlaylist().storageRevision).toBe(firstPlaylistRevision)

    await second.save({ ...second.getDashboard('legacy')!, name: 'Manager owned' }, await second.observe('legacy'))
    const ownedRevision = second.getDashboard('legacy')!.storageRevision
    const third = setup(root).manager
    await third.load()
    expect(third.getDashboard('legacy')!.storageRevision).toBe(ownedRevision)

    const [activeGeneration] = storedDashboardPaths(root, 'legacy', 'Manager owned')
    writeFileSync(activeGeneration, JSON.stringify(JSON.parse(readFileSync(activeGeneration, 'utf8'))), 'utf8')
    const externallyChanged = setup(root).manager
    await externallyChanged.load()
    expect(externallyChanged.getStorageStatus()).toMatchObject({ state: 'ready', reason: null })
    expect(externallyChanged.getDashboard('legacy')).toMatchObject({ name: 'Before' })
    expect(existsSync(activeGeneration)).toBe(true)
  })

  it('retains legacy/mixed-case ownership, exact ids, fractional geometry, and deletes only owned files', async () => {
    const id = '../Legacy:Dashboard?'
    writeDash(root, 'Legacy Physical.JSON', dashboard(id))
    writePlaylist(root, 'DASHBOARD-PLAYLIST.JSON')
    const unrelated = dashboardFileNameForId(root, id)
    expect(unrelated).toMatch(/^d-[a-z2-7]+\.json$/)
    expect(unrelated).not.toBe(dashboardFileNameForId(root, '..\\Legacy:Dashboard?'))
    expect(() => dashboardFileNameForId(root, 'x'.repeat(500))).toThrow(/path limit/)
    writeDash(root, unrelated, dashboard('other-owner'))
    const { manager } = setup(root)
    await manager.load()
    const original = structuredClone(manager.getDashboard(id)!)
    await manager.save({ ...original, name: 'Changed' }, await manager.observe(id))
    expect(manager.getDashboard(id)).toMatchObject({ id, elements: [{ x: 1.25, w: 10.75 }] })
    await manager.delete(id, await manager.observe(id))
    expect(snapshotDashboard(await manager.exportSnapshot(), id)).toBeUndefined()
    expect(manager.getDashboard('other-owner')).toMatchObject({ id: 'other-owner' })
    expect(snapshotDashboard(await manager.exportSnapshot(), 'other-owner')).toMatchObject({ id: 'other-owner' })
    await expect(manager.save(dashboard(id), await manager.observe(id))).rejects.toThrow(/not owned|collision/)
  })

  it('duplicates R16/adaptive presets to unique ids/names while stable materialization preserves edits', async () => {
    const edited = createAdaptiveDashboardPreset()
    edited.name = 'My edited adaptive dashboard'
    edited.adaptive = { enabled: true, rules: [{ moment: 'yellow', enabled: false }] }
    writeDash(root, 'Adaptive.JSON', edited)
    const r16Preset = BUILTIN_PRESETS.find((preset) => preset.id === 'race-hud-futuristic')!
    const editedR16 = r16Preset.build()
    editedR16.name = 'My edited R16'
    writeDash(root, 'R16.JSON', editedR16)
    writePlaylist(root)
    const adaptive: DashboardPreset = { id: ADAPTIVE_DASHBOARD_ID, name: 'Adaptive', build: createAdaptiveDashboardPreset }
    const { manager } = setup(root, { presets: [adaptive, r16Preset] })
    await manager.load()
    const adaptivePath = storedDashboardPaths(root, ADAPTIVE_DASHBOARD_ID, edited.name)[0]
    const before = readFileSync(adaptivePath, 'utf8')
    const adaptiveCopy = await manager.createFromPreset(ADAPTIVE_DASHBOARD_ID)
    const r16Copy = await manager.createFromPreset(r16Preset.id)
    expect(adaptiveCopy).toMatchObject({ id: expect.not.stringMatching(ADAPTIVE_DASHBOARD_ID), name: expect.stringContaining('copy') })
    expect(r16Copy.id).not.toBe(r16Preset.id)
    expect(r16Copy.name).not.toBe(editedR16.name)
    await (manager as unknown as { materializeBuiltinPreset(id: string): Promise<Dashboard | null> }).materializeBuiltinPreset(ADAPTIVE_DASHBOARD_ID)
    expect(manager.getDashboard(ADAPTIVE_DASHBOARD_ID)).toMatchObject({ name: edited.name, adaptive: edited.adaptive })
    expect(readFileSync(adaptivePath, 'utf8')).toBe(before)
  })

  it('retains absent/tombstone generations across failed create and delete ABA', async () => {
    writePlaylist(root)
    let fail = false
    const { manager, broadcast } = setup(root, { fs: { rename: async (from, to) => {
      if (fail) throw new Error('first create failed')
      await rename(from, to)
    } } })
    await manager.load()
    fail = true
    const absent = await manager.observe('aba')
    await expect(manager.save(dashboard('aba'), absent)).rejects.toThrow('first create failed')
    expect(await manager.observe('aba')).toEqual(absent)
    fail = false
    await manager.save(dashboard('aba'), absent)
    const firstLive = await manager.observe('aba')
    await manager.delete('aba', firstLive)
    expect(broadcast).toHaveBeenCalledWith('app:dash:removed', expect.objectContaining({ id: 'aba' }))
    await expect(manager.save(dashboard('aba', 'stale'), absent)).rejects.toThrow(/STALE_VERSION/)
    const tombstone = await manager.observe('aba')
    await manager.save(dashboard('aba', 'fresh'), tombstone)
    await expect(manager.save(dashboard('aba', 'live ABA'), firstLive)).rejects.toThrow(/STALE_VERSION/)
    expect(manager.getDashboard('aba')?.name).toBe('fresh')
  })

  it('implicitly observes only a new dashboard id and rejects tokenless replacement', async () => {
    writePlaylist(root)
    const { manager } = setup(root)
    await manager.load()

    await manager.save(dashboard('implicit-create', 'Created'))
    expect(manager.getDashboard('implicit-create')).toMatchObject({ name: 'Created' })
    await expect(manager.save(dashboard('implicit-create', 'Overwritten')))
      .rejects.toThrow(/STALE_VERSION.*observe/i)
    expect(manager.getDashboard('implicit-create')).toMatchObject({ name: 'Created' })
  })

  it('rejects a save when the owned bytes change on disk after observe', async () => {
    writeDash(root, 'legacy.json', dashboard('legacy', 'Before'))
    const { manager } = setup(root)
    await manager.load()
    const token = await manager.observe('legacy')
    const active = storedDashboardPaths(root, 'legacy', 'Before')[0]
    writeFileSync(active, prettyJson(dashboard('legacy', 'External change')))
    await expect(manager.save({ ...manager.getDashboard('legacy')!, name: 'Local overwrite' }, token))
      .rejects.toThrow(/STALE_VERSION|modified on disk|recovery/i)
    expect(JSON.parse(readFileSync(active, 'utf8')).name).toBe('External change')
    expect(manager.getStorageStatus()).toMatchObject({ state: 'recovery' })
  })

  it('never deletes or replaces externally modified owned dashboard/playlist bytes', async () => {
    writeDash(root, 'legacy.json', dashboard('legacy', 'Before'))
    writePlaylist(root)
    const deleting = setup(root).manager
    await deleting.load()
    const deleteToken = await deleting.observe('legacy')
    const activeDashboard = storedDashboardPaths(root, 'legacy', 'Before')[0]
    writeFileSync(activeDashboard, prettyJson(dashboard('legacy', 'Cloud copy')))
    await expect(deleting.delete('legacy', deleteToken)).rejects.toThrow(/STALE_VERSION|modified on disk|recovery/i)
    expect(JSON.parse(readFileSync(activeDashboard, 'utf8')).name).toBe('Cloud copy')

    const playlistRoot = mkdtempSync(join(process.cwd(), 'dashboard-storage-test-'))
    try {
      writeDash(playlistRoot, 'legacy.json', dashboard('legacy'))
      writePlaylist(playlistRoot)
      const replacing = setup(playlistRoot).manager
      await replacing.load()
      const token = observedDashboardMutationToken(replacing.getPlaylist())
      const external = { items: [], updatedAt: 777 }
      const activePlaylist = storedPlaylistPaths(playlistRoot)[0]
      writeFileSync(activePlaylist, prettyJson(external))
      await expect(replacing.setPlaylist({ items: [item('legacy')], updatedAt: 1 }, token))
        .rejects.toThrow(/STALE_VERSION|modified on disk|recovery/i)
      expect(JSON.parse(readFileSync(activePlaylist, 'utf8'))).toEqual(external)
    } finally {
      rmSync(playlistRoot, { recursive: true, force: true })
    }
  })

  it('prevents independent manager instances from both winning the same disk revision', async () => {
    writeDash(root, 'legacy.json', dashboard('legacy', 'Before'))
    writePlaylist(root)
    let hold = false
    let entered!: () => void
    let release!: () => void
    const renameEntered = new Promise<void>((resolve) => { entered = resolve })
    const gate = new Promise<void>((resolve) => { release = resolve })
    const first = setup(root, { fs: { rename: async (from, to) => {
      if (hold) {
        entered()
        await gate
      }
      await rename(from, to)
    } } }).manager
    const second = setup(root).manager
    await Promise.all([first.load(), second.load()])
    const firstToken = await first.observe('legacy')
    const secondToken = await second.observe('legacy')

    hold = true
    const winner = first.save({ ...first.getDashboard('legacy')!, name: 'First writer' }, firstToken)
    await renameEntered
    const loser = second.save({ ...second.getDashboard('legacy')!, name: 'Second writer' }, secondToken)
    release()
    await winner
    await expect(loser).rejects.toThrow(/STALE_VERSION|modified on disk|recovery/i)
    expect(JSON.parse(readFileSync(storedDashboardPaths(root, 'legacy', 'First writer')[0], 'utf8')).name).toBe('First writer')
  })

  it('exports exact mixed-case owned files coherently behind concurrent save and snapshot work', async () => {
    writeDash(root, 'Legacy.JSON', dashboard('legacy', 'Before'))
    writePlaylist(root, 'DASHBOARD-PLAYLIST.JSON')
    let hold = false, entered!: () => void, release!: () => void
    const renameEntered = new Promise<void>((resolve) => { entered = resolve }), gate = new Promise<void>((resolve) => { release = resolve })
    const { manager, broadcast } = setup(root, { fs: { rename: async (from, to) => {
      if (hold) { entered(); await gate }
      await rename(from, to)
    } } })
    await manager.load()
    hold = true
    const save = manager.save({ ...manager.getDashboard('legacy')!, name: 'After' },
      await manager.observe('legacy'))
    await renameEntered
    let snapshotSettled = false
    const snapshot = manager.exportSnapshot().then((value) => {
      snapshotSettled = true
      return value
    })
    await Promise.resolve()
    expect(snapshotSettled).toBe(false)
    release()
    await save
    const result = await snapshot
    const legacyRaw = readFileSync(storedDashboardPaths(root, 'legacy', 'After')[0], 'utf8')
    const playlistRaw = readFileSync(storedPlaylistPaths(root)[0], 'utf8')
    expect(Object.keys(result.files).sort()).toEqual(['DASHBOARD-PLAYLIST.JSON', 'Legacy.JSON'])
    expect(result.files['Legacy.JSON']).toEqual(JSON.parse(legacyRaw))
    expect(result.files['DASHBOARD-PLAYLIST.JSON']).toEqual(JSON.parse(playlistRaw))
    expect((result.files['Legacy.JSON'] as Dashboard).name).toBe('After')
    expect(result.sizeBytes).toBe(Buffer.byteLength(legacyRaw, 'utf8') + Buffer.byteLength(playlistRaw, 'utf8'))
    broadcast.mockClear()
    const oldEpoch = manager.getDashboard('legacy')!.storageEpoch
    await (manager as unknown as { importDashboards(values: Dashboard[]): Promise<unknown> })
      .importDashboards([{ ...manager.getDashboard('legacy')!, name: 'Imported same id' }])
    const updated = broadcast.mock.calls.find(([channel, payload]) => channel === 'app:dash:updated' && (payload as Dashboard).id === 'legacy')?.[1] as Dashboard
    expect(updated).toMatchObject({ name: 'Imported same id', storageEpoch: expect.any(String) })
    expect(updated.storageEpoch).toBe(oldEpoch)
  })

  it('SimHub/import rotates only changed ids so unrelated editors stay valid and broadcasts stay exact', async () => {
    writeDash(root, 'Changed.JSON', dashboard('changed', 'Changed before'))
    writeDash(root, 'Untouched.JSON', dashboard('untouched', 'Untouched before'))
    writePlaylist(root, 'DASHBOARD-PLAYLIST.JSON')
    const { manager, broadcast } = setup(root)
    await manager.load()
    const untouchedToken = await manager.observe('untouched')
    broadcast.mockClear()
    await (manager as unknown as { importDashboards(values: Dashboard[]): Promise<unknown> })
      .importDashboards([{ ...manager.getDashboard('changed')!, name: 'Imported changed' }])
    expect(broadcast.mock.calls.filter(([channel]) => channel === 'app:dash:removed')).toEqual([])
    expect(
      broadcast.mock.calls
        .filter(([channel]) => channel === 'app:dash:updated')
        .map(([, payload]) => (payload as Dashboard).id)
    ).toEqual(['changed'])
    await expect(manager.save({ ...manager.getDashboard('untouched')!, name: 'Still editable' }, untouchedToken))
      .resolves.toMatchObject({ name: 'Still editable' })
  })

  it('fails whole export with typed recovery when the second owned file becomes unreadable', async () => {
    writeDash(root, 'First.JSON', dashboard('first'))
    writeDash(root, 'Second.JSON', dashboard('second'))
    writePlaylist(root, 'DASHBOARD-PLAYLIST.JSON')
    let phase: 'load' | 'snapshot' = 'load'
    let snapshotReads = 0
    const { manager } = setup(root, { fs: {
      readdir: async (path) => path.includes('.dashboard-generations')
        ? readdir(path)
        : ['First.JSON', 'Second.JSON', 'DASHBOARD-PLAYLIST.JSON'],
      readFile: async (path) => {
        if (phase === 'snapshot' && path.includes('.dashboard-generations') && path.toLowerCase().endsWith('.json')) {
          snapshotReads += 1
          if (snapshotReads === 2) throw Object.assign(new Error('snapshot EACCES'), { code: 'EACCES' })
        }
        return readFileSync(path, 'utf8')
      }
    } })
    await manager.load()
    phase = 'snapshot'
    await expect(manager.exportSnapshot()).rejects.toMatchObject({ code: 'DASHBOARD_STORAGE_UNAVAILABLE', state: 'recovery' })
    expect(snapshotReads).toBe(2)
    for (const [, callback] of electron.on.mock.calls) expect(() => callback()).not.toThrow()
    await expect(manager.closeWindow('first')).resolves.toEqual([])
  })

  it('fails whole export with typed recovery when an owned dashboard becomes invalid on disk', async () => {
    writeDash(root, 'Legacy.JSON', dashboard('legacy'))
    writePlaylist(root, 'DASHBOARD-PLAYLIST.JSON')
    const { manager } = setup(root, { fs: { readFile: async (path) => {
      return readFileSync(path, 'utf8')
    } } })
    await manager.load()
    writeFileSync(storedDashboardPaths(root, 'legacy')[0], prettyJson({ id: 'legacy', name: 42 }))
    await expect(manager.exportSnapshot()).rejects.toMatchObject({ code: 'DASHBOARD_STORAGE_UNAVAILABLE', state: 'recovery' })
    expect(manager.getStorageStatus().reason).toContain('modified outside')
    for (const [, callback] of electron.on.mock.calls) expect(() => callback()).not.toThrow()
    await expect(manager.closeWindow('legacy')).resolves.toEqual([])
  })

  it('fails whole export with typed recovery when an owned file changes id on disk', async () => {
    writeDash(root, 'Legacy.JSON', dashboard('legacy'))
    writePlaylist(root, 'DASHBOARD-PLAYLIST.JSON')
    const { manager } = setup(root)
    await manager.load()
    writeFileSync(storedDashboardPaths(root, 'legacy')[0], prettyJson(dashboard('other')))
    await expect(manager.exportSnapshot()).rejects.toMatchObject({ code: 'DASHBOARD_STORAGE_UNAVAILABLE', state: 'recovery' })
    expect(manager.getStorageStatus().reason).toContain('modified outside')
  })

  it('keeps dashboard and playlist targets/maps/revisions unchanged on atomic replace failure', async () => {
    writeDash(root, 'legacy.json', dashboard('legacy', 'Original'))
    const playlist = writePlaylist(root)
    let fail = false
    const { manager, broadcast } = setup(root, { fs: { rename: async (from, to) => {
      if (fail) throw new Error('replace failed')
      await rename(from, to)
    } } })
    await manager.load()
    const dashboardPath = storedDashboardPaths(root, 'legacy', 'Original')[0]
    const playlistPath = storedPlaylistPaths(root)[0]
    const dashToken = await manager.observe('legacy')
    fail = true
    await expect(manager.save({ ...manager.getDashboard('legacy')!, name: 'Changed' }, dashToken)).rejects.toThrow('replace failed')
    const listToken = observedDashboardMutationToken(manager.getPlaylist())
    await expect(manager.setPlaylist({ items: [], updatedAt: 9 }, listToken)).rejects.toThrow('replace failed')
    expect(JSON.parse(readFileSync(dashboardPath, 'utf8')).name).toBe('Original')
    expect(JSON.parse(readFileSync(playlistPath, 'utf8'))).toEqual(playlist)
    expect(await manager.observe('legacy')).toEqual(dashToken)
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('loads valid and migrated legacy files while quarantining only the invalid sibling', async () => {
    const valid = dashboard('valid-file', 'Valid')
    const migrated = dashboard('migrated-file', 'Migrated')
    ;(migrated.elements[0].style as Record<string, unknown>).tableColumns = ['pos', 'last']
    const invalid = dashboard('invalid-file', 'Invalid')
    invalid.elements[0].type = 'overlaywidget'
    const invalidRaw = prettyJson(invalid)
    writeDash(root, 'Valid.JSON', valid)
    writeDash(root, 'Migrated.JSON', migrated)
    writeFileSync(join(root, 'Invalid.JSON'), invalidRaw)
    writeFileSync(join(root, 'DASHBOARD-PLAYLIST.JSON'), prettyJson({
      items: [item(valid.id), item(migrated.id), item(invalid.id)],
      updatedAt: 5
    }))

    const canonicalAdapterName = 'Migrated through canonical adapter'
    schemaAdapterMocks.calls.length = 0
    schemaAdapterMocks.mapOutput = (input, output) => {
      const candidate = input as Partial<Dashboard>
      if (candidate?.id === migrated.id && output.status === 'migrated') {
        return { ...output, dashboard: { ...output.dashboard, name: canonicalAdapterName } }
      }
      return output
    }
    const manager = setup(root).manager
    await manager.load()

    const canonicalMigration = schemaAdapterMocks.calls.find(({ input }) => {
      const candidate = input as Partial<Dashboard>
      return candidate?.id === migrated.id &&
        candidate.elements?.[0]?.style.tableColumns?.includes('last')
    })
    if (!canonicalMigration) throw new Error('Expected the canonical dashboard storage validator to handle migration.')
    expect(canonicalMigration.input).toMatchObject({
      id: migrated.id,
      elements: [{ style: { tableColumns: ['pos', 'last'] } }]
    })
    expect(canonicalMigration.output).toMatchObject({
      status: 'migrated',
      dashboard: {
        id: migrated.id,
        name: 'Migrated',
        elements: [{ style: { tableColumns: ['pos', 'laps'] } }]
      },
      migrations: [{
        code: 'table-column-last-to-laps',
        path: 'elements[0].style.tableColumns',
        from: ['pos', 'last'],
        to: ['pos', 'laps']
      }]
    })
    expect(manager.getStorageStatus()).toMatchObject({ state: 'ready', reason: null })
    expect(manager.getDashboard(valid.id)).toMatchObject({ id: valid.id, name: 'Valid' })
    expect(manager.getDashboard(migrated.id)).toMatchObject({
      id: migrated.id,
      name: canonicalAdapterName,
      elements: [{ style: { tableColumns: ['pos', 'laps'] } }]
    })
    expect(manager.getDashboard(invalid.id)).toBeNull()
    expect(filesBelow(root).some((path) => readFileSync(path, 'utf8') === invalidRaw)).toBe(true)

    const snapshot = await manager.exportSnapshot()
    expect(snapshotDashboard(snapshot, valid.id)).toMatchObject({ name: 'Valid' })
    expect(snapshotDashboard(snapshot, migrated.id)).toMatchObject({
      name: canonicalAdapterName,
      elements: [{ style: { tableColumns: ['pos', 'laps'] } }]
    })
    expect(snapshotDashboard(snapshot, invalid.id)).toBeUndefined()

    const restarted = setup(root).manager
    await restarted.load()
    expect(restarted.getStorageStatus()).toMatchObject({ state: 'ready', reason: null })
    expect(restarted.getDashboard(migrated.id)).toMatchObject({
      name: canonicalAdapterName,
      elements: [{ style: { tableColumns: ['pos', 'laps'] } }]
    })
    expect(restarted.getDashboard(invalid.id)).toBeNull()
  })

  it('rechecks a quarantined legacy hash under lock before claiming externally replaced bytes', async () => {
    const source = join(root, 'Invalid.JSON')
    const invalid = dashboard('quarantine-race', 'Invalid')
    invalid.elements[0].type = 'overlaywidget'
    writeFileSync(source, prettyJson(invalid))
    const externalRaw = prettyJson(dashboard('quarantine-race', 'Externally repaired'))
    let signalClaim!: () => void
    let releaseClaim!: () => void
    const claimEntered = new Promise<void>((resolve) => { signalClaim = resolve })
    const claimGate = new Promise<void>((resolve) => { releaseClaim = resolve })
    let racedAtClaim = false
    const first = setup(root, { fs: { rename: async (from, to) => {
      if (!racedAtClaim && from === source && to.includes('.dashboard-quarantine')) {
        writeFileSync(source, externalRaw)
        racedAtClaim = true
        signalClaim()
        await claimGate
      }
      await rename(from, to)
    } } }).manager

    const firstLoad = first.load()
    const firstStep = await Promise.race([
      claimEntered.then(() => 'claim-entered' as const),
      firstLoad.then(() => 'load-complete' as const)
    ])
    let second: DashboardManager | null = null
    let secondLoad: Promise<void> | null = null
    let secondSettled = false
    let secondPreLockReached = false
    let secondStateBeforeLock: ReturnType<DashboardManager['getStorageStatus']>['state'] | null = null
    let secondSettledBeforeLock: boolean | null = null
    let lockAttemptsBeforePreLockRelease: number | null = null
    let secondSettledDuringClaim: boolean | null = null
    let secondEnteredStorageDuringClaim: boolean | null = null
    let secondEnteredStorage = false
    let secondStateDuringClaim: ReturnType<DashboardManager['getStorageStatus']>['state'] | null = null
    let secondLockAttempts = 0
    let signalSecondPreLock!: () => void
    let releaseSecondPreLock!: () => void
    let signalSecondLockAttempt!: () => void
    let signalSecondLockRetry!: () => void
    const secondPreLockEntered = new Promise<void>((resolve) => { signalSecondPreLock = resolve })
    const secondPreLockGate = new Promise<void>((resolve) => { releaseSecondPreLock = resolve })
    const secondLockAttempted = new Promise<void>((resolve) => { signalSecondLockAttempt = resolve })
    const secondLockRetried = new Promise<void>((resolve) => { signalSecondLockRetry = resolve })
    try {
      if (firstStep === 'claim-entered') {
        storageLockMocks.onListen = () => {
          secondLockAttempts += 1
          if (secondLockAttempts === 1) signalSecondLockAttempt()
          if (secondLockAttempts === 2) signalSecondLockRetry()
        }
        second = setup(root, { fs: {
          mkdir: async (path) => {
            await mkdir(path, { recursive: true })
            if (!secondPreLockReached && path === join(root, '.dashboard-quarantine')) {
              secondPreLockReached = true
              signalSecondPreLock()
              await secondPreLockGate
            }
          },
          readdir: async (path) => {
            secondEnteredStorage = true
            return readdir(path)
          }
        } }).manager
        secondLoad = second.load().finally(() => { secondSettled = true })
        await secondPreLockEntered
        secondStateBeforeLock = second.getStorageStatus().state
        secondSettledBeforeLock = secondSettled
        lockAttemptsBeforePreLockRelease = secondLockAttempts
        releaseSecondPreLock()
        await secondLockAttempted
        await secondLockRetried
        secondStateDuringClaim = second.getStorageStatus().state
        secondSettledDuringClaim = secondSettled
        secondEnteredStorageDuringClaim = secondEnteredStorage
      }
    } finally {
      storageLockMocks.onListen = null
      releaseSecondPreLock()
      releaseClaim()
    }
    await firstLoad
    if (secondLoad) await secondLoad

    const externalLocations = filesBelow(root).filter((path) => {
      try { return readFileSync(path, 'utf8') === externalRaw } catch { return false }
    })
    expect(firstStep).toBe('claim-entered')
    expect(racedAtClaim).toBe(true)
    expect(secondPreLockReached).toBe(true)
    expect(secondStateBeforeLock).toBe('loading')
    expect(secondSettledBeforeLock).toBe(false)
    expect(lockAttemptsBeforePreLockRelease).toBe(0)
    expect(secondLockAttempts).toBeGreaterThanOrEqual(2)
    expect(secondStateDuringClaim).toBe('loading')
    expect(secondSettledDuringClaim).toBe(false)
    expect(secondEnteredStorageDuringClaim).toBe(false)
    expect(secondEnteredStorage).toBe(true)
    expect(first.getStorageStatus()).toMatchObject({ state: 'ready', reason: null })
    expect(second?.getStorageStatus()).toMatchObject({ state: 'ready', reason: null })
    expect(existsSync(source)).toBe(true)
    expect(readFileSync(source, 'utf8')).toBe(externalRaw)
    expect(externalLocations).toEqual([source])
    expect(externalLocations.some((path) => path.includes('.dashboard-quarantine'))).toBe(false)
  })

  it('publishes immutable dashboard generations through one atomic manifest pointer', async () => {
    const renames: Array<{ from: string; to: string }> = []
    let protectedGeneration: string | null = null
    const { manager } = setup(root, { fs: {
      rename: async (from, to) => {
        renames.push({ from, to })
        if (from === protectedGeneration && to.includes('.dashboard-quarantine')) {
          throw Object.assign(new Error('generation retained for immutability assertion'), { code: 'EACCES' })
        }
        await rename(from, to)
      },
      link: async (from, to) => {
        renames.push({ from, to })
        await link(from, to)
      },
      unlink: async (path) => {
        if (path === protectedGeneration) {
          throw Object.assign(new Error('generation retained for immutability assertion'), { code: 'EACCES' })
        }
        await unlink(path)
      }
    } })
    await manager.load()
    renames.length = 0

    const id = 'immutable'
    await manager.save(dashboard(id, 'Generation one'), await manager.observe(id))
    const [firstGeneration] = storedDashboardPaths(root, id, 'Generation one')
    expect(firstGeneration).toBeDefined()
    const firstBytes = readFileSync(firstGeneration, 'utf8')
    protectedGeneration = firstGeneration

    renames.length = 0
    await manager.save({ ...manager.getDashboard(id)!, name: 'Generation two' }, await manager.observe(id))
    const updateRenames = renames.splice(0)
    renames.length = 0
    await manager.setPlaylist({ items: [item(id)], updatedAt: 1 },
      observedDashboardMutationToken(manager.getPlaylist()))
    const playlistRenames = renames.splice(0)

    const updatePointer = manifestPointerFrom(updateRenames)
    const playlistPointer = manifestPointerFrom(playlistRenames)
    expect(updatePointer).toBeDefined()
    expect(updatePointer).toBe(playlistPointer)
    expect(readFileSync(firstGeneration, 'utf8')).toBe(firstBytes)
    const secondGenerations = storedDashboardPaths(root, id, 'Generation two')
    expect(secondGenerations).toHaveLength(1)
    expect(secondGenerations[0]).not.toBe(firstGeneration)
    expect(manager.getDashboard(id)).toMatchObject({ name: 'Generation two' })
    const restarted = setup(root).manager
    await restarted.load()
    expect(restarted.getDashboard(id)).toMatchObject({ name: 'Generation two' })
  })

  it('retains immutable sequence-addressed manifest objects instead of rewriting the active manifest', async () => {
    const manager = setup(root, { fs: { syncDirectory: async () => false } }).manager
    await manager.load()
    await manager.save(dashboard('manifest-object', 'Manifest one'), await manager.observe('manifest-object'))
    const decoyBackup = join(root, '.manifest-previous-cycle3-decoy')
    writeFileSync(decoyBackup, readFileSync(join(root, 'dashboard-storage-manifest.json'), 'utf8'))
    const before = immutableManifestDocuments(root)
    expect(before.map(({ value }) => value.sequence).sort((a, b) => a - b)).toEqual([1, 2])
    expect(existsSync(decoyBackup)).toBe(true)
    expect(before.every(({ path }) => path.startsWith(`${join(root, '.dashboard-manifests')}\\`))).toBe(true)
    for (const document of before) {
      expect(basename(document.path)).toBe(`m.${document.value.sequence}.${document.addressHash}.json`)
      expect(document.fileNameSequence).toBe(document.value.sequence)
      expect(document.addressHash).toBe(exactTestHash(document.raw))
    }

    await manager.save(
      { ...manager.getDashboard('manifest-object')!, name: 'Manifest two' },
      await manager.observe('manifest-object')
    )
    const after = immutableManifestDocuments(root)
    expect(after.map(({ value }) => value.sequence).sort((a, b) => a - b)).toEqual([1, 2, 3])
    expect(readdirSync(join(root, '.dashboard-manifests')).sort())
      .toEqual([
        ...after.map(({ path }) => basename(path)),
        ...commitMarkerDocuments(root).map(({ path }) => basename(path))
      ].sort())
    expect(after.every(({ path }) => MANIFEST_OBJECT_NAME.test(basename(path)))).toBe(true)
    for (const document of after) {
      expect(document.fileNameSequence).toBe(document.value.sequence)
      expect(document.addressHash).toBe(exactTestHash(document.raw))
    }
    for (const document of before) {
      expect(after.find(({ path }) => path === document.path)?.raw, `manifest sequence ${document.value.sequence}`)
        .toBe(document.raw)
    }
    expect(manager.getDashboard('manifest-object')).toMatchObject({ name: 'Manifest two' })
  })

  it('atomically replaces an established manifest pointer without any missing-pointer window', async () => {
    const pointer = join(root, 'dashboard-storage-manifest.json')
    const pointerObservations: Array<{ operation: string; raw: string }> = []
    const interceptedOperations: string[] = []
    let tracking = false
    let operationNumber = 0
    const observePointer = (operation: string): void => {
      if (!tracking) return
      pointerObservations.push({
        operation,
        raw: existsSync(pointer) ? readFileSync(pointer, 'utf8') : '<missing>'
      })
    }
    const observed = async <T>(kind: string, operation: () => Promise<T>): Promise<T> => {
      if (!tracking) return operation()
      const label = `${kind}#${++operationNumber}`
      interceptedOperations.push(label)
      observePointer(`before:${label}`)
      try {
        return await operation()
      } finally {
        observePointer(`after:${label}`)
      }
    }
    const { manager } = setup(root, { fs: {
      openExclusive: async (path) => observed(`open:${basename(path)}`, async () => {
        const handle = await open(path, 'wx')
        return {
          writeFile: (data, encoding) => observed(`write:${basename(path)}`,
            async () => { await handle.writeFile(data, { encoding }) }),
          sync: () => observed(`sync:${basename(path)}`, () => handle.sync()),
          close: () => observed(`close:${basename(path)}`, () => handle.close())
        }
      }),
      rename: (from, to) => observed(`rename:${basename(from)}->${basename(to)}`, () => rename(from, to)),
      link: (from, to) => observed(`link:${basename(from)}->${basename(to)}`, () => link(from, to)),
      unlink: (path) => observed(`unlink:${basename(path)}`, () => unlink(path))
    } })
    await manager.load()
    await manager.save(dashboard('continuous-pointer', 'First'), await manager.observe('continuous-pointer'))
    const oldObject = highestImmutableManifestDocument(root)
    const oldObjectBytes = readFileSync(oldObject.path, 'utf8')
    const oldPointerRaw = readFileSync(pointer, 'utf8')
    expect(oldPointerRaw).toBe(oldObject.raw)

    tracking = true
    observePointer('tracking-start')
    try {
      await manager.save(
        { ...manager.getDashboard('continuous-pointer')!, name: 'Second' },
        await manager.observe('continuous-pointer')
      )
      observePointer('tracking-end')
    } finally {
      tracking = false
    }

    const newObject = highestImmutableManifestDocument(root)
    const newPointerRaw = readFileSync(pointer, 'utf8')
    expect(newObject.value.sequence).toBe(oldObject.value.sequence + 1)
    expect(newPointerRaw).toBe(newObject.raw)
    expect(newPointerRaw).not.toBe(oldPointerRaw)
    expect(readFileSync(oldObject.path, 'utf8')).toBe(oldObjectBytes)
    expect(oldObject.addressHash).toBe(exactTestHash(oldObjectBytes))
    expect(newObject.addressHash).toBe(exactTestHash(newObject.raw))
    expect(interceptedOperations.length).toBeGreaterThan(0)
    expect(pointerObservations).toHaveLength((interceptedOperations.length * 2) + 2)
    expect(pointerObservations.map(({ raw }) => raw)).not.toContain('<missing>')
    expect(pointerObservations.every(({ raw }) => raw.length > 0)).toBe(true)
    expect(pointerObservations.every(({ raw }) => raw === oldPointerRaw || raw === newPointerRaw)).toBe(true)
    for (const operation of interceptedOperations) {
      expect(pointerObservations.filter(({ operation: phase }) => phase.endsWith(operation)).map(({ operation: phase }) =>
        phase.slice(0, phase.indexOf(':')))).toEqual(['before', 'after'])
    }
    expect(manager.getDashboard('continuous-pointer')).toMatchObject({ name: 'Second' })
    const restarted = setup(root).manager
    await restarted.load()
    expect(restarted.getDashboard('continuous-pointer')).toMatchObject({ name: 'Second' })
  })

  it('retains the previous committed generation for the grace period even after a durable update', async () => {
    const manager = setup(root, { fs: { syncDirectory: async () => true } }).manager
    await manager.load()
    await manager.save(dashboard('grace-retention', 'Before'), await manager.observe('grace-retention'))
    const [previous] = storedDashboardPaths(root, 'grace-retention', 'Before')
    const previousRaw = readFileSync(previous, 'utf8')
    const controlFile = writeUncommittedGeneration(root, dashboard('grace-control', 'Expired control'), 'expired-control')
    const controlPath = join(root, '.dashboard-generations', controlFile)
    utimesSync(controlPath, new Date(0), new Date(0))

    await manager.save(
      { ...manager.getDashboard('grace-retention')!, name: 'After' },
      await manager.observe('grace-retention')
    )
    const restarted = setup(root, { fs: { syncDirectory: async () => true } }).manager
    await restarted.load()

    expect(manager.getDashboard('grace-retention')).toMatchObject({ name: 'After' })
    expect(restarted.getDashboard('grace-retention')).toMatchObject({ name: 'After' })
    expect(storedDashboardPaths(root, 'grace-retention', 'After')).toHaveLength(1)
    expect(existsSync(previous)).toBe(true)
    expect(readFileSync(previous, 'utf8')).toBe(previousRaw)
    expect(existsSync(controlPath)).toBe(false)
    expect(storedDashboardPaths(root, 'grace-control')).toEqual([])
  })

  it('recomputes current and backup-manifest reachability immediately before generation GC', async () => {
    const externalBackup = join(root, '.manifest-previous-external-cycle3')
    let armGc = false
    let backupInstalled = false
    let backupSeenAtGcBoundary = false
    let gcBoundaryEnumerations = 0
    let backupReadsAtGcBoundary = 0
    let backupRaw = ''
    const { manager, broadcast } = setup(root, { fs: {
      readdir: async (path) => {
        if (armGc && path === root) {
          gcBoundaryEnumerations += 1
          if (!backupInstalled) {
            writeFileSync(externalBackup, backupRaw)
            backupInstalled = true
          }
          const names = await readdir(path)
          backupSeenAtGcBoundary ||= names.includes(basename(externalBackup))
          return names
        }
        return readdir(path)
      },
      readFile: async (path) => {
        if (armGc && path === externalBackup) backupReadsAtGcBoundary += 1
        return readFile(path)
      },
      syncDirectory: async () => true
    } })
    await manager.load()
    await manager.save(dashboard('gc-anchor', 'Before'), await manager.observe('gc-anchor'))
    const currentManifest = highestImmutableManifestDocument(root)
    const backupOnly = dashboard('backup-only', 'Referenced only by late backup')
    const backupOnlyRaw = prettyJson(backupOnly)
    const backupOnlyFile = writeRawGeneration(root, backupOnlyRaw, 'backup-only')
    const backupOnlyPath = join(root, '.dashboard-generations', backupOnlyFile)
    const controlFile = writeUncommittedGeneration(root, dashboard('gc-control', 'Expired unreferenced control'), 'gc-control')
    const controlPath = join(root, '.dashboard-generations', controlFile)
    const equallyExpired = new Date(0)
    utimesSync(backupOnlyPath, equallyExpired, equallyExpired)
    utimesSync(controlPath, equallyExpired, equallyExpired)
    const backupManifest = structuredClone(currentManifest.value)
    backupManifest.dashboards[backupOnly.id] = {
      file: backupOnlyFile,
      exportName: 'Backup Only.JSON',
      hash: exactTestHash(backupOnlyRaw),
      generation: 'cas-v2:backup-only',
      sizeBytes: Buffer.byteLength(backupOnlyRaw, 'utf8')
    }
    backupRaw = prettyJson(backupManifest)
    expect(immutableManifestDocuments(root).flatMap(({ value }) =>
      Object.values(value.dashboards).map(({ file }) => file))).not.toContain(backupOnlyFile)
    broadcast.mockImplementation((channel: string, payload: unknown) => {
      if (channel === 'app:dash:updated' &&
        (payload as Partial<Dashboard> | undefined)?.name === 'After') {
        armGc = true
      }
    })

    await manager.save(
      { ...manager.getDashboard('gc-anchor')!, name: 'After' },
      await manager.observe('gc-anchor')
    )

    expect(armGc).toBe(true)
    expect(backupInstalled).toBe(true)
    expect(gcBoundaryEnumerations).toBeGreaterThan(0)
    expect(backupSeenAtGcBoundary).toBe(true)
    expect(backupReadsAtGcBoundary).toBeGreaterThan(0)
    expect(existsSync(externalBackup)).toBe(true)
    expect(readFileSync(externalBackup, 'utf8')).toBe(backupRaw)
    expect((JSON.parse(readFileSync(externalBackup, 'utf8')) as ManifestDocument['value'])
      .dashboards[backupOnly.id].file)
      .toBe(backupOnlyFile)
    expect(immutableManifestDocuments(root).flatMap(({ value }) =>
      Object.values(value.dashboards).map(({ file }) => file))).not.toContain(backupOnlyFile)
    expect(existsSync(backupOnlyPath)).toBe(true)
    expect(readFileSync(backupOnlyPath, 'utf8')).toBe(backupOnlyRaw)
    expect(existsSync(controlPath)).toBe(false)
    expect(storedDashboardPaths(root, 'gc-control')).toEqual([])
  })

  it.each([
    ['generation staged before any manifest object', 'generation-only', 'Committed', true],
    ['temporary manifest object written before publication', 'temporary-manifest', 'Committed', true],
    ['immutable manifest object without a commit marker', 'object-without-marker', 'Committed', true],
    ['manifest object whose address hash is invalid', 'damaged-manifest', 'Committed', true],
    ['pointer lost after manifest publication', 'pointer-lost', 'Newest', true],
    ['pointer installed while Windows directory sync is unsupported', 'unsupported-sync', 'Newest', false],
    ['highest manifest references a damaged primary generation', 'damaged-generation', 'Committed', true],
    ['highest manifest references a damaged secondary generation', 'damaged-secondary', 'Committed', true],
    ['highest manifest references a damaged playlist generation', 'damaged-playlist', 'Committed', true],
    ['highest manifest references damaged secondary and playlist generations', 'damaged-secondary-playlist', 'Committed', true]
  ] as const)(
    'startup verifies all candidates after crash phase: %s',
    async (_description, phase, expectedName, syncSupported) => {
      const syncDirectoryCalls: string[] = []
      const trackedSync = { syncDirectory: async (path: string) => {
        syncDirectoryCalls.push(path)
        return syncSupported
      } }
      const manager = setup(root, { fs: trackedSync }).manager
      await manager.load()
      await manager.save(dashboard('crash-phase', 'Committed'), await manager.observe('crash-phase'))
      await manager.save(dashboard('crash-secondary', 'Secondary committed'),
        await manager.observe('crash-secondary'))
      await manager.setPlaylist({
        items: [item('crash-phase'), item('crash-secondary')],
        updatedAt: 1
      }, observedDashboardMutationToken(manager.getPlaylist()))
      const whollyValid = highestImmutableManifestDocument(root)
      const whollyValidMarker = ensureCommitMarkerChain(root).find((marker) =>
        marker.value.manifestHash === whollyValid.addressHash)!
      const committedPlaylist = manager.getPlaylist()
      let expectedManifest = whollyValid
      let expectedSecondaryName = 'Secondary committed'
      let expectedPlaylistIds = ['crash-phase', 'crash-secondary']

      if (phase === 'generation-only') {
        writeUncommittedGeneration(root, dashboard('crash-phase', 'Uncommitted'), 'generation-only')
      } else if (phase === 'temporary-manifest' || phase === 'object-without-marker' ||
        phase === 'damaged-manifest' || phase === 'damaged-generation' ||
        phase === 'damaged-secondary' || phase === 'damaged-playlist' ||
        phase === 'damaged-secondary-playlist') {
        const candidate = structuredClone(whollyValid.value)
        const nextName = 'Uncommitted'
        const nextDashboard = dashboard('crash-phase', nextName)
        const primaryRaw = prettyJson(nextDashboard)
        const primaryFile = writeRawGeneration(root, primaryRaw, `${phase}-primary`)
        const nextSecondary = dashboard(
          'crash-secondary',
          'Uncommitted secondary'
        )
        const secondaryValue = phase === 'damaged-secondary' || phase === 'damaged-secondary-playlist'
          ? dashboard('wrong-secondary-owner', 'Wrongly owned secondary generation')
          : nextSecondary
        const secondaryRaw = prettyJson(secondaryValue)
        const secondaryFile = writeRawGeneration(root, secondaryRaw, `${phase}-secondary`)
        const nextPlaylist: DashboardPlaylist = {
          items: [item('crash-secondary'), item('crash-phase')],
          updatedAt: committedPlaylist.updatedAt + 1
        }
        const playlistRaw = phase === 'damaged-playlist' || phase === 'damaged-secondary-playlist'
          ? prettyJson({ items: 'not-an-array', updatedAt: nextPlaylist.updatedAt })
          : prettyJson(nextPlaylist)
        const playlistFile = writeRawGeneration(root, playlistRaw, `${phase}-playlist`)
        candidate.sequence += 1
        candidate.generation = `cycle3-${phase}`
        candidate.dashboards['crash-phase'] = {
          file: primaryFile,
          exportName: whollyValid.value.dashboards['crash-phase'].exportName,
          hash: exactTestHash(primaryRaw),
          generation: `cas-v2:${phase}`,
          sizeBytes: Buffer.byteLength(primaryRaw, 'utf8')
        }
        candidate.dashboards['crash-secondary'] = {
          file: secondaryFile,
          exportName: whollyValid.value.dashboards['crash-secondary'].exportName,
          hash: exactTestHash(secondaryRaw),
          generation: `cas-v2:${phase}-secondary`,
          sizeBytes: Buffer.byteLength(secondaryRaw, 'utf8')
        }
        candidate.playlist = {
          file: playlistFile,
          exportName: whollyValid.value.playlist.exportName,
          hash: exactTestHash(playlistRaw),
          generation: `cas-v2:${phase}-playlist`,
          sizeBytes: Buffer.byteLength(playlistRaw, 'utf8')
        }
        const manifestRaw = prettyJson(candidate)
        if (phase === 'temporary-manifest') {
          writeFileSync(join(root, `.tmp-manifest-cycle3-${candidate.sequence}`), manifestRaw)
        } else {
          const candidateDocument = phase === 'damaged-manifest'
            ? (() => {
                const objectDir = join(root, '.dashboard-manifests')
                mkdirSync(objectDir, { recursive: true })
                const path = join(objectDir, `m.${candidate.sequence}.${'a'.repeat(43)}.json`)
                writeFileSync(path, manifestRaw)
                return {
                  path,
                  raw: manifestRaw,
                  value: candidate,
                  fileNameSequence: candidate.sequence,
                  addressHash: 'a'.repeat(43)
                }
              })()
            : writeManifestObject(root, candidate)
          if (phase !== 'object-without-marker') {
            writeCommitMarker(root, {
              version: 1,
              sequence: candidateDocument.value.sequence,
              manifestHash: candidateDocument.addressHash,
              parentMarkerHash: whollyValidMarker.markerHash
            })
          }
          if (phase !== 'object-without-marker' && phase !== 'damaged-manifest') {
            const damage = (file: string, value: unknown): void => {
              writeFileSync(join(root, '.dashboard-generations', file), prettyJson(value))
            }
            if (phase === 'damaged-generation') {
              damage(primaryFile, dashboard('crash-phase', 'Primary bytes changed after publication'))
            }
          }
          if (phase !== 'object-without-marker') {
            writeFileSync(join(root, 'dashboard-storage-manifest.json'), candidateDocument.raw)
          }
        }
      } else {
        await manager.save(
          { ...manager.getDashboard('crash-phase')!, name: 'Newest' },
          await manager.observe('crash-phase')
        )
        expectedManifest = highestImmutableManifestDocument(root)
        if (phase === 'pointer-lost') {
          unlinkSync(join(root, 'dashboard-storage-manifest.json'))
        }
      }

      syncDirectoryCalls.length = 0
      const restarted = setup(root, { fs: trackedSync }).manager
      await restarted.load()
      const snapshot = await restarted.exportSnapshot()
      const repairedPointerRaw = readFileSync(join(root, 'dashboard-storage-manifest.json'), 'utf8')
      expect(restarted.getStorageStatus()).toMatchObject({ state: 'ready', reason: null })
      expect(restarted.getDashboard('crash-phase')).toMatchObject({ name: expectedName })
      expect(restarted.getDashboard('crash-secondary')).toMatchObject({ name: expectedSecondaryName })
      expect(restarted.getPlaylist().items.map(({ dashboardId }) => dashboardId)).toEqual(expectedPlaylistIds)
      expect(snapshotDashboard(snapshot, 'crash-phase')).toMatchObject({ name: expectedName })
      expect(snapshotDashboard(snapshot, 'crash-secondary')).toMatchObject({ name: expectedSecondaryName })
      expect(repairedPointerRaw).toBe(expectedManifest.raw)
      expect((JSON.parse(repairedPointerRaw) as ManifestDocument['value']).sequence)
        .toBe(expectedManifest.value.sequence)
      expect(expectedManifest.fileNameSequence).toBe(expectedManifest.value.sequence)
      expect(expectedManifest.addressHash).toBe(exactTestHash(expectedManifest.raw))
      expect(syncDirectoryCalls.length).toBeGreaterThan(0)
      expect(syncDirectoryCalls).toEqual(expect.arrayContaining([
        root,
        join(root, '.dashboard-generations')
      ]))
    }
  )

  it('ignores or quarantines bootstrap generations that have no committed manifest object', async () => {
    const orphan = dashboard('bootstrap-orphan', 'Must stay invisible')
    const orphanFile = writeUncommittedGeneration(root, orphan, 'bootstrap')
    const originalPath = join(root, '.dashboard-generations', orphanFile)
    const orphanRaw = readFileSync(originalPath, 'utf8')
    const manager = setup(root).manager

    await manager.load()

    const orphanLocations = filesBelow(root).filter((path) => {
      try { return readFileSync(path, 'utf8') === orphanRaw } catch { return false }
    })
    const committedManifests = manifestDocuments(root)
    expect(manager.getStorageStatus()).toMatchObject({ state: 'ready', reason: null })
    expect(manager.getDashboard(orphan.id)).toBeNull()
    expect(snapshotDashboard(await manager.exportSnapshot(), orphan.id)).toBeUndefined()
    expect(existsSync(join(root, 'dashboard-storage-manifest.json'))).toBe(true)
    expect(orphanLocations).toHaveLength(1)
    expect(orphanLocations[0] === originalPath ||
      orphanLocations[0].startsWith(`${join(root, '.dashboard-quarantine')}\\`)).toBe(true)
    expect(readFileSync(orphanLocations[0], 'utf8')).toBe(orphanRaw)
    expect(committedManifests.length).toBeGreaterThan(0)
    for (const document of committedManifests) {
      expect(document.value.dashboards[orphan.id]).toBeUndefined()
      expect(Object.values(document.value.dashboards).map(({ file }) => file)).not.toContain(orphanFile)
    }
  })

  it('does not overwrite an external generation mutation made at manifest commit time', async () => {
    const renames: Array<{ from: string; to: string }> = []
    let manifestPointer = ''
    let activeGeneration = ''
    let mutateAtCommit = false
    let mutated = false
    let deletionAttempts = 0
    const external = dashboard('toctou-save', 'External during commit')
    const externalRaw = prettyJson(external)
    const { manager } = setup(root, { fs: {
      rename: async (from, to) => {
        renames.push({ from, to })
        if (mutateAtCommit && to === manifestPointer && !mutated) {
          writeFileSync(activeGeneration, externalRaw)
          mutated = true
        }
        await rename(from, to)
      },
      link: async (from, to) => {
        renames.push({ from, to })
        await link(from, to)
      },
      unlink: async (path) => {
        if (path === activeGeneration) deletionAttempts += 1
        await unlink(path)
      }
    } })
    await manager.load()
    await manager.save(dashboard('toctou-save', 'Before'), await manager.observe('toctou-save'))
    activeGeneration = storedDashboardPaths(root, 'toctou-save', 'Before')[0]
    expect(activeGeneration).toBeDefined()
    renames.length = 0
    await manager.setPlaylist({ items: [item('toctou-save')], updatedAt: 1 },
      observedDashboardMutationToken(manager.getPlaylist()))
    manifestPointer = manifestPointerFrom(renames)

    mutateAtCommit = true
    await manager.save({ ...manager.getDashboard('toctou-save')!, name: 'Local commit' },
      await manager.observe('toctou-save'))

    expect(mutated).toBe(true)
    expect(deletionAttempts).toBe(0)
    expect(readFileSync(activeGeneration, 'utf8')).toBe(externalRaw)
    expect(manager.getDashboard('toctou-save')).toMatchObject({ name: 'Local commit' })
    const restarted = setup(root).manager
    await restarted.load()
    expect(restarted.getDashboard('toctou-save')).toMatchObject({ name: 'Local commit' })
  })

  it('does not delete an external generation mutation made at tombstone commit time', async () => {
    const renames: Array<{ from: string; to: string }> = []
    let manifestPointer = ''
    let activeGeneration = ''
    let mutateAtCommit = false
    let mutated = false
    let deletionAttempts = 0
    const externalRaw = prettyJson(dashboard('toctou-delete', 'External during delete'))
    const { manager } = setup(root, { fs: {
      rename: async (from, to) => {
        renames.push({ from, to })
        if (mutateAtCommit && to === manifestPointer && !mutated) {
          writeFileSync(activeGeneration, externalRaw)
          mutated = true
        }
        await rename(from, to)
      },
      link: async (from, to) => {
        renames.push({ from, to })
        await link(from, to)
      },
      unlink: async (path) => {
        if (path === activeGeneration) {
          if (!mutated) {
            writeFileSync(activeGeneration, externalRaw)
            mutated = true
          }
          deletionAttempts += 1
        }
        await unlink(path)
      }
    } })
    await manager.load()
    await manager.save(dashboard('toctou-delete', 'Before'), await manager.observe('toctou-delete'))
    activeGeneration = storedDashboardPaths(root, 'toctou-delete', 'Before')[0]
    expect(activeGeneration).toBeDefined()
    renames.length = 0
    await manager.setPlaylist({ items: [item('toctou-delete')], updatedAt: 1 },
      observedDashboardMutationToken(manager.getPlaylist()))
    manifestPointer = manifestPointerFrom(renames)

    mutateAtCommit = true
    await manager.delete('toctou-delete', await manager.observe('toctou-delete'))

    expect(manager.getDashboard('toctou-delete')).toBeNull()
    expect(mutated).toBe(true)
    expect(deletionAttempts).toBe(0)
    expect(existsSync(activeGeneration)).toBe(true)
    expect(readFileSync(activeGeneration, 'utf8')).toBe(externalRaw)
    const restarted = setup(root).manager
    await restarted.load()
    expect(restarted.getDashboard('toctou-delete')).toBeNull()
  })

  it.each([
    ['newer external sequence', 100, 'conflict'],
    ['same-sequence external bytes with a divergent lineage', 0, 'recovery'],
    ['same-sequence external bytes with the identical hash', 0, 'success']
  ] as const)('hash-compares an atomic hard-link claim and never displaces %s during sync',
  async (caseName, sequenceDelta, expectedOutcome) => {
    const pointer = join(root, 'dashboard-storage-manifest.json')
    let armExternalSync = false
    let externalInstalled = false
    let externalRaw = ''
    let claimedPath = ''
    let claimedReads = 0
    const claimOperations: Array<{ kind: 'link'; from: string; to: string }> = []
    const pointerRemovingRenames: Array<{ from: string; to: string }> = []
    const pointerObservations: Array<{ operation: string; raw: string }> = []
    const observePointer = (operation: string): void => {
      if (!externalInstalled) return
      pointerObservations.push({
        operation,
        raw: existsSync(pointer) ? readFileSync(pointer, 'utf8') : '<missing>'
      })
    }
    const installExternalAtClaim = (from: string, to: string): void => {
      if (!armExternalSync || externalInstalled || from !== pointer || to === pointer) return
      writeFileSync(pointer, externalRaw)
      externalInstalled = true
      claimedPath = to
      claimOperations.push({ kind: 'link', from, to })
      observePointer('installed-before-link')
    }
    const { manager } = setup(root, { fs: {
      readFile: async (path) => {
        const raw = await readFile(path)
        if (externalInstalled && path === claimedPath) claimedReads += 1
        return raw
      },
      rename: async (from, to) => {
        if (armExternalSync && from === pointer) pointerRemovingRenames.push({ from, to })
        observePointer(`before-rename:${basename(from)}->${basename(to)}`)
        await rename(from, to)
        observePointer(`after-rename:${basename(from)}->${basename(to)}`)
      },
      link: async (from, to) => {
        installExternalAtClaim(from, to)
        observePointer(`before-link:${basename(from)}->${basename(to)}`)
        await link(from, to)
        observePointer(`after-link:${basename(from)}->${basename(to)}`)
      },
      unlink: async (path) => {
        observePointer(`before-unlink:${basename(path)}`)
        await unlink(path)
        observePointer(`after-unlink:${basename(path)}`)
      },
      syncDirectory: async () => false
    } })
    await manager.load()
    await manager.save(dashboard('external-sync', 'Local base'), await manager.observe('external-sync'))
    const currentObject = highestImmutableManifestDocument(root)
    const markerChain = ensureCommitMarkerChain(root)
    let externalObject = currentObject
    let externalDashboardRaw = readFileSync(
      join(root, '.dashboard-generations', currentObject.value.dashboards['external-sync'].file),
      'utf8'
    )
    if (expectedOutcome !== 'success') {
      const external = structuredClone(currentObject.value)
      const externalDashboard = dashboard(
        'external-sync',
        sequenceDelta > 0 ? 'External newer winner' : 'External same-sequence winner'
      )
      externalDashboardRaw = prettyJson(externalDashboard)
      const externalFile = writeRawGeneration(root, externalDashboardRaw,
        sequenceDelta > 0 ? 'external-newer' : 'external-same-sequence')
      external.sequence += sequenceDelta
      external.generation = sequenceDelta > 0 ? 'external-newer-manifest' : 'external-same-sequence-manifest'
      external.dashboards['external-sync'] = {
        ...external.dashboards['external-sync'],
        file: externalFile,
        hash: exactTestHash(externalDashboardRaw),
        generation: `cas-v2:${external.generation}`,
        sizeBytes: Buffer.byteLength(externalDashboardRaw, 'utf8')
      }
      externalObject = writeManifestObject(root, external)
      const parentMarker = sequenceDelta > 0
        ? markerChain[markerChain.length - 1]
        : markerChain.find((marker) => marker.value.sequence === currentObject.value.sequence - 1)
      writeCommitMarker(root, {
        version: 1,
        sequence: externalObject.value.sequence,
        manifestHash: externalObject.addressHash,
        parentMarkerHash: parentMarker?.markerHash ?? null
      })
      expect(externalDashboardRaw).not.toBe(readFileSync(
        join(root, '.dashboard-generations', currentObject.value.dashboards['external-sync'].file),
        'utf8'
      ))
    }
    externalRaw = externalObject.raw
    expect(externalObject.addressHash).toBe(exactTestHash(externalRaw))
    expect(externalObject.fileNameSequence).toBe(externalObject.value.sequence)
    armExternalSync = true

    const outcome = await manager.save(
      { ...manager.getDashboard('external-sync')!, name: 'Local committed candidate' },
      await manager.observe('external-sync')
    ).then(
      (value) => ({ status: 'fulfilled' as const, value }),
      (reason: unknown) => ({ status: 'rejected' as const, reason })
    )

    const finalPointerRaw = readFileSync(pointer, 'utf8')
    expect(externalInstalled).toBe(true)
    expect(pointerRemovingRenames).toEqual([])
    expect(claimOperations).toEqual([{ kind: 'link', from: pointer, to: claimedPath }])
    expect(claimedPath).not.toBe('')
    expect(claimedReads).toBeGreaterThan(0)
    expect(pointerObservations.length).toBeGreaterThan(2)
    expect(pointerObservations.map(({ raw }) => raw)).not.toContain('<missing>')
    expect(pointerObservations.every(({ raw }) => raw.length > 0)).toBe(true)
    const restarted = setup(root, { fs: { syncDirectory: async () => false } }).manager
    await restarted.load()
    if (expectedOutcome === 'conflict') {
      expect(restarted.getStorageStatus()).toMatchObject({ state: 'ready', reason: null })
      expect(outcome.status).toBe('rejected')
      if (outcome.status === 'rejected') {
        expect(outcome.reason).toEqual(expect.objectContaining({
          message: expect.stringMatching(/STALE_VERSION|changed/)
        }))
      }
      expect(finalPointerRaw).toBe(externalRaw)
      expect(pointerObservations.every(({ raw }) => raw === externalRaw)).toBe(true)
      expect(restarted.getDashboard('external-sync')).toMatchObject({
        name: sequenceDelta > 0 ? 'External newer winner' : 'External same-sequence winner'
      })
      expect(readFileSync(
        join(root, '.dashboard-generations', externalObject.value.dashboards['external-sync'].file),
        'utf8'
      )).toBe(externalDashboardRaw)
    } else if (expectedOutcome === 'recovery') {
      expect(outcome.status).toBe('rejected')
      expect(finalPointerRaw).toBe(externalRaw)
      expect(pointerObservations.every(({ raw }) => raw === externalRaw)).toBe(true)
      expect(restarted.getStorageStatus()).toMatchObject({
        state: 'recovery',
        reason: expect.stringMatching(/same.sequence|divergent|lineage/i)
      })
      expect(() => restarted.assertAvailable()).toThrow(/RECOVERY_REQUIRED|recovery/i)
    } else {
      expect(restarted.getStorageStatus()).toMatchObject({ state: 'ready', reason: null })
      expect(caseName).toMatch(/identical hash/)
      expect(outcome.status).toBe('fulfilled')
      if (outcome.status === 'fulfilled') {
        expect(outcome.value).toMatchObject({ name: 'Local committed candidate' })
      }
      expect(finalPointerRaw).not.toBe(externalRaw)
      expect(pointerObservations.every(({ raw }) => raw === externalRaw || raw === finalPointerRaw)).toBe(true)
      const finalObject = immutableManifestDocuments(root).find(({ raw }) => raw === finalPointerRaw)
      expect(finalObject).toBeDefined()
      expect(finalObject?.addressHash).toBe(exactTestHash(finalPointerRaw))
      expect(restarted.getDashboard('external-sync')).toMatchObject({ name: 'Local committed candidate' })
    }
  })

  it('leaves the previous manifest visible when the atomic commit-marker swap fails', async () => {
    const renames: Array<{ from: string; to: string }> = []
    let failMarkerSwap = false
    let markerSwapAttempted = false
    const { manager, broadcast } = setup(root, { fs: { rename: async (from, to) => {
      renames.push({ from, to })
      if (failMarkerSwap && COMMIT_MARKER_NAME.test(basename(to))) {
        markerSwapAttempted = true
        throw new Error('commit marker swap failed')
      }
      await rename(from, to)
    }, link: async (from, to) => {
      renames.push({ from, to })
      await link(from, to)
    } } })
    await manager.load()
    await manager.save(dashboard('swap-failure', 'Before'), await manager.observe('swap-failure'))
    renames.length = 0
    await manager.setPlaylist({ items: [item('swap-failure')], updatedAt: 1 },
      observedDashboardMutationToken(manager.getPlaylist()))
    broadcast.mockClear()

    failMarkerSwap = true
    const error = await manager.save(
      { ...manager.getDashboard('swap-failure')!, name: 'Must stay staged' },
      await manager.observe('swap-failure')
    ).then(() => null, (reason: unknown) => reason)
    failMarkerSwap = false

    const restarted = setup(root).manager
    await restarted.load()
    const snapshot = await restarted.exportSnapshot()
    expect(markerSwapAttempted).toBe(true)
    expect(error).toEqual(expect.objectContaining({ message: 'commit marker swap failed' }))
    expect(manager.getDashboard('swap-failure')).toMatchObject({ name: 'Before' })
    expect(restarted.getDashboard('swap-failure')).toMatchObject({ name: 'Before' })
    expect(snapshotDashboard(snapshot, 'swap-failure')).toMatchObject({ name: 'Before' })
    expect(broadcast).not.toHaveBeenCalledWith('app:dash:updated',
      expect.objectContaining({ name: 'Must stay staged' }))
  })

  it('rejects non-canonical serialized dashboard bytes before publishing a manifest', async () => {
    const manager = setup(root).manager
    await manager.load()
    await manager.save(dashboard('canonical', 'Before'), await manager.observe('canonical'))
    const invalid = { ...manager.getDashboard('canonical')! }
    ;(invalid.elements[0].style as Record<string, unknown>).channels = Array(1)

    await expect(manager.save(invalid, await manager.observe('canonical')))
      .rejects.toThrow(/canonical|invalid/i)

    const restarted = setup(root).manager
    await restarted.load()
    expect(restarted.getDashboard('canonical')).toMatchObject({ name: 'Before' })
  })

  it('ignores crash staging leftovers and garbage-collects them best-effort', async () => {
    const seeded = setup(root).manager
    await seeded.load()
    await seeded.save(dashboard('gc-visible', 'Visible'), await seeded.observe('gc-visible'))
    const removable = join(root, '.tmp-manifest-cycle2-removable')
    const denied = join(root, '.tmp-manifest-cycle2-denied')
    writeFileSync(removable, '{crash-before-sync')
    writeFileSync(denied, '{crash-before-manifest')
    const gcAttempts: string[] = []
    const restarted = setup(root, { fs: { unlink: async (path) => {
      if (path === removable || path === denied) gcAttempts.push(path)
      if (path === denied) throw Object.assign(new Error('scanner has file open'), { code: 'EACCES' })
      await unlink(path)
    } } }).manager

    await restarted.load()

    expect(restarted.getStorageStatus()).toMatchObject({ state: 'ready', reason: null })
    expect(restarted.getDashboard('gc-visible')).toMatchObject({ name: 'Visible' })
    expect(gcAttempts).toEqual(expect.arrayContaining([removable, denied]))
    expect(existsSync(removable)).toBe(false)
    expect(existsSync(denied)).toBe(true)
  })

  it('cleans only manager-owned temporary prefixes and preserves unrelated temporary files', async () => {
    const seeded = setup(root).manager
    await seeded.load()
    await seeded.save(dashboard('temp-owner', 'Visible'), await seeded.observe('temp-owner'))
    const owned = join(root, '.tmp-manifest-cycle3-owned')
    const unrelated = join(root, '.tmp-cloud-sync-download')
    writeFileSync(owned, 'owned manifest staging bytes')
    writeFileSync(unrelated, 'another application owns these bytes')

    const restarted = setup(root).manager
    await restarted.load()

    expect(restarted.getStorageStatus()).toMatchObject({ state: 'ready', reason: null })
    expect(restarted.getDashboard('temp-owner')).toMatchObject({ name: 'Visible' })
    expect(existsSync(owned)).toBe(false)
    expect(existsSync(unrelated)).toBe(true)
    expect(readFileSync(unrelated, 'utf8')).toBe('another application owns these bytes')
  })

  it('recovers the highest committed manifest without deleting generations when the pointer is missing', async () => {
    const seeded = setup(root, { fs: { syncDirectory: async () => false } }).manager
    await seeded.load()
    await seeded.save(dashboard('manifest-lost', 'Preserve me'), await seeded.observe('manifest-lost'))
    const generations = storedDashboardPaths(root, 'manifest-lost', 'Preserve me')
    unlinkSync(join(root, 'dashboard-storage-manifest.json'))

    const restarted = setup(root, { fs: { syncDirectory: async () => false } }).manager
    await restarted.load()

    expect(restarted.getStorageStatus()).toMatchObject({ state: 'ready', reason: null })
    expect(restarted.getDashboard('manifest-lost')).toMatchObject({ name: 'Preserve me' })
    expect(generations.every(existsSync)).toBe(true)
  })

  it('rolls back to the newest valid manifest when the pointer survives but its generation is lost', async () => {
    const manager = setup(root).manager
    await manager.load()
    await manager.save(dashboard('rollback-live', 'Before'), await manager.observe('rollback-live'))
    await manager.save(
      { ...manager.getDashboard('rollback-live')!, name: 'After' },
      await manager.observe('rollback-live')
    )
    unlinkSync(storedDashboardPaths(root, 'rollback-live', 'After')[0])

    const restarted = setup(root).manager
    await restarted.load()

    expect(restarted.getStorageStatus()).toMatchObject({ state: 'ready', reason: null })
    expect(restarted.getDashboard('rollback-live')).toMatchObject({ name: 'Before' })
  })

  const postCommitFailureCases: ReadonlyArray<{
    label: string
    key: string
    mutation: 'save' | 'delete' | 'playlist' | 'import'
    failure: 'directory-sync' | 'broadcast'
    channel?: 'app:dash:list' | 'app:dash:updated' | 'app:dash:removed' | 'app:dash:playlist'
    occurrence?: number
  }> = [
    { label: 'returns committed save success after an independent directory-sync failure', key: 'save-sync', mutation: 'save', failure: 'directory-sync' },
    { label: 'returns committed save success when the list broadcast fails', key: 'save-list', mutation: 'save', failure: 'broadcast', channel: 'app:dash:list' },
    { label: 'returns committed save success when the updated broadcast fails', key: 'save-updated', mutation: 'save', failure: 'broadcast', channel: 'app:dash:updated' },
    { label: 'returns committed delete success after an independent directory-sync failure', key: 'delete-sync', mutation: 'delete', failure: 'directory-sync' },
    { label: 'returns committed delete success when the list broadcast fails', key: 'delete-list', mutation: 'delete', failure: 'broadcast', channel: 'app:dash:list' },
    { label: 'returns committed delete success when the removed broadcast fails', key: 'delete-removed', mutation: 'delete', failure: 'broadcast', channel: 'app:dash:removed' },
    { label: 'returns committed playlist success after an independent directory-sync failure', key: 'playlist-sync', mutation: 'playlist', failure: 'directory-sync' },
    { label: 'returns committed playlist success when its broadcast fails', key: 'playlist-event', mutation: 'playlist', failure: 'broadcast', channel: 'app:dash:playlist' },
    { label: 'returns committed multi-import success after an independent directory-sync failure', key: 'import-sync', mutation: 'import', failure: 'directory-sync' },
    { label: 'returns committed multi-import success when the list broadcast fails', key: 'import-list', mutation: 'import', failure: 'broadcast', channel: 'app:dash:list' },
    { label: 'returns committed multi-import success when the first updated broadcast fails', key: 'import-updated-first', mutation: 'import', failure: 'broadcast', channel: 'app:dash:updated', occurrence: 1 },
    { label: 'returns committed multi-import success when a subsequent updated broadcast fails', key: 'import-updated-next', mutation: 'import', failure: 'broadcast', channel: 'app:dash:updated', occurrence: 2 }
  ]

  it.each(postCommitFailureCases.map((testCase) => [testCase.label, testCase] as const))('%s', async (_label, {
    key, mutation, failure, channel: failingBroadcastChannel, occurrence: failingOccurrence = 1
  }) => {
    const id = `post-commit-${key}`
    const importedIds = [`${id}-one`, `${id}-two`]
    let faultActive = false
    const syncCallsDuringFault: string[] = []
    const broadcastOccurrences = new Map<string, number>()
    const directoryFailure = `directory sync failed after ${mutation} swap`
    const broadcastFailure = `broadcast failed after ${mutation} swap: ${failingBroadcastChannel}#${failingOccurrence}`
    const { manager, broadcast } = setup(root, { fs: { syncDirectory: async (path) => {
      if (faultActive) syncCallsDuringFault.push(path)
      if (faultActive && failure === 'directory-sync' && path === root) {
        throw new Error(directoryFailure)
      }
      return true
    } } })
    await manager.load()

    let mutate!: () => Promise<unknown>
    let retryWithStaleToken!: () => Promise<unknown>
    let expectedBroadcastChannels: string[] = []
    if (mutation === 'save') {
      await manager.save(dashboard(id, 'Before save'), await manager.observe(id))
      const token = await manager.observe(id)
      mutate = () => manager.save({ ...manager.getDashboard(id)!, name: 'Save committed' }, token)
      retryWithStaleToken = () => manager.save({ ...manager.getDashboard(id)!, name: 'Duplicate retry' }, token)
      expectedBroadcastChannels = ['app:dash:list', 'app:dash:updated']
    } else if (mutation === 'delete') {
      await manager.save(dashboard(id, 'Before delete'), await manager.observe(id))
      const token = await manager.observe(id)
      mutate = () => manager.delete(id, token)
      retryWithStaleToken = () => manager.save(dashboard(id, 'Duplicate retry'), token)
      expectedBroadcastChannels = ['app:dash:list', 'app:dash:removed']
    } else if (mutation === 'playlist') {
      await manager.save(dashboard(id, 'Playlist dashboard'), await manager.observe(id))
      const token = observedDashboardMutationToken(manager.getPlaylist())
      mutate = () => manager.setPlaylist({ items: [item(id)], updatedAt: 1 }, token)
      retryWithStaleToken = () => manager.setPlaylist({ items: [], updatedAt: 2 }, token)
      expectedBroadcastChannels = ['app:dash:playlist']
    } else {
      const token = await manager.observe(importedIds[0])
      mutate = () => (manager as unknown as {
        importDashboards(values: Dashboard[]): Promise<unknown>
      }).importDashboards([
        dashboard(importedIds[0], 'Import one committed'),
        dashboard(importedIds[1], 'Import two committed')
      ])
      retryWithStaleToken = () => manager.save(
        dashboard(importedIds[0], 'Duplicate retry'),
        token
      )
      expectedBroadcastChannels = ['app:dash:list', 'app:dash:updated', 'app:dash:updated']
    }

    broadcast.mockClear()
    loggerMocks.warn.mockClear()
    broadcast.mockImplementation((broadcastChannel: string) => {
      const occurrence = (broadcastOccurrences.get(broadcastChannel) ?? 0) + 1
      broadcastOccurrences.set(broadcastChannel, occurrence)
      if (faultActive && failure === 'broadcast' &&
        broadcastChannel === failingBroadcastChannel && occurrence === failingOccurrence) {
        throw new Error(broadcastFailure)
      }
    })
    faultActive = true
    const outcome = await mutate().then(
      (value) => ({ status: 'fulfilled' as const, value }),
      (reason: unknown) => ({ status: 'rejected' as const, reason })
    )
    faultActive = false

    expect(outcome.status).toBe('fulfilled')
    if (outcome.status === 'fulfilled') {
      if (mutation === 'save') expect(outcome.value).toMatchObject({ id, name: 'Save committed' })
      if (mutation === 'delete') expect(outcome.value).toEqual(expect.any(Array))
      if (mutation === 'playlist') {
        expect(outcome.value).toMatchObject({ items: [{ dashboardId: id }] })
      }
      if (mutation === 'import') {
        expect(outcome.value).toEqual([
          expect.objectContaining({ id: importedIds[0], name: 'Import one committed' }),
          expect.objectContaining({ id: importedIds[1], name: 'Import two committed' })
        ])
      }
    }
    expect(syncCallsDuringFault).toContain(root)
    if (mutation !== 'delete') {
      expect(syncCallsDuringFault).toContain(join(root, '.dashboard-generations'))
    }
    expect(broadcast.mock.calls.map(([broadcastChannel]) => broadcastChannel))
      .toEqual(expectedBroadcastChannels)
    if (mutation === 'import') {
      expect(broadcast.mock.calls
        .filter(([broadcastChannel]) => broadcastChannel === 'app:dash:updated')
        .map(([, payload]) => (payload as Dashboard).id))
        .toEqual(importedIds)
    }
    const warningMessages = loggerMocks.warn.mock.calls.map(([, message]) => String(message))
    if (failure === 'directory-sync') {
      expect(loggerMocks.warn).toHaveBeenCalledWith(
        'dashboards',
        expect.stringMatching(/directory sync/i),
        expect.objectContaining({ reason: expect.stringContaining(directoryFailure) })
      )
      expect(warningMessages.some((message) => /broadcast/i.test(message))).toBe(false)
    } else {
      expect(loggerMocks.warn).toHaveBeenCalledWith(
        'dashboards',
        expect.stringMatching(/broadcast/i),
        expect.objectContaining({ reason: expect.stringContaining(broadcastFailure) })
      )
      expect(loggerMocks.warn.mock.calls.some(([, , details]) =>
        String((details as { reason?: unknown } | undefined)?.reason).includes(directoryFailure))).toBe(false)
    }

    const pointer = join(root, 'dashboard-storage-manifest.json')
    const pointerAfterCommit = readFileSync(pointer, 'utf8')
    const objectCountAfterCommit = immutableManifestDocuments(root).length
    const generationFilesAfterCommit = readdirSync(join(root, '.dashboard-generations')).sort()
    await expect(retryWithStaleToken()).rejects.toThrow(/STALE_VERSION/)
    expect(readFileSync(pointer, 'utf8')).toBe(pointerAfterCommit)
    expect(immutableManifestDocuments(root)).toHaveLength(objectCountAfterCommit)
    expect(readdirSync(join(root, '.dashboard-generations')).sort()).toEqual(generationFilesAfterCommit)
    expect(storedDashboardPaths(root, id, 'Duplicate retry')).toEqual([])
    expect(storedDashboardPaths(root, importedIds[0], 'Duplicate retry')).toEqual([])

    const restarted = setup(root).manager
    await restarted.load()
    expect(restarted.getStorageStatus()).toMatchObject({ state: 'ready', reason: null })
    if (mutation === 'save') {
      expect(restarted.getDashboard(id)).toMatchObject({ name: 'Save committed' })
      expect(storedDashboardPaths(root, id, 'Save committed')).toHaveLength(1)
    } else if (mutation === 'delete') {
      expect(restarted.getDashboard(id)).toBeNull()
      expect(snapshotDashboard(await restarted.exportSnapshot(), id)).toBeUndefined()
    } else if (mutation === 'playlist') {
      expect(restarted.getPlaylist().items.map(({ dashboardId }) => dashboardId)).toEqual([id])
    } else {
      expect(restarted.getDashboard(importedIds[0])).toMatchObject({ name: 'Import one committed' })
      expect(restarted.getDashboard(importedIds[1])).toMatchObject({ name: 'Import two committed' })
      expect(storedDashboardPaths(root, importedIds[0], 'Import one committed')).toHaveLength(1)
      expect(storedDashboardPaths(root, importedIds[1], 'Import two committed')).toHaveLength(1)
    }
  })

  it('persists a delete tombstone so its revision survives restart', async () => {
    const manager = setup(root).manager
    await manager.load()
    await manager.save(dashboard('deleted-id', 'Before delete'), await manager.observe('deleted-id'))
    await manager.delete('deleted-id', await manager.observe('deleted-id'))
    const deletedRevision = (await manager.observe('deleted-id')).revision

    const restarted = setup(root).manager
    await restarted.load()
    const restartedToken = await restarted.observe('deleted-id')
    const snapshot = await restarted.exportSnapshot()

    expect(deletedRevision).toMatch(/^tombstone:/)
    expect(restarted.getDashboard('deleted-id')).toBeNull()
    expect(restartedToken.revision).toBe(deletedRevision)
    expect(snapshotDashboard(snapshot, 'deleted-id')).toBeUndefined()
    await restarted.save(dashboard('deleted-id', 'Recreated'), restartedToken)
    expect((await restarted.observe('deleted-id')).revision).not.toBe(deletedRevision)
    expect(restarted.getDashboard('deleted-id')).toMatchObject({ name: 'Recreated' })
  })

  it('imports multiple dashboards all-or-none and cleans every staged generation on failure', async () => {
    let importing = false
    const stagedWrites: string[] = []
    const { manager, broadcast } = setup(root, { fs: { openExclusive: async (path) => {
      const handle = await open(path, 'wx')
      return {
        writeFile: async (data, encoding) => {
          if (importing && (data.includes('"id": "batch-one"') || data.includes('"id": "batch-two"'))) {
            stagedWrites.push(path)
          }
          if (importing && data.includes('"id": "batch-two"')) throw new Error('second generation stage failed')
          await handle.writeFile(data, { encoding })
        },
        sync: () => handle.sync(),
        close: () => handle.close()
      }
    } } })
    await manager.load()
    broadcast.mockClear()
    importing = true
    const error = await (manager as unknown as {
      importDashboards(values: Dashboard[]): Promise<unknown>
    }).importDashboards([
      dashboard('batch-one', 'Batch one'),
      dashboard('batch-two', 'Batch two')
    ]).then(() => null, (reason: unknown) => reason)
    importing = false

    expect(error).toEqual(expect.objectContaining({ message: 'second generation stage failed' }))
    expect(stagedWrites).toHaveLength(2)
    expect(manager.getDashboard('batch-one')).toBeNull()
    expect(manager.getDashboard('batch-two')).toBeNull()
    expect(filesBelow(root).map((path) => readFileSync(path, 'utf8')).join('\n')).not.toMatch(/batch-(one|two)/)
    expect(filesBelow(root).filter((path) => path.includes('.tmp-'))).toEqual([])
    expect(broadcast.mock.calls.filter(([channel]) =>
      channel === 'app:dash:list' || channel === 'app:dash:updated')).toEqual([])

    const restarted = setup(root).manager
    await restarted.load()
    expect(restarted.getDashboard('batch-one')).toBeNull()
    expect(restarted.getDashboard('batch-two')).toBeNull()
    const committed = await (restarted as unknown as {
      importDashboards(values: Dashboard[]): Promise<unknown[]>
    }).importDashboards([
      dashboard('batch-one', 'Batch one committed'),
      dashboard('batch-two', 'Batch two committed')
    ])
    expect(committed).toHaveLength(2)
    expect(restarted.getDashboard('batch-one')).toMatchObject({ name: 'Batch one committed' })
    expect(restarted.getDashboard('batch-two')).toMatchObject({ name: 'Batch two committed' })
  })

  it.each([
    ['success', null],
    ['mid-batch adapter failure', 2]
  ] as const)('stages one stable batch source and cleans it after %s', async (_outcome, failOnCall) => {
    const source = join(root, 'external-source.simhubdash')
    const sourceRaw = 'stable SimHub archive bytes for all three screens'
    const externallyChangedRaw = 'externally replaced archive bytes after the first adapter call'
    const screens = [
      { index: 0, name: 'Screen one', width: 100, height: 60 },
      { index: 1, name: 'Screen two', width: 100, height: 60 },
      { index: 2, name: 'Screen three', width: 100, height: 60 }
    ]
    const adapterCalls: Array<{ path: string; screenIndex: number | undefined; raw: string }> = []
    const stagedWrites: Array<{ path: string; raw: string }> = []
    let originalSourceReads = 0
    simhubMocks.importDash.mockImplementation(async (
      path: string,
      options: { screenIndex?: number } = {}
    ) => {
      const raw = readFileSync(path, 'utf8')
      adapterCalls.push({ path, screenIndex: options.screenIndex, raw })
      if (adapterCalls.length === 1) writeFileSync(source, externallyChangedRaw)
      const index = options.screenIndex ?? 0
      if (adapterCalls.length === failOnCall) throw new Error('second adapter failed')
      return {
        dashboard: dashboard(`staged-source-${index}`, `Screen ${index + 1}`),
        notes: [`screen-${index}`, 'shared-note'],
        screens,
        selectedScreenIndex: index
      }
    })
    const manager = setup(root, { fs: {
      readFile: async (path) => {
        if (path === source) originalSourceReads += 1
        return readFile(path)
      },
      openExclusive: async (path) => {
        const handle = await open(path, 'wx')
        return {
          writeFile: async (data, encoding) => {
            if (data === sourceRaw) stagedWrites.push({ path, raw: data })
            await handle.writeFile(data, { encoding })
          },
          sync: () => handle.sync(),
          close: () => handle.close()
        }
      }
    } }).manager
    await manager.load()
    writeFileSync(source, sourceRaw)

    const result = await manager.importSimhub(source, { importAll: true }).then(
      (value) => ({ status: 'fulfilled' as const, value }),
      (reason: unknown) => ({ status: 'rejected' as const, reason })
    )

    expect(originalSourceReads).toBe(1)
    expect(stagedWrites).toHaveLength(1)
    expect(stagedWrites[0].raw).toBe(sourceRaw)
    const expectedScreenIndices = failOnCall === null ? [undefined, 1, 2] : [undefined, 1]
    expect(adapterCalls.map(({ screenIndex }) => screenIndex)).toEqual(expectedScreenIndices)
    expect(new Set(adapterCalls.map(({ path }) => path)).size).toBe(1)
    const stagedSource = adapterCalls[0].path
    expect(stagedSource).not.toBe(source)
    expect(stagedWrites[0].path).toBe(stagedSource)
    expect(adapterCalls.map(({ raw }) => raw)).toEqual(expectedScreenIndices.map(() => sourceRaw))
    expect(readFileSync(source, 'utf8')).toBe(externallyChangedRaw)
    expect(existsSync(stagedSource)).toBe(false)
    expect(filesBelow(root).filter((path) => {
      try { return path !== source && readFileSync(path, 'utf8') === sourceRaw } catch { return false }
    })).toEqual([])
    if (failOnCall === null) {
      expect(result.status).toBe('fulfilled')
      if (result.status === 'fulfilled') {
        expect(result.value).toEqual({
          summaries: [
            expect.objectContaining({ id: 'staged-source-0', name: 'Screen 1' }),
            expect.objectContaining({ id: 'staged-source-1', name: 'Screen 2' }),
            expect.objectContaining({ id: 'staged-source-2', name: 'Screen 3' })
          ],
          notes: ['screen-0', 'shared-note', 'screen-1', 'screen-2'],
          screens,
          selectedScreenIndex: 0,
          filePath: source
        })
      }
      expect(manager.getDashboard('staged-source-0')).toMatchObject({ name: 'Screen 1' })
      expect(manager.getDashboard('staged-source-1')).toMatchObject({ name: 'Screen 2' })
      expect(manager.getDashboard('staged-source-2')).toMatchObject({ name: 'Screen 3' })
    } else {
      expect(result).toMatchObject({
        status: 'rejected',
        reason: { message: 'second adapter failed' }
      })
      expect(manager.getDashboard('staged-source-0')).toBeNull()
      expect(manager.getDashboard('staged-source-1')).toBeNull()
      expect(manager.getDashboard('staged-source-2')).toBeNull()
    }
  })

  it('imports mixed-case legacy ownership while holding the cross-instance storage lock', async () => {
    writeDash(root, 'Legacy Physical.JSON', dashboard('mixed-case', 'Mixed case'))
    writeFileSync(join(root, 'DASHBOARD-PLAYLIST.JSON'), prettyJson({
      items: [item('mixed-case')],
      updatedAt: 5
    }))
    let signalRename!: () => void
    let releaseRename!: () => void
    const renameEntered = new Promise<void>((resolve) => { signalRename = resolve })
    const renameGate = new Promise<void>((resolve) => { releaseRename = resolve })
    let blockedFirstRename = false
    const first = setup(root, { fs: { rename: async (from, to) => {
      if (!blockedFirstRename && to.endsWith('dashboard-storage-manifest.json')) {
        blockedFirstRename = true
        signalRename()
        await renameGate
      }
      await rename(from, to)
    }, link: async (from, to) => {
      await link(from, to)
    } } }).manager
    const firstLoad = first.load()
    const firstStep = await Promise.race([
      renameEntered.then(() => 'manifest-rename' as const),
      firstLoad.then(() => 'load-complete' as const)
    ])
    let second: DashboardManager | null = null
    let secondLoad: Promise<void> | null = null
    let secondStateDuringCommit: ReturnType<DashboardManager['getStorageStatus']>['state'] | null = null
    try {
      if (firstStep === 'manifest-rename') {
        second = setup(root).manager
        secondLoad = second.load()
        await Promise.resolve()
        await Promise.resolve()
        secondStateDuringCommit = second.getStorageStatus().state
      }
    } finally {
      releaseRename()
    }
    await firstLoad
    if (secondLoad) await secondLoad

    expect(firstStep).toBe('manifest-rename')
    expect(secondStateDuringCommit).toBe('loading')
    expect(first.getStorageStatus()).toMatchObject({ state: 'ready', reason: null })
    expect(second?.getStorageStatus()).toMatchObject({ state: 'ready', reason: null })
    expect(first.getDashboard('mixed-case')).toMatchObject({ name: 'Mixed case' })
    expect(second?.getDashboard('mixed-case')).toMatchObject({ name: 'Mixed case' })
    expect(Object.keys((await first.exportSnapshot()).files).sort()).toEqual([
      'DASHBOARD-PLAYLIST.JSON',
      'Legacy Physical.JSON'
    ])
  })

  it('exports from exactly one manifest snapshot without enumerating mutable storage', async () => {
    const renames: Array<{ from: string; to: string }> = []
    let exporting = false
    let manifestPointer = ''
    let manifestReads = 0
    const { manager } = setup(root, { fs: {
      rename: async (from, to) => {
        renames.push({ from, to })
        await rename(from, to)
      },
      link: async (from, to) => {
        renames.push({ from, to })
        await link(from, to)
      },
      readdir: async (path) => {
        if (exporting) throw new Error('export enumerated mutable storage')
        return readdir(path)
      },
      readFile: async (path) => {
        const raw = await readFile(path)
        if (exporting && path === manifestPointer) {
          manifestReads += 1
          if (manifestReads > 1) throw new Error('export re-read manifest')
        }
        return raw
      }
    } })
    await manager.load()
    await manager.save(dashboard('snapshot-id', 'One manifest'), await manager.observe('snapshot-id'))
    renames.length = 0
    await manager.setPlaylist({ items: [item('snapshot-id')], updatedAt: 1 },
      observedDashboardMutationToken(manager.getPlaylist()))
    manifestPointer = manifestPointerFrom(renames)

    exporting = true
    let snapshot: Awaited<ReturnType<DashboardManager['exportSnapshot']>> | null = null
    let error: unknown = null
    try {
      snapshot = await manager.exportSnapshot()
    } catch (reason) {
      error = reason
    } finally {
      exporting = false
    }

    expect(error).toBeNull()
    expect(manifestPointer).not.toBe('')
    expect(manifestReads).toBe(1)
    expect(snapshotDashboard(snapshot!, 'snapshot-id')).toMatchObject({ name: 'One manifest' })
    expect(snapshot?.itemCount).toBe(2)
    expect(snapshot?.sizeBytes).toBeGreaterThan(0)
  })

  it('publishes a content-addressed commit marker after its manifest object and before the advisory pointer', async () => {
    type Operation = {
      kind: 'open' | 'write' | 'sync' | 'close' | 'rename'
      path: string
      to?: string
    }
    const operations: Operation[] = []
    const pointer = join(root, 'dashboard-storage-manifest.json')
    const { manager } = setup(root, { fs: {
      openExclusive: async (path) => {
        operations.push({ kind: 'open', path })
        const handle = await open(path, 'wx')
        return {
          writeFile: async (data, encoding) => {
            operations.push({ kind: 'write', path })
            await handle.writeFile(data, { encoding })
          },
          sync: async () => {
            operations.push({ kind: 'sync', path })
            await handle.sync()
          },
          close: async () => {
            operations.push({ kind: 'close', path })
            await handle.close()
          }
        }
      },
      rename: async (from, to) => {
        operations.push({ kind: 'rename', path: from, to })
        await rename(from, to)
      }
    } })
    await manager.load()
    await manager.save(dashboard('marker-order', 'First marker'), await manager.observe('marker-order'))
    operations.length = 0

    await manager.save(
      { ...manager.getDashboard('marker-order')!, name: 'Second marker' },
      await manager.observe('marker-order')
    )

    const objects = immutableManifestDocuments(root).sort((a, b) => a.value.sequence - b.value.sequence)
    const markers = commitMarkerDocuments(root).sort((a, b) => a.value.sequence - b.value.sequence)
    expect(markers.map(({ value }) => value.sequence)).toEqual([1, 2, 3])
    expect(markers).toHaveLength(objects.length)
    let parentMarkerHash: string | null = null
    for (const marker of markers) {
      const object = objects.find(({ value }) => value.sequence === marker.value.sequence)
      expect(Number.isSafeInteger(marker.value.sequence)).toBe(true)
      expect(marker.value.sequence).toBeGreaterThan(0)
      expect(marker.fileNameSequence).toBe(marker.value.sequence)
      expect(basename(marker.path)).toBe(`c.${marker.value.sequence}.${marker.markerHash}.json`)
      expect(marker.markerHash).toBe(exactTestHash(marker.raw))
      expect(marker.value.manifestHash).toBe(object?.addressHash)
      expect(marker.value.parentMarkerHash).toBe(parentMarkerHash)
      parentMarkerHash = marker.markerHash
    }

    const newestMarker = markers[markers.length - 1]
    const newestObject = objects.find(({ addressHash }) =>
      addressHash === newestMarker.value.manifestHash)!
    const markerPublishIndex = operations.findIndex(({ kind, to }) =>
      kind === 'rename' && to === newestMarker.path)
    expect(markerPublishIndex).toBeGreaterThanOrEqual(0)
    const markerPublication = operations[markerPublishIndex]
    expect(COMMIT_MARKER_TEMP_NAME.test(basename(markerPublication.path))).toBe(true)
    expect(operations.findIndex(({ kind, path }) =>
      kind === 'sync' && path === markerPublication.path)).toBeLessThan(markerPublishIndex)
    const objectReadyIndex = operations.reduce((latest, operation, index) => {
      const touchesObject = operation.path === newestObject.path || operation.to === newestObject.path
      return touchesObject && ['sync', 'close', 'rename'].includes(operation.kind) ? index : latest
    }, -1)
    const pointerPublishIndex = operations.findIndex(({ kind, to }) =>
      kind === 'rename' && to === pointer)
    expect(objectReadyIndex).toBeGreaterThanOrEqual(0)
    expect(objectReadyIndex).toBeLessThan(markerPublishIndex)
    expect(pointerPublishIndex).toBeGreaterThan(markerPublishIndex)
    expect(existsSync(markerPublication.path)).toBe(false)
    expect(readFileSync(pointer, 'utf8')).toBe(newestObject.raw)
  })

  it.each([
    'manifest object only',
    'marker with another manifest hash',
    'marker with an unknown parent lineage',
    'marker with a non-tip parent lineage',
    'marker whose filename hash does not match its bytes',
    'marker whose sequence does not match its manifest',
    'marker temp never renamed to its final name'
  ] as const)('does not authorize a candidate from %s', async (failureMode) => {
    const seeded = setup(root).manager
    await seeded.load()
    await seeded.save(dashboard('marker-auth', 'Authorized base'), await seeded.observe('marker-auth'))
    const baseObject = highestImmutableManifestDocument(root)
    const markerChain = ensureCommitMarkerChain(root)
    const baseMarker = markerChain.find((marker) =>
      marker.value.sequence === baseObject.value.sequence)!
    const nonTipMarker = markerChain
      .filter((marker) => marker.value.sequence < baseMarker.value.sequence)
      .sort((a, b) => b.value.sequence - a.value.sequence)[0]
    const candidate = writeDashboardManifestCandidate(
      root,
      baseObject,
      dashboard('marker-auth', 'Must remain uncommitted'),
      `marker-auth-${failureMode.replaceAll(' ', '-')}`
    )
    const markerValue: CommitMarkerDocument['value'] = {
      version: 1,
      sequence: failureMode === 'marker whose sequence does not match its manifest'
        ? candidate.value.sequence + 1
        : candidate.value.sequence,
      manifestHash: failureMode === 'marker with another manifest hash'
        ? 'x'.repeat(43)
        : candidate.addressHash,
      parentMarkerHash: failureMode === 'marker with an unknown parent lineage'
        ? 'y'.repeat(43)
        : failureMode === 'marker with a non-tip parent lineage'
          ? nonTipMarker.markerHash
        : baseMarker.markerHash
    }
    if (failureMode === 'marker temp never renamed to its final name') {
      const tempRaw = prettyJson(markerValue)
      writeFileSync(join(root, '.dashboard-manifests',
        `.tmp-commit-marker-aborted-${exactTestHash(tempRaw)}.json`), tempRaw)
    } else if (failureMode === 'marker whose filename hash does not match its bytes') {
      const raw = prettyJson(markerValue)
      writeFileSync(join(root, '.dashboard-manifests',
        `c.${markerValue.sequence}.${'z'.repeat(43)}.json`), raw)
    } else if (failureMode !== 'manifest object only') {
      writeCommitMarker(root, markerValue)
    }
    writeFileSync(join(root, 'dashboard-storage-manifest.json'), candidate.raw)

    const restarted = setup(root).manager
    await restarted.load()

    expect(restarted.getStorageStatus()).toMatchObject({ state: 'ready', reason: null })
    expect(restarted.getDashboard('marker-auth')).toMatchObject({ name: 'Authorized base' })
    expect(snapshotDashboard(await restarted.exportSnapshot(), 'marker-auth'))
      .toMatchObject({ name: 'Authorized base' })
    expect(readFileSync(join(root, 'dashboard-storage-manifest.json'), 'utf8')).toBe(baseObject.raw)
    expect(commitMarkerDocuments(root).some((marker) =>
      marker.value.sequence === candidate.value.sequence &&
      marker.value.manifestHash === candidate.addressHash &&
      marker.value.parentMarkerHash === baseMarker.markerHash)).toBe(false)
    const candidateLocations = filesBelow(root).filter((path) => {
      try { return readFileSync(path, 'utf8') === candidate.raw } catch { return false }
    })
    expect(candidateLocations.length).toBeGreaterThan(0)
    expect(candidateLocations.every((path) =>
      path.includes('.dashboard-manifests') ||
      path.includes('.dashboard-quarantine') ||
      basename(path).startsWith('.tmp-'))).toBe(true)
  })

  it('does not reconstruct a missing manifest object from pointer or backup bytes without an authorizing marker', async () => {
    const pointer = join(root, 'dashboard-storage-manifest.json')
    const backup = join(root, '.manifest-previous-unmarked-candidate')
    const seeded = setup(root).manager
    await seeded.load()
    await seeded.save(dashboard('unmarked-rebuild', 'Authorized base'),
      await seeded.observe('unmarked-rebuild'))
    const base = highestImmutableManifestDocument(root)
    ensureCommitMarkerChain(root)
    const candidate = writeDashboardManifestCandidate(
      root,
      base,
      dashboard('unmarked-rebuild', 'Unmarked backup candidate'),
      'unmarked-backup-candidate'
    )
    unlinkSync(candidate.path)
    writeFileSync(pointer, candidate.raw)
    writeFileSync(backup, candidate.raw)

    const restarted = setup(root).manager
    await restarted.load()

    expect(restarted.getStorageStatus()).toMatchObject({ state: 'ready', reason: null })
    expect(restarted.getDashboard('unmarked-rebuild')).toMatchObject({ name: 'Authorized base' })
    expect(snapshotDashboard(await restarted.exportSnapshot(), 'unmarked-rebuild'))
      .toMatchObject({ name: 'Authorized base' })
    expect(existsSync(candidate.path)).toBe(false)
    expect(readFileSync(pointer, 'utf8')).toBe(base.raw)
    expect(readFileSync(backup, 'utf8')).toBe(candidate.raw)
    expect(commitMarkerDocuments(root).some(({ value }) =>
      value.manifestHash === candidate.addressHash)).toBe(false)
  })

  it('returns committed success with a warning when marker publication wins but pointer refresh fails', async () => {
    const pointer = join(root, 'dashboard-storage-manifest.json')
    let faultActive = false
    let markerPublished = false
    let pointerFailureInjected = false
    const pointerError = Object.assign(new Error('advisory pointer refresh failed'), { code: 'EIO' })
    const { manager } = setup(root, { fs: {
      rename: async (from, to) => {
        if (faultActive && COMMIT_MARKER_NAME.test(basename(to))) {
          await rename(from, to)
          markerPublished = true
          return
        }
        if (faultActive && markerPublished && to === pointer) {
          pointerFailureInjected = true
          throw pointerError
        }
        await rename(from, to)
      },
      syncDirectory: async () => true
    } })
    await manager.load()
    await manager.save(dashboard('marker-pointer-failure', 'Before'), await manager.observe('marker-pointer-failure'))
    const pointerBefore = readFileSync(pointer, 'utf8')
    const markerCountBefore = commitMarkerDocuments(root).length
    loggerMocks.warn.mockClear()
    faultActive = true

    const outcome = await manager.save(
      { ...manager.getDashboard('marker-pointer-failure')!, name: 'Committed by marker' },
      await manager.observe('marker-pointer-failure')
    ).then(
      (value) => ({ status: 'fulfilled' as const, value }),
      (reason: unknown) => ({ status: 'rejected' as const, reason })
    )
    faultActive = false

    expect(markerPublished).toBe(true)
    expect(pointerFailureInjected).toBe(true)
    expect(outcome.status).toBe('fulfilled')
    if (outcome.status === 'fulfilled') {
      expect(outcome.value).toMatchObject({
        id: 'marker-pointer-failure',
        name: 'Committed by marker'
      })
    }
    expect(readFileSync(pointer, 'utf8')).toBe(pointerBefore)
    expect(commitMarkerDocuments(root)).toHaveLength(markerCountBefore + 1)
    expect(manager.getStorageStatus() as ReturnType<DashboardManager['getStorageStatus']> & {
      durable: boolean
      recoverable: boolean
    }).toMatchObject({ durable: true, recoverable: true })
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      'dashboards',
      expect.stringMatching(/pointer.*commit|commit.*pointer/i),
      expect.objectContaining({ reason: expect.stringContaining(pointerError.message) })
    )

    const restarted = setup(root).manager
    await restarted.load()
    const latestObject = highestImmutableManifestDocument(root)
    expect(restarted.getStorageStatus()).toMatchObject({ state: 'ready', reason: null })
    expect(restarted.getDashboard('marker-pointer-failure'))
      .toMatchObject({ name: 'Committed by marker' })
    expect(readFileSync(pointer, 'utf8')).toBe(latestObject.raw)
  })

  it('rejects a failed marker publication and never applies its markerless artifacts after restart', async () => {
    const pointer = join(root, 'dashboard-storage-manifest.json')
    let faultActive = false
    let markerFailureInjected = false
    let failedMarkerTemp = ''
    const markerError = Object.assign(new Error('commit marker publication failed'), { code: 'EIO' })
    const { manager } = setup(root, { fs: { rename: async (from, to) => {
      if (faultActive && COMMIT_MARKER_NAME.test(basename(to))) {
        markerFailureInjected = true
        failedMarkerTemp = from
        throw markerError
      }
      await rename(from, to)
    } } })
    await manager.load()
    await manager.save(dashboard('marker-abort', 'Before abort'), await manager.observe('marker-abort'))
    const pointerBefore = readFileSync(pointer, 'utf8')
    const objectsBefore = immutableManifestDocuments(root)
    const markersBefore = commitMarkerDocuments(root)
    faultActive = true

    const outcome = await manager.save(
      { ...manager.getDashboard('marker-abort')!, name: 'Aborted candidate' },
      await manager.observe('marker-abort')
    ).then(
      (value) => ({ status: 'fulfilled' as const, value }),
      (reason: unknown) => ({ status: 'rejected' as const, reason })
    )
    faultActive = false

    expect(markerFailureInjected).toBe(true)
    expect(outcome.status).toBe('rejected')
    if (outcome.status === 'rejected') {
      expect(outcome.reason).toEqual(expect.objectContaining({
        code: 'EIO',
        message: markerError.message
      }))
    }
    expect(readFileSync(pointer, 'utf8')).toBe(pointerBefore)
    expect(manager.getDashboard('marker-abort')).toMatchObject({ name: 'Before abort' })
    expect(commitMarkerDocuments(root)).toHaveLength(markersBefore.length)
    const abortedObjects = immutableManifestDocuments(root).filter(({ path }) =>
      !objectsBefore.some((before) => before.path === path))
    expect(abortedObjects).toHaveLength(1)
    expect(COMMIT_MARKER_TEMP_NAME.test(basename(failedMarkerTemp))).toBe(true)

    const restarted = setup(root).manager
    await restarted.load()
    expect(restarted.getStorageStatus()).toMatchObject({ state: 'ready', reason: null })
    expect(restarted.getDashboard('marker-abort')).toMatchObject({ name: 'Before abort' })
    expect(snapshotDashboard(await restarted.exportSnapshot(), 'marker-abort'))
      .toMatchObject({ name: 'Before abort' })
    expect(commitMarkerDocuments(root).some((marker) =>
      marker.value.manifestHash === abortedObjects[0].addressHash)).toBe(false)
    const abortedDashboardLocations = storedDashboardPaths(root, 'marker-abort', 'Aborted candidate')
    expect(abortedDashboardLocations.length).toBeGreaterThan(0)
    expect(abortedDashboardLocations.every((path) =>
      path.includes('.dashboard-generations') ||
      path.includes('.dashboard-quarantine'))).toBe(true)
  })

  it.each([
    'exact active pointer payload',
    'exact backup with a missing pointer',
    'exact backup while an older pointer is present'
  ] as const)('reconstructs a missing marker-authorized manifest object from the %s', async (source) => {
    const pointer = join(root, 'dashboard-storage-manifest.json')
    const backup = join(root, '.manifest-previous-marker-recovery')
    const seeded = setup(root).manager
    await seeded.load()
    await seeded.save(dashboard('marker-rebuild', 'Before'), await seeded.observe('marker-rebuild'))
    await seeded.save(
      { ...seeded.getDashboard('marker-rebuild')!, name: 'Newest authorized' },
      await seeded.observe('marker-rebuild')
    )
    const objects = immutableManifestDocuments(root).sort((a, b) => a.value.sequence - b.value.sequence)
    const newest = objects[objects.length - 1]
    const older = objects[objects.length - 2]
    const marker = ensureCommitMarkerChain(root).find((candidate) =>
      candidate.value.manifestHash === newest.addressHash)!
    const markerRaw = readFileSync(marker.path, 'utf8')
    unlinkSync(newest.path)
    if (source === 'exact active pointer payload') {
      writeFileSync(pointer, newest.raw)
    } else {
      writeFileSync(backup, newest.raw)
      if (source === 'exact backup with a missing pointer') unlinkSync(pointer)
      else writeFileSync(pointer, older.raw)
    }

    const restarted = setup(root).manager
    await restarted.load()

    expect(restarted.getStorageStatus()).toMatchObject({ state: 'ready', reason: null })
    expect(restarted.getDashboard('marker-rebuild')).toMatchObject({ name: 'Newest authorized' })
    expect(snapshotDashboard(await restarted.exportSnapshot(), 'marker-rebuild'))
      .toMatchObject({ name: 'Newest authorized' })
    expect(existsSync(newest.path)).toBe(true)
    expect(readFileSync(newest.path, 'utf8')).toBe(newest.raw)
    expect(readFileSync(marker.path, 'utf8')).toBe(markerRaw)
    expect(readFileSync(pointer, 'utf8')).toBe(newest.raw)
    expect(exactTestHash(readFileSync(pointer, 'utf8'))).toBe(marker.value.manifestHash)
  })

  it('enters explicit recovery for equal-sequence markers on divergent lineages', async () => {
    const pointer = join(root, 'dashboard-storage-manifest.json')
    const seeded = setup(root).manager
    await seeded.load()
    await seeded.save(dashboard('marker-fork', 'Base'), await seeded.observe('marker-fork'))
    await seeded.save(
      { ...seeded.getDashboard('marker-fork')!, name: 'Mainline' },
      await seeded.observe('marker-fork')
    )
    const mainline = highestImmutableManifestDocument(root)
    const mainlineMarker = ensureCommitMarkerChain(root).find((marker) =>
      marker.value.manifestHash === mainline.addressHash)!
    const fork = writeDashboardManifestCandidate(
      root,
      mainline,
      dashboard('marker-fork', 'Divergent fork'),
      'equal-sequence-divergent',
      mainline.value.sequence
    )
    const forkMarker = writeCommitMarker(root, {
      version: 1,
      sequence: fork.value.sequence,
      manifestHash: fork.addressHash,
      parentMarkerHash: mainlineMarker.value.parentMarkerHash
    })
    const pointerBefore = readFileSync(pointer, 'utf8')

    const restarted = setup(root).manager
    await restarted.load()

    expect(fork.addressHash).not.toBe(mainline.addressHash)
    expect(forkMarker.value.sequence).toBe(mainlineMarker.value.sequence)
    expect(forkMarker.value.parentMarkerHash).toBe(mainlineMarker.value.parentMarkerHash)
    const status = restarted.getStorageStatus() as ReturnType<DashboardManager['getStorageStatus']> & {
      durable: boolean
      recoverable: boolean
    }
    expect(status).toMatchObject({
      state: 'recovery',
      reason: expect.stringMatching(/equal|same.sequence|divergent|lineage/i),
      durable: false,
      recoverable: false
    })
    expect(() => restarted.assertAvailable()).toThrow(/RECOVERY_REQUIRED|recovery/i)
    expect(readFileSync(pointer, 'utf8')).toBe(pointerBefore)
    expect(existsSync(mainline.path)).toBe(true)
    expect(existsSync(fork.path)).toBe(true)
  })

  it.each([
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1
  ])('never authorizes a manifest or commit marker with unsafe sequence %s', async (sequence) => {
    const pointer = join(root, 'dashboard-storage-manifest.json')
    const seeded = setup(root).manager
    await seeded.load()
    await seeded.save(dashboard('unsafe-sequence', 'Safe base'), await seeded.observe('unsafe-sequence'))
    const base = highestImmutableManifestDocument(root)
    const baseMarker = ensureCommitMarkerChain(root).find((marker) =>
      marker.value.manifestHash === base.addressHash)!
    const unsafe = writeDashboardManifestCandidate(
      root,
      base,
      dashboard('unsafe-sequence', 'Unsafe candidate'),
      `unsafe-${String(sequence).replace('.', '-')}`,
      sequence
    )
    const unsafeMarkerRaw = prettyJson({
      version: 1,
      sequence,
      manifestHash: unsafe.addressHash,
      parentMarkerHash: baseMarker.markerHash
    })
    const unsafeMarkerHash = exactTestHash(unsafeMarkerRaw)
    writeFileSync(join(root, '.dashboard-manifests',
      `c.${sequence}.${unsafeMarkerHash}.json`), unsafeMarkerRaw)
    writeFileSync(pointer, unsafe.raw)

    const restarted = setup(root).manager
    await restarted.load()

    expect(restarted.getStorageStatus()).toMatchObject({ state: 'ready', reason: null })
    expect(restarted.getDashboard('unsafe-sequence')).toMatchObject({ name: 'Safe base' })
    expect(readFileSync(pointer, 'utf8')).toBe(base.raw)
    expect(commitMarkerDocuments(root).some(({ value }) => value.sequence === sequence)).toBe(false)
  })

  it('refuses sequence overflow before publishing an object, marker, or pointer', async () => {
    const pointer = join(root, 'dashboard-storage-manifest.json')
    const seeded = setup(root).manager
    await seeded.load()
    await seeded.save(dashboard('sequence-overflow', 'Safe base'), await seeded.observe('sequence-overflow'))
    const base = highestImmutableManifestDocument(root)
    const baseMarker = ensureCommitMarkerChain(root).find((marker) =>
      marker.value.manifestHash === base.addressHash)!
    const maximum = writeDashboardManifestCandidate(
      root,
      base,
      dashboard('sequence-overflow', 'Maximum sequence'),
      'maximum-safe-sequence',
      Number.MAX_SAFE_INTEGER
    )
    writeCommitMarker(root, {
      version: 1,
      sequence: maximum.value.sequence,
      manifestHash: maximum.addressHash,
      parentMarkerHash: baseMarker.markerHash
    })
    writeFileSync(pointer, maximum.raw)
    const manager = setup(root).manager
    await manager.load()
    expect(manager.getDashboard('sequence-overflow')).toMatchObject({ name: 'Maximum sequence' })
    const markerPathsBefore = commitMarkerDocuments(root).map(({ path }) => path).sort()
    const objectPathsBefore = immutableManifestDocuments(root).map(({ path }) => path).sort()
    const pointerBefore = readFileSync(pointer, 'utf8')

    await expect(manager.save(
      { ...manager.getDashboard('sequence-overflow')!, name: 'Must not wrap' },
      await manager.observe('sequence-overflow')
    )).rejects.toThrow(/sequence|overflow|safe integer/i)

    expect(readFileSync(pointer, 'utf8')).toBe(pointerBefore)
    expect(commitMarkerDocuments(root).map(({ path }) => path).sort()).toEqual(markerPathsBefore)
    expect(immutableManifestDocuments(root).map(({ path }) => path).sort()).toEqual(objectPathsBefore)
    expect(storedDashboardPaths(root, 'sequence-overflow', 'Must not wrap')).toEqual([])
    const restarted = setup(root).manager
    await restarted.load()
    expect(restarted.getDashboard('sequence-overflow')).toMatchObject({ name: 'Maximum sequence' })
  })

  it('reserves one safe next sequence exclusively when independent managers race', async () => {
    const exclusiveOpens: string[] = []
    const trackedFs: Partial<DashboardStorageFs> = {
      openExclusive: async (path) => {
        exclusiveOpens.push(path)
        const handle = await open(path, 'wx')
        return {
          writeFile: async (data, encoding) => { await handle.writeFile(data, { encoding }) },
          sync: async () => { await handle.sync() },
          close: async () => { await handle.close() }
        }
      }
    }
    const first = setup(root, { fs: trackedFs }).manager
    await first.load()
    await first.save(dashboard('sequence-race', 'Base'), await first.observe('sequence-race'))
    const second = setup(root, { fs: trackedFs }).manager
    await second.load()
    const firstToken = await first.observe('sequence-race')
    const secondToken = await second.observe('sequence-race')
    const baseSequence = highestImmutableManifestDocument(root).value.sequence
    ensureCommitMarkerChain(root)
    exclusiveOpens.length = 0

    const outcomes = await Promise.allSettled([
      first.save({ ...first.getDashboard('sequence-race')!, name: 'First racer' }, firstToken),
      second.save({ ...second.getDashboard('sequence-race')!, name: 'Second racer' }, secondToken)
    ])

    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter(({ status }) => status === 'rejected')).toHaveLength(1)
    const newMarkers = commitMarkerDocuments(root).filter(({ value }) =>
      value.sequence > baseSequence)
    expect(newMarkers).toHaveLength(1)
    const winningSequence = newMarkers[0].value.sequence
    expect(Number.isSafeInteger(winningSequence)).toBe(true)
    expect(winningSequence).toBe(baseSequence + 1)
    const reservationOpens = exclusiveOpens.filter((path) => {
      const name = basename(path)
      return path.startsWith(join(root, '.dashboard-manifests')) &&
        name.includes(String(winningSequence)) &&
        /sequence|reserve/i.test(name) &&
        !MANIFEST_OBJECT_NAME.test(name) &&
        !COMMIT_MARKER_NAME.test(name) &&
        !COMMIT_MARKER_TEMP_NAME.test(name)
    })
    expect(reservationOpens).toHaveLength(1)
    expect(basename(reservationOpens[0])).toMatch(/sequence|reserve/i)
    const restarted = setup(root).manager
    await restarted.load()
    expect(restarted.getDashboard('sequence-race')?.name)
      .toMatch(/^(First|Second) racer$/)
  })

  it('never overwrites an external pointer swap observed after the commit marker succeeds', async () => {
    const pointer = join(root, 'dashboard-storage-manifest.json')
    const externalPointerRaw = `${JSON.stringify({ externalPointer: 'must survive byte-for-byte' })}\n`
    let faultActive = false
    let markerPublished = false
    let externalInstalled = false
    const pointerRenamesAfterSwap: Array<{ from: string; to: string }> = []
    const { manager } = setup(root, { fs: {
      rename: async (from, to) => {
        if (faultActive && COMMIT_MARKER_NAME.test(basename(to))) {
          await rename(from, to)
          markerPublished = true
          return
        }
        if (externalInstalled && to === pointer) pointerRenamesAfterSwap.push({ from, to })
        await rename(from, to)
      },
      link: async (from, to) => {
        if (faultActive && markerPublished && !externalInstalled && from === pointer) {
          writeFileSync(pointer, externalPointerRaw)
          externalInstalled = true
        }
        await link(from, to)
      }
    } })
    await manager.load()
    await manager.save(dashboard('pointer-swap', 'Before'), await manager.observe('pointer-swap'))
    loggerMocks.warn.mockClear()
    faultActive = true

    const outcome = await manager.save(
      { ...manager.getDashboard('pointer-swap')!, name: 'Marker committed' },
      await manager.observe('pointer-swap')
    ).then(
      (value) => ({ status: 'fulfilled' as const, value }),
      (reason: unknown) => ({ status: 'rejected' as const, reason })
    )
    faultActive = false

    expect(markerPublished).toBe(true)
    expect(externalInstalled).toBe(true)
    expect(outcome.status).toBe('fulfilled')
    expect(pointerRenamesAfterSwap).toEqual([])
    expect(readFileSync(pointer, 'utf8')).toBe(externalPointerRaw)
    expect(manager.getDashboard('pointer-swap')).toMatchObject({ name: 'Marker committed' })
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      'dashboards',
      expect.stringMatching(/pointer/i),
      expect.objectContaining({ reason: expect.stringMatching(/changed|external|stale/i) })
    )
  })

  it('reports actual recoverability separately from durability and disables destructive GC when sync is unsupported', async () => {
    const seeded = setup(root, { fs: { syncDirectory: async () => true } }).manager
    await seeded.load()
    await seeded.save(dashboard('sync-capability', 'Visible'), await seeded.observe('sync-capability'))
    await seeded.save(
      { ...seeded.getDashboard('sync-capability')!, name: 'Current' },
      await seeded.observe('sync-capability')
    )
    ensureCommitMarkerChain(root)
    expect(seeded.getStorageStatus() as ReturnType<DashboardManager['getStorageStatus']> & {
      durable: boolean
      recoverable: boolean
    }).toMatchObject({ durable: true, recoverable: true })
    const orphanFile = writeUncommittedGeneration(
      root,
      dashboard('unsupported-sync-orphan', 'Must be preserved'),
      'unsupported-sync-orphan'
    )
    const orphanPath = join(root, '.dashboard-generations', orphanFile)
    const oldObject = immutableManifestDocuments(root)
      .sort((a, b) => a.value.sequence - b.value.sequence)[0]
    utimesSync(orphanPath, new Date(0), new Date(0))
    utimesSync(oldObject.path, new Date(0), new Date(0))
    const destructiveAttempts: string[] = []
    const restarted = setup(root, { fs: {
      syncDirectory: async () => false,
      rename: async (from, to) => {
        if (from === orphanPath || from === oldObject.path) {
          destructiveAttempts.push(from)
          throw Object.assign(new Error('destructive GC blocked by test'), { code: 'EACCES' })
        }
        await rename(from, to)
      },
      unlink: async (path) => {
        if (path === orphanPath || path === oldObject.path) {
          destructiveAttempts.push(path)
          throw Object.assign(new Error('destructive GC blocked by test'), { code: 'EACCES' })
        }
        await unlink(path)
      }
    } }).manager

    await restarted.load()

    const status = restarted.getStorageStatus() as ReturnType<DashboardManager['getStorageStatus']> & {
      durable: boolean
      recoverable: boolean
    }
    expect(status).toMatchObject({
      state: 'ready',
      reason: null,
      durable: false,
      recoverable: true
    })
    expect(restarted.getDashboard('sync-capability')).toMatchObject({ name: 'Current' })
    expect(destructiveAttempts).toEqual([])
    expect(existsSync(orphanPath)).toBe(true)
    expect(existsSync(oldObject.path)).toBe(true)
  })

  it('keeps an ENOSPC-partial manifest object in temp form and never authorizes it', async () => {
    const pointer = join(root, 'dashboard-storage-manifest.json')
    const objectDir = join(root, '.dashboard-manifests')
    let faultActive = false
    let partialPath = ''
    let intendedRaw = ''
    const diskFull = Object.assign(new Error('disk full during manifest object write'), { code: 'ENOSPC' })
    const { manager } = setup(root, { fs: { openExclusive: async (path) => {
      const handle = await open(path, 'wx')
      const name = basename(path)
      const isManifestObjectWrite =
        (path.startsWith(objectDir) && MANIFEST_OBJECT_NAME.test(name)) ||
        name.startsWith('.tmp-manifest-object-')
      if (!faultActive || !isManifestObjectWrite) {
        return {
          writeFile: async (data, encoding) => { await handle.writeFile(data, { encoding }) },
          sync: async () => { await handle.sync() },
          close: async () => { await handle.close() }
        }
      }
      partialPath = path
      return {
        writeFile: async (data, encoding) => {
          intendedRaw = data
          await handle.writeFile(data.slice(0, Math.max(1, Math.floor(data.length / 2))), { encoding })
          throw diskFull
        },
        sync: async () => { await handle.sync() },
        close: async () => { await handle.close() }
      }
    } } })
    await manager.load()
    await manager.save(dashboard('enospc-object', 'Before'), await manager.observe('enospc-object'))
    ensureCommitMarkerChain(root)
    const pointerBefore = readFileSync(pointer, 'utf8')
    const markerCountBefore = commitMarkerDocuments(root).length
    faultActive = true

    const outcome = await manager.save(
      { ...manager.getDashboard('enospc-object')!, name: 'Partial candidate' },
      await manager.observe('enospc-object')
    ).then(
      (value) => ({ status: 'fulfilled' as const, value }),
      (reason: unknown) => ({ status: 'rejected' as const, reason })
    )
    faultActive = false

    expect(outcome.status).toBe('rejected')
    if (outcome.status === 'rejected') {
      expect(outcome.reason).toEqual(expect.objectContaining({ code: 'ENOSPC' }))
    }
    expect(partialPath).not.toBe('')
    expect(basename(partialPath)).toMatch(/^\.tmp-manifest-object-/)
    expect(existsSync(partialPath)).toBe(true)
    expect(readFileSync(partialPath, 'utf8')).not.toBe(intendedRaw)
    const intended = JSON.parse(intendedRaw) as ManifestDocument['value']
    const finalObject = join(objectDir, `m.${intended.sequence}.${exactTestHash(intendedRaw)}.json`)
    expect(existsSync(finalObject)).toBe(false)
    expect(commitMarkerDocuments(root)).toHaveLength(markerCountBefore)
    expect(commitMarkerDocuments(root).some(({ value }) =>
      value.manifestHash === exactTestHash(intendedRaw))).toBe(false)
    expect(readFileSync(pointer, 'utf8')).toBe(pointerBefore)

    const restarted = setup(root).manager
    await restarted.load()
    expect(restarted.getStorageStatus()).toMatchObject({ state: 'ready', reason: null })
    expect(restarted.getDashboard('enospc-object')).toMatchObject({ name: 'Before' })
    expect(snapshotDashboard(await restarted.exportSnapshot(), 'enospc-object'))
      .toMatchObject({ name: 'Before' })
  })

  it('serializes mutations and rejects stale save/hide/delete/playlist tokens', async () => {
    writeDash(root, 'legacy.json', dashboard('legacy'))
    writePlaylist(root)
    const { manager } = setup(root)
    await manager.load()
    const stale = await manager.observe('legacy')
    const winner = manager.save({ ...manager.getDashboard('legacy')!, name: 'winner' }, stale)
    const loser = manager.save({ ...manager.getDashboard('legacy')!, name: 'loser' }, stale)
    await expect(winner).resolves.toMatchObject({ name: 'winner' })
    await expect(loser).rejects.toThrow(/STALE_VERSION/)
    await expect(manager.setHidden('legacy', true, stale)).rejects.toThrow(/STALE_VERSION/)
    await expect(manager.delete('legacy', stale)).rejects.toThrow(/STALE_VERSION/)
    const playlist = manager.getPlaylist()
    const playlistToken = observedDashboardMutationToken(playlist)
    await manager.setPlaylist({ items: [item('legacy')], updatedAt: 1 }, playlistToken)
    await expect(manager.setPlaylist({ items: [], updatedAt: 2 }, playlistToken)).rejects.toThrow(/STALE_VERSION/)
  })
})
