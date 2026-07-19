import { describe, expect, it } from 'vitest'
import { navSections } from './navModel'

describe('Streaming navigation', () => {
  it('exposes Streaming as its own top-level Drive view beside Dashboards', () => {
    const drive = navSections.find((section) => section.title === 'Drive')
    expect(drive?.viewIds).toContain('dashboards')
    expect(drive?.viewIds).toContain('streaming')
    expect(drive?.viewIds.indexOf('streaming')).toBe((drive?.viewIds.indexOf('dashboards') ?? -2) + 1)
  })
})
