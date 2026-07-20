import { lstat, mkdir, open, opendir, readFile, rename, rm, unlink } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import {
  DEBRIEF_ARCHIVE_MAX_BYTES,
  createDebriefArchive,
  debriefArchiveSummary,
  isDebriefArchiveSessionId,
  normalizeDebriefArchive,
  normalizeDebriefArchiveRecord,
  type DebriefArchive,
  type DebriefArchiveRecord,
  type DebriefArchiveSummary
} from '../../shared/stint-debrief'

const MISSING_SESSION_MESSAGE = 'Historical debrief session was not found or was deleted.'
export const DEBRIEF_ARCHIVE_STALE_TEMP_MS = 5 * 60 * 1_000
const DEBRIEF_ARCHIVE_TEMP_SCAN_LIMIT = 2_048

export interface StintDebriefArchivePersistence {
  load?(filePath: string): Promise<unknown>
  write?(filePath: string, payload: string): Promise<void>
}
export interface StintDebriefArchiveAppendResult {
  inserted: boolean
  summary: DebriefArchiveSummary
  count: number
}

type ArchiveState = 'loading' | 'ready' | 'corrupt'

interface FailedArchiveWrite {
  version: number
  archive: DebriefArchive
  payload: string
  error: unknown
}

function emptyArchive(): DebriefArchive {
  return createDebriefArchive([]) as DebriefArchive
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sameRecord(left: DebriefArchiveRecord, right: DebriefArchiveRecord): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function escapedRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function serializedArchive(archive: DebriefArchive): { archive: DebriefArchive; payload: string } {
  let bounded = archive
  let payload = `${JSON.stringify(bounded, null, 2)}\n`
  while (Buffer.byteLength(payload, 'utf8') > DEBRIEF_ARCHIVE_MAX_BYTES && bounded.records.length > 0) {
    const next = createDebriefArchive(bounded.records.slice(0, -1))
    if (!next) break
    bounded = next
    payload = `${JSON.stringify(bounded, null, 2)}\n`
  }
  if (Buffer.byteLength(payload, 'utf8') > DEBRIEF_ARCHIVE_MAX_BYTES) {
    throw new Error('Stint debrief archive exceeds its local storage size cap.')
  }
  return { archive: bounded, payload }
}

/**
 * Serialized, atomic, local-only persistence for immutable debrief snapshots.
 * Corrupt primary files remain untouched and unavailable instead of being
 * replaced with guessed or partially recovered data.
 */
export class StintDebriefArchiveStore {
  private state: ArchiveState = 'loading'
  private missingOnLoad = false
  private loadError: unknown
  private durable = emptyArchive()
  private desired = emptyArchive()
  private acceptedVersion = 0
  private durableVersion = 0
  private writeSequence = 0
  private writeQueue: Promise<void> = Promise.resolve()
  private latestFailure: FailedArchiveWrite | null = null
  private closed = false
  private readonly loadPromise: Promise<void>
  private readonly writePersisted: (filePath: string, payload: string) => Promise<void>

  constructor(
    private readonly filePath: string,
    persistence: StintDebriefArchivePersistence = {}
  ) {
    this.writePersisted = persistence.write ?? ((targetPath, payload) =>
      this.atomicWrite(targetPath, payload))
    this.loadPromise = this.load(persistence.load)
  }

  private async atomicWrite(targetPath: string, payload: string): Promise<void> {
    const tempPath = `${targetPath}.${process.pid}.${++this.writeSequence}.tmp`
    let handle: Awaited<ReturnType<typeof open>> | null = null
    try {
      const directory = dirname(targetPath)
      await mkdir(directory, { recursive: true })
      handle = await open(tempPath, 'wx', 0o600)
      await handle.writeFile(payload, 'utf8')
      await handle.sync()
      await handle.close()
      handle = null
      await rename(tempPath, targetPath)
      await this.syncDirectory(directory)
    } catch (error) {
      await handle?.close().catch(() => undefined)
      await rm(tempPath, { force: true }).catch(() => undefined)
      throw error
    }
  }

  private async syncDirectory(directory: string): Promise<void> {
    let handle: Awaited<ReturnType<typeof open>> | null = null
    try {
      handle = await open(directory, 'r')
      await handle.sync()
    } catch {
      // The payload itself is fsynced before rename. Some Windows filesystems do
      // not permit opening a directory handle, so directory fsync is best-effort.
    } finally {
      await handle?.close().catch(() => undefined)
    }
  }

  private async cleanupStaleTempFiles(): Promise<void> {
    const directory = resolve(dirname(this.filePath))
    const archiveName = basename(this.filePath)
    const writerTempPattern = new RegExp(
      `^${escapedRegExp(archiveName)}\\.[1-9]\\d{0,9}\\.[1-9]\\d{0,9}\\.tmp$`
    )
    let directoryHandle: Awaited<ReturnType<typeof opendir>> | null = null
    try {
      directoryHandle = await opendir(directory)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }

    const cutoff = Date.now() - DEBRIEF_ARCHIVE_STALE_TEMP_MS
    let scanned = 0
    try {
      for await (const entry of directoryHandle) {
        scanned += 1
        if (scanned > DEBRIEF_ARCHIVE_TEMP_SCAN_LIMIT) break
        if (!writerTempPattern.test(entry.name) || entry.isSymbolicLink()) continue

        const candidatePath = resolve(directory, entry.name)
        if (
          dirname(candidatePath) !== directory ||
          basename(candidatePath) !== entry.name
        ) {
          continue
        }

        let info: Awaited<ReturnType<typeof lstat>>
        try {
          info = await lstat(candidatePath)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
          throw error
        }
        if (info.isSymbolicLink() || !info.isFile() || info.mtimeMs > cutoff) continue
        await unlink(candidatePath)
      }
    } finally {
      await directoryHandle.close().catch(() => undefined)
    }
  }

  private async load(loader?: (filePath: string) => Promise<unknown>): Promise<void> {
    try {
      await this.cleanupStaleTempFiles()
      let parsed: unknown
      if (loader) {
        parsed = await loader(this.filePath)
      } else {
        const raw = await readFile(this.filePath, 'utf8')
        if (Buffer.byteLength(raw, 'utf8') > DEBRIEF_ARCHIVE_MAX_BYTES) {
          throw new Error('Stint debrief archive exceeds its local storage size cap.')
        }
        parsed = JSON.parse(raw) as unknown
      }
      if (parsed === undefined || parsed === null) {
        this.missingOnLoad = true
        this.state = 'ready'
        return
      }
      const archive = normalizeDebriefArchive(parsed)
      if (!archive) {
        this.state = 'corrupt'
        this.loadError = new Error('Stored stint debrief archive failed strict validation.')
        return
      }
      this.durable = archive
      this.desired = archive
      this.state = 'ready'
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        this.missingOnLoad = true
        this.state = 'ready'
        return
      }
      this.state = 'corrupt'
      this.loadError = error
    }
  }

  private assertReady(): void {
    if (this.state === 'corrupt') {
      throw new Error(
        `Stint debrief archive is unavailable because stored data is invalid: ${errorMessage(this.loadError)}`
      )
    }
    if (this.state !== 'ready') throw new Error('Stint debrief archive is still loading.')
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Stint debrief archive lifecycle is shutting down.')
  }

  async ready(): Promise<void> {
    await this.loadPromise
  }

  async wasMissingOnLoad(): Promise<boolean> {
    await this.loadPromise
    return this.missingOnLoad
  }

  async migrate(record: DebriefArchiveRecord): Promise<StintDebriefArchiveAppendResult | null> {
    await this.loadPromise
    this.assertReady()
    if (!this.missingOnLoad || this.desired.records.length > 0) return null
    return this.append(record)
  }

  async append(rawRecord: DebriefArchiveRecord): Promise<StintDebriefArchiveAppendResult> {
    await this.loadPromise
    this.assertOpen()
    this.assertReady()
    const record = normalizeDebriefArchiveRecord(rawRecord)
    if (!record) throw new Error('Stint debrief archive record failed strict validation.')

    const duplicate = this.desired.records.find((candidate) => candidate.id === record.id)
    if (duplicate) {
      if (!sameRecord(duplicate, record)) {
        throw new Error('Stint debrief archive rejected a conflicting immutable session ID.')
      }
      return {
        inserted: false,
        summary: debriefArchiveSummary(duplicate),
        count: this.desired.records.length
      }
    }

    const next = createDebriefArchive([record, ...this.desired.records])
    if (!next) throw new Error('Stint debrief archive could not enforce its storage bounds.')
    const serialized = serializedArchive(next)
    const insertedRecord = serialized.archive.records.find((candidate) => candidate.id === record.id)
    if (!insertedRecord) {
      return {
        inserted: false,
        summary: debriefArchiveSummary(record),
        count: this.desired.records.length
      }
    }

    const version = ++this.acceptedVersion
    this.desired = serialized.archive
    const operation = this.writeQueue.then(() =>
      this.writePersisted(this.filePath, serialized.payload))
    const tracked = operation.then(
      () => {
        this.durable = serialized.archive
        this.durableVersion = version
        this.missingOnLoad = false
        if (this.latestFailure && this.latestFailure.version <= version) this.latestFailure = null
      },
      (error: unknown) => {
        if (!this.latestFailure || version >= this.latestFailure.version) {
          this.latestFailure = {
            version,
            archive: serialized.archive,
            payload: serialized.payload,
            error
          }
        }
        throw error
      }
    )
    this.writeQueue = tracked.then(
      () => undefined,
      () => undefined
    )
    await tracked
    return {
      inserted: true,
      summary: debriefArchiveSummary(insertedRecord),
      count: serialized.archive.records.length
    }
  }

  private async settleLatest(): Promise<void> {
    await this.loadPromise
    this.assertReady()
    await this.writeQueue
    if (
      this.latestFailure &&
      this.latestFailure.version >= this.durableVersion &&
      this.latestFailure.version === this.acceptedVersion
    ) {
      throw this.latestFailure.error
    }
  }

  async list(): Promise<DebriefArchiveSummary[]> {
    await this.settleLatest()
    return this.durable.records.map(debriefArchiveSummary)
  }

  async get(sessionId: unknown): Promise<DebriefArchiveRecord> {
    if (!isDebriefArchiveSessionId(sessionId)) {
      throw new Error('Historical debrief session ID is invalid.')
    }
    await this.settleLatest()
    const record = this.durable.records.find((candidate) => candidate.id === sessionId)
    if (!record) throw new Error(MISSING_SESSION_MESSAGE)
    return normalizeDebriefArchiveRecord(record) as DebriefArchiveRecord
  }

  quiesce(): void {
    this.closed = true
  }

  async dispose(): Promise<void> {
    await this.loadPromise
    if (this.state === 'corrupt') return
    await this.writeQueue
    const failure = this.latestFailure
    if (!failure || failure.version < this.acceptedVersion) return
    try {
      await this.writePersisted(this.filePath, failure.payload)
      this.durable = failure.archive
      this.desired = failure.archive
      this.durableVersion = failure.version
      this.latestFailure = null
      this.missingOnLoad = false
    } catch (error) {
      this.latestFailure = { ...failure, error }
      throw new Error(
        `Stint debrief archive durability failed during teardown: ${errorMessage(error)}`,
        { cause: error }
      )
    }
  }
}
