import { isControlledTag, unitTagFor } from '../tags'
import type {
  DedicatedTelemetryCapability,
  GeneratedTelemetryCapability,
  TelemetryCapabilityBase,
  TelemetryRepresentationContract,
  TelemetrySourceConstraint,
  UnsupportedTelemetryCapability
} from './types'

type CapabilityDefinition<Id extends string> = Omit<
  TelemetryCapabilityBase,
  'id' | 'sourceConstraints' | 'surfaces' | 'tags'
> & {
  id: Id
  sourceConstraints?: readonly TelemetrySourceConstraint[]
  tags: readonly string[]
}

type GeneratedDefinition<Id extends string> = CapabilityDefinition<Id> & {
  representations: TelemetryRepresentationContract
}

function capabilityTags(
  definition: CapabilityDefinition<string>
): readonly string[] {
  const candidates = [
    'IR',
    'iRacing',
    'source-iracing',
    'telemetry',
    'telemetry-framework',
    definition.category,
    `focus-${definition.focus}`,
    `telemetry-${definition.id}`,
    ...definition.tags
  ]
  const unitTag = unitTagFor(definition.data.unit ?? undefined)
  if (unitTag && isControlledTag(unitTag)) candidates.push(unitTag)
  return [...new Set(candidates)]
}

function capabilityBase<const Id extends string>(
  definition: CapabilityDefinition<Id>
): TelemetryCapabilityBase & { id: Id } {
  const {
    sourceConstraints = [],
    tags: _tags,
    ...base
  } = definition
  return {
    ...base,
    tags: capabilityTags(definition),
    sourceConstraints,
    surfaces: {
      widget: true,
      ordinaryOverlay: true
    }
  }
}

function generated<const Id extends string>(
  definition: GeneratedDefinition<Id>
): GeneratedTelemetryCapability & { id: Id } {
  const { representations, ...base } = definition
  return {
    ...capabilityBase(base),
    runtime: {
      availability: 'visualizable',
      unavailablePresentation: 'explicit'
    },
    implementation: { mode: 'generated-three-variant' },
    representations
  }
}

function dedicated<const Id extends string>(
  definition: CapabilityDefinition<Id>
): DedicatedTelemetryCapability & { id: Id } {
  return {
    ...capabilityBase(definition),
    runtime: {
      availability: 'visualizable',
      unavailablePresentation: 'explicit'
    },
    implementation: {
      mode: 'dedicated-shared-rev-lights',
      sharedModule: 'revlights'
    }
  }
}

function unsupported<const Id extends string>(
  definition: CapabilityDefinition<Id>,
  reason: string
): UnsupportedTelemetryCapability & { id: Id } {
  return {
    ...capabilityBase(definition),
    runtime: {
      availability: 'unsupported',
      unavailablePresentation: 'explicit',
      unsupportedReason: reason
    },
    implementation: {
      mode: 'unsupported-unavailable',
      blockedOn: 'provider-normalization',
      reason
    }
  }
}

