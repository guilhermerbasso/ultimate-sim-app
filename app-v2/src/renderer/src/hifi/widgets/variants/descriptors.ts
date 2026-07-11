import {
  formatTimeOfDay,
  trackSurfaceMaterialLabel,
  type DriverEntry,
  type EngineWarnings,
  type Flags,
  type TelemetrySnapshot
} from '../../../../../shared/telemetry'
import type { TelemetryField } from '../types'
import type {
  TelemetryDatum,
  TelemetryDescriptor,
  TelemetryTone
} from './types'

type DescriptorBase = Omit<TelemetryDescriptor, 'read' | 'requires'>

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function numericField(
  field: TelemetryField,
  descriptor: DescriptorBase,
  transform?: (
    value: number,
    snapshot: TelemetrySnapshot | null
  ) => number | undefined
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

function settingField(
  field: TelemetryField,
  descriptor: DescriptorBase
): TelemetryDescriptor {
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

function booleanField(
  field: TelemetryField,
  descriptor: DescriptorBase
): TelemetryDescriptor {
  return {
    ...descriptor,
    requires: [field],
    read: (snapshot) => {
      const value = snapshot?.[field]
      return typeof value === 'boolean' ? value : undefined
    }
  }
}

function textField(
  field: TelemetryField,
  descriptor: DescriptorBase
): TelemetryDescriptor {
  return {
    ...descriptor,
    requires: [field],
    read: (snapshot) => {
      const value = snapshot?.[field]
      return typeof value === 'string' && value.trim() ? value.trim() : undefined
    }
  }
}

function ratioToPercent(value: number): number {
  return value * 100
}

function degrees(value: number): number {
  return (value * 180) / Math.PI
}

function compassDegrees(value: number): number {
  return ((degrees(value) % 360) + 360) % 360
}

function numberDatum(datum: TelemetryDatum): number | undefined {
  return finite(datum)
}

function formatNumber(
  datum: TelemetryDatum,
  decimals = 0,
  prefix = '',
  suffix = ''
): string {
  const value = numberDatum(datum)
  return value == null ? '—' : `${prefix}${value.toFixed(decimals)}${suffix}`
}

function formatSigned(datum: TelemetryDatum, decimals = 3): string {
  const value = numberDatum(datum)
  if (value == null) return '—'
  return `${value >= 0 ? '+' : ''}${value.toFixed(decimals)}`
}

function formatLapTime(datum: TelemetryDatum): string {
  const seconds = numberDatum(datum)
  if (seconds == null || seconds < 0) return '—'
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds - minutes * 60
  return `${minutes}:${remainder.toFixed(3).padStart(6, '0')}`
}

function formatCountdown(datum: TelemetryDatum): string {
  const seconds = numberDatum(datum)
  if (seconds == null || seconds < 0) return '—'
  const whole = Math.floor(seconds)
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const remainder = whole % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`
}

function formatGear(datum: TelemetryDatum): string {
  const value = numberDatum(datum)
  if (value == null) return '—'
  if (value < 0) return 'R'
  if (value === 0) return 'N'
  return String(Math.trunc(value))
}

function humanize(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toUpperCase()
}

function compact(value: string, max = 20): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`
}

function player(snapshot: TelemetrySnapshot | null): DriverEntry | undefined {
  return snapshot?.drivers?.find((driver) => driver.isPlayer)
}

function activeEngineWarnings(warnings: EngineWarnings | undefined): string[] | undefined {
  if (!warnings) return undefined
  const names: Array<[keyof EngineWarnings, string]> = [
    ['mandRepair', 'REPAIR'],
    ['oilPressure', 'OIL P'],
    ['fuelPressure', 'FUEL P'],
    ['waterTemp', 'WATER'],
    ['oilTemp', 'OIL T'],
    ['stalled', 'STALL'],
    ['revLimiter', 'LIMITER'],
    ['pitLimiter', 'PIT LIMIT'],
    ['optRepair', 'OPT REPAIR']
  ]
  return names.filter(([key]) => warnings[key]).map(([, label]) => label)
}

function activeRaceFlags(flags: Flags | undefined): string[] | undefined {
  if (!flags) return undefined
  const priority: Array<[keyof Flags, string]> = [
    ['red', 'RED'],
    ['disqualify', 'DQ'],
    ['black', 'BLACK'],
    ['meatball', 'MEATBALL'],
    ['repair', 'REPAIR'],
    ['yellow', 'YELLOW'],
    ['blue', 'BLUE'],
    ['white', 'WHITE'],
    ['checkered', 'CHECKERED'],
    ['greenWhiteCheckered', 'G/W/C'],
    ['green', 'GREEN']
  ]
  return priority.filter(([key]) => flags[key]).map(([, label]) => label)
}

function firstOrClear(datum: TelemetryDatum): string {
  return Array.isArray(datum) ? datum[0] ?? 'CLEAR' : '—'
}

function raceFlagTone(datum: TelemetryDatum): TelemetryTone {
  const flag = Array.isArray(datum) ? datum[0] : undefined
  if (flag === 'GREEN') return 'good'
  if (flag === 'BLUE') return 'info'
  if (flag === 'YELLOW' || flag === 'WHITE' || flag === 'CHECKERED' || flag === 'G/W/C') {
    return 'warning'
  }
  if (flag) return 'danger'
  return 'neutral'
}

function pitServiceLabel(value: number): string {
  if (value === 0) return 'STANDBY'
  if (value === 1) return 'SERVICING'
  if (value === 2) return 'COMPLETE'
  if (value >= 100) return 'SERVICE ERR'
  return `STATUS ${Math.trunc(value)}`
}

function pitServiceTone(value: number): TelemetryTone {
  if (value === 2) return 'good'
  if (value >= 100) return 'danger'
  if (value > 0) return 'warning'
  return 'neutral'
}

const deltaBase = {
  unit: 's',
  min: -5,
  max: 5,
  decimals: 3,
  signed: true,
  archetype: 'linear' as const,
  category: 'timing',
  focus: 'delta',
  format: (datum: TelemetryDatum) => formatSigned(datum),
  tags: ['delta', 'pace']
}

/** Inventory-backed scalar/text descriptors renderable by the four core factories. */
export const TELEMETRY_DESCRIPTORS: TelemetryDescriptor[] = [
  numericField('speedKmh', {
    id: 'speed',
    label: 'Speed',
    context: 'SPD',
    unit: 'km/h',
    min: 0,
    max: 360,
    archetype: 'radial',
    category: 'drive',
    focus: 'pace',
    tags: ['speed']
  }),
  numericField('rpm', {
    id: 'engineRpm',
    label: 'Engine RPM',
    context: 'RPM',
    unit: 'rpm',
    min: 0,
    max: (snapshot) =>
      finite(snapshot?.maxRpm) ?? finite(snapshot?.revLights?.lastRpm) ?? 10000,
    redline: (snapshot) =>
      finite(snapshot?.shiftRpm) ?? finite(snapshot?.revLights?.shiftRpm),
    archetype: 'radial',
    category: 'engine',
    focus: 'engine',
    tags: ['rpm', 'engine']
  }),
  numericField('gear', {
    id: 'gear',
    label: 'Gear',
    archetype: 'digital',
    category: 'drive',
    focus: 'pace',
    format: formatGear,
    tags: ['gear']
  }),
  {
    id: 'engineWarnings',
    label: 'Engine Warnings',
    context: 'ENG',
    archetype: 'indicator',
    category: 'engine',
    focus: 'engine',
    requires: ['engineWarnings'],
    tags: ['engine', 'flags', 'warning'],
    read: (snapshot) => activeEngineWarnings(snapshot?.engineWarnings),
    format: firstOrClear,
    active: (datum) => Array.isArray(datum) && datum.length > 0,
    tone: (datum) => (Array.isArray(datum) && datum.length > 0 ? 'danger' : 'neutral')
  },
  numericField('oilPressureKpa', {
    id: 'oilPressure',
    label: 'Oil Pressure',
    context: 'OIL P',
    unit: 'kPa',
    min: 0,
    max: 700,
    archetype: 'radial',
    category: 'engine',
    focus: 'engine',
    tags: ['oil', 'pressure']
  }),
  numericField('oilTempC', {
    id: 'oilTemperature',
    label: 'Oil Temperature',
    context: 'OIL T',
    unit: '°C',
    min: 40,
    max: 160,
    archetype: 'radial',
    category: 'engine',
    focus: 'engine',
    tags: ['oil', 'temperature']
  }),
  numericField('waterTempC', {
    id: 'coolantTemperature',
    label: 'Coolant Temperature',
    context: 'WATER',
    unit: '°C',
    min: 40,
    max: 140,
    archetype: 'radial',
    category: 'engine',
    focus: 'engine',
    tags: ['water', 'temperature']
  }),
  numericField('waterLevelL', {
    id: 'coolantLevel',
    label: 'Coolant Level',
    context: 'WATER',
    unit: 'L',
    min: 0,
    max: 8,
    decimals: 1,
    archetype: 'radial',
    category: 'engine',
    focus: 'engine',
    tags: ['water', 'level']
  }),
  numericField('oilLevelL', {
    id: 'oilLevel',
    label: 'Oil Level',
    context: 'OIL',
    unit: 'L',
    min: 0,
    max: 6,
    decimals: 1,
    archetype: 'radial',
    category: 'engine',
    focus: 'engine',
    tags: ['oil', 'level']
  }),
  numericField('voltage', {
    id: 'systemVoltage',
    label: 'System Voltage',
    context: 'VOLT',
    unit: 'V',
    min: 10,
    max: 16,
    decimals: 1,
    archetype: 'radial',
    category: 'engine',
    focus: 'engine',
    tags: ['electrical', 'voltage']
  }),
  numericField('manifoldPressBar', {
    id: 'manifoldPressure',
    label: 'Manifold Pressure',
    context: 'MAP',
    unit: 'bar',
    min: 0,
    max: 3,
    decimals: 2,
    archetype: 'radial',
    category: 'engine',
    focus: 'engine',
    tags: ['boost', 'pressure']
  }),
  numericField('fuelPressBar', {
    id: 'fuelPressure',
    label: 'Fuel Pressure',
    context: 'FUEL P',
    unit: 'bar',
    min: 0,
    max: 8,
    decimals: 1,
    archetype: 'radial',
    category: 'engine',
    focus: 'engine',
    tags: ['fuel', 'pressure']
  }),
  numericField(
    'ersBatteryPct',
    {
      id: 'ersBattery',
      label: 'ERS Battery',
      context: 'ERS',
      unit: '%',
      min: 0,
      max: 100,
      archetype: 'radial',
      category: 'engine',
      focus: 'strategy',
      tags: ['ers', 'battery']
    },
    ratioToPercent
  ),
  numericField('weightPenaltyKg', {
    id: 'bopWeight',
    label: 'BoP Weight Penalty',
    context: 'BoP W',
    unit: 'kg',
    decimals: 0,
    archetype: 'digital',
    category: 'engine',
    focus: 'setup',
    tags: ['bop', 'weight']
  }),
  numericField('powerAdjustPct', {
    id: 'bopPower',
    label: 'BoP Power Adjustment',
    context: 'BoP P',
    unit: '%',
    decimals: 1,
    signed: true,
    archetype: 'digital',
    category: 'engine',
    focus: 'setup',
    format: (datum) => formatSigned(datum, 1),
    tags: ['bop', 'power']
  }),
  booleanField('drs', {
    id: 'drs',
    label: 'DRS State',
    archetype: 'indicator',
    category: 'drive',
    focus: 'pace',
    format: (datum) => (datum === true ? 'DRS' : 'DRS OFF'),
    tone: (datum) => (datum === true ? 'good' : 'neutral'),
    tags: ['drs']
  }),
  booleanField('pushToPass', {
    id: 'pushToPassState',
    label: 'Push-to-Pass State',
    archetype: 'indicator',
    category: 'drive',
    focus: 'strategy',
    format: (datum) => (datum === true ? 'P2P' : 'P2P READY'),
    tone: (datum) => (datum === true ? 'info' : 'neutral'),
    tags: ['push-to-pass']
  }),
  numericField('pushToPassCount', {
    id: 'pushToPassAllowance',
    label: 'Push-to-Pass Allowance',
    context: 'P2P',
    archetype: 'digital',
    category: 'drive',
    focus: 'strategy',
    tags: ['push-to-pass', 'count']
  }),
  numericField(
    'yawNorth',
    {
      id: 'headingNorth',
      label: 'Heading Relative to North',
      context: 'HDG',
      unit: '°',
      min: 0,
      max: 360,
      archetype: 'radial',
      category: 'drive',
      focus: 'track',
      format: (datum) => formatNumber(datum, 0, '', '°'),
      tags: ['heading', 'track']
    },
    compassDegrees
  ),
  numericField(
    'throttle',
    {
      id: 'throttle',
      label: 'Throttle',
      context: 'THR',
      unit: '%',
      min: 0,
      max: 100,
      archetype: 'linear',
      category: 'inputs',
      focus: 'controls',
      tags: ['throttle']
    },
    ratioToPercent
  ),
  numericField(
    'brake',
    {
      id: 'brake',
      label: 'Brake',
      context: 'BRK',
      unit: '%',
      min: 0,
      max: 100,
      archetype: 'linear',
      category: 'inputs',
      focus: 'controls',
      tags: ['brakes']
    },
    ratioToPercent
  ),
  numericField(
    'clutch',
    {
      id: 'clutch',
      label: 'Clutch',
      context: 'CLT',
      unit: '%',
      min: 0,
      max: 100,
      archetype: 'linear',
      category: 'inputs',
      focus: 'controls',
      tags: ['clutch']
    },
    ratioToPercent
  ),
  numericField(
    'handbrake',
    {
      id: 'handbrake',
      label: 'Handbrake',
      context: 'HBRK',
      unit: '%',
      min: 0,
      max: 100,
      archetype: 'linear',
      category: 'inputs',
      focus: 'controls',
      tags: ['handbrake']
    },
    ratioToPercent
  ),
  numericField('steeringAngleMaxDeg', {
    id: 'steeringLock',
    label: 'Steering Lock',
    context: 'LOCK',
    unit: '°',
    min: 0,
    max: 1080,
    archetype: 'linear',
    category: 'inputs',
    focus: 'setup',
    tags: ['steering', 'lock']
  }),
  numericField(
    'steeringTorquePct',
    {
      id: 'steeringTorque',
      label: 'Steering FFB Torque',
      context: 'FFB',
      unit: '%',
      min: 0,
      max: 100,
      archetype: 'linear',
      category: 'inputs',
      focus: 'controls',
      tags: ['steering', 'torque']
    },
    ratioToPercent
  ),
  numericField('brakeBiasPct', {
    id: 'brakeBias',
    label: 'Brake Bias',
    context: 'BB',
    unit: '%',
    decimals: 1,
    archetype: 'digital',
    category: 'inputs',
    focus: 'setup',
    tags: ['brake-bias', 'setup']
  }),
  settingField('absLevel', {
    id: 'absSetting',
    label: 'ABS Setting',
    context: 'ABS',
    archetype: 'digital',
    category: 'inputs',
    focus: 'setup',
    tags: ['abs', 'setup']
  }),
  booleanField('absActive', {
    id: 'absActive',
    label: 'ABS Intervention',
    archetype: 'indicator',
    category: 'inputs',
    focus: 'controls',
    format: (datum) => (datum === true ? 'ABS' : 'ABS READY'),
    tone: (datum) => (datum === true ? 'warning' : 'neutral'),
    tags: ['abs', 'intervention']
  }),
  numericField('absCutPct', {
    id: 'absCut',
    label: 'ABS Pressure Cut',
    context: 'ABS CUT',
    unit: '%',
    min: 0,
    max: 100,
    decimals: 1,
    archetype: 'radial',
    category: 'inputs',
    focus: 'controls',
    tags: ['abs', 'brakes']
  }),
  settingField('tcLevel', {
    id: 'tcSetting',
    label: 'Traction-Control Setting',
    context: 'TC',
    archetype: 'digital',
    category: 'inputs',
    focus: 'setup',
    tags: ['tc', 'setup']
  }),
  booleanField('tcActive', {
    id: 'tcActive',
    label: 'Traction-Control Intervention',
    archetype: 'indicator',
    category: 'inputs',
    focus: 'controls',
    format: (datum) => (datum === true ? 'TC' : 'TC READY'),
    tone: (datum) => (datum === true ? 'warning' : 'neutral'),
    tags: ['tc', 'intervention', 'derived']
  }),
  settingField('engineMap', {
    id: 'engineMap',
    label: 'Engine Map',
    context: 'MAP',
    archetype: 'digital',
    category: 'inputs',
    focus: 'setup',
    tags: ['engine-map', 'setup']
  }),
  numericField('currentLap', {
    id: 'currentLap',
    label: 'Current Lap',
    archetype: 'digital',
    category: 'timing',
    focus: 'timing',
    format: (datum) => formatNumber(datum, 0, 'L'),
    tags: ['laps']
  }),
  numericField(
    'lapDistPct',
    {
      id: 'lapProgress',
      label: 'Lap Progress',
      context: 'LAP',
      unit: '%',
      min: 0,
      max: 100,
      archetype: 'linear',
      category: 'timing',
      focus: 'track',
      tags: ['laps', 'track']
    },
    ratioToPercent
  ),
  numericField('currentLapTimeSec', {
    id: 'currentLapTime',
    label: 'Current Lap Time',
    context: 'CURRENT',
    archetype: 'digital',
    category: 'timing',
    focus: 'timing',
    format: formatLapTime,
    tags: ['laps', 'clock']
  }),
  numericField('lastLapTimeSec', {
    id: 'lastLapTime',
    label: 'Last Lap Time',
    context: 'LAST',
    archetype: 'digital',
    category: 'timing',
    focus: 'timing',
    format: formatLapTime,
    tags: ['laps', 'clock']
  }),
  numericField('bestLapTimeSec', {
    id: 'bestLapTime',
    label: 'Best Lap Time',
    context: 'BEST',
    archetype: 'digital',
    category: 'timing',
    focus: 'pace',
    format: formatLapTime,
    tags: ['laps', 'clock', 'best']
  }),
  numericField('estimatedLapTimeSec', {
    id: 'estimatedLap',
    label: 'Estimated Lap Time',
    context: 'EST',
    archetype: 'digital',
    category: 'timing',
    focus: 'pace',
    format: formatLapTime,
    tags: ['laps', 'clock', 'estimated']
  }),
  numericField('deltaToBestSec', {
    ...deltaBase,
    id: 'deltaBest',
    label: 'Delta to Personal Best',
    context: 'BEST Δ'
  }),
  numericField('deltaToSessionBestSec', {
    ...deltaBase,
    id: 'deltaSessionBest',
    label: 'Delta to Session Best',
    context: 'SESSION Δ'
  }),
  numericField('deltaToOptimalSec', {
    ...deltaBase,
    id: 'deltaOptimal',
    label: 'Delta to Personal Optimal',
    context: 'OPT Δ'
  }),
  numericField('deltaToSessionOptimalSec', {
    ...deltaBase,
    id: 'deltaSessionOptimal',
    label: 'Delta to Session Optimal',
    context: 'SES OPT Δ'
  }),
  numericField('deltaToDriverBestSec', {
    ...deltaBase,
    id: 'deltaDriverBest',
    label: 'Delta to Driver Best',
    context: 'DRIVER Δ'
  }),
  {
    id: 'sessionState',
    label: 'Session State',
    context: 'SESSION',
    archetype: 'indicator',
    category: 'session',
    focus: 'race-control',
    requires: ['sessionState'],
    tags: ['session', 'status'],
    read: (snapshot) => snapshot?.sessionState,
    format: (datum) => (typeof datum === 'string' ? humanize(datum) : '—'),
    active: (datum) => typeof datum === 'string',
    tone: (datum) => {
      if (datum === 'racing') return 'good'
      if (datum === 'checkered' || datum === 'paradeLaps') return 'warning'
      if (datum === 'invalid') return 'danger'
      return 'neutral'
    }
  },
  numericField('sessionTimeOfDay', {
    id: 'timeOfDay',
    label: 'Time of Day',
    context: 'CLOCK',
    archetype: 'digital',
    category: 'session',
    focus: 'session',
    format: (datum) => {
      const value = numberDatum(datum)
      return value == null ? '—' : formatTimeOfDay(value) ?? '—'
    },
    tags: ['clock', 'session']
  }),
  numericField('sessionTimeRemainingSec', {
    id: 'timeRemaining',
    label: 'Time Remaining',
    context: 'TIME LEFT',
    archetype: 'digital',
    category: 'session',
    focus: 'strategy',
    format: formatCountdown,
    tags: ['clock', 'session']
  }),
  numericField('lapsRemaining', {
    id: 'lapsRemaining',
    label: 'Laps Remaining',
    context: 'LAPS LEFT',
    archetype: 'digital',
    category: 'session',
    focus: 'strategy',
    tags: ['laps', 'session']
  }),
  textField('sessionType', {
    id: 'sessionType',
    label: 'Session Type',
    context: 'SESSION',
    archetype: 'digital',
    category: 'session',
    focus: 'session',
    format: (datum) => (typeof datum === 'string' ? compact(humanize(datum), 16) : '—'),
    tags: ['session', 'identity']
  }),
  {
    id: 'paceMode',
    label: 'Pace Mode',
    context: 'PACE',
    archetype: 'digital',
    category: 'session',
    focus: 'race-control',
    requires: ['paceMode'],
    tags: ['session', 'pace'],
    read: (snapshot) => snapshot?.paceMode,
    format: (datum) => (typeof datum === 'string' ? compact(humanize(datum), 18) : '—')
  },
  {
    id: 'raceFlags',
    label: 'Race-Control Flags',
    archetype: 'indicator',
    category: 'session',
    focus: 'race-control',
    requires: ['flags'],
    tags: ['flags', 'session'],
    read: (snapshot) => activeRaceFlags(snapshot?.flags),
    format: firstOrClear,
    active: (datum) => Array.isArray(datum) && datum.length > 0,
    tone: raceFlagTone
  },
  {
    id: 'proximity',
    label: 'Side Proximity',
    context: 'SPOTTER',
    archetype: 'indicator',
    category: 'standings',
    focus: 'traffic',
    requires: ['carLeftRight'],
    tags: ['radar', 'traffic'],
    read: (snapshot) => snapshot?.carLeftRight,
    format: (datum, snapshot) => {
      if (typeof datum !== 'string') return '—'
      if (datum === 'clear') return 'CLEAR'
      if (datum === 'both') return '3 WIDE'
      const count = finite(snapshot?.carLeftRightCount)
      return `${count != null && count > 1 ? `${Math.trunc(count)} ` : ''}${datum.toUpperCase()}`
    },
    active: (datum) => typeof datum === 'string' && datum !== 'clear',
    tone: (datum) =>
      typeof datum === 'string' && datum !== 'clear' ? 'warning' : 'neutral'
  },
  textField('carName', {
    id: 'carIdentity',
    label: 'Car Identity',
    context: 'CAR',
    archetype: 'digital',
    category: 'identity',
    focus: 'session',
    format: (datum) => (typeof datum === 'string' ? compact(datum, 18) : '—'),
    tags: ['car', 'identity']
  }),
  {
    id: 'carNumber',
    label: 'Car Number',
    archetype: 'digital',
    category: 'identity',
    focus: 'session',
    requires: ['drivers'],
    tags: ['car', 'number', 'identity'],
    read: (snapshot) => player(snapshot)?.carNumber,
    format: (datum) => (typeof datum === 'string' ? `#${compact(datum, 6)}` : '—')
  },
  {
    id: 'classIdentity',
    label: 'Class Identity',
    context: 'CLASS',
    archetype: 'digital',
    category: 'identity',
    focus: 'session',
    requires: ['drivers'],
    tags: ['class', 'identity'],
    read: (snapshot) => player(snapshot)?.className,
    format: (datum) => (typeof datum === 'string' ? compact(datum, 18) : '—')
  },
  textField('driverName', {
    id: 'driverIdentity',
    label: 'Driver Identity',
    context: 'DRIVER',
    archetype: 'digital',
    category: 'identity',
    focus: 'session',
    format: (datum) => (typeof datum === 'string' ? compact(datum, 18) : '—'),
    tags: ['driver', 'identity']
  }),
  {
    id: 'driverRating',
    label: 'Driver Rating / Licence',
    context: 'RATING',
    archetype: 'digital',
    category: 'identity',
    focus: 'session',
    requires: ['drivers'],
    tags: ['driver', 'rating', 'license'],
    read: (snapshot) => {
      const entry = player(snapshot)
      if (!entry) return undefined
      const rating = finite(entry.iRating)
      const license = entry.license?.trim()
      if (rating != null && license) return `${Math.round(rating)} · ${license}`
      if (rating != null) return String(Math.round(rating))
      return license || undefined
    },
    format: (datum) => (typeof datum === 'string' ? compact(datum, 18) : '—')
  },
  {
    id: 'teamIdentity',
    label: 'Team Identity',
    context: 'TEAM',
    archetype: 'digital',
    category: 'identity',
    focus: 'session',
    requires: ['drivers'],
    tags: ['team', 'identity'],
    read: (snapshot) => player(snapshot)?.teamName,
    format: (datum) => (typeof datum === 'string' ? compact(datum, 18) : '—')
  },
  numericField('position', {
    id: 'overallPosition',
    label: 'Overall Position',
    archetype: 'digital',
    category: 'standings',
    focus: 'traffic',
    format: (datum) => formatNumber(datum, 0, 'P'),
    tags: ['position', 'standings']
  }),
  numericField('classPosition', {
    id: 'classPosition',
    label: 'Class Position',
    archetype: 'digital',
    category: 'standings',
    focus: 'traffic',
    format: (datum) => formatNumber(datum, 0, 'C'),
    tags: ['position', 'class', 'standings']
  }),
  numericField('totalCars', {
    id: 'fieldSize',
    label: 'Field Size',
    context: 'FIELD',
    archetype: 'digital',
    category: 'standings',
    focus: 'traffic',
    format: (datum) => formatNumber(datum, 0, '/'),
    tags: ['standings', 'field']
  }),
  numericField('strengthOfField', {
    id: 'strengthOfField',
    label: 'Strength of Field',
    context: 'SOF',
    archetype: 'digital',
    category: 'standings',
    focus: 'session',
    tags: ['standings', 'irating']
  }),
  numericField('fuelLiters', {
    id: 'fuelLevel',
    label: 'Fuel Level',
    context: 'FUEL',
    unit: 'L',
    min: 0,
    max: (snapshot) => finite(snapshot?.fuelCapacityLiters) ?? 120,
    decimals: 1,
    archetype: 'radial',
    category: 'fuel',
    focus: 'fuel',
    tags: ['fuel', 'level']
  }),
  numericField(
    'fuelLevelPct',
    {
      id: 'fuelLevelPct',
      label: 'Fuel Level Percentage',
      context: 'FUEL',
      unit: '%',
      min: 0,
      max: 100,
      archetype: 'radial',
      category: 'fuel',
      focus: 'fuel',
      tags: ['fuel', 'level']
    },
    ratioToPercent
  ),
  numericField('fuelUsePerHourKg', {
    id: 'fuelConsumptionRate',
    label: 'Fuel Mass-Flow Rate',
    context: 'FLOW',
    unit: 'kg/h',
    decimals: 1,
    archetype: 'digital',
    category: 'fuel',
    focus: 'fuel',
    tags: ['fuel', 'consumption']
  }),
  numericField('fuelPerLapKg', {
    id: 'fuelPerLap',
    label: 'Fuel Used per Lap',
    context: 'PER LAP',
    unit: 'kg/lap',
    decimals: 2,
    archetype: 'digital',
    category: 'fuel',
    focus: 'fuel',
    tags: ['fuel', 'laps', 'derived']
  }),
  numericField('fuelCapacityLiters', {
    id: 'fuelCapacity',
    label: 'Fuel Capacity',
    context: 'CAPACITY',
    unit: 'L',
    decimals: 1,
    archetype: 'digital',
    category: 'fuel',
    focus: 'fuel',
    tags: ['fuel', 'capacity']
  }),
  numericField('airTempC', {
    id: 'airTemperature',
    label: 'Air Temperature',
    context: 'AIR',
    unit: '°C',
    min: -10,
    max: 50,
    decimals: 1,
    archetype: 'radial',
    category: 'weather',
    focus: 'weather',
    tags: ['weather', 'temperature']
  }),
  numericField('trackTempC', {
    id: 'trackTemperature',
    label: 'Track Temperature',
    context: 'TRACK',
    unit: '°C',
    min: 0,
    max: 70,
    decimals: 1,
    archetype: 'radial',
    category: 'weather',
    focus: 'weather',
    tags: ['weather', 'temperature', 'track']
  }),
  numericField(
    'fogPct',
    {
      id: 'fogLevel',
      label: 'Fog Level',
      context: 'FOG',
      unit: '%',
      min: 0,
      max: 100,
      archetype: 'linear',
      category: 'weather',
      focus: 'weather',
      tags: ['weather', 'fog']
    },
    ratioToPercent
  ),
  numericField(
    'humidityPct',
    {
      id: 'humidity',
      label: 'Relative Humidity',
      context: 'HUM',
      unit: '%',
      min: 0,
      max: 100,
      archetype: 'linear',
      category: 'weather',
      focus: 'weather',
      tags: ['weather', 'humidity']
    },
    ratioToPercent
  ),
  numericField('skies', {
    id: 'skies',
    label: 'Skies',
    context: 'SKY',
    archetype: 'digital',
    category: 'weather',
    focus: 'weather',
    format: (datum) => {
      const value = numberDatum(datum)
      if (value == null) return '—'
      return ['CLEAR', 'PART CLOUD', 'MOST CLOUD', 'OVERCAST'][Math.trunc(value)] ?? `SKY ${Math.trunc(value)}`
    },
    tags: ['weather', 'skies']
  }),
  numericField(
    'trackWetnessPct',
    {
      id: 'trackWetness',
      label: 'Track Wetness',
      context: 'WET',
      unit: '%',
      min: 0,
      max: 100,
      archetype: 'linear',
      category: 'weather',
      focus: 'weather',
      tags: ['weather', 'wetness', 'track']
    },
    ratioToPercent
  ),
  numericField(
    'gripPct',
    {
      id: 'trackGrip',
      label: 'Track Grip',
      context: 'GRIP',
      unit: '%',
      min: 0,
      max: 100,
      archetype: 'linear',
      category: 'weather',
      focus: 'weather',
      tags: ['weather', 'grip', 'track']
    },
    ratioToPercent
  ),
  booleanField('weatherDeclaredWet', {
    id: 'declaredWet',
    label: 'Wet-Weather Declaration',
    archetype: 'indicator',
    category: 'weather',
    focus: 'weather',
    format: (datum) => (datum === true ? 'WET' : 'DRY'),
    active: (datum) => datum !== undefined,
    tone: (datum) => (datum === true ? 'warning' : 'neutral'),
    tags: ['weather', 'wetness', 'flags']
  }),
  {
    id: 'playerSurfaceMaterial',
    label: 'Player-Car Surface Material',
    context: 'SURFACE',
    archetype: 'digital',
    category: 'weather',
    focus: 'track',
    requires: ['trackSurfaceMaterial'],
    tags: ['weather', 'track', 'surface'],
    read: (snapshot) => {
      const raw = finite(snapshot?.trackSurfaceMaterial)
      return raw == null ? undefined : trackSurfaceMaterialLabel(raw)
    },
    format: (datum) => (typeof datum === 'string' ? humanize(datum) : '—')
  },
  {
    id: 'trackIdentity',
    label: 'Track and Configuration',
    context: 'TRACK',
    archetype: 'digital',
    category: 'identity',
    focus: 'track',
    requires: ['trackName', 'trackConfigName'],
    tags: ['track', 'identity'],
    read: (snapshot) => {
      const track = snapshot?.trackName?.trim()
      const config = snapshot?.trackConfigName?.trim()
      if (!track) return undefined
      return config ? `${track} · ${config}` : track
    },
    format: (datum) => (typeof datum === 'string' ? compact(datum, 21) : '—')
  },
  booleanField('onPitRoad', {
    id: 'onPitRoad',
    label: 'On Pit Road',
    archetype: 'indicator',
    category: 'pit',
    focus: 'strategy',
    format: (datum) => (datum === true ? 'PIT ROAD' : 'TRACK'),
    tone: (datum) => (datum === true ? 'info' : 'neutral'),
    tags: ['pit', 'status']
  }),
  booleanField('pitLimiter', {
    id: 'pitLimiter',
    label: 'Pit Limiter',
    archetype: 'indicator',
    category: 'pit',
    focus: 'strategy',
    format: (datum) => (datum === true ? 'LIMITER' : 'LIMITER OFF'),
    tone: (datum) => (datum === true ? 'info' : 'neutral'),
    tags: ['pit', 'limiter']
  }),
  {
    id: 'pitServicesSelected',
    label: 'Selected Pit Services',
    context: 'PIT SV',
    archetype: 'digital',
    category: 'pit',
    focus: 'strategy',
    requires: ['pitServiceFlags'],
    tags: ['pit', 'service', 'strategy'],
    read: (snapshot) => snapshot?.pitServiceFlags,
    format: (datum) => {
      if (!Array.isArray(datum)) return '—'
      if (datum.length === 0) return 'NONE'
      return compact(
        datum
          .map((value) => value.replace(/fastRepair/i, 'FAST').toUpperCase())
          .join('+'),
        20
      )
    }
  },
  {
    id: 'pitsOpen',
    label: 'Pits Open',
    archetype: 'indicator',
    category: 'pit',
    focus: 'race-control',
    requires: ['pit'],
    tags: ['pit', 'flags'],
    read: (snapshot) => snapshot?.pit?.pitsOpen,
    format: (datum) => (datum === true ? 'PITS OPEN' : 'PITS CLOSED'),
    active: (datum) => datum !== undefined,
    tone: (datum) => (datum === true ? 'good' : 'warning')
  },
  {
    id: 'inPitStall',
    label: 'In Pit Stall',
    archetype: 'indicator',
    category: 'pit',
    focus: 'strategy',
    requires: ['pit'],
    tags: ['pit', 'service'],
    read: (snapshot) => snapshot?.pit?.inPitStall,
    format: (datum) => (datum === true ? 'IN STALL' : 'OUT OF STALL'),
    tone: (datum) => (datum === true ? 'info' : 'neutral')
  },
  {
    id: 'pitServiceStatus',
    label: 'Pit-Service Status',
    context: 'PIT SV',
    archetype: 'indicator',
    category: 'pit',
    focus: 'strategy',
    requires: ['pit'],
    tags: ['pit', 'service'],
    read: (snapshot) => finite(snapshot?.pit?.svStatus),
    format: (datum) => {
      const value = numberDatum(datum)
      return value == null ? '—' : pitServiceLabel(value)
    },
    active: (datum) => {
      const value = numberDatum(datum)
      return value == null ? undefined : value !== 0
    },
    tone: (datum) => {
      const value = numberDatum(datum)
      return value == null ? 'neutral' : pitServiceTone(value)
    }
  },
  {
    id: 'repairRequirement',
    label: 'Repair Requirement',
    archetype: 'indicator',
    category: 'pit',
    focus: 'incidents',
    requires: ['pit'],
    tags: ['pit', 'repair', 'warning'],
    read: (snapshot) => {
      const pit = snapshot?.pit
      return pit ? pit.repairNeeded || pit.optRepairNeeded : undefined
    },
    format: (datum) => (datum === true ? 'REPAIR' : 'NO REPAIR'),
    tone: (datum) => (datum === true ? 'danger' : 'neutral')
  },
  numericField('fastRepairsAvailable', {
    id: 'fastRepair',
    label: 'Fast-Repair Allowance',
    context: 'FAST',
    archetype: 'digital',
    category: 'pit',
    focus: 'strategy',
    tags: ['pit', 'repair', 'count']
  }),
  {
    id: 'incidentCounts',
    label: 'Incident Counts',
    context: 'INC',
    archetype: 'linear',
    category: 'pit',
    focus: 'incidents',
    min: 0,
    max: (snapshot) => finite(snapshot?.incidentLimit) ?? 20,
    warning: {
      value: (snapshot) => {
        const limit = finite(snapshot?.incidentLimit)
        return limit == null ? undefined : Math.max(0, limit - 4)
      },
      when: 'above'
    },
    critical: {
      value: (snapshot) => finite(snapshot?.incidentLimit),
      when: 'above'
    },
    requires: ['incidentCount'],
    tags: ['incidents', 'pit'],
    read: (snapshot) =>
      finite(snapshot?.incidentCountMy) ??
      finite(snapshot?.incidentCountTeam) ??
      finite(snapshot?.incidentCount)
  },
  numericField('incidentLimit', {
    id: 'incidentLimit',
    label: 'Incident Limit',
    context: 'INC LIMIT',
    archetype: 'digital',
    category: 'pit',
    focus: 'incidents',
    tags: ['incidents', 'pit']
  })
]

export const TELEMETRY_INVENTORY_ELIGIBLE_COUNT = 143
