import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VAD_CONFIG,
  DEFAULT_VAD_GATE_CONFIG,
  INITIAL_VAD_STATE,
  downsampledLength,
  downsampleTo16k,
  floatToPcm16,
  fuzzyWakeWordMatch,
  isSpeechFrame,
  levenshtein,
  normalizeForMatch,
  passesVadGate,
  rmsOf,
  stepVad,
  toWhisperPcm16,
  type VadConfig
} from './wake-word-core'

const WAKE_WORDS = ['oi engenheiro', 'ok engenheiro', 'olá engenheiro']

describe('normalizeForMatch', () => {
  it('lowercases, strips accents and punctuation, collapses whitespace', () => {
    expect(normalizeForMatch('Oi, Engenheiro!')).toBe('oi engenheiro')
    expect(normalizeForMatch('  OLÁ   Engenheiro  ')).toBe('ola engenheiro')
    expect(normalizeForMatch('ô engenheiro')).toBe('o engenheiro')
  })
})

describe('levenshtein', () => {
  it('computes edit distance', () => {
    expect(levenshtein('', '')).toBe(0)
    expect(levenshtein('abc', 'abc')).toBe(0)
    expect(levenshtein('abc', 'abd')).toBe(1)
    expect(levenshtein('kitten', 'sitting')).toBe(3)
    expect(levenshtein('', 'abc')).toBe(3)
  })
})

describe('fuzzyWakeWordMatch', () => {
  it('matches the canonical phrase ignoring case + punctuation', () => {
    const m = fuzzyWakeWordMatch('Oi, Engenheiro!', WAKE_WORDS)
    expect(m.matched).toBe(true)
    expect(m.matchedWord).toBe('oi engenheiro')
    expect(m.distance).toBe(0)
  })

  it('matches accent variants ("olá" written as "ola", "ô")', () => {
    expect(fuzzyWakeWordMatch('ola engenheiro', WAKE_WORDS).matched).toBe(true)
    expect(fuzzyWakeWordMatch('ô engenheiro me ajuda', WAKE_WORDS).matched).toBe(true)
  })

  it('tolerates small whisper errors within the edit-distance budget', () => {
    // "engenhero" (missing an i) is one edit away.
    const m = fuzzyWakeWordMatch('oi engenhero', WAKE_WORDS)
    expect(m.matched).toBe(true)
    expect(m.distance).toBe(1)
  })

  it('finds the wake word anywhere in the utterance and returns trailing text', () => {
    const m = fuzzyWakeWordMatch('então oi engenheiro quanto combustível tenho', WAKE_WORDS)
    expect(m.matched).toBe(true)
    expect(m.trailing).toBe('quanto combustivel tenho')
  })

  it('rejects unrelated speech', () => {
    expect(fuzzyWakeWordMatch('let us open the car setup', WAKE_WORDS).matched).toBe(false)
    expect(fuzzyWakeWordMatch('', WAKE_WORDS).matched).toBe(false)
  })

  it('respects an explicit maxDistance of 0 (exact only)', () => {
    expect(fuzzyWakeWordMatch('oi engenhero', WAKE_WORDS, { maxDistance: 0 }).matched).toBe(false)
    expect(fuzzyWakeWordMatch('oi engenheiro', WAKE_WORDS, { maxDistance: 0 }).matched).toBe(true)
  })
})

describe('VAD energy + threshold', () => {
  it('rmsOf computes root-mean-square energy', () => {
    expect(rmsOf(new Float32Array([]))).toBe(0)
    expect(rmsOf(new Float32Array([0, 0, 0]))).toBe(0)
    expect(rmsOf(new Float32Array([1, -1, 1, -1]))).toBeCloseTo(1, 6)
    expect(rmsOf(new Float32Array([0.5, -0.5]))).toBeCloseTo(0.5, 6)
  })

  it('isSpeechFrame gates on the threshold', () => {
    expect(isSpeechFrame(0.02, 0.012)).toBe(true)
    expect(isSpeechFrame(0.005, 0.012)).toBe(false)
    expect(isSpeechFrame(0.012, 0.012)).toBe(true)
  })
})

