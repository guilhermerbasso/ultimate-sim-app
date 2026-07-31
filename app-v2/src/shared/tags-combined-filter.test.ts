import { describe, expect, it } from 'vitest'
import {
  GT3_DENSE_50_MATRIX,
  GT3_DENSE_50_PRESETS
} from './dashboards-gt3-dense-50'
import {
  ALL_TAG_VOCAB,
  filterByTags,
  isControlledTag,
  isTelemetryIdTag,
  unitTagFor
} from './tags'
import { filterVariants } from './widget-taxonomy'
// The renderer registries are imported statically, the same way ten sibling suites in
// this directory already reach them (dashboards.test.ts, dashboard-layout, dashboard-nl,
// dashboard-render-capability, dashboards-hifi-*). They used to be pulled in by
// `vi.importActual` inside a `beforeAll`, which put vitest's default 10 s hook budget on
// a 136-module graph load: solo that load costs ~1.6 s, but under 2x worker
// oversubscription it queues behind every other fork on vitest's single main-process
// module-transform server and measures p50 19 s. The hook clock was timing machine
// contention, not this suite's setup.
import { HIFI_WIDGET_GROUPS, hifiWidgetTags } from '../renderer/src/hifi/widgets/registry'
import { ALL_VARIANTS } from '../renderer/src/views/dashboard/widget-catalog-data'
import {
  SNAPSHOT_GAP_DESCRIPTORS,
  TELEMETRY_DESCRIPTORS
} from '../renderer/src/hifi/widgets/variants'

const telemetryWidgets = HIFI_WIDGET_GROUPS.telemetryVariants
const telemetryCatalogVariants = ALL_VARIANTS.filter((variant) =>
  variant.tags?.includes('telemetry-framework')
)
const descriptorUnits = new Map<string, string>()
for (const descriptor of [...TELEMETRY_DESCRIPTORS, ...SNAPSHOT_GAP_DESCRIPTORS]) {
  if (descriptor.unit) descriptorUnits.set(descriptor.id, descriptor.unit)
}

function telemetryIdentity(widgetId: string): {
  telemetryTag: string
  variant: 'competition' | 'futuristic' | 'ddu'
} {
  const match = /^telemetry-(.+)-(competition|futuristic|ddu)$/.exec(widgetId)
  if (!match) throw new Error(`Unexpected telemetry widget id: ${widgetId}`)
  return {
    telemetryTag: `telemetry-${match[1]}`,
    variant: match[2] as 'competition' | 'futuristic' | 'ddu'
  }
}

describe('controlled tag vocabulary', () => {
  it('keeps the static vocabulary normalized and de-duplicated', () => {
    expect(new Set(ALL_TAG_VOCAB).size).toBe(ALL_TAG_VOCAB.length)
    for (const tag of ALL_TAG_VOCAB) {
      expect(tag, `unnormalized vocabulary tag: ${JSON.stringify(tag)}`).toBe(tag.trim())
      expect(tag, `whitespace in vocabulary tag: ${tag}`).not.toMatch(/\s/)
      expect(isControlledTag(tag), tag).toBe(true)
    }
  })

  it('covers every implemented telemetry variant without duplicate or uncontrolled tags', () => {
    expect(telemetryWidgets.length).toBeGreaterThan(0)
    expect(telemetryCatalogVariants.map((variant) => variant.hifiModuleId).sort()).toEqual(
      telemetryWidgets.map((widget) => widget.id).sort()
    )

    for (const widget of telemetryWidgets) {
      const tags = widget.tags
      const { telemetryTag, variant } = telemetryIdentity(widget.id)
      const telemetryTags = tags.filter(isTelemetryIdTag)

      expect(new Set(tags).size, `${widget.id}: duplicate raw tag`).toBe(tags.length)
      expect(telemetryTags, `${widget.id}: telemetry tag`).toEqual([telemetryTag])
      expect(tags, `${widget.id}: source`).toEqual(
        expect.arrayContaining(['iRacing', 'source-iracing'])
      )
      expect(tags, `${widget.id}: type`).toContain('widget')
      expect(tags, `${widget.id}: category`).toContain(widget.category)
      expect(tags, `${widget.id}: style`).toEqual(
        expect.arrayContaining([variant, `style-${variant}`])
      )
      expect(tags.some((tag) => tag.startsWith('focus-')), `${widget.id}: focus`).toBe(true)
      const unit = descriptorUnits.get(telemetryTag.slice('telemetry-'.length))
      if (unit) expect(tags, `${widget.id}: unit`).toContain(unitTagFor(unit))

      for (const tag of tags) {
        expect(isControlledTag(tag), `${widget.id}: uncontrolled tag ${tag}`).toBe(true)
      }

      const filterTags = hifiWidgetTags(widget)
      expect(filterTags, `${widget.id}: normalized source`).toContain('IR')
      expect(new Set(filterTags).size, `${widget.id}: duplicate filter tag`).toBe(filterTags.length)
    }
  })

  it('covers every dense dashboard preset without duplicate or uncontrolled tags', () => {
    const matrixById = new Map(GT3_DENSE_50_MATRIX.map((entry) => [entry.id, entry]))

    for (const preset of GT3_DENSE_50_PRESETS) {
      const tags = preset.tags ?? []
      const matrix = matrixById.get(preset.id)

      expect(matrix, `${preset.id}: missing matrix row`).toBeDefined()
      expect(new Set(tags).size, `${preset.id}: duplicate tag`).toBe(tags.length)
      expect(tags, `${preset.id}: base facets`).toEqual(
        expect.arrayContaining(['IR', 'dashboard', 'GT3', '1024x600', 'dense'])
      )
      expect(tags, `${preset.id}: session`).toContain(matrix?.session)
      expect(tags, `${preset.id}: condition`).toContain(matrix?.condition)
      expect(tags, `${preset.id}: focus`).toContain(matrix?.focus)
      expect(
        tags.some((tag) => ['competition', 'futuristic', 'ddu'].includes(tag)),
        `${preset.id}: style`
      ).toBe(true)

      for (const tag of tags) {
        expect(isControlledTag(tag), `${preset.id}: uncontrolled tag ${tag}`).toBe(true)
      }
    }
  })
})

