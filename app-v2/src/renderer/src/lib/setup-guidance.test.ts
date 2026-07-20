import { describe, expect, it } from 'vitest'
import {
  adviseFromBrakeBias,
  adviseFromHandling,
  adviseFromTyres,
  type SetupSuggestion
} from '../../../shared/setup-advisor'
import type { ResolvedLanguage } from '../i18n'
import { localizeSetupSuggestion } from './setup-guidance'

const LANGUAGES: readonly ResolvedLanguage[] = ['pt-BR', 'en', 'es', 'fr', 'de', 'zh', 'ja']

function everyGeneratedSuggestion(): SetupSuggestion[] {
  return [
    ...(['entry', 'mid', 'exit'] as const).flatMap((phase) => [
      ...adviseFromHandling([{ phase, bias: -0.8 }]),
      ...adviseFromHandling([{ phase, bias: 0.8 }])
    ]),
    ...adviseFromTyres({
      lf: { innerC: 115, middleC: 130, outerC: 80 },
      rf: { innerC: 75, middleC: 50, outerC: 105 },
      lr: { innerC: 50, middleC: 50, outerC: 50 },
      rr: { innerC: 120, middleC: 120, outerC: 120 }
    }),
    ...adviseFromBrakeBias({ frontLock: true, rearLock: true, brakeBiasPct: 57 })
  ]
}

describe('localized structured setup guidance', () => {
  it('renders every emitted symptom and adjustment code in every supported locale', () => {
    const suggestions = everyGeneratedSuggestion()
    expect(new Set(suggestions.map((suggestion) => suggestion.symptom)).size).toBe(15)

    for (const language of LANGUAGES) {
      for (const suggestion of suggestions) {
        const localized = localizeSetupSuggestion(suggestion, language, 'metric')
        expect(localized, `${language}:${suggestion.symptom}`).not.toBeNull()
        expect(localized?.primary.change).not.toBe(suggestion.primary.change)
        expect(localized?.rationale).not.toBe(suggestion.rationale)
        expect(localized?.evidence).not.toBe(suggestion.evidence)
      }
    }
  })

  it('converts persisted metric values using the archived unit system', () => {
    const suggestion = adviseFromTyres({
      lf: { innerC: 80, middleC: 100, outerC: 80 }
    }).find((candidate) => candidate.symptom === 'pressure-high')
    expect(suggestion).toBeDefined()

    const localized = localizeSetupSuggestion(suggestion!, 'en', 'imperial')
    expect(localized?.primary.change).toContain('0.5–1 psi')
    expect(localized?.evidence).toContain('212 °F')
    expect(localized?.evidence).not.toContain('100 °C')
  })
})
