export const RELEASE_A_CATALOG_ORDER = 20260714
export const RELEASE_A_RELEASED_AT = '2026-07-14'
export const RELEASE_A_TAG = 'release-a'

export interface CatalogOrderedEntry {
  id: string
  favorite?: boolean
  catalogOrder?: number
  releasedAt?: string
  priority?: number
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

export function compareCatalogEntries(
  left: CatalogOrderedEntry,
  right: CatalogOrderedEntry,
  favoritesFirst = false
): number {
  if (favoritesFirst) {
    const favorite = Number(Boolean(right.favorite)) - Number(Boolean(left.favorite))
    if (favorite !== 0) return favorite
  }
  const cohort = finiteOr(right.catalogOrder, 0) - finiteOr(left.catalogOrder, 0)
  if (cohort !== 0) return cohort
  const priority = finiteOr(left.priority, Number.MAX_SAFE_INTEGER) - finiteOr(right.priority, Number.MAX_SAFE_INTEGER)
  if (priority !== 0) return priority
  return compareIds(left.id, right.id)
}

export function compareCreatedAtEntries(
  left: { id: string; favorite?: boolean; createdAt?: number },
  right: { id: string; favorite?: boolean; createdAt?: number }
): number {
  const favorite = Number(Boolean(right.favorite)) - Number(Boolean(left.favorite))
  if (favorite !== 0) return favorite
  const created = finiteOr(right.createdAt, 0) - finiteOr(left.createdAt, 0)
  return created || compareIds(left.id, right.id)
}
