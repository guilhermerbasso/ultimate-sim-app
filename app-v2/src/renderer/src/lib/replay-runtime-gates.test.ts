import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const reactEffects = vi.hoisted(() => ({ cleanups: [] as Array<() => void> }))
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useEffect: (effect: () => void | (() => void)): void => {
      const cleanup = effect()
      if (typeof cleanup === 'function') reactEffects.cleanups.push(cleanup)
    }
  }
})

import {
  DEFAULT_SPOTTER_CONFIG,
  SPOTTER_CHANNELS,
  TTS_CHANNELS,
  type SpotterConfig
} from '../../../shared/spotter'
import type { TelemetrySnapshot } from '../../../shared/telemetry'
import {
  REPLAY_SPEECH_CANCEL_CHANNELS,
  type ReplayContext,
  type ReplayContextState,
  type ReplaySpeechCancelEvent
} from '../../../shared/replay'
import {
  processSpotterSnapshot,
  spotterSpeechState,
  stopSpotterPlayback,
  testSpotterVoice,
  useSpotterRuntime
} from './spotter-runtime'
import {
  getSpotter3DEngine,
  getSpotter3DStatus,
  stopSpotter3DPlayback,
  useSpotter3DRuntime
} from './spotter3d-runtime'
import {
  DEFAULT_SPOTTER_3D_CONFIG,
  SPOTTER_3D_CHANNELS,
  type Spotter3DConfig
} from './spotter-3d'
import {
  cancelSpeechOwner,
  registerSpeechOwnerCanceller,
  resetSpeechOwnerRuntimeForTests
} from './speech-owner-runtime'
import { isTtsSpeaking, setTtsPref, speakViaTts, stopTtsOwner, useTtsRuntime } from './tts-runtime'

class FakeParam {
  value = 1
  cancelScheduledValues = vi.fn()
  setValueAtTime = vi.fn((value: number) => { this.value = value })
  linearRampToValueAtTime = vi.fn((value: number) => { this.value = value })
  exponentialRampToValueAtTime = vi.fn((value: number) => { this.value = value })
  setTargetAtTime = vi.fn((value: number) => { this.value = value })
}

class FakeNode {
  connect = vi.fn()
  disconnect = vi.fn()
}

class FakeOscillator extends FakeNode {
  type: OscillatorType = 'sine'
  frequency = new FakeParam()
  playbackRate = new FakeParam()
  onended: (() => void) | null = null
  start = vi.fn()
  stop = vi.fn()
  addEventListener = vi.fn()
}

class FakeGain extends FakeNode {
  gain = new FakeParam()
}

class FakePanner extends FakeNode {
  positionX = new FakeParam()
  positionY = new FakeParam()
  positionZ = new FakeParam()
  setPosition = vi.fn()
}

class FakeBufferSource extends FakeOscillator {
  buffer: AudioBuffer | null = null
}

class FakeAudioContext {
  state: AudioContextState = 'running'
  currentTime = 1
  destination = new FakeNode()
  oscillators: FakeOscillator[] = []
  gains: FakeGain[] = []
  panners: FakePanner[] = []
  sources: FakeBufferSource[] = []
  resume = vi.fn(async () => undefined)
  close = vi.fn(async () => undefined)
  createOscillator = vi.fn(() => {
    const oscillator = new FakeOscillator()
    this.oscillators.push(oscillator)
    return oscillator
  })
  createGain = vi.fn(() => {
    const gain = new FakeGain()
    this.gains.push(gain)
    return gain
  })
  createPanner = vi.fn(() => {
    const panner = new FakePanner()
    this.panners.push(panner)
    return panner
  })
  createBufferSource = vi.fn(() => {
    const source = new FakeBufferSource()
    this.sources.push(source)
    return source
  })
  decodeAudioData = vi.fn(async () => ({} as AudioBuffer))
}

class FakeUtterance {
  lang = ''
  rate = 1
  pitch = 1
  volume = 1
  voice: SpeechSynthesisVoice | null = null
  onend: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(readonly text: string) {}
}

