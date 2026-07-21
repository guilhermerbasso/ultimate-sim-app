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
const MAX_PROCESS_ID = 2_147_483_647

interface ArchiveDirectorySyncHandle {
  sync(): Promise<void>
  close(): Promise<void>
}

export interface StintDebriefArchivePersistence {
  load?(filePath: string): Promise<unknown>
  write?(filePath: string, payload: string): Promise<void>
  now?(): number
  isProcessAlive?(pid: number): boolean
  scheduleCleanup?(callback: () => Promise<void>, delayMs: number): unknown
  cancelCleanup?(timer: unknown): void
  openDirectory?(directory: string): Promise<ArchiveDirectorySyncHandle>
  platform?: NodeJS.Platform
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

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code
}

function isUnsupportedWindowsDirectoryOperation(
  error: unknown,
  platform: NodeJS.Platform
): boolean {
  // Node exposes unsupported Windows directory fsync/open as EPERM. Anything
  // else may represent real I/O or integrity loss and must fail publication.
  return platform === 'win32' && errorCode(error) === 'EPERM'
}

function defaultProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return errorCode(error) !== 'ESRCH'
  }
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
  private readonly now: () => number
  private readonly isProcessAlive: (pid: number) => boolean
  private readonly scheduleCleanup: (
    callback: () => Promise<void>,
    delayMs: number
  ) => unknown
  private readonly cancelCleanup: (timer: unknown) => void
  private readonly openDirectory: (
    directory: string
  ) => Promise<ArchiveDirectorySyncHandle>
  private readonly platform: NodeJS.Platform
  private cleanupFollowUpScheduled = false
  private cleanupTimerActive = false
  private cleanupTimer: unknown
  private cleanupInFlight: Promise<void> | null = null
  private cleanupStopped = false
  private followUpCleanupError: unknown

  constructor(
    private readonly filePath: string,
    persistence: StintDebriefArchivePersistence = {}
  ) {
    this.now = persistence.now ?? Date.now
    this.isProcessAlive = persistence.isProcessAlive ?? defaultProcessAlive
    this.scheduleCleanup = persistence.scheduleCleanup ?? ((callback, delayMs) => {
      const timer = setTimeout(() => void callback(), delayMs)
      timer.unref()
      return timer
    })
    this.cancelCleanup = persistence.cancelCleanup ?? ((timer) => {
      clearTimeout(timer as ReturnType<typeof setTimeout>)
    })
    this.openDirectory = persistence.openDirectory ?? ((directory) =>
      open(directory, 'r'))
    this.platform = persistence.platform ?? process.platform
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
    let handle: ArchiveDirectorySyncHandle
    try {
      handle = await this.openDirectory(directory)
    } catch (error) {
      if (isUnsupportedWindowsDirectoryOperation(error, this.platform)) return
      throw error
    }
    try {
      await handle.sync()
    } catch (error) {
      if (!isUnsupportedWindowsDirectoryOperation(error, this.platform)) {
        throw error
      }
    } finally {
      await handle.close()
    }
  }

  private ownerIsAlive(pid: number): boolean {
    if (pid === process.pid) return true
    try {
      return this.isProcessAlive(pid)
    } catch {
      // Liveness uncertainty must never authorize deletion of a possible writer.
      return true
    }
  }

  private scheduleFollowUpCleanup(delayMs: number): void {
    if (
      this.cleanupFollowUpScheduled ||
      this.cleanupStopped
    ) return
    this.cleanupFollowUpScheduled = true
    this.cleanupTimerActive = true
    this.cleanupTimer = this.scheduleCleanup(
      () => this.runFollowUpCleanup(),
      Math.max(1, Math.min(DEBRIEF_ARCHIVE_STALE_TEMP_MS, delayMs))
    )
    const timer = this.cleanupTimer as { unref?: () => void } | null
    timer?.unref?.()
  }

  private async runFollowUpCleanup(): Promise<void> {
    this.cleanupTimerActive = false
    this.cleanupTimer = undefined
    if (this.cleanupStopped) return
    const cleanup = this.cleanupStaleTempFiles(false)
    this.cleanupInFlight = cleanup
    try {
      await cleanup
      this.followUpCleanupError = undefined
    } catch (error) {
      this.followUpCleanupError = error
    } finally {
      if (this.cleanupInFlight === cleanup) this.cleanupInFlight = null
    }
  }

  private async stopFollowUpCleanup(): Promise<void> {
    this.cleanupStopped = true
    if (this.cleanupTimerActive) {
      this.cancelCleanup(this.cleanupTimer)
      this.cleanupTimerActive = false
      this.cleanupTimer = undefined
    }
    await this.cleanupInFlight
  }

  private async cleanupStaleTempFiles(scheduleFollowUp = true): Promise<void> {
    const directory = resolve(dirname(this.filePath))
    const archiveName = basename(this.filePath)
    const writerTempPattern = new RegExp(
      `^${escapedRegExp(archiveName)}\\.([1-9]\\d{0,9})\\.[1-9]\\d{0,9}\\.tmp$`
    )
    let directoryHandle: Awaited<ReturnType<typeof opendir>> | null = null
    try {
      directoryHandle = await opendir(directory)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }

    let scanned = 0
    let followUpDelayMs = 0
    try {
      for await (const entry of directoryHandle) {
        scanned += 1
        if (scanned > DEBRIEF_ARCHIVE_TEMP_SCAN_LIMIT) break
        const match = writerTempPattern.exec(entry.name)
        if (!match || entry.isSymbolicLink()) continue
        const ownerPid = Number(match[1])
        if (
          !Number.isSafeInteger(ownerPid) ||
          ownerPid < 1 ||
          ownerPid > MAX_PROCESS_ID
        ) continue

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
        if (info.isSymbolicLink() || !info.isFile()) continue
        if (this.ownerIsAlive(ownerPid)) {
          const ageMs = Math.max(0, this.now() - info.mtimeMs)
          const remainingGraceMs = Math.max(
            1,
            DEBRIEF_ARCHIVE_STALE_TEMP_MS -
              Math.min(DEBRIEF_ARCHIVE_STALE_TEMP_MS, ageMs)
          )
          followUpDelayMs = Math.max(followUpDelayMs, remainingGraceMs)
          continue
        }
        try {
          await unlink(candidatePath)
        } catch (error) {
          if (errorCode(error) !== 'ENOENT') throw error
        }
      }
    } finally {
      await directoryHandle.close().catch(() => undefined)
    }
    if (scheduleFollowUp && followUpDelayMs > 0) {
      this.scheduleFollowUpCleanup(followUpDelayMs)
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
    if (this.followUpCleanupError) {
      throw new Error(
        `Stint debrief archive is unavailable because private crash cleanup failed: ${errorMessage(this.followUpCleanupError)}`
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
      await this.settleLatest()
      const durableDuplicate = this.durable.records.find(
        (candidate) => candidate.id === record.id
      )
      if (!durableDuplicate) {
        throw new Error('Stint debrief archive duplicate is not durably published.')
      }
      return {
        inserted: false,
        summary: debriefArchiveSummary(durableDuplicate),
        count: this.durable.records.length
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
    await this.stopFollowUpCleanup()
    let durabilityError: unknown
    if (this.state !== 'corrupt') {
      await this.writeQueue
      const failure = this.latestFailure
      if (failure && failure.version >= this.acceptedVersion) {
        try {
          await this.writePersisted(this.filePath, failure.payload)
          this.durable = failure.archive
          this.desired = failure.archive
          this.durableVersion = failure.version
          this.latestFailure = null
          this.missingOnLoad = false
        } catch (error) {
          this.latestFailure = { ...failure, error }
          durabilityError = new Error(
            `Stint debrief archive durability failed during teardown: ${errorMessage(error)}`,
            { cause: error }
          )
        }
      }
    }
    try {
      await this.cleanupStaleTempFiles(false)
      this.followUpCleanupError = undefined
    } catch (error) {
      if (durabilityError) {
        throw new Error(
          `Stint debrief archive teardown failed durability and private crash cleanup: ${errorMessage(error)}`,
          { cause: durabilityError }
        )
      }
      throw error
    }
    if (durabilityError) {
      throw new Error(
        errorMessage(durabilityError),
        { cause: durabilityError }
      )
    }
  }
}
