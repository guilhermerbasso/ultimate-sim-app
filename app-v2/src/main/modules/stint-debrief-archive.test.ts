import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEBRIEF_ARCHIVE_MAX_BYTES,
  DEBRIEF_ARCHIVE_MAX_RECORDS,
  DEBRIEF_ARCHIVE_RECORD_SCHEMA,
  DEBRIEF_ARCHIVE_SCHEMA,
  DEBRIEF_ARCHIVE_VERSION,
  normalizeDebriefArchiveRecord,
  type DebriefArchiveRecord
} from '../../shared/stint-debrief'
import {
  DEBRIEF_ARCHIVE_STALE_TEMP_MS,
  StintDebriefArchiveStore
} from './stint-debrief-archive'

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

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`simulated ${code}`), { code })
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

  it('cleans only stale files matching this archive writer exact temp grammar', async () => {
    const root = scratch('stale-temp-name-age')
    const file = join(root, 'archive[history].json')
    const stale = `${file}.1900000001.7.tmp`
    const fresh = `${file}.1900000002.8.tmp`
    const unrelated = join(root, 'unrelated.12345.7.tmp')
    const lookalike = join(root, 'archivehistory.json.12345.7.tmp')
    for (const path of [stale, fresh, unrelated, lookalike]) {
      writeFileSync(path, 'private history', 'utf8')
    }
    const old = new Date(Date.now() - DEBRIEF_ARCHIVE_STALE_TEMP_MS - 1_000)
    for (const path of [stale, unrelated, lookalike]) utimesSync(path, old, old)

    const scheduled: Array<() => Promise<void>> = []
    const store = new StintDebriefArchiveStore(file, {
      isProcessAlive: (pid) => pid === 1_900_000_002,
      scheduleCleanup: (callback) => {
        scheduled.push(callback)
        return scheduled.length
      },
      cancelCleanup: () => undefined
    })
    await store.ready()

    expect(existsSync(stale)).toBe(false)
    expect(existsSync(fresh)).toBe(true)
    expect(existsSync(unrelated)).toBe(true)
    expect(existsSync(lookalike)).toBe(true)
    expect(scheduled).toHaveLength(1)
    store.quiesce()
    await store.dispose()
    expect(existsSync(fresh)).toBe(true)
  })

  it('removes a fresh dead-owner crash-before-rename snapshot without exposing it', async () => {
    const root = scratch('crash-before-rename')
    const file = join(root, 'archive.json')
    const primary = new StintDebriefArchiveStore(file)
    await primary.append(record(1))
    primary.quiesce()
    await primary.dispose()

    const crashTemp = `${file}.1900000003.3.tmp`
    writeFileSync(crashTemp, `${JSON.stringify({
      schema: DEBRIEF_ARCHIVE_SCHEMA,
      version: DEBRIEF_ARCHIVE_VERSION,
      records: [record(2)]
    })}\n`, 'utf8')

    const restarted = new StintDebriefArchiveStore(file, {
      isProcessAlive: () => false
    })
    await expect(restarted.list()).resolves.toEqual([
      expect.objectContaining({ capturedAt: 1 })
    ])
    expect(existsSync(crashTemp)).toBe(false)
    restarted.quiesce()
    await restarted.dispose()
  })

  it('removes a bounded batch of fresh dead-owner snapshots so crashes do not accumulate', async () => {
    const root = scratch('dead-temp-batch')
    const file = join(root, 'archive.json')
    const stalePaths = Array.from({ length: 70 }, (_, index) =>
      `${file}.${1_800_000_000 + index}.${index + 1}.tmp`)
    for (const stalePath of stalePaths) {
      writeFileSync(stalePath, `private history ${stalePath}`, 'utf8')
    }

    const store = new StintDebriefArchiveStore(file, {
      isProcessAlive: () => false
    })
    await store.ready()

    expect(stalePaths.filter(existsSync)).toEqual([])
    store.quiesce()
    await store.dispose()
  })

  it('schedules one bounded grace cleanup and removes an owner that dies later', async () => {
    const root = scratch('fresh-live-then-dead')
    const file = join(root, 'archive.json')
    const temp = `${file}.1900000004.1.tmp`
    writeFileSync(temp, 'private history', 'utf8')
    let alive = true
    const scheduled: Array<{
      callback: () => Promise<void>
      delayMs: number
    }> = []
    const store = new StintDebriefArchiveStore(file, {
      isProcessAlive: () => alive,
      scheduleCleanup: (callback, delayMs) => {
        scheduled.push({ callback, delayMs })
        return scheduled.length
      },
      cancelCleanup: () => undefined
    })

    await store.ready()
    expect(existsSync(temp)).toBe(true)
    expect(scheduled).toHaveLength(1)
    expect(scheduled[0].delayMs).toBeGreaterThan(0)
    expect(scheduled[0].delayMs).toBeLessThanOrEqual(DEBRIEF_ARCHIVE_STALE_TEMP_MS)

    alive = false
    await scheduled[0].callback()
    expect(existsSync(temp)).toBe(false)
    expect(scheduled).toHaveLength(1)
    store.quiesce()
    await store.dispose()
  })

  it('runs cleanup again during teardown when a live owner dies before grace', async () => {
    const root = scratch('teardown-dead-owner')
    const file = join(root, 'archive.json')
    const temp = `${file}.1900000005.1.tmp`
    writeFileSync(temp, 'private history', 'utf8')
    let alive = true
    let scheduled = 0
    let cancelled = 0
    const store = new StintDebriefArchiveStore(file, {
      isProcessAlive: () => alive,
      scheduleCleanup: () => {
        scheduled += 1
        return scheduled
      },
      cancelCleanup: () => {
        cancelled += 1
      }
    })

    await store.ready()
    expect(existsSync(temp)).toBe(true)
    expect(scheduled).toBe(1)
    alive = false
    store.quiesce()
    await store.dispose()

    expect(cancelled).toBe(1)
    expect(existsSync(temp)).toBe(false)
  })

  it('keeps cleanup path-confined and never follows matching symlinks or junctions', async () => {
    const root = scratch('stale-temp-path-safety')
    const archiveDir = join(root, 'archive')
    const outsideDir = join(root, 'outside')
    mkdirSync(archiveDir)
    mkdirSync(outsideDir)
    const file = join(archiveDir, 'archive.json')
    const outsideMarker = join(outsideDir, 'private.json')
    writeFileSync(outsideMarker, 'do not delete', 'utf8')
    const outsideMatchingName = join(root, 'archive.json.111.2.tmp')
    writeFileSync(outsideMatchingName, 'outside archive directory', 'utf8')
    const old = new Date(Date.now() - DEBRIEF_ARCHIVE_STALE_TEMP_MS - 1_000)
    utimesSync(outsideMatchingName, old, old)

    const linkedTemp = `${file}.111.2.tmp`
    let linkCreated = false
    try {
      symlinkSync(outsideDir, linkedTemp, 'junction')
      linkCreated = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error
    }

    const store = new StintDebriefArchiveStore(file)
    await store.ready()

    expect(existsSync(outsideMatchingName)).toBe(true)
    expect(readFileSync(outsideMarker, 'utf8')).toBe('do not delete')
    if (linkCreated) expect(existsSync(linkedTemp)).toBe(true)
    store.quiesce()
    await store.dispose()
  })

  it.each(['open', 'sync'] as const)(
    'treats only the Windows EPERM directory-%s limitation as unsupported',
    async (stage) => {
      const root = scratch(`directory-eperm-${stage}`)
      const file = join(root, 'archive.json')
      const store = new StintDebriefArchiveStore(file, {
        platform: 'win32',
        openDirectory: async () => {
          if (stage === 'open') throw errno('EPERM')
          return {
            sync: async () => {
              throw errno('EPERM')
            },
            close: async () => undefined
          }
        }
      })

      await expect(store.append(record(7))).resolves.toMatchObject({
        inserted: true,
        count: 1
      })
      await expect(store.list()).resolves.toEqual([
        expect.objectContaining({ capturedAt: 7 })
      ])
      store.quiesce()
      await store.dispose()
    }
  )

  it('propagates EPERM when it is not the Windows directory limitation', async () => {
    const root = scratch('directory-sync-eperm-non-windows')
    const store = new StintDebriefArchiveStore(join(root, 'archive.json'), {
      platform: 'linux',
      openDirectory: async () => {
        throw errno('EPERM')
      }
    })

    await expect(store.append(record(7))).rejects.toMatchObject({ code: 'EPERM' })
    store.quiesce()
    await expect(store.dispose()).rejects.toThrow('durability failed during teardown')
  })

  it.each([
    ['EIO', 'open'],
    ['ENOSPC', 'sync']
  ] as const)(
    'propagates real directory %s failures and withholds failed append visibility',
    async (code, stage) => {
      const root = scratch(`directory-sync-${code.toLowerCase()}`)
      const file = join(root, 'archive.json')
      let failing = true
      const store = new StintDebriefArchiveStore(file, {
        platform: 'win32',
        openDirectory: async () => {
          if (failing && stage === 'open') throw errno(code)
          return {
            sync: async () => {
              if (failing && stage === 'sync') throw errno(code)
            },
            close: async () => undefined
          }
        }
      })

      await expect(store.append(record(8))).rejects.toMatchObject({ code })
      await expect(store.list()).rejects.toMatchObject({ code })
      await expect(store.append(record(8))).rejects.toMatchObject({ code })

      failing = false
      store.quiesce()
      await expect(store.dispose()).resolves.toBeUndefined()
      const restarted = new StintDebriefArchiveStore(file)
      await expect(restarted.list()).resolves.toEqual([
        expect.objectContaining({ capturedAt: 8 })
      ])
      restarted.quiesce()
      await restarted.dispose()
    }
  )

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
