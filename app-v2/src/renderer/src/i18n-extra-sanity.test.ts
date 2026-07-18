import { describe, expect, it } from 'vitest'
import { tt } from './i18n'

describe('i18n-extra merge', () => {
  it('merges per-zone modules into UI_TEXT', () => {
    expect(tt('en', '_i18nExtraSanity')).toBe('OK')
    expect(tt('pt-BR', '_i18nExtraSanity')).toBe('OK-pt')
    // falls back to en for a language without the key
    expect(tt('ja', '_i18nExtraSanity')).toBe('OK')
  })

  it('loads Mission Rehearsal workflow and accessibility labels for every language', () => {
    for (const language of ['en', 'pt-BR', 'es', 'fr', 'de', 'zh', 'ja'] as const) {
      expect(tt(language, 'view.mission-rehearsal.label')).not.toBe('view.mission-rehearsal.label')
      expect(tt(language, 'mission.watermarkAria')).not.toBe('mission.watermarkAria')
      expect(tt(language, 'mission.reset.body')).not.toBe('mission.reset.body')
      expect(tt(language, 'mission.debrief.blameless')).not.toBe('mission.debrief.blameless')
      expect(tt(language, 'mission.debrief.blamelessStatement')).not.toBe('mission.debrief.blamelessStatement')
    }
  })
})
