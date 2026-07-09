// Per-sim telemetry field coverage model.
//
// Each sim provider populates a DIFFERENT subset of `TelemetrySnapshot` from its
// native data source. Widgets that depend on a given field can only render LIVE on
// the sims that actually publish it. This module captures, per sim, the set of
// `TelemetrySnapshot` keys each provider fills in `poll()` so the UI can filter /
// label widgets by which sims drive them.
//
// Sources (the authoritative `poll()`/snapshot mapping of each provider):
//   - iRacing  → src/main/iracing/provider.ts  (snapshot @ ~L786-893) — the broadest.
//   - ACC      → src/main/sims/acc.ts          (poll @ ~L62-98)
//   - AC       → src/main/sims/ac.ts           (poll @ ~L56-81)
//   - AMS2     → src/main/sims/ams2.ts         (poll @ ~L42-66)
//   - Mock     → src/main/telemetry/mock-provider.ts (treated as FULL coverage)
//
// This file is ADDITIVE and pure — no provider/runtime imports, only the shared type.

import type { SimId, TelemetrySnapshot } from './telemetry'

// LMU (Le Mans Ultimate, rFactor2-based) is a planned provider that is not yet part
// of the canonical `SimId` union in telemetry.ts. To model its coverage additively —
// without editing the shared type — we widen the id locally. `none`/`replay`/`mock`
// remain real `SimId`s.
export type CoverageSimId = SimId | 'lmu'

type Field = keyof TelemetrySnapshot

// ─── Full field universe ─────────────────────────────────────────────────────
// A `Record<keyof TelemetrySnapshot, true>` so the COMPILER guarantees this list is
// exhaustive: if a field is added to / removed from `TelemetrySnapshot`, typecheck
// breaks here until this map is updated. `mock` coverage is derived from it (mock is
// treated as "has everything" for development on the Mac), and it doubles as the
// canonical key set for tests.
const ALL_FIELD_FLAGS: Record<Field, true> = {
  sim: true,
  connected: true,
  timestamp: true,
  speedKmh: true,
  rpm: true,
  gear: true,
  maxRpm: true,
  engineRunning: true,
  shiftIndicatorPct: true,
  shiftRpm: true,
  revLights: true,
  throttle: true,
  brake: true,
  clutch: true,
  steerAngleDeg: true,
  latAccelG: true,
  longAccelG: true,
  vertAccelG: true,
  yawRateRadSec: true,
  drs: true,
  absActive: true,
  absEnabled: true,
  absLevel: true,
  absCutPct: true,
  engineWarnings: true,
  tcActive: true,
  tcEnabled: true,
  tcLevel: true,
  engineMap: true,
  brakeBiasPct: true,
  handbrake: true,
  waterTempC: true,
  oilTempC: true,
  oilPressureKpa: true,
  ersBatteryPct: true,
  pushToPass: true,
  pushToPassCount: true,
  sessionType: true,
  sessionState: true,
  paceMode: true,
  paceFlags: true,
  carName: true,
  carPath: true,
  trackName: true,
  trackConfigName: true,
  sessionTimeRemainingSec: true,
  lapsRemaining: true,
  currentLap: true,
  lapDistPct: true,
  lastLapTimeSec: true,
  bestLapTimeSec: true,
  currentLapTimeSec: true,
  estimatedLapTimeSec: true,
  deltaToBestSec: true,
  deltaToSessionBestSec: true,
  position: true,
  classPosition: true,
  totalCars: true,
  strengthOfField: true,
  sessionUniqueId: true,
  driverName: true,
  sessionTimeOfDay: true,
  weightPenaltyKg: true,
  powerAdjustPct: true,
  fuelLiters: true,
  fuelPerLap: true,
  fuelUsePerHourKg: true,
  fuelPerLapKg: true,
  fuelCapacityLiters: true,
  tyres: true,
  brakeTempC: true,
  tireColdPressuresKpa: true,
  flags: true,
  sessionFlagsRaw: true,
  pitLimiter: true,
  onPitRoad: true,
  pitServiceFlags: true,
  pit: true,
  incidentCount: true,
  incidentCountMy: true,
  incidentCountTeam: true,
  incidentLimit: true,
  fastRepairsUsed: true,
  fastRepairsAvailable: true,
  trackTempC: true,
  airTempC: true,
  trackWetnessPct: true,
  isRaining: true,
  gripPct: true,
  weatherDeclaredWet: true,
  trackSurfaceMaterial: true,
  playerCarIdx: true,
  drivers: true,
  relatives: true,
  radarCars: true,
  carLeftRight: true,
  carLeftRightRaw: true,
  carLeftRightCount: true,
  lat: true,
  lon: true,
  velocityX: true,
  velocityY: true,
  yawNorth: true,
  steeringTorquePct: true,
  steeringAngleMaxDeg: true,
  pitchRad: true,
  rollRad: true,
  yawRad: true,
  pitchRateRadSec: true,
  rollRateRadSec: true,
  altitudeM: true,
  manifoldPressBar: true,
  fuelPressBar: true,
  voltage: true,
  waterLevelL: true,
  oilLevelL: true,
  fuelLevelPct: true,
  brakeLinePressBar: true,
  deltaToOptimalSec: true,
  deltaToSessionOptimalSec: true,
  deltaToDriverBestSec: true,
  fogPct: true,
  humidityPct: true,
  windSpeedMs: true,
  windDirRad: true,
  solarAltitudeRad: true,
  solarAzimuthRad: true,
  skies: true
}

