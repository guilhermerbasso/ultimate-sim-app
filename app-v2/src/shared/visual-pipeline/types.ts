import type { TelemetrySnapshot } from '../telemetry'
import { freezeTuple } from './immutability'
import type { DeepReadonly } from './immutability'

export const TELEMETRY_REPRESENTATION_STYLES = freezeTuple([
  'competition',
  'futuristic',
  'ddu'
] as const)

export type TelemetryRepresentationStyle =
  (typeof TELEMETRY_REPRESENTATION_STYLES)[number]

export const TELEMETRY_CAPABILITY_CATEGORIES = freezeTuple([
  'drive',
  'engine',
  'fuel',
  'identity',
  'inputs',
  'map',
  'pit',
  'session',
  'standings',
  'timing',
  'tyres',
  'weather'
] as const)

export type TelemetryCapabilityCategory =
  (typeof TELEMETRY_CAPABILITY_CATEGORIES)[number]

export const TELEMETRY_CAPABILITY_FOCUSES = freezeTuple([
  'brakes',
  'chassis',
  'controls',
  'delta',
  'engine',
  'fuel',
  'g-force',
  'incidents',
  'pace',
  'race-control',
  'session',
  'setup',
  'strategy',
  'timing',
  'track',
  'traffic',
  'tyres',
  'weather'
] as const)

export type TelemetryCapabilityFocus =
  (typeof TELEMETRY_CAPABILITY_FOCUSES)[number]

export type TelemetryDataKind =
  | 'bitfield'
  | 'boolean'
  | 'composite'
  | 'corners'
  | 'enum'
  | 'integer'
  | 'number'
  | 'per-car'
  | 'setting'
  | 'text'
  | 'vector'

export type CarDependencyScope =
  | 'none'
  | 'player-car'
  | 'per-car'
  | 'feature-dependent'

export type SessionDependencyScope =
  | 'none'
  | 'live-session'
  | 'session-info'
  | 'timing-or-scoring'
  | 'weather'
  | 'pit'
  | 'replay'

export interface TelemetryCapabilityDependencies {
  readonly car: CarDependencyScope
  readonly session: SessionDependencyScope
  readonly notes: string
}

export interface TelemetryCapabilityData {
  readonly kind: TelemetryDataKind
  readonly unit: string | null
  readonly detail: string
}

export type TelemetrySnapshotField = keyof TelemetrySnapshot

export interface TelemetryRepresentationContract {
  readonly competition: string
  readonly futuristic: string
  readonly ddu: string
}

export type TelemetrySourceConstraintId =
  'provider-normalization-missing'

export interface TelemetrySourceConstraint {
  readonly id: TelemetrySourceConstraintId
  readonly scope: 'provider'
  readonly detail: string
}

export interface TelemetryCapabilityBase {
  readonly id: string
  readonly label: string
  readonly category: TelemetryCapabilityCategory
  readonly focus: TelemetryCapabilityFocus
  readonly tags: readonly string[]
  readonly requiredSnapshotFields: readonly TelemetrySnapshotField[]
  readonly normalizedSnapshotPaths: readonly string[]
  readonly rawIracingHints: readonly string[]
  readonly data: TelemetryCapabilityData
  readonly dependencies: TelemetryCapabilityDependencies
  readonly normalization: string
  readonly sourceConstraints: readonly TelemetrySourceConstraint[]
  readonly surfaces: {
    readonly widget: true
    readonly ordinaryOverlay: true
  }
}

export interface GeneratedTelemetryCapability
  extends TelemetryCapabilityBase {
  readonly runtime: {
    readonly availability: 'visualizable'
    readonly unavailablePresentation: 'explicit'
  }
  readonly implementation: {
    readonly mode: 'generated-three-variant'
  }
  readonly representations: TelemetryRepresentationContract
}

export interface DedicatedTelemetryCapability
  extends TelemetryCapabilityBase {
  readonly runtime: {
    readonly availability: 'visualizable'
    readonly unavailablePresentation: 'explicit'
  }
  readonly implementation: {
    readonly mode: 'dedicated-shared-rev-lights'
    readonly sharedModule: 'revlights'
  }
}

export interface UnsupportedTelemetryCapability
  extends TelemetryCapabilityBase {
  readonly runtime: {
    readonly availability: 'unsupported'
    readonly unavailablePresentation: 'explicit'
    readonly unsupportedReason: string
  }
  readonly implementation: {
    readonly mode: 'unsupported-unavailable'
    readonly blockedOn: 'provider-normalization'
    readonly reason: string
  }
}

export type TelemetryCapability =
  | GeneratedTelemetryCapability
  | DedicatedTelemetryCapability
  | UnsupportedTelemetryCapability

export type ReadonlyTelemetryCapability =
  DeepReadonly<TelemetryCapability>

export type ReadonlyVisualizableTelemetryCapability =
  DeepReadonly<
    GeneratedTelemetryCapability | DedicatedTelemetryCapability
  >

export interface TelemetryCapabilityTagValidation {
  readonly valid: boolean
  readonly duplicates: readonly string[]
  readonly invalid: readonly string[]
}

export interface TelemetryCapabilityRegistrySummary {
  readonly total: number
  readonly currentlyVisualizable: number
  readonly generatedThreeVariant: number
  readonly generatedRepresentations: number
  readonly dedicated: number
  readonly unsupported: number
  readonly plannedWidgets: number
  readonly plannedOrdinaryOverlays: number
}
