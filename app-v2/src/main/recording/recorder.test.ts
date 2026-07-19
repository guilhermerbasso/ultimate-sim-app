import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import {
  TelemetryRecorder,
  type TelemetryRecorderPersistence
} from './recorder'

const scratchDirs: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function scratch(name: string): string {
  const dir = join(process.cwd(), `.recorder-${name}-${process.pid}-${Date.now()}-${scratchDirs.length}`)
  mkdirSync(dir, { recursive: true })
  scratchDirs.push(dir)
  return dir
}

function snapshot(sessionIdentity: string, trackName: string, timestamp: number): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp,
    speedKmh: 180,
    rpm: 7_000,
    gear: 4,
    throttle: 0.8,
    brake: 0,
    clutch: 0,
    currentLap: 1,
    lapDistPct: 0.2,
    sessionType: 'Race',
    trackName,
    trackConfigName: 'Grand Prix',
    carName: 'GT3 R',
    replayContext: {
      state: 'live',
      reason: 'confirmed-live',
      inputs: {},
      active: false,
      revision: 0,
      token: `token-${sessionIdentity}`,
      sessionIdentity,
      connectionEpoch: 1
    }
  }
}

function replaceFileWithDirectory(path: string): void {
  rmSync(path, { force: true })
  mkdirSync(path)
}

function persistenceWithRename(
  renameFile: TelemetryRecorderPersistence['rename']
): TelemetryRecorderPersistence {
  return {
    mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
    writeFile: (path, payload) => writeFile(path, payload, 'utf8'),
    rename: renameFile,
    remove: (path) => rm(path, { force: true })
  }
}