export const ALL_FIELDS: readonly Field[] = Object.keys(ALL_FIELD_FLAGS) as Field[]

function fieldSet(fields: readonly Field[]): ReadonlySet<Field> {
  return new Set(fields)
}

// ─── iRacing ─────────────────────────────────────────────────────────────────
// The broadest provider: standings (drivers[]), relatives, radar, deltas, BoP,
// hybrid/ERS, weather, incidents, pit service, position/orientation, etc. This is
// the actual snapshot mapping minus `engineRunning` (iRacing has no reliable
// ignition var — the flip-cover derives "engine running" from an rpm proxy).
//
// TYRE PRESSURE NUANCE: iRacing exposes the `tyres` field (carcass/surface temps +
// wear), but it has NO LIVE (hot) tyre pressure telemetry. The `tyres[*].pressureKpa`
// it reports is the GARAGE COLD pressure, also surfaced via `tireColdPressuresKpa`.
// So iRacing covers `tyres` and `tireColdPressuresKpa`, but its pressure is COLD,
// unlike ACC/LMU which publish live hot pressure. (see provider.ts tyreTemps()).
const IRACING_FIELDS: readonly Field[] = [
  'sim', 'connected', 'timestamp',
  'speedKmh', 'rpm', 'gear', 'maxRpm', 'shiftIndicatorPct', 'shiftRpm', 'revLights',
  'throttle', 'brake', 'clutch', 'steerAngleDeg',
  'latAccelG', 'longAccelG', 'vertAccelG', 'yawRateRadSec',
  'drs', 'absActive', 'absEnabled', 'absLevel', 'absCutPct', 'engineWarnings',
  'tcActive', 'tcEnabled', 'tcLevel',
  'engineMap', 'brakeBiasPct', 'handbrake',
  'waterTempC', 'oilTempC', 'oilPressureKpa',
  'ersBatteryPct', 'pushToPass', 'pushToPassCount',
  'sessionType', 'sessionState', 'paceMode', 'paceFlags', 'carName', 'carPath', 'trackName', 'trackConfigName',
  'sessionTimeRemainingSec', 'lapsRemaining', 'currentLap', 'lapDistPct',
  'lastLapTimeSec', 'bestLapTimeSec', 'currentLapTimeSec', 'estimatedLapTimeSec',
  'deltaToBestSec', 'deltaToSessionBestSec',
  'position', 'classPosition', 'totalCars', 'strengthOfField',
  'sessionUniqueId', 'driverName', 'sessionTimeOfDay', 'weightPenaltyKg', 'powerAdjustPct',
  'fuelLiters', 'fuelPerLap', 'fuelUsePerHourKg', 'fuelPerLapKg', 'fuelCapacityLiters',
  'tyres', 'brakeTempC', 'tireColdPressuresKpa',
  'flags', 'sessionFlagsRaw', 'pitLimiter', 'onPitRoad', 'pitServiceFlags', 'pit',
  'incidentCount', 'incidentCountMy', 'incidentCountTeam', 'incidentLimit',
  'fastRepairsUsed', 'fastRepairsAvailable',
  'trackTempC', 'airTempC', 'trackWetnessPct', 'isRaining', 'gripPct',
  'weatherDeclaredWet', 'trackSurfaceMaterial',
  'playerCarIdx', 'drivers', 'relatives', 'radarCars', 'carLeftRight', 'carLeftRightRaw', 'carLeftRightCount',
  'lat', 'lon', 'velocityX', 'velocityY', 'yawNorth',
  'steeringTorquePct', 'steeringAngleMaxDeg',
  'pitchRad', 'rollRad', 'yawRad', 'pitchRateRadSec', 'rollRateRadSec', 'altitudeM',
  'manifoldPressBar', 'fuelPressBar', 'voltage', 'waterLevelL', 'oilLevelL',
  'fuelLevelPct', 'brakeLinePressBar',
  'deltaToOptimalSec', 'deltaToSessionOptimalSec', 'deltaToDriverBestSec',
  'fogPct', 'humidityPct', 'windSpeedMs', 'windDirRad', 'solarAltitudeRad', 'solarAzimuthRad', 'skies'
]

