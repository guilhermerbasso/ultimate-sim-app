import type { OverlayTrigger } from '../overlay-trigger'
import type { TelemetryCapabilityId } from './capabilities'

export type TriggerThresholdSource =
  | 'sdk'
  | 'car-config'
  | 'user-config'
  | 'reviewed-policy'

export type TriggerTemporalMode =
  | 'level'
  | 'rising'
  | 'falling'
  | 'pulse'
  | 'after-false'

export interface TriggerOnlyFixtures {
  active: string
  inactive: string
  unknown: string
  disconnected: string
  held?: string
}

export interface TriggerOnlyRule {
  id: string
  trigger: OverlayTrigger
  temporalMode: TriggerTemporalMode
  ttlMs?: number
  thresholdSource: TriggerThresholdSource
  provenance: string
  provenanceHash: `sha256:${string}`
  unknownBehavior: 'hidden'
  policyRef: string
  sourceConstraint?: string
  fixtures: TriggerOnlyFixtures
}

export interface TriggerOnlyFamily {
  id: string
  ordinal: number
  origin: 'dedicated-widget' | 'semantic-overlay'
  conceptIds: readonly TelemetryCapabilityId[]
  role: 'trigger-only'
  severity: 'info' | 'warning' | 'critical'
  rules: readonly TriggerOnlyRule[]
}

export interface TriggerOnlyFamilyRegistrySummary {
  families: number
  rules: number
  dedicatedFamilies: number
  semanticFamilies: number
  temporalRules: number
}
