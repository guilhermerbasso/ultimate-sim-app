import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  STREAM_PRESENTATION_CONFLICT,
  STREAM_PRESENTATION_STORE_VERSION,
  cloneStreamPresentationProfile,
  normalizeStreamPresentationProfile,
  normalizeStreamPresentationStore,
  type StreamPresentationProfile,
  type StreamPresentationStorePayload
} from '../../shared/stream-presentation'

export interface StreamPresentationProfileStoreOptions {
  now?: () => number
  writeAtomic?: (path: string, payload: StreamPresentationStorePayload) => Promise<void>
}

export class StreamPresentationProfileConflictError extends Error {
  readonly code = STREAM_PRESENTATION_CONFLICT

  constructor(id: string, expected: number | null, actual: number | null) {
    super(`${STREAM_PRESENTATION_CONFLICT}: profile ${id} expected revision ${String(expected)}, current revision is ${String(actual)}`)
    this.name = 'StreamPresentationProfileConflictError'
  }
}

export class StreamPresentationProfileStore {
  private payload: StreamPresentationStorePayload = {
    version: STREAM_PRESENTATION_STORE_VERSION,
    profiles: []
  }
  private loaded = false
  private loadPromise: Promise<void> | null = null
  private operationTail: Promise<void> = Promise.resolve()
  private readonly now: () => number
  private readonly writeAtomic: (path: string, payload: StreamPresentationStorePayload) => Promise<void>

  constructor(
    private readonly storePath: string,
    options: StreamPresentationProfileStoreOptions = {}
  ) {
    this.now = options.now ?? Date.now
    this.writeAtomic = options.writeAtomic ?? writeStreamPresentationStoreAtomic
  }

  async load(): Promise<StreamPresentationProfile[]> {
    return this.runSerialized(async () => {
      await this.ensureLoaded()
      return this.list()
    })
  }

  list(): StreamPresentationProfile[] {
    return this.payload.profiles.map(cloneStreamPresentationProfile)
  }

  get(id: string): StreamPresentationProfile | null {
    const profile = this.payload.profiles.find((candidate) => candidate.id === id)
    return profile ? cloneStreamPresentationProfile(profile) : null
  }

  async save(
    input: StreamPresentationProfile,
    expectedRevision: number | null
  ): Promise<StreamPresentationProfile> {
    return this.runSerialized(async () => {
      await this.ensureLoaded()
      const normalized = normalizeStreamPresentationProfile(input, this.now())
      if (!normalized) throw new Error('Invalid stream presentation profile.')
      const existing = this.payload.profiles.find((candidate) => candidate.id === normalized.id) ?? null
      const actualRevision = existing?.revision ?? null
      if (expectedRevision !== actualRevision) {
        throw new StreamPresentationProfileConflictError(normalized.id, expectedRevision, actualRevision)
      }
      if (existing && existing.revision >= Number.MAX_SAFE_INTEGER) {
        throw new Error(`Stream presentation profile ${normalized.id} cannot advance beyond revision ${existing.revision}.`)
      }
      const timestamp = Math.max(this.now(), existing?.updatedAt ? existing.updatedAt + 1 : normalized.updatedAt)
      const saved: StreamPresentationProfile = {
        ...normalized,
        revision: (existing?.revision ?? 0) + 1,
        createdAt: existing?.createdAt ?? normalized.createdAt,
        updatedAt: timestamp
      }
      const profiles = [
        ...this.payload.profiles.filter((candidate) => candidate.id !== saved.id),
        saved
      ].sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name))
      const next: StreamPresentationStorePayload = {
        version: STREAM_PRESENTATION_STORE_VERSION,
        profiles
      }
      await this.writeAtomic(this.storePath, next)
      this.payload = next
      return cloneStreamPresentationProfile(saved)
    })
  }

  async delete(id: string, expectedRevision: number): Promise<StreamPresentationProfile[]> {
    return this.runSerialized(async () => {
      await this.ensureLoaded()
      const existing = this.payload.profiles.find((candidate) => candidate.id === id) ?? null
      if (!existing || existing.revision !== expectedRevision) {
        throw new StreamPresentationProfileConflictError(id, expectedRevision, existing?.revision ?? null)
      }
      const next: StreamPresentationStorePayload = {
        version: STREAM_PRESENTATION_STORE_VERSION,
        profiles: this.payload.profiles.filter((candidate) => candidate.id !== id)
      }
      await this.writeAtomic(this.storePath, next)
      this.payload = next
      return this.list()
    })
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    if (!this.loadPromise) {
      this.loadPromise = this.loadFromDisk()
    }
    await this.loadPromise
  }

  private async loadFromDisk(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.storePath, 'utf8')) as unknown
      if (
        !raw ||
        typeof raw !== 'object' ||
        Array.isArray(raw) ||
        !Array.isArray((raw as { profiles?: unknown }).profiles)
      ) {
        throw new Error('Stream presentation profile store is malformed.')
      }
      this.payload = normalizeStreamPresentationStore(raw)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.loadPromise = null
        throw error
      }
      this.payload = {
        version: STREAM_PRESENTATION_STORE_VERSION,
        profiles: []
      }
    }
    this.loaded = true
    this.loadPromise = null
  }

  private runSerialized<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.operationTail.then(operation)
    this.operationTail = run.then(() => undefined, () => undefined)
    return run
  }
}

export async function writeStreamPresentationStoreAtomic(
  path: string,
  payload: StreamPresentationStorePayload
): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    try {
      await rename(temporary, path)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EPERM' && code !== 'EEXIST') throw error
      await rm(path, { force: true })
      await rename(temporary, path)
    }
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}
