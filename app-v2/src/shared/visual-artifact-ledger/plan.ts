import {
  BASE_ARTIFACT_COUNT,
  GOVERNED_CONCEPT_COUNT,
  GOVERNED_STYLE_COUNT,
  MAX_ARTIFACTS,
  MIN_TOTAL_ARTIFACT_COUNT,
  MIN_TRIGGER_ARTIFACT_COUNT,
  VISUAL_ARTIFACT_LEDGER_VERSION
} from './constants'
import {
  assertExactKeys,
  assertPlainObject,
  assertSafeInteger,
  assertSha256,
  assertSlug,
  canonicalStringify,
  cloneCanonical,
  deepFreeze,
  sha256Hex
} from './canonical'
import { fail } from './errors'

export type ArtifactKind = 'dashboard' | 'widget' | 'ordinary-overlay' | 'trigger'
export type ArtifactId =
  | `va2:d:${string}`
  | `va2:w:${string}:${string}`
  | `va2:o:${string}:${string}`
  | `va2:t:${string}:${string}`

export interface PlanIdentity {
  readonly id: string
  readonly ordinal: number
}

export interface ArtifactPlanInput {
  readonly registryHash: string
  readonly styles: readonly PlanIdentity[]
  readonly concepts: readonly PlanIdentity[]
  readonly triggerFamilies: readonly PlanIdentity[]
}

export interface ArtifactPlanCounts {
  readonly dashboards: number
  readonly widgets: number
  readonly ordinaryOverlays: number
  readonly triggers: number
  readonly base: number
  readonly total: number
}

export interface ArtifactPlan {
  readonly schemaVersion: typeof VISUAL_ARTIFACT_LEDGER_VERSION
  readonly registryHash: string
  readonly styles: readonly PlanIdentity[]
  readonly concepts: readonly PlanIdentity[]
  readonly triggerFamilies: readonly PlanIdentity[]
  readonly counts: ArtifactPlanCounts
  readonly planHash: string
}

const PLAN_KEYS = [
  'schemaVersion',
  'registryHash',
  'styles',
  'concepts',
  'triggerFamilies',
  'counts',
  'planHash'
] as const

function normalizeIdentities(
  value: unknown,
  label: string,
  exactCount?: number
): readonly PlanIdentity[] {
  if (!Array.isArray(value)) fail('SCHEMA', `${label} must be an array.`)
  if (value.length > MAX_ARTIFACTS) fail('CARDINALITY', `${label} exceeds the identity limit.`)
  if (exactCount !== undefined && value.length !== exactCount) {
    fail('SCHEMA', `${label} must contain exactly ${exactCount} identities.`)
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      fail('SCHEMA', `${label} cannot be sparse.`)
    }
  }

  const identities = value.map((entry, index) => {
    assertPlainObject(entry, `${label}[${index}]`)
    assertExactKeys(entry, ['id', 'ordinal'], `${label}[${index}]`)
    return {
      id: assertSlug(entry.id, `${label}[${index}].id`),
      ordinal: assertSafeInteger(entry.ordinal, `${label}[${index}].ordinal`, 1, MAX_ARTIFACTS)
    }
  })
  identities.sort((left, right) => left.ordinal - right.ordinal || left.id.localeCompare(right.id))

  const ids = new Set<string>()
  for (let index = 0; index < identities.length; index += 1) {
    const identity = identities[index]
    if (identity.ordinal !== index + 1) fail('SCHEMA', `${label} ordinals must be contiguous from 1.`)
    if (ids.has(identity.id)) fail('SCHEMA', `${label} contains duplicate id "${identity.id}".`)
    ids.add(identity.id)
  }
  return identities
}

function computeCounts(styles: number, concepts: number, triggerFamilies: number): ArtifactPlanCounts {
  const dashboards = styles
  const widgets = styles * concepts
  const ordinaryOverlays = styles * concepts
  const triggers = styles * triggerFamilies
  const base = dashboards + widgets + ordinaryOverlays
  const total = base + triggers
  return { dashboards, widgets, ordinaryOverlays, triggers, base, total }
}

function planHashPayload(plan: Omit<ArtifactPlan, 'planHash'>): unknown {
  return {
    domain: 'visual-artifact-plan-v2',
    schemaVersion: plan.schemaVersion,
    registryHash: plan.registryHash,
    styles: plan.styles,
    concepts: plan.concepts,
    triggerFamilies: plan.triggerFamilies,
    counts: plan.counts
  }
}

