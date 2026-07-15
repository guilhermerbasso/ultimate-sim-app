import type {
  Dashboard,
  DashboardElement,
  DashboardElementStyle,
  DashboardElementType
} from '../dashboards'

const NORMALIZED_PRECISION = 1_000_000
const GEOMETRY_EPSILON = 1 / NORMALIZED_PRECISION

export const STRUCTURAL_SIMILARITY_THRESHOLDS = {
  overallReject: 0.75,
  semanticWidgetJaccard: 0.8,
  geometryIou: 0.85,
  sameWidgetPlacement: 0.5
} as const

export const STRUCTURAL_SIMILARITY_WEIGHTS = {
  semanticWidgetJaccard: 0.3,
  geometryIou: 0.25,
  sameWidgetPlacement: 0.3,
  topology: 0.15
} as const

export interface NormalizedRectangle {
  x: number
  y: number
  width: number
  height: number
}

export interface NormalizedDashboardElement {
  type: DashboardElementType
  semanticKey: string
  rect: NormalizedRectangle
}

export interface DashboardTopologySignature {
  tokens: readonly string[]
  canonical: string
}

export interface DashboardFingerprint {
  hash: string
  canonical: string
  canvasAspectRatio: number
  elementCount: number
  geometry: readonly NormalizedDashboardElement[]
  semanticWidgetSet: readonly string[]
  topology: DashboardTopologySignature
}

export interface StructuralSimilarityMetrics {
  exactCanonicalEquality: boolean
  semanticWidgetJaccard: number
  geometryIou: number
  sameWidgetPlacement: number
  topology: number
  overallSimilarity: number
}

export type StructuralWarningCode =
  | 'semantic-widget-jaccard'
  | 'geometry-iou'
  | 'same-widget-placement'

export interface StructuralWarning {
  code: StructuralWarningCode
  value: number
  threshold: number
  message: string
}

export type StructuralRejectionCode =
  | 'exact-canonical-equality'
  | 'overall-similarity'
  | 'conjunctive-structural-thresholds'

export interface StructuralRejectionReason {
  code: StructuralRejectionCode
  message: string
}

export interface StructuralSimilarityDecision {
  hardFail: boolean
  reasons: readonly StructuralRejectionReason[]
  warnings: readonly StructuralWarning[]
}

export interface StructuralComparison {
  metrics: StructuralSimilarityMetrics
  decision: StructuralSimilarityDecision
}

type CanonicalJson =
  | null
  | boolean
  | number
  | string
  | CanonicalJson[]
  | { [key: string]: CanonicalJson }

export class DashboardFingerprintError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DashboardFingerprintError'
  }
}

function roundNormalized(value: number): number {
  const rounded = Math.round(value * NORMALIZED_PRECISION) / NORMALIZED_PRECISION
  return Object.is(rounded, -0) ? 0 : rounded
}

function clampSimilarity(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function normalizedText(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, ' ').toLowerCase()
  return normalized ? normalized : undefined
}

function semanticArray(values: readonly string[] | undefined): string[] {
  if (!values) return []
  return [...new Set(values.map(normalizedText).filter((value): value is string => Boolean(value)))].sort()
}

export function semanticWidgetKey(element: DashboardElement): string {
  const style = element.style
  const widgetId = normalizedText(element.widgetId)
  const hifiModuleId = normalizedText(element.hifiModuleId) ??
    (widgetId?.startsWith('hifi:') ? widgetId.slice('hifi:'.length) : undefined)

  if (hifiModuleId) return `${element.type}|hifi:${hifiModuleId}`
  if (widgetId) return `${element.type}|widget:${widgetId}`

  const bindings = semanticArray([
    element.binding,
    style.secondaryBinding,
    style.dryndaryBinding,
    style.bindingWater,
    style.bindingOil,
    style.bindingOilPressure,
    style.bindingAbs,
    style.bindingTc,
    style.bindingMap,
    style.bindingBrakeBias
  ].filter((value): value is string => typeof value === 'string'))
  const descriptors = semanticArray([
    style.chartSource,
    style.heatSource,
    style.statusKind,
    style.flagKey,
    ...semanticArray(style.channels),
    ...semanticArray(style.fields)
  ].filter((value): value is string => typeof value === 'string'))
  const literal = bindings.length === 0
    ? normalizedText(style.text ?? style.label ?? style.title)
    : undefined

  return JSON.stringify([
    element.type,
    bindings,
    descriptors,
    literal ?? null
  ])
}

