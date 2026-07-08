import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STT_CONFIG,
  DEFAULT_STT_MODEL_ID,
  DEFAULT_STT_WAKE_WORDS,
  isSttModelId,
  mergeSttConfig,
  type SttConfig
} from './stt-ipc'

describe('DEFAULT_STT_CONFIG', () => {
  it('defaults to enabled with the PT-BR wake words and the tiny model', () => {
    expect(DEFAULT_STT_CONFIG.enabled).toBe(true)
    expect(DEFAULT_STT_CONFIG.model).toBe('tiny')
    expect(DEFAULT_STT_MODEL_ID).toBe('tiny')
    expect(DEFAULT_STT_CONFIG.wakeWords).toEqual(['hey engineer', 'ok engineer', 'hello engineer'])
    expect(DEFAULT_STT_CONFIG.language).toBe('pt')
  })
})

describe('isSttModelId', () => {
  it('accepts only the catalog ids', () => {
    expect(isSttModelId('tiny')).toBe(true)
    expect(isSttModelId('base')).toBe(true)
    expect(isSttModelId('small')).toBe(false)
    expect(isSttModelId(42)).toBe(false)
    expect(isSttModelId(undefined)).toBe(false)
  })
})

describe('mergeSttConfig', () => {
  const base: SttConfig = { ...DEFAULT_STT_CONFIG, wakeWords: [...DEFAULT_STT_WAKE_WORDS] }

  it('returns the base untouched for an empty/nullish patch', () => {
    expect(mergeSttConfig(base, {})).toEqual(base)
    expect(mergeSttConfig(base, null)).toEqual(base)
    expect(mergeSttConfig(base, undefined)).toEqual(base)
  })

  it('toggles enabled only for a real boolean', () => {
    expect(mergeSttConfig(base, { enabled: false }).enabled).toBe(false)
    // non-boolean is ignored
    expect(mergeSttConfig(base, { enabled: 'yes' as unknown as boolean }).enabled).toBe(true)
  })

  it('validates the model id and falls back on junk', () => {
    expect(mergeSttConfig(base, { model: 'base' }).model).toBe('base')
    expect(mergeSttConfig(base, { model: 'huge' as never }).model).toBe('tiny')
  })

  it('trims, de-dupes (case-insensitively) and drops empty wake words', () => {
    const merged = mergeSttConfig(base, { wakeWords: ['  Oi Engenheiro  ', 'hey engineer', '', '   ', 'Ei chefe'] })
    expect(merged.wakeWords).toEqual(['Oi Engenheiro', 'hey engineer', 'Ei chefe'])
  })

  it('never persists an empty wake-word list (keeps the base)', () => {
    const merged = mergeSttConfig(base, { wakeWords: ['', '   '] })
    expect(merged.wakeWords).toEqual(base.wakeWords)
  })

  it('keeps existing wake words when the patch omits them', () => {
    const merged = mergeSttConfig(base, { enabled: false })
    expect(merged.wakeWords).toBe(base.wakeWords)
  })

  it('falls back to the base language for blank/non-string input', () => {
    expect(mergeSttConfig(base, { language: 'en' }).language).toBe('en')
    expect(mergeSttConfig(base, { language: '   ' }).language).toBe('pt')
    expect(mergeSttConfig(base, { language: 5 as unknown as string }).language).toBe('pt')
  })
})
