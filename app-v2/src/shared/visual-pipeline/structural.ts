import type {
  Dashboard,
  DashboardElement,
  DashboardElementStyle,
  DashboardElementType
} from '../dashboards'
import { resolveDashboardScaleMode } from '../dashboards'
import { dashboardElementConsumesBinding } from './render-capabilities'

const NORMALIZED_PRECISION = 1_000_000
const GEOMETRY_EPSILON = 1 / NORMALIZED_PRECISION

export const STRUCTURAL_SIMILARITY_THRESHOLDS = {
  overallReject: 0.75,
  semanticWidgetJaccard: 0.8,
  geometryIou: 0.85,
  sameWidgetPlacement: 0.5,
  areaWeightedContainment: 0.75
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
  areaWeightedContainment: number
  topology: number
  overallSimilarity: number
}

export type StructuralWarningCode =
  | 'semantic-widget-jaccard'
  | 'geometry-iou'
  | 'same-widget-placement'
  | 'area-weighted-containment'

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
  | 'area-weighted-containment'

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

function runtimeIdentifier(value: string | undefined): string | undefined {
  return value === undefined || value.length === 0 ? undefined : value
}

function normalizedHumanText(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, ' ').toLowerCase()
  return normalized ? normalized : undefined
}

type SemanticStyleField =
  | 'secondaryBinding'
  | 'flagKey'
  | 'chartSource'
  | 'heatSource'
  | 'statusKind'
  | 'statusOnText'
  | 'statusOffText'
  | 'channels'
  | 'fields'
  | 'bindingWater'
  | 'bindingOil'
  | 'bindingOilPressure'
  | 'bindingAbs'
  | 'bindingTc'
  | 'bindingMap'
  | 'bindingBrakeBias'

const SEMANTIC_STYLE_FIELDS: Partial<Record<DashboardElementType, readonly SemanticStyleField[]>> = {
  dualbar: ['secondaryBinding'],
  trace: ['secondaryBinding'],
  flag: ['flagKey'],
  barchart: ['chartSource'],
  radialbars: ['chartSource'],
  heatmap: ['heatSource'],
  statuslamp: ['statusKind', 'statusOnText', 'statusOffText'],
  inputbars: ['channels'],
  inputtrace: ['channels'],
  'inputs-clean': ['channels'],
  'inputs-elaborate': ['channels'],
  setupstrip: ['fields', 'bindingAbs', 'bindingTc', 'bindingMap', 'bindingBrakeBias'],
  enginetemps: ['bindingWater', 'bindingOil', 'bindingOilPressure']
}

function effectiveSemanticStyleValue(
  element: DashboardElement,
  field: SemanticStyleField
): unknown {
  const style = element.style
  switch (field) {
    case 'secondaryBinding':
      return element.type === 'dualbar' ? style.secondaryBinding ?? 'brake' : style.secondaryBinding
    case 'chartSource':
      return element.type === 'barchart'
        ? style.chartSource ?? 'tyreTemp'
        : element.type === 'radialbars'
          ? style.chartSource ?? 'tyreWear'
          : style.chartSource
    case 'heatSource':
      return style.heatSource ?? 'tyre'
    case 'statusKind':
      return style.statusKind ?? 'abs'
    case 'statusOnText':
      return element.binding ? style.statusOnText ?? 'ON' : undefined
    case 'statusOffText':
      return element.binding ? style.statusOffText ?? 'OFF' : undefined
    case 'channels':
      if (element.type === 'inputbars' || element.type === 'inputtrace') {
        return style.channels && style.channels.length > 0
          ? [...style.channels]
          : ['throttle', 'brake']
      }
      if (element.type === 'inputs-clean' || element.type === 'inputs-elaborate') {
        return style.channels === undefined
          ? ['throttle', 'brake', 'clutch']
          : [...style.channels]
      }
      return style.channels
    case 'fields':
      return style.fields && style.fields.length > 0
        ? [...style.fields]
        : ['abs', 'tc', 'map', 'bb', 'inc']
    case 'bindingWater':
      return style.bindingWater ?? 'var:waterTempC'
    case 'bindingOil':
      return style.bindingOil ?? 'var:oilTempC'
    case 'bindingOilPressure':
      return style.bindingOilPressure ?? 'var:oilPressureKpa'
    default:
      return style[field]
  }
}

