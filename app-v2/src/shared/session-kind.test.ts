import { describe, expect, it } from 'vitest'
import {
  sessionKindForSnapshot,
  sessionKindFromProvider,
  type SimId,
  type SessionKind
} from './telemetry'

describe('provider session normalization', () => {
  it.each([
    ['acc', undefined, 'unknown'],
    ['acc', 1, 'qualify'],
    ['acc', 2, 'race'],
    ['acc', 3, 'hotlap'],
    ['acc', 4, 'time-attack'],
    ['acc', 5, 'drift'],
    ['acc', 6, 'drag'],
    ['ac', 1, 'qualify'],
    ['ac', 2, 'race'],
    ['ac', 6, 'drag'],
    ['ams2', 3, 'qualify'],
    ['ams2', 4, 'warmup'],
    ['ams2', 5, 'race'],
    ['ams2', 6, 'time-attack'],
    ['lmu', 'Qualify', 'qualify'],
    ['lmu', 'Race', 'race'],
    ['iracing', 'Lone Qualify', 'qualify'],
    ['iracing', 'Race', 'race'],
    ['none', 'Drag Race', 'drag']
  ] as Array<[SimId, unknown, SessionKind]>)(
    'normalizes %s session %j to %s',
    (sim, raw, expected) => {
      expect(sessionKindFromProvider(sim, raw)).toBe(expected)
    }
  )

  it('prefers the canonical provider field over ambiguous raw session text', () => {
    expect(
      sessionKindForSnapshot({
        sim: 'acc',
        sessionType: undefined,
        sessionKind: 'qualify'
      })
    ).toBe('qualify')
    expect(
      sessionKindForSnapshot({
        sim: 'ams2',
        sessionType: '3',
        sessionKind: 'race'
      })
    ).toBe('race')
  })
})
