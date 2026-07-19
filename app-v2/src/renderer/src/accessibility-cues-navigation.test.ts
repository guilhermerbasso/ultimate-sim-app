import { describe, expect, it } from 'vitest'
import { translateView } from './i18n'
import { navSections } from './navigation/navModel'
import { viewRegistry } from './views/registry'

describe('accessibility cue navigation', () => {
  it('registers one discoverable System view with localized metadata', () => {
    const view = viewRegistry.find((candidate) => candidate.id === 'accessibility-cues')
    expect(view).toBeDefined()
    expect(
      navSections.find((section) => section.title === 'System')?.viewIds
    ).toContain('accessibility-cues')

    for (const language of ['en', 'pt-BR', 'es', 'fr', 'de', 'zh', 'ja'] as const) {
      const translated = translateView(view!, language)
      expect(translated.label).not.toBe('')
      expect(translated.description).not.toBe('')
    }
  })
})
