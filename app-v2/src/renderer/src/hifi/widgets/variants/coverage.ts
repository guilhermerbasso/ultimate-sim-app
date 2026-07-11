import { COMPLEX_TELEMETRY_DESCRIPTORS } from './complex-descriptors'
import {
  TELEMETRY_DESCRIPTORS,
  TELEMETRY_INVENTORY_ELIGIBLE_COUNT
} from './descriptors'
import { SNAPSHOT_GAP_DESCRIPTORS } from './snapshot-gap-descriptors'

export const TELEMETRY_BLOCKED_CONCEPTS = [
  {
    id: 'perCarSteering',
    reason:
      'Blocked: opponent steering is not a trustworthy supported telemetry contract; only player steering is normalized.'
  }
] as const

export const TELEMETRY_DEFERRED_CONCEPTS = [
  {
    id: 'shiftLights',
    reason: 'Owned by the dedicated rev/shift-light implementation track.'
  }
] as const

const implementedTelemetries =
  TELEMETRY_DESCRIPTORS.length +
  SNAPSHOT_GAP_DESCRIPTORS.length +
  COMPLEX_TELEMETRY_DESCRIPTORS.length

export const TELEMETRY_VARIANT_COVERAGE = {
  eligibleTelemetries: TELEMETRY_INVENTORY_ELIGIBLE_COUNT,
  implementedTelemetries,
  implementedVariants: implementedTelemetries * 3,
  blockedTelemetries: TELEMETRY_BLOCKED_CONCEPTS.length,
  blockedVariants: TELEMETRY_BLOCKED_CONCEPTS.length * 3,
  deferredTelemetries: TELEMETRY_DEFERRED_CONCEPTS.length,
  deferredVariants: TELEMETRY_DEFERRED_CONCEPTS.length * 3,
  resolvedTelemetries: implementedTelemetries + TELEMETRY_BLOCKED_CONCEPTS.length,
  resolvedVariants: (implementedTelemetries + TELEMETRY_BLOCKED_CONCEPTS.length) * 3
} as const
