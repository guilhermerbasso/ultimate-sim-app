import type { TelemetrySnapshot } from '../../shared/telemetry'
import type { TrackMapLayoutLookup } from '../../shared/track-map'
export type TrackLayoutIdentity = Readonly<{
  key: string
  readonly trackId?: number
  trackName: string
  trackConfigName?: string
}>
export type TrackCatalogLayout = { trackId: number; trackName: string; trackConfigName?: string | null }
export function normalizeLayoutPart(value: string | undefined | null): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
export function captureTrackLayout(input: TrackMapLayoutLookup): TrackLayoutIdentity | null {
  const trackName = typeof input.trackName === 'string' ? input.trackName.trim() : ''
  if (!trackName) return null
  const config = typeof input.trackConfigName === 'string' ? input.trackConfigName.trim() : ''
  const trackConfigName = config || undefined
  const trackId = typeof input.trackId === 'number' && Number.isSafeInteger(input.trackId) && input.trackId > 0
    ? input.trackId : undefined
  const key = trackId
    ? `id:${trackId}`
    : `name:${encodeURIComponent(normalizeLayoutPart(trackName))}|config:${encodeURIComponent(normalizeLayoutPart(trackConfigName))}`
  return Object.freeze({ key, trackId, trackName, trackConfigName })
}
export function trackLayoutFromSnapshot(snapshot: TelemetrySnapshot): TrackLayoutIdentity | null {
  const extra = snapshot as TelemetrySnapshot & { trackId?: unknown; track_id?: unknown }
  const rawTrackId = extra.trackId ?? extra.track_id
  const numericTrackId = typeof rawTrackId === 'string' ? Number(rawTrackId) : rawTrackId
  return captureTrackLayout({
    trackId: typeof numericTrackId === 'number' ? numericTrackId : undefined,
    trackName: snapshot.trackName ?? '',
    trackConfigName: snapshot.trackConfigName
  })
}
export function trackLayoutFromCatalog(row: TrackCatalogLayout): TrackLayoutIdentity {
  return captureTrackLayout({ trackId: row.trackId, trackName: row.trackName, trackConfigName: row.trackConfigName ?? undefined })!
}
export function catalogLayoutsForVenue(trackName: string, catalog: readonly TrackCatalogLayout[]): TrackCatalogLayout[] {
  const venue = normalizeLayoutPart(trackName)
  return catalog.filter((row) => normalizeLayoutPart(row.trackName) === venue)
}
export function layoutAliasKeys(layout: TrackMapLayoutLookup): string[] {
  const keys = new Set<string>()
  const direct = captureTrackLayout({
    trackName: layout.trackName,
    trackConfigName: layout.trackConfigName
  })
  if (direct) keys.add(direct.key)
  const combined = splitCombinedDisplayName(layout.trackName)
  const config = normalizeLayoutPart(layout.trackConfigName)
  if (combined && (!config || normalizeLayoutPart(combined.config) === config)) {
    const parsed = captureTrackLayout({
      trackName: combined.venue,
      trackConfigName: layout.trackConfigName ?? combined.config
    })
    if (parsed) keys.add(parsed.key)
  }
  return Array.from(keys)
}
export function findCatalogLayout(layout: TrackLayoutIdentity, catalog: readonly TrackCatalogLayout[]): TrackCatalogLayout | null {
  if (layout.trackId) return catalog.find((row) => row.trackId === layout.trackId) ?? null
  const config = normalizeLayoutPart(layout.trackConfigName)
  const combined = splitCombinedDisplayName(layout.trackName)
  const pairs = [{ venue: normalizeLayoutPart(layout.trackName), config }]
  if (combined && (!config || normalizeLayoutPart(combined.config) === config)) {
    pairs.push({ venue: normalizeLayoutPart(combined.venue), config: config || normalizeLayoutPart(combined.config) })
  }
  const matches = catalog.filter((row) => pairs.some((pair) =>
    pair.config &&
    normalizeLayoutPart(row.trackName) === pair.venue &&
    normalizeLayoutPart(row.trackConfigName) === pair.config
  ))
  if (matches.length === 1) return matches[0]
  if (matches.length > 1 || config || combined) return null
  const venueRows = catalogLayoutsForVenue(layout.trackName, catalog)
  return venueRows.length === 1 ? venueRows[0] : null
}
function splitCombinedDisplayName(value: string): { venue: string; config: string } | null {
  const match = value.trim().match(/^(.+?)\s+[-–—]\s+(.+)$/)
  return match ? { venue: match[1].trim(), config: match[2].trim() } : null
}
export function layoutFileStem(layout: TrackLayoutIdentity): string {
  if (layout.trackId) return `track-${layout.trackId}`
  const safe = (value: string): string => value.replace(/\s+/g, '_') || 'none'
  return `name-${safe(normalizeLayoutPart(layout.trackName))}__config-${safe(normalizeLayoutPart(layout.trackConfigName))}`
}
