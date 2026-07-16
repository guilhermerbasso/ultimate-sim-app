import type {
  OverlayTrigger,
  TemporalTriggerMode as RuntimeTemporalTriggerMode
} from '../overlay-trigger'
import type { TelemetryCapabilityId } from './capabilities'
import type { DeepReadonly } from './immutability'

export type TriggerThresholdSource =
  | 'sdk'
  | 'car-config'
  | 'user-config'
  | 'reviewed-policy'

export type TriggerTemporalMode = RuntimeTemporalTriggerMode

export interface TriggerOnlyFixtures {
  readonly active: string
  readonly inactive: string
  readonly unknown: string
  readonly disconnected: string
  readonly held?: string
}

export interface TriggerOnlyRule {
  readonly id: string
  readonly trigger: DeepReadonly<OverlayTrigger>
  readonly temporalMode: TriggerTemporalMode
  readonly ttlMs?: number
  readonly thresholdSource: TriggerThresholdSource
  readonly provenance: string
  readonly provenanceHash: `sha256:${string}`
  readonly unknownBehavior: 'hidden'
  readonly policyRef: string
  readonly sourceConstraint?: string
  readonly fixtures: TriggerOnlyFixtures
}

export interface TriggerOnlyFamily {
  readonly id: string
  readonly ordinal: number
  readonly origin: 'dedicated-widget' | 'semantic-overlay'
  readonly conceptIds: readonly TelemetryCapabilityId[]
  readonly role: 'trigger-only'
  readonly severity: 'info' | 'warning' | 'critical'
  readonly rules: readonly TriggerOnlyRule[]
}

export type ReadonlyTriggerOnlyFamily =
  DeepReadonly<TriggerOnlyFamily>

export interface TriggerOnlyFamilyRegistrySummary {
  readonly families: number
  readonly rules: number
  readonly dedicatedFamilies: number
  readonly semanticFamilies: number
  readonly temporalRules: number
}
