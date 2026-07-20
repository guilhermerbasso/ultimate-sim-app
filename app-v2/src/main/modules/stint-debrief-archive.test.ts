import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEBRIEF_ARCHIVE_MAX_BYTES,
  DEBRIEF_ARCHIVE_MAX_RECORDS,
  DEBRIEF_ARCHIVE_RECORD_SCHEMA,
  DEBRIEF_ARCHIVE_VERSION,
  normalizeDebriefArchiveRecord,
  type DebriefArchiveRecord
} from '../../shared/stint-debrief'
import { StintDebriefArchiveStore } from './stint-debrief-archive'

const scratchDirs: string[] = []

function scratch(name: string): string {
  const directory = join(
    process.cwd(),
    `.stint-debrief-archive-${name}-${process.pid}-${Date.now()}-${scratchDirs.length}`
  )
  mkdirSync(directory, { recursive: true })
  scratchDirs.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of scratchDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function record(
  capturedAt: number,
  overrides: Partial<DebriefArchiveRecord> = {}
): DebriefArchiveRecord {
  const reason = overrides.reason ?? 'session-end'
  const sessionInfo = {
    trackName: `Track ${capturedAt}`,
    carName: 'GT3 R',
    sessionType: 'Race',
    lapsCompleted: 10,
    reason
  }
  const candidate = normalizeDebriefArchiveRecord({
    schema: DEBRIEF_ARCHIVE_RECORD_SCHEMA,
    version: DEBRIEF_ARCHIVE_VERSION,
    id: `debrief_${String(capturedAt).padStart(16, '0')}`,
    capturedAt,
    reason,
    sessionInfo,
    findings: [],
    predictions: null,
    setup: null,
    debrief: {
      generatedAt: capturedAt,
      text: `Debrief ${capturedAt}.`,
      bullets: [],
      source: 'deterministic',
      language: 'en-US',
      reason,
      sessionInfo
    },
    language: 'en-US',
    unitSystem: 'metric',
    appLanguage: 'en',
    locale: 'en-US',
    captureSource: 'boundary',
    metadataQuality: 'captured',
    ...overrides
  })
  if (!candidate) throw new Error('Test record is invalid')
  return candidate
}

describe('StintDebriefArchiveStore', () => {
  it('migrates once, writes atomically, and reloads the same immutable record', async () => {
    const root = scratch('migration-restart')
    const file = join(root, 'stint-debrief-archive.json')
    const legacy = record(1_000, {
      id: 'debrief_legacy_1234567890abcdef',
      captureSource: 'legacy-last-debrief',
      metadataQuality: 'legacy-defaults'
    })
    const first = new StintDebriefArchiveStore(file)
    expect(await first.wasMissingOnLoad()).toBe(true)
    await expect(first.migrate(legacy)).resolves.toMatchObject({ inserted: true, count: 1 })
    await expect(first.migrate(record(2_000))).resolves.toBeNull()
    first.quiesce()
    await first.dispose()

    expect(readdirSync(root).filter((name) => name.endsWith('.tmp'))).toEqual([])
    const second = new StintDebriefArchiveStore(file)
    await expect(second.list()).resolves.toEqual([
      expect.objectContaining({ id: legacy.id, captureSource: 'legacy-last-debrief' })
    ])
    await expect(second.get(legacy.id)).resolves.toEqual(legacy)
    second.quiesce()
    await second.dispose()
  })

  it('keeps newest-first ordering, the count bound, and immutable ID dedupe', async () => {
    const root = scratch('bounds')
    const store = new StintDebriefArchiveStore(join(root, 'archive.json'))
    for (let index = 1; index <= DEBRIEF_ARCHIVE_MAX_RECORDS + 3; index += 1) {
      await store.append(record(index))
    }
    const duplicate = record(DEBRIEF_ARCHIVE_MAX_RECORDS + 3)
    await expect(store.append(duplicate)).resolves.toMatchObject({ inserted: false })
    await expect(store.append({
      ...duplicate,
      debrief: { ...duplicate.debrief, text: 'Conflicting replacement.' }
    })).rejects.toThrow('conflicting immutable session ID')

    const summaries = await store.list()
    expect(summaries).toHaveLength(DEBRIEF_ARCHIVE_MAX_RECORDS)
    expect(summaries[0].capturedAt).toBe(DEBRIEF_ARCHIVE_MAX_RECORDS + 3)
    expect(summaries.at(-1)?.capturedAt).toBe(4)
    store.quiesce()
    await store.dispose()
  })

  it('fails closed on corrupt storage without overwriting it', async () => {
    const root = scratch('corrupt')
    const file = join(root, 'archive.json')
    writeFileSync(file, '{"schema":"broken"', 'utf8')
    const before = readFileSync(file, 'utf8')
    const store = new StintDebriefArchiveStore(file)
    await store.ready()
    await expect(store.list()).rejects.toThrow('stored data is invalid')
    await expect(store.append(record(1))).rejects.toThrow('stored data is invalid')
    store.quiesce()
    await store.dispose()
    expect(readFileSync(file, 'utf8')).toBe(before)
  })

  it('fails closed before parsing an archive above the byte cap', async () => {
    const root = scratch('oversized')
    const file = join(root, 'archive.json')
    writeFileSync(file, ' '.repeat(DEBRIEF_ARCHIVE_MAX_BYTES + 1), 'utf8')
    const store = new StintDebriefArchiveStore(file)
    await expect(store.list()).rejects.toThrow('exceeds its local storage size cap')
    store.quiesce()
    await store.dispose()
    expect(readFileSync(file, 'utf8')).toHaveLength(DEBRIEF_ARCHIVE_MAX_BYTES + 1)
  })

  it('serializes concurrent writes and carries every accepted record forward', async () => {
    const root = scratch('serialized')
    const file = join(root, 'archive.json')
    let active = 0
    let maxActive = 0
    const payloads: string[] = []
    const store = new StintDebriefArchiveStore(file, {
      write: async (targetPath, payload) => {
        active += 1
        maxActive = Math.max(maxActive, active)
        await new Promise<void>((resolve) => setTimeout(resolve, 5))
        payloads.push(payload)
        await writeFile(targetPath, payload, 'utf8')
        active -= 1
      }
    })

    await Promise.all([store.append(record(10)), store.append(record(20))])
    expect(maxActive).toBe(1)
    expect(payloads).toHaveLength(2)
    expect(JSON.parse(payloads[1]).records).toHaveLength(2)
    await expect(store.list()).resolves.toEqual([
      expect.objectContaining({ capturedAt: 20 }),
      expect.objectContaining({ capturedAt: 10 })
    ])
    store.quiesce()
    await store.dispose()
  })

  it('retries the latest failed snapshot during teardown and survives restart', async () => {
    const root = scratch('teardown-retry')
    const file = join(root, 'archive.json')
    let attempts = 0
    const store = new StintDebriefArchiveStore(file, {
      write: async (targetPath, payload) => {
        attempts += 1
        if (attempts === 1) throw new Error('transient archive write failure')
        await writeFile(targetPath, payload, 'utf8')
      }
    })
    await expect(store.append(record(42))).rejects.toThrow('transient archive write failure')
    store.quiesce()
    await expect(store.dispose()).resolves.toBeUndefined()
    expect(attempts).toBe(2)

    const restarted = new StintDebriefArchiveStore(file)
    await expect(restarted.list()).resolves.toEqual([
      expect.objectContaining({ capturedAt: 42 })
    ])
    restarted.quiesce()
    await restarted.dispose()
  })

  it('rejects invalid and missing opaque IDs clearly', async () => {
    const root = scratch('missing')
    const store = new StintDebriefArchiveStore(join(root, 'archive.json'))
    await expect(store.get('..\\recordings\\raw.json')).rejects.toThrow('ID is invalid')
    await expect(store.get('debrief_1234567890abcdef')).rejects.toThrow(
      'not found or was deleted'
    )
    store.quiesce()
    await store.dispose()
  })
})
