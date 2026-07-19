import { describe, expect, it } from 'vitest'
import { tt } from './i18n'
import { ACCESSIBILITY_CUE_REQUIRED_TRANSLATED_KEYS } from './i18n-extra/accessibility-cues'

describe('i18n-extra merge', () => {
  it('merges per-zone modules into UI_TEXT', () => {
    expect(tt('en', '_i18nExtraSanity')).toBe('OK')
    expect(tt('pt-BR', '_i18nExtraSanity')).toBe('OK-pt')
    // falls back to en for a language without the key
    expect(tt('ja', '_i18nExtraSanity')).toBe('OK')
  })

  it('loads Mission Rehearsal and accessibility copy for every supported language', () => {
    for (const language of ['en', 'pt-BR', 'es', 'fr', 'de', 'zh', 'ja'] as const) {
      expect(tt(language, 'view.mission-rehearsal.label')).not.toBe('view.mission-rehearsal.label')
      expect(tt(language, 'mission.watermarkAria')).not.toBe('mission.watermarkAria')
      expect(tt(language, 'mission.reset.body')).not.toBe('mission.reset.body')
      expect(tt(language, 'mission.debrief.blameless')).not.toBe('mission.debrief.blameless')
      expect(tt(language, 'mission.debrief.blamelessStatement')).not.toBe('mission.debrief.blamelessStatement')
      expect(tt(language, 'mission.tabs.lockedDuringRun')).not.toBe('mission.tabs.lockedDuringRun')
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

  it('does not accept English fallback for required accessibility controls and live alerts', () => {
    for (const language of ['es', 'fr', 'de', 'zh', 'ja'] as const) {
      for (const key of ACCESSIBILITY_CUE_REQUIRED_TRANSLATED_KEYS) {
        expect(tt(language, key), `${language}:${key}`).not.toBe(tt('en', key))
      }
    }
  })

  it('renders representative translated alert and control copy', () => {
    expect(tt('es', 'accessibilityCues.live.alert.flag.black')).toBe(
      'Bandera negra activa.'
    )
    expect(tt('fr', 'accessibilityCues.resetProfile')).toBe(
      'Réinitialiser ce profil'
    )
    expect(tt('de', 'accessibilityCues.live.alert.lowFuel', {
      remaining: 2
    })).toContain('2 Runden')
    expect(tt('zh', 'accessibilityCues.persistentCaptions')).toContain('字幕')
    expect(tt('ja', 'accessibilityCues.live.alert.blueFlag')).toContain('青旗')
  })
})
