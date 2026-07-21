import type { Dirent } from 'node:fs'
import { lstat, mkdir, open, readFile, readdir, rename, rm, unlink } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
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
export const DEBRIEF_ARCHIVE_TEMP_SCAN_BATCH_SIZE = 2_048
export const DEBRIEF_ARCHIVE_TEMP_DIRECTORY_SUFFIX = '.archive-tmp'
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
  yieldCleanup?(): Promise<void>
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

function isUnsupportedWindowsDirectorySync(
  error: unknown,
  platform: NodeJS.Platform
): boolean {
  // Node exposes unsupported Windows directory fsync as EPERM after the
  // directory handle has opened. Open failures and every other code are real.
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
  private readonly yieldCleanup: () => Promise<void>
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
    this.yieldCleanup = persistence.yieldCleanup ?? (() =>
      new Promise<void>((resolveYield) => setImmediate(resolveYield)))
    this.openDirectory = persistence.openDirectory ?? ((directory) =>
      open(directory, 'r'))
    this.platform = persistence.platform ?? process.platform
    this.writePersisted = persistence.write ?? ((targetPath, payload) =>
      this.atomicWrite(targetPath, payload))
    this.loadPromise = this.load(persistence.load)
  }

  private tempDirectoryPath(targetPath = this.filePath): string {
    const directory = resolve(dirname(targetPath))
    const tempDirectory = resolve(
      directory,
      `${basename(targetPath)}${DEBRIEF_ARCHIVE_TEMP_DIRECTORY_SUFFIX}`
    )
    if (dirname(tempDirectory) !== directory) {
      throw new Error('Stint debrief archive temp directory escaped its parent.')
    }
    return tempDirectory
  }

  private async ensureTempDirectory(targetPath: string): Promise<string> {
    const tempDirectory = this.tempDirectoryPath(targetPath)
    try {
      await mkdir(tempDirectory, { mode: 0o700 })
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error
    }
    const info = await lstat(tempDirectory)
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error('Stint debrief archive temp directory is not a safe directory.')
    }
    return tempDirectory
  }

  private async atomicWrite(targetPath: string, payload: string): Promise<void> {
    let tempPath: string | null = null
    let handle: Awaited<ReturnType<typeof open>> | null = null
    try {
      const directory = dirname(targetPath)
      await mkdir(directory, { recursive: true })
      const tempDirectory = await this.ensureTempDirectory(targetPath)
      tempPath = join(
        tempDirectory,
        `${process.pid}.${++this.writeSequence}.tmp`
      )
      handle = await open(tempPath, 'wx', 0o600)
      await handle.writeFile(payload, 'utf8')
      await handle.sync()
      await handle.close()
      handle = null
      await rename(tempPath, targetPath)
      await this.syncDirectory(tempDirectory)
      await this.syncDirectory(directory)
    } catch (error) {
      await handle?.close().catch(() => undefined)
      if (tempPath) await rm(tempPath, { force: true }).catch(() => undefined)
      throw error
    }
  }

  private async syncDirectory(directory: string): Promise<void> {
    const handle = await this.openDirectory(directory)
    try {
      await handle.sync()
    } catch (error) {
      if (!isUnsupportedWindowsDirectorySync(error, this.platform)) {
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

  private async inspectTempEntry(
    directory: string,
    entry: Dirent,
    writerTempPattern: RegExp
  ): Promise<number> {
    const match = writerTempPattern.exec(entry.name)
    if (!match || entry.isSymbolicLink()) return 0
    const ownerPid = Number(match[1])
    if (
      !Number.isSafeInteger(ownerPid) ||
      ownerPid < 1 ||
      ownerPid > MAX_PROCESS_ID
    ) return 0

    const candidatePath = resolve(directory, entry.name)
    if (
      dirname(candidatePath) !== directory ||
      basename(candidatePath) !== entry.name
    ) return 0

    let info: Awaited<ReturnType<typeof lstat>>
    try {
      info = await lstat(candidatePath)
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return 0
      throw error
    }
    if (info.isSymbolicLink() || !info.isFile()) return 0
    if (this.ownerIsAlive(ownerPid)) {
      const ageMs = Math.max(0, this.now() - info.mtimeMs)
      return Math.max(
        1,
        DEBRIEF_ARCHIVE_STALE_TEMP_MS -
          Math.min(DEBRIEF_ARCHIVE_STALE_TEMP_MS, ageMs)
      )
    }
    try {
      await unlink(candidatePath)
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error
    }
    return 0
  }

  private async scanTempDirectory(
    directory: string,
    writerTempPattern: RegExp,
    dedicated: boolean
  ): Promise<number> {
    if (dedicated) {
      let directoryInfo: Awaited<ReturnType<typeof lstat>>
      try {
        directoryInfo = await lstat(directory)
      } catch (error) {
        if (errorCode(error) === 'ENOENT') return 0
        throw error
      }
      if (directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory()) {
        throw new Error('Stint debrief archive temp directory is not a safe directory.')
      }
    }

    let entries: Dirent[]
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return 0
      throw error
    }

    let followUpDelayMs = 0
    let scannedInBatch = 0
    for (const entry of entries) {
      followUpDelayMs = Math.max(
        followUpDelayMs,
        await this.inspectTempEntry(directory, entry, writerTempPattern)
      )
      scannedInBatch += 1
      if (scannedInBatch >= DEBRIEF_ARCHIVE_TEMP_SCAN_BATCH_SIZE) {
        scannedInBatch = 0
        await this.yieldCleanup()
      }
    }
    return followUpDelayMs
  }

  private async cleanupStaleTempFiles(scheduleFollowUp = true): Promise<void> {
    const directory = resolve(dirname(this.filePath))
    const archiveName = basename(this.filePath)
    const dedicatedTempPattern =
      /^([1-9]\d{0,9})\.[1-9]\d{0,9}\.tmp$/
    const legacyTempPattern = new RegExp(
      `^${escapedRegExp(archiveName)}\\.([1-9]\\d{0,9})\\.[1-9]\\d{0,9}\\.tmp$`
    )
    const dedicatedDelay = await this.scanTempDirectory(
      this.tempDirectoryPath(),
      dedicatedTempPattern,
      true
    )
    const legacyDelay = await this.scanTempDirectory(
      directory,
      legacyTempPattern,
      false
    )
    const followUpDelayMs = Math.max(dedicatedDelay, legacyDelay)
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