describe('TelemetryRecorder stop durability', () => {
  it('retains final metadata after a transient failure and retries without duplicate samples', async () => {
    const root = scratch('metadata-failure')
    let failNextRename = false
    const recorder = new TelemetryRecorder(
      root,
      undefined,
      persistenceWithRename(async (from, to) => {
        if (failNextRename) {
          failNextRename = false
          throw new Error('transient rename failure')
        }
        await rename(from, to)
      })
    )
    const started = await recorder.start({ sampleRateHz: 15 })
    const failedSessionId = started.activeSession?.id
    expect(failedSessionId).toBeTruthy()

    recorder.onSnapshot(snapshot('recording', 'Track A', 1_000))
    const metadataPath = join(root, 'recordings', failedSessionId as string, 'session.json')
    await vi.waitFor(() => {
      expect(JSON.parse(readFileSync(metadataPath, 'utf8'))).toMatchObject({
        sampleCount: 0,
        lapCount: 1
      })
    })
    failNextRename = true
    await expect(recorder.stop()).rejects.toThrow('Recording metadata persistence failed')
    expect(recorder.status()).toMatchObject({
      recording: true,
      activeSession: { id: failedSessionId, sampleCount: 1, endedAt: expect.any(Number) }
    })

    await expect(new TelemetryRecorder(root).listSessions()).resolves.toEqual([
      expect.objectContaining({ id: failedSessionId, lapCount: 1 })
    ])
    const samplesPath = join(root, 'recordings', failedSessionId as string, 'samples.jsonl')
    expect(readFileSync(samplesPath, 'utf8').trim().split('\n')).toHaveLength(1)

    await expect(recorder.stop()).resolves.toEqual({ recording: false, activeSession: null })
    expect(JSON.parse(readFileSync(metadataPath, 'utf8'))).toMatchObject({
      id: failedSessionId,
      source: 'iracing',
      sampleCount: 1,
      lapCount: 1,
      endedAt: expect.any(Number)
    })
    expect(readFileSync(samplesPath, 'utf8').trim().split('\n')).toHaveLength(1)
  })

  it('clears a transient lap-metadata failure after the final metadata write succeeds', async () => {
    const root = scratch('intermediate-metadata-retry')
    let failNextRename = false
    const recorder = new TelemetryRecorder(
      root,
      undefined,
      persistenceWithRename(async (from, to) => {
        if (failNextRename) {
          failNextRename = false
          throw new Error('transient lap metadata failure')
        }
        await rename(from, to)
      })
    )
    const started = await recorder.start({ sampleRateHz: 15 })
    const sessionId = started.activeSession?.id
    expect(sessionId).toBeTruthy()
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    failNextRename = true
    recorder.onSnapshot(snapshot('recording', 'Track A', 1_000))
    await vi.waitFor(() => {
      expect(warning).toHaveBeenCalledWith(
        '[recording] metadata persist failed:',
        expect.any(String)
      )
    })

    await expect(recorder.stop()).resolves.toEqual({ recording: false, activeSession: null })
    expect(JSON.parse(readFileSync(
      join(root, 'recordings', sessionId as string, 'session.json'),
      'utf8'
    ))).toMatchObject({
      id: sessionId,
      sampleCount: 1,
      endedAt: expect.any(Number)
    })
  })

  it('aggregates queued sample and final metadata durability failures', async () => {
    const root = scratch('combined-failure')
    const recorder = new TelemetryRecorder(root)
    const started = await recorder.start()
    const sessionId = started.activeSession?.id
    expect(sessionId).toBeTruthy()

    mkdirSync(join(root, 'recordings', sessionId as string, 'samples.jsonl'))
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    recorder.onSnapshot(snapshot('combined', 'Track A', 1_000))

    await vi.waitFor(() => {
      expect(warning).toHaveBeenCalledWith(
        '[recording] sample append failed:',
        expect.any(String)
      )
      expect(JSON.parse(readFileSync(
        join(root, 'recordings', sessionId as string, 'session.json'),
        'utf8'
      ))).toMatchObject({ lapCount: 1 })
    })

    replaceFileWithDirectory(join(root, 'recordings', sessionId as string, 'session.json'))

    let failure: unknown
    try {
      await recorder.stop()
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(AggregateError)
    const errors = (failure as AggregateError).errors
    expect(errors).toHaveLength(2)
    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: expect.stringContaining('Recording I/O failed') }),
      expect.objectContaining({
        message: expect.stringContaining('Recording metadata persistence failed')
      })
    ]))
    expect(recorder.status()).toMatchObject({
      recording: true,
      activeSession: { id: sessionId, endedAt: expect.any(Number) }
    })

    rmSync(join(root, 'recordings', sessionId as string, 'session.json'), {
      recursive: true,
      force: true
    })
    await expect(recorder.stop()).rejects.toThrow('Recording I/O failed')
    expect(recorder.status()).toEqual({ recording: false, activeSession: null })
  })

  it('caps persistent sample-write failures and reports the dropped sample count', async () => {
    const root = scratch('sample-failure-cap')
    const recorder = new TelemetryRecorder(root)
    const started = await recorder.start({ sampleRateHz: 15 })
    const sessionId = started.activeSession?.id
    expect(sessionId).toBeTruthy()

    mkdirSync(join(root, 'recordings', sessionId as string, 'samples.jsonl'))
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    recorder.onSnapshot(snapshot('failed-writes', 'Track A', 1_000))
    await vi.waitFor(() => expect(warning).toHaveBeenCalledTimes(1))

    for (let index = 1; index <= 100; index += 1) {
      recorder.onSnapshot(snapshot('failed-writes', 'Track A', 1_000 + index * 100))
    }

    let failure: unknown
    try {
      await recorder.stop()
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(AggregateError)
    expect((failure as AggregateError).errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: expect.stringContaining('Recording I/O failed') }),
      expect.objectContaining({ message: expect.stringContaining('100 subsequent samples') })
    ]))
    expect(warning).toHaveBeenCalledTimes(1)
    expect(recorder.status()).toEqual({ recording: false, activeSession: null })
  })
})
