import type { TelemetrySnapshot } from '../../../../../shared/telemetry'
import { semanticAlertVisibility } from '../../../../../shared/overlays'
import type { TelemetryField } from '../types'
import type { TelemetryDatum, TelemetryDescriptor } from './types'

type DescriptorBase = Omit<TelemetryDescriptor, 'read' | 'requires'>

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function numericField(
  field: TelemetryField,
  descriptor: DescriptorBase,
  transform?: (value: number, snapshot: TelemetrySnapshot | null) => number | undefined
): TelemetryDescriptor {
  return {
    ...descriptor,
    requires: [field],
    read: (snapshot) => {
      const value = finite(snapshot?.[field])
      return value == null ? undefined : transform ? transform(value, snapshot) : value
    }
  }
}

function settingField(field: TelemetryField, descriptor: DescriptorBase): TelemetryDescriptor {
  return {
    ...descriptor,
    requires: [field],
    read: (snapshot) => {
      const value = snapshot?.[field]
      if (typeof value === 'number') return finite(value)
      if (typeof value === 'string' && value.trim()) return value.trim()
      return undefined
    }
  }
}

function numberDatum(datum: TelemetryDatum): number | undefined {
  return finite(datum)
}

function formatElapsed(datum: TelemetryDatum): string {
  const seconds = numberDatum(datum)
  if (seconds == null || seconds < 0) return '—'
  const whole = Math.floor(seconds)
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const remainder = whole % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
}

function formatRepair(datum: TelemetryDatum): string {
  const seconds = numberDatum(datum)
  if (seconds == null || seconds < 0) return '—'
  const minutes = Math.floor(seconds / 60)
  const remainder = Math.floor(seconds % 60)
  return `${minutes}:${String(remainder).padStart(2, '0')}`
}

