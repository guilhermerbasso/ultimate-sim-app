import { describe, expect, it } from 'vitest'
import type { Dashboard, DashboardElement } from '../dashboards'
import {
  PERCEPTUAL_SIMILARITY_THRESHOLDS,
  REQUIRED_PERCEPTUAL_STATES,
  STRUCTURAL_SIMILARITY_THRESHOLDS,
  compareDashboardStructures,
  createDashboardFingerprint,
  decideStructuralSimilarity,
  evaluatePerceptualSimilarity,
  type PerceptualStateMetrics,
  type RequiredPerceptualState
} from '.'

interface Box {
  x: number
  y: number
  w: number
  h: number
}

function widget(id: string, moduleId: string, box: Box): DashboardElement {
  return {
    id,
    type: 'overlaywidget',
    ...box,
    style: { color: '#ffffff', background: '#05070d' },
    widgetId: `hifi:${moduleId}`,
    hifiModuleId: moduleId
  }
}

function dashboard(id: string, elements: DashboardElement[]): Dashboard {
  return {
    id,
    name: `Dashboard ${id}`,
    width: 1024,
    height: 600,
    bg: '#000000',
    scaleMode: 'fit',
    createdAt: 1_000,
    updatedAt: 2_000,
    elements
  }
}

const BOXES = {
  topLeft: { x: 0, y: 0, w: 200, h: 100 },
  topRight: { x: 824, y: 0, w: 200, h: 100 },
  bottomLeft: { x: 0, y: 500, w: 200, h: 100 },
  bottomRight: { x: 824, y: 500, w: 200, h: 100 }
} as const

function perceptualMetric(
  state: RequiredPerceptualState,
  similar: boolean
): PerceptualStateMetrics {
  return similar
    ? {
        state,
        ssim: PERCEPTUAL_SIMILARITY_THRESHOLDS.ssimMinimum,
        pHashDistance: PERCEPTUAL_SIMILARITY_THRESHOLDS.pHashDistanceMaximum,
        pixelMismatchRatio: PERCEPTUAL_SIMILARITY_THRESHOLDS.pixelMismatchRatioMaximum,
        paletteSimilarity: PERCEPTUAL_SIMILARITY_THRESHOLDS.paletteSimilarityMinimum
      }
    : {
        state,
        ssim: 0.8,
        pHashDistance: 16,
        pixelMismatchRatio: 0.2,
        paletteSimilarity: 0.8
      }
}