function semanticStyleConfiguration(element: DashboardElement): Record<string, unknown> {
  const configuration: Record<string, unknown> = {}
  for (const field of SEMANTIC_STYLE_FIELDS[element.type] ?? []) {
    const value = effectiveSemanticStyleValue(element, field)
    if (value !== undefined) configuration[field] = Array.isArray(value) ? [...value] : value
  }
  return configuration
}

export function semanticWidgetKey(element: DashboardElement): string {
  const style = element.style
  const widgetId = runtimeIdentifier(element.widgetId)
  const hifiModuleId = runtimeIdentifier(element.hifiModuleId) ??
    (widgetId?.startsWith('hifi:') ? widgetId.slice('hifi:'.length) : undefined)

  if (hifiModuleId) return `${element.type}|hifi:${hifiModuleId}`
  if (widgetId) return `${element.type}|widget:${widgetId}`

  const binding = dashboardElementConsumesBinding(element.type)
    ? runtimeIdentifier(element.binding)
    : undefined
  const literal = binding === undefined && element.type === 'text'
    ? normalizedHumanText(`${style.prefix ?? ''}${style.text ?? ''}${style.suffix ?? ''}`)
    : undefined

  return JSON.stringify([
    element.type,
    binding ?? null,
    semanticStyleConfiguration(element),
    literal ?? null
  ])
}

const TYPE_SPECIFIC_STYLE_FIELDS = new Set<keyof DashboardElementStyle>([
  'secondaryBinding',
  'dryndaryBinding',
  'chartSource',
  'heatSource',
  'statusKind',
  'statusOnText',
  'statusOffText',
  'flagKey',
  'channels',
  'fields',
  'bindingWater',
  'bindingOil',
  'bindingOilPressure',
  'bindingAbs',
  'bindingTc',
  'bindingMap',
  'bindingBrakeBias'
])

const CANONICAL_STYLE_ALLOWLISTS: Partial<Record<
  DashboardElementType,
  ReadonlySet<keyof DashboardElementStyle>
>> = {
  text: new Set([
    'background',
    'border',
    'borderWidth',
    'radius',
    'color',
    'fontFamily',
    'fontSize',
    'fontWeight',
    'align',
    'padding',
    'text',
    'prefix',
    'suffix',
    'decimals',
    'slots',
    'minFontSize',
    'zIndex'
  ]),
  rect: new Set(['background', 'border', 'borderWidth', 'radius', 'zIndex']),
  image: new Set([
    'background',
    'border',
    'borderWidth',
    'radius',
    'padding',
    'src',
    'fit',
    'opacity',
    'filterGrayscale',
    'filterSepia',
    'redTint',
    'brightness',
    'contrast',
    'saturate',
    'hueRotate',
    'invert',
    'blur',
    'zIndex'
  ]),
  overlaywidget: new Set(['background', 'border', 'borderWidth', 'radius', 'zIndex'])
}

function effectiveElementStyle(element: DashboardElement): Partial<DashboardElementStyle> {
  const allowlist = CANONICAL_STYLE_ALLOWLISTS[element.type]
  const semanticFields = new Set<keyof DashboardElementStyle>(
    SEMANTIC_STYLE_FIELDS[element.type] ?? []
  )
  const output: Partial<DashboardElementStyle> = {}
  for (const key of Object.keys(element.style) as (keyof DashboardElementStyle)[]) {
    if (allowlist && !allowlist.has(key)) continue
    if (!allowlist && TYPE_SPECIFIC_STYLE_FIELDS.has(key)) continue
    output[key] = element.style[key] as never
  }
  if (!allowlist) {
    for (const field of semanticFields) {
      const value = effectiveSemanticStyleValue(element, field as SemanticStyleField)
      if (value !== undefined) output[field] = value as never
    }
  }
  return output
}