function assertFingerprintableDashboard(dashboard: Dashboard): void {
  if (!Number.isFinite(dashboard.width) || dashboard.width <= 0) {
    throw new DashboardFingerprintError('Dashboard width must be positive and finite.')
  }
  if (!Number.isFinite(dashboard.height) || dashboard.height <= 0) {
    throw new DashboardFingerprintError('Dashboard height must be positive and finite.')
  }
  if (!Array.isArray(dashboard.elements)) {
    throw new DashboardFingerprintError('Dashboard elements must be an array.')
  }

  dashboard.elements.forEach((element, index) => {
    if (!Number.isFinite(element.x) || !Number.isFinite(element.y) ||
      !Number.isFinite(element.w) || !Number.isFinite(element.h)) {
      throw new DashboardFingerprintError(`Dashboard element ${index} geometry must be finite.`)
    }
    if (element.x < 0 || element.y < 0 || element.w <= 0 || element.h <= 0 ||
      element.x + element.w > dashboard.width + GEOMETRY_EPSILON ||
      element.y + element.h > dashboard.height + GEOMETRY_EPSILON) {
      throw new DashboardFingerprintError(`Dashboard element ${index} geometry must stay inside the canvas.`)
    }
    if (!element.style || typeof element.style !== 'object' || Array.isArray(element.style)) {
      throw new DashboardFingerprintError(`Dashboard element ${index} style must be an object.`)
    }
  })
}

export function normalizeRectangle(
  element: Pick<DashboardElement, 'x' | 'y' | 'w' | 'h'>,
  canvas: Pick<Dashboard, 'width' | 'height'>
): NormalizedRectangle {
  if (!Number.isFinite(canvas.width) || canvas.width <= 0 ||
    !Number.isFinite(canvas.height) || canvas.height <= 0) {
    throw new DashboardFingerprintError('Canvas dimensions must be positive and finite.')
  }
  return {
    x: roundNormalized(element.x / canvas.width),
    y: roundNormalized(element.y / canvas.height),
    width: roundNormalized(element.w / canvas.width),
    height: roundNormalized(element.h / canvas.height)
  }
}

function compareNormalizedElements(
  left: NormalizedDashboardElement,
  right: NormalizedDashboardElement
): number {
  return left.semanticKey.localeCompare(right.semanticKey) ||
    left.rect.y - right.rect.y ||
    left.rect.x - right.rect.x ||
    left.rect.height - right.rect.height ||
    left.rect.width - right.rect.width ||
    left.type.localeCompare(right.type)
}

export function normalizeDashboardGeometry(
  dashboard: Dashboard
): readonly NormalizedDashboardElement[] {
  assertFingerprintableDashboard(dashboard)
  return dashboard.elements
    .filter((element) => element.visible !== false)
    .map((element) => ({
      type: element.type,
      semanticKey: semanticWidgetKey(element),
      rect: normalizeRectangle(element, dashboard)
    }))
    .sort(compareNormalizedElements)
}

export function semanticWidgetSet(
  elements: readonly NormalizedDashboardElement[]
): readonly string[] {
  return [...new Set(elements.map((element) => element.semanticKey))].sort()
}

export function jaccardSimilarity(
  leftValues: readonly string[],
  rightValues: readonly string[]
): number {
  const left = new Set(leftValues)
  const right = new Set(rightValues)
  if (left.size === 0 && right.size === 0) return 1

  let intersection = 0
  for (const value of left) {
    if (right.has(value)) intersection += 1
  }
  return intersection / (left.size + right.size - intersection)
}

