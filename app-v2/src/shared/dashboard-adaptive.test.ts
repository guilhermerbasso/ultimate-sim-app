import { describe, expect, it } from 'vitest'
import type { TelemetrySnapshot } from './telemetry'
import type { DashboardElement } from './dashboards'
import {
  applyAdaptivePlan,
  emphasizedConceptsForPhase,
  planAdaptiveDashboard,
  resolveActiveFrame,
  resolveAdaptivePhase,
  resolveAdaptiveRuntime,
  resolveDashboardBlink,
  resolveUserElementRules,
  sanitizeFrameElements,
  type AdaptivePhase
} from './dashboard-adaptive'
import type { DashboardAdaptiveConfig } from './dashboards'
import { DASHBOARD_CONCEPT_LIST } from './dashboard-nl'

function snap(overrides: Partial<TelemetrySnapshot> = {}): TelemetrySnapshot {
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
    ...overrides
  }
}

const ALL_PHASES: AdaptivePhase[] = ['practice', 'qualifying', 'race', 'pit', 'formation', 'warmup', 'unknown']

describe('resolveAdaptivePhase', () => {
  it('returns unknown when disconnected or null', () => {
    expect(resolveAdaptivePhase(null)).toBe('unknown')
    expect(resolveAdaptivePhase(snap({ connected: false }))).toBe('unknown')
  })

  it('detects pit from pit road / stall / limiter (overrides session kind)', () => {
    expect(resolveAdaptivePhase(snap({ sessionType: 'Race', currentLap: 5, onPitRoad: true }))).toBe('pit')
    expect(resolveAdaptivePhase(snap({ sessionType: 'Qualify', pit: { repairNeeded: false, optRepairNeeded: false, pitsOpen: true, inPitStall: true } }))).toBe('pit')
    expect(resolveAdaptivePhase(snap({ sessionType: 'Practice', pitLimiter: true }))).toBe('pit')
  })

  it('detects race vs formation by lap counter', () => {
    expect(resolveAdaptivePhase(snap({ sessionType: 'Race', currentLap: 3 }))).toBe('race')
    expect(resolveAdaptivePhase(snap({ sessionType: 'Race', currentLap: 0 }))).toBe('formation')
  })

  it('maps qualify / practice / warmup session kinds', () => {
    expect(resolveAdaptivePhase(snap({ sessionType: 'Open Qualify', currentLap: 2 }))).toBe('qualifying')
    expect(resolveAdaptivePhase(snap({ sessionType: 'Practice', currentLap: 2 }))).toBe('practice')
    expect(resolveAdaptivePhase(snap({ sessionType: 'Warmup', currentLap: 1 }))).toBe('warmup')
  })

  it('treats ACC hotlap as qualifying-like for adaptive layout', () => {
    const snapshot = snap({
      sim: 'acc',
      sessionType: '3',
      sessionKind: 'hotlap',
      currentLap: 2
    })
    expect(resolveAdaptivePhase(snapshot)).toBe('qualifying')
    const plan = planAdaptiveDashboard(snapshot)
    expect(plan.phase).toBe('qualifying')
    expect(plan.byConcept.delta).toBe('emphasize')
    expect(plan.byConcept.laptime).toBe('emphasize')
  })

  it('returns unknown for an unrecognised session type', () => {
    expect(resolveAdaptivePhase(snap({ sessionType: 'Lobby', currentLap: 1 }))).toBe('unknown')
  })
})

describe('planAdaptiveDashboard — phase rules', () => {
  it('qualifying focuses on delta + laptime and hides fuel/position', () => {
    const plan = planAdaptiveDashboard(snap({ sessionType: 'Qualify', currentLap: 2 }))
    expect(plan.phase).toBe('qualifying')
    expect(plan.byConcept.delta).toBe('emphasize')
    expect(plan.byConcept.laptime).toBe('emphasize')
    expect(plan.byConcept.fuel).toBe('hide')
    expect(plan.byConcept.position).toBe('hide')
  })

  it('race focuses on position/gaps/fuel', () => {
    const plan = planAdaptiveDashboard(snap({ sessionType: 'Race', currentLap: 5 }))
    expect(plan.phase).toBe('race')
    expect(plan.byConcept.position).toBe('emphasize')
    expect(plan.byConcept.gaps).toBe('emphasize')
    expect(plan.byConcept.fuel).toBe('emphasize')
  })

  it('pit focuses on pit/tyres/fuel and hides timing', () => {
    const plan = planAdaptiveDashboard(snap({ sessionType: 'Race', currentLap: 5, onPitRoad: true }))
    expect(plan.phase).toBe('pit')
    expect(plan.byConcept.pit).toBe('emphasize')
    expect(plan.byConcept.tyres).toBe('emphasize')
    expect(plan.byConcept.delta).toBe('hide')
    expect(plan.byConcept.laptime).toBe('hide')
  })

  it('honours an explicit phase override', () => {
    const plan = planAdaptiveDashboard(snap({ sessionType: 'Race', currentLap: 5 }), { phase: 'practice' })
    expect(plan.phase).toBe('practice')
    expect(plan.byConcept.tyres).toBe('emphasize')
  })

  it('reason mentions the phase', () => {
    expect(planAdaptiveDashboard(snap({ sessionType: 'Race', currentLap: 5 })).reason).toContain('Race')
  })
})

