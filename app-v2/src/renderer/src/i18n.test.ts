import { describe, expect, it } from 'vitest'
import { resolveAppLanguage, t, translateNavTitle } from './i18n'

describe('resolveAppLanguage', () => {
  it('uses the manual language when configured', () => {
    expect(resolveAppLanguage('de', ['pt-BR'])).toBe('de')
  })

  it('follows the first supported system language in auto mode', () => {
    expect(resolveAppLanguage('auto', ['it-IT', 'fr-FR', 'en-US'])).toBe('fr')
    expect(resolveAppLanguage('auto', ['es-MX'])).toBe('es')
    expect(resolveAppLanguage('auto', ['pt-BR'])).toBe('pt-BR')
  })

  it('falls back to English when the system language is unsupported', () => {
    expect(resolveAppLanguage('auto', ['it-IT'])).toBe('en')
  })

  it('has a safe default for non-browser callers', () => {
    expect(resolveAppLanguage('auto', [])).toBe('en')
  })
})

describe('i18n text helpers', () => {
  it('interpolates shell strings', () => {
    expect(t('en', 'addFavorite', { label: 'Telemetry' })).toBe('Add Telemetry to favorites')
  })

  it('translates known navigation section titles', () => {
    expect(translateNavTitle('IA & Coaching', 'en')).toBe('AI & Coaching')
    expect(translateNavTitle('Strategy', 'es')).toBe('Estrategia')
  })
})
