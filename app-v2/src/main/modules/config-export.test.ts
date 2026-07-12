import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn()
}))
const fileIoMocks = vi.hoisted(() => ({ readFile: vi.fn(), writeFile: vi.fn() }))

vi.mock('electron', () => ({ dialog: electronMocks, shell: {}, app: {} }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readFile: (...args: unknown[]) => {
      fileIoMocks.readFile(...args)
      return Reflect.apply(actual.readFile, undefined, args)
    },
    writeFile: (...args: unknown[]) => {
      fileIoMocks.writeFile(...args)
      return Reflect.apply(actual.writeFile, undefined, args)
    }
  }
})
vi.mock('./logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { join, resolve } from 'node:path'
import {
  buildRegistry,
  FULL_IMPORT_DISABLED_RESULT,
  type ConfigStorage,
  createConfigEngine,
  createFileStorage,
  createMemoryStorage,
  readImportPayload,
  register
} from './config-export'
import {
  CONFIG_BUNDLE_APP_ID,
  CONFIG_BUNDLE_VERSION,
  CONFIG_IO_CHANNELS,
  CONFIG_SECTIONS,
  FORBIDDEN_CONFIG_FILES,
  getConfigSection,
  isConfigBundle,
  isConfigSectionExport,
  isForbiddenConfigPath,
  type ConfigSectionReloadResult
} from '../../shared/config-io'
import {
  RGB_MATRIX_PROFILE_VERSION,
  defaultRgbMatrixProfile,
  type RgbMatrixProfile
} from '../../shared/rgb-matrix'
import type { DeviceProfile } from '../../shared/devices'
import { createRichCustomOverlayDef } from '../../shared/overlays'
import { ALL_VARIANTS, variantToElement } from '../../renderer/src/views/dashboard/widget-catalog-data'
import type { ModuleContext } from '../module-context'
import { RgbMatrixModule } from './rgb-matrix'
import { parseRgbMatrixProfilesPayload } from './rgb-matrix-profile-store'

const SEEDED_RGB_PAYLOAD = parseRgbMatrixProfilesPayload({
  version: RGB_MATRIX_PROFILE_VERSION,
  profiles: { 'seed-device:seed-matrix': defaultRgbMatrixProfile() },
  updatedAt: '2026-01-01T00:00:00.000Z'
}).payload

// A representative seed: a 'file' section, a 'dir' section, plus auth/cache files
// that live in the SAME userData dir and must NEVER leak into an export.
function seededStorage(): ReturnType<typeof createMemoryStorage> {
  return createMemoryStorage({
    'settings.json': { theme: 'gulf', accentColor: '#00b0f0' },
    'rgb-matrix-profiles.json': SEEDED_RGB_PAYLOAD,
    dashboards: {
      'dashboard-playlist.json': { order: ['a', 'b'] },
      'a.json': { id: 'a', name: 'GT3 DDU' }
    },
    // Secrets / caches — present on disk but outside the allowlist.
    'iracing-credentials.bin': { secret: 'TOPSECRET-PASSWORD' },
    'iracing-oauth.bin': { accessToken: 'TOPSECRET-TOKEN' },
    'iracing-browser-session.json': { cookies: ['TOPSECRET-COOKIE'] }
  })
}

type TestIpcHandler = (...args: unknown[]) => unknown

function registerForTest() {
  const handlers = new Map<string, TestIpcHandler>()
  const emit = vi.fn()
  const broadcast = vi.fn()
  register({
    app: { getPath: () => join(process.cwd(), 'full-import-disabled-test-user-data') },
    ipcMain: {
      handle: (channel: string, handler: TestIpcHandler) => handlers.set(channel, handler),
      emit
    },
    getMainWindow: () => null,
    broadcast
  } as unknown as ModuleContext)
  return { handlers, emit, broadcast }
}

describe('full-profile IPC containment', () => {
  it('fails closed before any dialog, file I/O, reload signal, or broadcast', async () => {
    const { handlers, emit, broadcast } = registerForTest()
    electronMocks.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: [join(process.cwd(), 'must-not-be-read.json')]
    })
    vi.clearAllMocks()

    const result = await handlers.get(CONFIG_IO_CHANNELS.importAll)?.({})

    expect(result).toEqual(FULL_IMPORT_DISABLED_RESULT)
    expect(electronMocks.showOpenDialog).not.toHaveBeenCalled()
    expect(electronMocks.showSaveDialog).not.toHaveBeenCalled()
    expect(fileIoMocks.readFile).not.toHaveBeenCalled()
    expect(fileIoMocks.writeFile).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('keeps full export and per-section export/import handlers operational', async () => {
    const { handlers } = registerForTest()
    electronMocks.showSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined })
    electronMocks.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    vi.clearAllMocks()

    await handlers.get(CONFIG_IO_CHANNELS.exportAll)?.({})
    await handlers.get(CONFIG_IO_CHANNELS.exportSection)?.({}, 'settings')
    await handlers.get(CONFIG_IO_CHANNELS.importSection)?.({}, 'settings')

    expect(electronMocks.showSaveDialog).toHaveBeenCalledTimes(2)
    expect(electronMocks.showOpenDialog).toHaveBeenCalledTimes(1)
  })
})