describe('stepVad segmentation', () => {
  const cfg: VadConfig = { threshold: 0.01, openFrames: 2, hangoverFrames: 3 }

  it('opens a segment only after openFrames consecutive speech frames', () => {
    let s = INITIAL_VAD_STATE
    let r = stepVad(s, 0.5, cfg) // 1st speech frame
    expect(r.event).toBe('none')
    expect(r.state.active).toBe(false)
    s = r.state
    r = stepVad(s, 0.5, cfg) // 2nd → opens
    expect(r.event).toBe('segment-start')
    expect(r.state.active).toBe(true)
  })

  it('a single loud frame does not open a segment (debounce)', () => {
    let r = stepVad(INITIAL_VAD_STATE, 0.5, cfg)
    r = stepVad(r.state, 0.0, cfg) // silence resets the run
    expect(r.state.active).toBe(false)
    expect(r.state.speechRun).toBe(0)
  })

  it('closes a segment after hangoverFrames of silence', () => {
    // open first
    let r = stepVad(INITIAL_VAD_STATE, 0.5, cfg)
    r = stepVad(r.state, 0.5, cfg)
    expect(r.state.active).toBe(true)
    // 3 silent frames → close on the 3rd
    r = stepVad(r.state, 0.0, cfg)
    expect(r.event).toBe('none')
    r = stepVad(r.state, 0.0, cfg)
    expect(r.event).toBe('none')
    r = stepVad(r.state, 0.0, cfg)
    expect(r.event).toBe('segment-end')
    expect(r.state.active).toBe(false)
  })

  it('a speech frame during hangover keeps the segment open', () => {
    let r = stepVad(INITIAL_VAD_STATE, 0.5, cfg)
    r = stepVad(r.state, 0.5, cfg) // open
    r = stepVad(r.state, 0.0, cfg) // silence 1
    r = stepVad(r.state, 0.5, cfg) // speech resets hangover
    expect(r.state.active).toBe(true)
    expect(r.state.silenceRun).toBe(0)
  })

  it('exposes sane defaults', () => {
    expect(DEFAULT_VAD_CONFIG.openFrames).toBeGreaterThanOrEqual(1)
    expect(DEFAULT_VAD_CONFIG.hangoverFrames).toBeGreaterThan(DEFAULT_VAD_CONFIG.openFrames)
    expect(DEFAULT_VAD_CONFIG.threshold).toBeGreaterThan(0)
  })
})

describe('downsample length math', () => {
  it('floors the resampled length by the rate ratio', () => {
    expect(downsampledLength(48000, 48000)).toBe(16000) // default target is 16k → 3:1
    expect(downsampledLength(16000, 16000, 16000)).toBe(16000) // identity when rates match
    expect(downsampledLength(48000, 48000, 16000)).toBe(16000) // 3:1
    expect(downsampledLength(44100, 44100, 16000)).toBe(16000) // 44.1k → 16k
    expect(downsampledLength(0, 48000)).toBe(0)
    expect(downsampledLength(100, 0)).toBe(0)
  })

  it('downsampleTo16k returns the predicted length', () => {
    const input = new Float32Array(48000).fill(0.25)
    const out = downsampleTo16k(input, 48000, 16000)
    expect(out.length).toBe(downsampledLength(48000, 48000, 16000))
    expect(out.length).toBe(16000)
  })

  it('downsampleTo16k is identity when rates match', () => {
    const input = new Float32Array([0.1, 0.2, 0.3])
    expect(downsampleTo16k(input, 16000, 16000)).toBe(input)
  })
})

describe('floatToPcm16 / toWhisperPcm16', () => {
  it('produces 2 bytes per sample and clamps out-of-range values', () => {
    const pcm = floatToPcm16(new Float32Array([0, 1, -1, 2, -2]))
    expect(pcm.length).toBe(10)
    const view = new DataView(pcm.buffer)
    expect(view.getInt16(0, true)).toBe(0)
    expect(view.getInt16(2, true)).toBe(0x7fff) // +1 → max
    expect(view.getInt16(4, true)).toBe(-0x7fff) // -1 → -max (rounded)
    expect(view.getInt16(6, true)).toBe(0x7fff) // +2 clamped
    expect(view.getInt16(8, true)).toBe(-0x7fff) // -2 clamped
  })

  it('toWhisperPcm16 yields 2 bytes per 16k sample', () => {
    const input = new Float32Array(48000).fill(0.1)
    const pcm = toWhisperPcm16(input, 48000)
    expect(pcm.length).toBe(16000 * 2)
  })
})

describe('passesVadGate', () => {
  it('falls back to whisper-always-on when the gate is unavailable (null/undefined/NaN)', () => {
    expect(passesVadGate(null)).toBe(true)
    expect(passesVadGate(undefined)).toBe(true)
    expect(passesVadGate(NaN)).toBe(true)
  })

  it('passes a segment whose probability meets the threshold', () => {
    expect(passesVadGate(0.5)).toBe(true) // default threshold = 0.5 (inclusive)
    expect(passesVadGate(0.91)).toBe(true)
  })

  it('blocks a segment below the threshold (CPU saved — whisper skipped)', () => {
    expect(passesVadGate(0.49)).toBe(false)
    expect(passesVadGate(0)).toBe(false)
  })

  it('honors a custom threshold', () => {
    expect(passesVadGate(0.7, { threshold: 0.8 })).toBe(false)
    expect(passesVadGate(0.85, { threshold: 0.8 })).toBe(true)
  })

  it('exposes a sane default operating point', () => {
    expect(DEFAULT_VAD_GATE_CONFIG.threshold).toBeGreaterThan(0)
    expect(DEFAULT_VAD_GATE_CONFIG.threshold).toBeLessThanOrEqual(1)
  })
})
