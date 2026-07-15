import { describe, expect, it } from 'vitest'
import {
  RELEASE_A_CATALOG_ORDER,
  RELEASE_A_RELEASED_AT,
  compareCatalogEntries,
  compareCreatedAtEntries
} from '../../../shared/catalog-order'
import { BUILTIN_PRESETS, summarizeDashboard, type Dashboard } from '../../../shared/dashboards'
import { isControlledTag } from '../../../shared/tags'
import { ALL_VARIANTS } from '../views/dashboard/widget-catalog-data'
import { HIFI_WIDGETS } from '../hifi/widgets/registry'
import { ALL_OVERLAY_WIDGETS } from './hifi-overlays'

describe('Release A catalog projections', () => {
  it('orders favorites above newest overlays without mutating registry order', () => {
    const registryIds = ALL_OVERLAY_WIDGETS.map((entry) => entry.id)
    const sample = [
      { ...ALL_OVERLAY_WIDGETS.find((entry) => entry.catalogOrder === RELEASE_A_CATALOG_ORDER)!, favorite: false },
      { ...ALL_OVERLAY_WIDGETS.find((entry) => !entry.catalogOrder)!, favorite: true }
    ]
    expect([...sample].sort((a, b) => compareCatalogEntries(a, b, true))[0].favorite).toBe(true)
    expect(ALL_OVERLAY_WIDGETS.map((entry) => entry.id)).toEqual(registryIds)
  })

  it('puts release-cohort widgets first by stable metadata, then priority and id', () => {
    expect(ALL_VARIANTS[0].catalogOrder).toBe(RELEASE_A_CATALOG_ORDER)
    const release = ALL_VARIANTS.filter((entry) => entry.catalogOrder === RELEASE_A_CATALOG_ORDER)
    expect(release.length).toBeGreaterThan(20)
    expect(release.every((entry) => entry.releasedAt === RELEASE_A_RELEASED_AT)).toBe(true)
    for (let index = 1; index < ALL_VARIANTS.length; index += 1) {
      expect(compareCatalogEntries(ALL_VARIANTS[index - 1], ALL_VARIANTS[index])).toBeLessThanOrEqual(0)
    }
  })

  it('orders dashboard release cohorts in the gallery projection while leaving preset arrays reusable', () => {
    const ordered = [...BUILTIN_PRESETS].sort(compareCatalogEntries)
    expect(ordered[0].catalogOrder).toBe(RELEASE_A_CATALOG_ORDER)
    expect(ordered[0].releasedAt).toBe(RELEASE_A_RELEASED_AT)
    expect(ordered[0].tags).toContain('release-a')
  })

  it('orders custom content by creation time, not update time, with favorites first', () => {
    const entries = [
      { id: 'older-edited', favorite: false, createdAt: 100, updatedAt: 9999 },
      { id: 'newer', favorite: false, createdAt: 200, updatedAt: 200 },
      { id: 'favorite-old', favorite: true, createdAt: 50, updatedAt: 50 }
    ]
    expect([...entries].sort(compareCreatedAtEntries).map((entry) => entry.id)).toEqual([
      'favorite-old',
      'newer',
      'older-edited'
    ])
  })

  it('orders user dashboard summaries by createdAt instead of updatedAt', () => {
    const dashboard = (id: string, createdAt: number, updatedAt: number): Dashboard => ({
      id,
      name: id,
      width: 1024,
      height: 600,
      bg: '#000',
      elements: [],
      createdAt,
      updatedAt
    })
    const summaries = [
      summarizeDashboard(dashboard('older-edited', 100, 9999)),
      summarizeDashboard(dashboard('newer', 200, 200))
    ]
    expect(summaries.sort(compareCreatedAtEntries).map((entry) => entry.id)).toEqual([
      'newer',
      'older-edited'
    ])
  })

  it('uses controlled trigger and release tags on every alert-role module', () => {
    const alerts = HIFI_WIDGETS.filter((module) => module.role === 'alert')
    for (const module of alerts) {
      for (const tag of module.tags.filter((value) =>
        value === 'trigger-only' || value === 'trigger-edge' || value === 'trigger-hold' || value === 'release-a'
      )) {
        expect(isControlledTag(tag), `${module.id}: ${tag}`).toBe(true)
      }
      expect(module.tags).toContain('trigger-only')
      expect(module.tags).toContain('release-a')
    }
  })
})
