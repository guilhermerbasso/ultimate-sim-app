import { describe, expect, it } from 'vitest'
import { tt, translateView } from './i18n'
import { navSections } from './navigation/navModel'
import {
  isCurrentRaceOpsResponse,
  parseRaceOpsNumberParameterInput,
  raceOpsCatalogEntryKey
} from './views/RaceOpsBlueprintsView'
import { viewRegistry } from './views/registry'
import type {
  RaceOpsBlueprintCatalogEntry,
  RaceOpsBlueprintDryRunResponse,
  RaceOpsNumberParameter
} from '../../shared/raceops-blueprints'

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

  it('keys selections by feed, id, version, and manifest hash', () => {
    const base = {
      feedId: 'feed',
      id: 'blueprint',
      version: '1.0.0',
      manifestSha256: 'a'.repeat(64)
    } as RaceOpsBlueprintCatalogEntry
    expect(raceOpsCatalogEntryKey(base)).not.toBe(
      raceOpsCatalogEntryKey({ ...base, version: '2.0.0' })
    )
    expect(raceOpsCatalogEntryKey(base)).not.toBe(
      raceOpsCatalogEntryKey({ ...base, manifestSha256: 'b'.repeat(64) })
    )
  })

  it('rejects stale responses after the request fingerprint changes', () => {
    const response = {
      requestFingerprint: 'raceops-request-old'
    } as RaceOpsBlueprintDryRunResponse
    expect(isCurrentRaceOpsResponse('raceops-request-old', response)).toBe(true)
    expect(isCurrentRaceOpsResponse('raceops-request-new', response)).toBe(false)
    expect(isCurrentRaceOpsResponse('', response)).toBe(false)
  })

  it('restores the default instead of coercing an empty number input to zero', () => {
    const parameter: RaceOpsNumberParameter = {
      id: 'pit-window-laps',
      label: 'Pit window laps',
      type: 'number',
      default: 5,
      min: 1,
      max: 10,
      step: 1
    }

    expect(parseRaceOpsNumberParameterInput(parameter, '')).toBe(5)
    expect(parseRaceOpsNumberParameterInput(parameter, '7')).toBe(7)
    expect(parseRaceOpsNumberParameterInput(parameter, 'not-a-number')).toBeUndefined()
  })
})
