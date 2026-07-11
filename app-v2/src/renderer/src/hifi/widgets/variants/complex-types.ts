import type { TelemetrySnapshot } from '../../../../../shared/telemetry'
import type { TelemetryField } from '../types'
import type { TelemetryTone } from './types'

export type ComplexTelemetryArchetype =
  | 'table'
  | 'radar'
  | 'map'
  | 'vector'
  | 'corners'
  | 'status'
  | 'steering'

export interface ComplexTableRow {
  key: string
  position?: number
  carNumber?: string
  name?: string
  value: string
  fraction?: number
  tone?: TelemetryTone
  classColor?: string
  isPlayer?: boolean
}

export interface ComplexTableModel {
  kind: 'table'
  column: string
  rows: ComplexTableRow[]
  available: boolean
}

export interface ComplexRadarCar {
  key: string
  x: number
  y: number
  gapSec?: number
  label?: string
  color?: string
  isAlongside?: boolean
}

export interface ComplexRadarModel {
  kind: 'radar'
  cars: ComplexRadarCar[]
  side: 'clear' | 'left' | 'right' | 'both'
  available: boolean
}

export interface ComplexMapModel {
  kind: 'map'
  progress?: number
  distanceM?: number
  trackLengthKm?: number
  lat?: number
  lon?: number
  altitudeM?: number
  available: boolean
}

export interface ComplexVectorAxis {
  label: string
  value?: number
  unit?: string
  decimals?: number
  signed?: boolean
}

export interface ComplexVectorModel {
  kind: 'vector'
  x?: number
  y?: number
  headingRad?: number
  axes: ComplexVectorAxis[]
  available: boolean
}

export type CornerKey = 'lf' | 'rf' | 'lr' | 'rr'

export interface ComplexCornerCell {
  key: CornerKey
  values: Array<number | undefined>
}

export interface ComplexCornersModel {
  kind: 'corners'
  unit: string
  decimals: number
  cells: ComplexCornerCell[]
  zoneLabels?: string[]
  available: boolean
}

export interface ComplexStatusItem {
  key: string
  label: string
  value?: string
  tone?: TelemetryTone
}

export interface ComplexStatusModel {
  kind: 'status'
  primary: string
  secondary?: string
  tone: TelemetryTone
  active?: boolean
  items?: ComplexStatusItem[]
  available: boolean
}

export interface ComplexSteeringModel {
  kind: 'steering'
  angleDeg?: number
  maxDeg?: number
  available: boolean
}

export type ComplexTelemetryModel =
  | ComplexTableModel
  | ComplexRadarModel
  | ComplexMapModel
  | ComplexVectorModel
  | ComplexCornersModel
  | ComplexStatusModel
  | ComplexSteeringModel

export interface ComplexTelemetryDescriptor {
  id: string
  label: string
  context?: string
  archetype: ComplexTelemetryArchetype
  category: string
  focus: string
  requires: readonly TelemetryField[]
  tags?: readonly string[]
  read: (snapshot: TelemetrySnapshot | null) => ComplexTelemetryModel
}
