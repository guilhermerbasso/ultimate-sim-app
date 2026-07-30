import { describe, expect, it } from 'vitest'
import {
  applyRaceProfileSections,
  describeRaceProfileFailure,
  type RaceProfileSection
} from './race-profile-apply'

// Models the subsystems a race profile writes to. `failOnWrite` makes one of them
// reject, which is the situation the audit describes: an apply that stops half-way and
// leaves the app in a state that matches no profile at all.
function subsystem(id: string, initial: unknown, options: { failOnWrite?: boolean; failOnRead?: boolean; failOnRestore?: boolean } = {}) {
  const state = { id, value: initial, writes: 0 }
  let written = false
  const section: RaceProfileSection<unknown> & { state: typeof state } = {
    id,
    value: `${id}:new`,
    state,
    read: () => {
      if (options.failOnRead) throw new Error(`${id} read failed`)
      return state.value
    },
    write: (value) => {
      state.writes += 1
      const isRestore = written
      if (options.failOnWrite && !isRestore) throw new Error(`${id} write failed`)
      if (options.failOnRestore && isRestore) throw new Error(`${id} restore failed`)
      written = true
      state.value = value
    }
  }
  return section
}

describe('race profile application is atomic (P1-09)', () => {
  it('commits every section when all of them succeed', async () => {
    const oled = subsystem('oled', 'oled:old')
    const overlays = subsystem('overlays', 'overlays:old')
    const alerts = subsystem('alerts', 'alerts:old')

    const result = await applyRaceProfileSections([oled, overlays, alerts])

    expect(result.ok).toBe(true)
    expect(result.applied).toEqual(['oled', 'overlays', 'alerts'])
    expect(oled.state.value).toBe('oled:new')
    expect(overlays.state.value).toBe('overlays:new')
    expect(alerts.state.value).toBe('alerts:new')
  })

  it('rolls back the already-applied sections when a later one fails', async () => {
    const oled = subsystem('oled', 'oled:old')
    const overlays = subsystem('overlays', 'overlays:old')
    const alerts = subsystem('alerts', 'alerts:old', { failOnWrite: true })
    const bindings = subsystem('bindings', 'bindings:old')

    const result = await applyRaceProfileSections([oled, overlays, alerts, bindings])

    expect(result.ok).toBe(false)
    expect(result.failedSection).toBe('alerts')
    // The half-applied state is gone: nothing is left from the new profile.
    expect(oled.state.value).toBe('oled:old')
    expect(overlays.state.value).toBe('overlays:old')
    expect(result.rolledBack).toEqual(['overlays', 'oled'])
    // A section after the failure is never touched at all.
    expect(bindings.state.writes).toBe(0)
    expect(bindings.state.value).toBe('bindings:old')
  })

  it('rolls back in reverse order so dependent sections unwind correctly', async () => {
    const order: string[] = []
    const make = (id: string, fail = false): RaceProfileSection<unknown> => {
      let written = false
      return {
        id,
        value: `${id}:new`,
        read: () => `${id}:old`,
        write: () => {
          if (fail) throw new Error(`${id} failed`)
          if (written) order.push(`restore:${id}`)
          else order.push(`apply:${id}`)
          written = true
        }
      }
    }

    const result = await applyRaceProfileSections([make('a'), make('b'), make('c'), make('d', true)])

    expect(result.ok).toBe(false)
    expect(order).toEqual(['apply:a', 'apply:b', 'apply:c', 'restore:c', 'restore:b', 'restore:a'])
  })

  it('writes NOTHING when a snapshot cannot be taken', async () => {
    const oled = subsystem('oled', 'oled:old')
    const overlays = subsystem('overlays', 'overlays:old', { failOnRead: true })

    const result = await applyRaceProfileSections([oled, overlays])

    expect(result.ok).toBe(false)
    expect(result.failedSection).toBe('overlays')
    expect(oled.state.writes).toBe(0)
    expect(oled.state.value).toBe('oled:old')
  })

  it('reports an INCOMPLETE rollback instead of claiming a clean one', async () => {
    const oled = subsystem('oled', 'oled:old', { failOnRestore: true })
    const alerts = subsystem('alerts', 'alerts:old', { failOnWrite: true })

    const result = await applyRaceProfileSections([oled, alerts])

    expect(result.ok).toBe(false)
    expect(result.rollbackFailed).toEqual(['oled'])
    expect(describeRaceProfileFailure(result)).toContain('Rollback INCOMPLETE')
    expect(describeRaceProfileFailure(result)).toContain('oled')
  })

  it('skips sections the profile does not set, without reading or writing them', async () => {
    const oled = subsystem('oled', 'oled:old')
    const overlays = subsystem('overlays', 'overlays:old')
    overlays.value = undefined

    const result = await applyRaceProfileSections([oled, overlays])

    expect(result.ok).toBe(true)
    expect(result.applied).toEqual(['oled'])
    expect(result.skipped).toEqual(['overlays'])
    expect(overlays.state.writes).toBe(0)
  })

  it('lets a best-effort section fail without aborting or rolling back', async () => {
    const oled = subsystem('oled', 'oled:old')
    const haptics = subsystem('haptics', 'haptics:old', { failOnWrite: true })
    haptics.bestEffort = true
    const alerts = subsystem('alerts', 'alerts:old')

    const result = await applyRaceProfileSections([oled, haptics, alerts])

    expect(result.ok).toBe(true)
    expect(result.degraded).toEqual(['haptics'])
    expect(result.applied).toEqual(['oled', 'alerts'])
    expect(oled.state.value).toBe('oled:new')
    expect(alerts.state.value).toBe('alerts:new')
  })

  it('describes a clean rollback and a no-op failure differently', async () => {
    const oled = subsystem('oled', 'oled:old')
    const alerts = subsystem('alerts', 'alerts:old', { failOnWrite: true })
    const rolled = await applyRaceProfileSections([oled, alerts])
    expect(describeRaceProfileFailure(rolled)).toContain('Previous settings restored')

    const first = subsystem('oled', 'oled:old', { failOnWrite: true })
    const nothing = await applyRaceProfileSections([first])
    expect(describeRaceProfileFailure(nothing)).toContain('Nothing was changed')
  })
})
