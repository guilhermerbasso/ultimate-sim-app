// WS-WIDGETS — PURE, framework-free shaping helpers that turn a deterministic
// `CoachReport` (delivered by `useCoachReport()`) into the small view models the
// new Live-Coach widgets need (tips text, condensed findings, per-sector delta
// bars). Kept LIB-LEVEL and side-effect-free (no React, no IPC) — exactly like
// lib/predictions.ts view builders — so BOTH the dashboard widgets
// (`dashboard/widgets/coach-engineer-widgets.tsx`) and the overlay widgets
// (`overlay/widgets/CoachEngineerWidgets.tsx`) share ONE source and the logic is
// trivially unit-testable.

import type { CoachFinding, CoachReport, CoachSeverity } from '../../../shared/coach'

/**
 * Semantic tone of a coach finding/sector. Warm tones (improve/warn/critical)
 * mark something to FIX; `good` is the only cool/green state — the fleet colour
 * rule (green is reserved for positives) holds here too.
 */
export type CoachTone = 'good' | 'improve' | 'warn' | 'critical'

/** Map a deterministic severity to a render tone. */
export function findingTone(severity: CoachSeverity): CoachTone {
  switch (severity) {
    case 'good':
      return 'good'
    case 'low':
      return 'improve'
    case 'med':
      return 'warn'
    case 'high':
      return 'critical'
    default:
      return 'improve'
  }
}

/**
 * The top actionable tips for the `coach-tips` widget. `report.findings` is
 * already ranked worst-first with `good`/`gain` findings sunk to the bottom, so
 * we surface the improvement findings first and only fall back to the clean
 * `good` findings when there is nothing to fix.
 */
export function topCoachTips(report: CoachReport | null, limit = 3): CoachFinding[] {
  if (!report || !Array.isArray(report.findings)) return []
  const n = Math.max(0, Math.floor(limit))
  const improve = report.findings.filter((f) => f.severity !== 'good')
  const base = improve.length > 0 ? improve : report.findings
  return base.slice(0, n)
}

/** Condensed, ranked findings list for the `coach-findings` widget. */
export function coachFindings(report: CoachReport | null, limit = 12): CoachFinding[] {
  if (!report || !Array.isArray(report.findings)) return []
  return report.findings.slice(0, Math.max(0, Math.floor(limit)))
}

/** Short PT-BR scope label for a finding (Curva N when mapped, else Sector N). */
export function findingScope(finding: CoachFinding): string {
  if (typeof finding.corner === 'number' && finding.corner > 0) return `Curva ${finding.corner}`
  if (typeof finding.sector === 'number' && finding.sector > 0) return `Sector ${finding.sector}`
  return 'Lap'
}

/** One per-sector delta bar for the `coach-sector-graph` widget. */
export interface SectorDeltaBar {
  sector: number
  /**
   * Signed seconds: 0 for a benchmark/clean sector, NEGATIVE for a sector that
   * lost time (so a graph can render losses below a baseline). Sectors never
   * carry a gain, so this is `0` or `< 0`.
   */
  deltaSec: number
  /** True when the sector is clean / not losing time → render it green. */
  good: boolean
  /** Absolute time lost in the sector, seconds (>= 0). Drives warm bar height. */
  timeLossSec: number
}

/**
 * Per-sector delta bars. A `benchmark` sector (or one with no measured loss) is
 * green; everything else is a warm loss bar scaled by `timeLossSec`.
 */
export function sectorDeltaBars(report: CoachReport | null): SectorDeltaBar[] {
  if (!report || !Array.isArray(report.sectors)) return []
  return report.sectors.map((s) => {
    const loss = Number.isFinite(s.timeLossSec) ? Math.max(0, s.timeLossSec) : 0
    const good = Boolean(s.benchmark) || loss <= 0
    return { sector: s.sector, deltaSec: good ? 0 : -loss, good, timeLossSec: loss }
  })
}
