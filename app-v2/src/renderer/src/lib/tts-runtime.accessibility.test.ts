// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PiperVoiceInfo } from '../../../shared/spotter'

vi.mock('./log-client', () => ({
  logClient: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

class FakeUtterance {
  readonly text: string
  rate = 1
  pitch = 1
  lang = ''
  voice: SpeechSynthesisVoice | null = null
  onend: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(text: string) {
    this.text = text
  }
}

const osVoice = {
  default: true,
  lang: 'en-US',
  localService: true,
  name: 'Test voice',
  voiceURI: 'test:voice'
} as SpeechSynthesisVoice

function installRendererMocks(
  invoke: ReturnType<typeof vi.fn>,
  autoEnd = true
) {
  const speak = vi.fn((utterance: FakeUtterance) => {
    if (autoEnd) queueMicrotask(() => utterance.onend?.())
  })
  const cancel = vi.fn()
  Object.defineProperty(window, 'ipc', {
    configurable: true,
    value: {
      invoke,
      subscribe: vi.fn(() => () => undefined)
    }
  })
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: {
      addEventListener: vi.fn(),
      cancel,
      getVoices: vi.fn(() => [osVoice]),
      removeEventListener: vi.fn(),
      speak
    }
  })
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
  return { cancel, speak }
}

function savePref(engine: 'piper' | 'webspeech'): void {
  window.localStorage.setItem('tts.pref.migrated.v2', '1')
  window.localStorage.setItem(
    'tts.pref.v1',
    JSON.stringify({
      engine,
      voiceId: 'en_US-lessac-medium',
      rate: 1
    })
  )
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  window.localStorage.clear()
})

describe('isolated accessibility TTS engine selection', () => {
  it('honors an explicit Web Speech preference without invoking Piper', async () => {
    const invoke = vi.fn()
    const { speak } = installRendererMocks(invoke)
    savePref('webspeech')
    const { speakViaIsolatedTts } = await import('./tts-runtime')

    await speakViaIsolatedTts('accessibility-live', 'Yellow flag')

    expect(invoke).not.toHaveBeenCalled()
    expect(speak).toHaveBeenCalledTimes(1)
  })

  it('falls back to Web Speech when selected Piper synthesis is unavailable', async () => {
    const invoke = vi.fn(async () => null)
    const { speak } = installRendererMocks(invoke)
    savePref('piper')
    const { speakViaIsolatedTts } = await import('./tts-runtime')

    await speakViaIsolatedTts('accessibility-live', 'Low fuel')

    expect(invoke).toHaveBeenCalledWith(
      'tts:synth',
      'Low fuel',
      'en_US-lessac-medium',
      1
    )
    expect(speak).toHaveBeenCalledTimes(1)
  })

  it('settles isolated Web Speech promptly when the channel is stopped', async () => {
    const invoke = vi.fn()
    const { cancel, speak } = installRendererMocks(invoke, false)
    savePref('webspeech')
    const { speakViaIsolatedTts, stopIsolatedTts } = await import('./tts-runtime')

    const speaking = speakViaIsolatedTts(
      'accessibility-preview',
      'Preview cue'
    )
    await vi.waitFor(() => expect(speak).toHaveBeenCalledTimes(1))
    stopIsolatedTts('accessibility-preview')

    await expect(speaking).resolves.toBeUndefined()
    expect(cancel).toHaveBeenCalledTimes(1)
  })
})

describe('accessibility TTS audio availability', () => {
  it('reports only the selected engine plus its permitted Web Speech fallback', async () => {
    const invoke = vi.fn()
    installRendererMocks(invoke)
    const { resolveTtsAudioAvailability } = await import('./tts-runtime')
    const installedVoice = {
      id: 'en_US-lessac-medium',
      installed: true
    } as PiperVoiceInfo

    expect(
      resolveTtsAudioAvailability(
        { engine: 'webspeech', voiceId: installedVoice.id, rate: 1 },
        'en',
        [installedVoice],
        false,
        true
      ).available
    ).toBe(false)
    expect(
      resolveTtsAudioAvailability(
        { engine: 'piper', voiceId: installedVoice.id, rate: 1 },
        'en',
        [installedVoice],
        false,
        true
      ).available
    ).toBe(true)
    expect(
      resolveTtsAudioAvailability(
        { engine: 'piper', voiceId: installedVoice.id, rate: 1 },
        'en',
        [],
        true,
        false
      ).available
    ).toBe(true)
    expect(
      resolveTtsAudioAvailability(
        { engine: 'piper', voiceId: installedVoice.id, rate: 1 },
        'en',
        [],
        false,
        true
      ).available
    ).toBe(false)
  })

  it('does not lease Piper audio when the live engine probe is failing and no fallback exists', async () => {
    const installedVoice = {
      id: 'en_US-lessac-medium',
      installed: true
    } as PiperVoiceInfo
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'tts:listVoices') return [installedVoice]
      if (channel === 'tts:engineStatus') {
        return { engine: 'sherpa', ok: false, reason: 'probe failed' }
      }
      return null
    })
    installRendererMocks(invoke)
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: undefined
    })
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: class FakeAudioContext {}
    })
    vi.stubGlobal('SpeechSynthesisUtterance', undefined)
    savePref('piper')
    const { detectTtsAudioAvailability } = await import('./tts-runtime')

    await expect(detectTtsAudioAvailability('en')).resolves.toMatchObject({
      available: false,
      selectedEngine: 'piper',
      piperAvailable: false,
      webSpeechAvailable: false
    })
  })
})
