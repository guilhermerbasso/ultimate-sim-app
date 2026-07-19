import { describe, expect, it } from 'vitest'
import { DEFAULT_ALERTS_CONFIG } from '../../../shared/alerts'
import { DEFAULT_COACH_CONFIG } from '../../../shared/coach'
import { DEFAULT_HAPTICS_CONFIG } from '../../../shared/haptics'
import { DEFAULT_HAPTICS_ZONAL_CONFIG } from '../../../shared/haptics-zonal'
import { DEFAULT_SOUNDS_CONFIG } from '../../../shared/soundshift'
import { DEFAULT_SPOTTER_CONFIG } from '../../../shared/spotter'
import { DEFAULT_SPOTTER_3D_CONFIG } from '../../../shared/spotter3d'
import { recoverContextDebtSource, type ContextDebtRecoverableSnapshot } from './context-debt-recovery'

describe('context-debt source recovery', () => {
  it('marks a source available only after a valid recovery event', () => {
    const current: ContextDebtRecoverableSnapshot = {
      alerts: null,
      sourceAvailability: { alerts: false }
    }
    const recovered = recoverContextDebtSource(current, 'alerts', DEFAULT_ALERTS_CONFIG)

    expect(recovered).not.toBe(current)
    expect(recovered?.alerts).toEqual(DEFAULT_ALERTS_CONFIG)
    expect(recovered?.alerts).not.toBe(DEFAULT_ALERTS_CONFIG)
    expect(recovered?.sourceAvailability.alerts).toBe(true)
  })

  it('accepts valid recovery events from every streamed source family', () => {
    const events = [
      ['sounds', DEFAULT_SOUNDS_CONFIG],
      ['haptics', DEFAULT_HAPTICS_CONFIG],
      ['zonalHaptics', DEFAULT_HAPTICS_ZONAL_CONFIG],
      ['spotter', DEFAULT_SPOTTER_CONFIG],
      ['spotter3d', DEFAULT_SPOTTER_3D_CONFIG],
      ['coach', DEFAULT_COACH_CONFIG]
    ] as const

    for (const [source, payload] of events) {
      const current: ContextDebtRecoverableSnapshot = {
        sourceAvailability: { [source]: false }
      }
      const recovered = recoverContextDebtSource(current, source, payload)
      expect(recovered?.sourceAvailability[source]).toBe(true)
    }
  })

  it('ignores malformed nested recovery payloads and preserves the unavailable state', () => {
    const current: ContextDebtRecoverableSnapshot = {
      alerts: null,
      sourceAvailability: { alerts: false }
    }
    const malformed = {
      ...DEFAULT_ALERTS_CONFIG,
      flags: {
        ...DEFAULT_ALERTS_CONFIG.flags,
        outputs: [{ kind: 'serial', template: 42 }]
      }
    }

    expect(recoverContextDebtSource(current, 'alerts', malformed)).toBe(current)
    expect(current.sourceAvailability.alerts).toBe(false)
  })
})