export function rectangleIou(
  left: NormalizedRectangle,
  right: NormalizedRectangle
): number {
  const intersectionWidth = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x)
  )
  const intersectionHeight = Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y)
  )
  const intersection = intersectionWidth * intersectionHeight
  if (intersection === 0) return 0
  const union = left.width * left.height + right.width * right.height - intersection
  return union > 0 ? roundNormalized(clampSimilarity(intersection / union)) : 0
}

function directionalBestMatch(
  source: readonly NormalizedDashboardElement[],
  target: readonly NormalizedDashboardElement[],
  sameWidgetOnly: boolean
): number {
  if (source.length === 0) return target.length === 0 ? 1 : 0
  if (target.length === 0) return 0

  let total = 0
  for (const sourceElement of source) {
    let best = 0
    for (const targetElement of target) {
      if (sameWidgetOnly && sourceElement.semanticKey !== targetElement.semanticKey) continue
      best = Math.max(best, rectangleIou(sourceElement.rect, targetElement.rect))
    }
    total += best
  }
  return total / source.length
}

export function symmetricRectangleIouSimilarity(
  left: readonly NormalizedDashboardElement[],
  right: readonly NormalizedDashboardElement[]
): number {
  if (left.length === 0 && right.length === 0) return 1
  return roundNormalized(clampSimilarity(
    (directionalBestMatch(left, right, false) + directionalBestMatch(right, left, false)) / 2
  ))
}

export function sameWidgetPlacementSimilarity(
  left: readonly NormalizedDashboardElement[],
  right: readonly NormalizedDashboardElement[]
): number {
  if (left.length === 0 && right.length === 0) return 1
  return roundNormalized(clampSimilarity(
    (directionalBestMatch(left, right, true) + directionalBestMatch(right, left, true)) / 2
  ))
}

function band(value: number, count: number): number {
  return Math.min(count - 1, Math.max(0, Math.floor(value * count)))
}

function sizeBand(value: number): 'xs' | 'sm' | 'md' | 'lg' {
  if (value < 0.15) return 'xs'
  if (value < 0.35) return 'sm'
  if (value < 0.65) return 'md'
  return 'lg'
}

function aspectBand(rect: NormalizedRectangle): 'tall' | 'square' | 'wide' {
  const ratio = rect.width / rect.height
  if (ratio < 0.75) return 'tall'
  if (ratio > 1.5) return 'wide'
  return 'square'
}

function topologyToken(parts: readonly (string | number)[]): string {
  return JSON.stringify(parts)
}

export function createTopologySignature(
  elements: readonly NormalizedDashboardElement[]
): DashboardTopologySignature {
  const tokens: string[] = []
  const positioned = elements.map((element) => ({
    ...element,
    centerX: element.rect.x + element.rect.width / 2,
    centerY: element.rect.y + element.rect.height / 2
  }))

  for (const element of positioned) {
    tokens.push(topologyToken([
      'node',
      element.semanticKey,
      band(element.centerX, 4),
      band(element.centerY, 3),
      sizeBand(element.rect.width),
      sizeBand(element.rect.height),
      aspectBand(element.rect)
    ]))
  }

  for (let row = 0; row < 3; row += 1) {
    const members = positioned
      .filter((element) => band(element.centerY, 3) === row)
      .sort((left, right) => left.centerX - right.centerX || compareNormalizedElements(left, right))
      .map((element) => element.semanticKey)
    if (members.length > 0) tokens.push(topologyToken(['row', row, ...members]))
  }

  for (let column = 0; column < 4; column += 1) {
    const members = positioned
      .filter((element) => band(element.centerX, 4) === column)
      .sort((left, right) => left.centerY - right.centerY || compareNormalizedElements(left, right))
      .map((element) => element.semanticKey)
    if (members.length > 0) tokens.push(topologyToken(['column', column, ...members]))
  }

  tokens.sort()
  return { tokens, canonical: JSON.stringify(tokens) }
}

