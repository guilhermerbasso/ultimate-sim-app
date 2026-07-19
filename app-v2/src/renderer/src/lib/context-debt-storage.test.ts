import { describe, expect, it } from 'vitest'
import type { ContextDebtReport } from '../../../shared/context-debt'
import {
  CONTEXT_DEBT_STORAGE_KEY,
  acceptedContextDebtSuggestionIds,
  createEmptyContextDebtExperimentState,
  currentContextDebtDecisions,
  readContextDebtExperimentState,
  recordContextDebtDecision,
  recordContextDebtRun,
  writeContextDebtExperimentState,
  type ContextDebtStorage
} from './context-debt-storage'

function report(fingerprint = 'cdm-a'): Pick<ContextDebtReport, 'profile' | 'fingerprint'> {
  return {
    profile: { key: 'race:a', name: 'Race A', source: 'race-profile' },
    fingerprint
  }
}

function memoryStorage(): { storage: ContextDebtStorage; values: Map<string, string> } {
  const values = new Map<string, string>()
  return {
    values,
    storage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value)
      }
    }
  }
}

describe('SP-07 local experiment persistence', () => {
  it('records user rejection as an explicit disposition, never as an accepted change', () => {
    const next = recordContextDebtDecision(
      createEmptyContextDebtExperimentState(),
      report(),
      'trim-audio:threshold',
      'rejected',
      100
    )

    expect(currentContextDebtDecisions(next, report())).toEqual({
      'trim-audio:threshold': {
        decision: 'rejected',
        fingerprint: 'cdm-a',
        decidedAt: 100
      }
    })
    expect(acceptedContextDebtSuggestionIds(next, report())).toEqual([])
  })

  it('survives restart with decisions and run metrics, but persists no active preview', () => {
    const { storage, values } = memoryStorage()
    let state = recordContextDebtRun(createEmptyContextDebtExperimentState(), report(), 50)
    state = recordContextDebtDecision(state, report(), 'dedupe-route:a', 'accepted', 75)
    writeContextDebtExperimentState(state, storage)

    const raw = values.get(CONTEXT_DEBT_STORAGE_KEY)
    expect(raw).toBeTruthy()
    expect(raw).not.toContain('preview')

    const afterRestart = readContextDebtExperimentState(storage)
    expect(afterRestart.profiles['race:a']?.runs).toBe(1)
    expect(acceptedContextDebtSuggestionIds(afterRestart, report())).toEqual(['dedupe-route:a'])
  })

  it('does not reuse a rejection after the same profile configuration changes', () => {
    const state = recordContextDebtDecision(
      createEmptyContextDebtExperimentState(),
      report('cdm-old'),
      'trim-cue:fuel',
      'rejected',
      100
    )
    expect(currentContextDebtDecisions(state, report('cdm-new'))).toEqual({})
  })

  it('fails closed to empty local state when restart data is corrupt', () => {
    const { storage, values } = memoryStorage()
    values.set(CONTEXT_DEBT_STORAGE_KEY, '{not-json')
    expect(readContextDebtExperimentState(storage)).toEqual(createEmptyContextDebtExperimentState())
  })
})
