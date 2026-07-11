import { describe, expect, it } from 'vitest'
import { BUILTIN_PRESETS, DEFAULT_DASHBOARD_PRESET_PRIORITY } from './dashboards'
import { GT3_DENSE_50_MATRIX, GT3_DENSE_50_PRESETS } from './dashboards-gt3-dense-50'
import { ALL_TAG_VOCAB } from './tags'

const EPSILON = 0.001
const filterByTags = (
  selectedTags: readonly string[]
): typeof GT3_DENSE_50_PRESETS =>
  GT3_DENSE_50_PRESETS.filter((preset) =>
    selectedTags.every((tag) => preset.tags?.includes(tag))
  )

describe('GT3 dense 50 presets', () => {
  it('registers exactly 50 unique presets ahead of legacy presets', () => {
    expect(GT3_DENSE_50_MATRIX).toHaveLength(50)
    expect(GT3_DENSE_50_PRESETS).toHaveLength(50)
    expect(new Set(GT3_DENSE_50_PRESETS.map((preset) => preset.id)).size).toBe(50)
    expect(new Set(GT3_DENSE_50_PRESETS.map((preset) => preset.name)).size).toBe(50)
    expect(new Set(GT3_DENSE_50_PRESETS.map((preset) => preset.build)).size).toBe(50)
    expect(new Set(GT3_DENSE_50_MATRIX.map((entry) => entry.purpose)).size).toBe(50)
    expect(GT3_DENSE_50_PRESETS.map((preset) => preset.priority)).toEqual(
      Array.from({ length: 50 }, (_, index) => index * 10)
    )
    expect(new Set(GT3_DENSE_50_MATRIX.map((entry) => entry.session))).toEqual(
      new Set(['quali', 'sprint', 'race', 'endurance'])
    )
    expect(new Set(GT3_DENSE_50_MATRIX.map((entry) => entry.condition))).toEqual(
      new Set(['dry', 'wet', 'fuel-save', 'tyre-save'])
    )
    expect(new Set(GT3_DENSE_50_MATRIX.map((entry) => entry.focus))).toEqual(
      new Set(['delta', 'consistency', 'traffic', 'strategy', 'pace', 'stint', 'engineer'])
    )
    expect(
      new Set(GT3_DENSE_50_MATRIX.map((entry) => `${entry.session}:${entry.condition}`)).size
    ).toBe(16)
    expect(Math.max(...GT3_DENSE_50_PRESETS.map((preset) => preset.priority ?? Infinity)))
      .toBeLessThan(DEFAULT_DASHBOARD_PRESET_PRIORITY)
    expect(BUILTIN_PRESETS.filter((preset) => preset.id.startsWith('gt3_dense50_'))).toHaveLength(50)
  })

  it('uses stable hi-fi widget ids on every element', () => {
    const widgetIds = new Set<string>()
    for (const preset of GT3_DENSE_50_PRESETS) {
      for (const element of preset.build().elements) {
        expect(element.widgetId).toMatch(/^hifi:/)
        widgetIds.add(element.widgetId as string)
      }
    }
    expect(widgetIds.size).toBeGreaterThan(50)
  })

  it('builds unique dense 1024x600 compositions without overlaps or overflow', () => {
    const signatures = new Set<string>()
    const selectionSignatures = new Set<string>()
    for (const preset of GT3_DENSE_50_PRESETS) {
      const dashboard = preset.build()
      expect(dashboard.width).toBe(1024)
      expect(dashboard.height).toBe(600)
      expect(dashboard.scaleMode).toBe('fit')
      expect(dashboard.elements.length, preset.id).toBeGreaterThanOrEqual(13)

      let occupiedArea = 0
      const moduleIds: string[] = []
      for (const element of dashboard.elements) {
        expect(element.type).toBe('overlaywidget')
        expect(element.widgetId).toMatch(/^hifi:/)
        moduleIds.push(element.hifiModuleId as string)
        expect(element.x).toBeGreaterThanOrEqual(-EPSILON)
        expect(element.y).toBeGreaterThanOrEqual(-EPSILON)
        expect(element.w).toBeGreaterThan(0)
        expect(element.h).toBeGreaterThan(0)
        expect(element.x + element.w).toBeLessThanOrEqual(dashboard.width + EPSILON)
        expect(element.y + element.h).toBeLessThanOrEqual(dashboard.height + EPSILON)
        occupiedArea += element.w * element.h
      }
      expect(new Set(moduleIds).size, `${preset.id}: duplicate widget`).toBe(moduleIds.length)
      expect(moduleIds.some((id) => /^revlights/.test(id)), `${preset.id}: revlights`).toBe(true)
      expect(moduleIds.some((id) => id === 'speedGear' || /telemetry-speed-/.test(id)), `${preset.id}: speed`).toBe(true)
      expect(moduleIds.some((id) => id === 'speedGear' || /telemetry-gear-/.test(id)), `${preset.id}: gear`).toBe(true)
      expect(moduleIds.some((id) => /delta/i.test(id)), `${preset.id}: delta`).toBe(true)
      expect(moduleIds.some((id) => /tcSetting|^tc$/.test(id)), `${preset.id}: TC`).toBe(true)
      expect(moduleIds.some((id) => /absSetting|^abs$/.test(id)), `${preset.id}: ABS`).toBe(true)
      expect(moduleIds.some((id) => /brakeBias/.test(id)), `${preset.id}: brake bias`).toBe(true)
      expect(moduleIds.some((id) => /tyrePressure|tyreWear/.test(id)), `${preset.id}: tyres`).toBe(true)
      expect(moduleIds.some((id) => /fuel/i.test(id)), `${preset.id}: fuel`).toBe(true)
      expect(moduleIds.some((id) => /incident/i.test(id)), `${preset.id}: incidents`).toBe(true)
      expect(moduleIds.some((id) => /trackMap/.test(id)), `${preset.id}: map`).toBe(true)
      expect(
        moduleIds.some((id) => /oilTemp|waterTemp|oilPressure|coolantTemperature|systemVoltage|engineWarnings/.test(id)),
        `${preset.id}: engine vitals`
      ).toBe(true)
      expect(occupiedArea / (dashboard.width * dashboard.height)).toBeGreaterThan(0.72)

      for (let left = 0; left < dashboard.elements.length; left += 1) {
        const a = dashboard.elements[left]
        for (let right = left + 1; right < dashboard.elements.length; right += 1) {
          const b = dashboard.elements[right]
          const overlapWidth = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
          const overlapHeight = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
          expect(overlapWidth > EPSILON && overlapHeight > EPSILON, `${preset.id}: ${a.name} overlaps ${b.name}`)
            .toBe(false)
        }
      }

      signatures.add(
        dashboard.elements
          .map((element) => [
            element.widgetId,
            element.x.toFixed(3),
            element.y.toFixed(3),
            element.w.toFixed(3),
            element.h.toFixed(3)
          ].join(':'))
          .join('|')
      )
      selectionSignatures.add([...moduleIds].sort().join('|'))
    }
    expect(signatures.size).toBe(50)
    expect(selectionSignatures.size).toBe(50)
  })

  it('provides normalized session, condition and focus tags with AND filtering', () => {
    const requiredBaseTags = [
      'GT3',
      'IR',
      'dashboard',
      'hifi',
      '1024x600',
      'dense',
      'revlights',
      'rpm',
      'speed',
      'gear',
      'delta',
      'fuel',
      'tyres',
      'tc',
      'abs',
      'brake-bias'
    ]
    const controlledVocabulary = new Set(ALL_TAG_VOCAB)
    for (const [index, preset] of GT3_DENSE_50_PRESETS.entries()) {
      const tags = new Set(preset.tags)
      const matrix = GT3_DENSE_50_MATRIX[index]
      for (const tag of tags) expect(controlledVocabulary.has(tag), `${preset.id}: uncontrolled tag ${tag}`).toBe(true)
      for (const tag of requiredBaseTags) expect(tags.has(tag), `${preset.id}: ${tag}`).toBe(true)
      expect(tags.has(matrix.session)).toBe(true)
      expect(tags.has(matrix.condition)).toBe(true)
      expect(tags.has(matrix.focus)).toBe(true)
      expect(tags.size).toBe(preset.tags?.length)
    }

    expect(
      filterByTags(['endurance', 'wet', 'strategy'])
        .map((preset) => preset.id)
    ).toEqual(['gt3_dense50_endurance_wet_pit_window'])
    expect(
      filterByTags(['race', 'fuel-save', 'strategy'])
        .map((preset) => preset.id)
    ).toEqual([
      'gt3_dense50_race_undercut_fuel',
      'gt3_dense50_race_safety_car_fuel'
    ])
  })
})