describe('planAdaptiveDashboard — partition invariant', () => {
  it('every plan partitions all concepts into emphasize/show/hide', () => {
    for (const phase of ALL_PHASES) {
      const plan = planAdaptiveDashboard(snap(), { phase, dynamic: false })
      const union = [...plan.emphasize, ...plan.show, ...plan.hide].sort()
      expect(union).toEqual([...DASHBOARD_CONCEPT_LIST].sort())
      // disjoint
      expect(plan.emphasize.some((c) => plan.hide.includes(c))).toBe(false)
      expect(plan.emphasize.some((c) => plan.show.includes(c))).toBe(false)
      expect(plan.show.some((c) => plan.hide.includes(c))).toBe(false)
      // byConcept consistent with the arrays
      for (const c of plan.emphasize) expect(plan.byConcept[c]).toBe('emphasize')
      for (const c of plan.hide) expect(plan.byConcept[c]).toBe('hide')
      for (const c of plan.show) expect(plan.byConcept[c]).toBe('show')
    }
  })

  it('unknown phase shows everything (no emphasize/hide)', () => {
    const plan = planAdaptiveDashboard(snap({ sessionType: 'Lobby' }), { dynamic: false })
    expect(plan.phase).toBe('unknown')
    expect(plan.emphasize).toEqual([])
    expect(plan.hide).toEqual([])
    expect(plan.show.length).toBe(DASHBOARD_CONCEPT_LIST.length)
  })
})

describe('planAdaptiveDashboard — dynamic overrides', () => {
  it('promotes flags to emphasize even when the phase hides them', () => {
    const flags = { green: false, yellow: true, blue: false, white: false, checkered: false, red: false, black: false, meatball: false, repair: false, disqualify: false, greenWhiteCheckered: false }
    const base = planAdaptiveDashboard(snap({ sessionType: 'Practice', currentLap: 2 }), { dynamic: false })
    expect(base.byConcept.flags).toBe('hide')
    const plan = planAdaptiveDashboard(snap({ sessionType: 'Practice', currentLap: 2, flags }))
    expect(plan.byConcept.flags).toBe('emphasize')
    expect(plan.reason).toContain('flag')
  })

  it('promotes weather when wet', () => {
    const plan = planAdaptiveDashboard(snap({ sessionType: 'Race', currentLap: 5, isRaining: true }))
    expect(plan.byConcept.weather).toBe('emphasize')
  })

  it('promotes fuel when low even in qualifying', () => {
    const plan = planAdaptiveDashboard(snap({ sessionType: 'Qualify', currentLap: 2, fuelLiters: 2, fuelPerLap: 1.5 }))
    expect(plan.byConcept.fuel).toBe('emphasize')
  })
})

