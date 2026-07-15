import { isControlledTag } from '../tags'
import {
  TELEMETRY_CAPABILITIES,
  type TelemetryCapabilityId
} from './capabilities'
import type {
  TelemetryCapability,
  TelemetryCapabilityRegistrySummary,
  TelemetryCapabilityTagValidation,
  UnsupportedTelemetryCapability
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
): capability is Exclude<
  TelemetryCapability,
  UnsupportedTelemetryCapability
> {
  return capability.runtime.availability === 'visualizable'
}

export function filterVisualizableTelemetryCapabilities(
  capabilities: readonly TelemetryCapability[] =
    TELEMETRY_CAPABILITY_REGISTRY
): Exclude<TelemetryCapability, UnsupportedTelemetryCapability>[] {
  return capabilities.filter(isVisualizableTelemetryCapability)
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
  let unsupported = 0
  let currentlyVisualizable = 0
  let plannedWidgets = 0
  let plannedOrdinaryOverlays = 0

  for (const capability of capabilities) {
    if (capability.implementation.mode === 'generated-three-variant') {
      generatedThreeVariant += 1
    } else if (
      capability.implementation.mode === 'dedicated-shared-rev-lights'
    ) {
      dedicated += 1
    } else {
      unsupported += 1
    }

    if (capability.runtime.availability === 'visualizable') {
      currentlyVisualizable += 1
    }
    if (capability.surfaces.widget) {
      plannedWidgets += 1
    }
    if (capability.surfaces.ordinaryOverlay) {
      plannedOrdinaryOverlays += 1
    }
  }

  return {
    total: capabilities.length,
    currentlyVisualizable,
    generatedThreeVariant,
    generatedRepresentations: generatedThreeVariant * 3,
    dedicated,
    unsupported,
    plannedWidgets,
    plannedOrdinaryOverlays
  }
}

export const TELEMETRY_CAPABILITY_SUMMARY =
  summarizeTelemetryCapabilityRegistry()

export type { TelemetryCapabilityId } from './capabilities'
