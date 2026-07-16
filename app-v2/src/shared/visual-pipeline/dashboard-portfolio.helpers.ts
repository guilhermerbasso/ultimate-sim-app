import {
  DASHBOARD_PORTFOLIO,
  DASHBOARD_PORTFOLIO_FAMILIES,
  DASHBOARD_PORTFOLIO_PROCESSING_ORDER
} from './dashboard-portfolio'
import {
  DASHBOARD_PORTFOLIO_FAMILY_IDS,
  DASHBOARD_PORTFOLIO_IDS,
  DASHBOARD_PORTFOLIO_SOURCE_IDS,
  DASHBOARD_PORTFOLIO_TELEMETRY_CONCEPT_IDS,
  type DashboardPortfolioEntry,
  type DashboardPortfolioFamilyDefinition,
  type DashboardPortfolioFamilyId,
  type DashboardPortfolioId
} from './dashboard-portfolio.types'
import { isControlledTag } from '../tags'

export const DASHBOARD_PORTFOLIO_TAG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const PORTFOLIO_ID_SET = new Set<string>(DASHBOARD_PORTFOLIO_IDS)
const FAMILY_ID_SET = new Set<string>(DASHBOARD_PORTFOLIO_FAMILY_IDS)
const SOURCE_ID_SET = new Set<string>(DASHBOARD_PORTFOLIO_SOURCE_IDS)
const TELEMETRY_CONCEPT_ID_SET = new Set<string>(DASHBOARD_PORTFOLIO_TELEMETRY_CONCEPT_IDS)
const WORKFLOW_POLICY_ALERT_PATTERNS = [
  /\bat a time\b/i,
  /\bqueue(?:d|ing)? decision alert\b/i,
  /\brequir(?:e|es|ed|ing) (?:explicit )?acknowledg(?:e)?ment\b/i,
  /\bworkflow policy\b/i
] as const
const PORTFOLIO_BY_ID = new Map<string, DashboardPortfolioEntry>(
  DASHBOARD_PORTFOLIO.map((entry) => [entry.id, entry] as const)
)

function isNonBlank(value: string): boolean {
  return value.trim().length > 0
}

function normalizedSemanticText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9:]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
}

export function normalizeDashboardTag(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function normalizeDashboardTags(tags: readonly string[]): string[] {
  const normalized: string[] = []
  const seen = new Set<string>()
  for (const tag of tags) {
    const value = normalizeDashboardTag(tag)
    if (!value || seen.has(value)) continue
    seen.add(value)
    normalized.push(value)
  }
  return normalized
}

export function hasNormalizedDashboardTags(tags: readonly string[]): boolean {
  const normalized = normalizeDashboardTags(tags)
  return (
    normalized.length === tags.length &&
    tags.every((tag, index) => tag === normalized[index] && DASHBOARD_PORTFOLIO_TAG_PATTERN.test(tag))
  )
}

export function lookupDashboardPortfolioEntry(
  id: DashboardPortfolioId | string
): DashboardPortfolioEntry | undefined {
  return PORTFOLIO_BY_ID.get(id)
}

export function groupDashboardPortfolioByFamily(
  entries: readonly DashboardPortfolioEntry[] = DASHBOARD_PORTFOLIO
): Readonly<Record<DashboardPortfolioFamilyId, readonly DashboardPortfolioEntry[]>> {
  const groups: Record<DashboardPortfolioFamilyId, DashboardPortfolioEntry[]> = {
    A: [],
    B: [],
    C: [],
    D: [],
    E: [],
    F: [],
    G: [],
    H: [],
    I: [],
    J: []
  }
  for (const entry of entries) groups[entry.familyId].push(entry)
  for (const familyId of DASHBOARD_PORTFOLIO_FAMILY_IDS) Object.freeze(groups[familyId])
  return Object.freeze(groups)
}

export function dashboardPortfolioInProcessingOrder(
  entries: readonly DashboardPortfolioEntry[] = DASHBOARD_PORTFOLIO,
  processingOrder: readonly DashboardPortfolioId[] = DASHBOARD_PORTFOLIO_PROCESSING_ORDER
): readonly DashboardPortfolioEntry[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry] as const))
  return processingOrder.map((id) => {
    const entry = byId.get(id)
    if (!entry) throw new Error(`Dashboard portfolio processing order references unknown id ${id}.`)
    return entry
  })
}

/**
 * The signature intentionally excludes id and name. Uniqueness therefore proves
 * that the semantic brief itself differs, not merely its registry key.
 */
export function dashboardPortfolioSemanticSignature(entry: DashboardPortfolioEntry): string {
  return [
    entry.familyId,
    entry.persona,
    entry.raceMoment,
    entry.purpose,
    entry.informationHierarchy.join('|'),
    [...entry.requiredTelemetryConceptIds].sort().join('|'),
    entry.layoutGrammar,
    entry.differentiation,
    entry.candidateWidgetConcepts.join('|')
  ].map(normalizedSemanticText).join('::')
}

