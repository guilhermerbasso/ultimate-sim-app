export {
  TELEMETRY_INVENTORY_ELIGIBLE_COUNT,
  TELEMETRY_DESCRIPTORS
} from './descriptors'
export {
  TELEMETRY_BLOCKED_CONCEPTS,
  TELEMETRY_DEFERRED_CONCEPTS,
  TELEMETRY_VARIANT_COVERAGE
} from './coverage'
export {
  TELEMETRY_VARIANT_WIDGETS,
  telemetryVariantArtifactId,
  telemetryVariantModuleId,
  telemetryVariantWidgetId
} from './widgets'
export {
  COMPLEX_ARCHETYPE_WIDGETS,
  REMAINING_TELEMETRY_WIDGETS,
  SNAPSHOT_GAP_WIDGETS
} from './complex-widgets'
export { COMPLEX_TELEMETRY_DESCRIPTORS } from './complex-descriptors'
export { SNAPSHOT_GAP_DESCRIPTORS } from './snapshot-gap-descriptors'
export {
  createCompetitionRenderer,
  createDduRenderer,
  createFuturisticRenderer,
  defaultSizeFor
} from './factories'
export { TELEMETRY_VARIANTS } from './types'
export type {
  DescriptorBound,
  DescriptorThreshold,
  TelemetryArchetype,
  TelemetryDatum,
  TelemetryDescriptor,
  TelemetryTone,
  TelemetryVariant
} from './types'
export type {
  ComplexTelemetryArchetype,
  ComplexTelemetryDescriptor,
  ComplexTelemetryModel
} from './complex-types'