function multisetJaccardSimilarity(
  leftValues: readonly string[],
  rightValues: readonly string[]
): number {
  const counts = (values: readonly string[]): Map<string, number> => {
    const result = new Map<string, number>()
    for (const value of values) result.set(value, (result.get(value) ?? 0) + 1)
    return result
  }
  const left = counts(leftValues)
  const right = counts(rightValues)
  const keys = new Set([...left.keys(), ...right.keys()])
  if (keys.size === 0) return 1

  let intersection = 0
  let union = 0
  for (const key of keys) {
    intersection += Math.min(left.get(key) ?? 0, right.get(key) ?? 0)
    union += Math.max(left.get(key) ?? 0, right.get(key) ?? 0)
  }
  return union > 0 ? intersection / union : 1
}

export function topologySimilarity(
  left: DashboardTopologySignature,
  right: DashboardTopologySignature
): number {
  return multisetJaccardSimilarity(left.tokens, right.tokens)
}

function canonicalizeValue(value: unknown, path: string): CanonicalJson | undefined {
  if (value === undefined) return undefined
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new DashboardFingerprintError(`${path} must not contain non-finite numbers.`)
    }
    return roundNormalized(value)
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => canonicalizeValue(entry, `${path}[${index}]`) ?? null)
  }
  if (typeof value === 'object') {
    const output: { [key: string]: CanonicalJson } = {}
    for (const key of Object.keys(value).sort()) {
      const entry = canonicalizeValue((value as Record<string, unknown>)[key], `${path}.${key}`)
      if (entry !== undefined) output[key] = entry
    }
    return output
  }
  throw new DashboardFingerprintError(`${path} contains an unsupported ${typeof value} value.`)
}

function canonicalElement(
  element: DashboardElement,
  dashboard: Dashboard
): CanonicalJson {
  return {
    type: element.type,
    semanticKey: semanticWidgetKey(element),
    binding: element.binding?.trim() ?? null,
    rect: canonicalizeValue(normalizeRectangle(element, dashboard), 'element.rect') as CanonicalJson,
    style: canonicalizeValue(element.style satisfies DashboardElementStyle, 'element.style') as CanonicalJson
  }
}

