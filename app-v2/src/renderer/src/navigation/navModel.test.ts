import { describe, expect, it } from 'vitest'
import { navSections } from './navModel'

describe('rig preflight navigation', () => {
  it('places the evidence-backed preflight at the front of Hardware', () => {
    const hardware = navSections.find((section) => section.title === 'Hardware')
    expect(hardware?.viewIds[0]).toBe('rig-preflight')
    expect(hardware?.viewIds).toContain('devices')
  })
})
