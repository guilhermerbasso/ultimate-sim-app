import { describe, expect, it } from 'vitest'
import type { CoachFinding, CoachReport } from '../../../shared/coach'
import {
  HEAT_COLORS,
  HEAT_ONPAR_BAND,
  bucketForDelta,
  buildCornerHeat,
  cornerHeatAt,
  detailKindForBucket,
  findingDelta,
  hasCornerHeat,
  heatColorForDelta,
  heatLegend
} from './track-heatmap'

// Build a minimal finding; only the fields the heatmap reads are required.
function finding(partial: Partial<CoachFinding>): CoachFinding {
  return {
    id: partial.id ?? Math.random().toString(36).slice(2),
    kind: partial.kind ?? 'time-loss',
    sector: partial.sector ?? 1,
    corner: partial.corner,
    zonePctStart: partial.zonePctStart ?? 0,
    zonePctEnd: partial.zonePctEnd ?? 0.1,
    severity: partial.severity ?? 'med',
    estTimeLossSec: partial.estTimeLossSec ?? 0,
    estTimeDeltaSec: partial.estTimeDeltaSec,
    sign: partial.sign,
    title: partial.title ?? 't',
    detail: partial.detail ?? 'd',
    explanation: partial.explanation,
    evidence: partial.evidence ?? 'e',
    metrics: partial.metrics ?? {}
  }
}

function report(corners: Array<{ index: number; startPct: number; apexPct: number; endPct: number }>, findings: CoachFinding[]): CoachReport {
  return {
    generatedAt: 0,
    sampleCount: 0,
    sectors: [],
    findings,
    corners,
    cornerMetrics: [],
    summary: ''
  }
}

describe('bucketForDelta (delta → loss/onpar/gain)', () => {
  it('negative delta beyond the band is a LOSS (slow → red)', () => {
    expect(bucketForDelta(-0.2)).toBe('loss')
    expect(bucketForDelta(-(HEAT_ONPAR_BAND + 0.001))).toBe('loss')
  })

  it('positive delta beyond the band is a GAIN (much better → blue)', () => {
    expect(bucketForDelta(0.2)).toBe('gain')
    expect(bucketForDelta(HEAT_ONPAR_BAND + 0.001)).toBe('gain')
  })

  it('within the band (~0) is ON-PAR (green)', () => {
    expect(bucketForDelta(0)).toBe('onpar')
    expect(bucketForDelta(HEAT_ONPAR_BAND)).toBe('onpar')
    expect(bucketForDelta(-HEAT_ONPAR_BAND)).toBe('onpar')
  })

  it('non-finite deltas collapse to on-par (never reach SVG/colour as garbage)', () => {
    expect(bucketForDelta(Number.NaN)).toBe('onpar')
    expect(bucketForDelta(Number.POSITIVE_INFINITY)).toBe('onpar')
    expect(bucketForDelta(Number.NEGATIVE_INFINITY)).toBe('onpar')
  })

  it('respects a custom band', () => {
    expect(bucketForDelta(-0.05, 0.1)).toBe('onpar')
    expect(bucketForDelta(-0.15, 0.1)).toBe('loss')
  })
})

describe('heatColorForDelta', () => {
  it('maps each bucket to the warm/cool palette', () => {
    expect(heatColorForDelta(-1)).toBe(HEAT_COLORS.loss)
    expect(heatColorForDelta(0)).toBe(HEAT_COLORS.onpar)
    expect(heatColorForDelta(1)).toBe(HEAT_COLORS.gain)
  })

  it('honours a palette override', () => {
    const palette = { loss: '#a', onpar: '#b', gain: '#c', unknown: '#e', neutral: '#d' }
    expect(heatColorForDelta(-1, { palette })).toBe('#a')
    expect(heatColorForDelta(1, { palette })).toBe('#c')
  })
})

describe('findingDelta', () => {
  it('prefers the explicit signed delta', () => {
    expect(findingDelta(finding({ estTimeDeltaSec: -0.12, estTimeLossSec: 0.12 }))).toBeCloseTo(-0.12)
    expect(findingDelta(finding({ estTimeDeltaSec: 0.08 }))).toBeCloseTo(0.08)
  })

  it('falls back to sign × magnitude when no signed delta is present', () => {
    expect(findingDelta(finding({ sign: 'loss', estTimeLossSec: 0.2 }))).toBeCloseTo(-0.2)
    expect(findingDelta(finding({ sign: 'gain', estTimeLossSec: 0.05 }))).toBeCloseTo(0.05)
  })

  it('returns 0 for neutral/empty findings', () => {
    expect(findingDelta(finding({}))).toBe(0)
    expect(findingDelta(null)).toBe(0)
  })
})

