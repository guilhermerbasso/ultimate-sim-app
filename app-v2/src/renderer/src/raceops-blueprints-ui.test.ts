import { describe, expect, it } from 'vitest'
import { tt, translateView } from './i18n'
import { navSections } from './navigation/navModel'
import { viewRegistry } from './views/registry'

describe('RaceOps blueprints UI registration', () => {
  it('registers the view in navigation with localized metadata', () => {
    const view = viewRegistry.find((candidate) => candidate.id === 'raceops-blueprints')
    expect(view).toBeDefined()
    expect(navSections.some((section) => section.viewIds.includes('raceops-blueprints'))).toBe(true)
    expect(view ? translateView(view, 'pt-BR').label : '').toBe('Blueprints RaceOps')
  })

  it('provides localized trust-gate and offline-cache copy', () => {
    expect(tt('en', 'blueprints.executionDisabled')).toContain('Wasmtime')
    expect(tt('pt-BR', 'blueprints.offlineCache')).toContain('cache verificado')
  })
})
