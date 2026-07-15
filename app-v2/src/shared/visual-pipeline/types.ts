import type { TelemetrySnapshot } from '../telemetry'

export const TELEMETRY_REPRESENTATION_STYLES = [
  'competition',
  'futuristic',
  'ddu'
] as const

export type TelemetryRepresentationStyle =
  (typeof TELEMETRY_REPRESENTATION_STYLES)[number]

export const TELEMETRY_CAPABILITY_CATEGORIES = [
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
] as const

export type TelemetryCapabilityCategory =
  (typeof TELEMETRY_CAPABILITY_CATEGORIES)[number]

export const TELEMETRY_CAPABILITY_FOCUSES = [
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
] as const

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
  car: CarDependencyScope
  session: SessionDependencyScope
  notes: string
}

export interface TelemetryCapabilityData {
  kind: TelemetryDataKind
  unit: string | null
  detail: string
}

export type TelemetrySnapshotField = keyof TelemetrySnapshot

export interface TelemetryRepresentationContract {
  competition: string
  futuristic: string
  ddu: string
}

export type TelemetrySourceConstraintId =
  | 'provider-fallback-ambiguous'
  | 'provider-normalization-missing'

export interface TelemetrySourceConstraint {
  id: TelemetrySourceConstraintId
  scope: 'provider'
  detail: string
}

export interface TelemetryCapabilityBase {
  id: string
  label: string
  category: TelemetryCapabilityCategory
  focus: TelemetryCapabilityFocus
  tags: readonly string[]
  requiredSnapshotFields: readonly TelemetrySnapshotField[]
  normalizedSnapshotPaths: readonly string[]
  rawIracingHints: readonly string[]
  data: TelemetryCapabilityData
  dependencies: TelemetryCapabilityDependencies
  normalization: string
  sourceConstraints: readonly TelemetrySourceConstraint[]
  surfaces: {
    widget: true
    ordinaryOverlay: true
  }
}

export interface GeneratedTelemetryCapability
  extends TelemetryCapabilityBase {
  runtime: {
    availability: 'visualizable'
    unavailablePresentation: 'explicit'
  }
  implementation: {
    mode: 'generated-three-variant'
  }
  representations: TelemetryRepresentationContract
}

export interface DedicatedTelemetryCapability
  extends TelemetryCapabilityBase {
  runtime: {
    availability: 'visualizable'
    unavailablePresentation: 'explicit'
  }
  implementation: {
    mode: 'dedicated-shared-rev-lights'
    sharedModule: 'revlights'
  }
}

export interface UnsupportedTelemetryCapability
  extends TelemetryCapabilityBase {
  runtime: {
    availability: 'unsupported'
    unavailablePresentation: 'explicit'
    unsupportedReason: string
  }
  implementation: {
    mode: 'unsupported-unavailable'
    blockedOn: 'provider-normalization'
    reason: string
  }
}

export type TelemetryCapability =
  | GeneratedTelemetryCapability
  | DedicatedTelemetryCapability
  | UnsupportedTelemetryCapability

export interface TelemetryCapabilityTagValidation {
  valid: boolean
  duplicates: readonly string[]
  invalid: readonly string[]
}

export interface TelemetryCapabilityRegistrySummary {
  total: number
  currentlyVisualizable: number
  generatedThreeVariant: number
  generatedRepresentations: number
  dedicated: number
  unsupported: number
  plannedWidgets: number
  plannedOrdinaryOverlays: number
}
