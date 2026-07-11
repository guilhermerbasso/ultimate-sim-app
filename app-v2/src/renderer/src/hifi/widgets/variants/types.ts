import type { TelemetrySnapshot } from '../../../../../shared/telemetry'
import type { TelemetryField } from '../types'

export const TELEMETRY_VARIANTS = ['competition', 'futuristic', 'ddu'] as const

export type TelemetryVariant = (typeof TELEMETRY_VARIANTS)[number]
export type TelemetryArchetype = 'radial' | 'linear' | 'digital' | 'indicator'
export type TelemetryDatum = number | string | boolean | readonly string[] | undefined
export type TelemetryTone = 'accent' | 'neutral' | 'good' | 'info' | 'warning' | 'danger'

export type DescriptorBound =
  | number
  | ((snapshot: TelemetrySnapshot | null) => number | undefined)

export interface DescriptorThreshold {
  value: DescriptorBound
  when: 'above' | 'below'
}

export interface TelemetryDescriptor {
  /** Inventory concept key from docs/telemetry-inventory.md. */
  id: string
  /** Catalog title; never rendered as a redundant in-widget title. */
  label: string
  /** Short motorsport channel mnemonic used only when the value/unit is ambiguous. */
  context?: string
  unit?: string
  min?: DescriptorBound
  max?: DescriptorBound
  redline?: DescriptorBound
  warning?: DescriptorThreshold
  critical?: DescriptorThreshold
  decimals?: number
  signed?: boolean
  prefix?: string
  suffix?: string
  archetype: TelemetryArchetype
  category: string
  focus: string
  requires: readonly TelemetryField[]
  tags?: readonly string[]
  read: (snapshot: TelemetrySnapshot | null) => TelemetryDatum
  numeric?: (
    datum: TelemetryDatum,
    snapshot: TelemetrySnapshot | null
  ) => number | undefined
  format?: (
    datum: TelemetryDatum,
    snapshot: TelemetrySnapshot | null
  ) => string
  active?: (
    datum: TelemetryDatum,
    snapshot: TelemetrySnapshot | null
  ) => boolean | undefined
  tone?: (
    datum: TelemetryDatum,
    snapshot: TelemetrySnapshot | null
  ) => TelemetryTone
}

export interface PreparedTelemetryReading {
  datum: TelemetryDatum
  numeric: number | undefined
  display: string
  unit?: string
  available: boolean
  active: boolean | undefined
  fraction: number
  min: number
  max: number
  tone: TelemetryTone
}
