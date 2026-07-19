import type { Corners, DriverEntry, Flags, IRacingDiagnostics, IRacingMmfDiagnostics, PitStatus, RelativeCarEntry, TelemetrySnapshot } from '../../shared/telemetry'
import { carLeftRightStateFromEnum, carLeftRightCountFromEnum, drsStateFromRaw, engineWarningsFromBitfield, sessionStateLabel, paceModeLabel, paceFlagsList, deriveTcActive, tcOptionsForSensitivity, tcLatchTimingsForSensitivity, TcLatch, TC_ACTIVE_DERIVED, type TcSensitivity } from '../../shared/telemetry'
import { ReplayContextTracker } from '../../shared/replay'
import { FuelLapEstimator } from '../../shared/fuel'
import { inHgToKpa, mss2ToG } from '../../shared/units'
import { FALLBACK_SHIFT_BLINK_PCT, redlineBandPct } from '../../shared/revlights'
import { IRacingMemoryMap } from './irsdk-mmf'
import { logger } from '../modules/logger'
import type { TelemetryProvider } from '../telemetry/provider'

type AnyRecord = Record<string, any>

type DriverStaticEntry = Pick<
  DriverEntry,
  | 'carIdx'
  | 'name'
  | 'carNumber'
  | 'classId'
  | 'className'
  | 'classColor'
  | 'iRating'
  | 'license'
  | 'safetyRating'
  | 'custId'
  | 'teamId'
  | 'teamName'
  | 'carPath'
  | 'carNumberRaw'
  | 'isPaceCar'
> & {
  fallbackPosition: number
  fallbackClassPosition: number
}

type DriverCarShiftLights = {
  firstRpm?: number
  shiftRpm?: number
  lastRpm?: number
  blinkRpm?: number
}

type DriverCarSetup = DriverCarShiftLights & {
  redlineRpm?: number
  fuelCapacityLiters?: number
}

const IRACING_FLAG_BITS = {
  checkered: 0x00000001,
  white: 0x00000002,
  green: 0x00000004,
  yellow: 0x00000008,
  red: 0x00000010,
  blue: 0x00000020,
  // Local/sector WAVED yellow — the common road-course yellow. Distinct from the
  // (rare) static `yellow` bit; without this a local yellow was never detected.
  yellowWaving: 0x00000100,
  // Green flag HELD up at a restart — folded into `green` so a restart green is
  // detected like a standing-start green.
  greenHeld: 0x00000400,
  caution: 0x00004000,
  cautionWaving: 0x00008000,
  black: 0x00010000,
  disqualify: 0x00020000,
  repair: 0x00100000,
  greenWhiteCheckered: 0x00000000 // irsdk não tem bit direto de GWC (0x400 = greenHeld) — manter false
} as const

const PIT_SERVICE_BITS: Array<[number, string]> = [
  [0x01, 'lf'],
  [0x02, 'rf'],
  [0x04, 'lr'],
  [0x08, 'rr'],
  [0x10, 'fuel'],
  [0x20, 'windshield'],
  [0x40, 'fastRepair']
]

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function optionalNum(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function optionalInt(value: unknown): number | undefined {
  const n = optionalNum(value)
  return n !== undefined ? Math.trunc(n) : undefined
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function optionalSetting(value: unknown): number | string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) return value.trim()
  return undefined
}

function firstDefined(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null)
}

function bool(value: unknown): boolean {
  return value === true || value === 1
}

function optionalBool(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'number' && Number.isFinite(value)) return value !== 0
  return bool(value)
}

function arr<T = any>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : []
}

