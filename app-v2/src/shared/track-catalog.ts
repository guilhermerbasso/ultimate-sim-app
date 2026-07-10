import type { Corner } from '../main/track-map/corner-map'

export interface TrackCatalog {
  version: 1
  trackLayoutKey: string
  trackName: string
  trackConfigName?: string
  sectorStartsPct: number[]
  corners: {
    turn: number
    startPct: number
    apexPct: number
    endPct: number
    sector: number
  }[]
  generatedAt: number
}

/** Equal-width sector start fractions, e.g. n=3 → [0, 1/3, 2/3]. */
export function equalSectorStarts(n: number): number[] {
  const count = Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1
  const starts: number[] = []
  for (let i = 0; i < count; i += 1) starts.push(i / count)
  return starts
}

/**
 * 1-based sector index for a lap-distance fraction using official sector starts.
 * Invalid / empty starts fall back to equal thirds.
 */
export function sectorOfPct(lapDistPct: number, sectorStartsPct: number[]): number {
  const starts = normalizeSectorStarts(sectorStartsPct)
  const pct = normalizePct(lapDistPct)
  let sector = 1
  for (let i = 0; i < starts.length; i += 1) {
    if (pct >= starts[i]) sector = i + 1
    else break
  }
  return sector
}

export function buildTrackCatalog(
  trackName: string,
  corners: Corner[],
  sectorStartsPct: number[],
  trackConfigName?: string,
  now: number = Date.now()
): TrackCatalog {
  const config = (trackConfigName ?? '').trim()
  const starts = normalizeSectorStarts(sectorStartsPct)
  return {
    version: 1,
    trackLayoutKey: layoutKey(trackName, config),
    trackName,
    ...(config ? { trackConfigName: config } : {}),
    sectorStartsPct: starts,
    corners: Array.isArray(corners)
      ? corners.map((corner) => ({
          turn: corner.index,
          startPct: corner.startPct,
          apexPct: corner.apexPct,
          endPct: corner.endPct,
          sector: sectorOfPct(corner.apexPct, starts)
        }))
      : [],
    generatedAt: now
  }
}

export function locate(
  catalog: TrackCatalog | null | undefined,
  lapDistPct: number
): { turn?: number; sector: number } {
  const starts = catalog?.sectorStartsPct ?? []
  const pct = normalizePct(lapDistPct)
  const sector = sectorOfPct(pct, starts)
  const corner = catalog?.corners.find((candidate) => pctInExtent(pct, candidate.startPct, candidate.endPct))
  return {
    ...(corner ? { turn: corner.turn } : {}),
    sector
  }
}

export function isValidTrackCatalog(value: unknown): value is TrackCatalog {
  if (!isObject(value)) return false
  return (
    value.version === 1 &&
    typeof value.trackLayoutKey === 'string' &&
    typeof value.trackName === 'string' &&
    (value.trackConfigName === undefined || typeof value.trackConfigName === 'string') &&
    Array.isArray(value.sectorStartsPct) &&
    value.sectorStartsPct.every(isPct) &&
    Array.isArray(value.corners) &&
    value.corners.every(isCatalogCorner) &&
    typeof value.generatedAt === 'number' &&
    Number.isFinite(value.generatedAt)
  )
}

function normalizeSectorStarts(starts: number[]): number[] {
  if (!Array.isArray(starts)) return equalSectorStarts(3)
  const normalized = [...new Set(starts.filter(isPct).map((start) => normalizePct(start)))].sort((a, b) => a - b)
  if (normalized.length === 0) return equalSectorStarts(3)
  if (normalized[0] !== 0) normalized.unshift(0)
  return normalized
}

function normalizePct(value: number): number {
  if (!Number.isFinite(value)) return 0
  const wrapped = value % 1
  return wrapped < 0 ? wrapped + 1 : wrapped
}

function pctInExtent(pct: number, startPct: number, endPct: number): boolean {
  const start = normalizePct(startPct)
  const end = normalizePct(endPct)
  if (start <= end) return pct >= start && pct < end
  return pct >= start || pct < end
}

function layoutKey(trackName: string, trackConfigName?: string | null): string {
  const name = (trackName ?? '').trim()
  const config = (trackConfigName ?? '').trim()
  return config ? `${name} :: ${config}` : name
}

function isCatalogCorner(value: unknown): value is TrackCatalog['corners'][number] {
  if (!isObject(value)) return false
  return (
    typeof value.turn === 'number' &&
    Number.isInteger(value.turn) &&
    value.turn >= 1 &&
    isPct(value.startPct) &&
    isPct(value.apexPct) &&
    isPct(value.endPct) &&
    typeof value.sector === 'number' &&
    Number.isInteger(value.sector) &&
    value.sector >= 1
  )
}

function isPct(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 1
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
