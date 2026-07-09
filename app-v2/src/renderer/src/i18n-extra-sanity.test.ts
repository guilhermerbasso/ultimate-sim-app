import { describe, expect, it } from 'vitest'
import { tt } from './i18n'

describe('i18n-extra merge', () => {
  it('merges per-zone modules into UI_TEXT', () => {
    expect(tt('en', '_i18nExtraSanity')).toBe('OK')
    expect(tt('pt-BR', '_i18nExtraSanity')).toBe('OK-pt')
    // falls back to en for a language without the key
    expect(tt('ja', '_i18nExtraSanity')).toBe('OK')
  })
})
