import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { TelemetrySnapshot } from '../../../../../shared/telemetry'
import { baseSnapshot } from '../../../../../shared/telemetry-scenarios'
import {
  TELEMETRY_DESCRIPTORS,
  COMPLEX_TELEMETRY_DESCRIPTORS,
  SNAPSHOT_GAP_DESCRIPTORS,
  TELEMETRY_VARIANTS,
  TELEMETRY_VARIANT_COVERAGE,
  TELEMETRY_VARIANT_WIDGETS,
  REMAINING_TELEMETRY_WIDGETS,
  TELEMETRY_BLOCKED_CONCEPTS,
  TELEMETRY_DEFERRED_CONCEPTS,
  telemetryVariantArtifactId,
  telemetryVariantModuleId,
  telemetryVariantWidgetId
} from './index'

const unsafeTokens = /NaN|undefined|Infinity/
const ALL_WIDGETS = [...TELEMETRY_VARIANT_WIDGETS, ...REMAINING_TELEMETRY_WIDGETS]

function poisonNumbers<T>(value: T): T {
  if (typeof value === 'number') return Number.NaN as T
  if (Array.isArray(value)) return value.map((item) => poisonNumbers(item)) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, poisonNumbers(item)])
    ) as T
  }
  return value
}

function renderAll(snapshot: TelemetrySnapshot | null): string[] {
  return ALL_WIDGETS.map((widget) =>
    renderToStaticMarkup(
      createElement(widget.render, {
        snapshot,
        width: widget.defaultSize.w,
        height: widget.defaultSize.h
      })
    )
  )
}

