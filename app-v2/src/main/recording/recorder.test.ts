import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import { TelemetryRecorder } from './recorder'

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

describe('TelemetryRecorder stop durability', () => {
  it('clears failed metadata state and starts a clean replacement recording', async () => {
    const root = scratch('metadata-failure')
    const recorder = new TelemetryRecorder(root)
    const started = await recorder.start({ sampleRateHz: 15 })
    const failedSessionId = started.activeSession?.id
    expect(failedSessionId).toBeTruthy()

    replaceFileWithDirectory(
      join(root, 'recordings', failedSessionId as string, 'session.json')
    )

    await expect(recorder.stop()).rejects.toThrow('Recording metadata persistence failed')
    expect(recorder.status()).toEqual({ recording: false, activeSession: null })

    const restarted = await recorder.start({ sampleRateHz: 30 })
    expect(restarted).toMatchObject({
      recording: true,
      activeSession: {
        sampleRateHz: 30,
        sampleCount: 0,
        lapCount: 0,
        laps: []
      }
    })
    const replacementSessionId = restarted.activeSession?.id
    expect(replacementSessionId).toBeTruthy()
    expect(replacementSessionId).not.toBe(failedSessionId)

    recorder.onSnapshot(snapshot('replacement', 'Track B', 2_000))
    await expect(recorder.stop()).resolves.toEqual({ recording: false, activeSession: null })

    expect(JSON.parse(readFileSync(
      join(root, 'recordings', replacementSessionId as string, 'session.json'),
      'utf8'
    ))).toMatchObject({
      id: replacementSessionId,
      source: 'iracing',
      sampleCount: 1,
      lapCount: 1,
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
    expect(recorder.status()).toEqual({ recording: false, activeSession: null })
  })
})