export function isDashboardPortfolioProcessingOrderInterleaved(
  processingOrder: readonly DashboardPortfolioId[] = DASHBOARD_PORTFOLIO_PROCESSING_ORDER,
  entries: readonly DashboardPortfolioEntry[] = DASHBOARD_PORTFOLIO
): boolean {
  if (processingOrder.length !== entries.length || processingOrder.length % 10 !== 0) return false
  const byId = new Map(entries.map((entry) => [entry.id, entry] as const))
  const seen = new Set<string>()

  for (let start = 0; start < processingOrder.length; start += 10) {
    const wave = processingOrder.slice(start, start + 10)
    const familySequence: string[] = []
    for (const id of wave) {
      if (seen.has(id)) return false
      seen.add(id)
      const entry = byId.get(id)
      if (!entry) return false
      familySequence.push(entry.familyId)
    }
    if (familySequence.join('') !== DASHBOARD_PORTFOLIO_FAMILY_IDS.join('')) return false
  }

  return seen.size === entries.length
}

export function validateDashboardPortfolioEntry(entry: DashboardPortfolioEntry): readonly string[] {
  const errors: string[] = []
  const requiredStrings: Array<[string, string]> = [
    ['name', entry.name],
    ['persona', entry.persona],
    ['raceMoment', entry.raceMoment],
    ['purpose', entry.purpose],
    ['layoutGrammar', entry.layoutGrammar],
    ['visualLanguage', entry.visualLanguage],
    ['typographyConstraints', entry.typographyConstraints],
    ['colorConstraints', entry.colorConstraints],
    ['differentiation', entry.differentiation],
    ['imagePromptConstraints.canvas', entry.imagePromptConstraints.canvas],
    ['imagePromptConstraints.viewpoint', entry.imagePromptConstraints.viewpoint],
    ['imagePromptConstraints.legibility', entry.imagePromptConstraints.legibility]
  ]
  const requiredArrays: Array<[string, readonly string[]]> = [
    ['informationHierarchy', entry.informationHierarchy],
    ['requiredTelemetryConceptIds', entry.requiredTelemetryConceptIds],
    ['materials', entry.materials],
    ['candidateWidgetConcepts', entry.candidateWidgetConcepts],
    ['ordinaryOverlays', entry.ordinaryOverlays],
    ['triggerOnlyAlerts', entry.triggerOnlyAlerts],
    ['tags', entry.tags],
    ['researchNotes', entry.researchNotes],
    ['sourceIds', entry.sourceIds],
    ['imagePromptConstraints.sampleReadouts', entry.imagePromptConstraints.sampleReadouts],
    ['imagePromptConstraints.requiredComposition', entry.imagePromptConstraints.requiredComposition],
    ['imagePromptConstraints.avoid', entry.imagePromptConstraints.avoid],
    ['imagePromptConstraints.avoidAlso', entry.imagePromptConstraints.avoidAlso]
  ]

  if (!PORTFOLIO_ID_SET.has(entry.id)) errors.push(`unknown id ${entry.id}`)
  if (!FAMILY_ID_SET.has(entry.familyId)) errors.push(`unknown family ${entry.familyId}`)
  if (!Number.isInteger(entry.order) || entry.order < 1) errors.push('order must be a positive integer')
  if (!Number.isInteger(entry.priority) || entry.priority < 1) errors.push('priority must be a positive integer')

  for (const [field, value] of requiredStrings) {
    if (!isNonBlank(value)) errors.push(`${field} is required`)
  }
  for (const [field, values] of requiredArrays) {
    if (values.length === 0) errors.push(`${field} must not be empty`)
    if (values.some((value) => !isNonBlank(value))) errors.push(`${field} contains a blank value`)
  }

  if (entry.informationHierarchy.length < 3) {
    errors.push('informationHierarchy must include primary, secondary, and tertiary levels')
  }
  if (entry.differentiation.length < 48) errors.push('differentiation is not specific enough')
  if (entry.candidateWidgetConcepts.length < 3) errors.push('candidateWidgetConcepts must include at least three concepts')
  if (!hasNormalizedDashboardTags(entry.tags)) errors.push('tags are not normalized and unique')
  for (const tag of entry.tags) {
    if (!isControlledTag(tag)) errors.push(`uncontrolled portfolio tag: ${tag}`)
  }

  const requiredTags = [
    'dashboard',
    'release-b',
    'telemetry-framework',
    `family-${entry.familyId.toLowerCase()}`
  ]
  for (const tag of requiredTags) {
    if (!entry.tags.includes(tag)) errors.push(`missing required tag ${tag}`)
  }

  for (const conceptId of entry.requiredTelemetryConceptIds) {
    if (!TELEMETRY_CONCEPT_ID_SET.has(conceptId)) errors.push(`unknown telemetry concept ${conceptId}`)
  }
  for (const sourceId of entry.sourceIds) {
    if (!SOURCE_ID_SET.has(sourceId)) errors.push(`unknown source ${sourceId}`)
  }

  const ordinary = new Set(entry.ordinaryOverlays.map(normalizedSemanticText))
  for (const alert of entry.triggerOnlyAlerts) {
    if (ordinary.has(normalizedSemanticText(alert))) {
      errors.push(`alert duplicates an ordinary overlay: ${alert}`)
    }
    if (WORKFLOW_POLICY_ALERT_PATTERNS.some((pattern) => pattern.test(alert))) {
      errors.push(`trigger-only alert is a workflow policy, not a condition or event: ${alert}`)
    }
  }

  const avoidText = entry.imagePromptConstraints.avoid.join(' ').toLowerCase()
  if (!avoidText.includes('official') || !avoidText.includes('logo')) {
    errors.push('image prompt constraints must prohibit official logos')
  }
  if (!avoidText.includes('proprietary') || (!avoidText.includes('copy') && !avoidText.includes('copied'))) {
    errors.push('image prompt constraints must prohibit proprietary copying')
  }
  if (!avoidText.includes('generic business-dashboard cards')) {
    errors.push('image prompt constraints must prohibit generic business-dashboard cards')
  }

  return errors
}

