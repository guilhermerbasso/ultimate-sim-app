import { isControlledTag } from '../tags'
import {
  TELEMETRY_CAPABILITIES,
  type TelemetryCapabilityId
} from './capabilities'
import type {
  BlockedTelemetryCapability,
  TelemetryCapability,
  TelemetryCapabilityRegistrySummary,
  TelemetryCapabilityTagValidation
} from './types'

export const TELEMETRY_CAPABILITY_REGISTRY = TELEMETRY_CAPABILITIES

const CAPABILITY_BY_ID = new Map<string, TelemetryCapability>(
  TELEMETRY_CAPABILITY_REGISTRY.map((capability) => [
    capability.id,
    capability
  ])
)

export function getTelemetryCapability(
  id: TelemetryCapabilityId
): TelemetryCapability
export function getTelemetryCapability(
  id: string
): TelemetryCapability | undefined
export function getTelemetryCapability(
  id: string
): TelemetryCapability | undefined {
  return CAPABILITY_BY_ID.get(id)
}

export function isVisualizableTelemetryCapability(
  capability: TelemetryCapability
): capability is Exclude<TelemetryCapability, BlockedTelemetryCapability> {
  return capability.implementation.mode !== 'blocked'
}

export function filterVisualizableTelemetryCapabilities(
  capabilities: readonly TelemetryCapability[] =
    TELEMETRY_CAPABILITY_REGISTRY
): Exclude<TelemetryCapability, BlockedTelemetryCapability>[] {
  return capabilities.filter(isVisualizableTelemetryCapability)
}

export function filterTriggerOnlyTelemetryCapabilities(
  capabilities: readonly TelemetryCapability[] =
    TELEMETRY_CAPABILITY_REGISTRY
): TelemetryCapability[] {
  return capabilities.filter(
    (capability) => capability.trigger.classification === 'trigger-only'
  )
}

export function validateNormalizedTelemetryTags(
  tags: readonly string[]
): TelemetryCapabilityTagValidation {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  const invalid = new Set<string>()

  for (const tag of tags) {
    if (seen.has(tag)) duplicates.add(tag)
    seen.add(tag)
    if (!isControlledTag(tag)) invalid.add(tag)
  }

  return {
    valid: duplicates.size === 0 && invalid.size === 0,
    duplicates: [...duplicates],
    invalid: [...invalid]
  }
}

export function validateTelemetryCapabilityTags(
  capability: TelemetryCapability
): TelemetryCapabilityTagValidation {
  return validateNormalizedTelemetryTags(capability.tags)
}

export function summarizeTelemetryCapabilityRegistry(
  capabilities: readonly TelemetryCapability[] =
    TELEMETRY_CAPABILITY_REGISTRY
): TelemetryCapabilityRegistrySummary {
  let generatedThreeVariant = 0
  let dedicated = 0
  let blocked = 0
  let dashboardWidget = 0
  let ordinaryOverlay = 0
  let triggerOnly = 0
  let alertCandidates = 0

  for (const capability of capabilities) {
    if (capability.implementation.mode === 'generated-three-variant') {
      generatedThreeVariant += 1
    } else if (
      capability.implementation.mode === 'dedicated-shared-rev-lights'
    ) {
      dedicated += 1
    } else {
      blocked += 1
    }

    if (capability.surfaces.dashboardWidget === 'supported') {
      dashboardWidget += 1
    }
    if (capability.surfaces.ordinaryOverlay === 'supported') {
      ordinaryOverlay += 1
    }
    if (capability.trigger.classification === 'trigger-only') {
      triggerOnly += 1
    }
    if (capability.trigger.classification === 'alert-candidate') {
      alertCandidates += 1
    }
  }

  return {
    total: capabilities.length,
    visualizable: capabilities.length - blocked,
    generatedThreeVariant,
    generatedRepresentations: generatedThreeVariant * 3,
    dedicated,
    blocked,
    dashboardWidget,
    ordinaryOverlay,
    triggerOnly,
    alertCandidates
  }
}

export const TELEMETRY_CAPABILITY_SUMMARY =
  summarizeTelemetryCapabilityRegistry()

export type { TelemetryCapabilityId } from './capabilities'