describe('config-io bundle shape', () => {
  it('exportAll produces a versioned, app-tagged bundle that validates', async () => {
    const engine = createConfigEngine(seededStorage())
    const bundle = await engine.exportAll()

    expect(bundle.app).toBe(CONFIG_BUNDLE_APP_ID)
    expect(bundle.version).toBe(CONFIG_BUNDLE_VERSION)
    expect(typeof bundle.exportedAt).toBe('string')
    expect(Number.isNaN(Date.parse(bundle.exportedAt))).toBe(false)
    expect(isConfigBundle(bundle)).toBe(true)

    // Only seeded, allowlisted sections are present.
    expect(Object.keys(bundle.sections).sort()).toEqual(['dashboards', 'rgb-matrix', 'settings'])
  })

  it('exportSection wraps section data with app + version metadata', async () => {
    const engine = createConfigEngine(seededStorage())
    const section = await engine.exportSection('rgb-matrix')

    expect(isConfigSectionExport(section)).toBe(true)
    expect(section.sectionId).toBe('rgb-matrix')
    expect(section.app).toBe(CONFIG_BUNDLE_APP_ID)
    expect(section.data).toEqual(SEEDED_RGB_PAYLOAD)
  })

  it('refuses to claim a successful iFlag export when no profiles are saved', async () => {
    const engine = createConfigEngine(createMemoryStorage())
    await expect(engine.exportSection('rgb-matrix')).rejects.toThrow(/No iFlag profiles/)
  })
})

describe('section registry round-trip (export -> import)', () => {
  it('re-creates every exported section (file + dir) in a fresh store', async () => {
    const source = createConfigEngine(seededStorage())
    const bundle = await source.exportAll()

    const destStorage = createMemoryStorage()
    const dest = createConfigEngine(destStorage)
    const summary = await dest.importAll(bundle)

    expect(summary.applied.sort()).toEqual(['dashboards', 'rgb-matrix', 'settings'])
    expect(summary.unknown).toEqual([])

    const dump = destStorage.dump()
    expect(dump['settings.json']).toEqual({ theme: 'gulf', accentColor: '#00b0f0' })
    expect(dump['rgb-matrix-profiles.json']).toEqual(SEEDED_RGB_PAYLOAD)
    // 'dir' section round-trips the per-file map intact.
    expect(dump['dashboards']).toEqual({
      'dashboard-playlist.json': { order: ['a', 'b'] },
      'a.json': { id: 'a', name: 'GT3 DDU' }
    })
  })

  it('round-trips a single section via exportSection -> importSection', async () => {
    const source = createConfigEngine(seededStorage())
    const exported = await source.exportSection('settings')

    const destStorage = createMemoryStorage()
    const dest = createConfigEngine(destStorage)
    const summary = await dest.importSection('settings', exported)

    expect(summary.applied).toEqual(['settings'])
    expect(destStorage.dump()['settings.json']).toEqual({ theme: 'gulf', accentColor: '#00b0f0' })
  })

  it('round-trips every rich-overlay catalog identity and JSON extension with deep equality', async () => {
    const widgets = ALL_VARIANTS
      .map((variant) => variantToElement(variant, 0, 0))
      .filter((widget) => widget.widgetId || widget.hifiModuleId)
    Object.assign(widgets[0], { future: { pages: ['race', { alerts: ['fuel', 'tyres'] }], enabled: true } })
    const overlays = {
      configMode: false,
      widgets: {},
      customOverlays: Array.from({ length: Math.ceil(widgets.length / 200) }, (_, index) =>
        createRichCustomOverlayDef({
          id: `custom:identity-${index}`,
          title: `Identity ${index}`,
          widgets: widgets.slice(index * 200, (index + 1) * 200)
        })
      )
    }
    const source = createConfigEngine(createMemoryStorage({ 'overlays.json': overlays }))
    const exported = await source.exportSection('overlays')
    expect(exported.data).toEqual(overlays)

    const destStorage = createMemoryStorage()
    await createConfigEngine(destStorage).importSection('overlays', exported)
    expect(destStorage.dump()['overlays.json']).toEqual(overlays)
  })

  it('importSection accepts a full bundle and extracts the matching section', async () => {
    const source = createConfigEngine(seededStorage())
    const bundle = await source.exportAll()

    const destStorage = createMemoryStorage()
    const dest = createConfigEngine(destStorage)
    await dest.importSection('rgb-matrix', bundle)

    expect(destStorage.dump()['rgb-matrix-profiles.json']).toEqual(SEEDED_RGB_PAYLOAD)
    // Importing one section must not pull in the others.
    expect(destStorage.dump()['settings.json']).toBeUndefined()
  })

  it('is back-compat: ignores unknown sections and keeps applying known ones', async () => {
    const destStorage = createMemoryStorage()
    const dest = createConfigEngine(destStorage)
    const summary = await dest.importAll({
      app: CONFIG_BUNDLE_APP_ID,
      version: 999, // a future version
      exportedAt: new Date().toISOString(),
      sections: {
        settings: { theme: 'martini' },
        'some-future-feature': { whatever: true }
      }
    })

    expect(summary.version).toBe(999)
    expect(summary.applied).toEqual(['settings'])
    expect(summary.unknown).toEqual(['some-future-feature'])
    expect(destStorage.dump()['settings.json']).toEqual({ theme: 'martini' })
  })

  it('rejects files that are not a valid bundle', async () => {
    const engine = createConfigEngine(createMemoryStorage())
    await expect(engine.importAll({ app: 'some-other-app', version: 1, sections: {} })).rejects.toThrow()
    await expect(engine.importAll({ nope: true })).rejects.toThrow()
  })
})