describe('applyAdaptivePlan', () => {
  function el(id: string, type: string, binding?: string): DashboardElement {
    return { id, type: type as DashboardElement['type'], x: 0, y: 0, w: 100, h: 100, binding, style: {} }
  }

  it('hides hidden concepts, boosts emphasized z-index, leaves others', () => {
    const plan = planAdaptiveDashboard(snap({ sessionType: 'Qualify', currentLap: 2 }), { dynamic: false })
    const elements = [el('a', 'delta-clean'), el('b', 'fuelstint'), el('c', 'rect')]
    const out = applyAdaptivePlan(elements, plan)

    const delta = out.find((o) => o.element.id === 'a')!
    const fuel = out.find((o) => o.element.id === 'b')!
    const rect = out.find((o) => o.element.id === 'c')!

    expect(delta.emphasis).toBe('emphasize')
    expect(delta.element.style.zIndex).toBe(1000)
    expect(fuel.emphasis).toBe('hide')
    expect(fuel.element.visible).toBe(false)
    expect(rect.concept).toBeUndefined()
    expect(rect.element).toBe(elements[2]) // untouched reference
  })

  it('does not mutate the input elements', () => {
    const plan = planAdaptiveDashboard(snap({ sessionType: 'Qualify', currentLap: 2 }), { dynamic: false })
    const elements = [el('a', 'fuelstint')]
    applyAdaptivePlan(elements, plan)
    expect(elements[0].visible).toBeUndefined()
    expect(elements[0].style.zIndex).toBeUndefined()
  })
})

describe('emphasizedConceptsForPhase', () => {
  it('returns a fresh copy of the phase emphasis list', () => {
    const a = emphasizedConceptsForPhase('race')
    a.push('weather')
    expect(emphasizedConceptsForPhase('race')).not.toContain('weather')
  })
})

describe('user adaptive rules — resolveUserElementRules', () => {
  function cfg(rules: DashboardAdaptiveConfig['rules'], enabled = true): DashboardAdaptiveConfig {
    return { enabled, rules }
  }

  it('returns empty when disabled or no rules', () => {
    expect(resolveUserElementRules(null, new Set(['green'])).size).toBe(0)
    expect(resolveUserElementRules(cfg([], false), new Set(['green'])).size).toBe(0)
    expect(resolveUserElementRules(cfg(undefined), new Set(['green'])).size).toBe(0)
  })

  it('only applies rules for active moments', () => {
    const config = cfg([
      { moment: 'green', elements: { a: { visible: true } } },
      { moment: 'last-lap', elements: { b: { visible: false } } }
    ])
    const map = resolveUserElementRules(config, new Set(['green']))
    expect(map.get('a')?.visible).toBe(true)
    expect(map.has('b')).toBe(false)
  })

  it('skips disabled rules', () => {
    const config = cfg([{ moment: 'green', enabled: false, elements: { a: { visible: true } } }])
    expect(resolveUserElementRules(config, new Set(['green'])).size).toBe(0)
  })

  it('later active rule wins per field (array-order precedence)', () => {
    const config = cfg([
      { moment: 'green', elements: { a: { visible: true, emphasis: 1.2 } } },
      { moment: 'last-lap', elements: { a: { visible: false, blink: { color: 'critical' } } } }
    ])
    const map = resolveUserElementRules(config, new Set(['green', 'last-lap']))
    const a = map.get('a')!
    expect(a.visible).toBe(false) // later rule overrides visible
    expect(a.emphasis).toBe(1.2) // earlier rule kept where later did not set
    expect(a.blink?.color).toBe('critical')
  })
})

describe('user adaptive rules — resolveDashboardBlink', () => {
  it('returns undefined when no active rule sets blinkDashboard', () => {
    const config: DashboardAdaptiveConfig = { enabled: true, rules: [{ moment: 'green', elements: {} }] }
    expect(resolveDashboardBlink(config, new Set(['green']))).toBeUndefined()
  })

  it('later active blinkDashboard wins', () => {
    const config: DashboardAdaptiveConfig = {
      enabled: true,
      rules: [
        { moment: 'green', blinkDashboard: { color: 'good', hz: 1 } },
        { moment: 'last-lap', blinkDashboard: { color: 'critical', hz: 3 } }
      ]
    }
    expect(resolveDashboardBlink(config, new Set(['green', 'last-lap']))?.color).toBe('critical')
    expect(resolveDashboardBlink(config, new Set(['green']))?.color).toBe('good')
  })
})

