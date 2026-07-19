import { beforeAll, describe, expect, it, vi } from 'vitest'
import {
  GT3_DENSE_50_MATRIX,
  GT3_DENSE_50_PRESETS
} from './dashboards-gt3-dense-50'
import {
  ALL_TAG_VOCAB,
  isControlledTag,
  isTelemetryIdTag,
  unitTagFor
} from './tags'
import {
  filterVariants,
  type WidgetTaxon
} from './widget-taxonomy'

interface TelemetryWidget {
  id: string
  category: string
  tags: string[]
}

interface CatalogVariant extends WidgetTaxon {
  hifiModuleId?: string
}

type FilterByTags = <T>(
  items: readonly T[],
  selectedTags: readonly string[] | ReadonlySet<string>,
  getTags: (item: T) => readonly string[] | undefined
) => T[]

let telemetryWidgets: readonly TelemetryWidget[] = []
let telemetryCatalogVariants: CatalogVariant[] = []
let descriptorUnits = new Map<string, string>()
let filterByTags: FilterByTags
let hifiWidgetTags: (widget: TelemetryWidget) => string[]

// Runtime imports exercise the real renderer registries without pulling them into
// tsconfig.node's static module graph.
beforeAll(async () => {
  const [tagFilterModule, registryModule, catalogModule, variantsModule] = await Promise.all([
    vi.importActual('../renderer/src/components/TagFilter'),
    vi.importActual('../renderer/src/hifi/widgets/registry'),
    vi.importActual('../renderer/src/views/dashboard/widget-catalog-data'),
    vi.importActual('../renderer/src/hifi/widgets/variants')
  ])
  const tagFilter = tagFilterModule as { filterByTags: FilterByTags }
  const registry = registryModule as {
    HIFI_WIDGET_GROUPS: { telemetryVariants: readonly TelemetryWidget[] }
    hifiWidgetTags: (widget: TelemetryWidget) => string[]
  }
  const catalog = catalogModule as { ALL_VARIANTS: CatalogVariant[] }
  const variants = variantsModule as {
    TELEMETRY_DESCRIPTORS: Array<{ id: string; unit?: string }>
    SNAPSHOT_GAP_DESCRIPTORS: Array<{ id: string; unit?: string }>
  }

  filterByTags = tagFilter.filterByTags
  hifiWidgetTags = registry.hifiWidgetTags
  telemetryWidgets = registry.HIFI_WIDGET_GROUPS.telemetryVariants
  telemetryCatalogVariants = catalog.ALL_VARIANTS.filter((variant) =>
    variant.tags?.includes('telemetry-framework')
  )
  descriptorUnits = new Map(
    [...variants.TELEMETRY_DESCRIPTORS, ...variants.SNAPSHOT_GAP_DESCRIPTORS]
      .filter((descriptor): descriptor is { id: string; unit: string } => Boolean(descriptor.unit))
      .map((descriptor) => [descriptor.id, descriptor.unit] as const)
  )
})

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
