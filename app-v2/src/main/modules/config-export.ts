import { dialog, type OpenDialogOptions, type SaveDialogOptions } from 'electron'
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import type { ModuleContext } from '../module-context'
import {
  CONFIG_BUNDLE_APP_ID,
  CONFIG_BUNDLE_VERSION,
  CONFIG_IO_CHANNELS,
  CONFIG_SECTION_RELOAD_SIGNAL,
  CONFIG_SECTION_RESET_SIGNAL,
  CONFIG_SECTIONS,
  getConfigSection,
  isConfigBundle,
  isConfigSectionExport,
  isForbiddenConfigPath,
  isPlainObject,
  type ConfigBundle,
  type ConfigDeleteResult,
  type ConfigExportResult,
  type ConfigImportResult,
  type ConfigImportSummary,
  type ConfigSectionImportDetail,
  type ConfigSectionReloadCallback,
  type ConfigSectionReloadResult,
  type ConfigSectionExport,
  type SavedSectionInfo
} from '../../shared/config-io'
import { parseRgbMatrixProfilesPayload } from './rgb-matrix-profile-store'
import { dashboardDistributionRestrictionReason } from '../../shared/third-party-dashboard-catalog'
import {
  importAccessibilityCueConfig,
  resetAccessibilityCueConfig
} from './accessibility-cues'
import { validateAccessibilityCueStoreImport } from '../../shared/accessibility-cues'

export const FULL_IMPORT_DISABLED = 'FULL_IMPORT_DISABLED' as const

export interface FullImportDisabledResult {
  readonly ok: false
  readonly code: typeof FULL_IMPORT_DISABLED
}

export const FULL_IMPORT_DISABLED_RESULT: FullImportDisabledResult = Object.freeze({
  ok: false,
  code: FULL_IMPORT_DISABLED
})

// ─── Storage abstraction ───────────────────────────────────────────────────────
// The engine reads/writes config ONLY through this interface, so the whole
// export/import flow can be unit-tested in-memory (no disk, no electron). The
// production implementation is a thin node:fs wrapper bound to userData.

export interface ConfigStorage {
  /** Parsed JSON of a single file, or undefined if it does not exist. */
  readFileJson(relPath: string): Promise<unknown>
  writeFileJson(relPath: string, data: unknown): Promise<void>
  /** Map of `<filename>.json` → parsed JSON for every JSON file in a directory. */
  readDirJson(relDir: string): Promise<Record<string, unknown>>
  writeDirJson(relDir: string, files: Record<string, unknown>): Promise<void>
  /** Size/last-modified for a 'file' store (exists:false when absent). */
  statFile(relPath: string): Promise<ConfigStorageStat>
  /** Aggregate size/last-modified + .json count for a 'dir' store. */
  statDir(relDir: string): Promise<ConfigStorageStat>
  /** Remove a 'file' store. Returns true if it existed (idempotent otherwise). */
  removeFile(relPath: string): Promise<boolean>
  /** Remove every .json inside a 'dir' store (non-.json assets are kept). Returns true if any were removed. */
  removeDirJson(relDir: string): Promise<boolean>
}

// Saved-state stat returned by the storage layer. `itemCount` is populated by
// statDir (number of .json files); for files the engine derives it from content.
export interface ConfigStorageStat {
  exists: boolean
  sizeBytes: number
  modifiedAt: number | null
  itemCount?: number
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT'
}

const configFileLocks = new Map<string, Promise<void>>()

async function withConfigFileLock<T>(
  path: string,
  operation: () => Promise<T>
): Promise<T> {
  const previous = configFileLocks.get(path) ?? Promise.resolve()
  const ready = previous.catch(() => undefined)
  let release!: () => void
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  const tail = ready.then(() => current)
  configFileLocks.set(path, tail)
  await ready
  try {
    return await operation()
  } finally {
    release()
    if (configFileLocks.get(path) === tail) {
      configFileLocks.delete(path)
    }
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (isMissing(error)) return false
    throw error
  }
}