// WS-3 hot-apply: importing a section must REPLACE the on-disk store so a FRESH
// read returns the imported payload — never null, never the stale boot copy. A
// fresh `createConfigEngine` over the SAME storage models the live module
// re-reading its file after the import-reload signal fires.
describe('import hot-apply round-trip (a fresh read returns the imported data, not stale)', () => {
  it('file section: a fresh read after importSection returns the imported FULL payload object, not the stale one', async () => {
    // Destination already holds STALE rgb-matrix data on disk.
    const stalePayload = parseRgbMatrixProfilesPayload({
      version: RGB_MATRIX_PROFILE_VERSION,
      profiles: { 'old-device:old-matrix': defaultRgbMatrixProfile() },
      updatedAt: '2020-01-01T00:00:00.000Z'
    }).payload
    const destStorage = createMemoryStorage({ 'rgb-matrix-profiles.json': stalePayload })
    const dest = createConfigEngine(destStorage)

    // The exported file's on-disk data is a FULL payload object (version + profiles + updatedAt).
    const exportedPayload = parseRgbMatrixProfilesPayload({
      version: RGB_MATRIX_PROFILE_VERSION,
      profiles: { 'seed-device:seed-matrix': defaultRgbMatrixProfile() },
      updatedAt: '2026-01-01T00:00:00.000Z'
    }).payload
    const source = createConfigEngine(createMemoryStorage({ 'rgb-matrix-profiles.json': exportedPayload }))
    const exported = await source.exportSection('rgb-matrix')
    expect(isConfigSectionExport(exported)).toBe(true)
    expect(exported.data).toEqual(exportedPayload)

    const summary = await dest.importSection('rgb-matrix', exported)
    expect(summary.applied).toEqual(['rgb-matrix'])

    // A FRESH engine over the same storage (models the module re-reading the file
    // on the reload signal) must return the IMPORTED payload — not null, not stale.
    const fresh = createConfigEngine(destStorage)
    const reread = await fresh.exportSection('rgb-matrix')
    expect(reread.data).not.toBeNull()
    expect(reread.data).toEqual(exportedPayload)
    // Raw storage confirms a clean overwrite with no stale residue.
    expect(destStorage.dump()['rgb-matrix-profiles.json']).toEqual(exportedPayload)
  })

  it('dir section (dashboards): a fresh read after import returns the imported file-map and drops stale entries', async () => {
    // Destination has a stale dashboard + playlist that the import must replace.
    const destStorage = createMemoryStorage({
      dashboards: {
        'old.json': { id: 'old', name: 'STALE DDU' },
        'dashboard-playlist.json': { order: ['old'] }
      }
    })
    const dest = createConfigEngine(destStorage)

    const importedMap = {
      'a.json': { id: 'a', name: 'GT3 DDU' },
      'dashboard-playlist.json': { order: ['a', 'b'] }
    }
    const source = createConfigEngine(createMemoryStorage({ dashboards: importedMap }))
    const exported = await source.exportSection('dashboards')
    expect(exported.data).toEqual(importedMap)

    const summary = await dest.importSection('dashboards', exported)
    expect(summary.applied).toEqual(['dashboards'])

    const fresh = createConfigEngine(destStorage)
    const reread = await fresh.exportSection('dashboards')
    expect(reread.data).not.toBeNull()
    expect(reread.data).toEqual(importedMap)
    // Clean replace: the stale 'old.json' is gone, not merged in.
    expect((reread.data as Record<string, unknown>)['old.json']).toBeUndefined()
  })

  it('importAll: every applied file/dir section reads back its imported payload from a fresh engine', async () => {
    const bundle = await createConfigEngine(seededStorage()).exportAll()

    // Pre-existing stale data that the import must fully overwrite.
    const destStorage = createMemoryStorage({
      'settings.json': { theme: 'STALE' },
      'rgb-matrix-profiles.json': parseRgbMatrixProfilesPayload({
        version: 1,
        profiles: { 'old-device:old-matrix': defaultRgbMatrixProfile() },
        updatedAt: '2020-01-01T00:00:00.000Z'
      }).payload,
      dashboards: { 'stale.json': { id: 'stale' } }
    })
    const summary = await createConfigEngine(destStorage).importAll(bundle)
    expect(summary.applied.sort()).toEqual(['dashboards', 'rgb-matrix', 'settings'])

    const fresh = createConfigEngine(destStorage)
    expect((await fresh.exportSection('settings')).data).toEqual({ theme: 'gulf', accentColor: '#00b0f0' })
    expect((await fresh.exportSection('rgb-matrix')).data).toEqual(SEEDED_RGB_PAYLOAD)
    expect((await fresh.exportSection('dashboards')).data).toEqual({
      'dashboard-playlist.json': { order: ['a', 'b'] },
      'a.json': { id: 'a', name: 'GT3 DDU' }
    })
  })
})

interface LoadableRgbMatrixModule {
  loaded: boolean
  profiles: DeviceProfile[]
  payload: { profiles: Record<string, RgbMatrixProfile> }
  activeProfiles: Record<string, RgbMatrixProfile>
  ensureLoaded(): Promise<unknown>
  onSectionReload(
    event: unknown,
    sectionId: string,
    done: (error: string | null, result?: ConfigSectionReloadResult) => void
  ): void
}

