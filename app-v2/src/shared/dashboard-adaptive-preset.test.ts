import { describe, expect, it } from 'vitest'
import type { Dashboard } from './dashboards'
import type { TelemetrySnapshot } from './telemetry'
import { conceptForElement } from './dashboard-nl'
import { applyAdaptivePlan, planAdaptiveDashboard } from './dashboard-adaptive'
import {
  ADAPTIVE_DASHBOARD_ID,
  ADAPTIVE_DASHBOARD_PRESET,
  ADAPTIVE_MARKER,
  createAdaptiveDashboardPreset,
  isAdaptiveDashboard
} from './dashboard-adaptive-preset'

function raceSnap(overrides: Partial<TelemetrySnapshot> = {}): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp: 1_000,
    speedKmh: 180,
    rpm: 7000,
    gear: 4,
    throttle: 1,
    brake: 0,
    clutch: 0,
    sessionType: 'Race',
    currentLap: 5,
    ...overrides
  }
}

describe('ADAPTIVE_DASHBOARD_PRESET', () => {
  it('is a valid Dashboard with the stable id and non-empty unique elements', () => {
    const d = ADAPTIVE_DASHBOARD_PRESET
    expect(d.id).toBe(ADAPTIVE_DASHBOARD_ID)
    expect(d.width).toBeGreaterThan(0)
    expect(d.height).toBeGreaterThan(0)
    expect(d.elements.length).toBeGreaterThan(8)
    const ids = d.elements.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every element resolves to an adaptive concept so the engine can re-rank it', () => {
    for (const el of ADAPTIVE_DASHBOARD_PRESET.elements) {
      expect(conceptForElement(el), `concept for ${el.type}`).toBeTruthy()
    }
  })

  it('covers the key race concepts (position, fuel, tyres, gaps via position, pit, flags)', () => {
    const concepts = new Set(ADAPTIVE_DASHBOARD_PRESET.elements.map((el) => conceptForElement(el)))
    for (const c of ['position', 'fuel', 'tyres', 'delta', 'pit', 'flags', 'relatives'] as const) {
      expect(concepts.has(c), `missing ${c}`).toBe(true)
    }
  })

  it('factory returns a fresh, deep-equal object (no shared mutable state)', () => {
    const a = createAdaptiveDashboardPreset()
    const b = createAdaptiveDashboardPreset()
    expect(a).not.toBe(b)
    expect(a.elements).not.toBe(b.elements)
    expect(a).toEqual(b)
  })
})

describe('isAdaptiveDashboard', () => {
  it('recognises the shipped preset', () => {
    expect(isAdaptiveDashboard(ADAPTIVE_DASHBOARD_PRESET)).toBe(true)
  })

  it('recognises a duplicated copy by the description marker even with a new id', () => {
    const dup: Dashboard = { ...createAdaptiveDashboardPreset(), id: 'dash-user-copy-123' }
    expect(dup.description).toContain(ADAPTIVE_MARKER)
    expect(isAdaptiveDashboard(dup)).toBe(true)
  })

  it('returns false for a normal dashboard and for null', () => {
    expect(isAdaptiveDashboard({ id: 'gt3_cup_ddu_fuel', description: 'normal preset' })).toBe(false)
    expect(isAdaptiveDashboard(null)).toBe(false)
    expect(isAdaptiveDashboard(undefined)).toBe(false)
  })
})

describe('adaptive runtime re-ranking on the preset', () => {
  it('hides race-irrelevant widgets and emphasizes race-focus widgets', () => {
    const plan = planAdaptiveDashboard(raceSnap())
    const applied = applyAdaptivePlan(ADAPTIVE_DASHBOARD_PRESET.elements, plan)

    const byId = new Map(applied.map((r) => [r.element.id, r]))
    // Race phase emphasizes position/gaps/fuel and hides enginetemps/inputs.
    expect(byId.get('adp-position')?.emphasis).toBe('emphasize')
    expect(byId.get('adp-fuel')?.emphasis).toBe('emphasize')
    expect(byId.get('adp-temps')?.emphasis).toBe('hide')
    expect(byId.get('adp-temps')?.element.visible).toBe(false)
    // Emphasized elements get a zIndex boost; hidden ones are not boosted.
    expect((byId.get('adp-position')?.element.style.zIndex ?? 0)).toBeGreaterThan(0)
  })

  it('does not mutate the preset elements', () => {
    const before = JSON.stringify(ADAPTIVE_DASHBOARD_PRESET.elements)
    applyAdaptivePlan(ADAPTIVE_DASHBOARD_PRESET.elements, planAdaptiveDashboard(raceSnap()))
    expect(JSON.stringify(ADAPTIVE_DASHBOARD_PRESET.elements)).toBe(before)
  })
})