export const TELEMETRY_CAPABILITIES = [
  generated({
    id: 'speed',
    label: 'Speed',
    category: 'drive',
    focus: 'pace',
    requiredSnapshotFields: ['speedKmh'],
    normalizedSnapshotPaths: ['speedKmh'],
    rawIracingHints: ['Speed'],
    data: { kind: 'number', unit: 'km/h', detail: 'float; m/s raw → km/h; display 0..360' },
    dependencies: { car: 'player-car', session: 'live-session', notes: 'player car' },
    normalization: 'Speed*3.6',
    tags: ['speed'],
    representations: {
      competition: 'arc',
      futuristic: 'trend ring',
      ddu: 'DDU cell'
    }
  }),
  generated({
    id: 'engineRpm',
    label: 'Engine RPM',
    category: 'engine',
    focus: 'engine',
    requiredSnapshotFields: ['rpm'],
    normalizedSnapshotPaths: ['rpm'],
    rawIracingHints: ['RPM', 'Engine0_RPM'],
    data: { kind: 'number', unit: 'rpm', detail: 'float; rpm' },
    dependencies: { car: 'player-car', session: 'live-session', notes: 'player car' },
    normalization: 'provider uses RPM; Engine0_RPM catalog-only',
    tags: ['rpm', 'engine'],
    representations: {
      competition: 'arc',
      futuristic: 'trend ring',
      ddu: 'DDU cell'
    }
  }),
  generated({
    id: 'gear',
    label: 'Gear',
    category: 'drive',
    focus: 'pace',
    requiredSnapshotFields: ['gear'],
    normalizedSnapshotPaths: ['gear'],
    rawIracingHints: ['Gear'],
    data: { kind: 'enum', unit: null, detail: 'int; -1/R,0/N,1..n' },
    dependencies: { car: 'player-car', session: 'live-session', notes: 'player car' },
    normalization: 'direct',
    tags: ['gear'],
    representations: {
      competition: 'numeric',
      futuristic: 'trend card',
      ddu: 'DDU cell'
    }
  }),
  dedicated({
    id: 'shiftLights',
    label: 'Shift Lights',
    category: 'engine',
    focus: 'engine',
    requiredSnapshotFields: ['rpm', 'maxRpm', 'shiftRpm', 'shiftIndicatorPct', 'revLights'],
    normalizedSnapshotPaths: ['shiftIndicatorPct', 'revLights', 'rpm', 'maxRpm'],
    rawIracingHints: ['ShiftIndicatorPct', 'PlayerCarRedLine', 'SL RPM YAML'],
    data: { kind: 'composite', unit: 'mixed', detail: 'thresholds + 0..1' },
    dependencies: { car: 'player-car', session: 'live-session', notes: 'player car' },
    normalization: 'clamp((RPM-first)/(shift-first)); fallbacks',
    tags: ['engine', 'revlights', 'shift']
  }),
  generated({
    id: 'engineWarnings',
    label: 'Engine Warnings',
    category: 'engine',
    focus: 'engine',
    requiredSnapshotFields: ['engineWarnings'],
    normalizedSnapshotPaths: ['engineWarnings'],
    rawIracingHints: ['EngineWarnings'],
    data: { kind: 'bitfield', unit: null, detail: 'bitfield → booleans' },
    dependencies: { car: 'player-car', session: 'live-session', notes: 'player car' },
    normalization: 'decode warning bits',
    tags: ['engine', 'flags', 'warning'],
    representations: {
      competition: 'lamp',
      futuristic: 'timeline',
      ddu: 'tell-tale'
    }
  }),
  generated({
    id: 'oilPressure',
    label: 'Oil Pressure',
    category: 'engine',
    focus: 'engine',
    requiredSnapshotFields: ['oilPressureKpa'],
    normalizedSnapshotPaths: ['oilPressureKpa'],
    rawIracingHints: ['OilPressure'],
    data: { kind: 'number', unit: 'kPa', detail: 'float; kPa; display 0..700' },
    dependencies: { car: 'player-car', session: 'live-session', notes: 'player car' },
    normalization: 'raw<30 ? raw*100 : raw',
    tags: ['oil', 'pressure'],
    representations: {
      competition: 'arc',
      futuristic: 'trend',
      ddu: 'DDU cell'
    }
  }),
  generated({
    id: 'oilTemperature',
    label: 'Oil Temperature',
    category: 'engine',
    focus: 'engine',
    requiredSnapshotFields: ['oilTempC'],
    normalizedSnapshotPaths: ['oilTempC'],
    rawIracingHints: ['OilTemp'],
    data: { kind: 'number', unit: '°C', detail: 'float; °C; 40..160 display' },
    dependencies: { car: 'player-car', session: 'live-session', notes: 'player car' },
    normalization: 'direct',
    tags: ['oil', 'temperature'],
    representations: {
      competition: 'arc',
      futuristic: 'trend',
      ddu: 'DDU cell'
    }
  }),
  generated({
    id: 'coolantTemperature',
    label: 'Coolant Temperature',
    category: 'engine',
    focus: 'engine',
    requiredSnapshotFields: ['waterTempC'],
    normalizedSnapshotPaths: ['waterTempC'],
    rawIracingHints: ['WaterTemp'],
    data: { kind: 'number', unit: '°C', detail: 'float; °C; 40..140 display' },
    dependencies: { car: 'player-car', session: 'live-session', notes: 'player car' },
    normalization: 'direct',
    tags: ['water', 'temperature'],
    representations: {
      competition: 'arc',
      futuristic: 'trend',
      ddu: 'DDU cell'
    }
  }),
  generated({
    id: 'coolantLevel',
    label: 'Coolant Level',
    category: 'engine',
    focus: 'engine',
    requiredSnapshotFields: ['waterLevelL'],
    normalizedSnapshotPaths: ['waterLevelL'],
    rawIracingHints: ['WaterLevel'],
    data: { kind: 'number', unit: 'L', detail: 'float; L; 0..8 display' },
    dependencies: { car: 'feature-dependent', session: 'live-session', notes: 'car-dependent' },
    normalization: 'direct',
    tags: ['water', 'level'],
    representations: {
      competition: 'arc',
      futuristic: 'trend',
      ddu: 'DDU cell'
    }
  }),
  generated({
    id: 'oilLevel',
    label: 'Oil Level',
    category: 'engine',
    focus: 'engine',
    requiredSnapshotFields: ['oilLevelL'],
    normalizedSnapshotPaths: ['oilLevelL'],
    rawIracingHints: ['OilLevel'],
    data: { kind: 'number', unit: 'L', detail: 'float; L; 0..6 display' },
    dependencies: { car: 'feature-dependent', session: 'live-session', notes: 'car-dependent' },
    normalization: 'direct',
    tags: ['oil', 'level'],
    representations: {
      competition: 'arc',
      futuristic: 'trend',
      ddu: 'DDU cell'
    }
  }),
  generated({
    id: 'systemVoltage',
    label: 'System Voltage',
    category: 'engine',
    focus: 'engine',
    requiredSnapshotFields: ['voltage'],
    normalizedSnapshotPaths: ['voltage'],
    rawIracingHints: ['Voltage'],
    data: { kind: 'number', unit: 'V', detail: 'float; V; 10..16 display' },
    dependencies: { car: 'feature-dependent', session: 'live-session', notes: 'car-dependent' },
    normalization: 'direct',
    tags: ['electrical', 'voltage'],
    representations: {
      competition: 'arc',
      futuristic: 'trend',
      ddu: 'DDU cell'
    }
  }),
  generated({
    id: 'manifoldPressure',
    label: 'Manifold Pressure',
    category: 'engine',
    focus: 'engine',
    requiredSnapshotFields: ['manifoldPressBar'],
    normalizedSnapshotPaths: ['manifoldPressBar'],
    rawIracingHints: ['ManifoldPress'],
    data: { kind: 'number', unit: 'bar', detail: 'float; bar; 0..3 display' },
    dependencies: { car: 'feature-dependent', session: 'live-session', notes: 'car-dependent' },
    normalization: 'direct',
    tags: ['boost', 'pressure'],
    representations: {
      competition: 'arc',
      futuristic: 'trend',
      ddu: 'DDU cell'
    }
  }),
  generated({
    id: 'fuelPressure',
    label: 'Fuel Pressure',
    category: 'engine',
    focus: 'engine',
    requiredSnapshotFields: ['fuelPressBar'],
    normalizedSnapshotPaths: ['fuelPressBar'],
    rawIracingHints: ['FuelPress'],
    data: { kind: 'number', unit: 'bar', detail: 'float; bar; 0..8 display' },
    dependencies: { car: 'feature-dependent', session: 'live-session', notes: 'car-dependent' },
    normalization: 'direct',
    tags: ['fuel', 'pressure'],
    representations: {
      competition: 'arc',
      futuristic: 'trend',
      ddu: 'DDU cell'
    }
  }),
  generated({
    id: 'ersBattery',
    label: 'ERS Battery',
    category: 'engine',
    focus: 'strategy',
    requiredSnapshotFields: ['ersBatteryPct'],
    normalizedSnapshotPaths: ['ersBatteryPct'],
    rawIracingHints: ['EnergyERSBatteryPct'],
    data: { kind: 'number', unit: '%', detail: 'float; 0..1 → %' },
    dependencies: { car: 'feature-dependent', session: 'live-session', notes: 'hybrid cars only' },
    normalization: 'ratio*100 for widget',
    tags: ['ers', 'battery'],
    representations: {
      competition: 'arc',
      futuristic: 'trend',
      ddu: 'DDU cell'
    }
  }),
  generated({
    id: 'bopWeight',
    label: 'BoP Weight Penalty',
    category: 'engine',
    focus: 'setup',
    requiredSnapshotFields: ['weightPenaltyKg'],
    normalizedSnapshotPaths: ['weightPenaltyKg'],
    rawIracingHints: ['PlayerCarWeightPenalty'],
    data: { kind: 'number', unit: 'kg', detail: 'float; kg' },
    dependencies: { car: 'feature-dependent', session: 'live-session', notes: 'series-dependent' },
    normalization: 'direct',
    tags: ['bop', 'weight'],
    representations: {
      competition: 'numeric',
      futuristic: 'trend',
      ddu: 'DDU cell'
    }
  }),
  generated({
    id: 'bopPower',
    label: 'BoP Power Adjustment',
    category: 'engine',
    focus: 'setup',
    requiredSnapshotFields: ['powerAdjustPct'],
    normalizedSnapshotPaths: ['powerAdjustPct'],
    rawIracingHints: ['PlayerCarPowerAdjust'],
    data: { kind: 'number', unit: '%', detail: 'float; %' },
    dependencies: { car: 'feature-dependent', session: 'live-session', notes: 'series-dependent' },
    normalization: 'direct',
    tags: ['bop', 'power'],
    representations: {
      competition: 'numeric',
      futuristic: 'trend',
      ddu: 'DDU cell'
    }
  }),
  generated({
    id: 'drs',
    label: 'DRS State',
    category: 'drive',
    focus: 'pace',
    requiredSnapshotFields: ['drsState'],
    normalizedSnapshotPaths: ['drsState'],
    rawIracingHints: ['DRS_Status', 'DRS_Active'],
    data: { kind: 'enum', unit: null, detail: 'enum 0..3 + bool' },
    dependencies: { car: 'feature-dependent', session: 'live-session', notes: 'fitted cars' },
    normalization: 'normalize status; Boolean compatibility field',
    tags: ['drs'],
    representations: {
      competition: 'lamp',
      futuristic: 'timeline',
      ddu: 'tell-tale'
    }
  }),
  generated({
    id: 'pushToPassState',
    label: 'Push-to-Pass State',
    category: 'drive',
    focus: 'strategy',
    requiredSnapshotFields: ['pushToPass'],
    normalizedSnapshotPaths: ['pushToPass'],
    rawIracingHints: ['P2P_Status', 'PushToPass'],
    data: { kind: 'boolean', unit: null, detail: 'bool' },
    dependencies: { car: 'feature-dependent', session: 'live-session', notes: 'fitted cars' },
    normalization: 'prefer status, fallback button',
    tags: ['push-to-pass'],
    representations: {
      competition: 'lamp',
      futuristic: 'timeline',
      ddu: 'tell-tale'
    }
  }),
  generated({
    id: 'pushToPassAllowance',
    label: 'Push-to-Pass Allowance',
    category: 'drive',
    focus: 'strategy',
    requiredSnapshotFields: ['pushToPassCount'],
    normalizedSnapshotPaths: ['pushToPassCount'],
    rawIracingHints: ['P2P_Count'],
    data: { kind: 'integer', unit: null, detail: 'int count' },
    dependencies: { car: 'feature-dependent', session: 'live-session', notes: 'fitted cars' },
    normalization: 'direct',
    tags: ['push-to-pass', 'count'],
    representations: {
      competition: 'numeric',
      futuristic: 'trend',
      ddu: 'DDU cell'
    }
  }),
  generated({
    id: 'velocityVector',
    label: 'Velocity Vector',
    category: 'drive',
    focus: 'pace',
    requiredSnapshotFields: ['velocityX', 'velocityY', 'velocityZ'],
    normalizedSnapshotPaths: ['velocityX', 'velocityY', 'velocityZ'],
    rawIracingHints: ['VelocityX/Y/Z'],
    data: { kind: 'vector', unit: 'm/s', detail: 'float[3]; m/s' },
    dependencies: { car: 'player-car', session: 'live-session', notes: 'player live/logged' },
    normalization: 'X/Y may fall back to Speed+YawNorth',
    tags: ['vector', 'velocity', 'speed'],
    representations: {
      competition: 'cross-plot',
      futuristic: 'vector trace',
      ddu: 'axis strip'
    }
  }),
  generated({
    id: 'accelerationVector',
    label: 'Acceleration Vector',
    category: 'drive',
    focus: 'g-force',
    requiredSnapshotFields: ['latAccelG', 'longAccelG', 'vertAccelG'],
    normalizedSnapshotPaths: ['long/lat/vertAccelG'],
    rawIracingHints: ['Long/Lat/VertAccel'],
    data: { kind: 'vector', unit: 'g', detail: 'float[3]; m/s² → G' },
    dependencies: { car: 'player-car', session: 'live-session', notes: 'player live/logged' },
    normalization: 'value/9.80665',
    tags: ['g-force', 'vector', 'acceleration'],
    representations: {
      competition: 'G-G',
      futuristic: 'vector trace',
      ddu: 'axis strip'
    }
  }),
  generated({
    id: 'attitude',
    label: 'Vehicle Attitude',
    category: 'drive',
    focus: 'chassis',
    requiredSnapshotFields: ['pitchRad', 'rollRad', 'yawRad'],
    normalizedSnapshotPaths: ['pitchRad', 'rollRad', 'yawRad'],
    rawIracingHints: ['Pitch', 'Roll', 'Yaw'],
    data: { kind: 'vector', unit: 'rad', detail: 'float[3]; rad' },
    dependencies: { car: 'player-car', session: 'live-session', notes: 'player channel' },
    normalization: 'direct',
    tags: ['vector', 'attitude', 'chassis'],
    representations: {
      competition: 'attitude crosshair',
      futuristic: 'trace',
      ddu: 'axis strip'
    }
  }),
  generated({
    id: 'angularRates',
    label: 'Angular Rates',
    category: 'drive',
    focus: 'chassis',
    requiredSnapshotFields: ['pitchRateRadSec', 'rollRateRadSec', 'yawRateRadSec'],
    normalizedSnapshotPaths: ['pitch/roll/yawRateRadSec'],
    rawIracingHints: ['PitchRate', 'RollRate', 'YawRate'],
    data: { kind: 'vector', unit: 'rad/s', detail: 'float[3]; rad/s' },
    dependencies: { car: 'player-car', session: 'live-session', notes: 'player channel' },
    normalization: 'direct',
    tags: ['vector', 'rotation', 'chassis'],
    representations: {
      competition: 'cross-plot',
      futuristic: 'trace',
      ddu: 'axis strip'
    }
  }),
  generated({
    id: 'geographicPosition',
    label: 'Geographic Position',
    category: 'map',
    focus: 'track',
    requiredSnapshotFields: ['lat', 'lon', 'altitudeM'],
    normalizedSnapshotPaths: ['lat', 'lon', 'altitudeM'],
    rawIracingHints: ['Lat', 'Lon', 'Alt'],
    data: { kind: 'vector', unit: 'mixed', detail: 'deg,deg,m' },
    dependencies: { car: 'feature-dependent', session: 'live-session', notes: 'channel/replay-dependent' },
    normalization: 'tuple',
    tags: ['map', 'track', 'position'],
    representations: {
      competition: 'map readout',
      futuristic: 'path',
      ddu: 'DDU map'
    }
  }),
  generated({
    id: 'headingNorth',
    label: 'Heading Relative to North',
    category: 'drive',
    focus: 'track',
    requiredSnapshotFields: ['yawNorth'],
    normalizedSnapshotPaths: ['yawNorth'],
    rawIracingHints: ['YawNorth'],
    data: { kind: 'number', unit: '°', detail: 'rad raw → 0..360°' },
    dependencies: { car: 'player-car', session: 'live-session', notes: 'player channel' },
    normalization: 'normalized compass degrees',
    tags: ['heading', 'track'],
    representations: {
      competition: 'compass arc',
      futuristic: 'ribbon',
      ddu: 'DDU heading'
    }
  }),
  generated({
    id: 'throttle',
    label: 'Throttle',
    category: 'inputs',
    focus: 'controls',
    requiredSnapshotFields: ['throttle'],
    normalizedSnapshotPaths: ['throttle'],
    rawIracingHints: ['Throttle', 'ThrottleRaw'],
    data: { kind: 'number', unit: '%', detail: 'float 0..1' },
    dependencies: { car: 'player-car', session: 'live-session', notes: 'player' },
    normalization: 'direct',
    tags: ['throttle'],
    representations: {
      competition: 'bar',
      futuristic: 'history',
      ddu: 'DDU strip'
    }
  }),
  generated({
    id: 'brake',
    label: 'Brake',
    category: 'inputs',
    focus: 'controls',
    requiredSnapshotFields: ['brake'],
    normalizedSnapshotPaths: ['brake'],
    rawIracingHints: ['Brake', 'BrakeRaw'],
    data: { kind: 'number', unit: '%', detail: 'float 0..1' },
    dependencies: { car: 'player-car', session: 'live-session', notes: 'player' },
    normalization: 'direct',
    tags: ['brakes'],
    representations: {
      competition: 'bar',
      futuristic: 'history',
      ddu: 'DDU strip'
    }
  }),
  generated({
    id: 'clutch',
    label: 'Clutch',
    category: 'inputs',
    focus: 'controls',
    requiredSnapshotFields: ['clutch'],
    normalizedSnapshotPaths: ['clutch'],
    rawIracingHints: ['Clutch', 'ClutchRaw'],
    data: { kind: 'number', unit: '%', detail: 'float 0..1' },
    dependencies: { car: 'player-car', session: 'live-session', notes: 'player' },
    normalization: 'direct',
    tags: ['clutch'],
    representations: {
      competition: 'bar',
      futuristic: 'history',
      ddu: 'DDU strip'
    }
  }),
  generated({
    id: 'handbrake',
    label: 'Handbrake',
    category: 'inputs',
    focus: 'controls',
    requiredSnapshotFields: ['handbrake'],
    normalizedSnapshotPaths: ['handbrake'],
    rawIracingHints: ['HandbrakeRaw', 'Handbrake'],
    data: { kind: 'number', unit: '%', detail: 'float 0..1' },
    dependencies: { car: 'feature-dependent', session: 'live-session', notes: 'car-dependent' },
    normalization: 'raw-first fallback',
    tags: ['handbrake'],
    representations: {
      competition: 'bar',
      futuristic: 'history',
      ddu: 'DDU strip'
    }
  }),
  generated({
    id: 'steeringAngle',
    label: 'Steering Angle',
    category: 'inputs',
    focus: 'controls',
    requiredSnapshotFields: ['steerAngleDeg', 'steeringAngleMaxDeg'],
    normalizedSnapshotPaths: ['steerAngleDeg', 'steeringAngleMaxDeg'],
    rawIracingHints: ['SteeringWheelAngle'],
    data: { kind: 'composite', unit: '°', detail: 'rad → degrees' },
    dependencies: { car: 'player-car', session: 'live-session', notes: 'player' },
    normalization: 'rad*180/pi',
    tags: ['steering', 'indicator', 'driver-input'],
    representations: {
      competition: 'wheel indicator',
      futuristic: 'trace',
      ddu: 'DDU strip'
    }
  }),
  generated({
    id: 'steeringLock',
    label: 'Steering Lock',
    category: 'inputs',
    focus: 'setup',
    requiredSnapshotFields: ['steeringAngleMaxDeg'],
    normalizedSnapshotPaths: ['steeringAngleMaxDeg'],
    rawIracingHints: ['SteeringWheelAngleMax'],
    data: { kind: 'number', unit: '°', detail: 'degrees; 0..1080 display' },
    dependencies: { car: 'feature-dependent', session: 'live-session', notes: 'car-dependent' },
    normalization: 'rad*180/pi',
    tags: ['steering', 'lock'],
    representations: {
      competition: 'bar',
      futuristic: 'range ribbon',
      ddu: 'DDU cell'
    }
  }),
  generated({
    id: 'steeringTorque',
    label: 'Steering FFB Torque',
    category: 'inputs',
    focus: 'controls',
    requiredSnapshotFields: ['steeringTorquePct'],
    normalizedSnapshotPaths: ['steeringTorquePct'],
    rawIracingHints: ['SteeringWheelPctTorque'],
    data: { kind: 'number', unit: '%', detail: 'float 0..1 → %' },
    dependencies: { car: 'feature-dependent', session: 'live-session', notes: 'wheel/channel-dependent' },
    normalization: 'ratio*100',
    tags: ['steering', 'torque'],
    representations: {
      competition: 'bar',
      futuristic: 'history',
      ddu: 'DDU strip'
    }
  }),
  generated({
    id: 'brakeBias',
    label: 'Brake Bias',
    category: 'inputs',
    focus: 'setup',
    requiredSnapshotFields: ['brakeBiasPct'],
    normalizedSnapshotPaths: ['brakeBiasPct'],
    rawIracingHints: ['dcBrakeBias'],
    data: { kind: 'setting', unit: '%', detail: 'number/string; %' },
    dependencies: { car: 'feature-dependent', session: 'live-session', notes: 'car-dependent' },
    normalization: 'abs(raw)<=1 ? raw*100 : raw',
    tags: ['brake-bias', 'setup'],
    representations: {
      competition: 'setting tile',
      futuristic: 'ladder',
      ddu: 'DDU setup cell'
    }
  }),
  generated({
    id: 'absSetting',
    label: 'ABS Setting',
    category: 'inputs',
    focus: 'setup',
    requiredSnapshotFields: ['absLevel'],
    normalizedSnapshotPaths: ['absLevel'],
    rawIracingHints: ['dcABS', 'dcABS1', 'dcAntiLockBrake'],
    data: { kind: 'setting', unit: null, detail: 'setting' },
    dependencies: { car: 'feature-dependent', session: 'live-session', notes: 'fitted cars' },
    normalization: 'first defined',
    tags: ['abs', 'setup'],
    representations: {
      competition: 'setting tile',
      futuristic: 'ladder',
      ddu: 'DDU cell'
    }
  }),
  generated({
    id: 'absActive',
    label: 'ABS Intervention',
    category: 'inputs',
    focus: 'controls',
    requiredSnapshotFields: ['absActive'],
    normalizedSnapshotPaths: ['absActive'],
    rawIracingHints: ['BrakeABSactive'],
    data: { kind: 'boolean', unit: null, detail: 'bool' },
    dependencies: { car: 'feature-dependent', session: 'live-session', notes: 'fitted cars' },
    normalization: 'direct',
    tags: ['abs', 'intervention'],
    representations: {
      competition: 'lamp',
      futuristic: 'intervention timeline',
      ddu: 'tell-tale'
    }
  }),
  generated({
    id: 'absCut',
    label: 'ABS Pressure Cut',
    category: 'inputs',
    focus: 'controls',
    requiredSnapshotFields: ['absCutPct'],
    normalizedSnapshotPaths: ['absCutPct'],
    rawIracingHints: ['BrakeABSCutPct'],
    data: { kind: 'number', unit: '%', detail: 'float %' },
    dependencies: { car: 'feature-dependent', session: 'live-session', notes: 'fitted cars' },
    normalization: 'direct',
    tags: ['abs', 'brakes'],
    representations: {
      competition: 'arc',
      futuristic: 'trend',
      ddu: 'DDU cell'
    }
  }),
  generated({
    id: 'tcSetting',
    label: 'Traction-Control Setting',
    category: 'inputs',
    focus: 'setup',
    requiredSnapshotFields: ['tcLevel'],
    normalizedSnapshotPaths: ['tcLevel'],
    rawIracingHints: ['dcTractionControl variants'],
    data: { kind: 'setting', unit: null, detail: 'setting' },
    dependencies: { car: 'feature-dependent', session: 'live-session', notes: 'fitted cars' },
    normalization: 'first defined',
    tags: ['tc', 'setup'],
    representations: {
      competition: 'setting tile',
      futuristic: 'ladder',
      ddu: 'DDU cell'
    }
  }),
  generated({
    id: 'tcActive',
    label: 'Traction-Control Intervention',
    category: 'inputs',
    focus: 'controls',
    requiredSnapshotFields: ['tcActive'],
    normalizedSnapshotPaths: ['tcActive'],
    rawIracingHints: ['tcActiveDerived'],
    data: { kind: 'boolean', unit: null, detail: 'derived bool' },
    dependencies: { car: 'feature-dependent', session: 'live-session', notes: 'fitted cars' },
    normalization: 'throttle/TC/speed/brake/long-G predicate + latch',
    tags: ['tc', 'intervention', 'derived'],
    representations: {
      competition: 'lamp',
      futuristic: 'intervention timeline',
      ddu: 'tell-tale'
    }
  }),
  generated({
    id: 'throttleMap',
    label: 'Throttle Map',
    category: 'inputs',
    focus: 'setup',
    requiredSnapshotFields: ['throttleMap'],
    normalizedSnapshotPaths: ['throttleMap'],
    rawIracingHints: ['dcThrottleShape'],
    data: { kind: 'setting', unit: null, detail: 'setting' },
    dependencies: { car: 'feature-dependent', session: 'live-session', notes: 'car-dependent' },
    normalization: 'direct',
    tags: ['setup', 'throttle'],
    representations: {
      competition: 'setting tile',
      futuristic: 'ladder',
      ddu: 'DDU cell'
    }
  }),
  generated({
    id: 'engineMap',
    label: 'Engine Map',
    category: 'inputs',
    focus: 'setup',
    requiredSnapshotFields: ['engineMap'],
    normalizedSnapshotPaths: ['engineMap'],
    rawIracingHints: ['dcFuelMixture', 'dcEnginePower', 'dcBoostLevel'],
    data: { kind: 'setting', unit: null, detail: 'setting' },
    dependencies: { car: 'feature-dependent', session: 'live-session', notes: 'car-dependent' },
    normalization: 'first defined genuine engine-map channel',
    sourceConstraints: [
      {
        id: 'provider-fallback-ambiguous',
        scope: 'provider',
        detail: 'The capability accepts dcFuelMixture, dcEnginePower, or dcBoostLevel. The current provider also falls back to dcThrottleShape; that fallback belongs to throttleMap and must be removed by provider integration.'
      }
    ],
    tags: ['engine-map', 'setup'],
    representations: {
      competition: 'setting tile',
      futuristic: 'ladder',
      ddu: 'DDU cell'
    }
  }),
  generated({
    id: 'engineBraking',
    label: 'Engine Braking',
    category: 'inputs',
    focus: 'setup',
    requiredSnapshotFields: ['engineBraking'],
    normalizedSnapshotPaths: ['engineBraking'],
    rawIracingHints: ['dcEngineBraking'],
    data: { kind: 'setting', unit: null, detail: 'setting' },
    dependencies: { car: 'feature-dependent', session: 'live-session', notes: 'car-dependent' },
    normalization: 'direct',
    tags: ['setup', 'engine-braking'],
    representations: {
      competition: 'setting tile',
      futuristic: 'ladder',
      ddu: 'DDU cell'
    }
  }),
  generated({
    id: 'antiRollFront',
    label: 'Front Anti-Roll Bar',
    category: 'inputs',
    focus: 'setup',
    requiredSnapshotFields: ['antiRollFront'],
    normalizedSnapshotPaths: ['antiRollFront'],
    rawIracingHints: ['dcAntiRollFront'],
    data: { kind: 'setting', unit: null, detail: 'setting' },
    dependencies: { car: 'feature-dependent', session: 'live-session', notes: 'car-dependent' },
    normalization: 'direct',
    tags: ['setup', 'anti-roll'],
    representations: {
      competition: 'setting tile',
      futuristic: 'ladder',
      ddu: 'DDU cell'
    }
  }),
  generated({
    id: 'antiRollRear',
    label: 'Rear Anti-Roll Bar',
    category: 'inputs',
    focus: 'setup',
    requiredSnapshotFields: ['antiRollRear'],
    normalizedSnapshotPaths: ['antiRollRear'],
    rawIracingHints: ['dcAntiRollRear'],
    data: { kind: 'setting', unit: null, detail: 'setting' },
    dependencies: { car: 'feature-dependent', session: 'live-session', notes: 'car-dependent' },
    normalization: 'direct',
    tags: ['setup', 'anti-roll'],
    representations: {
      competition: 'setting tile',
      futuristic: 'ladder',
      ddu: 'DDU cell'
    }
  }),
  generated({
    id: 'weightJackerRight',
    label: 'Right Weight Jacker',
    category: 'inputs',
    focus: 'setup',
    requiredSnapshotFields: ['weightJackerRight'],
    normalizedSnapshotPaths: ['weightJackerRight'],
    rawIracingHints: ['dcWeightJackerRight'],
    data: { kind: 'setting', unit: null, detail: 'setting' },
    dependencies: { car: 'feature-dependent', session: 'live-session', notes: 'car-dependent' },
    normalization: 'direct',
    tags: ['setup', 'weight-jacker'],
    representations: {
      competition: 'setting tile',
      futuristic: 'ladder',
      ddu: 'DDU cell'
    }
  }),
  generated({
    id: 'currentLap',
    label: 'Current Lap',
    category: 'timing',
    focus: 'timing',
    requiredSnapshotFields: ['currentLap'],
    normalizedSnapshotPaths: ['currentLap'],
    rawIracingHints: ['Lap'],
    data: { kind: 'integer', unit: null, detail: 'int count' },
    dependencies: { car: 'player-car', session: 'timing-or-scoring', notes: 'valid session' },
    normalization: 'truncate',
    tags: ['laps'],
    representations: {
      competition: 'numeric',
      futuristic: 'lap ribbon',
      ddu: 'DDU cell'
    }
  }),
  generated({
    id: 'completedLaps',
    label: 'Completed Laps',
    category: 'timing',
    focus: 'timing',
    requiredSnapshotFields: ['completedLaps'],
    normalizedSnapshotPaths: ['completedLaps'],
    rawIracingHints: ['LapCompleted', 'RaceLaps'],
    data: { kind: 'integer', unit: null, detail: 'int count' },
    dependencies: { car: 'player-car', session: 'timing-or-scoring', notes: 'valid session' },
    normalization: 'provider uses LapCompleted',
    tags: ['laps', 'completed'],
    representations: {
      competition: 'numeric',
      futuristic: 'lap ribbon',
      ddu: 'DDU cell'
    }
  }),
  generated({
    id: 'lapDistance',
    label: 'Lap Distance',
    category: 'map',
    focus: 'track',
    requiredSnapshotFields: ['lapDistanceM', 'lapDistPct'],
    normalizedSnapshotPaths: ['lapDistanceM', 'lapDistPct'],
    rawIracingHints: ['LapDist'],
    data: { kind: 'number', unit: 'm', detail: 'float m' },
    dependencies: { car: 'player-car', session: 'timing-or-scoring', notes: 'track-dependent' },
    normalization: 'direct',
    tags: ['map', 'track', 'laps', 'distance'],
    representations: {
      competition: 'map',
      futuristic: 'path ribbon',
      ddu: 'DDU map'
    }
  }),
  generated({
    id: 'lapProgress',
    label: 'Lap Progress',
    category: 'timing',
    focus: 'track',
    requiredSnapshotFields: ['lapDistPct'],
    normalizedSnapshotPaths: ['lapDistPct'],
    rawIracingHints: ['LapDistPct'],
    data: { kind: 'number', unit: '%', detail: 'float 0..1 → %' },
    dependencies: { car: 'player-car', session: 'timing-or-scoring', notes: 'valid lap' },
    normalization: 'clamp',
    tags: ['laps', 'track'],
    representations: {
      competition: 'bar',
      futuristic: 'track ribbon',
      ddu: 'DDU strip'
    }
  }),
  generated({
    id: 'currentLapTime',
    label: 'Current Lap Time',
    category: 'timing',
    focus: 'timing',
    requiredSnapshotFields: ['currentLapTimeSec'],
    normalizedSnapshotPaths: ['currentLapTimeSec'],
    rawIracingHints: ['LapCurrentLapTime'],
    data: { kind: 'number', unit: 's', detail: 'seconds' },
    dependencies: { car: 'player-car', session: 'timing-or-scoring', notes: 'valid lap' },
    normalization: 'direct',
    tags: ['laps', 'clock'],
    representations: {
      competition: 'clock',
      futuristic: 'timeline',
      ddu: 'DDU timer'
    }
  }),
  generated({
    id: 'lastLapTime',
    label: 'Last Lap Time',
    category: 'timing',
    focus: 'timing',
    requiredSnapshotFields: ['lastLapTimeSec'],
    normalizedSnapshotPaths: ['lastLapTimeSec'],
    rawIracingHints: ['LapLastLapTime'],
    data: { kind: 'number', unit: 's', detail: 'seconds' },
    dependencies: { car: 'player-car', session: 'timing-or-scoring', notes: 'valid completed lap' },
    normalization: 'direct',
    tags: ['laps', 'clock'],
    representations: {
      competition: 'clock',
      futuristic: 'trend',
      ddu: 'DDU timer'
    }
  }),
  generated({
    id: 'bestLapTime',
    label: 'Best Lap Time',
    category: 'timing',
    focus: 'pace',
    requiredSnapshotFields: ['bestLapTimeSec'],
    normalizedSnapshotPaths: ['bestLapTimeSec'],
    rawIracingHints: ['LapBestLapTime'],
    data: { kind: 'number', unit: 's', detail: 'seconds' },
    dependencies: { car: 'player-car', session: 'timing-or-scoring', notes: 'valid timed lap' },
    normalization: 'direct',
    tags: ['laps', 'clock', 'best'],
    representations: {
      competition: 'clock',
      futuristic: 'trend',
      ddu: 'DDU timer'
    }
  }),
  generated({
    id: 'bestNLap',
    label: 'Best N-Lap Result',
    category: 'timing',
    focus: 'pace',
    requiredSnapshotFields: ['bestNLapLap', 'bestNLapTimeSec'],
    normalizedSnapshotPaths: ['bestNLapLap', 'bestNLapTimeSec'],
    rawIracingHints: ['LapBestNLapLap', 'LapBestNLapTime'],
    data: { kind: 'composite', unit: 'mixed', detail: 'lap + seconds' },
    dependencies: { car: 'player-car', session: 'timing-or-scoring', notes: 'session-dependent' },
    normalization: 'joined display',
    tags: ['laps', 'best', 'clock'],
    representations: {
      competition: 'clock',
      futuristic: 'trend',
      ddu: 'DDU cell'
    }
  }),
  generated({
    id: 'estimatedLap',
    label: 'Estimated Lap Time',
    category: 'timing',
    focus: 'pace',
    requiredSnapshotFields: ['estimatedLapTimeSec'],
    normalizedSnapshotPaths: ['estimatedLapTimeSec'],
    rawIracingHints: ['EstimatedLapTime', 'LapLastNLapTime'],
    data: { kind: 'number', unit: 's', detail: 'seconds' },
    dependencies: { car: 'player-car', session: 'timing-or-scoring', notes: 'lap-history-dependent' },
    normalization: 'provider uses LapLastNLapTime',
    tags: ['laps', 'clock', 'estimated'],
    representations: {
      competition: 'clock',
      futuristic: 'projection',
      ddu: 'DDU timer'
    }
  }),
  generated({
    id: 'deltaBest',
    label: 'Delta to Personal Best',
    category: 'timing',
    focus: 'delta',
    requiredSnapshotFields: ['deltaToBestSec'],
    normalizedSnapshotPaths: ['deltaToBestSec'],
    rawIracingHints: ['LapDeltaToBestLap aliases'],
    data: { kind: 'number', unit: 's', detail: 'seconds; display -5..5' },
    dependencies: { car: 'player-car', session: 'timing-or-scoring', notes: 'valid reference' },
    normalization: 'direct',
    tags: ['delta', 'pace'],
    representations: {
      competition: 'delta bar',
      futuristic: 'history',
      ddu: 'DDU strip'
    }
  }),
  generated({
    id: 'deltaSessionBest',
    label: 'Delta to Session Best',
    category: 'timing',
    focus: 'delta',
    requiredSnapshotFields: ['deltaToSessionBestSec'],
    normalizedSnapshotPaths: ['deltaToSessionBestSec'],
    rawIracingHints: ['LapDeltaToSessionBestLap'],
    data: { kind: 'number', unit: 's', detail: 'seconds; -5..5' },
    dependencies: { car: 'player-car', session: 'timing-or-scoring', notes: 'valid reference' },
    normalization: 'direct',
    tags: ['delta', 'pace'],
    representations: {
      competition: 'delta bar',
      futuristic: 'history',
      ddu: 'DDU strip'
    }
  }),
  generated({
    id: 'deltaOptimal',
    label: 'Delta to Personal Optimal',
    category: 'timing',
    focus: 'delta',
    requiredSnapshotFields: ['deltaToOptimalSec'],
    normalizedSnapshotPaths: ['deltaToOptimalSec'],
    rawIracingHints: ['LapDeltaToOptimalLap'],
    data: { kind: 'number', unit: 's', detail: 'seconds; -5..5' },
    dependencies: { car: 'player-car', session: 'timing-or-scoring', notes: 'valid reference' },
    normalization: 'direct',
    tags: ['delta', 'pace'],
    representations: {
      competition: 'delta bar',
      futuristic: 'history',
      ddu: 'DDU strip'
    }
  }),
  generated({
    id: 'deltaSessionOptimal',
    label: 'Delta to Session Optimal',
    category: 'timing',
    focus: 'delta',
    requiredSnapshotFields: ['deltaToSessionOptimalSec'],
    normalizedSnapshotPaths: ['deltaToSessionOptimalSec'],
    rawIracingHints: ['LapDeltaToSessionOptimalLap'],
    data: { kind: 'number', unit: 's', detail: 'seconds; -5..5' },
    dependencies: { car: 'player-car', session: 'timing-or-scoring', notes: 'valid reference' },
    normalization: 'direct',
    tags: ['delta', 'pace'],
    representations: {
      competition: 'delta bar',
      futuristic: 'history',
      ddu: 'DDU strip'
    }
  }),
  generated({
    id: 'deltaDriverBest',
    label: 'Delta to Driver Best',
    category: 'timing',
    focus: 'delta',
    requiredSnapshotFields: ['deltaToDriverBestSec'],
    normalizedSnapshotPaths: ['deltaToDriverBestSec'],
    rawIracingHints: ['LapDeltaToDriverBestLap'],
    data: { kind: 'number', unit: 's', detail: 'seconds; -5..5' },
    dependencies: { car: 'player-car', session: 'timing-or-scoring', notes: 'valid reference' },
    normalization: 'direct',
    tags: ['delta', 'pace'],
    representations: {
      competition: 'delta bar',
      futuristic: 'history',
      ddu: 'DDU strip'
    }
  }),
  generated({
    id: 'sessionNumber',
    label: 'Session Number',
    category: 'session',
    focus: 'session',
    requiredSnapshotFields: ['sessionNumber'],
    normalizedSnapshotPaths: ['sessionNumber'],
    rawIracingHints: ['SessionNum'],
    data: { kind: 'integer', unit: null, detail: 'int' },
    dependencies: { car: 'none', session: 'live-session', notes: 'session' },
    normalization: 'direct',
    tags: ['session', 'count'],
    representations: {
      competition: 'numeric',
      futuristic: 'timeline',
      ddu: 'DDU cell'
    }
  }),
  generated({
    id: 'sessionState',
    label: 'Session State',
    category: 'session',
    focus: 'race-control',
    requiredSnapshotFields: ['sessionState'],
    normalizedSnapshotPaths: ['sessionState'],
    rawIracingHints: ['SessionState'],
    data: { kind: 'enum', unit: null, detail: 'enum 0..6' },
    dependencies: { car: 'none', session: 'live-session', notes: 'session' },
    normalization: 'enum→label',
    tags: ['session', 'status'],
    representations: {
      competition: 'status',
      futuristic: 'timeline',
      ddu: 'DDU tell-tale'
    }
  }),
  generated({
    id: 'sessionTime',
    label: 'Session Time',
    category: 'session',
    focus: 'session',
    requiredSnapshotFields: ['sessionTimeSec'],
    normalizedSnapshotPaths: ['sessionTimeSec'],
    rawIracingHints: ['SessionTime'],
    data: { kind: 'number', unit: 's', detail: 'seconds' },
    dependencies: { car: 'none', session: 'live-session', notes: 'session' },
    normalization: 'direct',
    tags: ['session', 'clock'],
    representations: {
      competition: 'clock',
      futuristic: 'timeline',
      ddu: 'DDU timer'
    }
  }),
  generated({
    id: 'timeOfDay',
    label: 'Time of Day',
    category: 'session',
    focus: 'session',
    requiredSnapshotFields: ['sessionTimeOfDay'],
    normalizedSnapshotPaths: ['sessionTimeOfDay'],
    rawIracingHints: ['SessionTimeOfDay'],
    data: { kind: 'number', unit: 's', detail: 'seconds since midnight' },
    dependencies: { car: 'none', session: 'live-session', notes: 'session' },
    normalization: 'formatted HH:MM when needed',
    tags: ['clock', 'session'],
    representations: {
      competition: 'clock',
      futuristic: 'day arc',
      ddu: 'DDU clock'
    }
  }),
  generated({
    id: 'timeRemaining',
    label: 'Time Remaining',
    category: 'session',
    focus: 'strategy',
    requiredSnapshotFields: ['sessionTimeRemainingSec'],
    normalizedSnapshotPaths: ['sessionTimeRemainingSec'],
    rawIracingHints: ['SessionTimeRemain'],
    data: { kind: 'number', unit: 's', detail: 'seconds' },
    dependencies: { car: 'none', session: 'live-session', notes: 'timed sessions' },
    normalization: 'direct',
    tags: ['clock', 'session'],
    representations: {
      competition: 'countdown',
      futuristic: 'projection',
      ddu: 'DDU timer'
    }
  }),
  generated({
    id: 'lapsRemaining',
    label: 'Laps Remaining',
    category: 'session',
    focus: 'strategy',
    requiredSnapshotFields: ['lapsRemaining'],
    normalizedSnapshotPaths: ['lapsRemaining'],
    rawIracingHints: ['SessionLapsRemain/Ex'],
    data: { kind: 'integer', unit: 'count', detail: 'int' },
    dependencies: { car: 'none', session: 'timing-or-scoring', notes: 'lap-limited session' },
    normalization: 'prefer Ex',
    tags: ['laps', 'session'],
    representations: {
      competition: 'count',
      futuristic: 'projection',
      ddu: 'DDU cell'
    }
  }),
  generated({
    id: 'sessionType',
    label: 'Session Type',
    category: 'session',
    focus: 'session',
    requiredSnapshotFields: ['sessionType'],
    normalizedSnapshotPaths: ['sessionType'],
    rawIracingHints: ['SessionType'],
    data: { kind: 'text', unit: null, detail: 'text' },
    dependencies: { car: 'none', session: 'session-info', notes: 'YAML' },
    normalization: 'SessionInfo',
    tags: ['session', 'identity'],
    representations: {
      competition: 'identity strip',
      futuristic: 'ribbon',
      ddu: 'DDU header'
    }
  }),
  generated({
    id: 'onTrack',
    label: 'On-Track State',
    category: 'session',
    focus: 'race-control',
    requiredSnapshotFields: ['onTrack'],
    normalizedSnapshotPaths: ['onTrack'],
    rawIracingHints: ['IsOnTrack', 'IsOnTrackCar'],
    data: { kind: 'boolean', unit: null, detail: 'bool' },
    dependencies: { car: 'none', session: 'live-session', notes: 'session' },
    normalization: 'prefer IsOnTrackCar',
    tags: ['track', 'status'],
    representations: {
      competition: 'status',
      futuristic: 'state arc',
      ddu: 'tell-tale'
    }
  }),
  generated({
    id: 'replayState',
    label: 'Replay State',
    category: 'session',
    focus: 'session',
    requiredSnapshotFields: ['replayPlaying', 'replayContext'],
    normalizedSnapshotPaths: ['replayPlaying', 'replayContext'],
    rawIracingHints: ['IsReplayPlaying'],
    data: { kind: 'boolean', unit: null, detail: 'bool/context' },
    dependencies: { car: 'none', session: 'replay', notes: 'replay' },
    normalization: 'ReplayContextTracker',
    tags: ['replay', 'status'],
    representations: {
      competition: 'status',
      futuristic: 'timeline',
      ddu: 'tell-tale'
    }
  }),
  generated({
    id: 'replayTimeline',
    label: 'Replay Timeline',
    category: 'session',
    focus: 'session',
    requiredSnapshotFields: ['replayFrameNum', 'replayFrameEnd', 'replayPlaying', 'replayContext'],
    normalizedSnapshotPaths: ['replayFrameNum', 'replayFrameEnd', 'context'],
    rawIracingHints: ['ReplayFrameNum/End'],
    data: { kind: 'number', unit: 'frame', detail: 'frame indices' },
    dependencies: { car: 'none', session: 'replay', notes: 'replay' },
    normalization: 'current/end',
    tags: ['replay', 'timeline'],
    representations: {
      competition: 'bar',
      futuristic: 'timeline',
      ddu: 'DDU strip'
    }
  }),
  generated({
    id: 'cameraCar',
    label: 'Camera Car',
    category: 'session',
    focus: 'session',
    requiredSnapshotFields: ['cameraCarIdx', 'drivers'],
    normalizedSnapshotPaths: ['cameraCarIdx', 'drivers'],
    rawIracingHints: ['CamCarIdx'],
    data: { kind: 'composite', unit: null, detail: 'joined identity' },
    dependencies: { car: 'per-car', session: 'live-session', notes: 'camera context' },
    normalization: 'resolve index to driver',
    tags: ['camera', 'driver', 'status'],
    representations: {
      competition: 'status',
      futuristic: 'identity ribbon',
      ddu: 'DDU header'
    }
  }),
  generated({
    id: 'paceMode',
    label: 'Pace Mode',
    category: 'session',
    focus: 'race-control',
    requiredSnapshotFields: ['paceMode'],
    normalizedSnapshotPaths: ['paceMode'],
    rawIracingHints: ['PaceMode'],
    data: { kind: 'enum', unit: null, detail: 'enum 0..4' },
    dependencies: { car: 'none', session: 'live-session', notes: 'pacing sessions' },
    normalization: 'enum→label',
    tags: ['session', 'pace'],
    representations: {
      competition: 'status',
      futuristic: 'formation arc',
      ddu: 'tell-tale'
    }
  }),
  generated({
    id: 'paceFlags',
    label: 'Pace Flags',
    category: 'session',
    focus: 'race-control',
    requiredSnapshotFields: ['paceFlags', 'drivers'],
    normalizedSnapshotPaths: ['paceFlags', 'drivers'],
    rawIracingHints: ['PaceFlags', 'CarIdxPaceFlags'],
    data: { kind: 'bitfield', unit: null, detail: 'bitfield/list' },
    dependencies: { car: 'per-car', session: 'live-session', notes: 'pacing + pace-car identity' },
    normalization: 'decode EOL/free-pass/waved-around',
    tags: ['pace', 'flags', 'status'],
    representations: {
      competition: 'status',
      futuristic: 'state arc',
      ddu: 'tell-tale'
    }
  }),
  generated({
    id: 'paceFormation',
    label: 'Pace Formation',
    category: 'standings',
    focus: 'race-control',
    requiredSnapshotFields: ['drivers', 'paceMode'],
    normalizedSnapshotPaths: ['drivers', 'paceMode'],
    rawIracingHints: ['CarIdxPaceLine', 'CarIdxPaceRow'],
    data: { kind: 'per-car', unit: null, detail: 'per-car ints' },
    dependencies: { car: 'per-car', session: 'timing-or-scoring', notes: 'pacing/scoring' },
    normalization: 'join line+row',
    tags: ['standings', 'pace', 'formation', 'table'],
    representations: {
      competition: 'table',
      futuristic: 'formation ribbon',
      ddu: 'DDU multirow'
    }
  }),
  generated({
    id: 'raceFlags',
    label: 'Race-Control Flags',
    category: 'session',
    focus: 'race-control',
    requiredSnapshotFields: ['flags'],
    normalizedSnapshotPaths: ['flags'],
    rawIracingHints: ['SessionFlags + pseudo aliases'],
    data: { kind: 'bitfield', unit: null, detail: 'bitfield→booleans' },
    dependencies: { car: 'none', session: 'live-session', notes: 'race control' },
    normalization: 'decode; grouped yellow; meatball=repair; GWC false',
    tags: ['flags', 'session'],
    representations: {
      competition: 'banner',
      futuristic: 'timeline',
      ddu: 'tell-tales'
    }
  }),
  generated({
    id: 'proximity',
    label: 'Side Proximity',
    category: 'standings',
    focus: 'traffic',
    requiredSnapshotFields: ['carLeftRight'],
    normalizedSnapshotPaths: ['carLeftRight'],
    rawIracingHints: ['CarLeftRight', 'derived count'],
    data: { kind: 'enum', unit: null, detail: 'enum 0..6' },
    dependencies: { car: 'player-car', session: 'timing-or-scoring', notes: 'player traffic' },
    normalization: 'enum→side/count',
    tags: ['radar', 'traffic'],
    representations: {
      competition: 'arrows',
      futuristic: 'radar ribbon',
      ddu: 'DDU tell-tale'
    }
  }),
  generated({
    id: 'carIdentity',
    label: 'Car Identity',
    category: 'identity',
    focus: 'session',
    requiredSnapshotFields: ['carName'],
    normalizedSnapshotPaths: ['carName'],
    rawIracingHints: ['car-name YAML aliases'],
    data: { kind: 'text', unit: null, detail: 'text' },
    dependencies: { car: 'player-car', session: 'session-info', notes: 'YAML' },
    normalization: 'resolve player car',
    tags: ['car', 'identity'],
    representations: {
      competition: 'identity',
      futuristic: 'ribbon',
      ddu: 'DDU header'
    }
  }),
  generated({
    id: 'carNumber',
    label: 'Car Number',
    category: 'identity',
    focus: 'session',
    requiredSnapshotFields: ['drivers'],
    normalizedSnapshotPaths: ['drivers'],
    rawIracingHints: ['CarNumber', 'CarNumberRaw'],
    data: { kind: 'text', unit: null, detail: 'text' },
    dependencies: { car: 'player-car', session: 'session-info', notes: 'YAML' },
    normalization: 'player driver row',
    tags: ['car', 'number', 'identity'],
    representations: {
      competition: 'number badge',
      futuristic: 'ribbon',
      ddu: 'DDU header'
    }
  }),
  generated({
    id: 'classIdentity',
    label: 'Class Identity',
    category: 'identity',
    focus: 'session',
    requiredSnapshotFields: ['drivers'],
    normalizedSnapshotPaths: ['drivers'],
    rawIracingHints: ['class YAML aliases'],
    data: { kind: 'composite', unit: null, detail: 'text/color' },
    dependencies: { car: 'player-car', session: 'session-info', notes: 'YAML' },
    normalization: 'player class row',
    tags: ['class', 'identity'],
    representations: {
      competition: 'class badge',
      futuristic: 'ribbon',
      ddu: 'DDU header'
    }
  }),
  generated({
    id: 'driverIdentity',
    label: 'Driver Identity',
    category: 'identity',
    focus: 'session',
    requiredSnapshotFields: ['driverName'],
    normalizedSnapshotPaths: ['driverName'],
    rawIracingHints: ['UserName', 'Name', 'UserID'],
    data: { kind: 'text', unit: null, detail: 'text' },
    dependencies: { car: 'player-car', session: 'session-info', notes: 'YAML' },
    normalization: 'player driver',
    tags: ['driver', 'identity'],
    representations: {
      competition: 'identity',
      futuristic: 'ribbon',
      ddu: 'DDU header'
    }
  }),
  generated({
    id: 'driverRating',
    label: 'Driver Rating / Licence',
    category: 'identity',
    focus: 'session',
    requiredSnapshotFields: ['drivers'],
    normalizedSnapshotPaths: ['drivers'],
    rawIracingHints: ['IRating', 'LicString'],
    data: { kind: 'composite', unit: null, detail: 'rating + text' },
    dependencies: { car: 'player-car', session: 'session-info', notes: 'YAML' },
    normalization: 'joined display',
    tags: ['driver', 'rating', 'license'],
    representations: {
      competition: 'rating tile',
      futuristic: 'ribbon',
      ddu: 'DDU header'
    }
  }),
  generated({
    id: 'teamIdentity',
    label: 'Team Identity',
    category: 'identity',
    focus: 'session',
    requiredSnapshotFields: ['drivers'],
    normalizedSnapshotPaths: ['drivers'],
    rawIracingHints: ['TeamName', 'TeamID'],
    data: { kind: 'text', unit: null, detail: 'text' },
    dependencies: { car: 'player-car', session: 'session-info', notes: 'YAML' },
    normalization: 'player team row',
    tags: ['team', 'identity'],
    representations: {
      competition: 'identity',
      futuristic: 'ribbon',
      ddu: 'DDU header'
    }
  }),
  generated({
    id: 'overallPosition',
    label: 'Overall Position',
    category: 'standings',
    focus: 'traffic',
    requiredSnapshotFields: ['position'],
    normalizedSnapshotPaths: ['position'],
    rawIracingHints: ['PlayerCarPosition'],
    data: { kind: 'integer', unit: 'count', detail: 'int' },
    dependencies: { car: 'player-car', session: 'timing-or-scoring', notes: 'scored session' },
    normalization: 'direct',
    tags: ['position', 'standings'],
    representations: {
      competition: 'P-number',
      futuristic: 'trend',
      ddu: 'DDU cell'
    }
  }),
  generated({
    id: 'classPosition',
    label: 'Class Position',
    category: 'standings',
    focus: 'traffic',
    requiredSnapshotFields: ['classPosition'],
    normalizedSnapshotPaths: ['classPosition'],
    rawIracingHints: ['PlayerCarClassPosition'],
    data: { kind: 'integer', unit: 'count', detail: 'int' },
    dependencies: { car: 'player-car', session: 'timing-or-scoring', notes: 'multiclass/scored' },
    normalization: 'direct',
    tags: ['position', 'class', 'standings'],
    representations: {
      competition: 'class P-number',
      futuristic: 'trend',
      ddu: 'DDU cell'
    }
  }),
  generated({
    id: 'fieldSize',
    label: 'Field Size',
    category: 'standings',
    focus: 'traffic',
    requiredSnapshotFields: ['totalCars'],
    normalizedSnapshotPaths: ['totalCars'],
    rawIracingHints: ['TotalCars'],
    data: { kind: 'integer', unit: 'count', detail: 'int' },
    dependencies: { car: 'none', session: 'timing-or-scoring', notes: 'DriverInfo' },
    normalization: 'drivers.length; TotalCars catalog-only',
    tags: ['standings', 'field'],
    representations: {
      competition: 'count',
      futuristic: 'field ribbon',
      ddu: 'DDU cell'
    }
  }),
  generated({
    id: 'strengthOfField',
    label: 'Strength of Field',
    category: 'standings',
    focus: 'session',
    requiredSnapshotFields: ['strengthOfField'],
    normalizedSnapshotPaths: ['strengthOfField'],
    rawIracingHints: ['SOF YAML aliases'],
    data: { kind: 'integer', unit: 'iRating', detail: 'iRating points' },
    dependencies: { car: 'none', session: 'session-info', notes: 'YAML/drivers' },
    normalization: 'explicit value else mean positive iRating',
    tags: ['standings', 'irating'],
    representations: {
      competition: 'number',
      futuristic: 'field trend',
      ddu: 'DDU cell'
    }
  }),
  generated({
    id: 'perCarPosition',
    label: 'Per-Car Position',
    category: 'standings',
    focus: 'traffic',
    requiredSnapshotFields: ['drivers'],
    normalizedSnapshotPaths: ['drivers'],
    rawIracingHints: ['CarIdxPosition + results'],
    data: { kind: 'per-car', unit: 'count', detail: 'int[car]' },
    dependencies: { car: 'per-car', session: 'timing-or-scoring', notes: 'per-car scoring' },
    normalization: 'joined live/results',
    tags: ['standings', 'relative', 'table', 'position'],
    representations: {
      competition: 'table',
      futuristic: 'ribbon',
      ddu: 'DDU multirow'
    }
  }),
  generated({
    id: 'perCarClassPosition',
    label: 'Per-Car Class Position',
    category: 'standings',
    focus: 'traffic',
    requiredSnapshotFields: ['drivers'],
    normalizedSnapshotPaths: ['drivers'],
    rawIracingHints: ['CarIdxClassPosition'],
    data: { kind: 'per-car', unit: 'count', detail: 'int[car]' },
    dependencies: { car: 'per-car', session: 'timing-or-scoring', notes: 'multiclass' },
    normalization: 'joined live/results',
    tags: ['standings', 'relative', 'table', 'class', 'position'],
    representations: {
      competition: 'table',
      futuristic: 'ribbon',
      ddu: 'DDU multirow'
    }
  }),
  generated({
    id: 'perCarLap',
    label: 'Per-Car Lap',
    category: 'standings',
    focus: 'traffic',
    requiredSnapshotFields: ['drivers'],
    normalizedSnapshotPaths: ['drivers'],
    rawIracingHints: ['CarIdxLap'],
    data: { kind: 'per-car', unit: 'count', detail: 'int[car]' },
    dependencies: { car: 'per-car', session: 'timing-or-scoring', notes: 'per-car' },
    normalization: 'direct',
    tags: ['standings', 'relative', 'table', 'laps'],
    representations: {
      competition: 'table',
      futuristic: 'ribbon',
      ddu: 'DDU multirow'
    }
  }),
  generated({
    id: 'perCarCompletedLaps',
    label: 'Per-Car Completed Laps',
    category: 'standings',
    focus: 'traffic',
    requiredSnapshotFields: ['drivers'],
    normalizedSnapshotPaths: ['drivers'],
    rawIracingHints: ['CarIdxLapCompleted'],
    data: { kind: 'per-car', unit: 'count', detail: 'int[car]' },
    dependencies: { car: 'per-car', session: 'timing-or-scoring', notes: 'per-car' },
    normalization: 'direct',
    tags: ['standings', 'relative', 'table', 'laps'],
    representations: {
      competition: 'table',
      futuristic: 'ribbon',
      ddu: 'DDU multirow'
    }
  }),
  generated({
    id: 'perCarProgress',
    label: 'Per-Car Lap Progress',
    category: 'standings',
    focus: 'traffic',
    requiredSnapshotFields: ['drivers'],
    normalizedSnapshotPaths: ['drivers'],
    rawIracingHints: ['CarIdxLapDistPct'],
    data: { kind: 'per-car', unit: '%', detail: 'float[car] 0..1' },
    dependencies: { car: 'per-car', session: 'timing-or-scoring', notes: 'per-car' },
    normalization: 'clamp',
    tags: ['standings', 'relative', 'table', 'laps', 'track'],
    representations: {
      competition: 'table',
      futuristic: 'track ribbon',
      ddu: 'DDU multirow'
    }
  }),
  generated({
    id: 'perCarEstimatedTime',
    label: 'Per-Car Estimated Time',
    category: 'standings',
    focus: 'traffic',
    requiredSnapshotFields: ['drivers'],
    normalizedSnapshotPaths: ['drivers'],
    rawIracingHints: ['CarIdxEstTime'],
    data: { kind: 'per-car', unit: 's', detail: 'seconds[car]' },
    dependencies: { car: 'per-car', session: 'timing-or-scoring', notes: 'per-car' },
    normalization: 'direct',
    tags: ['standings', 'relative', 'table', 'estimated', 'timing'],
    representations: {
      competition: 'table',
      futuristic: 'ribbon',
      ddu: 'DDU multirow'
    }
  }),
  generated({
    id: 'perCarRelativeTime',
    label: 'Per-Car Relative Time',
    category: 'standings',
    focus: 'traffic',
    requiredSnapshotFields: ['drivers', 'radarCars', 'carLeftRight'],
    normalizedSnapshotPaths: ['drivers', 'radarCars', 'carLeftRight'],
    rawIracingHints: ['CarIdxEstTime', 'CarIdxF2Time', 'lap progress fallback'],
    data: { kind: 'per-car', unit: 's', detail: 'seconds[car]' },
    dependencies: { car: 'per-car', session: 'timing-or-scoring', notes: 'per-car' },
    normalization: 'EstTime difference → F2 difference → lap-distance estimate',
    tags: ['standings', 'relative', 'radar', 'traffic'],
    representations: {
      competition: 'relative radar',
      futuristic: 'orbit',
      ddu: 'DDU radar'
    }
  }),
  generated({
    id: 'perCarGear',
    label: 'Per-Car Gear',
    category: 'standings',
    focus: 'traffic',
    requiredSnapshotFields: ['drivers'],
    normalizedSnapshotPaths: ['drivers'],
    rawIracingHints: ['CarIdxGear'],
    data: { kind: 'per-car', unit: null, detail: 'int[car]' },
    dependencies: { car: 'per-car', session: 'timing-or-scoring', notes: 'per-car' },
    normalization: 'direct',
    tags: ['standings', 'relative', 'table', 'gear'],
    representations: {
      competition: 'table',
      futuristic: 'ribbon',
      ddu: 'DDU multirow'
    }
  }),
  generated({
    id: 'perCarRpm',
    label: 'Per-Car RPM',
    category: 'standings',
    focus: 'traffic',
    requiredSnapshotFields: ['drivers'],
    normalizedSnapshotPaths: ['drivers'],
    rawIracingHints: ['CarIdxRPM'],
    data: { kind: 'per-car', unit: 'rpm', detail: 'rpm[car]' },
    dependencies: { car: 'per-car', session: 'timing-or-scoring', notes: 'per-car' },
    normalization: 'direct',
    tags: ['standings', 'relative', 'table', 'rpm', 'engine'],
    representations: {
      competition: 'table',
      futuristic: 'ribbon',
      ddu: 'DDU multirow'
    }
  }),
  unsupported(
    {
      id: 'perCarSteering',
      label: 'Per-Car Steering',
      category: 'standings',
      focus: 'traffic',
      requiredSnapshotFields: [],
      normalizedSnapshotPaths: [],
      rawIracingHints: ['CarIdxSteer'],
      data: { kind: 'per-car', unit: 'rad', detail: 'rad[car]' },
      dependencies: { car: 'per-car', session: 'timing-or-scoring', notes: 'per-car' },
      normalization: 'no normalized provider field',
      sourceConstraints: [
        {
          id: 'provider-normalization-missing',
          scope: 'provider',
          detail: 'CarIdxSteer is not normalized into TelemetrySnapshot. The governed ordinary artifact must render an explicit unsupported state and never synthesize opponent steering.'
        }
      ],
      tags: ['standings', 'steering', 'table']
    },
    'CarIdxSteer exists in the SDK sample, but the iRacing provider does not normalize it into TelemetrySnapshot.'
  ),
  generated({
    id: 'perCarPitRoad',
    label: 'Per-Car Pit-Road State',
    category: 'standings',
    focus: 'traffic',
    requiredSnapshotFields: ['drivers'],
    normalizedSnapshotPaths: ['drivers'],
    rawIracingHints: ['CarIdxOnPitRoad'],
    data: { kind: 'per-car', unit: null, detail: 'bool[car]' },
    dependencies: { car: 'per-car', session: 'timing-or-scoring', notes: 'per-car' },
    normalization: 'direct',
    tags: ['standings', 'relative', 'table', 'pit', 'status'],
    representations: {
      competition: 'table',
      futuristic: 'ribbon',
      ddu: 'DDU multirow'
    }
  }),
  generated({
    id: 'perCarTrackLocation',
    label: 'Per-Car Track Location',
    category: 'standings',
    focus: 'traffic',
    requiredSnapshotFields: ['drivers'],
    normalizedSnapshotPaths: ['drivers'],
    rawIracingHints: ['CarIdxTrackSurface'],
    data: { kind: 'per-car', unit: null, detail: 'enum[car]' },
    dependencies: { car: 'per-car', session: 'timing-or-scoring', notes: 'per-car' },
    normalization: 'track-location labels',
    tags: ['standings', 'relative', 'table', 'track', 'status'],
    representations: {
      competition: 'table',
      futuristic: 'ribbon',
      ddu: 'DDU multirow'
    }
  }),
  generated({
    id: 'perCarTrackMaterial',
    label: 'Per-Car Track Material',
    category: 'standings',
    focus: 'traffic',
    requiredSnapshotFields: ['drivers'],
    normalizedSnapshotPaths: ['drivers'],
    rawIracingHints: ['CarIdxTrackSurfaceMaterial'],
    data: { kind: 'per-car', unit: null, detail: 'enum[car]' },
    dependencies: { car: 'per-car', session: 'timing-or-scoring', notes: 'per-car' },
    normalization: 'material-family labels',
    tags: ['standings', 'relative', 'table', 'track', 'surface'],
    representations: {
      competition: 'table',
      futuristic: 'ribbon',
      ddu: 'DDU multirow'
    }
  }),
  generated({
    id: 'perCarLastLap',
    label: 'Per-Car Last Lap',
    category: 'standings',
    focus: 'traffic',
    requiredSnapshotFields: ['drivers'],
    normalizedSnapshotPaths: ['drivers'],
    rawIracingHints: ['CarIdxLastLapTime'],
    data: { kind: 'per-car', unit: 's', detail: 'seconds[car]' },
    dependencies: { car: 'per-car', session: 'timing-or-scoring', notes: 'per-car' },
    normalization: 'direct',
    tags: ['standings', 'relative', 'table', 'lap-time'],
    representations: {
      competition: 'table',
      futuristic: 'ribbon',
      ddu: 'DDU multirow'
    }
  }),
  generated({
    id: 'perCarBestLap',
    label: 'Per-Car Best Lap',
    category: 'standings',
    focus: 'traffic',
    requiredSnapshotFields: ['drivers'],
    normalizedSnapshotPaths: ['drivers'],
    rawIracingHints: ['CarIdxBestLapTime/Num'],
    data: { kind: 'per-car', unit: 'mixed', detail: 'seconds+lap[car]' },
    dependencies: { car: 'per-car', session: 'timing-or-scoring', notes: 'per-car' },
    normalization: 'joined',
    tags: ['standings', 'relative', 'table', 'best', 'lap-time'],
    representations: {
      competition: 'table',
      futuristic: 'ribbon',
      ddu: 'DDU multirow'
    }
  }),
  generated({
    id: 'perCarPushToPass',
    label: 'Per-Car Push-to-Pass',
    category: 'standings',
    focus: 'traffic',
    requiredSnapshotFields: ['drivers'],
    normalizedSnapshotPaths: ['drivers'],
    rawIracingHints: ['CarIdxP2P_Status/Count'],
    data: { kind: 'per-car', unit: 'mixed', detail: 'bool+int[car]' },
    dependencies: { car: 'per-car', session: 'timing-or-scoring', notes: 'supported series' },
    normalization: 'joined',
    tags: ['standings', 'relative', 'table', 'push-to-pass'],
    representations: {
      competition: 'table',
      futuristic: 'ribbon',
      ddu: 'DDU multirow'
    }
  }),
  generated({
    id: 'fuelLevel',
    label: 'Fuel Level',
    category: 'fuel',
    focus: 'fuel',
    requiredSnapshotFields: ['fuelLiters'],
    normalizedSnapshotPaths: ['fuelLiters'],
    rawIracingHints: ['FuelLevel'],
    data: { kind: 'number', unit: 'L', detail: 'L' },
    dependencies: { car: 'player-car', session: 'live-session', notes: 'player' },
    normalization: 'direct',
    tags: ['fuel', 'level'],
    representations: {
      competition: 'arc',
      futuristic: 'trend',
      ddu: 'DDU cell'
    }
  }),
  generated({
    id: 'fuelLevelPct',
    label: 'Fuel Level Percentage',
    category: 'fuel',
    focus: 'fuel',
    requiredSnapshotFields: ['fuelLevelPct'],
    normalizedSnapshotPaths: ['fuelLevelPct'],
    rawIracingHints: ['FuelLevelPct'],
    data: { kind: 'number', unit: '%', detail: '0..1 → %' },
    dependencies: { car: 'player-car', session: 'live-session', notes: 'player' },
    normalization: 'clamp',
    tags: ['fuel', 'level'],
    representations: {
      competition: 'arc',
      futuristic: 'trend',
      ddu: 'DDU cell'
    }
  }),
  generated({
    id: 'fuelConsumptionRate',
    label: 'Fuel Mass-Flow Rate',
    category: 'fuel',
    focus: 'fuel',
    requiredSnapshotFields: ['fuelUsePerHourKg'],
    normalizedSnapshotPaths: ['fuelUsePerHourKg'],
    rawIracingHints: ['FuelUsePerHour'],
    data: { kind: 'number', unit: 'kg/h', detail: 'kg/h' },
    dependencies: { car: 'feature-dependent', session: 'live-session', notes: 'car/channel-dependent' },
    normalization: 'direct mass flow',
    tags: ['fuel', 'consumption'],
    representations: {
      competition: 'number',
      futuristic: 'trend',
      ddu: 'DDU cell'
    }
  }),
  generated({
    id: 'fuelPerLap',
    label: 'Fuel Used per Lap',
    category: 'fuel',
    focus: 'fuel',
    requiredSnapshotFields: ['fuelPerLapKg'],
    normalizedSnapshotPaths: ['fuelPerLapKg'],
    rawIracingHints: ['FuelUsePerLap catalog alias'],
    data: { kind: 'number', unit: 'kg/lap', detail: 'kg/lap' },
    dependencies: { car: 'player-car', session: 'timing-or-scoring', notes: 'needs valid lap' },
    normalization: 'FuelUsePerHour/3600*last valid lap time',
    tags: ['fuel', 'laps', 'derived'],
    representations: {
      competition: 'number',
      futuristic: 'projection',
      ddu: 'DDU cell'
    }
  }),
  generated({
    id: 'fuelCapacity',
    label: 'Fuel Capacity',
    category: 'fuel',
    focus: 'fuel',
    requiredSnapshotFields: ['fuelCapacityLiters'],
    normalizedSnapshotPaths: ['fuelCapacityLiters'],
    rawIracingHints: ['DriverCarFuelMaxLtr'],
    data: { kind: 'number', unit: 'L', detail: 'L' },
    dependencies: { car: 'feature-dependent', session: 'session-info', notes: 'car/YAML' },
    normalization: 'YAML max else FuelLevel/FuelLevelPct',
    tags: ['fuel', 'capacity'],
    representations: {
      competition: 'number',
      futuristic: 'strategy card',
      ddu: 'DDU cell'
    }
  }),
  generated({
    id: 'tyreCarcassTemperature',
    label: 'Tyre Carcass Temperature',
    category: 'tyres',
    focus: 'tyres',
    requiredSnapshotFields: ['tyres'],
    normalizedSnapshotPaths: ['tyres.*'],
    rawIracingHints: ['12 LF/RF/LR/RR CL/CM/CR vars'],
    data: { kind: 'corners', unit: '°C', detail: '°C; 4×3' },
    dependencies: { car: 'feature-dependent', session: 'live-session', notes: 'car-dependent' },
    normalization: 'retain zones; aggregate center',
    tags: ['tyres', 'temperature', 'corner-grid'],
    representations: {
      competition: '4-corner',
      futuristic: 'heatmap',
      ddu: 'DDU quad'
    }
  }),
  generated({
    id: 'tyreSurfaceTemperature',
    label: 'Tyre Surface Temperature',
    category: 'tyres',
    focus: 'tyres',
    requiredSnapshotFields: ['tyres'],
    normalizedSnapshotPaths: ['tyres.surface*'],
    rawIracingHints: ['12 LF/RF/LR/RR L/M/R vars'],
    data: { kind: 'corners', unit: '°C', detail: '°C; 4×3' },
    dependencies: { car: 'feature-dependent', session: 'live-session', notes: 'car-dependent' },
    normalization: 'retain zones',
    tags: ['tyres', 'temperature', 'surface', 'corner-grid'],
    representations: {
      competition: '4-corner',
      futuristic: 'heatmap',
      ddu: 'DDU quad'
    }
  }),
  generated({
    id: 'tyreColdPressure',
    label: 'Tyre Cold Pressure',
    category: 'tyres',
    focus: 'tyres',
    requiredSnapshotFields: ['tireColdPressuresKpa'],
    normalizedSnapshotPaths: ['tireColdPressuresKpa'],
    rawIracingHints: ['LF/RF/LR/RRcoldPressure'],
    data: { kind: 'corners', unit: 'kPa', detail: 'kPa; four corners' },
    dependencies: { car: 'feature-dependent', session: 'live-session', notes: 'car/setup' },
    normalization: 'garage cold pressure only',
    tags: ['tyres', 'tyre-pressure', 'cold', 'corner-grid'],
    representations: {
      competition: '4-corner',
      futuristic: 'heatmap',
      ddu: 'DDU quad'
    }
  }),
  generated({
    id: 'tyreWear',
    label: 'Tyre Wear',
    category: 'tyres',
    focus: 'tyres',
    requiredSnapshotFields: ['tyres'],
    normalizedSnapshotPaths: ['tyres.wear*'],
    rawIracingHints: ['12 LF/RF/LR/RR wear vars'],
    data: { kind: 'corners', unit: '%', detail: '0..1 remaining; 4×3' },
    dependencies: { car: 'feature-dependent', session: 'live-session', notes: 'car/channel-dependent' },
    normalization: 'retain zones; aggregate center',
    tags: ['tyres', 'tyre-wear', 'corner-grid'],
    representations: {
      competition: '4-corner',
      futuristic: 'heatmap',
      ddu: 'DDU quad'
    }
  }),
  generated({
    id: 'brakeLinePressure',
    label: 'Brake-Line Pressure',
    category: 'tyres',
    focus: 'brakes',
    requiredSnapshotFields: ['brakeLinePressBar'],
    normalizedSnapshotPaths: ['brakeLinePressBar'],
    rawIracingHints: ['four brakeLinePress vars'],
    data: { kind: 'corners', unit: 'bar', detail: 'bar; four corners' },
    dependencies: { car: 'feature-dependent', session: 'live-session', notes: 'car-dependent' },
    normalization: 'direct',
    tags: ['brakes', 'pressure', 'corner-grid'],
    representations: {
      competition: '4-corner',
      futuristic: 'trends',
      ddu: 'DDU quad'
    }
  }),
  generated({
    id: 'brakeTemperature',
    label: 'Brake Temperature',
    category: 'tyres',
    focus: 'brakes',
    requiredSnapshotFields: ['brakeTempC'],
    normalizedSnapshotPaths: ['brakeTempC'],
    rawIracingHints: ['four brakeTemp vars'],
    data: { kind: 'corners', unit: '°C', detail: '°C; four corners' },
    dependencies: { car: 'feature-dependent', session: 'live-session', notes: 'car-dependent' },
    normalization: 'direct',
    tags: ['brakes', 'temperature', 'corner-grid'],
    representations: {
      competition: '4-corner',
      futuristic: 'heatmap',
      ddu: 'DDU quad'
    }
  }),
  generated({
    id: 'airTemperature',
    label: 'Air Temperature',
    category: 'weather',
    focus: 'weather',
    requiredSnapshotFields: ['airTempC'],
    normalizedSnapshotPaths: ['airTempC'],
    rawIracingHints: ['AirTemp'],
    data: { kind: 'number', unit: '°C', detail: '°C; -10..50 display' },
    dependencies: { car: 'none', session: 'weather', notes: 'session weather' },
    normalization: 'direct',
    tags: ['weather', 'temperature'],
    representations: {
      competition: 'arc',
      futuristic: 'trend',
      ddu: 'DDU cell'
    }
  }),
  generated({
    id: 'trackTemperature',
    label: 'Track Temperature',
    category: 'weather',
    focus: 'weather',
    requiredSnapshotFields: ['trackTempC'],
    normalizedSnapshotPaths: ['trackTempC'],
    rawIracingHints: ['TrackTemp', 'TrackTempCrew'],
    data: { kind: 'number', unit: '°C', detail: '°C; 0..70 display' },
    dependencies: { car: 'none', session: 'weather', notes: 'session weather' },
    normalization: 'provider uses TrackTemp; Crew is sample/catalog-only',
    tags: ['weather', 'temperature', 'track'],
    representations: {
      competition: 'arc',
      futuristic: 'trend',
      ddu: 'DDU cell'
    }
  }),
  generated({
    id: 'airDensity',
    label: 'Air Density',
    category: 'weather',
    focus: 'weather',
    requiredSnapshotFields: ['airDensityKgM3'],
    normalizedSnapshotPaths: ['airDensityKgM3'],
    rawIracingHints: ['AirDensity'],
    data: { kind: 'number', unit: 'kg/m³', detail: 'kg/m³; 0.8..1.5 display' },
    dependencies: { car: 'none', session: 'weather', notes: 'session weather' },
    normalization: 'direct',
    tags: ['weather', 'density'],
    representations: {
      competition: 'arc',
      futuristic: 'trend',
      ddu: 'DDU cell'
    }
  }),
  generated({
    id: 'airPressure',
    label: 'Air Pressure',
    category: 'weather',
    focus: 'weather',
    requiredSnapshotFields: ['airPressureKpa'],
    normalizedSnapshotPaths: ['airPressureKpa', 'airPressureHg'],
    rawIracingHints: ['AirPressure'],
    data: { kind: 'number', unit: 'kPa', detail: 'raw inHg + normalized kPa; 85..120 kPa display' },
    dependencies: { car: 'none', session: 'weather', notes: 'session weather' },
    normalization: 'inHg*3.386389',
    tags: ['weather', 'pressure'],
    representations: {
      competition: 'arc',
      futuristic: 'trend',
      ddu: 'DDU cell'
    }
  }),
  generated({
    id: 'fogLevel',
    label: 'Fog Level',
    category: 'weather',
    focus: 'weather',
    requiredSnapshotFields: ['fogPct'],
    normalizedSnapshotPaths: ['fogPct'],
    rawIracingHints: ['FogLevel'],
    data: { kind: 'number', unit: '%', detail: '0..1 → %' },
    dependencies: { car: 'none', session: 'weather', notes: 'session weather' },
    normalization: 'clamp',
    tags: ['weather', 'fog'],
    representations: {
      competition: 'bar',
      futuristic: 'history',
      ddu: 'DDU strip'
    }
  }),
  generated({
    id: 'humidity',
    label: 'Relative Humidity',
    category: 'weather',
    focus: 'weather',
    requiredSnapshotFields: ['humidityPct'],
    normalizedSnapshotPaths: ['humidityPct'],
    rawIracingHints: ['RelativeHumidity'],
    data: { kind: 'number', unit: '%', detail: '0..1 → %' },
    dependencies: { car: 'none', session: 'weather', notes: 'session weather' },
    normalization: 'clamp',
    tags: ['weather', 'humidity'],
    representations: {
      competition: 'bar',
      futuristic: 'history',
      ddu: 'DDU strip'
    }
  }),
  generated({
    id: 'skies',
    label: 'Skies',
    category: 'weather',
    focus: 'weather',
    requiredSnapshotFields: ['skies'],
    normalizedSnapshotPaths: ['skies'],
    rawIracingHints: ['Skies'],
    data: { kind: 'enum', unit: null, detail: 'enum 0..3' },
    dependencies: { car: 'none', session: 'weather', notes: 'session weather' },
    normalization: 'direct',
    tags: ['weather', 'skies'],
    representations: {
      competition: 'status',
      futuristic: 'sky arc',
      ddu: 'DDU cell'
    }
  }),
  generated({
    id: 'weatherMode',
    label: 'Weather Mode',
    category: 'weather',
    focus: 'weather',
    requiredSnapshotFields: ['weatherType'],
    normalizedSnapshotPaths: ['weatherType'],
    rawIracingHints: ['WeatherType'],
    data: { kind: 'enum', unit: null, detail: 'enum 0 constant/1 dynamic' },
    dependencies: { car: 'none', session: 'weather', notes: 'session weather' },
    normalization: 'direct',
    tags: ['weather', 'status'],
    representations: {
      competition: 'status',
      futuristic: 'state arc',
      ddu: 'DDU cell'
    }
  }),
  generated({
    id: 'wind',
    label: 'Wind Vector',
    category: 'weather',
    focus: 'weather',
    requiredSnapshotFields: ['windSpeedMs', 'windDirRad'],
    normalizedSnapshotPaths: ['windDirRad', 'windSpeedMs'],
    rawIracingHints: ['WindDir', 'WindVel'],
    data: { kind: 'vector', unit: 'mixed', detail: 'rad + m/s' },
    dependencies: { car: 'none', session: 'weather', notes: 'session weather' },
    normalization: 'vector conversion for display',
    tags: ['vector', 'weather', 'wind'],
    representations: {
      competition: 'vector',
      futuristic: 'trace',
      ddu: 'DDU axes'
    }
  }),
  generated({
    id: 'solarPosition',
    label: 'Solar Position',
    category: 'weather',
    focus: 'weather',
    requiredSnapshotFields: ['solarAltitudeRad', 'solarAzimuthRad'],
    normalizedSnapshotPaths: ['solarAltitudeRad', 'solarAzimuthRad'],
    rawIracingHints: ['SolarAltitude/Azimuth'],
    data: { kind: 'vector', unit: 'rad', detail: 'rad pair' },
    dependencies: { car: 'none', session: 'weather', notes: 'session weather' },
    normalization: 'vector/degrees for display',
    tags: ['vector', 'weather', 'solar'],
    representations: {
      competition: 'sun vector',
      futuristic: 'trace',
      ddu: 'DDU axes'
    }
  }),
  generated({
    id: 'trackWetness',
    label: 'Track Wetness',
    category: 'weather',
    focus: 'weather',
    requiredSnapshotFields: ['trackWetnessPct'],
    normalizedSnapshotPaths: ['trackWetnessPct'],
    rawIracingHints: ['TrackWetness', 'TrackWetnessPct'],
    data: { kind: 'number', unit: '%', detail: 'enum 0..7 → 0..1' },
    dependencies: { car: 'none', session: 'weather', notes: 'rain-enabled sessions' },
    normalization: '(enum-1)/6 after dry/unknown',
    tags: ['weather', 'wetness', 'track'],
    representations: {
      competition: 'bar',
      futuristic: 'history',
      ddu: 'DDU strip'
    }
  }),
  generated({
    id: 'precipitation',
    label: 'Precipitation',
    category: 'weather',
    focus: 'weather',
    requiredSnapshotFields: ['precipitationPct'],
    normalizedSnapshotPaths: ['precipitationPct'],
    rawIracingHints: ['Precipitation', 'RainIntensity'],
    data: { kind: 'number', unit: '%', detail: '0..1 → %' },
    dependencies: { car: 'none', session: 'weather', notes: 'rain-enabled sessions' },
    normalization: 'provider consumes Precipitation only',
    tags: ['weather', 'rain', 'wetness'],
    representations: {
      competition: 'bar',
      futuristic: 'history',
      ddu: 'DDU strip'
    }
  }),
  generated({
    id: 'trackGrip',
    label: 'Track Grip',
    category: 'weather',
    focus: 'weather',
    requiredSnapshotFields: ['gripPct'],
    normalizedSnapshotPaths: ['gripPct'],
    rawIracingHints: ['TrackGripStatus', 'TrackGrip'],
    data: { kind: 'number', unit: '%', detail: '0..1 → %' },
    dependencies: { car: 'none', session: 'weather', notes: 'session/track' },
    normalization: 'clamp first-defined',
    tags: ['weather', 'grip', 'track'],
    representations: {
      competition: 'bar',
      futuristic: 'history',
      ddu: 'DDU strip'
    }
  }),
  generated({
    id: 'declaredWet',
    label: 'Wet-Weather Declaration',
    category: 'weather',
    focus: 'weather',
    requiredSnapshotFields: ['weatherDeclaredWet'],
    normalizedSnapshotPaths: ['weatherDeclaredWet'],
    rawIracingHints: ['WeatherDeclaredWet'],
    data: { kind: 'boolean', unit: null, detail: 'bool' },
    dependencies: { car: 'none', session: 'weather', notes: 'race-control/rain' },
    normalization: 'direct',
    tags: ['weather', 'wetness', 'flags'],
    representations: {
      competition: 'lamp',
      futuristic: 'state timeline',
      ddu: 'tell-tale'
    }
  }),
  generated({
    id: 'playerSurfaceMaterial',
    label: 'Player-Car Surface Material',
    category: 'weather',
    focus: 'track',
    requiredSnapshotFields: ['trackSurfaceMaterial'],
    normalizedSnapshotPaths: ['trackSurfaceMaterial'],
    rawIracingHints: ['PlayerTrackSurfaceMaterial'],
    data: { kind: 'enum', unit: null, detail: 'enum -1..27' },
    dependencies: { car: 'player-car', session: 'weather', notes: 'player location' },
    normalization: 'material-family label',
    tags: ['weather', 'track', 'surface'],
    representations: {
      competition: 'status',
      futuristic: 'surface ribbon',
      ddu: 'DDU cell'
    }
  }),
  generated({
    id: 'trackIdentity',
    label: 'Track and Configuration',
    category: 'identity',
    focus: 'track',
    requiredSnapshotFields: ['trackName', 'trackConfigName'],
    normalizedSnapshotPaths: ['trackName', 'trackConfigName'],
    rawIracingHints: ['TrackName/DisplayName/ConfigName'],
    data: { kind: 'text', unit: null, detail: 'text' },
    dependencies: { car: 'none', session: 'session-info', notes: 'YAML' },
    normalization: 'display name fallback internal name + layout',
    tags: ['track', 'identity'],
    representations: {
      competition: 'identity',
      futuristic: 'track ribbon',
      ddu: 'DDU header'
    }
  }),
  generated({
    id: 'trackLength',
    label: 'Track Length',
    category: 'map',
    focus: 'track',
    requiredSnapshotFields: ['trackLengthKm', 'lapDistPct'],
    normalizedSnapshotPaths: ['trackLengthKm', 'lapDistPct'],
    rawIracingHints: ['TrackLength'],
    data: { kind: 'number', unit: 'km', detail: 'km' },
    dependencies: { car: 'none', session: 'session-info', notes: 'YAML' },
    normalization: 'parse SessionInfo text',
    tags: ['map', 'track', 'distance'],
    representations: {
      competition: 'map',
      futuristic: 'path',
      ddu: 'DDU map'
    }
  }),
  generated({
    id: 'onPitRoad',
    label: 'On Pit Road',
    category: 'pit',
    focus: 'strategy',
    requiredSnapshotFields: ['onPitRoad'],
    normalizedSnapshotPaths: ['onPitRoad'],
    rawIracingHints: ['OnPitRoad'],
    data: { kind: 'boolean', unit: null, detail: 'bool' },
    dependencies: { car: 'player-car', session: 'pit', notes: 'pit/race' },
    normalization: 'direct',
    tags: ['pit', 'status'],
    representations: {
      competition: 'lamp',
      futuristic: 'timeline',
      ddu: 'tell-tale'
    }
  }),
  generated({
    id: 'pitLimiter',
    label: 'Pit Limiter',
    category: 'pit',
    focus: 'strategy',
    requiredSnapshotFields: ['pitLimiter'],
    normalizedSnapshotPaths: ['pitLimiter'],
    rawIracingHints: ['PitLimiter', 'PitSpeedLimiter'],
    data: { kind: 'boolean', unit: null, detail: 'bool' },
    dependencies: { car: 'feature-dependent', session: 'pit', notes: 'fitted cars' },
    normalization: 'provider uses PitLimiter',
    tags: ['pit', 'limiter'],
    representations: {
      competition: 'lamp',
      futuristic: 'timeline',
      ddu: 'tell-tale'
    }
  }),
  generated({
    id: 'pitServicesSelected',
    label: 'Selected Pit Services',
    category: 'pit',
    focus: 'strategy',
    requiredSnapshotFields: ['pitServiceFlags'],
    normalizedSnapshotPaths: ['pitServiceFlags'],
    rawIracingHints: ['PitSvFlags'],
    data: { kind: 'bitfield', unit: null, detail: 'bitfield→list' },
    dependencies: { car: 'player-car', session: 'pit', notes: 'in-car/pit' },
    normalization: 'decode service bits',
    tags: ['pit', 'service', 'strategy'],
    representations: {
      competition: 'checklist',
      futuristic: 'service flow',
      ddu: 'DDU pit row'
    }
  }),
  generated({
    id: 'pitTyreTargets',
    label: 'Pit Tyre Targets',
    category: 'pit',
    focus: 'strategy',
    requiredSnapshotFields: ['pitTyreTargetsKpa'],
    normalizedSnapshotPaths: ['pitTyreTargetsKpa'],
    rawIracingHints: ['PitSvLFP/RFP/LRP/RRP'],
    data: { kind: 'corners', unit: 'kPa', detail: 'kPa; four corners' },
    dependencies: { car: 'player-car', session: 'pit', notes: 'in-car/pit' },
    normalization: 'group corners',
    tags: ['pit', 'tyres', 'pressure', 'corner-grid'],
    representations: {
      competition: '4-corner',
      futuristic: 'heatmap',
      ddu: 'DDU quad'
    }
  }),
  generated({
    id: 'pitFuelToAdd',
    label: 'Pit Fuel to Add',
    category: 'pit',
    focus: 'strategy',
    requiredSnapshotFields: ['pitFuelToAddL'],
    normalizedSnapshotPaths: ['pitFuelToAddL'],
    rawIracingHints: ['PitSvFuel'],
    data: { kind: 'number', unit: 'L', detail: 'L' },
    dependencies: { car: 'player-car', session: 'pit', notes: 'in-car/pit' },
    normalization: 'direct',
    tags: ['pit', 'fuel', 'strategy'],
    representations: {
      competition: 'bar',
      futuristic: 'strategy trend',
      ddu: 'DDU row'
    }
  }),
  generated({
    id: 'repairTime',
    label: 'Repair Time',
    category: 'pit',
    focus: 'strategy',
    requiredSnapshotFields: ['repairTimeSec'],
    normalizedSnapshotPaths: ['repairTimeSec'],
    rawIracingHints: ['PitRepairLeft'],
    data: { kind: 'number', unit: 's', detail: 'seconds' },
    dependencies: { car: 'player-car', session: 'pit', notes: 'repair context' },
    normalization: 'direct',
    tags: ['pit', 'repair', 'clock'],
    representations: {
      competition: 'timer',
      futuristic: 'timeline',
      ddu: 'DDU timer'
    }
  }),
  generated({
    id: 'optionalRepairTime',
    label: 'Optional Repair Time',
    category: 'pit',
    focus: 'strategy',
    requiredSnapshotFields: ['optionalRepairTimeSec'],
    normalizedSnapshotPaths: ['optionalRepairTimeSec'],
    rawIracingHints: ['PitOptRepairLeft'],
    data: { kind: 'number', unit: 's', detail: 'seconds' },
    dependencies: { car: 'player-car', session: 'pit', notes: 'repair context' },
    normalization: 'direct',
    tags: ['pit', 'repair', 'clock'],
    representations: {
      competition: 'timer',
      futuristic: 'timeline',
      ddu: 'DDU timer'
    }
  }),
  generated({
    id: 'pitStopActive',
    label: 'Pit Stop Active',
    category: 'pit',
    focus: 'strategy',
    requiredSnapshotFields: ['pitStopActive'],
    normalizedSnapshotPaths: ['pitStopActive'],
    rawIracingHints: ['PitstopActive'],
    data: { kind: 'boolean', unit: null, detail: 'bool' },
    dependencies: { car: 'player-car', session: 'pit', notes: 'service context' },
    normalization: 'direct',
    tags: ['pit', 'status', 'service'],
    representations: {
      competition: 'status',
      futuristic: 'timeline',
      ddu: 'tell-tale'
    }
  }),
  generated({
    id: 'pitsOpen',
    label: 'Pits Open',
    category: 'pit',
    focus: 'race-control',
    requiredSnapshotFields: ['pit'],
    normalizedSnapshotPaths: ['pit.pitsOpen'],
    rawIracingHints: ['PitsOpen'],
    data: { kind: 'boolean', unit: null, detail: 'bool' },
    dependencies: { car: 'none', session: 'pit', notes: 'race-control' },
    normalization: 'direct',
    tags: ['pit', 'flags'],
    representations: {
      competition: 'banner',
      futuristic: 'state arc',
      ddu: 'tell-tale'
    }
  }),
  generated({
    id: 'inPitStall',
    label: 'In Pit Stall',
    category: 'pit',
    focus: 'strategy',
    requiredSnapshotFields: ['pit'],
    normalizedSnapshotPaths: ['pit.inPitStall'],
    rawIracingHints: ['PlayerCarInPitStall'],
    data: { kind: 'boolean', unit: null, detail: 'bool' },
    dependencies: { car: 'player-car', session: 'pit', notes: 'pit box' },
    normalization: 'direct',
    tags: ['pit', 'service'],
    representations: {
      competition: 'lamp',
      futuristic: 'timeline',
      ddu: 'tell-tale'
    }
  }),
  generated({
    id: 'pitServiceStatus',
    label: 'Pit-Service Status',
    category: 'pit',
    focus: 'strategy',
    requiredSnapshotFields: ['pit'],
    normalizedSnapshotPaths: ['pit.svStatus'],
    rawIracingHints: ['PlayerCarPitSvStatus'],
    data: { kind: 'enum', unit: null, detail: 'enum 0,1,2,100..105' },
    dependencies: { car: 'player-car', session: 'pit', notes: 'pit box' },
    normalization: 'raw enum',
    tags: ['pit', 'service'],
    representations: {
      competition: 'banner',
      futuristic: 'service flow',
      ddu: 'DDU status'
    }
  }),
  generated({
    id: 'repairRequirement',
    label: 'Repair Requirement',
    category: 'pit',
    focus: 'incidents',
    requiredSnapshotFields: ['pit'],
    normalizedSnapshotPaths: ['pit.repairNeeded/optRepairNeeded'],
    rawIracingHints: ['RepairRequired pseudo-field'],
    data: { kind: 'boolean', unit: null, detail: 'derived bool' },
    dependencies: { car: 'player-car', session: 'pit', notes: 'repair context' },
    normalization: 'repair timers >0',
    tags: ['pit', 'repair', 'warning'],
    representations: {
      competition: 'warning',
      futuristic: 'state timeline',
      ddu: 'tell-tale'
    }
  }),
  generated({
    id: 'fastRepair',
    label: 'Fast-Repair Allowance',
    category: 'pit',
    focus: 'strategy',
    requiredSnapshotFields: ['fastRepairsAvailable'],
    normalizedSnapshotPaths: ['fastRepairsAvailable'],
    rawIracingHints: ['FastRepairUsed', 'FastRepairAvailable'],
    data: { kind: 'integer', unit: 'count', detail: 'int count' },
    dependencies: { car: 'feature-dependent', session: 'pit', notes: 'series/session-dependent' },
    normalization: 'generated widget shows available; used remains snapshot-only',
    tags: ['pit', 'repair', 'count'],
    representations: {
      competition: 'count',
      futuristic: 'service trend',
      ddu: 'DDU row'
    }
  }),
  generated({
    id: 'incidentCounts',
    label: 'Incident Counts',
    category: 'pit',
    focus: 'incidents',
    requiredSnapshotFields: ['incidentCount'],
    normalizedSnapshotPaths: ['incidentCount/My/Team'],
    rawIracingHints: ['My/Team/Driver incident counts'],
    data: { kind: 'integer', unit: 'count', detail: 'int count' },
    dependencies: { car: 'player-car', session: 'live-session', notes: 'race session' },
    normalization: 'my count; aggregate fallback team',
    tags: ['incidents', 'pit'],
    representations: {
      competition: 'bar',
      futuristic: 'event trend',
      ddu: 'DDU row'
    }
  }),
  generated({
    id: 'incidentLimit',
    label: 'Incident Limit',
    category: 'pit',
    focus: 'incidents',
    requiredSnapshotFields: ['incidentLimit'],
    normalizedSnapshotPaths: ['incidentLimit'],
    rawIracingHints: ['PlayerCarMaxIncidentCount', 'YAML limits'],
    data: { kind: 'integer', unit: 'count', detail: 'int count' },
    dependencies: { car: 'player-car', session: 'session-info', notes: 'session rules' },
    normalization: 'provider uses YAML ResultsIncidentLimit/IncidentLimit',
    tags: ['incidents', 'pit'],
    representations: {
      competition: 'number',
      futuristic: 'risk trend',
      ddu: 'DDU row'
    }
  })
] as const

export type TelemetryCapabilityId =
  (typeof TELEMETRY_CAPABILITIES)[number]['id']