function fingerprintHash(canonical: string): string {
  let hash = 0xcbf29ce484222325n
  const bytes = new TextEncoder().encode(canonical)
  for (const byte of bytes) {
    hash ^= BigInt(byte)
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return `fnv1a64:${hash.toString(16).padStart(16, '0')}`
}

export function createDashboardFingerprint(dashboard: Dashboard): DashboardFingerprint {
  const geometry = normalizeDashboardGeometry(dashboard)
  const topology = createTopologySignature(geometry)
  const canonicalElements = dashboard.elements
    .filter((element) => element.visible !== false)
    .map((element) => JSON.stringify(canonicalElement(element, dashboard)))
    .sort()
    .map((element) => JSON.parse(element) as CanonicalJson)
  const canonical = JSON.stringify({
    schemaVersion: 1,
    canvas: {
      aspectRatio: roundNormalized(dashboard.width / dashboard.height),
      background: dashboard.bg.trim(),
      scaleMode: dashboard.scaleMode ?? 'fit'
    },
    elements: canonicalElements
  })

  return {
    hash: fingerprintHash(canonical),
    canonical,
    canvasAspectRatio: roundNormalized(dashboard.width / dashboard.height),
    elementCount: geometry.length,
    geometry,
    semanticWidgetSet: semanticWidgetSet(geometry),
    topology
  }
}

export function computeWeightedSimilarity(
  metrics: Pick<
    StructuralSimilarityMetrics,
    'semanticWidgetJaccard' | 'geometryIou' | 'sameWidgetPlacement' | 'topology'
  >
): number {
  return roundNormalized(clampSimilarity(
    metrics.semanticWidgetJaccard * STRUCTURAL_SIMILARITY_WEIGHTS.semanticWidgetJaccard +
    metrics.geometryIou * STRUCTURAL_SIMILARITY_WEIGHTS.geometryIou +
    metrics.sameWidgetPlacement * STRUCTURAL_SIMILARITY_WEIGHTS.sameWidgetPlacement +
    metrics.topology * STRUCTURAL_SIMILARITY_WEIGHTS.topology
  ))
}

export function decideStructuralSimilarity(
  metrics: StructuralSimilarityMetrics
): StructuralSimilarityDecision {
  const warnings: StructuralWarning[] = []
  if (metrics.semanticWidgetJaccard >= STRUCTURAL_SIMILARITY_THRESHOLDS.semanticWidgetJaccard) {
    warnings.push({
      code: 'semantic-widget-jaccard',
      value: metrics.semanticWidgetJaccard,
      threshold: STRUCTURAL_SIMILARITY_THRESHOLDS.semanticWidgetJaccard,
      message: 'Semantic widget-set overlap reached the structural warning threshold.'
    })
  }
  if (metrics.geometryIou >= STRUCTURAL_SIMILARITY_THRESHOLDS.geometryIou) {
    warnings.push({
      code: 'geometry-iou',
      value: metrics.geometryIou,
      threshold: STRUCTURAL_SIMILARITY_THRESHOLDS.geometryIou,
      message: 'Symmetric rectangle IoU reached the structural warning threshold.'
    })
  }
  if (metrics.sameWidgetPlacement >= STRUCTURAL_SIMILARITY_THRESHOLDS.sameWidgetPlacement) {
    warnings.push({
      code: 'same-widget-placement',
      value: metrics.sameWidgetPlacement,
      threshold: STRUCTURAL_SIMILARITY_THRESHOLDS.sameWidgetPlacement,
      message: 'Same-widget placement similarity reached the structural warning threshold.'
    })
  }

  const reasons: StructuralRejectionReason[] = []
  if (metrics.exactCanonicalEquality) {
    reasons.push({
      code: 'exact-canonical-equality',
      message: 'Canonical dashboard fingerprints are exactly equal.'
    })
  }
  if (metrics.overallSimilarity >= STRUCTURAL_SIMILARITY_THRESHOLDS.overallReject) {
    reasons.push({
      code: 'overall-similarity',
      message: `Weighted structural similarity is at least ${STRUCTURAL_SIMILARITY_THRESHOLDS.overallReject}.`
    })
  }
  if (
    metrics.semanticWidgetJaccard >= STRUCTURAL_SIMILARITY_THRESHOLDS.semanticWidgetJaccard &&
    metrics.geometryIou >= STRUCTURAL_SIMILARITY_THRESHOLDS.geometryIou &&
    metrics.sameWidgetPlacement >= STRUCTURAL_SIMILARITY_THRESHOLDS.sameWidgetPlacement
  ) {
    reasons.push({
      code: 'conjunctive-structural-thresholds',
      message: 'Semantic, geometry, and same-widget placement thresholds were reached together.'
    })
  }

  return { hardFail: reasons.length > 0, reasons, warnings }
}

export function compareDashboardFingerprints(
  left: DashboardFingerprint,
  right: DashboardFingerprint
): StructuralComparison {
  const componentMetrics = {
    semanticWidgetJaccard: jaccardSimilarity(left.semanticWidgetSet, right.semanticWidgetSet),
    geometryIou: symmetricRectangleIouSimilarity(left.geometry, right.geometry),
    sameWidgetPlacement: sameWidgetPlacementSimilarity(left.geometry, right.geometry),
    topology: topologySimilarity(left.topology, right.topology)
  }
  const metrics: StructuralSimilarityMetrics = {
    exactCanonicalEquality: left.canonical === right.canonical,
    ...componentMetrics,
    overallSimilarity: computeWeightedSimilarity(componentMetrics)
  }
  return { metrics, decision: decideStructuralSimilarity(metrics) }
}

export function compareDashboardStructures(
  left: Dashboard,
  right: Dashboard
): StructuralComparison {
  return compareDashboardFingerprints(
    createDashboardFingerprint(left),
    createDashboardFingerprint(right)
  )
}