describe('telemetry variant framework', () => {
  it('implements every non-blocked, non-shift-light concept with exactly three variants', () => {
    expect(TELEMETRY_DESCRIPTORS).toHaveLength(86)
    expect(SNAPSHOT_GAP_DESCRIPTORS).toHaveLength(16)
    expect(COMPLEX_TELEMETRY_DESCRIPTORS).toHaveLength(39)
    expect(TELEMETRY_VARIANT_WIDGETS).toHaveLength(258)
    expect(REMAINING_TELEMETRY_WIDGETS).toHaveLength(165)
    expect(ALL_WIDGETS).toHaveLength(423)
    expect(TELEMETRY_VARIANT_COVERAGE).toMatchObject({
      eligibleTelemetries: 143,
      implementedTelemetries: 141,
      implementedVariants: 423,
      blockedTelemetries: 1,
      blockedVariants: 3,
      deferredTelemetries: 1,
      deferredVariants: 3,
      resolvedTelemetries: 142,
      resolvedVariants: 426
    })
    expect(TELEMETRY_BLOCKED_CONCEPTS.map((entry) => entry.id)).toEqual(['perCarSteering'])
    expect(TELEMETRY_DEFERRED_CONCEPTS.map((entry) => entry.id)).toEqual(['shiftLights'])

    const descriptors = [
      ...TELEMETRY_DESCRIPTORS,
      ...SNAPSHOT_GAP_DESCRIPTORS,
      ...COMPLEX_TELEMETRY_DESCRIPTORS
    ]
    for (const descriptor of descriptors) {
      const ids = TELEMETRY_VARIANTS.map((variant) =>
        telemetryVariantModuleId(descriptor.id, variant)
      )
      for (const id of ids) {
        expect(
          ALL_WIDGETS.some((widget) => widget.id === id),
          `missing ${id}`
        ).toBe(true)
      }
    }
  })

  it('keeps ids unique and documents artifact → runtime widget mapping', () => {
    const ids = ALL_WIDGETS.map((widget) => widget.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(telemetryVariantArtifactId('speed', 'competition')).toBe(
      'w:speed:competition'
    )
    expect(telemetryVariantModuleId('speed', 'competition')).toBe(
      'telemetry-speed-competition'
    )
    expect(telemetryVariantWidgetId('speed', 'competition')).toBe(
      'hifi:telemetry-speed-competition'
    )
  })

  it('uses normalized tags for source, type, telemetry, unit, style, and focus', () => {
    for (const widget of ALL_WIDGETS) {
      expect(widget.tags).toContain('telemetry-framework')
      expect(widget.tags).toContain('iRacing')
      expect(widget.tags).toContain('source-iracing')
      expect(widget.tags).toContain('widget')
      expect(widget.tags.some((tag) => tag.startsWith('telemetry-'))).toBe(true)
      expect(widget.tags.some((tag) => tag.startsWith('style-'))).toBe(true)
      expect(widget.tags.some((tag) => tag.startsWith('focus-'))).toBe(true)
      expect(widget.requires.length).toBeGreaterThan(0)
    }
  })

  it('renders data, unavailable, and non-finite snapshots without unsafe SVG tokens', () => {
    const snapshots: Array<TelemetrySnapshot | null> = [
      baseSnapshot(),
      null,
      poisonNumbers(baseSnapshot())
    ]
    for (const snapshot of snapshots) {
      for (const markup of renderAll(snapshot)) {
        expect(markup.length).toBeGreaterThan(100)
        expect(markup).not.toMatch(unsafeTokens)
        expect(markup).not.toContain('fill="#000000"')
      }
    }
  })

  it('renders aggregate tables, radar, sector map, vector, corners, status, and steering archetypes', () => {
    const snapshot = baseSnapshot()
    snapshot.drivers = [
      ...(snapshot.drivers ?? []),
      {
        carIdx: 63,
        name: 'Pace Car',
        carNumber: 'PC',
        position: 0,
        classPosition: 0,
        classId: 0,
        isPlayer: false,
        isPaceCar: true,
        inPits: false
      }
    ]
    const ids = [
      'telemetry-perCarPosition-competition',
      'telemetry-perCarRelativeTime-futuristic',
      'telemetry-lapDistance-competition',
      'telemetry-accelerationVector-ddu',
      'telemetry-tyreCarcassTemperature-competition',
      'telemetry-paceFlags-ddu',
      'telemetry-steeringAngle-futuristic'
    ]
    const markup = ids.map((id) => {
      const widget = ALL_WIDGETS.find((entry) => entry.id === id)
      expect(widget, `missing ${id}`).toBeDefined()
      return renderToStaticMarkup(
        createElement(widget!.render, {
          snapshot,
          width: widget!.defaultSize.w,
          height: widget!.defaultSize.h
        })
      )
    })

    expect(markup[0]).toContain('#46')
    expect(markup[1]).toContain('+1.2')
    expect(markup[2]).toContain('S1')
    expect(markup[2]).toContain('S2')
    expect(markup[2]).toContain('S3')
    expect(markup[2]).toContain('2801 m')
    expect(markup[2]).not.toContain('50.4372')
    expect(markup[3]).toContain('LONG')
    expect(markup[4]).toContain('LF')
    expect(markup[5]).toContain('FREE PASS')
    expect(markup[6]).toContain('STEER')
    expect(markup.slice(0, 7).every((output) => output.includes('var(--overlay-accent'))).toBe(true)
  })

  it('renders normalized DRS available, zone, active, and deactivated states', () => {
    const widget = ALL_WIDGETS.find((entry) => entry.id === 'telemetry-drs-competition')
    expect(widget).toBeDefined()
    const render = (drsState: 0 | 1 | 2 | 3, phase = 'drs-state') =>
      renderToStaticMarkup(createElement(widget!.render, {
        snapshot: { ...baseSnapshot(), drsState },
        width: widget!.defaultSize.w,
        height: widget!.defaultSize.h,
        visibility: { visible: true, active: drsState > 0, held: phase === 'drs-deactivated', phase }
      }))
    expect(render(1)).toContain('DRS AVAILABLE')
    expect(render(2)).toContain('DRS ZONE')
    expect(render(3)).toContain('DRS ACTIVE')
    expect(render(0, 'drs-deactivated')).toContain('DRS DEACTIVATED')
  })
})