export function createArtifactPlan(input: unknown): ArtifactPlan {
  assertPlainObject(input, 'Artifact plan input')
  assertExactKeys(input, ['registryHash', 'styles', 'concepts', 'triggerFamilies'], 'Artifact plan input')
  const registryHash = assertSha256(input.registryHash, 'Artifact plan registryHash')
  const styles = normalizeIdentities(input.styles, 'Artifact plan styles', GOVERNED_STYLE_COUNT)
  const concepts = normalizeIdentities(input.concepts, 'Artifact plan concepts', GOVERNED_CONCEPT_COUNT)
  const triggerFamilies = normalizeIdentities(input.triggerFamilies, 'Artifact plan triggerFamilies')
  const counts = computeCounts(styles.length, concepts.length, triggerFamilies.length)

  if (counts.base !== BASE_ARTIFACT_COUNT) fail('INTEGRITY', 'Artifact plan base count is not 14,350.')
  if (counts.triggers < MIN_TRIGGER_ARTIFACT_COUNT) {
    fail('INTEGRITY', `Artifact plan requires at least ${MIN_TRIGGER_ARTIFACT_COUNT} trigger artifacts.`)
  }
  if (counts.total < MIN_TOTAL_ARTIFACT_COUNT || counts.total > MAX_ARTIFACTS) {
    fail('CARDINALITY', `Artifact plan total must be ${MIN_TOTAL_ARTIFACT_COUNT}..${MAX_ARTIFACTS}.`)
  }

  const withoutHash: Omit<ArtifactPlan, 'planHash'> = {
    schemaVersion: VISUAL_ARTIFACT_LEDGER_VERSION,
    registryHash,
    styles,
    concepts,
    triggerFamilies,
    counts
  }
  return deepFreeze({
    ...cloneCanonical(withoutHash),
    planHash: sha256Hex(planHashPayload(withoutHash))
  })
}

export function parseArtifactPlan(value: unknown): ArtifactPlan {
  assertPlainObject(value, 'Artifact plan')
  assertExactKeys(value, PLAN_KEYS, 'Artifact plan')
  if (value.schemaVersion !== VISUAL_ARTIFACT_LEDGER_VERSION) {
    fail('SCHEMA', `Artifact plan schemaVersion must be ${VISUAL_ARTIFACT_LEDGER_VERSION}.`)
  }

  const recreated = createArtifactPlan({
    registryHash: value.registryHash,
    styles: value.styles,
    concepts: value.concepts,
    triggerFamilies: value.triggerFamilies
  })
  assertPlainObject(value.counts, 'Artifact plan counts')
  assertExactKeys(
    value.counts,
    ['dashboards', 'widgets', 'ordinaryOverlays', 'triggers', 'base', 'total'],
    'Artifact plan counts'
  )
  for (const [name, expected] of Object.entries(recreated.counts)) {
    if (value.counts[name] !== expected) fail('INTEGRITY', `Artifact plan count "${name}" is incorrect.`)
  }
  const suppliedHash = assertSha256(value.planHash, 'Artifact plan planHash')
  if (suppliedHash !== recreated.planHash) fail('INTEGRITY', 'Artifact plan hash does not match its content.')
  return recreated
}

export function artifactPlanCanonicalString(plan: ArtifactPlan): string {
  return canonicalStringify(parseArtifactPlan(plan))
}

export function artifactIdForDashboard(styleId: string): ArtifactId {
  return `va2:d:${styleId}`
}

export function artifactIdForWidget(styleId: string, conceptId: string): ArtifactId {
  return `va2:w:${styleId}:${conceptId}`
}

export function artifactIdForOverlay(styleId: string, conceptId: string): ArtifactId {
  return `va2:o:${styleId}:${conceptId}`
}

export function artifactIdForTrigger(styleId: string, triggerFamilyId: string): ArtifactId {
  return `va2:t:${styleId}:${triggerFamilyId}`
}

export function expectedArtifactIds(plan: ArtifactPlan): readonly ArtifactId[] {
  const parsed = parseArtifactPlan(plan)
  const ids: ArtifactId[] = []
  for (const style of parsed.styles) ids.push(artifactIdForDashboard(style.id))
  for (const style of parsed.styles) {
    for (const concept of parsed.concepts) ids.push(artifactIdForWidget(style.id, concept.id))
  }
  for (const style of parsed.styles) {
    for (const concept of parsed.concepts) ids.push(artifactIdForOverlay(style.id, concept.id))
  }
  for (const style of parsed.styles) {
    for (const trigger of parsed.triggerFamilies) ids.push(artifactIdForTrigger(style.id, trigger.id))
  }
  return deepFreeze(ids)
}

export function expectedArtifactSetHash(plan: ArtifactPlan): string {
  return sha256Hex({
    domain: 'visual-artifact-id-set-v2',
    ids: expectedArtifactIds(plan)
  })
}

export interface ParsedArtifactId {
  readonly id: ArtifactId
  readonly kind: ArtifactKind
  readonly styleId: string
  readonly subjectId: string | null
}

export function parseArtifactId(value: unknown): ParsedArtifactId {
  if (typeof value !== 'string' || value.length > 200) fail('SCHEMA', 'Artifact id is invalid.')
  const parts = value.split(':')
  if (parts.length < 3 || parts[0] !== 'va2') fail('SCHEMA', 'Artifact id is not canonical V2.')
  const styleId = assertSlug(parts[2], 'Artifact style id')
  if (parts[1] === 'd' && parts.length === 3) {
    return { id: value as ArtifactId, kind: 'dashboard', styleId, subjectId: null }
  }
  if (parts.length !== 4) fail('SCHEMA', 'Artifact id has an invalid component count.')
  const subjectId = assertSlug(parts[3], 'Artifact subject id')
  const kind =
    parts[1] === 'w'
      ? 'widget'
      : parts[1] === 'o'
        ? 'ordinary-overlay'
        : parts[1] === 't'
          ? 'trigger'
          : null
  if (!kind) fail('SCHEMA', 'Artifact id has an unknown kind.')
  return { id: value as ArtifactId, kind, styleId, subjectId }
}
