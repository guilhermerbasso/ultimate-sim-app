// WS-M — PURE coaching-heatmap logic (no React, no DOM, node-test friendly).
//
// This module turns a deterministic `CoachReport` (per-corner findings carrying a
// SIGNED `estTimeDeltaSec`) into a per-corner colour map for the track heatmap,
// plus the segment-selection helper that maps a lap-distance fraction back to the
// corner the driver is in. It is framework-free so the React surfaces (the
// interactive Coach panel, the read-only overlay and the dashboard widget) and
// the vitest suite all share ONE source of truth for the colour rule.
//
// Colour rule (the user's explicit scale, by signed `estTimeDeltaSec`):
//   • delta <  -band  → LOSS  → RED   (warm = you're slow there)
//   • |delta| <= band → ON-PAR→ GREEN (cool = on the standard)
//   • delta >  +band  → GAIN  → BLUE  (cool = much better; replicate it)
// Warm = bad, cool = good.

import type { CoachCornerRef, CoachFinding, CoachReport } from '../../../shared/coach'

export type HeatBucket = 'loss' | 'onpar' | 'gain' | 'unknown'

export interface HeatPalette {
  loss: string
  onpar: string
  gain: string
  /** Corner not yet evaluated (no reference lap) — neutral grey, NOT reassuring green. */
  unknown: string
  /** Track outline / "no corner map" stroke. */
  neutral: string
}

// Defaults mirror the dashboard/overlay GT3 tokens so every surface reads the
// same: RED #FF2200 (slow), GREEN #1AFF6E (on the pace), BLUE #00BFFF (better),
// GREY #6E7681 (not evaluated yet).
export const HEAT_COLORS: HeatPalette = {
  loss: '#FF2200',
  onpar: '#1AFF6E',
  gain: '#00BFFF',
  unknown: '#6E7681',
  neutral: '#3a4d63'
}

// Seconds: a corner whose dominant |delta| is within this band reads as ON-PAR
// (green). Mirrors the coach analyzer's `goodLossSec` so the heatmap and the
// findings list agree on what counts as "clean".
export const HEAT_ONPAR_BAND = 0.03

/**
 * Signed time impact of a finding, seconds (NEGATIVE = loss, POSITIVE = gain).
 * Prefers the explicit `estTimeDeltaSec`; falls back to `sign` × `estTimeLossSec`
 * so legacy/partial findings still colour correctly.
 */
export function findingDelta(
  finding: Pick<CoachFinding, 'estTimeDeltaSec' | 'estTimeLossSec' | 'sign'> | null | undefined
): number {
  if (!finding) return 0
  if (typeof finding.estTimeDeltaSec === 'number' && Number.isFinite(finding.estTimeDeltaSec)) {
    return finding.estTimeDeltaSec
  }
  const mag =
    typeof finding.estTimeLossSec === 'number' && Number.isFinite(finding.estTimeLossSec)
      ? Math.abs(finding.estTimeLossSec)
      : 0
  if (finding.sign === 'gain') return mag
  if (finding.sign === 'loss') return -mag
  return 0
}

/** Bucket a signed delta (seconds) into loss / on-par / gain. */
export function bucketForDelta(deltaSec: number, band = HEAT_ONPAR_BAND): HeatBucket {
  if (!Number.isFinite(deltaSec)) return 'onpar'
  if (deltaSec < -band) return 'loss'
  if (deltaSec > band) return 'gain'
  return 'onpar'
}

/** Resolve a signed delta directly to a colour (warm=loss, cool=on-par/gain). */
export function heatColorForDelta(
  deltaSec: number,
  opts?: { band?: number; palette?: HeatPalette }
): string {
  const palette = opts?.palette ?? HEAT_COLORS
  return palette[bucketForDelta(deltaSec, opts?.band ?? HEAT_ONPAR_BAND)]
}

/** What the detail panel should show for a bucket. */
export type HeatDetailKind = 'improve' | 'replicate' | 'onpar' | 'unknown'

export function detailKindForBucket(bucket: HeatBucket): HeatDetailKind {
  if (bucket === 'loss') return 'improve'
  if (bucket === 'gain') return 'replicate'
  if (bucket === 'unknown') return 'unknown'
  return 'onpar'
}