describe('dashboard structural differentiation', () => {
  it('hard-fails exact canonical duplicates', () => {
    const original = dashboard('original', [
      widget('generated-a', 'speed', BOXES.topLeft),
      widget('generated-b', 'gear', BOXES.topRight)
    ])
    const duplicate = dashboard('duplicate', [
      widget('other-a', 'speed', BOXES.topLeft),
      widget('other-b', 'gear', BOXES.topRight)
    ])

    const comparison = compareDashboardStructures(original, duplicate)
    expect(comparison.metrics.exactCanonicalEquality).toBe(true)
    expect(comparison.decision.hardFail).toBe(true)
    expect(comparison.decision.reasons.map((reason) => reason.code))
      .toContain('exact-canonical-equality')
  })

  it('canonicalizes element order and generated ids away', () => {
    const first = dashboard('dash-m1', [
      widget('el-m1-a', 'speed', BOXES.topLeft),
      widget('el-m1-b', 'gear', BOXES.topRight),
      widget('el-m1-c', 'delta', BOXES.bottomLeft)
    ])
    const second = {
      ...dashboard('dash-random-42', [
        widget('el-random-z', 'delta', BOXES.bottomLeft),
        widget('el-random-y', 'gear', BOXES.topRight),
        widget('el-random-x', 'speed', BOXES.topLeft)
      ]),
      name: 'Renamed copy',
      createdAt: 999_999,
      updatedAt: 1_000_000
    }

    const firstFingerprint = createDashboardFingerprint(first)
    const secondFingerprint = createDashboardFingerprint(second)
    expect(secondFingerprint.canonical).toBe(firstFingerprint.canonical)
    expect(secondFingerprint.hash).toBe(firstFingerprint.hash)
  })

  it('hard-fails a near duplicate at the inclusive placement threshold', () => {
    const original = dashboard('original', [
      widget('a', 'speed', BOXES.topLeft),
      widget('b', 'gear', BOXES.topRight),
      widget('c', 'delta', BOXES.bottomLeft),
      widget('d', 'fuel', BOXES.bottomRight)
    ])
    const nearDuplicate = dashboard('near-duplicate', [
      widget('a2', 'speed', BOXES.topLeft),
      widget('b2', 'gear', BOXES.topRight),
      widget('c2', 'delta', BOXES.bottomRight),
      widget('d2', 'fuel', BOXES.bottomLeft)
    ])

    const comparison = compareDashboardStructures(original, nearDuplicate)
    expect(comparison.metrics.exactCanonicalEquality).toBe(false)
    expect(comparison.metrics.semanticWidgetJaccard).toBe(1)
    expect(comparison.metrics.geometryIou).toBe(1)
    expect(comparison.metrics.sameWidgetPlacement)
      .toBe(STRUCTURAL_SIMILARITY_THRESHOLDS.sameWidgetPlacement)
    expect(comparison.decision.hardFail).toBe(true)
    expect(comparison.decision.reasons.map((reason) => reason.code))
      .toContain('conjunctive-structural-thresholds')
  })

  it('allows a genuinely different widget set and topology', () => {
    const original = dashboard('original', [
      widget('a', 'speed', BOXES.topLeft),
      widget('b', 'gear', BOXES.topRight),
      widget('c', 'delta', BOXES.bottomLeft),
      widget('d', 'fuel', BOXES.bottomRight)
    ])
    const different = dashboard('different', [
      widget('e', 'track-map', { x: 350, y: 40, w: 324, h: 250 }),
      widget('f', 'standings', { x: 40, y: 330, w: 430, h: 230 }),
      widget('g', 'tyres', { x: 650, y: 330, w: 330, h: 230 })
    ])

    const comparison = compareDashboardStructures(original, different)
    expect(comparison.metrics.semanticWidgetJaccard).toBe(0)
    expect(comparison.metrics.sameWidgetPlacement).toBe(0)
    expect(comparison.metrics.overallSimilarity)
      .toBeLessThan(STRUCTURAL_SIMILARITY_THRESHOLDS.overallReject)
    expect(comparison.decision.hardFail).toBe(false)
  })

  it('treats the weighted 0.75 boundary as a hard failure', () => {
    const decision = decideStructuralSimilarity({
      exactCanonicalEquality: false,
      semanticWidgetJaccard: 0.79,
      geometryIou: 0.84,
      sameWidgetPlacement: 0.49,
      topology: 0.4,
      overallSimilarity: STRUCTURAL_SIMILARITY_THRESHOLDS.overallReject
    })

    expect(decision.hardFail).toBe(true)
    expect(decision.reasons.map((reason) => reason.code)).toEqual(['overall-similarity'])
  })
})

describe('dashboard perceptual differentiation', () => {
  it('cannot pass with incomplete deterministic state evidence', () => {
    const evidence = REQUIRED_PERCEPTUAL_STATES
      .slice(0, -1)
      .map((state) => perceptualMetric(state, false))

    const decision = evaluatePerceptualSimilarity(evidence)
    expect(decision.status).toBe('incomplete')
    expect(decision.complete).toBe(false)
    expect(decision.hardFail).toBe(true)
    expect(decision.missingStates).toEqual(['extreme'])
  })

  it('rejects when all perceptual thresholds match in four of eight states', () => {
    const evidence = REQUIRED_PERCEPTUAL_STATES.map((state, index) =>
      perceptualMetric(state, index < PERCEPTUAL_SIMILARITY_THRESHOLDS.similarStateRejectCount)
    )

    const decision = evaluatePerceptualSimilarity(evidence)
    expect(decision.status).toBe('rejected')
    expect(decision.complete).toBe(true)
    expect(decision.similarStates).toHaveLength(4)
    expect(decision.hardFail).toBe(true)
  })

  it('passes complete evidence when only three states reach all thresholds', () => {
    const evidence = REQUIRED_PERCEPTUAL_STATES.map((state, index) =>
      perceptualMetric(state, index < PERCEPTUAL_SIMILARITY_THRESHOLDS.similarStateRejectCount - 1)
    )

    const decision = evaluatePerceptualSimilarity(evidence)
    expect(decision.status).toBe('passed')
    expect(decision.complete).toBe(true)
    expect(decision.similarStates).toHaveLength(3)
    expect(decision.hardFail).toBe(false)
  })
})
