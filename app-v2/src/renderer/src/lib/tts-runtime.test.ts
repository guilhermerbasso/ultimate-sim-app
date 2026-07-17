import { describe, it, expect } from 'vitest'
import {
  DEFAULT_TTS_PREF,
  DEFAULT_TTS_VOICE_ID,
  clampSpatialPan,
  clampTtsRate,
  mergeTtsPref,
  chunkText,
  TTS_CHUNK_MAX_CHARS,
  isTtsSpeaking,
  notifyExternalSpeaking,
  externalSpeakingDepth
} from './tts-runtime'

// Pure-logic tests for the renderer TTS config + text chunking. These run in the
// node environment (no DOM): the functions under test never touch window.

describe('DEFAULT_TTS_PREF', () => {
  it('defaults to Piper + en_US-lessac-medium + rate 1', () => {
    expect(DEFAULT_TTS_PREF).toEqual({ engine: 'piper', voiceId: 'en_US-lessac-medium', rate: 1 })
    expect(DEFAULT_TTS_VOICE_ID).toBe('en_US-lessac-medium')
  })
})

describe('clampTtsRate', () => {
  it('clamps to the 0.5..2.0 range', () => {
    expect(clampTtsRate(0.1)).toBe(0.5)
    expect(clampTtsRate(5)).toBe(2)
    expect(clampTtsRate(1.25)).toBe(1.25)
  })

  describe('clampSpatialPan', () => {
    it('clamps explicit spatial cue positions and rejects unknown values', () => {
      expect(clampSpatialPan(-2)).toBe(-1)
      expect(clampSpatialPan(0.4)).toBe(0.4)
      expect(clampSpatialPan(2)).toBe(1)
      expect(clampSpatialPan(Number.NaN)).toBeUndefined()
      expect(clampSpatialPan('left')).toBeUndefined()
    })
  })

  it('falls back to the default for non-finite / non-number input', () => {
    expect(clampTtsRate(Number.NaN)).toBe(1)
    expect(clampTtsRate(undefined as unknown as number)).toBe(1)
    expect(clampTtsRate('fast' as unknown as number)).toBe(1)
  })
})

describe('mergeTtsPref', () => {
  it('returns defaults for null/empty input', () => {
    expect(mergeTtsPref(null)).toEqual(DEFAULT_TTS_PREF)
    expect(mergeTtsPref({})).toEqual(DEFAULT_TTS_PREF)
  })

  it('accepts a valid catalog voice id', () => {
    expect(mergeTtsPref({ voiceId: 'en_US-lessac-medium' }).voiceId).toBe('en_US-lessac-medium')
  })

  it('rejects an invalid voice id, keeping the default', () => {
    expect(mergeTtsPref({ voiceId: 'bogus' }).voiceId).toBe(DEFAULT_TTS_PREF.voiceId)
    expect(mergeTtsPref({ voiceId: '../etc/passwd' }).voiceId).toBe(DEFAULT_TTS_PREF.voiceId)
  })

  it('normalises the engine (only piper | webspeech)', () => {
    expect(mergeTtsPref({ engine: 'webspeech' }).engine).toBe('webspeech')
    expect(mergeTtsPref({ engine: 'piper' }).engine).toBe('piper')
    expect(mergeTtsPref({ engine: 'azure' as unknown as 'piper' }).engine).toBe('piper')
  })

  it('clamps the rate', () => {
    expect(mergeTtsPref({ rate: 99 }).rate).toBe(2)
    expect(mergeTtsPref({ rate: 0 }).rate).toBe(0.5)
  })
})

describe('chunkText', () => {
  it('returns [] for empty/whitespace', () => {
    expect(chunkText('')).toEqual([])
    expect(chunkText('   \n  ')).toEqual([])
  })

  it('returns a single chunk for short text', () => {
    expect(chunkText('Good lap.')).toEqual(['Good lap.'])
  })

  it('splits long text on sentence boundaries within the limit', () => {
    const sentence = 'Curva três à right.'
    const text = Array.from({ length: 30 }, () => sentence).join(' ')
    const chunks = chunkText(text)
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(TTS_CHUNK_MAX_CHARS)
    // No content lost (ignoring whitespace differences).
    expect(chunks.join(' ').replace(/\s+/g, '')).toBe(text.replace(/\s+/g, ''))
  })

  it('hard-splits a single oversized sentence with no boundaries', () => {
    const word = 'a'.repeat(600)
    const chunks = chunkText(word)
    expect(chunks.length).toBe(Math.ceil(600 / TTS_CHUNK_MAX_CHARS))
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(TTS_CHUNK_MAX_CHARS)
  })
})

// M4 — shared "is something speaking" signal. Both speech channels (this module's
// own speakViaTts and the Voice Spotter via notifyExternalSpeaking) must feed the
// SAME flag the wake-word self-listen guard consults, so the mic is suppressed
// while EITHER speaks. We can only drive the external source from a unit test (the
// internal speakingCount needs a DOM/IPC), so we verify that source end-to-end.
describe('isTtsSpeaking / notifyExternalSpeaking (shared self-listen flag)', () => {
  it('reflects an external speaking source and stays balanced', () => {
    // Starts idle.
    expect(externalSpeakingDepth()).toBe(0)
    expect(isTtsSpeaking()).toBe(false)

    // A spotter line STARTS → the shared flag is set.
    notifyExternalSpeaking(true)
    expect(externalSpeakingDepth()).toBe(1)
    expect(isTtsSpeaking()).toBe(true)

    // It ENDS → flag clears (balanced +1/-1).
    notifyExternalSpeaking(false)
    expect(externalSpeakingDepth()).toBe(0)
    expect(isTtsSpeaking()).toBe(false)
  })

  it('counts overlapping sources and only clears when ALL have ended', () => {
    notifyExternalSpeaking(true)
    notifyExternalSpeaking(true)
    expect(externalSpeakingDepth()).toBe(2)
    expect(isTtsSpeaking()).toBe(true)

    notifyExternalSpeaking(false)
    // Still speaking — one source remains.
    expect(externalSpeakingDepth()).toBe(1)
    expect(isTtsSpeaking()).toBe(true)

    notifyExternalSpeaking(false)
    expect(externalSpeakingDepth()).toBe(0)
    expect(isTtsSpeaking()).toBe(false)
  })

  it('floors at zero so an unbalanced extra stop can never go negative', () => {
    expect(externalSpeakingDepth()).toBe(0)
    notifyExternalSpeaking(false)
    notifyExternalSpeaking(false)
    expect(externalSpeakingDepth()).toBe(0)
    expect(isTtsSpeaking()).toBe(false)
  })
})