describe('combined tag filters on real artifacts', () => {
  it('returns exactly the wet qualifying dashboards', () => {
    const actual = filterByTags(
      GT3_DENSE_50_PRESETS,
      ['IR', 'dashboard', 'quali', 'wet'],
      (preset) => preset.tags
    )
    const expectedIds = GT3_DENSE_50_MATRIX
      .filter((entry) => entry.session === 'quali' && entry.condition === 'wet')
      .map((entry) => entry.id)

    expect(actual.map((preset) => preset.id)).toEqual(expectedIds)
    expect(actual.map((preset) => preset.id)).toContain('gt3_dense50_quali_rain_reference')
    expect(actual.map((preset) => preset.id)).not.toContain('gt3_dense50_quali_apex_delta')
  })

  it('returns only DDU telemetry widget variants', () => {
    const actual = filterVariants(telemetryCatalogVariants, {
      tags: ['IR', 'widget', 'style-ddu']
    })
    const expectedIds = telemetryCatalogVariants
      .filter((variant) => variant.hifiModuleId?.endsWith('-ddu'))
      .map((variant) => variant.id)

    expect(actual.map((variant) => variant.id)).toEqual(expectedIds)
    expect(actual.map((variant) => variant.id)).toContain('hifi-telemetry-speed-ddu')
    expect(actual.every((variant) => variant.hifiModuleId?.endsWith('-ddu'))).toBe(true)
    expect(actual.map((variant) => variant.id)).not.toContain(
      'hifi-telemetry-speed-competition'
    )
  })

  it('returns fuel-focused widgets and fuel-save dashboards', () => {
    const widgets = filterVariants(telemetryCatalogVariants, {
      tags: ['IR', 'widget', 'focus-fuel']
    })
    const dashboards = filterByTags(
      GT3_DENSE_50_PRESETS,
      ['IR', 'dashboard', 'fuel-save'],
      (preset) => preset.tags
    )
    const expectedDashboardIds = GT3_DENSE_50_MATRIX
      .filter((entry) => entry.condition === 'fuel-save')
      .map((entry) => entry.id)

    expect(widgets.length).toBeGreaterThan(0)
    expect(widgets.map((variant) => variant.id)).toContain(
      'hifi-telemetry-fuelLevel-ddu'
    )
    expect(widgets.map((variant) => variant.id)).not.toContain('hifi-telemetry-speed-ddu')
    expect(widgets.every((variant) => variant.tags?.includes('focus-fuel'))).toBe(true)

    expect(dashboards.map((preset) => preset.id)).toEqual(expectedDashboardIds)
    expect(dashboards.map((preset) => preset.id)).toContain(
      'gt3_dense50_race_undercut_fuel'
    )
    expect(dashboards.map((preset) => preset.id)).not.toContain(
      'gt3_dense50_race_rain_survival'
    )
  })

  it('returns every endurance dashboard and excludes other sessions', () => {
    const actual = filterByTags(
      GT3_DENSE_50_PRESETS,
      ['IR', 'dashboard', 'endurance'],
      (preset) => preset.tags
    )
    const expectedIds = GT3_DENSE_50_MATRIX
      .filter((entry) => entry.session === 'endurance')
      .map((entry) => entry.id)

    expect(actual.map((preset) => preset.id)).toEqual(expectedIds)
    expect(actual.map((preset) => preset.id)).toContain(
      'gt3_dense50_endurance_motec_debrief'
    )
    expect(actual.every((preset) => preset.tags?.includes('endurance'))).toBe(true)
    expect(actual.map((preset) => preset.id)).not.toContain('gt3_dense50_race_pace_command')
  })
})
