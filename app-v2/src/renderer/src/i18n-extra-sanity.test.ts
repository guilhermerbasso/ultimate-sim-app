import { describe, expect, it } from 'vitest'
import { tt } from './i18n'

describe('i18n-extra merge', () => {
  it('merges per-zone modules into UI_TEXT', () => {
    expect(tt('en', '_i18nExtraSanity')).toBe('OK')
    expect(tt('pt-BR', '_i18nExtraSanity')).toBe('OK-pt')
    // falls back to en for a language without the key
    expect(tt('ja', '_i18nExtraSanity')).toBe('OK')
  })

  it('loads accessibility cue copy for every supported language', () => {
    for (const language of ['en', 'pt-BR', 'es', 'fr', 'de', 'zh', 'ja'] as const) {
      expect(tt(language, 'accessibilityCues.title')).not.toBe(
        'accessibilityCues.title'
      )
      expect(tt(language, 'accessibilityCues.runPreview')).not.toBe(
        'accessibilityCues.runPreview'
      )
      expect(tt(language, 'accessibilityCues.live.alert.lowFuel')).not.toBe(
        'accessibilityCues.live.alert.lowFuel'
      )
      expect(tt(language, 'accessibilityCues.pattern.led.steadyActual')).not.toBe(
        'accessibilityCues.pattern.led.steadyActual'
      )
    }
  })
})
