import { describe, expect, it } from 'vitest'
import type { ObsLocalCommand, ObsSceneAllowlistEntry } from '../../shared/obs-local'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import { OBS_LOCAL_REQUIRED_REQUESTS, type ObsLocalClock } from './contracts'
import { ObsLocalController } from './controller'
import { MockObsWebSocketAdapter } from './mock-adapter'

class FakeClock implements ObsLocalClock {
  private wallMs = 1_700_000_000_000
  private monotonicMs = 10_000

  wallNowMs(): number {
    return this.wallMs
  }

  monotonicNowMs(): number {
    return this.monotonicMs
  }

  advance(ms: number): void {
    this.wallMs += ms
    this.monotonicMs += ms
  }
}

function telemetrySnapshot(overrides: Partial<TelemetrySnapshot> = {}): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp: 123_456_789,
    speedKmh: 0,
    rpm: 4_500,
    gear: 4,
    throttle: 0.5,
    brake: 0,
    clutch: 0,
    sessionTimeSec: 120,
    sessionUniqueId: 42,
    replayPlaying: false,
    ...overrides
  } as TelemetrySnapshot
}

function visibilityCommand(
  clock: ObsLocalClock,
  requestId: string,
  overrides: Partial<ObsLocalCommand> = {}
): ObsLocalCommand {
  return {
    requestId,
    issuedAtMs: clock.wallNowMs(),
    sceneName: 'Race',
    operation: {
      kind: 'set-source-visibility',
      sourceName: 'Overlay',
      visible: false
    },
    ...overrides
  }
}

interface ControllerHarnessOptions {
  sceneAllowlist?: ObsSceneAllowlistEntry[]
  currentScene?: string
  telemetry?: TelemetrySnapshot | null
  handshakeRequests?: string[]
  healthStaleMs?: number
  rateLimitWindowMs?: number
  rateLimitMax?: number
  responses?: NonNullable<ConstructorParameters<typeof MockObsWebSocketAdapter>[0]>['responses']
}

async function createReadyHarness(options: ControllerHarnessOptions = {}): Promise<{
  adapter: MockObsWebSocketAdapter
  clock: FakeClock
  controller: ObsLocalController
}> {
  const clock = new FakeClock()
  const adapter = new MockObsWebSocketAdapter({
    handshake: {
      availableRequests: options.handshakeRequests ?? [...OBS_LOCAL_REQUIRED_REQUESTS]
    },
    responses: {
      GetStats: {},
      GetCurrentProgramScene: { currentProgramSceneName: options.currentScene ?? 'Race' },
      GetSceneItemId: { sceneItemId: 7 },
      GetSceneItemEnabled: { sceneItemEnabled: true },
      SetSceneItemEnabled: {},
      GetReplayBufferStatus: { outputActive: true },
      GetRecordStatus: { outputActive: true, outputTimecode: '00:10:00.500' },
      SaveReplayBuffer: {},
      ...options.responses
    }
  })
  const controller = new ObsLocalController({
    adapterFactory: () => adapter,
    getTelemetry: () => options.telemetry ?? telemetrySnapshot(),
    clock,
    autoHealth: false,
    healthStaleMs: options.healthStaleMs,
    rateLimitWindowMs: options.rateLimitWindowMs,
    rateLimitMax: options.rateLimitMax
  })
  await controller.connect({
    password: 'obs-secret',
    scenes: options.sceneAllowlist ?? [{ sceneName: 'Race', sourceNames: ['Overlay'] }]
  })
  return { adapter, clock, controller }
}