describe('user adaptive rules — resolveAdaptiveRuntime', () => {
  function el(id: string, type: string): DashboardElement {
    return { id, type: type as DashboardElement['type'], x: 0, y: 0, w: 100, h: 100, style: {} }
  }

  it('user visible=true un-hides a plan-hidden element (syncs element.visible)', () => {
    const plan = planAdaptiveDashboard(snap({ sessionType: 'Qualify', currentLap: 2 }), { dynamic: false })
    const elements = [el('fuel', 'fuelstint')]
    const config: DashboardAdaptiveConfig = {
      enabled: true,
      rules: [{ moment: 'qualifying', elements: { fuel: { visible: true } } }]
    }
    const res = resolveAdaptiveRuntime(elements, plan, config, new Set(['qualifying']))
    const fuel = res.elements.find((e) => e.element.id === 'fuel')!
    expect(fuel.hidden).toBe(false)
    expect(fuel.element.visible).toBe(true) // synced so ElementSwitcher renders it
    expect(fuel.user?.visible).toBe(true)
  })

  it('user visible=false hides a plan-visible element', () => {
    const plan = planAdaptiveDashboard(snap({ sessionType: 'Qualify', currentLap: 2 }), { dynamic: false })
    const elements = [el('delta', 'delta-clean')]
    const config: DashboardAdaptiveConfig = {
      enabled: true,
      rules: [{ moment: 'qualifying', elements: { delta: { visible: false } } }]
    }
    const res = resolveAdaptiveRuntime(elements, plan, config, new Set(['qualifying']))
    const delta = res.elements.find((e) => e.element.id === 'delta')!
    expect(delta.hidden).toBe(true)
  })

  it('carries emphasis multiplier + dashboard blink through', () => {
    const plan = planAdaptiveDashboard(snap({ sessionType: 'Race', currentLap: 5 }), { dynamic: false })
    const elements = [el('delta', 'delta-clean')]
    const config: DashboardAdaptiveConfig = {
      enabled: true,
      rules: [
        { moment: 'green', elements: { delta: { emphasis: 1.5 } }, blinkDashboard: { color: 'caution' } }
      ]
    }
    const res = resolveAdaptiveRuntime(elements, plan, config, new Set(['green']))
    const delta = res.elements.find((e) => e.element.id === 'delta')!
    expect(delta.user?.emphasis).toBe(1.5)
    expect(res.dashboardBlink?.color).toBe('caution')
  })

  it('no user config → built-in behaviour preserved (back-compat)', () => {
    const plan = planAdaptiveDashboard(snap({ sessionType: 'Qualify', currentLap: 2 }), { dynamic: false })
    const elements = [el('fuel', 'fuelstint'), el('delta', 'delta-clean')]
    const res = resolveAdaptiveRuntime(elements, plan, null, new Set(['qualifying']))
    expect(res.elements.find((e) => e.element.id === 'fuel')!.hidden).toBe(true)
    expect(res.elements.find((e) => e.element.id === 'delta')!.hidden).toBe(false)
    expect(res.dashboardBlink).toBeUndefined()
  })

  it('does not mutate input elements', () => {
    const plan = planAdaptiveDashboard(snap({ sessionType: 'Qualify', currentLap: 2 }), { dynamic: false })
    const elements = [el('fuel', 'fuelstint')]
    const config: DashboardAdaptiveConfig = {
      enabled: true,
      rules: [{ moment: 'qualifying', elements: { fuel: { visible: true } } }]
    }
    resolveAdaptiveRuntime(elements, plan, config, new Set(['qualifying']))
    expect(elements[0].visible).toBeUndefined()
  })
})