// ─── ACC ─────────────────────────────────────────────────────────────────────
// Core car + timing + single-car `position` + fuel + LIVE tyres (hot pressure from
// wheelsPressure + core temp) + weather (air/track temp, rain). Has on/off abs/tc
// flags but no levels, and NO standings array / deltas / cold pressures.
const ACC_FIELDS: readonly Field[] = [
  'sim', 'connected', 'timestamp',
  'speedKmh', 'rpm', 'gear', 'maxRpm',
  'throttle', 'brake', 'clutch', 'steerAngleDeg',
  'absActive', 'tcActive',
  'sessionType', 'carName', 'trackName', 'sessionTimeRemainingSec',
  'currentLap', 'lapDistPct', 'lastLapTimeSec', 'bestLapTimeSec', 'currentLapTimeSec',
  'position',
  'fuelLiters', 'fuelCapacityLiters',
  'tyres',
  'airTempC', 'trackTempC', 'isRaining', 'trackWetnessPct'
]

// ─── AC (Assetto Corsa) ──────────────────────────────────────────────────────
// More limited than ACC: core car + timing + `position` + `totalCars` + fuel.
// Its poll() does NOT map tyres, weather, or abs/tc (despite the struct carrying
// some of that data) — so coverage excludes them.
const AC_FIELDS: readonly Field[] = [
  'sim', 'connected', 'timestamp',
  'speedKmh', 'rpm', 'gear', 'maxRpm',
  'throttle', 'brake', 'clutch', 'steerAngleDeg',
  'sessionType', 'carName', 'trackName', 'sessionTimeRemainingSec',
  'currentLap', 'lapDistPct', 'lastLapTimeSec', 'bestLapTimeSec', 'currentLapTimeSec',
  'position', 'totalCars',
  'fuelLiters', 'fuelCapacityLiters'
]

// ─── AMS2 (Automobilista 2 / PCARS2 layout) ──────────────────────────────────
// Core car + timing + `position` + fuel. Like AC but without `totalCars`, and its
// poll() likewise does NOT map tyres/weather/oil-water temps (the PCARS2 struct has
// them, but they are not surfaced in the snapshot today).
const AMS2_FIELDS: readonly Field[] = [
  'sim', 'connected', 'timestamp',
  'speedKmh', 'rpm', 'gear', 'maxRpm',
  'throttle', 'brake', 'clutch', 'steerAngleDeg',
  'sessionType', 'carName', 'trackName', 'sessionTimeRemainingSec',
  'currentLap', 'lapDistPct', 'lastLapTimeSec', 'bestLapTimeSec', 'currentLapTimeSec',
  'position',
  'fuelLiters', 'fuelCapacityLiters'
]