function live(overrides: Partial<TelemetrySnapshot> = {}): TelemetrySnapshot {
  return {
    sim: 'iracing', connected: true, timestamp: 1_000,
    speedKmh: 150, rpm: 7_000, gear: 3, throttle: 1, brake: 0, clutch: 0,
    replayContext: replayContext('live', 0),
    ...overrides
  }
}

function replayContext(state: ReplayContextState, revision: number): ReplayContext {
  return {
    state,
    reason: state === 'live' ? 'confirmed-live' : state === 'replay' ? 'replay-playing' : 'missing-metadata',
    inputs: {},
    active: state !== 'live',
    revision,
    token: `1:${revision}`,
    connectionEpoch: 1,
    sessionIdentity: 'session-a'
  }
}

function replayCancel(
  owner: ReplaySpeechCancelEvent['owner'],
  state: ReplaySpeechCancelEvent['state'],
  revision: number
): ReplaySpeechCancelEvent {
  return { owner, state, revision }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

type IpcListener = (payload: unknown) => void
type WindowListener = () => void

let context: FakeAudioContext
let audioContextCreations: number
let activeUtterance: FakeUtterance | null
let speechCancel: ReturnType<typeof vi.fn>
let ipcListeners: Map<string, Set<IpcListener>>
let ipcInvoke: ReturnType<typeof vi.fn>
let windowListeners: Map<string, Set<WindowListener>>

function emitIpc<T>(channel: string, payload: T): void {
  for (const listener of ipcListeners.get(channel) ?? []) listener(payload)
}

function emitWindow(type: string): void {
  for (const listener of windowListeners.get(type) ?? []) listener()
}

async function settle(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  resetSpeechOwnerRuntimeForTests()
  reactEffects.cleanups.length = 0
  context = new FakeAudioContext()
  audioContextCreations = 0
  activeUtterance = null
  ipcListeners = new Map()
  windowListeners = new Map()
  ipcInvoke = vi.fn(async () => null)
  speechCancel = vi.fn(() => {
    const active = activeUtterance
    activeUtterance = null
    active?.onerror?.()
  })
  const storage = new Map<string, string>()
  Object.assign(globalThis, {
    SpeechSynthesisUtterance: FakeUtterance,
    window: {
      AudioContext: class {
        constructor() {
          audioContextCreations += 1
          return context
        }
      },
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value)
      },
      speechSynthesis: {
        getVoices: () => [{ name: 'English', lang: 'en-US', voiceURI: 'english', default: true, localService: true }],
        speak: vi.fn((utterance: FakeUtterance) => { activeUtterance = utterance }),
        cancel: speechCancel,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      },
      ipc: {
        invoke: ipcInvoke,
        subscribe: vi.fn((channel: string, listener: IpcListener) => {
          const listeners = ipcListeners.get(channel) ?? new Set<IpcListener>()
          listeners.add(listener)
          ipcListeners.set(channel, listeners)
          return () => {
            listeners.delete(listener)
            if (listeners.size === 0) ipcListeners.delete(channel)
          }
        })
      },
      addEventListener: vi.fn((type: string, listener: WindowListener) => {
        const listeners = windowListeners.get(type) ?? new Set<WindowListener>()
        listeners.add(listener)
        windowListeners.set(type, listeners)
      }),
      removeEventListener: vi.fn((type: string, listener: WindowListener) => {
        const listeners = windowListeners.get(type)
        listeners?.delete(listener)
        if (listeners?.size === 0) windowListeners.delete(type)
      }),
      setTimeout
    }
  })
  setTtsPref({ engine: 'webspeech' })
})

afterEach(() => {
  for (const cleanup of reactEffects.cleanups.splice(0).reverse()) cleanup()
  stopSpotterPlayback()
  stopSpotter3DPlayback()
  vi.restoreAllMocks()
})