// Serialized on-disk footprint of a value, matching writeFileJson's exact format
// (pretty JSON + trailing newline). Used by the in-memory storage to report a
// size that mirrors what the file store would write.
function jsonByteLength(value: unknown): number {
  return Buffer.byteLength(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

// Only ever target plain *.json filenames INSIDE a section dir — never other
// file types, never a path with separators or traversal.
function isPlainJsonName(name: string): boolean {
  return name.endsWith('.json') && !name.includes('/') && !name.includes('\\') && !name.includes('..')
}

// Above this size a 'file' section's itemCount isn't worth a full read+parse on
// every listing. listSavedSections runs on each `config:changed`, and a deleteAll
// fans out to ~N+1 listings, so large stores report size only (count omitted).
const ITEM_COUNT_MAX_BYTES = 64 * 1024

// Real filesystem storage rooted at `baseDir` (app.getPath('userData')). Every
// access is checked against isForbiddenConfigPath so secret/cache paths can
// never be touched even if a caller passes one in.
export function createFileStorage(baseDir: string): ConfigStorage {
  const root = resolve(baseDir)
  const resolveSafe = (rel: string): string => {
    if (isForbiddenConfigPath(rel)) throw new Error(`Protected configuration path refused: ${rel}`)
    const full = resolve(root, rel)
    // Boundary lock (defense-in-depth): the resolved path MUST stay inside baseDir.
    // isForbiddenConfigPath already blocks '..' traversal and secret names, but this
    // additionally rejects any absolute/escaping path a future caller might pass that
    // slips past the name-based allowlist.
    if (full !== root && !full.startsWith(root + sep)) {
      throw new Error(`Configuration path outside the base directory refused: ${rel}`)
    }
    return full
  }

  return {
    async readFileJson(relPath) {
      const full = resolveSafe(relPath)
      return withConfigFileLock(full, async () => {
        const staging = `${full}.staging`
        const previous = `${full}.previous`
        let liveError: unknown
        try {
          const parsed = JSON.parse(await readFile(full, 'utf8')) as unknown
          await rm(staging, { force: true }).catch(() => undefined)
          await rm(previous, { force: true }).catch(() => undefined)
          return parsed
        } catch (error) {
          liveError = error
        }

        try {
          const rawPrevious = await readFile(previous, 'utf8')
          const parsedPrevious = JSON.parse(rawPrevious) as unknown
          if (await pathExists(full)) {
            await rm(full, { force: true })
          }
          await rename(previous, full)
          await rm(staging, { force: true }).catch(() => undefined)
          return parsedPrevious
        } catch (recoveryError) {
          if (isMissing(liveError) && isMissing(recoveryError)) return undefined
          throw liveError
        }
      })
    },
    async writeFileJson(relPath, data) {
      const full = resolveSafe(relPath)
      await withConfigFileLock(full, async () => {
        const staging = `${full}.staging`
        const previous = `${full}.previous`
        const payload = `${JSON.stringify(data, null, 2)}\n`
        let previousMoved = false
        let committed = false
        await mkdir(dirname(full), { recursive: true })
        try {
          await rm(staging, { force: true })
          await writeFile(staging, payload, 'utf8')
          const handle = await open(staging, 'r+')
          try {
            await handle.sync()
          } finally {
            await handle.close()
          }
          const stagedPayload = await readFile(staging, 'utf8')
          JSON.parse(stagedPayload)
          if (stagedPayload !== payload) {
            throw new Error(`Atomic configuration staging verification failed: ${relPath}`)
          }
          if (await pathExists(full)) {
            await rm(previous, { force: true })
            await rename(full, previous)
            previousMoved = true
          }
          await rename(staging, full)
          committed = true
          if (previousMoved) {
            await rm(previous, { force: true }).catch(() => undefined)
          }
        } catch (error) {
          await rm(staging, { force: true }).catch(() => undefined)
          if (
            !committed &&
            previousMoved &&
            (await pathExists(previous)) &&
            !(await pathExists(full))
          ) {
            await rename(previous, full).catch(() => undefined)
          }
          throw error
        }
      })
    },
    async readDirJson(relDir) {
      const dir = resolveSafe(relDir)
      const out: Record<string, unknown> = {}
      let names: string[] = []
      try {
        names = await readdir(dir)
      } catch (error) {
        if (isMissing(error)) return out
        throw error
      }
      for (const name of names) {
        if (!name.endsWith('.json')) continue
        try {
          // lstat (NOT stat) so a planted symlink is skipped instead of followed:
          // `statDir` already refuses them for size/count, and following one here
          // would copy an arbitrary file's contents into an exported bundle.
          const info = await lstat(join(dir, name))
          if (info.isSymbolicLink() || !info.isFile()) continue
          out[name] = JSON.parse(await readFile(join(dir, name), 'utf8')) as unknown
        } catch {
          // Ignore corrupt/unreadable entries — a partial export is fine.
        }
      }
      return out
    },
    async writeDirJson(relDir, files) {
      const dir = resolveSafe(relDir)
      await mkdir(dir, { recursive: true })
      // Clean-replace: delete the directory's existing *.json BEFORE writing the
      // bundle's files, so an imported section fully REPLACES the previous one
      // (matches the "vai SOBRESCREVER" wording the UI shows). `resolveSafe`
      // already refused forbidden/allowlisted-only paths, and we additionally
      // only ever delete REGULAR *.json files INSIDE this dir — never other file
      // types (images, etc.) and never anything outside it.
      try {
        const entries = await readdir(dir, { withFileTypes: true })
        await Promise.all(
          entries
            .filter(
              (ent) =>
                ent.isFile() &&
                ent.name.endsWith('.json') &&
                !ent.name.includes('/') &&
                !ent.name.includes('\\') &&
                !ent.name.includes('..')
            )
            .map((ent) => rm(join(dir, ent.name), { force: true }))
        )
      } catch (error) {
        if (!isMissing(error)) throw error
      }
      for (const [name, content] of Object.entries(files)) {
        // Only ever write plain JSON filenames inside the target directory.
        if (!name.endsWith('.json') || name.includes('/') || name.includes('\\') || name.includes('..')) continue
        await writeFile(join(dir, name), `${JSON.stringify(content, null, 2)}\n`, 'utf8')
      }
    },
    async statFile(relPath) {
      const full = resolveSafe(relPath)
      try {
        const info = await stat(full)
        return { exists: true, sizeBytes: info.size, modifiedAt: info.mtimeMs }
      } catch (error) {
        if (isMissing(error)) return { exists: false, sizeBytes: 0, modifiedAt: null }
        throw error
      }
    },
    async statDir(relDir) {
      const dir = resolveSafe(relDir)
      let names: string[] = []
      try {
        names = await readdir(dir)
      } catch (error) {
        if (isMissing(error)) return { exists: false, sizeBytes: 0, modifiedAt: null, itemCount: 0 }
        throw error
      }
      let sizeBytes = 0
      let modifiedAt: number | null = null
      let itemCount = 0
      for (const name of names) {
        if (!isPlainJsonName(name)) continue
        try {
          // lstat (NOT stat) so a planted symlink reports its OWN metadata and is
          // skipped below — never the (possibly huge/outside) target's size/mtime.
          const info = await lstat(join(dir, name))
          if (info.isSymbolicLink() || !info.isFile()) continue
          sizeBytes += info.size
          modifiedAt = modifiedAt === null ? info.mtimeMs : Math.max(modifiedAt, info.mtimeMs)
          itemCount += 1
        } catch {
          // Ignore unreadable entries — they don't count toward the saved state.
        }
      }
      return { exists: true, sizeBytes, modifiedAt, itemCount }
    },
    async removeFile(relPath) {
      const full = resolveSafe(relPath)
      return withConfigFileLock(full, async () => {
        const paths = [full, `${full}.staging`, `${full}.previous`]
        const existed = await Promise.all(paths.map(pathExists))
        for (const path of paths) {
          await rm(path, { force: true })
        }
        return existed.some(Boolean)
      })
    },
    async removeDirJson(relDir) {
      const dir = resolveSafe(relDir)
      try {
        const entries = await readdir(dir, { withFileTypes: true })
        // Mirror writeDirJson's clean-replace: remove ONLY regular *.json files
        // inside this dir (keep images/other assets), never anything outside it.
        const targets = entries.filter((ent) => ent.isFile() && isPlainJsonName(ent.name))
        await Promise.all(targets.map((ent) => rm(join(dir, ent.name), { force: true })))
        return targets.length > 0
      } catch (error) {
        if (isMissing(error)) return false
        throw error
      }
    }
  }
}

// In-memory storage for tests. Keys are relative paths; 'file' sections store
// the parsed value, 'dir' sections store a `Record<filename, value>`.
export function createMemoryStorage(
  seed: Record<string, unknown> = {}
): ConfigStorage & { dump(): Record<string, unknown> } {
  const store = new Map<string, unknown>(Object.entries(seed))
  return {
    dump() {
      return Object.fromEntries(store.entries())
    },
    async readFileJson(relPath) {
      return store.has(relPath) ? store.get(relPath) : undefined
    },
    async writeFileJson(relPath, data) {
      if (isForbiddenConfigPath(relPath)) throw new Error(`Caminho protegido recusado: ${relPath}`)
      store.set(relPath, data)
    },
    async readDirJson(relDir) {
      const value = store.get(relDir)
      return isPlainObject(value) ? { ...value } : {}
    },
    async writeDirJson(relDir, files) {
      if (isForbiddenConfigPath(relDir)) throw new Error(`Caminho protegido recusado: ${relDir}`)
      store.set(relDir, { ...files })
    },
    async statFile(relPath) {
      if (!store.has(relPath)) return { exists: false, sizeBytes: 0, modifiedAt: null }
      return { exists: true, sizeBytes: jsonByteLength(store.get(relPath)), modifiedAt: null }
    },
    async statDir(relDir) {
      const value = store.get(relDir)
      if (!isPlainObject(value)) return { exists: false, sizeBytes: 0, modifiedAt: null, itemCount: 0 }
      const names = Object.keys(value).filter(isPlainJsonName)
      let sizeBytes = 0
      for (const name of names) sizeBytes += jsonByteLength(value[name])
      return { exists: names.length > 0, sizeBytes, modifiedAt: null, itemCount: names.length }
    },
    async removeFile(relPath) {
      if (isForbiddenConfigPath(relPath)) throw new Error(`Caminho protegido recusado: ${relPath}`)
      return store.delete(relPath)
    },
    async removeDirJson(relDir) {
      if (isForbiddenConfigPath(relDir)) throw new Error(`Caminho protegido recusado: ${relDir}`)
      const value = store.get(relDir)
      const had = isPlainObject(value) && Object.keys(value).some(isPlainJsonName)
      store.delete(relDir)
      return had
    }
  }
}

// ─── Section registry ───────────────────────────────────────────────────────────
// Maps each sectionId → { read(), write(data) } bound to the storage layer.

export interface SectionAccessor {
  read(): Promise<unknown>
  write(data: unknown): Promise<void>
}

interface PreparedSectionData {
  data: unknown
  detail?: ConfigSectionImportDetail
}

function assertSectionDistributionAllowed(sectionId: string, data: unknown): void {
  if (sectionId !== 'dashboards' || !isPlainObject(data)) return
  for (const [file, dashboard] of Object.entries(data)) {
    if (file === 'dashboard-playlist.json') continue
    const restriction = dashboardDistributionRestrictionReason(dashboard, 'share')
    if (restriction) throw new Error(`Dashboard configuration sharing blocked for "${file}". ${restriction}`)
  }
}

function prepareSectionData(sectionId: string, data: unknown): PreparedSectionData {
  if (sectionId === 'accessibility-cues') {
    return { data: validateAccessibilityCueStoreImport(data) }
  }
  if (sectionId !== 'rgb-matrix') return { data }
  const parsed = parseRgbMatrixProfilesPayload(data)
  return {
    data: parsed.payload,
    detail: { itemCount: parsed.profileCount }
  }
}

function assertExactContainerKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string
): void {
  const allowedKeys = new Set(allowed)
  const unexpected = Object.keys(value).filter((key) => !allowedKeys.has(key))
  if (unexpected.length > 0) {
    throw new Error(
      `Invalid accessibility cue import ${label}: unsupported field "${unexpected[0]}".`
    )
  }
}

export function validateAccessibilityImportContainer(payload: unknown): unknown {
  if (isPlainObject(payload) && ('sectionId' in payload || 'data' in payload)) {
    assertExactContainerKeys(
      payload,
      ['app', 'version', 'exportedAt', 'sectionId', 'data'],
      'section wrapper'
    )
    if (
      payload.app !== CONFIG_BUNDLE_APP_ID ||
      payload.version !== CONFIG_BUNDLE_VERSION ||
      typeof payload.exportedAt !== 'string' ||
      payload.sectionId !== 'accessibility-cues' ||
      !('data' in payload)
    ) {
      throw new Error('Invalid accessibility cue import section wrapper.')
    }
    return {
      ...payload,
      data: validateAccessibilityCueStoreImport(payload.data)
    }
  }
  if (isPlainObject(payload) && ('sections' in payload || 'app' in payload)) {
    assertExactContainerKeys(
      payload,
      ['app', 'version', 'exportedAt', 'sections'],
      'bundle wrapper'
    )
    if (
      payload.app !== CONFIG_BUNDLE_APP_ID ||
      payload.version !== CONFIG_BUNDLE_VERSION ||
      typeof payload.exportedAt !== 'string' ||
      !isPlainObject(payload.sections)
    ) {
      throw new Error('Invalid accessibility cue import bundle wrapper.')
    }
    if (!('accessibility-cues' in payload.sections)) return payload
    return {
      ...payload,
      sections: {
        ...payload.sections,
        'accessibility-cues': validateAccessibilityCueStoreImport(
          payload.sections['accessibility-cues']
        )
      }
    }
  }
  return validateAccessibilityCueStoreImport(payload)
}

export function buildRegistry(storage: ConfigStorage): Record<string, SectionAccessor> {
  const registry: Record<string, SectionAccessor> = {}
  for (const section of CONFIG_SECTIONS) {
    // Defense-in-depth: never wire a forbidden path into the registry.
    if (isForbiddenConfigPath(section.path)) continue
    registry[section.id] =
      section.kind === 'dir'
        ? {
            read: async () => {
              const map = await storage.readDirJson(section.path)
              return Object.keys(map).length > 0 ? map : undefined
            },
            write: (data) => storage.writeDirJson(section.path, isPlainObject(data) ? data : {})
          }
        : {
            read: () => storage.readFileJson(section.path),
            write: (data) => storage.writeFileJson(section.path, data)
          }
  }
  return registry
}

// ─── Engine ───────────────────────────────────────────────────────────────────

export interface ConfigEngine {
  registry: Record<string, SectionAccessor>
  exportAll(): Promise<ConfigBundle>
  importAll(bundle: unknown, opts?: { sections?: string[] }): Promise<ConfigImportSummary>
  exportSection(sectionId: string): Promise<ConfigSectionExport>
  importSection(sectionId: string, payload: unknown): Promise<ConfigImportSummary>
  /** Read-only metadata for every allowlisted section's saved state under userData. */
  listSavedSections(): Promise<SavedSectionInfo[]>
  /** Delete a section's userData store so it returns to factory default on next load. */
  deleteSection(sectionId: string): Promise<ConfigDeleteResult>
  /** Reset a section to factory default — identical to deleteSection (the store is removed). */
  resetSection(sectionId: string): Promise<ConfigDeleteResult>
}

export function createConfigEngine(storage: ConfigStorage): ConfigEngine {
  const registry = buildRegistry(storage)

  async function exportAll(): Promise<ConfigBundle> {
    const sections: Record<string, unknown> = {}
    for (const section of CONFIG_SECTIONS) {
      const accessor = registry[section.id]
      if (!accessor) continue
      const data = await accessor.read()
      if (data !== undefined) {
        assertSectionDistributionAllowed(section.id, data)
        sections[section.id] = prepareSectionData(section.id, data).data
      }
    }
    return {
      app: CONFIG_BUNDLE_APP_ID,
      version: CONFIG_BUNDLE_VERSION,
      exportedAt: new Date().toISOString(),
      sections
    }
  }

  async function importAll(bundle: unknown, opts?: { sections?: string[] }): Promise<ConfigImportSummary> {
    if (!isConfigBundle(bundle)) {
      throw new Error('Invalid file: not an Ultimate Sim App profile.')
    }
    const filter = opts?.sections ? new Set(opts.sections) : null
    const applied: string[] = []
    const skipped: string[] = []
    const unknown: string[] = []
    const details: Record<string, ConfigSectionImportDetail> = {}
    const pending: Array<{ id: string; accessor: SectionAccessor; prepared: PreparedSectionData }> = []

    for (const [id, data] of Object.entries(bundle.sections)) {
      if (filter && !filter.has(id)) {
        skipped.push(id)
        continue
      }
      const section = getConfigSection(id)
      const accessor = registry[id]
      // Unknown OR forbidden ids are ignored — auth stores can never be targeted.
      if (!section || !accessor || isForbiddenConfigPath(section.path)) {
        unknown.push(id)
        continue
      }
      pending.push({ id, accessor, prepared: prepareSectionData(id, data) })
    }

    // Validate every selected section before writing any of them. A malformed
    // iFlag section can therefore never leave a half-imported full bundle behind.
    for (const { id, accessor, prepared } of pending) {
      await accessor.write(prepared.data)
      applied.push(id)
      if (prepared.detail) details[id] = prepared.detail
    }

    return {
      app: CONFIG_BUNDLE_APP_ID,
      version: bundle.version,
      applied,
      skipped,
      unknown,
      ...(Object.keys(details).length > 0 ? { details } : {})
    }
  }

  async function exportSection(sectionId: string): Promise<ConfigSectionExport> {
    const section = getConfigSection(sectionId)
    const accessor = registry[sectionId]
    if (!section || !accessor) throw new Error(`Unknown configuration section: ${sectionId}`)
    const stored = (await accessor.read()) ?? null
    assertSectionDistributionAllowed(sectionId, stored)
    const data = prepareSectionData(sectionId, stored).data
    return {
      app: CONFIG_BUNDLE_APP_ID,
      version: CONFIG_BUNDLE_VERSION,
      exportedAt: new Date().toISOString(),
      sectionId,
      data
    }
  }

  async function importSection(sectionId: string, payload: unknown): Promise<ConfigImportSummary> {
    const section = getConfigSection(sectionId)
    const accessor = registry[sectionId]
    if (!section || !accessor || isForbiddenConfigPath(section.path)) {
      throw new Error(`Unknown or protected configuration section: ${sectionId}`)
    }

    // Accept a section-export file, a full bundle (extract the matching section),
    // or raw section data — whichever the user opened.
    let data: unknown = payload
    if (isConfigSectionExport(payload)) {
      if (payload.sectionId !== sectionId) {
        throw new Error(`The file is from section "${payload.sectionId}", not "${sectionId}".`)
      }
      data = payload.data
    } else if (isConfigBundle(payload)) {
      if (!(sectionId in payload.sections)) {
        throw new Error(`The profile does not contain section "${sectionId}".`)
      }
      data = payload.sections[sectionId]
    }

    const prepared = prepareSectionData(sectionId, data)
    await accessor.write(prepared.data)
    return {
      app: CONFIG_BUNDLE_APP_ID,
      version: CONFIG_BUNDLE_VERSION,
      applied: [sectionId],
      skipped: [],
      unknown: [],
      ...(prepared.detail ? { details: { [sectionId]: prepared.detail } } : {})
    }
  }

  // Cheap top-level count for a 'file' section: array length or object key count
  // when the value is trivially shaped; undefined otherwise (so the UI omits it).
  function fileItemCount(data: unknown): number | undefined {
    if (Array.isArray(data)) return data.length
    if (isPlainObject(data)) return Object.keys(data).length
    return undefined
  }

  async function listSavedSections(): Promise<SavedSectionInfo[]> {
    const out: SavedSectionInfo[] = []
    for (const section of CONFIG_SECTIONS) {
      // Defense-in-depth: an allowlisted-but-forbidden path is never inspected.
      if (isForbiddenConfigPath(section.path)) continue
      try {
        if (section.kind === 'dir') {
          const info = await storage.statDir(section.path)
          out.push({
            id: section.id,
            label: section.label,
            kind: 'dir',
            exists: info.exists && (info.itemCount ?? 0) > 0,
            sizeBytes: info.sizeBytes,
            modifiedAt: info.modifiedAt,
            itemCount: info.itemCount
          })
        } else {
          const info = await storage.statFile(section.path)
          let itemCount: number | undefined
          // Only read+parse the file for a count when it's small. A deleteAll fans
          // out to ~N+1 listings, so re-reading a large store on every refresh is
          // wasteful — above the threshold we report size only and omit itemCount.
          if (info.exists && info.sizeBytes <= ITEM_COUNT_MAX_BYTES) {
            try {
              itemCount = fileItemCount(await storage.readFileJson(section.path))
            } catch {
              // Corrupt/unparseable file → omit the count, still report it exists.
            }
          }
          out.push({
            id: section.id,
            label: section.label,
            kind: 'file',
            exists: info.exists,
            sizeBytes: info.sizeBytes,
            modifiedAt: info.modifiedAt,
            itemCount
          })
        }
      } catch {
        // A SINGLE unreadable store (EACCES, a file lock, a transient FS error)
        // must never reject the whole listing and blank the panel. Report this
        // section as not-saved + flagged and keep listing the rest.
        out.push({
          id: section.id,
          label: section.label,
          kind: section.kind,
          exists: false,
          sizeBytes: 0,
          modifiedAt: null,
          error: true
        })
      }
    }
    return out
  }

  // Remove a section's userData store. 'delete' and 'reset' are the SAME
  // operation: dropping the file/dir contents returns the section to its
  // factory default on the next launch. Guarded by getConfigSection (allowlist)
  // + isForbiddenConfigPath; the storage layer re-checks the path again.
  async function removeSection(sectionId: string): Promise<ConfigDeleteResult> {
    const section = getConfigSection(sectionId)
    if (!section) throw new Error(`Unknown configuration section: ${sectionId}`)
    if (isForbiddenConfigPath(section.path)) {
      throw new Error(`Protected configuration section: ${sectionId}`)
    }
    const removed =
      section.kind === 'dir'
        ? await storage.removeDirJson(section.path)
        : await storage.removeFile(section.path)
    return { id: sectionId, removed }
  }

  return {
    registry,
    exportAll,
    importAll,
    exportSection,
    importSection,
    listSavedSections,
    deleteSection: removeSection,
    resetSection: removeSection
  }
}

// ─── Dialog helpers ─────────────────────────────────────────────────────────────

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10)
}