/** Straightforward SDK fields that fit the existing scalar factories. */
export const SNAPSHOT_GAP_DESCRIPTORS: TelemetryDescriptor[] = [
  numericField('airDensityKgM3', {
    id: 'airDensity',
    label: 'Air Density',
    context: 'AIR ρ',
    unit: 'kg/m³',
    min: 0.8,
    max: 1.5,
    decimals: 3,
    archetype: 'radial',
    category: 'weather',
    focus: 'weather',
    tags: ['weather', 'density']
  }),
  numericField('airPressureKpa', {
    id: 'airPressure',
    label: 'Air Pressure',
    context: 'AIR P',
    unit: 'kPa',
    min: 85,
    max: 120,
    decimals: 1,
    archetype: 'radial',
    category: 'weather',
    focus: 'weather',
    tags: ['weather', 'pressure']
  }),
  settingField('antiRollFront', {
    id: 'antiRollFront',
    label: 'Front Anti-Roll Bar',
    context: 'ARB F',
    archetype: 'digital',
    category: 'inputs',
    focus: 'setup',
    tags: ['setup', 'anti-roll']
  }),
  settingField('antiRollRear', {
    id: 'antiRollRear',
    label: 'Rear Anti-Roll Bar',
    context: 'ARB R',
    archetype: 'digital',
    category: 'inputs',
    focus: 'setup',
    tags: ['setup', 'anti-roll']
  }),
  {
    id: 'bestNLap',
    label: 'Best N-Lap Result',
    context: 'N BEST',
    archetype: 'digital',
    category: 'timing',
    focus: 'pace',
    requires: ['bestNLapLap', 'bestNLapTimeSec'],
    tags: ['laps', 'best', 'clock'],
    read: (snapshot) => {
      const lap = finite(snapshot?.bestNLapLap)
      const time = finite(snapshot?.bestNLapTimeSec)
      if (lap == null && time == null) return undefined
      if (time == null) return `L${Math.trunc(lap ?? 0)}`
      const minutes = Math.floor(time / 60)
      const remainder = time - minutes * 60
      const clock = `${minutes}:${remainder.toFixed(3).padStart(6, '0')}`
      return lap == null ? clock : `L${Math.trunc(lap)} · ${clock}`
    }
  },
  numericField('completedLaps', {
    id: 'completedLaps',
    label: 'Completed Laps',
    context: 'DONE',
    archetype: 'digital',
    category: 'timing',
    focus: 'timing',
    format: (datum) => {
      const value = numberDatum(datum)
      return value == null ? '—' : `L${Math.trunc(value)}`
    },
    tags: ['laps', 'completed']
  }),
  settingField('engineBraking', {
    id: 'engineBraking',
    label: 'Engine Braking',
    context: 'ENG BRK',
    archetype: 'digital',
    category: 'inputs',
    focus: 'setup',
    tags: ['setup', 'engine-braking']
  }),
  numericField('optionalRepairTimeSec', {
    id: 'optionalRepairTime',
    label: 'Optional Repair Time',
    context: 'OPT REPAIR',
    unit: 's',
    archetype: 'digital',
    category: 'pit',
    focus: 'strategy',
    visibility: semanticAlertVisibility('optionalRepairTime'),
    format: formatRepair,
    tags: ['pit', 'repair', 'clock']
  }),
  numericField('pitFuelToAddL', {
    id: 'pitFuelToAdd',
    label: 'Pit Fuel to Add',
    context: 'PIT FUEL',
    unit: 'L',
    min: 0,
    max: (snapshot) => finite(snapshot?.fuelCapacityLiters) ?? 120,
    decimals: 1,
    archetype: 'linear',
    category: 'pit',
    focus: 'strategy',
    visibility: semanticAlertVisibility('pitFuelToAdd'),
    tags: ['pit', 'fuel', 'strategy']
  }),
  numericField(
    'precipitationPct',
    {
      id: 'precipitation',
      label: 'Precipitation',
      context: 'RAIN',
      unit: '%',
      min: 0,
      max: 100,
      decimals: 0,
      archetype: 'linear',
      category: 'weather',
      focus: 'weather',
      visibility: semanticAlertVisibility('precipitation'),
      tags: ['weather', 'rain', 'wetness']
    },
    (value) => value * 100
  ),
  numericField('repairTimeSec', {
    id: 'repairTime',
    label: 'Repair Time',
    context: 'REPAIR',
    unit: 's',
    archetype: 'digital',
    category: 'pit',
    focus: 'strategy',
    visibility: semanticAlertVisibility('repairTime'),
    format: formatRepair,
    tags: ['pit', 'repair', 'clock']
  }),
  {
    id: 'replayTimeline',
    label: 'Replay Timeline',
    context: 'REPLAY',
    unit: 'frame',
    min: 0,
    max: (snapshot) => finite(snapshot?.replayFrameEnd) ?? 1,
    archetype: 'linear',
    category: 'session',
    focus: 'session',
    requires: ['replayFrameNum', 'replayFrameEnd', 'replayPlaying', 'replayContext'],
    tags: ['replay', 'timeline'],
    visibility: semanticAlertVisibility('replayTimeline'),
    read: (snapshot) => finite(snapshot?.replayFrameNum),
    format: (datum, snapshot) => {
      const current = numberDatum(datum)
      const end = finite(snapshot?.replayFrameEnd)
      if (current == null) return '—'
      return end == null ? `${Math.trunc(current)}` : `${Math.trunc(current)} / ${Math.trunc(end)}`
    }
  },
  numericField('sessionNumber', {
    id: 'sessionNumber',
    label: 'Session Number',
    context: 'SESSION',
    archetype: 'digital',
    category: 'session',
    focus: 'session',
    tags: ['session', 'count']
  }),
  numericField('sessionTimeSec', {
    id: 'sessionTime',
    label: 'Session Time',
    context: 'ELAPSED',
    archetype: 'digital',
    category: 'session',
    focus: 'session',
    format: formatElapsed,
    tags: ['session', 'clock']
  }),
  settingField('throttleMap', {
    id: 'throttleMap',
    label: 'Throttle Map',
    context: 'THR MAP',
    archetype: 'digital',
    category: 'inputs',
    focus: 'setup',
    tags: ['setup', 'throttle']
  }),
  settingField('weightJackerRight', {
    id: 'weightJackerRight',
    label: 'Right Weight Jacker',
    context: 'WJ R',
    archetype: 'digital',
    category: 'inputs',
    focus: 'setup',
    tags: ['setup', 'weight-jacker']
  })
]