describe('buildCornerHeat', () => {
  const corners = [
    { index: 1, startPct: 0.0, apexPct: 0.05, endPct: 0.1 },
    { index: 2, startPct: 0.4, apexPct: 0.45, endPct: 0.5 },
    { index: 3, startPct: 0.8, apexPct: 0.85, endPct: 0.9 }
  ]

  it('colours each corner by its DOMINANT (largest-magnitude) delta', () => {
    const r = report(corners, [
      finding({ corner: 1, estTimeDeltaSec: -0.05, sign: 'loss', title: 'small loss' }),
      finding({ corner: 1, estTimeDeltaSec: -0.25, sign: 'loss', title: 'big loss' }),
      finding({ corner: 2, estTimeDeltaSec: 0.18, sign: 'gain', title: 'gain' })
    ])
    const heat = buildCornerHeat(r)
    expect(heat).toHaveLength(3)

    const c1 = heat.find((c) => c.index === 1)!
    expect(c1.bucket).toBe('loss')
    expect(c1.color).toBe(HEAT_COLORS.loss)
    expect(c1.dominant?.title).toBe('big loss') // largest |delta| wins
    expect(c1.findings).toHaveLength(2) // keeps the whole list for the panel

    const c2 = heat.find((c) => c.index === 2)!
    expect(c2.bucket).toBe('gain')
    expect(c2.color).toBe(HEAT_COLORS.gain)

    const c3 = heat.find((c) => c.index === 3)!
    expect(c3.bucket).toBe('onpar') // no findings BUT a reference existed (lap had findings) → green
    expect(c3.color).toBe(HEAT_COLORS.onpar)
    expect(c3.findings).toHaveLength(0)
  })

  it('marks un-evaluated corners UNKNOWN (grey) when the lap has NO reference', () => {
    // A brand-new track / first lap: no findings at all → nothing was evaluated,
    // so corners must read neutral GREY, not falsely reassuring green.
    const heat = buildCornerHeat(report(corners, []))
    expect(heat).toHaveLength(3)
    expect(heat.every((c) => c.bucket === 'unknown')).toBe(true)
    expect(heat.every((c) => c.color === HEAT_COLORS.unknown)).toBe(true)
  })

  it('honours an explicit hasReference=false (no reference lap) → unknown', () => {
    const r = report(corners, [finding({ corner: 1, estTimeDeltaSec: -0.2, sign: 'loss' })])
    const heat = buildCornerHeat(r, { hasReference: false })
    expect(heat.find((c) => c.index === 1)!.bucket).toBe('loss') // a finding still colours
    expect(heat.find((c) => c.index === 2)!.bucket).toBe('unknown') // no finding + no reference
  })

  it('honours an explicit hasReference=true → un-found corners are on-par', () => {
    const heat = buildCornerHeat(report(corners, []), { hasReference: true })
    expect(heat.every((c) => c.bucket === 'onpar')).toBe(true)
  })

  it('ignores findings without a corner number', () => {
    const r = report(corners, [finding({ corner: undefined, estTimeDeltaSec: -0.5 })])
    const heat = buildCornerHeat(r)
    expect(heat.every((c) => c.findings.length === 0)).toBe(true)
  })

  it('returns [] when there is no corner map', () => {
    expect(buildCornerHeat(report([], [finding({ corner: 1, estTimeDeltaSec: -0.5 })]))).toEqual([])
    expect(buildCornerHeat(null)).toEqual([])
  })
})

describe('cornerHeatAt (lapDistPct → corner segment)', () => {
  const heat = buildCornerHeat(
    report(
      [
        { index: 1, startPct: 0.1, apexPct: 0.15, endPct: 0.2 },
        { index: 2, startPct: 0.5, apexPct: 0.55, endPct: 0.6 },
        // Wrap-around corner crossing the start/finish line.
        { index: 3, startPct: 0.95, apexPct: 0.98, endPct: 0.03 }
      ],
      []
    )
  )

  it('selects the corner whose window owns the point', () => {
    expect(cornerHeatAt(heat, 0.15)?.index).toBe(1)
    expect(cornerHeatAt(heat, 0.55)?.index).toBe(2)
  })

  it('returns null on a straight (between corners)', () => {
    expect(cornerHeatAt(heat, 0.35)).toBeNull()
  })

  it('handles the wrap-around corner on both sides of the seam', () => {
    expect(cornerHeatAt(heat, 0.97)?.index).toBe(3)
    expect(cornerHeatAt(heat, 0.01)?.index).toBe(3)
  })

  it('guards bad input', () => {
    expect(cornerHeatAt(heat, Number.NaN)).toBeNull()
    expect(cornerHeatAt([], 0.5)).toBeNull()
    expect(cornerHeatAt(null, 0.5)).toBeNull()
  })
})

describe('detailKindForBucket + legend', () => {
  it('routes the detail panel by colour', () => {
    expect(detailKindForBucket('loss')).toBe('improve')
    expect(detailKindForBucket('gain')).toBe('replicate')
    expect(detailKindForBucket('onpar')).toBe('onpar')
    expect(detailKindForBucket('unknown')).toBe('unknown')
  })

  it('exposes a 4-row legend in palette order', () => {
    const legend = heatLegend()
    expect(legend.map((l) => l.bucket)).toEqual(['loss', 'onpar', 'gain', 'unknown'])
    expect(legend[0].color).toBe(HEAT_COLORS.loss)
    expect(legend[3].color).toBe(HEAT_COLORS.unknown)
  })

  it('hasCornerHeat reflects whether there is anything to colour', () => {
    expect(hasCornerHeat([])).toBe(false)
    expect(hasCornerHeat(null)).toBe(false)
    expect(hasCornerHeat(buildCornerHeat(report([{ index: 1, startPct: 0, apexPct: 0.05, endPct: 0.1 }], [])))).toBe(true)
  })
})