describe('ObsLocalController', () => {
  it('rejects wrong-scene visibility commands before mutating any OBS source', async () => {
    const { adapter, clock, controller } = await createReadyHarness({
      currentScene: 'Qualifying',
      sceneAllowlist: [{ sceneName: 'Race', sourceNames: ['Overlay'] }]
    })

    adapter.requests.length = 0
    const result = await controller.execute(visibilityCommand(clock, 'scenecheck-01'))

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      requestId: 'scenecheck-01',
      reason: 'wrong-scene',
      message: 'OBS is on "Qualifying", not the expected scene "Race".',
      reversible: false
    }))
    expect(adapter.requests.map((request) => request.requestType)).toEqual(['GetCurrentProgramScene'])
    expect(controller.status().metrics.wrongSceneRejects).toBe(1)
  })

  it('rechecks the program scene immediately before a source mutation', async () => {
    const { adapter, clock, controller } = await createReadyHarness()
    let sceneReads = 0
    adapter.setResponse('GetCurrentProgramScene', () => ({
      currentProgramSceneName: ++sceneReads === 1 ? 'Race' : 'Qualifying'
    }))
    adapter.requests.length = 0

    const result = await controller.execute(visibilityCommand(clock, 'scene-race-01'))

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      reason: 'wrong-scene',
      message: 'OBS is on "Qualifying", not the expected scene "Race".'
    }))
    expect(adapter.requests.map((request) => request.requestType)).toEqual([
      'GetCurrentProgramScene',
      'GetSceneItemId',
      'GetSceneItemEnabled',
      'GetCurrentProgramScene'
    ])
    expect(adapter.requests.some((request) => request.requestType === 'SetSceneItemEnabled')).toBe(false)
  })

  it('anchors replay saves to replay telemetry and rejects duplicate command ids', async () => {
    const { adapter, clock, controller } = await createReadyHarness({
      telemetry: telemetrySnapshot({
        replayPlaying: true,
        replayContext: {
          state: 'replay',
          active: true,
          sessionIdentity: 'iracing:session-007',
          inputs: {
            replaySessionTime: 95.25
          }
        } as TelemetrySnapshot['replayContext']
      })
    })
    const command: ObsLocalCommand = {
      requestId: 'replaycmd-01',
      issuedAtMs: clock.wallNowMs(),
      sceneName: 'Race',
      operation: {
        kind: 'save-replay-buffer',
        raceClockSec: 100.25
      }
    }

    adapter.requests.length = 0
    const first = await controller.execute(command)

    expect(first).toEqual(expect.objectContaining({
      ok: true,
      requestId: 'replaycmd-01',
      message: 'OBS Replay Buffer saved with a race-clock timeline mapping.',
      reversible: false,
      timeline: {
        raceClockSec: 100.25,
        telemetryTimestampMs: 123_456_789,
        observedAtMonotonicMs: 10_000,
        obsTimelineMs: 605_500,
        offsetMs: 505_250,
        source: 'recording-timecode',
        replayState: 'replay',
        sessionIdentity: 'iracing:session-007'
      }
    }))
    expect(adapter.requests.map((request) => request.requestType)).toEqual([
      'GetCurrentProgramScene',
      'GetReplayBufferStatus',
      'GetRecordStatus',
      'GetCurrentProgramScene',
      'SaveReplayBuffer'
    ])

    adapter.requests.length = 0
    clock.advance(1)
    const duplicate = await controller.execute(command)

    expect(duplicate).toEqual(expect.objectContaining({
      ok: false,
      requestId: 'replaycmd-01',
      reason: 'request-replayed',
      message: 'Duplicate OBS command rejected.',
      reversible: false
    }))
    expect(adapter.requests).toEqual([])
    expect(controller.status().metrics.replayRejects).toBe(1)
  })

  it('rejects commands once OBS health has gone stale without touching the adapter', async () => {
    const { adapter, clock, controller } = await createReadyHarness({
      healthStaleMs: 50
    })

    adapter.requests.length = 0
    clock.advance(51)
    const result = await controller.execute(visibilityCommand(clock, 'stalecheck-01'))

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      requestId: 'stalecheck-01',
      reason: 'stale-health',
      message: 'OBS health is stale; refresh health before controlling OBS.',
      reversible: false
    }))
    expect(adapter.requests).toEqual([])
    expect(controller.status().health).toBe('stale')
    expect(controller.status().metrics.staleHealthRejects).toBe(1)
  })

  it('lets the operator manual override pause all automated OBS actions', async () => {
    const { adapter, clock, controller } = await createReadyHarness()
    controller.setManualOverride(true)
    adapter.requests.length = 0

    const result = await controller.execute(visibilityCommand(clock, 'manual-stop-01'))

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      reason: 'manual-override',
      message: 'Automation is paused because the operator enabled manual override.'
    }))
    expect(adapter.requests).toEqual([])
  })

  it('surfaces capability mismatches and blocks commands before any transport request', async () => {
    const { adapter, clock, controller } = await createReadyHarness({
      handshakeRequests: OBS_LOCAL_REQUIRED_REQUESTS.filter((request) => request !== 'SaveReplayBuffer')
    })

    expect(controller.status()).toEqual(expect.objectContaining({
      state: 'capability-mismatch',
      missingCapabilities: ['SaveReplayBuffer'],
      lastError: 'OBS is missing required requests: SaveReplayBuffer.'
    }))

    adapter.requests.length = 0
    const result = await controller.execute(visibilityCommand(clock, 'capcheck-01'))

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      requestId: 'capcheck-01',
      reason: 'capability-mismatch',
      message: 'OBS capabilities do not match the local certification contract.',
      reversible: false
    }))
    expect(adapter.requests).toEqual([])
    expect(controller.status().metrics.capabilityRejects).toBe(2)
  })

  it('rate-limits burst commands before a third OBS mutation in the same window', async () => {
    const { adapter, clock, controller } = await createReadyHarness({
      rateLimitWindowMs: 1_000,
      rateLimitMax: 2
    })

    adapter.requests.length = 0
    const first = await controller.execute(visibilityCommand(clock, 'ratelimit-01'))
    clock.advance(10)
    const second = await controller.execute(visibilityCommand(clock, 'ratelimit-02'))
    clock.advance(10)
    const third = await controller.execute(visibilityCommand(clock, 'ratelimit-03'))

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(third).toEqual(expect.objectContaining({
      ok: false,
      requestId: 'ratelimit-03',
      reason: 'rate-limited',
      message: 'OBS command rate limit exceeded.',
      reversible: false
    }))
    expect(adapter.requests.map((request) => request.requestType)).toEqual([
      'GetCurrentProgramScene',
      'GetSceneItemId',
      'GetSceneItemEnabled',
      'GetCurrentProgramScene',
      'SetSceneItemEnabled',
      'GetCurrentProgramScene',
      'GetSceneItemId',
      'GetSceneItemEnabled',
      'GetCurrentProgramScene',
      'SetSceneItemEnabled'
    ])
    expect(controller.status().metrics.commandsRateLimited).toBe(1)
  })

  it('returns offline without queued effects when the OBS adapter drops before execution', async () => {
    const { adapter, clock, controller } = await createReadyHarness()

    adapter.requests.length = 0
    adapter.simulateOffline()
    const result = await controller.execute(visibilityCommand(clock, 'offline-01'))

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      requestId: 'offline-01',
      reason: 'offline',
      message: 'OBS is offline; the command was not queued.',
      reversible: false
    }))
    expect(adapter.requests).toEqual([])
    expect(controller.status().state).toBe('offline')
    expect(controller.status().metrics.offlineRejects).toBe(1)
  })
})
