import { describe, expect, it } from 'vitest'
import {
  DASHBOARD_BLUEPRINTS,
  DASHBOARD_ARCHETYPES,
  getBlueprint,
  validateBlueprint,
  blueprintConcepts,
  CANVAS_W,
  CANVAS_H
} from './dashboard-blueprints'
import { DASHBOARD_CONCEPTS } from './dashboard-nl'

const KNOWN_CONCEPTS = new Set(DASHBOARD_CONCEPTS.map((c) => c.concept))

describe('blueprint integrity', () => {
  it('exposes one archetype per blueprint', () => {
    expect(DASHBOARD_ARCHETYPES.length).toBe(DASHBOARD_BLUEPRINTS.length)
    expect(new Set(DASHBOARD_ARCHETYPES).size).toBe(DASHBOARD_ARCHETYPES.length)
    expect(DASHBOARD_BLUEPRINTS.length).toBeGreaterThanOrEqual(10)
  })

  it('every blueprint has zero geometry issues (no overlaps, in-canvas)', () => {
    for (const bp of DASHBOARD_BLUEPRINTS) {
      const issues = validateBlueprint(bp)
      expect(issues, `${bp.id}: ${issues.map((i) => i.detail).join('; ')}`).toEqual([])
    }
  })

  it('every slot is inside the canvas bounds', () => {
    for (const bp of DASHBOARD_BLUEPRINTS) {
      for (const slot of bp.slots) {
        expect(slot.x).toBeGreaterThanOrEqual(0)
        expect(slot.y).toBeGreaterThanOrEqual(0)
        expect(slot.x + slot.w).toBeLessThanOrEqual(CANVAS_W)
        expect(slot.y + slot.h).toBeLessThanOrEqual(CANVAS_H)
      }
    }
  })

  it('every slot references a real dashboard concept', () => {
    for (const bp of DASHBOARD_BLUEPRINTS) {
      for (const concept of blueprintConcepts(bp)) {
        expect(KNOWN_CONCEPTS.has(concept), `${bp.id}: unknown concept ${concept}`).toBe(true)
      }
    }
  })

  it('every blueprint has a primary slot for visual hierarchy', () => {
    for (const bp of DASHBOARD_BLUEPRINTS) {
      const hasPrimary = bp.slots.some((s) => s.role === 'primary')
      expect(hasPrimary, `${bp.id} missing a primary slot`).toBe(true)
    }
  })

  it('getBlueprint returns the matching blueprint by id', () => {
    for (const id of DASHBOARD_ARCHETYPES) {
      expect(getBlueprint(id).id).toBe(id)
    }
  })
})