// ─── LMU (Le Mans Ultimate, rFactor2-based) ──────────────────────────────────
// Planned provider. CORE set per the rF2 shared-memory plan: car + LIVE tyres (hot
// pressure + temp), water/oil temp + oil pressure, single-car position, timing,
// weather (air/track temp) and flags. No standings array / deltas / radar yet.
const LMU_FIELDS: readonly Field[] = [
  'connected', 'sim', 'timestamp',
  'speedKmh', 'rpm', 'gear', 'maxRpm',
  'throttle', 'brake', 'clutch', 'steerAngleDeg',
  'fuelLiters', 'waterTempC', 'oilTempC',
  'tyres',
  'position', 'currentLap', 'lapDistPct',
  'lastLapTimeSec', 'bestLapTimeSec', 'currentLapTimeSec',
  'sessionType', 'sessionTimeRemainingSec',
  'airTempC', 'trackTempC', 'isRaining', 'trackWetnessPct',
  'flags', 'sessionFlagsRaw'
]

// ─── Replay ──────────────────────────────────────────────────────────────────
// A replay feeds back whatever was recorded; we model it as a MINIMAL guaranteed
// core (the fields every provider always sets) so coverage never over-claims. Replay
// is not a live sim and is excluded from PLAYABLE_SIMS.
const REPLAY_FIELDS: readonly Field[] = [
  'sim', 'connected', 'timestamp',
  'speedKmh', 'rpm', 'gear',
  'throttle', 'brake', 'clutch',
  'currentLap', 'lapDistPct', 'position'
]

/**
 * The set of `TelemetrySnapshot` fields each sim populates LIVE in its provider's
 * `poll()`. `mock` is treated as FULL (every field) for development; `none` is empty;
 * `replay` is a minimal recorded-core. Keyed by {@link CoverageSimId} so the planned
 * `lmu` provider is covered without editing the canonical `SimId` union.
 */
export const SIM_FIELD_COVERAGE: Record<CoverageSimId, ReadonlySet<Field>> = {
  iracing: fieldSet(IRACING_FIELDS),
  acc: fieldSet(ACC_FIELDS),
  ac: fieldSet(AC_FIELDS),
  ams2: fieldSet(AMS2_FIELDS),
  lmu: fieldSet(LMU_FIELDS),
  mock: fieldSet(ALL_FIELDS),
  replay: fieldSet(REPLAY_FIELDS),
  none: fieldSet([])
}

/** Real, drivable sims used by the widget sim-filter (order is the display order). */
export const PLAYABLE_SIMS: CoverageSimId[] = ['iracing', 'acc', 'ac', 'ams2', 'lmu']

const SIM_LABELS: Record<CoverageSimId, string> = {
  iracing: 'IR',
  acc: 'ACC',
  ac: 'AC',
  ams2: 'AMS2',
  lmu: 'LMU',
  mock: 'MOCK',
  // `replay`/`none` have no live-sim badge.
  replay: '—',
  none: '—'
}

/** Short badge label for a sim (e.g. 'IR', 'ACC', 'LMU'); '—' for replay/none. */
export function simLabel(sim: CoverageSimId): string {
  return SIM_LABELS[sim] ?? '—'
}

/**
 * The PLAYABLE_SIMS whose live coverage is a SUPERSET of `requires`.
 * - no/empty `requires` → every playable sim (a widget that needs nothing works on all).
 * - `requires` containing a field no playable sim publishes → `[]`.
 * Mock/replay/none are intentionally excluded (only real sims are returned).
 */
export function widgetSupportedSims(requires: readonly Field[] | undefined): CoverageSimId[] {
  if (!requires || requires.length === 0) return [...PLAYABLE_SIMS]
  return PLAYABLE_SIMS.filter((sim) => {
    const coverage = SIM_FIELD_COVERAGE[sim]
    return requires.every((field) => coverage.has(field))
  })
}

/**
 * A concise sim-support badge prefix built from {@link widgetSupportedSims}, e.g.
 * `"(IR/ACC/LMU) "`. Design choices (documented):
 * - supported by ALL playable sims (incl. no `requires`) → `""` — universal widgets
 *   carry no badge to avoid noise.
 * - supported by a SUBSET → `"(LBL/LBL/…) "` in PLAYABLE_SIMS order, trailing space so
 *   it prepends cleanly to a widget title.
 * - supported by NO playable sim → `"(—) "` to flag "no live sim provides this".
 */
export function simSupportPrefix(requires: readonly Field[] | undefined): string {
  const supported = widgetSupportedSims(requires)
  if (supported.length === PLAYABLE_SIMS.length) return ''
  if (supported.length === 0) return '(—) '
  return `(${supported.map(simLabel).join('/')}) `
}