const JSON_FILTER = [{ name: 'Ultimate Sim App config', extensions: ['json'] }]

function exportAllDialogOpts(): SaveDialogOptions {
  return {
    title: 'Exportar profile completo',
    defaultPath: `ultimate-sim-app-profile-${dateStamp()}.json`,
    filters: JSON_FILTER
  }
}

function exportSectionDialogOpts(sectionId: string): SaveDialogOptions {
  return {
    title: `Export configuration — ${sectionId}`,
    defaultPath: `${sectionId}-config-${dateStamp()}.json`,
    filters: JSON_FILTER
  }
}

function importDialogOpts(): OpenDialogOptions {
  return { title: 'Import configuration', properties: ['openFile'], filters: JSON_FILTER }
}

// Hard ceiling for a configuration file the user selects for import. Every
// section this app persists is a small settings document; the largest realistic
// bundle is a few hundred KiB. Without a cap, `readFile` buffers whatever the
// selected path resolves to (a multi-GB file, a device, a growing log) into main
// process memory before a single validation runs.
export const MAX_IMPORT_BYTES = 8 * 1024 * 1024

// Reads a user-selected configuration file for import.
//
// Audit §24-11 / P0-12: the import source must reject symlinks and enforce a size
// cap. `lstat` (never `stat`) is used so a symlink reports its OWN metadata and is
// refused instead of silently following the link — the file dialog is not the only
// caller-controlled path here, and a planted symlink in a shared/synced folder
// would otherwise let an import read an arbitrary file (including the app's own
// credential stores) and, on the export side, hand its contents back to the user.
// The size check runs on the same lstat result, i.e. BEFORE any bytes are read.
export async function readImportPayload(filePath: string): Promise<unknown> {
  let info: Awaited<ReturnType<typeof lstat>>
  try {
    info = await lstat(filePath)
  } catch {
    throw new Error('Invalid configuration file: the selected file could not be read.')
  }
  if (info.isSymbolicLink()) {
    throw new Error('Invalid configuration file: symbolic links are not accepted for import.')
  }
  if (!info.isFile()) {
    throw new Error('Invalid configuration file: the selected path is not a regular file.')
  }
  if (info.size > MAX_IMPORT_BYTES) {
    throw new Error(
      `Invalid configuration file: the file is too large (limit ${Math.floor(MAX_IMPORT_BYTES / (1024 * 1024))} MB).`
    )
  }

  const text = await readFile(filePath, 'utf8')
  if (!text.trim()) throw new Error('Invalid configuration file: the selected JSON file is empty.')
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid configuration file: malformed JSON (${message}).`)
  }
}

// ─── Module registration (IPC + native dialogs) ─────────────────────────────────

export function register(ctx: ModuleContext): void {
  const storage = createFileStorage(ctx.app.getPath('userData'))
  const engine = createConfigEngine(storage)

  // Tell the in-memory module that OWNS each freshly-imported section to RE-READ
  // its store from disk so the change applies live, with no restart. Fired on the
  // main-process-internal CONFIG_SECTION_RELOAD_SIGNAL (never a renderer channel),
  // BEFORE the renderer `config:imported` broadcast so the live module is already
  // reloaded by the time any UI reacts. A module that reloads also holds FRESH
  // in-memory data, so its before-quit flush can no longer clobber the imported
  // file — the import counterpart of the reset-signal protection used by delete.
  const reloadRgbMatrix = (): Promise<ConfigSectionReloadResult> =>
    new Promise((resolveReload, rejectReload) => {
      let settled = false
      const finish: ConfigSectionReloadCallback = (error, result) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (error) rejectReload(new Error(error))
        else if (result) resolveReload(result)
        else rejectReload(new Error('The iFlag module did not return an import application result.'))
      }
      const timer = setTimeout(() => {
        finish('The iFlag profiles were written, but the live module did not confirm that they were applied.')
      }, 5000)
      timer.unref?.()
      let handled = false
      try {
        handled = ctx.ipcMain.emit(
          CONFIG_SECTION_RELOAD_SIGNAL,
          { source: 'config-export' },
          'rgb-matrix',
          finish
        )
      } catch (error) {
        settled = true
        clearTimeout(timer)
        rejectReload(error)
        return
      }
      if (!handled) {
        settled = true
        clearTimeout(timer)
        rejectReload(
          new Error('The iFlag profiles were written, but the iFlag module is not running to apply them.')
        )
      }
    })

  // Audit §24-19: everything below runs AFTER `engine.importSection` already
  // wrote the section to disk. A hot-apply problem is therefore a WARNING on the
  // summary, never a thrown global error — throwing here made a successful,
  // fully-persisted import look to the user like a failed one, when the profiles
  // were on disk and would apply on the next launch.
  const addWarning = (summary: ConfigImportSummary, message: string): void => {
    summary.warnings ??= []
    if (!summary.warnings.includes(message)) summary.warnings.push(message)
  }

  const emitReload = async (summary: ConfigImportSummary): Promise<void> => {
    for (const sectionId of summary.applied) {
      if (sectionId === 'accessibility-cues') continue
      if (sectionId !== 'rgb-matrix') {
        ctx.ipcMain.emit(CONFIG_SECTION_RELOAD_SIGNAL, { source: 'config-export' }, sectionId)
        continue
      }
      let result: ConfigSectionReloadResult
      try {
        result = await reloadRgbMatrix()
      } catch (error) {
        addWarning(summary, error instanceof Error ? error.message : String(error))
        continue
      }
      summary.details ??= {}
      summary.details[sectionId] = {
        ...(summary.details[sectionId] ?? {}),
        hotAppliedCount: result.hotAppliedCount,
        unmatchedItemCount: result.unmatchedItemCount
      }
      if (result.unmatchedItemCount > 0) {
        addWarning(
          summary,
          `Imported ${result.itemCount} iFlag profile(s), but ${result.unmatchedItemCount} could not be matched to this computer's RGB matrix targets.`
        )
      }
      if (result.itemCount > 0 && result.hotAppliedCount === 0) {
        addWarning(
          summary,
          `Imported ${result.itemCount} iFlag profile(s), but no local RGB matrix target was available to apply them.`
        )
      }
    }
  }

  const showSave = (opts: SaveDialogOptions): Promise<Electron.SaveDialogReturnValue> => {
    const win = ctx.getMainWindow()
    return win ? dialog.showSaveDialog(win, opts) : dialog.showSaveDialog(opts)
  }
  const showOpen = (opts: OpenDialogOptions): Promise<Electron.OpenDialogReturnValue> => {
    const win = ctx.getMainWindow()
    return win ? dialog.showOpenDialog(win, opts) : dialog.showOpenDialog(opts)
  }

  ctx.ipcMain.handle(CONFIG_IO_CHANNELS.exportAll, async (): Promise<ConfigExportResult> => {
    const bundle = await engine.exportAll()
    const result = await showSave(exportAllDialogOpts())
    if (result.canceled || !result.filePath) return { canceled: true }
    await writeFile(result.filePath, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8')
    return { canceled: false, filePath: result.filePath, sections: Object.keys(bundle.sections) }
  })

  ctx.ipcMain.handle(
    CONFIG_IO_CHANNELS.importAll,
    (): FullImportDisabledResult => FULL_IMPORT_DISABLED_RESULT
  )

  ctx.ipcMain.handle(
    CONFIG_IO_CHANNELS.exportSection,
    async (_event, sectionId: string): Promise<ConfigExportResult> => {
      const payload = await engine.exportSection(sectionId)
      const result = await showSave(exportSectionDialogOpts(sectionId))
      if (result.canceled || !result.filePath) return { canceled: true }
      await writeFile(result.filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
      return { canceled: false, filePath: result.filePath, sections: [sectionId] }
    }
  )

  ctx.ipcMain.handle(
    CONFIG_IO_CHANNELS.importSection,
    async (_event, sectionId: string): Promise<ConfigImportResult> => {
      const result = await showOpen(importDialogOpts())
      if (result.canceled || result.filePaths.length === 0) return { canceled: true }
      const raw = await readImportPayload(result.filePaths[0])
      const validated =
        sectionId === 'accessibility-cues'
          ? validateAccessibilityImportContainer(raw)
          : raw
      const summary =
        sectionId === 'accessibility-cues'
          ? await importAccessibilityCueConfig(() =>
              engine.importSection(sectionId, validated)
            )
          : await engine.importSection(sectionId, validated)
      await emitReload(summary)
      ctx.broadcast(CONFIG_IO_CHANNELS.imported, summary)
      return { canceled: false, summary }
    }
  )

  // ─── Saved-state inspection + deletion ────────────────────────────────────────
  // Read-only listing of what is persisted under userData (so the user can SEE
  // why old flags/profiles survived a reinstall) plus per-section deletion. Both
  // are bounded to the allowlist + isForbiddenConfigPath, so auth/credential
  // stores can never be listed or removed.
  ctx.ipcMain.handle(CONFIG_IO_CHANNELS.listSaved, (): Promise<SavedSectionInfo[]> => engine.listSavedSections())

  ctx.ipcMain.handle(
    CONFIG_IO_CHANNELS.deleteSection,
    async (_event, sectionId: string): Promise<ConfigDeleteResult> => {
      const result =
        sectionId === 'accessibility-cues'
          ? await resetAccessibilityCueConfig(() =>
              engine.deleteSection(sectionId)
            )
          : await engine.deleteSection(sectionId)
      // Main-process-internal: let the module that OWNS this section drop its
      // in-memory copy, so a before-quit flush can't resurrect the deleted store
      // (the overlays manager debounce-saves on quit). Fired before the renderer
      // broadcast so the live module is neutralized first.
      if (sectionId !== 'accessibility-cues') {
        ctx.ipcMain.emit(CONFIG_SECTION_RESET_SIGNAL, { source: 'config-export' }, sectionId)
      }
      // Tell every window to re-read the on-disk metadata so the panel refreshes.
      ctx.broadcast(CONFIG_IO_CHANNELS.changed, { id: sectionId, action: 'delete', removed: result.removed })
      return result
    }
  )

  ctx.ipcMain.handle(
    CONFIG_IO_CHANNELS.resetSection,
    async (_event, sectionId: string): Promise<ConfigDeleteResult> => {
      const result =
        sectionId === 'accessibility-cues'
          ? await resetAccessibilityCueConfig(() =>
              engine.resetSection(sectionId)
            )
          : await engine.resetSection(sectionId)
      if (sectionId !== 'accessibility-cues') {
        ctx.ipcMain.emit(CONFIG_SECTION_RESET_SIGNAL, { source: 'config-export' }, sectionId)
      }
      ctx.broadcast(CONFIG_IO_CHANNELS.changed, { id: sectionId, action: 'reset', removed: result.removed })
      return result
    }
  )

  // Restart the app so freshly-imported config (written to disk above) is
  // re-read at boot. Every main store caches its file in memory on first load
  // and only re-reads on the next launch, so relaunch is the reliable path —
  // the import UI offers this right after a successful import. Use app.quit()
  // (not exit) so before-quit teardown runs: the iRacing session is flushed to
  // disk and rev-lights/RGB-matrix/OLED are cleared instead of left lit. The
  // ONLY before-quit handler that writes config is the overlays manager (it
  // flushes a pending debounced overlay-position save); a freshly DELETED
  // section is protected separately — deleteSection signals the overlays manager
  // to stop persisting (dropInMemoryForReset) so its flush can't resurrect the
  // deleted file. All other sections persist only on explicit user action.
  ctx.ipcMain.handle(CONFIG_IO_CHANNELS.relaunch, (): void => {
    ctx.app.relaunch()
    ctx.app.quit()
  })
}