describe('per-moment FRAME — resolveActiveFrame + resolveAdaptiveRuntime swap', () => {
  function el(id: string, type: string): DashboardElement {
    return { id, type: type as DashboardElement['type'], x: 0, y: 0, w: 100, h: 100, style: {} }
  }
  const baseElements = [el('base-a', 'speed-clean'), el('base-b', 'delta-clean')]
  const plan = planAdaptiveDashboard(snap({ sessionType: 'Race', currentLap: 5 }), { dynamic: false })

  it('resolveActiveFrame returns undefined with no config / disabled / no active frame', () => {
    expect(resolveActiveFrame(null, new Set(['green']))).toBeUndefined()
    const cfg: DashboardAdaptiveConfig = {
      enabled: false,
      rules: [{ moment: 'green', frame: { elements: [el('f', 'speed-clean')] } }]
    }
    expect(resolveActiveFrame(cfg, new Set(['green']))).toBeUndefined()
    const cfg2: DashboardAdaptiveConfig = {
      enabled: true,
      rules: [{ moment: 'green', frame: { elements: [el('f', 'speed-clean')] } }]
    }
    expect(resolveActiveFrame(cfg2, new Set(['last-lap']))).toBeUndefined()
  })

  it('ignores an empty frame (never blanks the board)', () => {
    const cfg: DashboardAdaptiveConfig = { enabled: true, rules: [{ moment: 'green', frame: { elements: [] } }] }
    expect(resolveActiveFrame(cfg, new Set(['green']))).toBeUndefined()
  })

  it('skips disabled rules when resolving the frame', () => {
    const cfg: DashboardAdaptiveConfig = {
      enabled: true,
      rules: [{ moment: 'green', enabled: false, frame: { elements: [el('f', 'speed-clean')] } }]
    }
    expect(resolveActiveFrame(cfg, new Set(['green']))).toBeUndefined()
  })

  it('last active frame wins (array-order precedence)', () => {
    const cfg: DashboardAdaptiveConfig = {
      enabled: true,
      rules: [
        { moment: 'green', frame: { elements: [el('frame-green', 'speed-clean')] } },
        { moment: 'last-lap', frame: { elements: [el('frame-last', 'delta-clean')], bg: '#111111' } }
      ]
    }
    const frame = resolveActiveFrame(cfg, new Set(['green', 'last-lap']))
    expect(frame?.elements[0].id).toBe('frame-last')
    expect(frame?.bg).toBe('#111111')
    // Only the first moment active → its frame wins.
    expect(resolveActiveFrame(cfg, new Set(['green']))?.elements[0].id).toBe('frame-green')
  })

  it('runtime swaps the element list to the active frame (full layout swap)', () => {
    const cfg: DashboardAdaptiveConfig = {
      enabled: true,
      rules: [{ moment: 'green', frame: { elements: [el('frame-only', 'speed-clean')], bg: '#222222' } }]
    }
    const res = resolveAdaptiveRuntime(baseElements, plan, cfg, new Set(['green']))
    expect(res.frameActive).toBe(true)
    expect(res.frameBg).toBe('#222222')
    const ids = res.elements.map((e) => e.element.id)
    expect(ids).toContain('frame-only')
    expect(ids).not.toContain('base-a')
    expect(ids).not.toContain('base-b')
  })

  it('light element rules + blink still apply ON TOP of the frame', () => {
    const cfg: DashboardAdaptiveConfig = {
      enabled: true,
      rules: [
        {
          moment: 'green',
          frame: { elements: [el('frame-x', 'speed-clean')] },
          elements: { 'frame-x': { visible: false } },
          blinkDashboard: { color: 'critical' }
        }
      ]
    }
    const res = resolveAdaptiveRuntime(baseElements, plan, cfg, new Set(['green']))
    expect(res.frameActive).toBe(true)
    expect(res.elements.find((e) => e.element.id === 'frame-x')!.hidden).toBe(true)
    expect(res.dashboardBlink?.color).toBe('critical')
  })

  it('back-compat: no frame anywhere → base elements drive, frameActive false', () => {
    const cfg: DashboardAdaptiveConfig = {
      enabled: true,
      rules: [{ moment: 'green', elements: { 'base-a': { emphasis: 1.4 } } }]
    }
    const res = resolveAdaptiveRuntime(baseElements, plan, cfg, new Set(['green']))
    expect(res.frameActive).toBe(false)
    expect(res.frameBg).toBeUndefined()
    expect(res.elements.map((e) => e.element.id)).toEqual(['base-a', 'base-b'])
  })

  it('does not mutate the frame elements', () => {
    const frameEls = [el('frame-y', 'fuelstint')]
    const cfg: DashboardAdaptiveConfig = { enabled: true, rules: [{ moment: 'qualifying', frame: { elements: frameEls } }] }
    const qPlan = planAdaptiveDashboard(snap({ sessionType: 'Qualify', currentLap: 2 }), { dynamic: false })
    resolveAdaptiveRuntime(baseElements, qPlan, cfg, new Set(['qualifying']))
    expect(frameEls[0].visible).toBeUndefined()
  })

  // ── R20-m2: an active frame is AUTHORITATIVE — the deterministic phase plan
  // must NOT hide widgets the user deliberately placed in that frame. ──────────
  it('R20-m2: phase plan never HIDES authored frame widgets', () => {
    // Qualify HIDES the `fuel` concept; a `fuelstint` placed in the frame must survive.
    const qPlan = planAdaptiveDashboard(snap({ sessionType: 'Qualify', currentLap: 2 }), { dynamic: false })
    const cfg: DashboardAdaptiveConfig = {
      enabled: true,
      rules: [{ moment: 'qualifying', frame: { elements: [el('frame-fuel', 'fuelstint')] } }]
    }
    const res = resolveAdaptiveRuntime(baseElements, qPlan, cfg, new Set(['qualifying']))
    const fuel = res.elements.find((e) => e.element.id === 'frame-fuel')!
    expect(res.frameActive).toBe(true)
    expect(fuel.hidden).toBe(false)
    expect(fuel.element.visible).not.toBe(false)
  })

  it('R20-m2: base/no-frame path still applies the phase HIDE (unchanged)', () => {
    const qPlan = planAdaptiveDashboard(snap({ sessionType: 'Qualify', currentLap: 2 }), { dynamic: false })
    const base = [el('b-fuel', 'fuelstint')]
    const res = resolveAdaptiveRuntime(base, qPlan, { enabled: true, rules: [] }, new Set(['qualifying']))
    expect(res.frameActive).toBe(false)
    expect(res.elements.find((e) => e.element.id === 'b-fuel')!.hidden).toBe(true)
  })

  it('R20-m2: an element-level user rule can still hide a frame widget', () => {
    const qPlan = planAdaptiveDashboard(snap({ sessionType: 'Qualify', currentLap: 2 }), { dynamic: false })
    const cfg: DashboardAdaptiveConfig = {
      enabled: true,
      rules: [
        {
          moment: 'qualifying',
          frame: { elements: [el('frame-fuel', 'fuelstint')] },
          elements: { 'frame-fuel': { visible: false } }
        }
      ]
    }
    const res = resolveAdaptiveRuntime(baseElements, qPlan, cfg, new Set(['qualifying']))
    expect(res.elements.find((e) => e.element.id === 'frame-fuel')!.hidden).toBe(true)
  })

  // ── R20-m3: frame.elements are sanitized/clamped before render (they bypass
  // the main-process normalizeDashboard). ─────────────────────────────────────
  it('R20-m3: sanitizeFrameElements keeps valid elements and rounds geometry', () => {
    const good: DashboardElement = {
      id: 'g', type: 'speed-clean' as DashboardElement['type'], x: 1.6, y: 2.4, w: 100.5, h: 50, style: {}
    }
    const [out] = sanitizeFrameElements([good])
    expect(out.id).toBe('g')
    expect(out.x).toBe(2)
    expect(out.y).toBe(2)
    expect(out.w).toBe(101)
    expect(out.h).toBe(50)
  })

  it('R20-m3: sanitizeFrameElements drops malformed elements, assigns missing ids', () => {
    const dirty = [
      null,
      'nope',
      { type: 'speed-clean', x: 0, y: 0, w: 10, h: 10 }, // missing id → assigned, KEPT
      { type: '', x: 0, y: 0, w: 10, h: 10 }, // empty type → dropped
      { type: 123, x: 0, y: 0, w: 10, h: 10 }, // non-string type → dropped
      { type: 'speed-clean', x: Number.NaN, y: 0, w: 10, h: 10 }, // NaN geometry → dropped
      { type: 'speed-clean', x: 0, y: 0, w: 0, h: 10 }, // non-positive size → dropped
      { type: 'speed-clean', x: 0, y: 0, w: 10, h: -5 } // negative size → dropped
    ] as unknown as DashboardElement[]
    const out = sanitizeFrameElements(dirty)
    expect(out).toHaveLength(1)
    expect(typeof out[0].id).toBe('string')
    expect(out[0].id.length).toBeGreaterThan(0)
    expect(out[0].style).toEqual({})
  })

  it('R20-m3: sanitizeFrameElements keeps unknown but well-formed types', () => {
    const out = sanitizeFrameElements([
      { id: 'u', type: 'totally-unknown', x: 0, y: 0, w: 10, h: 10, style: {} } as unknown as DashboardElement
    ])
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe('totally-unknown')
  })

  it('R20-m3: runtime drops malformed frame elements; all-dropped → falls back to base', () => {
    const cfg: DashboardAdaptiveConfig = {
      enabled: true,
      rules: [
        {
          moment: 'green',
          frame: { elements: [{ type: 'speed-clean', x: Number.NaN, y: 0, w: 10, h: 10 }] as unknown as DashboardElement[] }
        }
      ]
    }
    const res = resolveAdaptiveRuntime(baseElements, plan, cfg, new Set(['green']))
    expect(res.frameActive).toBe(false)
    expect(res.frameBg).toBeUndefined()
    expect(res.elements.map((e) => e.element.id)).toEqual(['base-a', 'base-b'])
  })
})
