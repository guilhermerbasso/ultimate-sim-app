import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDefaultOverlayStyle, DEFAULT_OVERLAY_STYLE_PRESET, type OverlayWidgetConfig, type OverlayWidgetId } from '../../../shared/overlays'
import { HIFI_WIDGETS, hifiWidgetTags } from '../hifi/widgets/registry'
import { HifiWidgetHost, resolveWidgetComponent } from './widgets'
import { PLAYABLE_SIMS, widgetSupportedSims } from '../../../shared/sim-coverage'
import {
  createDefaultOverlaysConfigWithHifi,
  HIFI_OVERLAY_DEFS,
  mergeHifiOverlayConfigs,
  shouldRenderOverlayRuntime
} from './hifi-overlays'

describe('hi-fi overlay bridge', () => {
  it('creates one unique hifi: definition per hi-fi module', () => {
    expect(HIFI_OVERLAY_DEFS).toHaveLength(HIFI_WIDGETS.length)
    const ids = HIFI_OVERLAY_DEFS.map((def) => def.id)
    expect(ids.every((id) => id.startsWith('hifi:'))).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('copies registry tags including auto yes tags', () => {
    for (const module of HIFI_WIDGETS) {
      const def = HIFI_OVERLAY_DEFS.find((item) => item.id === `hifi:${module.id}`)
      expect(def?.tags).toEqual(expect.arrayContaining(hifiWidgetTags(module)))
    }
  })

  it('preserves alternative telemetry requirements for shift alerts', () => {
    const module = HIFI_WIDGETS.find((entry) => entry.id === 'alertShiftFlash')
    const definition = HIFI_OVERLAY_DEFS.find((entry) => entry.id === 'hifi:alertShiftFlash')
    expect(definition?.requires).toEqual(module?.requires)
    expect(definition?.alternativeRequires).toEqual(module?.alternativeRequires)
    expect(widgetSupportedSims(
      definition?.requires,
      definition?.alternativeRequires
    )).toEqual([...PLAYABLE_SIMS])
  })

  it('enforces the alert-role invariant across current and generated visual families', () => {
    const alerts = HIFI_WIDGETS.filter((module) => module.role === 'alert')
    expect(alerts.length).toBeGreaterThan(20)
    for (const module of alerts) {
      expect(module.defaultTrigger, `${module.id} has no trigger`).toBeDefined()
      expect(module.defaultTrigger?.kind, `${module.id} is always-on`).not.toBe('always')
      expect(module.preview, `${module.id} has no isolated preview sequence`).toBe('simulated-active-sequence')
      expect(module.tags, `${module.id} lacks trigger-only tag`).toContain('trigger-only')
      expect(module.tags, `${module.id} lacks release cohort tag`).toContain('release-a')
    }
  })

  it('applies audited semantics to direct hi-fi families', () => {
    const expected = new Map([
      ['drs', 'drs'],
      ['pushToPass', 'pushToPassState'],
      ['absState', 'absActive'],
      ['tcState', 'tcActive'],
      ['engineWarnings', 'engineWarnings'],
      ['paceMode', 'paceMode'],
      ['flag', 'raceControlFlags'],
      ['raceControlFlags', 'raceControlFlags'],
      ['incidents', 'incidentCounts'],
      ['pitLimiter', 'pitLimiter'],
      ['pitService', 'pitServicesSelected'],
      ['wetDeclared', 'declaredWet'],
      ['wetness', 'trackWetness'],
      ['fog', 'fogLevel'],
      ['spotterRaw', 'sideProximity']
    ])
    for (const [id, semantic] of expected) {
      const module = HIFI_WIDGETS.find((entry) => entry.id === id)
      expect(module, `missing ${id}`).toBeDefined()
      expect(module?.role).toBe('alert')
      expect(module?.defaultTrigger).toEqual({ kind: 'semantic', semantic })
    }
    for (const module of HIFI_WIDGETS.filter((entry) => entry.id.startsWith('spotterRaw'))) {
      expect(module.defaultTrigger).toEqual({ kind: 'semantic', semantic: 'sideProximity' })
    }
  })

  it.each([
    'paceFlags',
    'pitFuelToAdd',
    'precipitation',
    'repairTime',
    'optionalRepairTime',
    'incidentCounts',
    'repairRequirement',
    'pitServiceStatus',
    'pitsOpen',
    'pitServicesSelected',
    'trackWetness',
    'fogLevel',
    'proximity',
    'raceFlags',
    'drs',
    'engineWarnings',
    'pushToPassState',
    'absActive',
    'absCut',
    'tcActive',
    'declaredWet',
    'paceMode',
    'paceFormation',
    'onPitRoad',
    'pitLimiter',
    'inPitStall',
    'pitStopActive',
    'pitTyreTargets',
    'replayState',
    'replayTimeline'
  ])('keeps all three generated %s variants on one semantic policy', (base) => {
    const variants = HIFI_WIDGETS.filter((module) =>
      new RegExp(`^telemetry-${base}-(competition|futuristic|ddu)$`).test(module.id)
    )
    expect(variants).toHaveLength(3)
    expect(new Set(variants.map((module) => module.defaultTrigger?.semantic)).size).toBe(1)
    expect(variants.every((module) => module.role === 'alert')).toBe(true)
  })

  it('does not turn ordinary air/track temperature variants into weather alerts', () => {
    for (const base of ['airTemperature', 'trackTemperature']) {
      const variants = HIFI_WIDGETS.filter((module) =>
        new RegExp(`^telemetry-${base}-(competition|futuristic|ddu)$`).test(module.id)
      )
      expect(variants).toHaveLength(3)
      expect(variants.every((module) => module.role !== 'alert')).toBe(true)
    }
  })

  it('sanitizes an alert always override while preserving an ordinary explicit override', () => {
    const defaults = createDefaultOverlaysConfigWithHifi()
    const alert = HIFI_OVERLAY_DEFS.find((definition) => definition.role === 'alert')!
    const ordinary = HIFI_OVERLAY_DEFS.find((definition) => definition.role !== 'alert')!
    const merged = mergeHifiOverlayConfigs({
      ...defaults,
      widgets: {
        ...defaults.widgets,
        [alert.id]: { ...defaults.widgets[alert.id], trigger: { kind: 'always' } },
        [ordinary.id]: { ...defaults.widgets[ordinary.id], trigger: { kind: 'always' } }
      }
    })
    expect(merged.widgets[alert.id].trigger).toEqual(alert.defaultTrigger)
    expect(merged.widgets[ordinary.id].trigger).toEqual({ kind: 'always' })
  })

  it('removes inactive alerts from runtime/hit-test projections even while unlocked', () => {
    const alert = HIFI_OVERLAY_DEFS.find((definition) => definition.role === 'alert')!
    const ordinary = HIFI_OVERLAY_DEFS.find((definition) => definition.role !== 'alert')!
    const inactive = { visible: false, active: false, held: false, phase: 'inactive' }
    expect(shouldRenderOverlayRuntime(alert, { locked: false }, inactive)).toBe(false)
    expect(shouldRenderOverlayRuntime(ordinary, { locked: false }, inactive)).toBe(true)
    expect(shouldRenderOverlayRuntime(ordinary, { locked: true }, inactive)).toBe(false)
  })

  it('resolves hifi ids to HifiWidgetHost', () => {
    const id = `hifi:${HIFI_WIDGETS[0].id}` as OverlayWidgetId
    expect(resolveWidgetComponent(id)).toBe(HifiWidgetHost)
  })

  it('smoke-renders several host modules without invalid text', () => {
    const defaults = createDefaultOverlaysConfigWithHifi()
    const samples = [
      HIFI_WIDGETS[0],
      HIFI_WIDGETS[Math.floor(HIFI_WIDGETS.length / 3)],
      HIFI_WIDGETS[Math.floor((HIFI_WIDGETS.length * 2) / 3)],
      HIFI_WIDGETS[HIFI_WIDGETS.length - 1]
    ]
    for (const module of samples) {
      const id = `hifi:${module.id}` as OverlayWidgetId
      const config = defaults.widgets[id] as OverlayWidgetConfig
      const html = renderToStaticMarkup(createElement(HifiWidgetHost, { snapshot: null, config }))
      expect(html.length, module.id).toBeGreaterThan(20)
      expect(html, module.id).not.toContain('NaN')
      expect(html, module.id).not.toContain('undefined')
    }
  })

  it('renders rev/RPM strip modules in the placed box instead of letterboxing defaults', () => {
    const config: OverlayWidgetConfig = {
      id: 'hifi:revlightsMustang' as OverlayWidgetId,
      enabled: true,
      locked: false,
      favorite: false,
      position: { x: 0, y: 0, width: 1000, height: 40 },
      opacity: 100,
      stylePreset: DEFAULT_OVERLAY_STYLE_PRESET,
      style: createDefaultOverlayStyle(),
      display: null,
      hifiModuleId: 'revlightsMustang'
    }

    const html = renderToStaticMarkup(createElement(HifiWidgetHost, { snapshot: null, config }))
    expect(html).toContain('viewBox="0 0 1000 40"')
    expect(html).toContain('preserveAspectRatio="none"')
    expect(html).toContain('background:transparent')
    expect(html).toContain('border:none')
  })
})