function pct(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.max(0, Math.min(1, value))
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function positiveNum(value: unknown): number | undefined {
  const n = optionalNum(value)
  return n !== undefined && n > 0 ? n : undefined
}

function normalizePctValue(value: unknown): number | undefined {
  const n = optionalNum(value)
  if (n === undefined) return undefined
  if (Math.abs(n) <= 1) return n * 100
  return n
}

function oilPressureKpa(value: unknown): number | undefined {
  const n = optionalNum(value)
  if (n === undefined) return undefined
  return n < 30 ? n * 100 : n
}

function iracingTrackWetnessPct(value: unknown): number | undefined {
  const n = optionalNum(value)
  if (n === undefined) return undefined
  const wetness = Math.trunc(n)
  if (wetness <= 1) return 0
  return Math.max(0, Math.min(1, (wetness - 1) / 6))
}

function celsius(value: unknown): number | undefined {
  const n = num(value, Number.NaN)
  return Number.isFinite(n) ? n : undefined
}

function toDeg(value: unknown): number | undefined {
  const n = optionalNum(value)
  return n === undefined ? undefined : n * (180 / Math.PI)
}

function corners(values: AnyRecord, names: [string, string, string, string]): Corners<number> | undefined {
  const [lf, rf, lr, rr] = names.map((name) => celsius(values[name]))
  if ([lf, rf, lr, rr].every((value) => value === undefined)) return undefined
  return { lf: lf ?? 0, rf: rf ?? 0, lr: lr ?? 0, rr: rr ?? 0 }
}

// iRacing does NOT expose live tyre pressure as telemetry — only the COLD pressures set
// in the garage (LFcoldPressure/RFcoldPressure/LRcoldPressure/RRcoldPressure, kPa). Build a
// Corners<number> from them; undefined when none are present so the field stays clean.
function coldPressures(values: AnyRecord): Corners<number> | undefined {
  const lf = optionalNum(values.LFcoldPressure)
  const rf = optionalNum(values.RFcoldPressure)
  const lr = optionalNum(values.LRcoldPressure)
  const rr = optionalNum(values.RRcoldPressure)
  if ([lf, rf, lr, rr].every((value) => value === undefined)) return undefined
  return { lf: lf ?? 0, rf: rf ?? 0, lr: lr ?? 0, rr: rr ?? 0 }
}

function tyreTemps(values: AnyRecord): TelemetrySnapshot['tyres'] | undefined {
  const carcass = [
    [values.LFtempCL, values.LFtempCM, values.LFtempCR],
    [values.RFtempCL, values.RFtempCM, values.RFtempCR],
    [values.LRtempCL, values.LRtempCM, values.LRtempCR],
    [values.RRtempCL, values.RRtempCM, values.RRtempCR]
  ].map((corner) => corner.map(celsius))
  const surface = [
    [values.LFtempL, values.LFtempM, values.LFtempR],
    [values.RFtempL, values.RFtempM, values.RFtempR],
    [values.LRtempL, values.LRtempM, values.LRtempR],
    [values.RRtempL, values.RRtempM, values.RRtempR]
  ].map((corner) => corner.map(celsius))
  const wear = [
    [values.LFwearL, values.LFwearM, values.LFwearR],
    [values.RFwearL, values.RFwearM, values.RFwearR],
    [values.LRwearL, values.LRwearM, values.LRwearR],
    [values.RRwearL, values.RRwearM, values.RRwearR]
  ].map((corner) => corner.map(optionalNum))
  const allTemps = [...carcass.flat(), ...surface.flat()]
  if ([...allTemps, ...wear.flat()].every((value) => value === undefined)) return undefined
  const info = (index: number) => ({
    // Prefer the carcass temp; fall back to the surface temp so a car/session that only
    // reports one of the two still shows a tyre temperature instead of "—".
    tempC: carcass[index][1] ?? surface[index][1],
    tempLeftC: carcass[index][0] ?? surface[index][0],
    tempMiddleC: carcass[index][1] ?? surface[index][1],
    tempRightC: carcass[index][2] ?? surface[index][2],
    surfaceTempLeftC: surface[index][0],
    surfaceTempMiddleC: surface[index][1],
    surfaceTempRightC: surface[index][2],
    wearPct: wear[index][1] ?? wear[index][0] ?? wear[index][2],
    wearLeftPct: wear[index][0],
    wearMiddlePct: wear[index][1],
    wearRightPct: wear[index][2]
  })
  return {
    lf: info(0),
    rf: info(1),
    lr: info(2),
    rr: info(3)
  }
}

function flags(bitmask: unknown): Flags {
  const raw = num(bitmask, 0)
  const yellow = (raw & IRACING_FLAG_BITS.yellow) !== 0 || (raw & IRACING_FLAG_BITS.yellowWaving) !== 0 || (raw & IRACING_FLAG_BITS.caution) !== 0 || (raw & IRACING_FLAG_BITS.cautionWaving) !== 0
  const black = (raw & IRACING_FLAG_BITS.black) !== 0
  const repair = (raw & IRACING_FLAG_BITS.repair) !== 0
  return {
    green: (raw & IRACING_FLAG_BITS.green) !== 0 || (raw & IRACING_FLAG_BITS.greenHeld) !== 0,
    yellow,
    blue: (raw & IRACING_FLAG_BITS.blue) !== 0,
    white: (raw & IRACING_FLAG_BITS.white) !== 0,
    checkered: (raw & IRACING_FLAG_BITS.checkered) !== 0,
    red: (raw & IRACING_FLAG_BITS.red) !== 0,
    black,
    meatball: repair,
    repair,
    disqualify: (raw & IRACING_FLAG_BITS.disqualify) !== 0,
    greenWhiteCheckered: (raw & IRACING_FLAG_BITS.greenWhiteCheckered) !== 0
  }
}

function pitServiceFlags(bitmask: unknown): string[] | undefined {
  const raw = num(bitmask, 0)
  const selected = PIT_SERVICE_BITS.filter(([bit]) => (raw & bit) !== 0).map(([, name]) => name)
  return selected.length ? selected : undefined
}

// iRacing pit status. There is NO boolean "repair needed" var, so repairNeeded /
// optRepairNeeded are DERIVED from the repair-time-left vars (PitRepairLeft /
// PitOptRepairLeft, seconds): > 0 means repairs are pending. pitsOpen / inPitStall are
// real bools (PitsOpen / PlayerCarInPitStall); svStatus is the raw irsdk_PitSvStatus enum
// int (PlayerCarPitSvStatus). Returns undefined when iRacing exposes none of the pit vars
// (older builds/replays) so the optional snapshot field stays clean.
function pitStatus(values: AnyRecord): PitStatus | undefined {
  const repairLeft = optionalNum(values.PitRepairLeft)
  const optRepairLeft = optionalNum(values.PitOptRepairLeft)
  const pitsOpen = optionalBool(values.PitsOpen)
  const inPitStall = optionalBool(values.PlayerCarInPitStall)
  const svStatus = optionalInt(values.PlayerCarPitSvStatus)
  if (repairLeft === undefined && optRepairLeft === undefined && pitsOpen === undefined && inPitStall === undefined && svStatus === undefined) {
    return undefined
  }
  return {
    repairNeeded: (repairLeft ?? 0) > 0,
    optRepairNeeded: (optRepairLeft ?? 0) > 0,
    pitsOpen: pitsOpen ?? false,
    inPitStall: inPitStall ?? false,
    svStatus
  }
}

function sessionValue(sessionInfo: any, path: Array<string | number>): any {
  let current = sessionInfo
  for (const key of path) current = current?.[key]
  return current
}

function normalizeHexColor(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const text = String(value).trim().replace(/^0x/i, '').replace(/^#/, '')
  if (!/^[0-9a-f]{6}$/i.test(text)) return undefined
  return `#${text.toUpperCase()}`
}

function buildDriverStatic(sessionInfo: any): DriverStaticEntry[] | undefined {
  const driversRaw = sessionValue(sessionInfo, ['DriverInfo', 'Drivers'])
  if (!Array.isArray(driversRaw)) return undefined
  const resultPositions = resultPositionMaps(sessionInfo)

  return driversRaw.map((driver: AnyRecord, index: number): DriverStaticEntry => {
    const carIdx = Math.trunc(num(driver.CarIdx, index))
    const result = resultPositions.get(carIdx)
    return {
      carIdx,
      name: String(driver.UserName ?? driver.Name ?? `Car ${carIdx}`),
      carNumber: String(driver.CarNumber ?? driver.CarNumberRaw ?? ''),
      classId: Math.trunc(num(driver.CarClassID ?? driver.CarClassId, 0)),
      className: driver.CarClassShortName ?? driver.CarClassName,
      classColor: normalizeHexColor(driver.CarClassColor),
      iRating: Math.trunc(num(driver.IRating, 0)) || undefined,
      license: driver.LicString,
      safetyRating: typeof driver.LicString === 'string' ? Number.parseFloat(driver.LicString.match(/\d+(?:\.\d+)?/)?.[0] ?? '') || undefined : undefined,
      custId: Math.trunc(num(driver.UserID, 0)) || undefined,
      teamId: Math.trunc(num(driver.TeamID, 0)) || undefined,
      teamName: typeof driver.TeamName === 'string' && driver.TeamName ? driver.TeamName : undefined,
      carPath: typeof driver.CarPath === 'string' && driver.CarPath ? driver.CarPath : undefined,
      carNumberRaw: optionalNum(driver.CarNumberRaw),
      isPaceCar: optionalBool(driver.CarIsPaceCar),
      fallbackPosition: result?.position ?? num(driver.CarIdxPosition, 0),
      fallbackClassPosition: result?.classPosition ?? num(driver.CarIdxClassPosition, 0)
    }
  })
}

function resultPositionMaps(sessionInfo: any): Map<number, { position: number; classPosition: number }> {
  const rows: AnyRecord[] = []
  const sessions = sessionValue(sessionInfo, ['SessionInfo', 'Sessions'])
  if (Array.isArray(sessions)) {
    for (const session of sessions) {
      if (Array.isArray(session?.ResultsPositions)) rows.push(...session.ResultsPositions)
    }
  }
  const qualify = sessionValue(sessionInfo, ['QualifyResultsInfo', 'Results'])
  if (Array.isArray(qualify)) rows.push(...qualify)

  const out = new Map<number, { position: number; classPosition: number }>()
  for (const row of rows) {
    const carIdx = Math.trunc(num(row.CarIdx, -1))
    if (carIdx < 0) continue
    const position = Math.trunc(num(row.Position ?? row.FastestTimePosition, 0))
    const classPosition = Math.trunc(num(row.ClassPosition ?? row.CarClassPosition, position))
    if (position > 0 || classPosition > 0) out.set(carIdx, { position, classPosition })
  }
  return out
}

function driverCarSetup(sessionInfo: any): DriverCarSetup {
  const driverInfo = sessionValue(sessionInfo, ['DriverInfo'])
  return {
    firstRpm: optionalNum(driverInfo?.DriverCarSLFirstRPM),
    shiftRpm: optionalNum(driverInfo?.DriverCarSLShiftRPM),
    lastRpm: optionalNum(driverInfo?.DriverCarSLLastRPM),
    blinkRpm: optionalNum(driverInfo?.DriverCarSLBlinkRPM),
    redlineRpm: positiveNum(driverInfo?.DriverCarRedLine),
    fuelCapacityLiters: optionalNum(driverInfo?.DriverCarFuelMaxLtr)
  }
}

// The player's own driver row from the session YAML (DriverInfo.Drivers[DriverCarIdx]).
// The root DriverInfo.DriverCar* fields can be empty in some sessions, so anything that
// needs a reliable car identity (carName, carPath) reads from this row first.
function playerDriverRow(sessionInfo: any): AnyRecord | undefined {
  const idx = Math.trunc(num(sessionValue(sessionInfo, ['DriverInfo', 'DriverCarIdx']), -1))
  const drivers = sessionValue(sessionInfo, ['DriverInfo', 'Drivers'])
  if (Array.isArray(drivers)) {
    return drivers.find((d: AnyRecord) => Math.trunc(num(d?.CarIdx, -1)) === idx)
  }
  return undefined
}

// Player car's CarPath from the session YAML (e.g. "ferrari296gt3"). Used by the
// per-session diagnostic AND as the STABLE soundshift per-car key (it never drifts with
// the UI language the way the localized display name does).
function playerCarPath(sessionInfo: any): string | undefined {
  return optionalString(playerDriverRow(sessionInfo)?.CarPath)
}

// Robust display name for the player's car. Reads the player driver row first
// (CarScreenName → CarScreenNameShort → CarName → CarPath) because the root
// DriverInfo.DriverCarScreenName/DriverCarName can be empty; only then falls back to
// those root fields. This is what fixes the soundshift carKey:"unknown" P1.
function playerCarName(sessionInfo: any): string | undefined {
  const player = playerDriverRow(sessionInfo)
  return (
    optionalString(player?.CarScreenName) ??
    optionalString(player?.CarScreenNameShort) ??
    optionalString(player?.CarName) ??
    optionalString(player?.CarPath) ??
    optionalString(sessionValue(sessionInfo, ['DriverInfo', 'DriverCarScreenName'])) ??
    optionalString(sessionValue(sessionInfo, ['DriverInfo', 'DriverCarName']))
  )
}

// Parse WeekendInfo.TrackLength (e.g. "5.89 km") into a number of kilometres.
function trackLengthKm(sessionInfo: any): number | undefined {
  const raw = sessionValue(sessionInfo, ['WeekendInfo', 'TrackLength'])
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string') {
    const n = Number.parseFloat(raw)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

// CAR-frame velocity the track-map learner integrates (rotated by YawNorth into a world
// path). iRacing's canonical vars are VelocityX (forward) / VelocityY (lateral). Some
// builds report them NULL for an entire session even while YawNorth is present — the
// learner then has no acquisition mode and the map never learns. Fall back to a
// forward-only velocity from ground speed (vx = Speed, vy = 0; lateral slip is negligible
// for a track OUTLINE) so the learner can dead-reckon a path from speed + heading. Only a
// fallback: when the real VelocityX exists it (and the real VelocityY) win.
function deriveCarVelocity(
  rawVelocityX: number | undefined,
  rawVelocityY: number | undefined,
  speedMs: number | undefined,
  yawNorth: number | undefined,
  hasLatLon: boolean
): { velocityX: number | undefined; velocityY: number | undefined } {
  if (rawVelocityX !== undefined) return { velocityX: rawVelocityX, velocityY: rawVelocityY }
  // Dead-reckon a forward-only velocity from Speed+YawNorth ONLY as a last resort —
  // when the sim exposes neither raw velocity NOR usable geographic position. If valid
  // lat/lon exist, leave velocity undefined so the learner picks its more accurate
  // lat-lon acquisition instead of a slip-ignoring dead-reckoned path.
  if (!hasLatLon && yawNorth !== undefined && speedMs !== undefined) return { velocityX: speedMs, velocityY: 0 }
  return { velocityX: undefined, velocityY: undefined }
}

// True when lat/lon are finite AND not the (0,0) "car not placed yet" sentinel — mirrors
// the learner's own hasValidLatLon so we don't demote real position to dead reckoning.
function hasUsableLatLon(lat: number | undefined, lon: number | undefined): boolean {
  return lat !== undefined && lon !== undefined && Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0)
}

// Canonical iRacing shift-light model. iRacing exposes four per-car RPMs:
//   DriverCarSLFirstRPM  → the first shift light turns on
//   DriverCarSLShiftRPM  → authoritative shift-now RPM
//   DriverCarSLLastRPM   → every shift light is on
//   DriverCarSLBlinkRPM  → the native lights' later blink point
// …plus the LIVE telemetry var ShiftIndicatorPct (0..1), iRacing's OWN per-car
// shift-light fill. CONFIRMED: ShiftIndicatorPct only reaches 1.0 at SLLastRPM (all
// lights on = at the limiter), which is TOO LATE for cars whose SLShiftRPM < SLLastRPM
// — the lights fill to the limiter instead of the raw SDK upshift. First→Shift reaches
// FULL at DriverCarSLShiftRPM while the fill stays DARK below SLFirstRPM.
//
// Priority for the 0..1 fill (so every car's lights reach full at its own optimal
// shift point):
//   1. Raw per-car band (first→shift). Reaches 1.0 at DriverCarSLShiftRPM.
//   2. LIVE ShiftIndicatorPct — only when no SL band exists (car doesn't publish
//      First/Shift). Mirrors the sim, but fills to the limiter (SLLast); it's all we
//      have for those cars. Still 0 below the first light.
//   3. Redline-relative top-slice band (redlineBandPct) — last resort, still never
//      a 0..maxRpm proportional fill.
type ShiftSource = 'iracing-live' | 'sl-band' | 'redline' | 'none'
type ShiftBand = { pct: number | undefined; blink: boolean | undefined; source: ShiftSource }

function shiftBand(rpm: number, setup: DriverCarShiftLights, redlineRpm?: number, iracingShiftPct?: number): ShiftBand {
  const first = setup.firstRpm
  // `setup.shiftRpm` is the raw DriverCarSLShiftRPM upshift target.
  const shift = setup.shiftRpm
  // Deterministic per-car SL band from the session YAML, anchored First→Shift. Require
  // first > 0 (a car reporting SLFirstRPM=0 would otherwise make the band start at idle,
  // a 0-based proportional fill that glows at low RPM) and shift > first.
  const slPct = first !== undefined && first > 0 && shift !== undefined && shift > first
    ? clamp01((rpm - first) / (shift - first))
    : undefined
  let pctValue: number | undefined
  let source: ShiftSource = 'none'
  if (slPct !== undefined) {
    // PRIMARY: the raw SDK band reaches 1.0 at the actual shift-now target.
    pctValue = slPct
    source = 'sl-band'
  } else if (iracingShiftPct !== undefined && iracingShiftPct > 0) {
    // No usable SL band (this car doesn't publish SLFirst/SLShift) → mirror the sim's
    // own ShiftIndicatorPct. It fills to the limiter (SLLast), but it's all we have.
    pctValue = clamp01(iracingShiftPct)
    source = 'iracing-live'
  } else if (redlineRpm !== undefined && redlineRpm > 0) {
    pctValue = redlineBandPct(rpm, redlineRpm)
    source = 'redline'
  }

  // The live ShiftIndicatorPct path (cars without an SL band) can cap BELOW 1.0 even at
  // the limiter. Once RPM reaches the genuine per-car over-rev point (blink ≈ last),
  // force the fill to FULL so shift-now consumers using their configured pct threshold
  // (iFlag, soundshift, overlays) still fire. Note: the spotter uses its own hardcoded
  // SHIFT_PCT threshold and is not wired to AlertsConfig.shiftPoint.shiftIndicatorPct.
  // This clamps only the TOP at a real per-car RPM — it never widens the band at idle, so
  // it cannot reintroduce the rpm/maxRpm idle-glow. (The SL band already reaches 1.0 at
  // SLShiftRPM, so this only matters for the live fallback.)
  if (source === 'iracing-live' && pctValue !== undefined && pctValue < 1) {
    const topRpm = setup.blinkRpm ?? setup.lastRpm ?? setup.shiftRpm
    if (topRpm !== undefined && rpm >= topRpm) pctValue = 1
  }

  // Blink = the "shift NOW" cue at raw DriverCarSLShiftRPM. SLBlink remains an
  // overdue warning/fallback, not the default optimum.
  const shiftNowRpm = setup.shiftRpm ?? setup.blinkRpm ?? setup.lastRpm
  const blink = shiftNowRpm !== undefined
    ? rpm >= shiftNowRpm
    : pctValue !== undefined ? pctValue >= FALLBACK_SHIFT_BLINK_PCT : undefined

  return { pct: pctValue, blink, source }
}

function revLights(rpm: number, setup: DriverCarShiftLights, redlineRpm?: number, iracingShiftPct?: number): TelemetrySnapshot['revLights'] | undefined {
  const band = shiftBand(rpm, setup, redlineRpm, iracingShiftPct)
  const hasMeta = setup.firstRpm !== undefined || setup.shiftRpm !== undefined || setup.lastRpm !== undefined || setup.blinkRpm !== undefined
  if (!hasMeta && band.pct === undefined) return undefined
  return {
    firstRpm: setup.firstRpm,
    shiftRpm: setup.shiftRpm,
    lastRpm: setup.lastRpm,
    blinkRpm: setup.blinkRpm,
    pct: band.pct,
    blink: band.blink
  }
}

function shortestCircularGapSec(rawGapSec: number, lapTimeSec: number): number {
  const lap = lapTimeSec > 1 ? lapTimeSec : 90
  return ((((rawGapSec + lap / 2) % lap) + lap) % lap) - lap / 2
}

function playerRelativeGapSec(carIdx: number, playerCarIdx: number, values: AnyRecord, lapDist: number[], laps: number[]): number {
  const estTimes = arr<number>(values.CarIdxEstTime)
  const lapTimeSec = positiveNum(values.LapLastNLapTime) ?? positiveNum(values.LapLastLapTime) ?? positiveNum(values.LapBestLapTime) ?? 90
  const driverEst = optionalNum(estTimes[carIdx])
  const playerEst = optionalNum(estTimes[playerCarIdx])
  if (driverEst !== undefined && driverEst >= 0 && playerEst !== undefined && playerEst >= 0) return shortestCircularGapSec(driverEst - playerEst, lapTimeSec)

  const f2Times = arr<number>(values.CarIdxF2Time)
  const driverF2 = optionalNum(f2Times[carIdx])
  const playerF2 = optionalNum(f2Times[playerCarIdx])
  if (driverF2 !== undefined && driverF2 >= 0 && playerF2 !== undefined && playerF2 >= 0) return playerF2 - driverF2

  const driverLap = num(laps[carIdx], 0)
  const playerLap = num(laps[playerCarIdx], 0)
  const driverDist = pct(lapDist[carIdx]) ?? 0
  const playerDist = pct(lapDist[playerCarIdx]) ?? 0
  return shortestCircularGapSec((driverLap - playerLap + driverDist - playerDist) * lapTimeSec, lapTimeSec)
}

function parseDrivers(sessionInfo: any, values: AnyRecord, staticDrivers: DriverStaticEntry[] | undefined): DriverEntry[] | undefined {
  if (!staticDrivers) return undefined
  const playerCarIdx = Math.trunc(num(values.PlayerCarIdx ?? sessionValue(sessionInfo, ['DriverInfo', 'DriverCarIdx']), -1))
  const positions = arr<number>(values.CarIdxPosition)
  const classPositions = arr<number>(values.CarIdxClassPosition)
  const lapDist = arr<number>(values.CarIdxLapDistPct)
  const laps = arr<number>(values.CarIdxLap)
  const completedLaps = arr<number>(values.CarIdxLapCompleted)
  const estimatedTimes = arr<number>(values.CarIdxEstTime)
  const lastLapTimes = arr<number>(values.CarIdxLastLapTime)
  const bestLapTimes = arr<number>(values.CarIdxBestLapTime)
  const bestLapNums = arr<number>(values.CarIdxBestLapNum)
  const gears = arr<number>(values.CarIdxGear)
  const rpms = arr<number>(values.CarIdxRPM)
  const pitRoad = arr<boolean | number>(values.CarIdxOnPitRoad)
  const trackLocations = arr<number>(values.CarIdxTrackSurface)
  const trackMaterials = arr<number>(values.CarIdxTrackSurfaceMaterial)
  const pushToPassStatus = arr<boolean | number>(values.CarIdxP2P_Status)
  const pushToPassCounts = arr<number>(values.CarIdxP2P_Count)
  const carPaceFlags = arr<number>(values.CarIdxPaceFlags)
  const paceLines = arr<number>(values.CarIdxPaceLine)
  const paceRows = arr<number>(values.CarIdxPaceRow)
  const playerLap = num(laps[playerCarIdx], 0)

  return staticDrivers.map((driver): DriverEntry => {
    const { fallbackPosition, fallbackClassPosition, ...identity } = driver
    const carIdx = identity.carIdx
    const driverLap = num(laps[carIdx], 0)
    const relativeLaps = driverLap - playerLap
    const relativeTimeSec = playerRelativeGapSec(carIdx, playerCarIdx, values, lapDist, laps)
    return {
      ...identity,
      position: Math.trunc(num(positions[carIdx], 0)) || fallbackPosition,
      classPosition: Math.trunc(num(classPositions[carIdx], 0)) || fallbackClassPosition,
      gapToPlayerSec: relativeTimeSec,
      lapDistPct: pct(lapDist[carIdx]),
      lastLapTimeSec: optionalNum(lastLapTimes[carIdx]),
      lapsBehind: relativeLaps < 0 ? Math.abs(relativeLaps) : undefined,
      isPlayer: carIdx === playerCarIdx,
      inPits: optionalBool(pitRoad[carIdx]),
      lap: optionalInt(laps[carIdx]),
      completedLaps: optionalInt(completedLaps[carIdx]),
      estimatedTimeSec: optionalNum(estimatedTimes[carIdx]),
      relativeTimeSec,
      gear: optionalInt(gears[carIdx]),
      rpm: optionalNum(rpms[carIdx]),
      trackLocation: optionalInt(trackLocations[carIdx]),
      trackSurfaceMaterial: optionalInt(trackMaterials[carIdx]),
      bestLapTimeSec: positiveNum(bestLapTimes[carIdx]),
      bestLapNum: optionalInt(bestLapNums[carIdx]),
      pushToPassActive: optionalBool(pushToPassStatus[carIdx]),
      pushToPassCount: optionalInt(pushToPassCounts[carIdx]),
      paceFlags: paceFlagsList(optionalNum(carPaceFlags[carIdx])),
      paceLine: optionalInt(paceLines[carIdx]),
      paceRow: optionalInt(paceRows[carIdx])
    }
  })
}

function relativeEntry(driver: DriverEntry | undefined): RelativeCarEntry | undefined {
  if (!driver) return undefined
  return {
    carIdx: driver.carIdx,
    name: driver.name,
    carNumber: driver.carNumber,
    position: driver.position,
    classPosition: driver.classPosition,
    gapSec: driver.gapToPlayerSec,
    lastLapTimeSec: driver.lastLapTimeSec,
    classColor: driver.classColor
  }
}

function relatives(drivers: DriverEntry[] | undefined): TelemetrySnapshot['relatives'] | undefined {
  if (!drivers) return undefined
  const ahead = drivers
    .filter((d) => !d.isPlayer && typeof d.gapToPlayerSec === 'number' && d.gapToPlayerSec > 0)
    .sort((a, b) => (a.gapToPlayerSec ?? 999) - (b.gapToPlayerSec ?? 999))[0]
  const behind = drivers
    .filter((d) => !d.isPlayer && typeof d.gapToPlayerSec === 'number' && d.gapToPlayerSec < 0)
    .sort((a, b) => (b.gapToPlayerSec ?? -999) - (a.gapToPlayerSec ?? -999))[0]
  const out = { ahead: relativeEntry(ahead), behind: relativeEntry(behind) }
  return out.ahead || out.behind ? out : undefined
}

// Per-side flags used ONLY to position radar dots. Derived from the authoritative
// CarLeftRight state so the dots agree with the spoken callout; the dot's exact
// X is still approximated (see radarCars) — the spoken side never uses that X.
function carLeftRightSides(value: unknown): Array<'left' | 'right'> {
  switch (carLeftRightStateFromEnum(num(value, 0))) {
    case 'left':
      return ['left']
    case 'right':
      return ['right']
    case 'both':
      return ['left', 'right']
    default:
      return []
  }
}

function radarCars(values: AnyRecord, drivers: DriverEntry[] | undefined, speedKmh: number): TelemetrySnapshot['radarCars'] | undefined {
  if (!drivers) return undefined
  const sdkSides = carLeftRightSides(values.CarLeftRight)
  const speedMs = Math.max(8, speedKmh / 3.6)
  const rows = drivers
    .filter((d) => !d.isPlayer && typeof d.gapToPlayerSec === 'number' && Math.abs(d.gapToPlayerSec) <= 4)
    .slice(0, 12)
    .map((d, index) => {
      const side = sdkSides.length ? sdkSides[index % sdkSides.length] : undefined
      const sideFromSdk = side === 'left' ? -3.2 : side === 'right' ? 3.2 : undefined
      return {
        carIdx: d.carIdx,
        name: d.name,
        relativeX: sideFromSdk ?? (index % 2 === 0 ? -3.2 : 3.2),
        relativeY: (d.gapToPlayerSec ?? 0) * speedMs,
        gapSec: d.gapToPlayerSec,
        classColor: d.classColor
      }
    })
  return rows.length ? rows : undefined
}

function currentSession(sessionInfo: any, sessionNum: number): any {
  const sessions = sessionValue(sessionInfo, ['SessionInfo', 'Sessions'])
  if (!Array.isArray(sessions)) return undefined
  return sessions[sessionNum] ?? sessions[0]
}

export const __iracingTelemetryTest = {
  buildDriverStatic,
  coldPressures,
  deriveCarVelocity,
  driverCarSetup,
  flags,
  parseDrivers,
  pitStatus,
  playerCarName,
  playerCarPath,
  playerRelativeGapSec,
  relatives,
  revLights,
  shiftBand,
  tyreTemps
}

function strengthOfField(sessionInfo: any, session: any, drivers: DriverEntry[] | undefined): number | undefined {
  const explicit = Number.parseInt(String(session?.StrengthOfField ?? session?.ResultsStrengthOfField ?? sessionValue(sessionInfo, ['WeekendInfo', 'WeekendSOF']) ?? ''), 10)
  if (Number.isFinite(explicit)) return explicit
  const ratings = (drivers ?? []).map((driver) => driver.iRating).filter((rating): rating is number => typeof rating === 'number' && rating > 0)
  if (!ratings.length) return undefined
  return Math.round(ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length)
}

function incidentLimit(sessionInfo: any, session: any): number | undefined {
  const value = session?.ResultsIncidentLimit ?? session?.IncidentLimit ?? sessionValue(sessionInfo, ['WeekendInfo', 'IncidentLimit'])
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

function replaySessionIdentity(sessionInfo: any, values: AnyRecord): string | undefined {
  const parts = [
    sessionValue(sessionInfo, ['WeekendInfo', 'SessionID']),
    sessionValue(sessionInfo, ['WeekendInfo', 'SubSessionID']),
    values.SessionUniqueID,
    values.SessionNum
  ].map((value) => {
    if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value)
    if (typeof value === 'string' && value.trim()) return value.trim()
    return ''
  }).filter(Boolean)
  return parts.some(Boolean) ? parts.join(':') : undefined
}

export class IRacingProvider implements TelemetryProvider {
  readonly id = 'iracing' as const
  private mmf = new IRacingMemoryMap()
  private started = false
  private lastSnapshot: TelemetrySnapshot | null = null
  private replayTracker = new ReplayContextTracker()
  private replayConnectionEpoch = 0
  private replayConnected = false
  private reusedLastSnapshot = false
  private driverStaticKey = ''
  private driverStaticSessionInfo: any = null
  private driverStatic: DriverStaticEntry[] | undefined
  // Last logged per-car shift-light signature + the set of sources already logged for
  // it, so the rev-light diagnostics capture each distinct source (idle 'sl-band' AND
  // in-band 'iracing-live') once per car/session — not every 60Hz poll.
  private shiftDiagKey = ''
  private shiftDiagSources = new Set<ShiftSource>()
  // Per-session diagnostic (track/car/position-var presence) signature, logged once
  // when it changes so a log capture shows which position vars iRacing exposes.
  private sessionDiagKey = ''
  // Last time the verbose telemetry tap emitted (ms epoch), so the high-rate sample
  // is throttled to ~3-4 Hz even at the 60Hz poll. Only consulted when verbose is on.
  private lastTapAt = 0
  // User-configured sensitivity for the DERIVED tcActive (iRacing has no native var). Wired
  // live from the settings store (see iracing-provider module). 'off' ⇒ no derivation.
  private tcSensitivity: TcSensitivity = 'medium'
  // Stateful debounce/hysteresis around the pure deriveTcActive so tcActive doesn't chatter
  // frame-to-frame as longAccelG oscillates around 0 on corner exits. Window tracks the
  // sensitivity (lower = longer hold). Re-created whenever the sensitivity changes.
  private tcLatch = new TcLatch(tcLatchTimingsForSensitivity('medium'))
  private fuelLapEstimator = new FuelLapEstimator()

  // Live-updates the TC-active derivation sensitivity from the settings store, so a change
  // in the UI takes effect on the next poll without restarting the provider. Rebuilds the
  // debounce latch with the level's window and clears any stale latched state.
  setTcSensitivity(level: TcSensitivity): void {
    if (level === this.tcSensitivity) return
    this.tcSensitivity = level
    this.tcLatch = new TcLatch(tcLatchTimingsForSensitivity(level))
  }

  start(): void {
    if (this.started && this.mmf.isOpen()) return
    if (!this.started) this.resetReplayTracker()
    this.started = true
    this.mmf.start()
  }

  stop(): void {
    if (this.started || this.replayConnected) this.resetReplayTracker()
    this.started = false
    this.replayConnected = false
    this.lastSnapshot = null
    this.reusedLastSnapshot = false
    this.driverStaticKey = ''
    this.driverStaticSessionInfo = null
    this.driverStatic = undefined
    this.shiftDiagKey = ''
    this.shiftDiagSources.clear()
    this.sessionDiagKey = ''
    this.lastTapAt = 0
    this.tcLatch.reset()
    this.fuelLapEstimator.reset()
    this.mmf.stop()
  }

  isConnected(): boolean {
    if (this.started && !this.mmf.isOpen()) this.mmf.start()
    const connected = this.started && this.mmf.isConnected()
    if (connected !== this.replayConnected) {
      this.replayConnected = connected
      this.resetReplayTracker()
      this.lastSnapshot = null
      this.reusedLastSnapshot = false
      this.fuelLapEstimator.reset()
    }
    return connected
  }

  poll(): TelemetrySnapshot | null {
    const connected = this.isConnected()
    if (!connected) {
      this.lastSnapshot = null
      this.reusedLastSnapshot = false
      this.driverStaticKey = ''
      this.driverStaticSessionInfo = null
      this.driverStatic = undefined
      this.fuelLapEstimator.reset()
      return null
    }
    const read = this.mmf.read()
    // Connected but a single read came back empty (e.g. mid sessionInfo swap): reuse the
    // last good snapshot for one tick only, then fall back to null so a lingering connected
    // bit with persistently failing reads can't keep broadcasting stale telemetry.
    if (!read) {
      if (this.reusedLastSnapshot) return null
      this.reusedLastSnapshot = true
      return this.lastSnapshot
    }
    this.reusedLastSnapshot = false
    const values = read.values as AnyRecord
    const sessionInfo = read.sessionInfo
    const session = currentSession(sessionInfo, Math.trunc(num(values.SessionNum, 0)))
    const carSetup = driverCarSetup(sessionInfo)
    const staticDrivers = this.getDriverStatic(sessionInfo, read.sessionInfoYaml)
    const drivers = parseDrivers(sessionInfo, values, staticDrivers)
    const speedKmh = num(values.Speed) * 3.6
    const rpm = num(values.RPM)
    // DriverCarRedLine is the session-YAML engine limit. PlayerCarRedLine can alias a
    // shift-light stage for some cars (the GR86 reports 6800 despite a 7500 RPM limit).
    const maxRpm =
      carSetup.redlineRpm ??
      positiveNum(values.PlayerCarRedLine) ??
      positiveNum(carSetup.lastRpm) ??
      positiveNum(carSetup.shiftRpm)
    const sessionLapsRemain = num(values.SessionLapsRemainEx ?? values.SessionLapsRemain, Number.NaN)
    const trackWetness = iracingTrackWetnessPct(values.TrackWetness) ?? pct(values.TrackWetnessPct)
    const precipitation = pct(values.Precipitation)
    const absLevel = firstDefined(values.dcABS, values.dcABS1, values.dcAntiLockBrake)
    const tcLevel = firstDefined(values.dcTractionControl, values.dcTractionControl2)
    const engineMap =
      optionalSetting(values.dcFuelMixture) ??
      optionalSetting(values.dcEnginePower)
    const throttleMap = optionalSetting(values.dcThrottleShape)
    const engineBraking = optionalSetting(values.dcEngineBraking)
    const antiRollFront = optionalSetting(values.dcAntiRollFront)
    const antiRollRear = optionalSetting(values.dcAntiRollRear)
    const weightJackerRight = optionalSetting(values.dcWeightJackerRight)
    const brakeBiasPct = normalizePctValue(values.dcBrakeBias)
    const fuelLapTimeSec = positiveNum(values.LapLastLapTime) ?? positiveNum(values.LapLastNLapTime)
    // Rev/shift lights anchor the per-car SL band First→Shift so the bar is FULL at the
    // OPTIMAL upshift (DriverCarSLShiftRPM), not the limiter. Cars that don't publish
    // SLFirst/SLShift fall back to live ShiftIndicatorPct, then a redline top slice —
    // NEVER a 0..maxRpm fill (that lit the bar at idle). shiftBand() and revLights()
    // share this computation, so shiftIndicatorPct === revLights.pct and every consumer
    // (buttonbox/iFlag/dashboard/overlay) agrees.
    const iracingShiftPct = pct(values.ShiftIndicatorPct)
    const band = shiftBand(rpm, carSetup, maxRpm, iracingShiftPct)
    const shiftIndicatorPct = band.pct
    this.logShiftDiagnostics(carSetup, maxRpm, band.source)
    // Preserve iRacing's raw DriverCarSLShiftRPM as the public upshift RPM.
    const shiftRpm = carSetup.shiftRpm
    const fuelUsePerHourKg = optionalNum(values.FuelUsePerHour)
    const fuelPerLapKg = fuelUsePerHourKg !== undefined && fuelLapTimeSec !== undefined ? (fuelUsePerHourKg / 3600) * fuelLapTimeSec : undefined
    const incidentCountMy = optionalNum(values.PlayerCarMyIncidentCount)
    const incidentCountTeam = optionalNum(values.PlayerCarTeamIncidentCount)

    // Player position/orientation for the track-map learner. iRacing's canonical vars
    // are Lat/Lon (deg), VelocityX/Y (m/s, CAR frame) and YawNorth (rad from North).
    const lat = optionalNum(values.Lat)
    const lon = optionalNum(values.Lon)
    const yawNorth = optionalNum(values.YawNorth)
    const rawVelocityX = optionalNum(values.VelocityX)
    const rawVelocityY = optionalNum(values.VelocityY)
    // FIX (track-map not learning): the user's 53-min capture logged velocityX/velocityY
    // (and lat/lon) NULL the whole session while YawNorth was present, so the learner
    // never had an acquisition mode. deriveCarVelocity() falls back to a forward-only
    // velocity from Speed+YawNorth so the learner can still dead-reckon a path.
    const speedMs = optionalNum(values.Speed)
    const { velocityX, velocityY } = deriveCarVelocity(rawVelocityX, rawVelocityY, speedMs, yawNorth, hasUsableLatLon(lat, lon))

    // New iRacing channels (all OPTIONAL / undefined-safe). Var names verified against the
    // irSDK: live tyre pressure is NOT exposed (only cold), `dcPushToPass` does not exist
    // (use PushToPass/P2P_Status), and there is no boolean PitRepairNeeded (derived in
    // pitStatus from PitRepairLeft). See the snapshot fields below.
    const ersBatteryPct = pct(values.EnergyERSBatteryPct)
    // Prefer P2P_Status (the actual deploy/active window the HUD should show) over the
    // momentary PushToPass button; both degrade to undefined.
    const pushToPass = optionalBool(firstDefined(values.P2P_Status, values.PushToPass))
    const pushToPassCount = optionalInt(values.P2P_Count)
    const weatherDeclaredWet = optionalBool(values.WeatherDeclaredWet)
    const drsState = drsStateFromRaw(values.DRS_Status)
    const trackSurfaceMaterial = optionalInt(values.PlayerTrackSurfaceMaterial)
    // New SDK-gap channels (all OPTIONAL / undefined-safe). EngineWarnings is the
    // dashboard tell-tale bitfield; BrakeABSCutPct is the % of brake pressure the ABS
    // cuts while intervening; SessionState/PaceMode/PaceFlags expose session phase and
    // pace-formation state; carLeftRightCount adds the 1-vs-2 cars count alongside.
    const engineWarnings = engineWarningsFromBitfield(optionalNum(values.EngineWarnings))
    const absCutPct = optionalNum(values.BrakeABSCutPct)
    const sessionState = sessionStateLabel(optionalNum(values.SessionState))
    const paceMode = paceModeLabel(optionalNum(values.PaceMode))
    const paceFlags = paceFlagsList(optionalNum(values.PaceFlags))
    const carLeftRightCount = carLeftRightCountFromEnum(optionalNum(values.CarLeftRight))
    const weightPenaltyKg = optionalNum(values.PlayerCarWeightPenalty)
    const powerAdjustPct = optionalNum(values.PlayerCarPowerAdjust)
    const currentLap = optionalInt(values.Lap)
    const fuelLiters = optionalNum(values.FuelLevel)
    const sessionTimeOfDay = optionalNum(values.SessionTimeOfDay)
    const pit = pitStatus(values)
    const tireColdPressuresKpa = coldPressures(values)
    const pitTyreTargetsKpa = corners(values, ['PitSvLFP', 'PitSvRFP', 'PitSvLRP', 'PitSvRRP'])
    const trackLength = trackLengthKm(sessionInfo)
    const simModeValue = sessionValue(sessionInfo, ['WeekendInfo', 'SimMode'])
    const replayContext = this.replayTracker.update({
      simMode: simModeValue,
      isReplayPlaying: values.IsReplayPlaying,
      replaySessionNum: values.ReplaySessionNum,
      replayFrameNum: values.ReplayFrameNum,
      replayFrameNumEnd: values.ReplayFrameNumEnd,
      sessionTime: values.SessionTime,
      replaySessionTime: values.ReplaySessionTime
    }, {
      sessionIdentity: replaySessionIdentity(sessionInfo, values),
      connectionEpoch: this.replayConnectionEpoch
    })
    const fuelEstimate = this.fuelLapEstimator.update({
      sessionIdentity: replayContext.sessionIdentity,
      live: replayContext.state === 'live',
      currentLap,
      fuelLiters
    })

    this.logSessionDiagnostics(sessionInfo, values, carSetup, maxRpm)
    this.logTelemetryTap(() => ({
      rpm, redline: optionalNum(values.PlayerCarRedLine), maxRpm,
      shiftIndicatorPctRaw: pct(values.ShiftIndicatorPct), resolvedPct: shiftIndicatorPct, source: band.source,
      gear: Math.trunc(num(values.Gear, 0)), speedKmh,
      lat, lon, velocityX, velocityY, yawNorth, lapDistPct: pct(values.LapDistPct),
      slFirst: carSetup.firstRpm, slShift: carSetup.shiftRpm, slLast: carSetup.lastRpm, slBlink: carSetup.blinkRpm,
      // Race-control flag state so a verbose capture can diagnose flag issues (e.g.
      // a local waved yellow): the raw SessionFlags bitfield as hex + the derived
      // active flags. Without this the sample never showed flag state.
      sessionFlagsHex: `0x${(num(values.SessionFlags, 0) >>> 0).toString(16).padStart(8, '0')}`,
      flagsActive: Object.entries(flags(values.SessionFlags)).filter(([, on]) => on === true).map(([name]) => name),
      // A taste of the new iRacing channels so a verbose capture shows the sim's hybrid /
      // push-to-pass / surface data without bloating every sample.
      ersBatteryPct, pushToPass, trackSurfaceMaterial
    }))

    const snapshot: TelemetrySnapshot = {
      sim: 'iracing',
      connected: true,
      timestamp: Date.now(),
      speedKmh,
      rpm,
      gear: Math.trunc(num(values.Gear, 0)),
      maxRpm,
      shiftIndicatorPct,
      shiftRpm,
      revLights: revLights(rpm, carSetup, maxRpm, iracingShiftPct),
      throttle: num(values.Throttle),
      brake: num(values.Brake),
      clutch: num(values.Clutch),
      steerAngleDeg: num(values.SteeringWheelAngle, 0) * (180 / Math.PI),
      steeringTorquePct: pct(values.SteeringWheelPctTorque),
      steeringAngleMaxDeg: toDeg(values.SteeringWheelAngleMax),
      latAccelG: mss2ToG(values.LatAccel),
      longAccelG: mss2ToG(values.LongAccel),
      vertAccelG: mss2ToG(values.VertAccel),
      yawRateRadSec: optionalNum(values.YawRate),
      pitchRad: optionalNum(values.Pitch),
      rollRad: optionalNum(values.Roll),
      yawRad: optionalNum(values.Yaw),
      pitchRateRadSec: optionalNum(values.PitchRate),
      rollRateRadSec: optionalNum(values.RollRate),
      altitudeM: optionalNum(values.Alt),
      velocityZ: optionalNum(values.VelocityZ),
      drs: values.DRS_Status !== undefined ? num(values.DRS_Status, 0) >= 2 : bool(values.DRS_Active),
      drsState,
      absActive: optionalBool(values.BrakeABSactive),
      absEnabled: bool(values.BrakeABSactive) || num(absLevel, 0) > 0,
      absLevel: typeof absLevel === 'number' || typeof absLevel === 'string' ? absLevel : undefined,
      absCutPct,
      // iRacing exposes no native TC-active var (SimHub derives it). Per product decision
      // tcActive is DERIVED via deriveTcActive (TC_ACTIVE_DERIVED, default ON) — assigned
      // just below once the full snapshot is built. Falls back to undefined if the gate is off.
      tcActive: undefined,
      tcEnabled: bool(values.dcTractionControlToggle) || num(tcLevel, 0) > 0,
      tcLevel: typeof tcLevel === 'number' || typeof tcLevel === 'string' ? tcLevel : undefined,
      engineMap,
      throttleMap,
      engineBraking,
      antiRollFront,
      antiRollRear,
      weightJackerRight,
      engineWarnings,
      brakeBiasPct,
      handbrake: pct(values.HandbrakeRaw ?? values.Handbrake),
      waterTempC: celsius(values.WaterTemp),
      oilTempC: celsius(values.OilTemp),
      oilPressureKpa: oilPressureKpa(values.OilPressure),
      manifoldPressBar: optionalNum(values.ManifoldPress),
      fuelPressBar: optionalNum(values.FuelPress),
      voltage: optionalNum(values.Voltage),
      waterLevelL: optionalNum(values.WaterLevel),
      oilLevelL: optionalNum(values.OilLevel),
      ersBatteryPct,
      pushToPass,
      pushToPassCount,
      sessionType: session?.SessionType,
      sessionState,
      paceMode,
      paceFlags,
      carName: playerCarName(sessionInfo),
      carPath: playerCarPath(sessionInfo),
      trackName: optionalString(sessionValue(sessionInfo, ['WeekendInfo', 'TrackDisplayName'])) ?? optionalString(sessionValue(sessionInfo, ['WeekendInfo', 'TrackName'])),
      trackConfigName: optionalString(sessionValue(sessionInfo, ['WeekendInfo', 'TrackConfigName'])),
      sessionTimeRemainingSec: optionalNum(values.SessionTimeRemain),
      sessionNumber: optionalInt(values.SessionNum),
      sessionTimeSec: optionalNum(values.SessionTime),
      lapsRemaining: Number.isFinite(sessionLapsRemain) ? sessionLapsRemain : undefined,
      currentLap: Math.trunc(num(values.Lap, 0)),
      completedLaps: optionalInt(values.LapCompleted),
      lapDistPct: pct(values.LapDistPct),
      lapDistanceM: optionalNum(values.LapDist),
      lastLapTimeSec: optionalNum(values.LapLastLapTime),
      bestLapTimeSec: optionalNum(values.LapBestLapTime),
      bestNLapLap: optionalInt(values.LapBestNLapLap),
      bestNLapTimeSec: optionalNum(values.LapBestNLapTime),
      currentLapTimeSec: optionalNum(values.LapCurrentLapTime),
      // iRacing's running average of the last N laps is `LapLastNLapTime` (note: `Last`, not `Las`).
      // The old typo silently returned undefined every tick, so estimatedLapTimeSec
      // always fell through to the heuristic in timing.ts.
      estimatedLapTimeSec: optionalNum(values.LapLastNLapTime),
      deltaToBestSec: optionalNum(values.LapDeltaToBestLap),
      deltaToSessionBestSec: optionalNum(values.LapDeltaToSessionBestLap),
      deltaToOptimalSec: optionalNum(values.LapDeltaToOptimalLap),
      deltaToSessionOptimalSec: optionalNum(values.LapDeltaToSessionOptimalLap),
      deltaToDriverBestSec: optionalNum(values.LapDeltaToDriverBestLap),
      position: Math.trunc(num(values.PlayerCarPosition, 0)) || undefined,
      classPosition: Math.trunc(num(values.PlayerCarClassPosition, 0)) || undefined,
      totalCars: drivers?.length,
      strengthOfField: strengthOfField(sessionInfo, session, drivers),
      sessionUniqueId: optionalNum(values.SessionUniqueID),
      driverName: drivers?.find((d) => d.isPlayer)?.name,
      sessionTimeOfDay,
      onTrack: optionalBool(firstDefined(values.IsOnTrackCar, values.IsOnTrack)),
      cameraCarIdx: optionalInt(values.CamCarIdx),
      replayPlaying: optionalBool(values.IsReplayPlaying),
      replayFrameNum: optionalInt(values.ReplayFrameNum),
      replayFrameEnd: optionalInt(values.ReplayFrameNumEnd),
      replayContext,
      weightPenaltyKg,
      powerAdjustPct,
      fuelLiters,
      fuelPerLap: fuelEstimate.fuelPerLapLiters,
      fuelPerLapLiters: fuelEstimate.fuelPerLapLiters,
      fuelLapsRemaining: fuelEstimate.fuelLapsRemaining,
      fuelUsePerHourKg,
      fuelPerLapKg,
      fuelCapacityLiters: carSetup.fuelCapacityLiters ?? (num(values.FuelLevelPct, 0) > 0 ? num(values.FuelLevel) / num(values.FuelLevelPct) : undefined),
      fuelLevelPct: pct(values.FuelLevelPct),
      tyres: tyreTemps(values),
      brakeTempC: corners(values, ['LFbrakeTemp', 'RFbrakeTemp', 'LRbrakeTemp', 'RRbrakeTemp']),
      brakeLinePressBar: corners(values, ['LFbrakeLinePress', 'RFbrakeLinePress', 'LRbrakeLinePress', 'RRbrakeLinePress']),
      tireColdPressuresKpa,
      pitTyreTargetsKpa,
      flags: flags(values.SessionFlags),
      sessionFlagsRaw: Math.trunc(num(values.SessionFlags, 0)),
      pitLimiter: bool(values.PitLimiter),
      onPitRoad: bool(values.OnPitRoad),
      pitServiceFlags: pitServiceFlags(values.PitSvFlags),
      pitFuelToAddL: optionalNum(values.PitSvFuel),
      repairTimeSec: optionalNum(values.PitRepairLeft),
      optionalRepairTimeSec: optionalNum(values.PitOptRepairLeft),
      pitStopActive: optionalBool(values.PitstopActive),
      pit,
      incidentCount: Math.trunc(num(incidentCountMy ?? incidentCountTeam, 0)),
      incidentCountMy: incidentCountMy !== undefined ? Math.trunc(incidentCountMy) : undefined,
      incidentCountTeam: incidentCountTeam !== undefined ? Math.trunc(incidentCountTeam) : undefined,
      incidentLimit: incidentLimit(sessionInfo, session),
      fastRepairsUsed: Math.trunc(num(values.FastRepairUsed, 0)),
      fastRepairsAvailable: Math.trunc(num(values.FastRepairAvailable, 0)),
      trackTempC: celsius(values.TrackTemp),
      airTempC: celsius(values.AirTemp),
      trackWetnessPct: trackWetness,
      isRaining: num(precipitation, 0) > 0,
      precipitationPct: precipitation,
      gripPct: pct(values.TrackGripStatus ?? values.TrackGrip),
      weatherDeclaredWet,
      trackSurfaceMaterial,
      airDensityKgM3: optionalNum(values.AirDensity),
      airPressureKpa: inHgToKpa(optionalNum(values.AirPressure)),
      airPressureHg: optionalNum(values.AirPressure),
      weatherType: optionalInt(values.WeatherType),
      trackLengthKm: trackLength,
      fogPct: pct(values.FogLevel),
      humidityPct: pct(values.RelativeHumidity),
      windSpeedMs: optionalNum(values.WindVel),
      windDirRad: optionalNum(values.WindDir),
      solarAltitudeRad: optionalNum(values.SolarAltitude),
      solarAzimuthRad: optionalNum(values.SolarAzimuth),
      skies: optionalInt(values.Skies),
      playerCarIdx: Math.trunc(num(values.PlayerCarIdx ?? sessionValue(sessionInfo, ['DriverInfo', 'DriverCarIdx']), 0)),
      drivers,
      relatives: relatives(drivers),
      radarCars: radarCars(values, drivers, speedKmh),
      // Authoritative proximity side from the iRacing CarLeftRight flag — the
      // official player-centric spotter signal. Drives the spoken left/right
      // callout; the raw enum is kept for diagnostics/logging.
      carLeftRight: carLeftRightStateFromEnum(num(values.CarLeftRight, 0)),
      carLeftRightRaw: Math.trunc(num(values.CarLeftRight, 0)),
      carLeftRightCount,
      // Position/orientação do carro do jogador para construção do track map.
      // irsdk vars: Lat/Lon (graus), VelocityX/Y (m/s, frame do carro),
      // YawNorth (rad, yaw relativo ao Norte). Quando o iRacing não publica
      // VelocityX/Y mas expõe YawNorth + Speed, velocityX/Y são derivados de
      // speed+heading acima (dead reckoning) para o learner conseguir aprender.
      lat,
      lon,
      velocityX,
      velocityY,
      yawNorth
    }
    // Derived TC-active. iRacing publishes no native TC-active var, so per the product
    // decision tcActive is DERIVED like SimHub (TC_ACTIVE_DERIVED default ON). The user's
    // `tcSensitivity` setting governs how aggressive the wheelspin approximation is; 'off'
    // (null options) leaves tcActive undefined. The raw per-frame predicate is then passed
    // through tcLatch for time-based debounce/hysteresis so tcActive doesn't chatter as
    // longAccelG oscillates around 0 on corner exits.
    const tcOptions = tcOptionsForSensitivity(this.tcSensitivity)
    if (TC_ACTIVE_DERIVED && tcOptions) {
      const rawTc = deriveTcActive(snapshot, tcOptions)
      snapshot.tcActive = this.tcLatch.update(rawTc, snapshot.timestamp)
    } else {
      // Derivation disabled ('off') — keep tcActive undefined and clear any latched state.
      this.tcLatch.reset()
    }
    this.lastSnapshot = snapshot
    return snapshot
  }

  private resetReplayTracker(): void {
    this.replayConnectionEpoch += 1
    this.replayTracker.reset()
  }

  // Write the resolved per-car shift-light band to the 24h logs so they reveal exactly
  // what iRacing reported for a car the user says the rev-lights got wrong. Logged once
  // per (car × distinct source) — so the idle 'sl-band' read AND the in-band
  // 'iracing-live' read (the path the lights actually run on while driving) are both
  // captured — bounded to ≤4 lines per car/session, never flooding at the 60Hz poll.
  private logShiftDiagnostics(setup: DriverCarShiftLights, maxRpm: number | undefined, source: ShiftSource): void {
    const key = [setup.firstRpm, setup.shiftRpm, setup.lastRpm, setup.blinkRpm, maxRpm !== undefined ? Math.round(maxRpm) : 'n/a'].join('|')
    if (key !== this.shiftDiagKey) {
      this.shiftDiagKey = key
      this.shiftDiagSources.clear()
    }
    if (this.shiftDiagSources.has(source)) return
    this.shiftDiagSources.add(source)
    logger.info('revlights', 'per-car shift-light band', {
      source,
      slFirstRpm: setup.firstRpm,
      slShiftRpm: setup.shiftRpm,
      slLastRpm: setup.lastRpm,
      slBlinkRpm: setup.blinkRpm,
      maxRpm: maxRpm !== undefined ? Math.round(maxRpm) : undefined
    })
  }

  // Once per session/car, record the track + car identity and — crucially — WHICH
  // position vars iRacing actually exposes (raw presence of Lat/Lon/VelocityX/VelocityY/
  // YawNorth). The user's track-map never learned because those came back null; this line
  // lets the next log capture SHOW exactly which channels the sim publishes for this
  // build/car. `info` (always recorded), deduped on the track/car/SL signature.
  private logSessionDiagnostics(sessionInfo: any, values: AnyRecord, setup: DriverCarShiftLights, maxRpm: number | undefined): void {
    const carPath = playerCarPath(sessionInfo)
    const track = optionalString(sessionValue(sessionInfo, ['WeekendInfo', 'TrackName']))
    const trackConfig = optionalString(sessionValue(sessionInfo, ['WeekendInfo', 'TrackConfigName']))
    const key = [track, trackConfig, carPath, setup.firstRpm, setup.shiftRpm, setup.lastRpm, setup.blinkRpm].join('|')
    if (key === this.sessionDiagKey) return
    this.sessionDiagKey = key
    logger.info('iracing', 'session', {
      track,
      trackConfig,
      trackLengthKm: trackLengthKm(sessionInfo),
      carPath,
      redline: optionalNum(values.PlayerCarRedLine),
      maxRpm: maxRpm !== undefined ? Math.round(maxRpm) : undefined,
      slFirst: setup.firstRpm,
      slShift: setup.shiftRpm,
      slLast: setup.lastRpm,
      slBlink: setup.blinkRpm,
      // Static-ish BoP / penalty channels so a session log capture shows the iRacing
      // weight ballast + power adjustment assigned to this car.
      weightPenaltyKg: optionalNum(values.PlayerCarWeightPenalty),
      powerAdjustPct: optionalNum(values.PlayerCarPowerAdjust),
      // Raw iRacing var presence (not the derived velocity) so the log shows what the
      // sim genuinely publishes for this build.
      positionVarsPresent: {
        lat: values.Lat !== undefined,
        lon: values.Lon !== undefined,
        velocityX: values.VelocityX !== undefined,
        velocityY: values.VelocityY !== undefined,
        yawNorth: values.YawNorth !== undefined
      }
    })
  }

  // High-rate verbose telemetry tap: the RESOLVED rev-light curve + the raw inputs that
  // produced it, so a verbose log capture shows fill-vs-rpm and the position channels
  // directly. The sample object is built LAZILY (factory) and only when verbose is ON, so
  // it costs nothing in normal operation. Throttled to ~3-4 Hz (every ~280ms) so it never
  // floods even at the 60Hz poll.
  private logTelemetryTap(build: () => Record<string, unknown>): void {
    if (!logger.isVerbose()) return
    const now = Date.now()
    if (now - this.lastTapAt < 280) return
    this.lastTapAt = now
    logger.verbose('telemetry', 'sample', build())
  }

  private getDriverStatic(sessionInfo: any, sessionInfoYaml: string): DriverStaticEntry[] | undefined {
    const key = sessionInfoYaml || String(sessionValue(sessionInfo, ['WeekendInfo', 'SessionID']) ?? '')
    const hasSessionString = sessionInfoYaml.length > 0
    if (this.driverStatic && key === this.driverStaticKey && (hasSessionString || sessionInfo === this.driverStaticSessionInfo)) {
      return this.driverStatic
    }

    this.driverStaticKey = key
    this.driverStaticSessionInfo = sessionInfo
    this.driverStatic = buildDriverStatic(sessionInfo)
    return this.driverStatic
  }

  diagnose(): { provider: IRacingDiagnostics['provider']; mmf: IRacingMmfDiagnostics } {
    const mmf = this.mmf.diagnose()
    const isConnected = this.isConnected()
    const snap = this.poll()
    return {
      provider: {
        started: this.started,
        isConnected,
        polledConnected: snap?.connected ?? false,
        sample: snap
          ? { speedKmh: snap.speedKmh, rpm: snap.rpm, gear: snap.gear, currentLap: snap.currentLap }
          : undefined
      },
      mmf
    }
  }
}
