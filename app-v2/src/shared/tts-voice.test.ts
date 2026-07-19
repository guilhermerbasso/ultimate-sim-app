import { describe, expect, it } from 'vitest'
import { DEFAULT_SPOTTER_CONFIG } from './spotter'
import {
  accessibilitySpeechLocale,
  piperLanguageForAccessibilityLocale,
  resolvePiperVoice,
  resolveSpeechVoiceURI,
  speechLanguageFromAppLanguage,
  voiceMatchesAccessibilityLocale
} from './tts-voice'

describe('language-matched speech voice resolution', () => {
  it('resolves auto from the Electron app locale instead of a separate process default', () => {
    expect(speechLanguageFromAppLanguage('auto', 'pt-BR')).toBe('pt-BR')
    expect(speechLanguageFromAppLanguage('auto', 'en-US')).toBe('en-US')
  })

  it('uses Portuguese defaults for engineer and spotter when the app language is pt-BR', () => {
    const language = speechLanguageFromAppLanguage('pt-BR')

    const engineer = resolvePiperVoice(language, 'en_US-lessac-medium')
    const spotter = resolveSpeechVoiceURI(language, DEFAULT_SPOTTER_CONFIG.defaultVoiceURI)
    const migratedSpotter = resolveSpeechVoiceURI(language, 'piper:en_US-lessac-medium')

    expect(engineer).toMatchObject({ language: 'pt-BR', voiceId: 'pt_BR-faber-medium' })
    expect(spotter).toBe('piper:pt_BR-faber-medium')
    expect(migratedSpotter).toBe('piper:pt_BR-faber-medium')
    expect(engineer.voiceId).not.toBe('en_US-lessac-medium')
  })

  it('uses English defaults for engineer and spotter when the app language is en', () => {
    const language = speechLanguageFromAppLanguage('en')

    const engineer = resolvePiperVoice(language, 'pt_BR-faber-medium')
    const spotter = resolveSpeechVoiceURI(language, 'piper:pt_BR-faber-medium')

    expect(engineer).toMatchObject({ language: 'en-US', voiceId: 'en_US-lessac-medium' })
    expect(spotter).toBe('piper:en_US-lessac-medium')
    expect(engineer.voiceId).not.toBe('pt_BR-faber-medium')
  })

  it('honors explicit same-language overrides for engineer, spotter, and proximity', () => {
    const pt = speechLanguageFromAppLanguage('pt-BR')
    const en = speechLanguageFromAppLanguage('en')

    expect(resolvePiperVoice(pt, 'pt_BR-cadu-medium')).toMatchObject({
      voiceId: 'pt_BR-cadu-medium',
      overrideHonored: true
    })
    expect(resolveSpeechVoiceURI(pt, 'piper:pt_BR-jeff-medium')).toBe('piper:pt_BR-jeff-medium')
    expect(resolveSpeechVoiceURI(en, 'piper:en_US-amy-medium')).toBe('piper:en_US-amy-medium')
  })

  it('honors a loaded same-language OS override but rejects a wrong-language one', () => {
    const voices = [
      { voiceURI: 'sapi:Maria', lang: 'pt-BR' },
      { voiceURI: 'sapi:Zira', lang: 'en-US' }
    ]

    expect(resolveSpeechVoiceURI('pt-BR', 'sapi:Maria', voices)).toBe('sapi:Maria')
    expect(resolveSpeechVoiceURI('pt-BR', 'sapi:Zira', voices)).toBe('piper:pt_BR-faber-medium')
  })

  it.each([
    ['en', 'en-US', 'en-US'],
    ['pt-BR', 'pt-BR', 'pt-BR'],
    ['es', 'es-ES', null],
    ['fr', 'fr-FR', null],
    ['de', 'de-DE', null],
    ['zh', 'zh-CN', null],
    ['ja', 'ja-JP', null]
  ] as const)(
    'maps %s accessibility copy to matching speech locale %s',
    (language, locale, piperLanguage) => {
      expect(accessibilitySpeechLocale(language)).toBe(locale)
      expect(piperLanguageForAccessibilityLocale(locale)).toBe(piperLanguage)
      expect(voiceMatchesAccessibilityLocale(locale, locale)).toBe(true)
      expect(voiceMatchesAccessibilityLocale('en-US', locale)).toBe(
        locale === 'en-US'
      )
    }
  )
})