function loadable(module: RgbMatrixModule): LoadableRgbMatrixModule {
  return module as unknown as LoadableRgbMatrixModule
}

function brotherDeviceProfile(): DeviceProfile {
  return {
    id: 'brother-device',
    label: 'Brother iFlag',
    deviceId: 'serial-brother',
    board: 'nano',
    baud: 115200,
    components: [
      {
        id: 'brother-matrix',
        label: 'iFlag 8x8',
        type: 'rgbMatrix',
        enabled: true,
        pins: {},
        chip: 'ws2812',
        width: 8,
        height: 8,
        brightness: 120,
        orientation: 0,
        serpentine: true,
        mode: 'iflag'
      }
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

function importedProfile(): RgbMatrixProfile {
  const profile = defaultRgbMatrixProfile()
  return {
    ...profile,
    layout: { ...profile.layout, rotation: 90, flipX: true },
    effects: profile.effects.map((effect, index) => ({
      ...effect,
      name: `${effect.name} imported`,
      priority: index
    }))
  }
}

async function loadBrotherStore(root: string): Promise<LoadableRgbMatrixModule> {
  const hub = { on: () => {}, off: () => {} }
  const ctx = {
    app: { getPath: () => root },
    telemetryHub: hub,
    serialHub: { ...hub, getPrimaryId: () => null, getDevice: () => null }
  } as unknown as ModuleContext
  const module = new RgbMatrixModule(ctx)
  const internal = loadable(module)
  internal.profiles = [brotherDeviceProfile()]
  await internal.ensureLoaded()
  return internal
}

function hotReloadBrotherStore(module: LoadableRgbMatrixModule): Promise<ConfigSectionReloadResult> {
  return new Promise((resolveReload, rejectReload) => {
    module.onSectionReload(null, 'rgb-matrix', (error, result) => {
      if (error) rejectReload(new Error(error))
      else if (!result) rejectReload(new Error('Missing iFlag reload result'))
      else resolveReload(result)
    })
  })
}

describe('rgb-matrix real export/import/loader round-trip across machines', () => {
  let sourceRoot: string
  let destinationRoot: string

  beforeEach(() => {
    sourceRoot = mkdtempSync(join(process.cwd(), 'iflag-source-test-'))
    destinationRoot = mkdtempSync(join(process.cwd(), 'iflag-destination-test-'))
  })

  afterEach(() => {
    rmSync(sourceRoot, { recursive: true, force: true })
    rmSync(destinationRoot, { recursive: true, force: true })
  })

  it('exportSection -> importSection preserves and surfaces a sender profile for the brother iFlag key', async () => {
    const profile = importedProfile()
    const senderPayload = {
      version: RGB_MATRIX_PROFILE_VERSION,
      profiles: { 'sender-device:sender-matrix': profile },
      updatedAt: '2026-07-11T00:00:00.000Z'
    }
    await createFileStorage(sourceRoot).writeFileJson('rgb-matrix-profiles.json', senderPayload)
    const exported = await createConfigEngine(createFileStorage(sourceRoot)).exportSection('rgb-matrix')
    const exportedPayload = exported.data as { profiles: Record<string, RgbMatrixProfile> }
    const transferPath = join(sourceRoot, 'rgb-matrix-export.json')
    writeFileSync(transferPath, JSON.stringify(exported))

    const brotherModule = await loadBrotherStore(destinationRoot)
    const summary = await createConfigEngine(createFileStorage(destinationRoot)).importSection(
      'rgb-matrix',
      await readImportPayload(transferPath)
    )

    expect(summary.details?.['rgb-matrix']?.itemCount).toBe(1)
    expect(await createFileStorage(destinationRoot).readFileJson('rgb-matrix-profiles.json')).toEqual(exported.data)
    const reload = await hotReloadBrotherStore(brotherModule)
    expect(reload).toEqual({
      sectionId: 'rgb-matrix',
      itemCount: 1,
      hotAppliedCount: 1,
      unmatchedItemCount: 0
    })
    expect(brotherModule.activeProfiles['brother-device:brother-matrix']).toEqual(
      exportedPayload.profiles['sender-device:sender-matrix']
    )
  })

  it('exportAll -> importAll preserves and surfaces non-empty iFlag profiles after reload', async () => {
    const profile = importedProfile()
    const senderPayload = {
      version: RGB_MATRIX_PROFILE_VERSION,
      profiles: { 'sender-device:sender-matrix': profile },
      updatedAt: '2026-07-11T00:00:00.000Z'
    }
    const sourceStorage = createFileStorage(sourceRoot)
    await sourceStorage.writeFileJson('settings.json', { theme: 'gulf' })
    await sourceStorage.writeFileJson('rgb-matrix-profiles.json', senderPayload)
    const bundle = await createConfigEngine(sourceStorage).exportAll()
    const transferPath = join(sourceRoot, 'full-export.json')
    writeFileSync(transferPath, JSON.stringify(bundle))

    const brotherModule = await loadBrotherStore(destinationRoot)
    const summary = await createConfigEngine(createFileStorage(destinationRoot)).importAll(
      await readImportPayload(transferPath)
    )
    const exportedPayload = bundle.sections['rgb-matrix'] as { profiles: Record<string, RgbMatrixProfile> }

    expect(summary.applied).toContain('rgb-matrix')
    expect(summary.details?.['rgb-matrix']?.itemCount).toBe(1)
    expect(await createFileStorage(destinationRoot).readFileJson('rgb-matrix-profiles.json')).toEqual(
      bundle.sections['rgb-matrix']
    )
    const reload = await hotReloadBrotherStore(brotherModule)
    expect(reload.hotAppliedCount).toBe(1)
    expect(reload.unmatchedItemCount).toBe(0)
    expect(brotherModule.activeProfiles['brother-device:brother-matrix']).toEqual(
      exportedPayload.profiles['sender-device:sender-matrix']
    )
  })

  it('rejects empty/invalid iFlag imports before overwriting the brother store', async () => {
    const storage = createFileStorage(destinationRoot)
    await storage.writeFileJson('rgb-matrix-profiles.json', SEEDED_RGB_PAYLOAD)
    const engine = createConfigEngine(storage)

    await expect(engine.importSection('rgb-matrix', null)).rejects.toThrow(/No iFlag profiles/)
    await expect(
      engine.importSection('rgb-matrix', {
        version: RGB_MATRIX_PROFILE_VERSION,
        profiles: {},
        updatedAt: '2026-07-11T00:00:00.000Z'
      })
    ).rejects.toThrow(/No iFlag profiles/)
    await expect(
      engine.importSection('rgb-matrix', {
        version: RGB_MATRIX_PROFILE_VERSION,
        profiles: { broken: { id: 'not-a-matrix-profile' } }
      })
    ).rejects.toThrow(/neither a matrix layout nor an effect stack/)

    expect(await storage.readFileJson('rgb-matrix-profiles.json')).toEqual(SEEDED_RGB_PAYLOAD)
  })

  it('surfaces empty and malformed JSON files with descriptive import errors', async () => {
    const emptyPath = join(sourceRoot, 'empty.json')
    const malformedPath = join(sourceRoot, 'malformed.json')
    writeFileSync(emptyPath, '   ')
    writeFileSync(malformedPath, '{"profiles":')

    await expect(readImportPayload(emptyPath)).rejects.toThrow(/selected JSON file is empty/)
    await expect(readImportPayload(malformedPath)).rejects.toThrow(/malformed JSON/)
  })

  it('validates a full bundle before writing any section and reports a newer iFlag schema', async () => {
    const storage = createFileStorage(destinationRoot)
    await storage.writeFileJson('settings.json', { theme: 'before' })
    const engine = createConfigEngine(storage)
    const invalidBundle = {
      app: CONFIG_BUNDLE_APP_ID,
      version: CONFIG_BUNDLE_VERSION,
      exportedAt: '2026-07-11T00:00:00.000Z',
      sections: {
        settings: { theme: 'after' },
        'rgb-matrix': {
          version: RGB_MATRIX_PROFILE_VERSION + 1,
          profiles: { future: defaultRgbMatrixProfile() }
        }
      }
    }

    await expect(engine.importAll(invalidBundle)).rejects.toThrow(/newer than the supported version/)
    expect(await storage.readFileJson('settings.json')).toEqual({ theme: 'before' })
    expect(await storage.readFileJson('rgb-matrix-profiles.json')).toBeUndefined()
  })

  it('migrates a legacy array of real matrix profiles and applies it to the local target', async () => {
    const legacy = [importedProfile()]
    const summary = await createConfigEngine(createFileStorage(destinationRoot)).importSection('rgb-matrix', {
      version: 1,
      profiles: legacy
    })
    expect(summary.details?.['rgb-matrix']?.itemCount).toBe(1)

    const brotherModule = await loadBrotherStore(destinationRoot)
    expect(brotherModule.activeProfiles['brother-device:brother-matrix']).toBeDefined()
  })
})

describe('auth / secret EXCLUSION', () => {
  it('never lists a forbidden path in the section registry', () => {
    for (const section of CONFIG_SECTIONS) {
      expect(isForbiddenConfigPath(section.path)).toBe(false)
    }
    // And the live registry has no accessor for any forbidden file.
    const registry = buildRegistry(createMemoryStorage())
    for (const file of FORBIDDEN_CONFIG_FILES) {
      expect(registry[file]).toBeUndefined()
    }
  })

  it('flags credential/oauth/session/cookie/.bin paths as forbidden', () => {
    expect(isForbiddenConfigPath('iracing-credentials.bin')).toBe(true)
    expect(isForbiddenConfigPath('iracing-oauth.bin')).toBe(true)
    expect(isForbiddenConfigPath('iracing-session.bin')).toBe(true)
    expect(isForbiddenConfigPath('iracing-browser-session.json')).toBe(true)
    expect(isForbiddenConfigPath('track-maps/123/metadata.json')).toBe(true)
    expect(isForbiddenConfigPath('anything.bin')).toBe(true)
    expect(isForbiddenConfigPath('../escape.json')).toBe(true)
    // Allowlisted config stays allowed.
    expect(isForbiddenConfigPath('settings.json')).toBe(false)
    expect(isForbiddenConfigPath('rgb-matrix-profiles.json')).toBe(false)
  })

  it('exportAll cannot serialize any secret present on disk', async () => {
    const engine = createConfigEngine(seededStorage())
    const bundle = await engine.exportAll()
    const serialized = JSON.stringify(bundle)

    expect(serialized).not.toContain('TOPSECRET')
    expect(serialized).not.toContain('iracing-credentials')
    expect(serialized).not.toContain('iracing-oauth')
    expect(serialized).not.toContain('accessToken')
    expect(serialized).not.toContain('cookies')
  })

  it('importAll never writes an auth store, even from a malicious bundle', async () => {
    const destStorage = createMemoryStorage()
    const dest = createConfigEngine(destStorage)
    const summary = await dest.importAll({
      app: CONFIG_BUNDLE_APP_ID,
      version: 1,
      exportedAt: new Date().toISOString(),
      sections: {
        settings: { theme: 'verde' },
        'iracing-credentials': { secret: 'HACK' },
        'iracing-oauth': { accessToken: 'HACK' }
      }
    })

    expect(summary.applied).toEqual(['settings'])
    expect(summary.unknown.sort()).toEqual(['iracing-credentials', 'iracing-oauth'])

    const dump = destStorage.dump()
    expect(JSON.stringify(dump)).not.toContain('HACK')
    expect(dump['iracing-credentials.bin']).toBeUndefined()
    expect(dump['iracing-oauth.bin']).toBeUndefined()
  })

  it('importSection refuses an unknown/protected section id', async () => {
    const engine = createConfigEngine(createMemoryStorage())
    await expect(engine.importSection('iracing-credentials', { secret: 'x' })).rejects.toThrow()
    await expect(engine.importSection('iracing-oauth', { accessToken: 'x' })).rejects.toThrow()
  })

  it('the storage layer itself rejects writing a forbidden path', async () => {
    const storage = createMemoryStorage()
    await expect(storage.writeFileJson('iracing-oauth.bin', { accessToken: 'x' })).rejects.toThrow()
  })
})

describe('dir-section import is a clean replace (file storage)', () => {
  let root: string

  beforeEach(() => {
    // Project-local temp dir (never /tmp); removed after each test.
    root = mkdtempSync(join(process.cwd(), 'config-io-test-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('replaces the dir .json (no stale merge), keeps non-.json, leaves outside files', async () => {
    const storage = createFileStorage(root)
    mkdirSync(join(root, 'dashboards'), { recursive: true })
    // A stale dashboard that is NOT in the imported bundle must disappear.
    writeFileSync(join(root, 'dashboards', 'old.json'), JSON.stringify({ id: 'old' }))
    // A non-.json asset inside the same dir must be preserved.
    writeFileSync(join(root, 'dashboards', 'keep.png'), 'not-json')
    // A file OUTSIDE the section dir must never be touched.
    writeFileSync(join(root, 'settings.json'), JSON.stringify({ theme: 'gulf' }))

    await storage.writeDirJson('dashboards', { 'new.json': { id: 'new' } })

    expect(readdirSync(join(root, 'dashboards')).sort()).toEqual(['keep.png', 'new.json'])
    expect(JSON.parse(readFileSync(join(root, 'dashboards', 'new.json'), 'utf8'))).toEqual({ id: 'new' })
    // Clean replace: the stale dashboard is gone, the non-json asset stays,
    // and nothing outside the dir was removed.
    expect(existsSync(join(root, 'dashboards', 'old.json'))).toBe(false)
    expect(existsSync(join(root, 'dashboards', 'keep.png'))).toBe(true)
    expect(existsSync(join(root, 'settings.json'))).toBe(true)
  })

  it('round-trips through the engine: importing a dir section overwrites the old set', async () => {
    const storage = createFileStorage(root)
    const engine = createConfigEngine(storage)
    mkdirSync(join(root, 'profiles'), { recursive: true })
    writeFileSync(join(root, 'profiles', 'stale.json'), JSON.stringify({ id: 'stale' }))

    await engine.importSection('legacy-profiles', {
      app: 'ultimate-sim-app',
      version: 1,
      exportedAt: new Date().toISOString(),
      sectionId: 'legacy-profiles',
      data: { 'fresh.json': { id: 'fresh' } }
    })

    expect(readdirSync(join(root, 'profiles')).sort()).toEqual(['fresh.json'])
  })

  it('refuses to clear/write a forbidden dir path', async () => {
    const storage = createFileStorage(root)
    await expect(storage.writeDirJson('track-maps', { 'x.json': {} })).rejects.toThrow()
  })
})

describe('listSavedSections (view saved config metadata)', () => {
  it('reports exists/size/itemCount for a file + dir, and exists:false for absent stores', async () => {
    const list = await createConfigEngine(seededStorage()).listSavedSections()
    const byId = Object.fromEntries(list.map((info) => [info.id, info]))

    // 'file' section that is seeded → exists, non-zero size, top-level key count.
    expect(byId.settings.kind).toBe('file')
    expect(byId.settings.exists).toBe(true)
    expect(byId.settings.sizeBytes).toBeGreaterThan(0)
    expect(byId.settings.itemCount).toBe(2) // { theme, accentColor }

    // 'dir' section that is seeded → exists, .json count.
    expect(byId.dashboards.kind).toBe('dir')
    expect(byId.dashboards.exists).toBe(true)
    expect(byId.dashboards.itemCount).toBe(2) // dashboard-playlist.json + a.json
    expect(byId.dashboards.sizeBytes).toBeGreaterThan(0)

    // A section with no saved file → exists:false, empty metadata.
    expect(byId.spotter.exists).toBe(false)
    expect(byId.spotter.sizeBytes).toBe(0)
    expect(byId.spotter.modifiedAt).toBeNull()
    expect(byId.spotter.itemCount).toBeUndefined()

    // Every allowlisted section is reported once, in registry order.
    expect(list).toHaveLength(CONFIG_SECTIONS.length)
  })

  it('counts a file array section by length and reports an empty dir as not saved', async () => {
    const engine = createConfigEngine(
      createMemoryStorage({
        'actions-bindings.json': [{ a: 1 }, { b: 2 }, { c: 3 }],
        // A 'dir' present on disk but with no .json files counts as empty.
        profiles: { 'readme.txt': 'not json' }
      })
    )
    const byId = Object.fromEntries((await engine.listSavedSections()).map((info) => [info.id, info]))

    expect(byId.actions.itemCount).toBe(3)
    expect(byId.actions.exists).toBe(true)
    expect(byId['legacy-profiles'].exists).toBe(false)
    expect(byId['legacy-profiles'].itemCount).toBe(0)
  })

  it('never lists a secret/forbidden store, even when one sits in the same dir', async () => {
    const list = await createConfigEngine(seededStorage()).listSavedSections()

    // Only allowlisted, non-forbidden sections — by id AND by resolved path.
    for (const info of list) {
      expect(getConfigSection(info.id)).toBeDefined()
      expect(isForbiddenConfigPath(getConfigSection(info.id)!.path)).toBe(false)
    }
    const ids = list.map((info) => info.id)
    expect(ids).not.toContain('iracing-credentials')
    expect(ids).not.toContain('iracing-oauth')

    // The seeded secrets/cookies can never surface in the listing.
    const serialized = JSON.stringify(list)
    expect(serialized).not.toContain('TOPSECRET')
    expect(serialized).not.toContain('.bin')
    expect(serialized).not.toContain('iracing-credentials')
    for (const file of FORBIDDEN_CONFIG_FILES) {
      expect(ids).not.toContain(file)
    }
  })

  it('one unreadable section (EACCES/lock) does not blank the whole list (MINOR-2)', async () => {
    const mem = createMemoryStorage({
      'settings.json': { theme: 'gulf' },
      'spotter.json': { voice: 'en' }
    })
    // Wrap the memory storage so statFile for ONE section rejects with a non-ENOENT
    // error (a permission denial / file lock), like the real FS would.
    const storage: ConfigStorage = {
      ...mem,
      statFile: (rel: string) =>
        rel === 'settings.json'
          ? Promise.reject(Object.assign(new Error('EACCES'), { code: 'EACCES' }))
          : mem.statFile(rel)
    }
    const list = await createConfigEngine(storage).listSavedSections()
    const byId = Object.fromEntries(list.map((info) => [info.id, info]))

    // The whole list still comes back (one bad section never empties the panel)…
    expect(list).toHaveLength(CONFIG_SECTIONS.length)
    // …the unreadable section is flagged + reported not-saved…
    expect(byId.settings.error).toBe(true)
    expect(byId.settings.exists).toBe(false)
    // …and the readable ones are still listed normally.
    expect(byId.spotter.error).toBeUndefined()
    expect(byId.spotter.exists).toBe(true)
  })

  it('omits itemCount for a large file but keeps it for a small one (MINOR-4)', async () => {
    // 80 KiB string → the serialized file is over the 64 KiB itemCount threshold.
    const big = { blob: 'x'.repeat(80 * 1024) }
    const engine = createConfigEngine(
      createMemoryStorage({
        'settings.json': { theme: 'gulf', accentColor: '#fff' }, // small → counted
        'actions-bindings.json': big // large → count omitted (no full re-read)
      })
    )
    const byId = Object.fromEntries((await engine.listSavedSections()).map((info) => [info.id, info]))

    expect(byId.settings.itemCount).toBe(2)
    expect(byId.actions.exists).toBe(true)
    expect(byId.actions.sizeBytes).toBeGreaterThan(64 * 1024)
    expect(byId.actions.itemCount).toBeUndefined()
  })
})

describe('deleteSection / resetSection (remove saved config)', () => {
  it('removes a file store and is idempotent; the section then reads as not saved', async () => {
    const storage = seededStorage()
    const engine = createConfigEngine(storage)

    expect(storage.dump()['settings.json']).toBeDefined()
    const first = await engine.deleteSection('settings')
    expect(first).toEqual({ id: 'settings', removed: true })
    expect(storage.dump()['settings.json']).toBeUndefined()

    // Idempotent: deleting again is a no-op, never throws.
    const second = await engine.deleteSection('settings')
    expect(second).toEqual({ id: 'settings', removed: false })

    const info = (await engine.listSavedSections()).find((s) => s.id === 'settings')
    expect(info?.exists).toBe(false)
  })

  it('removes every .json of a dir store', async () => {
    const storage = seededStorage()
    const engine = createConfigEngine(storage)

    const result = await engine.deleteSection('dashboards')
    expect(result).toEqual({ id: 'dashboards', removed: true })
    const info = (await engine.listSavedSections()).find((s) => s.id === 'dashboards')
    expect(info?.exists).toBe(false)
  })

  it('resetSection is an alias of deleteSection (returns the store to factory default)', async () => {
    const storage = seededStorage()
    const engine = createConfigEngine(storage)

    expect(storage.dump()['rgb-matrix-profiles.json']).toBeDefined()
    const result = await engine.resetSection('rgb-matrix')
    expect(result).toEqual({ id: 'rgb-matrix', removed: true })
    expect(storage.dump()['rgb-matrix-profiles.json']).toBeUndefined()
  })

  it('refuses to delete/reset an unknown OR protected section id', async () => {
    const engine = createConfigEngine(seededStorage())
    await expect(engine.deleteSection('iracing-credentials')).rejects.toThrow()
    await expect(engine.deleteSection('iracing-oauth')).rejects.toThrow()
    await expect(engine.resetSection('iracing-session')).rejects.toThrow()
    await expect(engine.deleteSection('totally-unknown')).rejects.toThrow()
  })

  it('the storage layer itself refuses to remove a forbidden file/dir', async () => {
    const storage = createMemoryStorage()
    await expect(storage.removeFile('iracing-oauth.bin')).rejects.toThrow()
    await expect(storage.removeFile('../escape.json')).rejects.toThrow()
    await expect(storage.removeDirJson('track-maps')).rejects.toThrow()
  })
})

describe('saved-config deletion on real files (file storage)', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(process.cwd(), 'config-del-test-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('deletes the section file on disk and is idempotent', async () => {
    const storage = createFileStorage(root)
    const engine = createConfigEngine(storage)
    writeFileSync(join(root, 'settings.json'), JSON.stringify({ theme: 'gulf' }))

    expect((await engine.listSavedSections()).find((s) => s.id === 'settings')?.exists).toBe(true)
    expect(await engine.deleteSection('settings')).toEqual({ id: 'settings', removed: true })
    expect(existsSync(join(root, 'settings.json'))).toBe(false)
    expect(await engine.deleteSection('settings')).toEqual({ id: 'settings', removed: false })
  })

  it('clears a dir section .json but keeps non-.json assets and outside files', async () => {
    const storage = createFileStorage(root)
    const engine = createConfigEngine(storage)
    mkdirSync(join(root, 'dashboards'), { recursive: true })
    writeFileSync(join(root, 'dashboards', 'a.json'), JSON.stringify({ id: 'a' }))
    writeFileSync(join(root, 'dashboards', 'b.json'), JSON.stringify({ id: 'b' }))
    writeFileSync(join(root, 'dashboards', 'keep.png'), 'not-json')
    writeFileSync(join(root, 'settings.json'), JSON.stringify({ theme: 'gulf' }))

    expect(await engine.deleteSection('dashboards')).toEqual({ id: 'dashboards', removed: true })

    // The .json configs are gone; the image asset and the outside file remain.
    expect(readdirSync(join(root, 'dashboards'))).toEqual(['keep.png'])
    expect(existsSync(join(root, 'settings.json'))).toBe(true)
  })

  it('never removes a secret living in the same userData dir', async () => {
    const storage = createFileStorage(root)
    const engine = createConfigEngine(storage)
    writeFileSync(join(root, 'iracing-oauth.bin'), JSON.stringify({ accessToken: 'TOPSECRET' }))
    writeFileSync(join(root, 'settings.json'), JSON.stringify({ theme: 'gulf' }))

    // A secret is not an allowlisted section, so it can never be targeted…
    await expect(engine.deleteSection('iracing-oauth')).rejects.toThrow()
    // …and the storage guard refuses the raw path too.
    await expect(storage.removeFile('iracing-oauth.bin')).rejects.toThrow()
    expect(existsSync(join(root, 'iracing-oauth.bin'))).toBe(true)

    // listSavedSections must not surface the secret either.
    const serialized = JSON.stringify(await engine.listSavedSections())
    expect(serialized).not.toContain('TOPSECRET')
    expect(serialized).not.toContain('iracing-oauth')
  })
})

describe('file-storage hardening (symlink + boundary — S2/S3)', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(process.cwd(), 'config-hard-test-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('statDir skips a symlinked .json, never counting the target metadata (S2)', async () => {
    const storage = createFileStorage(root)
    mkdirSync(join(root, 'dashboards'), { recursive: true })
    writeFileSync(join(root, 'dashboards', 'real.json'), JSON.stringify({ id: 'real' }))
    // Plant a symlink pointing at a big file OUTSIDE the section dir.
    const target = join(root, 'outside-big.json')
    writeFileSync(target, JSON.stringify({ big: 'x'.repeat(10_000) }))
    symlinkSync(target, join(root, 'dashboards', 'link.json'))

    const info = await storage.statDir('dashboards')
    // Only the real .json is counted; the symlink (and its 10 KB target) is ignored.
    expect(info.itemCount).toBe(1)
    expect(info.sizeBytes).toBeLessThan(1000)
  })

  it('resolveSafe rejects an absolute path that escapes baseDir (S3 boundary)', async () => {
    const storage = createFileStorage(root)
    // Absolute, no '..' and no secret token → it slips past the name-based forbidden
    // check, so ONLY the baseDir boundary assert can stop it.
    const escape = resolve(root, '..', 'r9-boundary-escape.json')
    expect(isForbiddenConfigPath(escape)).toBe(false)
    await expect(storage.statFile(escape)).rejects.toThrow()
    await expect(storage.removeFile(escape)).rejects.toThrow()
  })

  it('still resolves legit allowlisted paths inside baseDir (S3 no regression)', async () => {
    const storage = createFileStorage(root)
    writeFileSync(join(root, 'settings.json'), JSON.stringify({ theme: 'gulf' }))
    const info = await storage.statFile('settings.json')
    expect(info.exists).toBe(true)
  })
})
