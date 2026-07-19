import { describe, expect, it } from 'vitest'
import { navSections } from './navModel'

describe('rig preflight navigation', () => {
  it('places the evidence-backed preflight at the front of Hardware', () => {
    const hardware = navSections.find((section) => section.title === 'Hardware')
    expect(hardware?.viewIds[0]).toBe('rig-preflight')
    expect(hardware?.viewIds).toContain('devices')
  })
})

describe('Streaming navigation', () => {
  it('exposes Streaming as its own top-level Drive view beside Dashboards', () => {
    const drive = navSections.find((section) => section.title === 'Drive')
    expect(drive?.viewIds).toContain('dashboards')
    expect(drive?.viewIds).toContain('streaming')
    expect(drive?.viewIds.indexOf('streaming')).toBe((drive?.viewIds.indexOf('dashboards') ?? -2) + 1)
  })
})