/** One numbered corner coloured by the driver's dominant performance there. */
export interface CornerHeat {
  /** 1-based corner number (Curva N). */
  index: number
  startPct: number
  apexPct: number
  endPct: number
  /** Signed delta (seconds) of the dominant finding driving the colour. */
  deltaSec: number
  bucket: HeatBucket
  color: string
  sign?: CoachFinding['sign']
  /** Finding with the largest |delta| — drives the colour + the panel headline. */
  dominant: CoachFinding | null
  /** ALL findings mapped to this corner, sorted worst/biggest-first (panel list). */
  findings: CoachFinding[]
}

/**
 * Group a report's findings by corner, pick the dominant delta per corner for the
 * colour, and keep the per-corner finding list for the detail panel.
 *
 * A corner with no findings reads as ON-PAR (green) ONLY when a reference lap was
 * available to compare against. With NO reference (`opts.hasReference === false`,
 * or — by default — a report carrying no findings at all, e.g. a brand-new track
 * /first lap), an un-evaluated corner reads as UNKNOWN (grey) instead of falsely
 * reassuring green.
 *
 * Returns [] when the report has no corner map (sector-only / not learned yet).
 */
export function buildCornerHeat(
  report: CoachReport | null | undefined,
  opts?: { band?: number; palette?: HeatPalette; hasReference?: boolean }
): CornerHeat[] {
  if (!report || !Array.isArray(report.corners) || report.corners.length === 0) return []
  const band = opts?.band ?? HEAT_ONPAR_BAND
  const palette = opts?.palette ?? HEAT_COLORS

  const byCorner = new Map<number, CoachFinding[]>()
  for (const finding of report.findings ?? []) {
    if (typeof finding.corner !== 'number') continue
    const list = byCorner.get(finding.corner) ?? []
    list.push(finding)
    byCorner.set(finding.corner, list)
  }

  // No explicit signal ⇒ infer a reference exists when the lap produced ANY
  // findings (the analyzer had something to compare/evaluate). An empty report
  // means nothing was evaluated, so un-found corners are UNKNOWN, not on-par.
  const hasReference = opts?.hasReference ?? (report.findings?.length ?? 0) > 0

  return report.corners.map((corner: CoachCornerRef) => {
    const findings = (byCorner.get(corner.index) ?? [])
      .slice()
      .sort((a, b) => Math.abs(findingDelta(b)) - Math.abs(findingDelta(a)))
    const dominant = findings[0] ?? null
    const deltaSec = dominant ? findingDelta(dominant) : 0
    const bucket: HeatBucket = dominant ? bucketForDelta(deltaSec, band) : hasReference ? 'onpar' : 'unknown'
    return {
      index: corner.index,
      startPct: corner.startPct,
      apexPct: corner.apexPct,
      endPct: corner.endPct,
      deltaSec,
      bucket,
      color: palette[bucket],
      sign: dominant?.sign,
      dominant,
      findings
    }
  })
}

/**
 * The corner that owns `lapDistPct`, or null on a straight. Handles a corner whose
 * window wraps across the start/finish line (startPct > endPct). This is the
 * segment-selection logic behind clicking the map.
 */
export function cornerHeatAt(
  corners: CornerHeat[] | null | undefined,
  lapDistPct: number
): CornerHeat | null {
  if (!corners || corners.length === 0 || !Number.isFinite(lapDistPct)) return null
  const pct = Math.max(0, Math.min(0.999999, lapDistPct))
  for (const corner of corners) {
    if (corner.startPct <= corner.endPct) {
      if (pct >= corner.startPct && pct < corner.endPct) return corner
    } else if (pct >= corner.startPct || pct < corner.endPct) {
      // Wrap-around corner crossing the start/finish seam.
      return corner
    }
  }
  return null
}

export interface HeatLegendItem {
  bucket: HeatBucket
  color: string
  label: string
}

/** Legend rows (PT-BR) — vermelho=ruim, verde=padrão, azul=muito melhor, cinza=não avaliada. */
export function heatLegend(palette: HeatPalette = HEAT_COLORS): HeatLegendItem[] {
  return [
    { bucket: 'loss', color: palette.loss, label: 'Vermelho · perdendo tempo' },
    { bucket: 'onpar', color: palette.onpar, label: 'Verde · no padrão' },
    { bucket: 'gain', color: palette.gain, label: 'Azul · muito melhor' },
    { bucket: 'unknown', color: palette.unknown, label: 'Cinza · sem referência' }
  ]
}

/** True when a heatmap has at least one corner to colour. */
export function hasCornerHeat(corners: CornerHeat[] | null | undefined): boolean {
  return Array.isArray(corners) && corners.length > 0
}