function isFullyTransparentColor(value: string | undefined): boolean {
  if (value === undefined) return true
  const normalized = value.trim().toLowerCase()
  if (!normalized || normalized === 'transparent') return true
  if (/^#[0-9a-f]{4}$/.test(normalized)) return normalized[4] === '0'
  if (/^#[0-9a-f]{8}$/.test(normalized)) return normalized.slice(7) === '00'
  const functional = normalized.match(/^(?:rgba?|hsla?)\((.*)\)$/)
  if (!functional) return false
  const body = functional[1]
  const alphaToken = body.includes('/')
    ? body.slice(body.lastIndexOf('/') + 1).trim()
    : body.split(',')[3]?.trim()
  if (alphaToken === undefined) return false
  const alpha = alphaToken.endsWith('%')
    ? Number(alphaToken.slice(0, -1)) / 100
    : Number(alphaToken)
  return Number.isFinite(alpha) && alpha <= 0
}

function hasVisibleFrame(element: DashboardElement): boolean {
  return (element.style.borderWidth ?? 0) > 0 &&
    !isFullyTransparentColor(element.style.border)
}

interface ParsedCssColor {
  key: string
  alpha: number
}

function parseCssColor(value: string): ParsedCssColor | null {
  const normalized = value.trim().toLowerCase()
  const hex = normalized.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/)
  if (hex) {
    const raw = hex[1]
    const expanded = raw.length <= 4
      ? [...raw].map((part) => `${part}${part}`).join('')
      : raw
    const withAlpha = expanded.length === 6 ? `${expanded}ff` : expanded
    return {
      key: `rgba:${withAlpha}`,
      alpha: Number.parseInt(withAlpha.slice(6), 16)
    }
  }
  const functional = normalized.match(/^rgba?\((.*)\)$/)
  if (functional) {
    const [colorPart, slashAlpha] = functional[1].split('/').map((part) => part.trim())
    const channels = colorPart.includes(',')
      ? colorPart.split(',').map((part) => part.trim())
      : colorPart.split(/\s+/)
    const alphaToken = slashAlpha ?? channels[3]
    const channel = (part: string | undefined): number | undefined => {
      if (part === undefined) return undefined
      const numeric = part.endsWith('%')
        ? Math.round(Number(part.slice(0, -1)) * 2.55)
        : Math.round(Number(part))
      return Number.isFinite(numeric) ? Math.max(0, Math.min(255, numeric)) : undefined
    }
    const alpha = alphaToken === undefined
      ? 255
      : alphaToken.endsWith('%')
        ? Math.round(Number(alphaToken.slice(0, -1)) * 2.55)
        : Math.round(Number(alphaToken) * 255)
    const rgb = channels.slice(0, 3).map(channel)
    if (rgb.every((part): part is number => part !== undefined) && Number.isFinite(alpha)) {
      const normalizedAlpha = Math.max(0, Math.min(255, alpha))
      return {
        key: `rgba:${rgb.map((part) => part.toString(16).padStart(2, '0')).join('')}${
          normalizedAlpha.toString(16).padStart(2, '0')
        }`,
        alpha: normalizedAlpha
      }
    }
  }
  return null
}

function isFullCanvas(element: DashboardElement, dashboard: Dashboard): boolean {
  return Math.abs(element.x) <= GEOMETRY_EPSILON &&
    Math.abs(element.y) <= GEOMETRY_EPSILON &&
    Math.abs(element.w - dashboard.width) <= GEOMETRY_EPSILON &&
    Math.abs(element.h - dashboard.height) <= GEOMETRY_EPSILON
}

function isMatchingDashboardBackplate(element: DashboardElement, dashboard: Dashboard): boolean {
  const background = element.style.background
  if (background === undefined) return false
  const fill = parseCssColor(background)
  const canvas = parseCssColor(dashboard.bg)
  return element.type === 'rect' &&
    isFullCanvas(element, dashboard) &&
    !hasVisibleFrame(element) &&
    fill !== null &&
    canvas !== null &&
    fill.alpha === 255 &&
    canvas.alpha === 255 &&
    fill.key === canvas.key
}

function isRedundantDashboardBackplate(
  element: DashboardElement,
  dashboard: Dashboard,
  sourceIndex: number
): boolean {
  if (!isMatchingDashboardBackplate(element, dashboard)) return false
  const zIndex = element.style.zIndex ?? 0
  for (let index = 0; index < dashboard.elements.length; index += 1) {
    if (index === sourceIndex) continue
    const other = dashboard.elements[index]
    const otherZIndex = other.style.zIndex ?? 0
    const paintsBefore = otherZIndex < zIndex ||
      (otherZIndex === zIndex && index < sourceIndex)
    if (!paintsBefore || other.visible === false) continue
    if (isMatchingDashboardBackplate(other, dashboard)) continue
    if (other.type === 'rect' &&
      isFullyTransparentColor(other.style.background) &&
      !hasVisibleFrame(other)) continue
    return false
  }
  return true
}

export function isProvablyInertElement(
  element: DashboardElement,
  dashboard?: Dashboard,
  sourceIndex = dashboard?.elements.indexOf(element) ?? -1
): boolean {
  if (element.visible === false) return true
  if (dashboard && sourceIndex >= 0 &&
    isRedundantDashboardBackplate(element, dashboard, sourceIndex)) return true
  if (element.type === 'rect') {
    return isFullyTransparentColor(element.style.background) && !hasVisibleFrame(element)
  }
  if (element.type === 'image' && (element.style.opacity ?? 1) <= 0) return true
  if (element.type === 'text') {
    const hasContent = element.binding !== undefined ||
      `${element.style.prefix ?? ''}${element.style.text ?? ''}${element.style.suffix ?? ''}`.trim().length > 0
    return !hasContent &&
      isFullyTransparentColor(element.style.background) &&
      !hasVisibleFrame(element)
  }
  return false
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
    .filter((element, index) => !isProvablyInertElement(element, dashboard, index))
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

function rectangleArea(rect: NormalizedRectangle): number {
  return rect.width * rect.height
}

function normalizedElementKey(element: NormalizedDashboardElement): string {
  return JSON.stringify([
    element.semanticKey,
    element.rect.x,
    element.rect.y,
    element.rect.width,
    element.rect.height
  ])
}

export function areaWeightedContainmentSimilarity(
  left: readonly NormalizedDashboardElement[],
  right: readonly NormalizedDashboardElement[]
): number {
  if (left.length === 0 && right.length === 0) return 1
  if (left.length === 0 || right.length === 0) return 0

  const totalLeftArea = left.reduce((total, element) => total + rectangleArea(element.rect), 0)
  const totalRightArea = right.reduce((total, element) => total + rectangleArea(element.rect), 0)
  if (totalLeftArea <= 0 || totalRightArea <= 0) return 0

  const candidates: {
    leftIndex: number
    rightIndex: number
    iou: number
    score: number
    tieKey: string
  }[] = []
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      const leftElement = left[leftIndex]
      const rightElement = right[rightIndex]
      if (leftElement.semanticKey !== rightElement.semanticKey) continue
      const iou = rectangleIou(leftElement.rect, rightElement.rect)
      if (iou <= 0) continue
      const leftWeight = rectangleArea(leftElement.rect) / totalLeftArea
      const rightWeight = rectangleArea(rightElement.rect) / totalRightArea
      const pairKeys = [normalizedElementKey(leftElement), normalizedElementKey(rightElement)].sort()
      candidates.push({
        leftIndex,
        rightIndex,
        iou,
        score: iou * (leftWeight + rightWeight),
        tieKey: JSON.stringify(pairKeys)
      })
    }
  }
  candidates.sort((leftCandidate, rightCandidate) =>
    rightCandidate.score - leftCandidate.score ||
    rightCandidate.iou - leftCandidate.iou ||
    leftCandidate.tieKey.localeCompare(rightCandidate.tieKey)
  )

  const matchedLeft = new Set<number>()
  const matchedRight = new Set<number>()
  let coveredLeftArea = 0
  let coveredRightArea = 0
  for (const candidate of candidates) {
    if (matchedLeft.has(candidate.leftIndex) || matchedRight.has(candidate.rightIndex)) continue
    matchedLeft.add(candidate.leftIndex)
    matchedRight.add(candidate.rightIndex)
    coveredLeftArea += rectangleArea(left[candidate.leftIndex].rect) * candidate.iou
    coveredRightArea += rectangleArea(right[candidate.rightIndex].rect) * candidate.iou
  }

  return roundNormalized(clampSimilarity(
    (coveredLeftArea / totalLeftArea + coveredRightArea / totalRightArea) / 2
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
    binding: dashboardElementConsumesBinding(element.type) ? element.binding ?? null : null,
    rect: canonicalizeValue(normalizeRectangle(element, dashboard), 'element.rect') as CanonicalJson,
    style: canonicalizeValue(effectiveElementStyle(element), 'element.style') as CanonicalJson
  }
}

function elementsOverlap(left: DashboardElement, right: DashboardElement): boolean {
  return Math.min(left.x + left.w, right.x + right.w) > Math.max(left.x, right.x) &&
    Math.min(left.y + left.h, right.y + right.h) > Math.max(left.y, right.y)
}

function canonicalPaintOrder(dashboard: Dashboard): CanonicalJson[] {
  const painted = dashboard.elements
    .map((element, sourceIndex) => ({
      element,
      sourceIndex,
      zIndex: element.style.zIndex ?? 0,
      canonical: JSON.stringify(canonicalElement(element, dashboard))
    }))
    .filter(({ element, sourceIndex }) =>
      !isProvablyInertElement(element, dashboard, sourceIndex))
    .sort((left, right) => left.zIndex - right.zIndex || left.sourceIndex - right.sourceIndex)
  const relations: string[] = []
  for (let lower = 0; lower < painted.length; lower += 1) {
    for (let upper = lower + 1; upper < painted.length; upper += 1) {
      if (!elementsOverlap(painted[lower].element, painted[upper].element)) continue
      relations.push(JSON.stringify([painted[lower].canonical, painted[upper].canonical]))
    }
  }
  return relations.sort().map((relation) => JSON.parse(relation) as CanonicalJson)
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
    .filter((element, index) => !isProvablyInertElement(element, dashboard, index))
    .map((element) => JSON.stringify(canonicalElement(element, dashboard)))
    .sort()
    .map((element) => JSON.parse(element) as CanonicalJson)
  const canonical = JSON.stringify({
    schemaVersion: 1,
    canvas: {
      aspectRatio: roundNormalized(dashboard.width / dashboard.height),
      background: dashboard.bg.trim(),
      scaleMode: resolveDashboardScaleMode(dashboard)
    },
    elements: canonicalElements,
    paintOrder: canonicalPaintOrder(dashboard)
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
  if (metrics.areaWeightedContainment >= STRUCTURAL_SIMILARITY_THRESHOLDS.areaWeightedContainment) {
    warnings.push({
      code: 'area-weighted-containment',
      value: metrics.areaWeightedContainment,
      threshold: STRUCTURAL_SIMILARITY_THRESHOLDS.areaWeightedContainment,
      message: 'Area-weighted one-to-one containment reached the structural warning threshold.'
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
  if (metrics.areaWeightedContainment >= STRUCTURAL_SIMILARITY_THRESHOLDS.areaWeightedContainment) {
    reasons.push({
      code: 'area-weighted-containment',
      message: 'Bidirectional one-to-one visual-core coverage averages at least 75% by area.'
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
    areaWeightedContainment: areaWeightedContainmentSimilarity(left.geometry, right.geometry),
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