export function validateDashboardPortfolioRegistry(
  entries: readonly DashboardPortfolioEntry[] = DASHBOARD_PORTFOLIO,
  families: readonly DashboardPortfolioFamilyDefinition[] = DASHBOARD_PORTFOLIO_FAMILIES,
  processingOrder: readonly DashboardPortfolioId[] = DASHBOARD_PORTFOLIO_PROCESSING_ORDER
): readonly string[] {
  const errors: string[] = []

  if (entries.length !== 50) errors.push(`expected 50 entries, received ${entries.length}`)
  if (families.length !== 10) errors.push(`expected 10 families, received ${families.length}`)

  const ids = entries.map((entry) => entry.id)
  const names = entries.map((entry) => entry.name.trim().toLowerCase())
  const signatures = entries.map(dashboardPortfolioSemanticSignature)
  const orders = entries.map((entry) => entry.order)
  const priorities = entries.map((entry) => entry.priority)

  if (new Set(ids).size !== ids.length) errors.push('dashboard ids are not unique')
  if (new Set(names).size !== names.length) errors.push('dashboard names are not unique')
  if (new Set(signatures).size !== signatures.length) errors.push('dashboard semantic signatures are not unique')
  if (new Set(orders).size !== orders.length) errors.push('dashboard orders are not unique')
  if (new Set(priorities).size !== priorities.length) errors.push('dashboard priorities are not unique')

  if (ids.join('|') !== DASHBOARD_PORTFOLIO_IDS.join('|')) {
    errors.push('registry ids or registry order do not match R2-01 through R2-50')
  }
  if ([...orders].sort((a, b) => a - b).join('|') !== Array.from({ length: 50 }, (_, index) => index + 1).join('|')) {
    errors.push('orders must cover 1 through 50 exactly')
  }

  const sortedByOrder = [...entries].sort((a, b) => a.order - b.order)
  for (let index = 1; index < sortedByOrder.length; index += 1) {
    if (sortedByOrder[index - 1].priority <= sortedByOrder[index].priority) {
      errors.push('priorities must descend as registry order increases')
      break
    }
  }

  for (const entry of entries) {
    for (const error of validateDashboardPortfolioEntry(entry)) errors.push(`${entry.id}: ${error}`)
  }

  const grouped = groupDashboardPortfolioByFamily(entries)
  for (const family of families) {
    const group = grouped[family.id]
    if (group.length !== 5) errors.push(`family ${family.id} must contain five dashboards`)
    if (group.map((entry) => entry.id).join('|') !== family.entryIds.join('|')) {
      errors.push(`family ${family.id} entryIds do not match registry membership`)
    }
  }

  if (processingOrder.length !== 50) errors.push('processing order must contain 50 ids')
  if (new Set(processingOrder).size !== processingOrder.length) errors.push('processing order contains duplicate ids')
  if (new Set(processingOrder).size !== new Set(ids).size || processingOrder.some((id) => !ids.includes(id))) {
    errors.push('processing order must contain every registry id exactly once')
  }
  if (!isDashboardPortfolioProcessingOrderInterleaved(processingOrder, entries)) {
    errors.push('processing order must interleave families A through J in five balanced waves')
  }

  return errors
}