describe('replay owner/runtime cancellation', () => {
  it('cancels only the targeted active TTS owner', async () => {
    const engineer = speakViaTts('Engineer active', { source: 'engineer', lang: 'en-US' })
    await vi.waitFor(() => expect(activeUtterance?.text).toBe('Engineer active'))
    stopTtsOwner('coach')
    expect(speechCancel).not.toHaveBeenCalled()
    stopTtsOwner('engineer')
    expect(speechCancel).toHaveBeenCalledOnce()
    await engineer
  })

  it('physically stops current Web Speech when owner cancellation has no replacement', async () => {
    const speech = speakViaTts('Engineer cancelled', { source: 'engineer', lang: 'en-US' })
    await vi.waitFor(() => expect(activeUtterance?.text).toBe('Engineer cancelled'))

    cancelSpeechOwner('engineer')
    await speech

    expect(speechCancel).toHaveBeenCalledOnce()
    expect(activeUtterance).toBeNull()
    expect(isTtsSpeaking()).toBe(false)
  })

  it('does not let late superseded cancellation stop newer Web Speech', async () => {
    const first = speakViaTts('Old engineer line', { source: 'engineer', lang: 'en-US' })
    await vi.waitFor(() => expect(activeUtterance?.text).toBe('Old engineer line'))

    const second = speakViaTts('Current engineer line', { source: 'engineer', lang: 'en-US' })
    await vi.waitFor(() => expect(activeUtterance?.text).toBe('Current engineer line'))
    await first

    expect(speechCancel).toHaveBeenCalledOnce()
    expect(activeUtterance?.text).toBe('Current engineer line')
    expect(isTtsSpeaking()).toBe(true)

    activeUtterance?.onend?.()
    await second
    expect(speechCancel).toHaveBeenCalledOnce()
    expect(isTtsSpeaking()).toBe(false)
  })

  it('settles owner cancellation while AudioContext resume is suspended', async () => {
    const resume = deferred<undefined>()
    context.state = 'suspended'
    context.resume.mockImplementation(() => resume.promise)
    ipcInvoke.mockImplementation(async (channel: string) => {
      if (channel === TTS_CHANNELS.synth) return new Uint8Array([1, 2, 3])
      return null
    })
    setTtsPref({ engine: 'piper' })
    useTtsRuntime()

    const speech = speakViaTts('Engineer pending resume', { source: 'engineer', lang: 'en-US' })
    await vi.waitFor(() => expect(context.resume).toHaveBeenCalled())
    expect(isTtsSpeaking()).toBe(true)

    emitIpc(REPLAY_SPEECH_CANCEL_CHANNELS.engineer, replayCancel('engineer', 'replay', 1))
    await speech
    expect(isTtsSpeaking()).toBe(false)
    expect(context.decodeAudioData).not.toHaveBeenCalled()
    expect(context.sources).toHaveLength(0)

    resume.resolve(undefined)
    await settle()
    expect(context.decodeAudioData).not.toHaveBeenCalled()
    expect(context.sources).toHaveLength(0)
  })

  it('settles a resume-blocked TTS call when a newer call supersedes it', async () => {
    const firstResume = deferred<undefined>()
    context.state = 'suspended'
    context.resume.mockImplementation(() => {
      if (context.resume.mock.calls.length === 1) return firstResume.promise
      context.state = 'running'
      return Promise.resolve(undefined)
    })
    ipcInvoke.mockImplementation(async (channel: string) => {
      if (channel === TTS_CHANNELS.synth) return new Uint8Array([1, 2, 3])
      return null
    })
    setTtsPref({ engine: 'piper' })
    useTtsRuntime()

    const first = speakViaTts('First pending call', { source: 'engineer', lang: 'en-US' })
    await vi.waitFor(() => expect(context.resume).toHaveBeenCalledTimes(1))
    const second = speakViaTts('Replacement call', { source: 'engineer', lang: 'en-US' })
    await vi.waitFor(() => expect(context.sources).toHaveLength(1))
    const replacementSource = context.sources[0]
    expect(replacementSource.start).toHaveBeenCalledOnce()

    await first
    expect(isTtsSpeaking()).toBe(true)
    replacementSource.onended?.()
    await second
    expect(isTtsSpeaking()).toBe(false)
    expect(context.decodeAudioData).toHaveBeenCalledOnce()
    expect(context.sources).toHaveLength(1)

    firstResume.resolve(undefined)
    await settle()
    expect(context.decodeAudioData).toHaveBeenCalledOnce()
    expect(context.sources).toHaveLength(1)
  })

  it('routes replay IPC cancellation to one owner without a global speech cancel', () => {
    const coach = vi.fn()
    const engineer = vi.fn()
    const spotter = vi.fn()
    const offCoach = registerSpeechOwnerCanceller('coach', coach)
    const offEngineer = registerSpeechOwnerCanceller('engineer', engineer)
    const offSpotter = registerSpeechOwnerCanceller('spotter', spotter)
    useTtsRuntime()

    const event = replayCancel('coach', 'replay', 1)
    emitIpc(REPLAY_SPEECH_CANCEL_CHANNELS.coach, event)

    expect(coach).toHaveBeenCalledOnce()
    expect(coach).toHaveBeenCalledWith(event)
    expect(engineer).not.toHaveBeenCalled()
    expect(spotter).not.toHaveBeenCalled()
    expect(speechCancel).not.toHaveBeenCalled()
    offCoach()
    offEngineer()
    offSpotter()
  })

  it('clears the actual spotter queue and active playback through owner cancellation', async () => {
    const offVoice = registerSpeechOwnerCanceller('spotter', stopSpotterPlayback)
    const off3d = registerSpeechOwnerCanceller('spotter', stopSpotter3DPlayback)
    const webConfig = {
      ...DEFAULT_SPOTTER_CONFIG,
      defaultVoiceURI: '',
      callouts: Object.fromEntries(Object.entries(DEFAULT_SPOTTER_CONFIG.callouts).map(([id, cfg]) => [id, { ...cfg, voiceURI: '' }]))
    } as SpotterConfig
    const clearFlags = { green: false, yellow: false, blue: false, white: false, checkered: false, red: false, black: false, meatball: false, repair: false, disqualify: false, greenWhiteCheckered: false }
    processSpotterSnapshot(live({ flags: clearFlags }), webConfig)
    processSpotterSnapshot(live({ timestamp: 1_100, flags: { ...clearFlags, yellow: true, black: true } }), webConfig)
    await vi.waitFor(() => expect(window.speechSynthesis.speak).toHaveBeenCalled())
    expect(spotterSpeechState()).toMatchObject({ speaking: true, queued: 1 })
    const spatial = getSpotter3DEngine()
    spatial.start()
    cancelSpeechOwner('spotter')
    expect(spotterSpeechState()).toEqual({ speaking: false, queued: 0 })
    expect(spatial.isRunning()).toBe(false)
    expect(speechCancel).toHaveBeenCalledOnce()
    offVoice()
    off3d()
  })

  it('drops a rejected Piper decode fallback after the subscribed spotter owner is cancelled', async () => {
    const decode = deferred<AudioBuffer>()
    context.decodeAudioData.mockImplementation(() => decode.promise)
    const config = {
      ...DEFAULT_SPOTTER_CONFIG,
      defaultVoiceURI: '',
      callouts: Object.fromEntries(
        Object.entries(DEFAULT_SPOTTER_CONFIG.callouts).map(([id, callout]) => [id, { ...callout, voiceURI: '' }])
      )
    } as SpotterConfig
    ipcInvoke.mockImplementation(async (channel: string) => {
      if (channel === SPOTTER_CHANNELS.getConfig) return config
      if (channel === TTS_CHANNELS.listVoices) return []
      if (channel === TTS_CHANNELS.synth) return new Uint8Array([1, 2, 3])
      if (channel === TTS_CHANNELS.ensureVoice) return { ok: true, installed: true }
      return null
    })
    useTtsRuntime()
    useSpotterRuntime()
    await settle()

    const clearFlags = { green: false, yellow: false, blue: false, white: false, checkered: false, red: false, black: false, meatball: false, repair: false, disqualify: false, greenWhiteCheckered: false }
    emitIpc('telemetry:snapshot', live({ flags: clearFlags }))
    emitIpc('telemetry:snapshot', live({ timestamp: 1_100, flags: { ...clearFlags, green: true } }))
    await vi.waitFor(() => expect(context.decodeAudioData).toHaveBeenCalled())

    emitIpc(REPLAY_SPEECH_CANCEL_CHANNELS.spotter, replayCancel('spotter', 'replay', 1))
    decode.reject(new Error('invalid wav'))
    await settle()

    expect(window.speechSynthesis.speak).not.toHaveBeenCalled()
    expect(spotterSpeechState()).toEqual({ speaking: false, queued: 0 })
  })

  it('settles a resume-blocked spotter Piper callout when the spotter owner is cancelled', async () => {
    const resume = deferred<undefined>()
    context.state = 'suspended'
    context.resume.mockImplementation(() => resume.promise)
    const config = {
      ...DEFAULT_SPOTTER_CONFIG,
      defaultVoiceURI: '',
      callouts: Object.fromEntries(
        Object.entries(DEFAULT_SPOTTER_CONFIG.callouts).map(([id, callout]) => [id, { ...callout, voiceURI: '' }])
      )
    } as SpotterConfig
    ipcInvoke.mockImplementation(async (channel: string) => {
      if (channel === SPOTTER_CHANNELS.getConfig) return config
      if (channel === TTS_CHANNELS.listVoices) return []
      if (channel === TTS_CHANNELS.synth) return new Uint8Array([1, 2, 3])
      if (channel === TTS_CHANNELS.ensureVoice) return { ok: true, installed: true }
      return null
    })
    useTtsRuntime()
    useSpotterRuntime()
    await settle()

    const clearFlags = { green: false, yellow: false, blue: false, white: false, checkered: false, red: false, black: false, meatball: false, repair: false, disqualify: false, greenWhiteCheckered: false }
    emitIpc('telemetry:snapshot', live({ flags: clearFlags }))
    emitIpc('telemetry:snapshot', live({ timestamp: 1_100, flags: { ...clearFlags, green: true } }))
    await vi.waitFor(() => expect(context.resume).toHaveBeenCalled())

    emitIpc(REPLAY_SPEECH_CANCEL_CHANNELS.spotter, replayCancel('spotter', 'replay', 1))
    await settle()

    expect(context.decodeAudioData).not.toHaveBeenCalled()
    expect(window.speechSynthesis.speak).not.toHaveBeenCalled()
    expect(spotterSpeechState()).toEqual({ speaking: false, queued: 0 })

    resume.resolve(undefined)
    await settle()
    expect(context.decodeAudioData).not.toHaveBeenCalled()
    expect(context.sources).toHaveLength(0)
  })

  it('ignores an old preview decode rejection while the replacement Piper source is playing', async () => {
    const oldDecode = deferred<AudioBuffer>()
    context.decodeAudioData
      .mockImplementationOnce(() => oldDecode.promise)
      .mockResolvedValueOnce({} as AudioBuffer)
    const config = { ...DEFAULT_SPOTTER_CONFIG, defaultVoiceURI: '' } as SpotterConfig
    ipcInvoke.mockImplementation(async (channel: string) => {
      if (channel === SPOTTER_CHANNELS.getConfig) return config
      if (channel === TTS_CHANNELS.listVoices) return []
      if (channel === TTS_CHANNELS.synth) return new Uint8Array([1, 2, 3])
      if (channel === TTS_CHANNELS.ensureVoice) return { ok: true, installed: true }
      return null
    })
    useSpotterRuntime()
    await settle()

    testSpotterVoice(config)
    await vi.waitFor(() => expect(context.decodeAudioData).toHaveBeenCalledTimes(1))
    testSpotterVoice(config)
    await vi.waitFor(() => expect(context.sources).toHaveLength(1))
    const replacement = context.sources[0]
    expect(replacement.start).toHaveBeenCalledOnce()
    expect(spotterSpeechState().speaking).toBe(true)

    oldDecode.reject(new Error('old invalid wav'))
    await settle()

    expect(spotterSpeechState().speaking).toBe(true)
    expect(replacement.stop).not.toHaveBeenCalled()
    expect(window.speechSynthesis.speak).not.toHaveBeenCalled()
    replacement.onended?.()
  })

  it('keeps Spotter3D muted through replay config races and rebuilds clean cues on live resume', async () => {
    const load = deferred<Spotter3DConfig>()
    ipcInvoke.mockImplementation((channel: string) => {
      if (channel === SPOTTER_3D_CHANNELS.getConfig) return load.promise
      return Promise.resolve(null)
    })
    useTtsRuntime()
    useSpotter3DRuntime()

    const initialConfig = { ...DEFAULT_SPOTTER_3D_CONFIG, enabled: true, masterVolume: 0.2, updatedAt: 1 }
    emitIpc(SPOTTER_3D_CHANNELS.configEvent, initialConfig)
    expect(audioContextCreations).toBe(0)

    emitIpc('telemetry:snapshot', live({ carLeftRight: 'left' }))
    expect(audioContextCreations).toBe(1)
    expect(getSpotter3DStatus().running).toBe(true)
    const firstContext = context
    const activeVoice = firstContext.gains.slice(1).find((gain) =>
      gain.gain.setTargetAtTime.mock.calls.some(([value]) => value > 0)
    )
    expect(activeVoice).toBeDefined()
    expect(firstContext.panners.some((panner) =>
      panner.positionX.setTargetAtTime.mock.calls.some(([value]) => value < 0)
    )).toBe(true)

    emitIpc(REPLAY_SPEECH_CANCEL_CHANNELS.spotter, replayCancel('spotter', 'replay', 1))
    expect(getSpotter3DStatus().running).toBe(false)
    expect(activeVoice?.gain.setTargetAtTime.mock.calls.at(-1)?.[0]).toBe(0)
    expect(firstContext.gains.slice(1).every((gain) => gain.disconnect.mock.calls.length > 0)).toBe(true)
    expect(firstContext.panners.every((panner) => panner.disconnect.mock.calls.length > 0)).toBe(true)
    expect(firstContext.close).toHaveBeenCalledOnce()

    const creationsAtReplay = audioContextCreations
    const replacementContext = new FakeAudioContext()
    replacementContext.state = 'suspended'
    replacementContext.resume.mockImplementation(async () => {
      if (replacementContext.resume.mock.calls.length >= 2) replacementContext.state = 'running'
    })
    context = replacementContext
    const replayConfig = { ...DEFAULT_SPOTTER_3D_CONFIG, enabled: true, masterVolume: 0.35, updatedAt: 2 }
    emitIpc(SPOTTER_3D_CHANNELS.configEvent, replayConfig)
    load.resolve({ ...DEFAULT_SPOTTER_3D_CONFIG, enabled: true, masterVolume: 0.9, updatedAt: 0 })
    await settle()
    emitIpc('telemetry:snapshot', live({ replayContext: replayContext('replay', 1), carLeftRight: 'left' }))
    expect(audioContextCreations).toBe(creationsAtReplay)
    expect(getSpotter3DStatus().running).toBe(false)

    emitIpc('telemetry:snapshot', live({ timestamp: 1_200, replayContext: replayContext('live', 2), carLeftRight: 'clear' }))
    expect(audioContextCreations).toBe(creationsAtReplay + 1)
    expect(getSpotter3DStatus().running).toBe(true)
    expect(getSpotter3DStatus().unlocked).toBe(false)
    expect(getSpotter3DEngine().getConfig().masterVolume).toBe(0.35)
    expect(context.gains.slice(1).every((gain) =>
      gain.gain.setTargetAtTime.mock.calls.every(([value]) => value === 0)
    )).toBe(true)
    expect(windowListeners.get('pointerdown')?.size).toBe(1)

    const replacementGesture = [...(windowListeners.get('pointerdown') ?? [])][0]
    emitWindow('pointerdown')
    await settle()
    expect(replacementContext.resume).toHaveBeenCalledTimes(2)
    expect(getSpotter3DStatus().unlocked).toBe(true)
    expect(windowListeners.has('pointerdown')).toBe(false)
    replacementGesture?.()
    await settle()
    expect(replacementContext.resume).toHaveBeenCalledTimes(2)
  })

})
