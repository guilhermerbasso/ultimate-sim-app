import { describe, expect, it } from 'vitest'
import { BUILTIN_PRESETS } from '../dashboards'
import type { Dashboard, DashboardElement, DashboardElementType } from '../dashboards'
import {
  DASHBOARD_RENDER_CAPABILITIES,
  PERCEPTUAL_SIMILARITY_THRESHOLDS,
  REQUIRED_PERCEPTUAL_STATES,
  STRUCTURAL_SIMILARITY_THRESHOLDS,
  compareDashboardStructures,
  createDashboardFingerprint,
  decideStructuralSimilarity,
  evaluatePerceptualPairEvidence,
  evaluatePerceptualSimilarity,
  parsePerceptualEvidenceDocument,
  perceptualPairKey,
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

function textElement(
  id: string,
  box: Box,
  options: { binding?: string; text?: string } = {}
): DashboardElement {
  return {
    id,
    type: 'text',
    ...box,
    binding: options.binding,
    style: { color: '#ffffff', text: options.text }
  }
}

function fullCanvasLayer(id: string, background: string): DashboardElement {
  return {
    id,
    type: 'rect',
    x: 0,
    y: 0,
    w: 1024,
    h: 600,
    style: { background }
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

  it('ignores renderer-inert channels metadata on text elements', () => {
    const firstText = textElement('first', BOXES.topLeft, { text: 'SPEED' })
    firstText.style.channels = ['ignored-one']
    const secondText = textElement('second', BOXES.topLeft, { text: 'SPEED' })
    secondText.style.channels = ['ignored-two']

    const first = dashboard('first', [firstText])
    const second = dashboard('second', [secondText])
    const comparison = compareDashboardStructures(first, second)
    expect(comparison.metrics.exactCanonicalEquality).toBe(true)
    expect(comparison.metrics.semanticWidgetJaccard).toBe(1)
    expect(comparison.decision.hardFail).toBe(true)
  })

  it('preserves source paint order for overlapping equal-z elements', () => {
    const redThenBlue = dashboard('red-blue', [
      fullCanvasLayer('red', '#ff0000'),
      fullCanvasLayer('blue', '#0000ff')
    ])
    const blueThenRed = dashboard('blue-red', [
      fullCanvasLayer('blue-copy', '#0000ff'),
      fullCanvasLayer('red-copy', '#ff0000')
    ])

    const firstFingerprint = createDashboardFingerprint(redThenBlue)
    const secondFingerprint = createDashboardFingerprint(blueThenRed)
    expect(secondFingerprint.canonical).not.toBe(firstFingerprint.canonical)
    expect(compareDashboardStructures(redThenBlue, blueThenRed).metrics.exactCanonicalEquality)
      .toBe(false)
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

  it('rejects a copied four-widget core diluted with four valid 1x1 text elements', () => {
    const original = dashboard('original', [
      widget('a', 'speed', BOXES.topLeft),
      widget('b', 'gear', BOXES.topRight),
      widget('c', 'delta', BOXES.bottomLeft),
      widget('d', 'fuel', BOXES.bottomRight)
    ])
    const dilutedCopy = dashboard('diluted-copy', [
      widget('copy-a', 'speed', BOXES.topLeft),
      widget('copy-b', 'gear', BOXES.topRight),
      widget('copy-c', 'delta', BOXES.bottomLeft),
      widget('copy-d', 'fuel', BOXES.bottomRight),
      textElement('tiny-1', { x: 500, y: 290, w: 1, h: 1 }, { text: 'noise-a' }),
      textElement('tiny-2', { x: 502, y: 290, w: 1, h: 1 }, { text: 'noise-b' }),
      textElement('tiny-3', { x: 504, y: 290, w: 1, h: 1 }, { text: 'noise-c' }),
      textElement('tiny-4', { x: 506, y: 290, w: 1, h: 1 }, { text: 'noise-d' })
    ])

    const comparison = compareDashboardStructures(original, dilutedCopy)
    expect(comparison.metrics.overallSimilarity)
      .toBeLessThan(STRUCTURAL_SIMILARITY_THRESHOLDS.overallReject)
    expect(comparison.metrics.areaWeightedContainment)
      .toBeGreaterThanOrEqual(STRUCTURAL_SIMILARITY_THRESHOLDS.areaWeightedContainment)
    expect(comparison.decision.hardFail).toBe(true)
    expect(comparison.decision.reasons.map((reason) => reason.code))
      .toContain('area-weighted-containment')
  })

  it('excludes transparent full-canvas rectangles from visual similarity', () => {
    const original = dashboard('original', [
      widget('a', 'speed', BOXES.topLeft),
      widget('b', 'gear', BOXES.topRight),
      widget('c', 'delta', BOXES.bottomLeft),
      widget('d', 'fuel', BOXES.bottomRight)
    ])
    const transparentLayer = (id: string): DashboardElement => ({
      id,
      type: 'rect',
      x: 0,
      y: 0,
      w: 1024,
      h: 600,
      style: { background: 'rgba(0, 0, 0, 0)', borderWidth: 0 }
    })
    const dilutedCopy = dashboard('transparent-dilution', [
      widget('copy-a', 'speed', BOXES.topLeft),
      widget('copy-b', 'gear', BOXES.topRight),
      widget('copy-c', 'delta', BOXES.bottomLeft),
      widget('copy-d', 'fuel', BOXES.bottomRight),
      transparentLayer('transparent-1'),
      transparentLayer('transparent-2'),
      transparentLayer('transparent-3')
    ])

    const originalFingerprint = createDashboardFingerprint(original)
    const dilutedFingerprint = createDashboardFingerprint(dilutedCopy)
    const comparison = compareDashboardStructures(original, dilutedCopy)
    expect(dilutedFingerprint.elementCount).toBe(originalFingerprint.elementCount)
    expect(dilutedFingerprint.canonical).toBe(originalFingerprint.canonical)
    expect(comparison.decision.hardFail).toBe(true)
  })

  it('excludes a redundant full-canvas backplate matching dashboard.bg', () => {
    const withoutBackplate = dashboard('without-backplate', [
      widget('speed', 'speed', BOXES.topLeft)
    ])
    const withBackplate = dashboard('with-backplate', [
      fullCanvasLayer('matching-backplate', '#000'),
      widget('speed-copy', 'speed', BOXES.topLeft)
    ])

    const first = createDashboardFingerprint(withoutBackplate)
    const second = createDashboardFingerprint(withBackplate)
    expect(second.elementCount).toBe(first.elementCount)
    expect(second.canonical).toBe(first.canonical)
  })

  it('does not reject race-wet-minimal vs ferrari_gt3 from matching backplates', () => {
    const wet = BUILTIN_PRESETS.find((preset) => preset.id === 'race-wet-minimal')
    const ferrari = BUILTIN_PRESETS.find((preset) => preset.id === 'ferrari_gt3')
    expect(wet).toBeDefined()
    expect(ferrari).toBeDefined()

    const comparison = compareDashboardStructures(wet!.build(), ferrari!.build())
    expect(comparison.decision.hardFail).toBe(false)
  })

  it.each([
    'mono-tile-minimal',
    'neon-ring-futuristic',
    'shiftbar',
    'trackmini'
  ] satisfies DashboardElementType[])(
    'includes binding identity for the %s renderer',
    (type) => {
      expect(DASHBOARD_RENDER_CAPABILITIES[type]?.consumesBinding).toBe(true)
      const speed = dashboard(`${type}-speed`, [{
        id: 'speed',
        type,
        ...BOXES.topLeft,
        binding: 'speedKmh',
        style: {}
      }])
      const rpm = dashboard(`${type}-rpm`, [{
        id: 'rpm',
        type,
        ...BOXES.topLeft,
        binding: 'rpm',
        style: {}
      }])

      const comparison = compareDashboardStructures(speed, rpm)
      expect(comparison.metrics.semanticWidgetJaccard).toBe(0)
      expect(comparison.metrics.exactCanonicalEquality).toBe(false)
    }
  )

  it('preserves case-sensitive binding identifiers', () => {
    const upperCaseBinding = dashboard('upper', [
      textElement('upper-binding', BOXES.topLeft, { binding: 'var:Fuel' })
    ])
    const lowerCaseBinding = dashboard('lower', [
      textElement('lower-binding', BOXES.topLeft, { binding: 'var:fuel' })
    ])

    const comparison = compareDashboardStructures(upperCaseBinding, lowerCaseBinding)
    expect(comparison.metrics.semanticWidgetJaccard).toBe(0)
    expect(comparison.metrics.sameWidgetPlacement).toBe(0)
    expect(comparison.metrics.areaWeightedContainment).toBe(0)
    expect(comparison.metrics.exactCanonicalEquality).toBe(false)
  })

  it('preserves binding identifier surrounding whitespace exactly', () => {
    const exactBinding = dashboard('exact', [
      textElement('exact-binding', BOXES.topLeft, { binding: 'speedKmh' })
    ])
    const spacedBinding = dashboard('spaced', [
      textElement('spaced-binding', BOXES.topLeft, { binding: ' speedKmh ' })
    ])

    const comparison = compareDashboardStructures(exactBinding, spacedBinding)
    expect(comparison.metrics.semanticWidgetJaccard).toBe(0)
    expect(comparison.metrics.exactCanonicalEquality).toBe(false)
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
      areaWeightedContainment: 0.74,
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

describe('candidate pair perceptual evidence', () => {
  const pair = { leftId: 'release-b-candidate', rightId: 'baseline-dashboard' }
  const document = (states: readonly PerceptualStateMetrics[]) =>
    parsePerceptualEvidenceDocument({
      schemaVersion: 1,
      pairs: [{ ...pair, states }]
    })

  it('marks missing pair evidence incomplete', () => {
    const [result] = evaluatePerceptualPairEvidence([pair])
    expect(result.key).toBe(perceptualPairKey(pair.leftId, pair.rightId))
    expect(result.evidencePresent).toBe(false)
    expect(result.decision.status).toBe('incomplete')
    expect(result.decision.hardFail).toBe(true)
  })

  it('marks seven-state pair evidence incomplete', () => {
    const states = REQUIRED_PERCEPTUAL_STATES
      .slice(0, -1)
      .map((state) => perceptualMetric(state, false))
    const [result] = evaluatePerceptualPairEvidence([pair], document(states))
    expect(result.evidencePresent).toBe(true)
    expect(result.decision.status).toBe('incomplete')
  })

  it('rejects pair evidence matching in four states', () => {
    const states = REQUIRED_PERCEPTUAL_STATES.map((state, index) =>
      perceptualMetric(state, index < PERCEPTUAL_SIMILARITY_THRESHOLDS.similarStateRejectCount)
    )
    const [result] = evaluatePerceptualPairEvidence([pair], document(states))
    expect(result.decision.status).toBe('rejected')
    expect(result.decision.hardFail).toBe(true)
  })

  it('passes complete pair evidence below perceptual thresholds', () => {
    const states = REQUIRED_PERCEPTUAL_STATES.map((state) => perceptualMetric(state, false))
    const [result] = evaluatePerceptualPairEvidence([pair], document(states))
    expect(result.decision.status).toBe('passed')
    expect(result.decision.hardFail).toBe(false)
  })
})
