// Modelo de telemetria normalizado — fonte única de verdade compartilhada entre
// providers (iRacing/ACC/AC/AMS2/Mock), engine do OLED, overlays e demais consumidores.

import type { ReplayContext } from './replay'
export type { ReplayContext, ReplayContextIdentity, ReplayContextInputs, ReplayContextReason, ReplayContextSource, ReplayContextState, ReplayResolution } from './replay'

export type SimId = 'iracing' | 'acc' | 'ac' | 'ams2' | 'lmu' | 'mock' | 'replay' | 'none'

export type TelemetrySource = SimId | 'auto' | 'off'

export interface Corners<T> {
  lf: T
  rf: T
  lr: T
  rr: T
}

export interface TyreInfo {
  tempC?: number
  tempLeftC?: number
  tempMiddleC?: number
  tempRightC?: number
  surfaceTempLeftC?: number
  surfaceTempMiddleC?: number
  surfaceTempRightC?: number
  pressureKpa?: number
  wearPct?: number
  wearLeftPct?: number
  wearMiddlePct?: number
  wearRightPct?: number
}

export interface Flags {
  green: boolean
  yellow: boolean
  blue: boolean
  white: boolean
  checkered: boolean
  red: boolean
  black: boolean
  meatball: boolean // black + orange (dano)
  repair: boolean
  disqualify: boolean
  greenWhiteCheckered: boolean
}

export interface DriverEntry {
  carIdx: number
  name: string
  carNumber: string
  position: number
  classPosition: number
  classId: number
  className?: string
  classColor?: string // hex
  gapToPlayerSec?: number // + à frente, - behind
  lapDistPct?: number
  lastLapTimeSec?: number
  lapsBehind?: number
  iRating?: number
  license?: string
  safetyRating?: number
  custId?: number // iRacing UserID — chave estável p/ driver tags e Trading Paints
  teamId?: number
  teamName?: string
  carPath?: string // pasta do carro p/ paints (ex.: 'rt2000')
  carNumberRaw?: number
  isPlayer: boolean
  /** DriverInfo.Drivers[].CarIsPaceCar from the iRacing session YAML. */
  isPaceCar?: boolean
  inPits?: boolean
  lap?: number
  completedLaps?: number
  estimatedTimeSec?: number
  relativeTimeSec?: number
  gear?: number
  rpm?: number
  trackLocation?: number
  trackSurfaceMaterial?: number
  bestLapTimeSec?: number
  bestLapNum?: number
  pushToPassActive?: boolean
  pushToPassCount?: number
  paceFlags?: string[]
  paceLine?: number
  paceRow?: number
}

export interface RelativeCarEntry {
  carIdx: number
  name: string
  carNumber: string
  position?: number
  classPosition?: number
  gapSec?: number
  lastLapTimeSec?: number
  classColor?: string
}

export interface RelativeCars {
  ahead?: RelativeCarEntry
  behind?: RelativeCarEntry
}

export interface RadarCarEntry {
  carIdx: number
  name?: string
  relativeX: number // meters, left negative / right positive
  relativeY: number // meters, ahead positive / behind negative
  gapSec?: number
  classColor?: string
}

// Decided, player-centric proximity side derived from the iRacing CarLeftRight
// flag — the OFFICIAL spotter signal for "is there a car on my left/right/both".
// This is the SOURCE OF TRUTH for the spoken left/right callout. It must NOT be
// reverse-engineered from per-car radar positions (which, for iRacing, are only
// a coarse parity-based approximation used to place radar dots).
export type CarLeftRightState = 'clear' | 'left' | 'right' | 'both'

/** iRacing DRS_Status values used by the overlay state machine. Unknown values stay absent. */
export type DrsState = 0 | 1 | 2 | 3

export function drsStateFromRaw(raw: unknown): DrsState | undefined {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw > 3) return undefined
  return raw as DrsState
}

// Maps the raw iRacing CarLeftRight enum into the decided side:
//   0=Off, 1=Clear(no cars)        → 'clear'
//   2=CarLeft, 5=2CarsLeft         → 'left'
//   3=CarRight, 6=2CarsRight       → 'right'
//   4=CarLeftRight (three-wide)    → 'both'
// Any unknown value falls back to 'clear'. Pure and dependency-free so providers
// and tests share one mapping.
export function carLeftRightStateFromEnum(raw: number): CarLeftRightState {
  switch (Math.trunc(raw)) {
    case 2:
    case 5:
      return 'left'
    case 3:
    case 6:
      return 'right'
    case 4:
      return 'both'
    default:
      return 'clear'
  }
}

// Maps the iRacing PlayerTrackSurfaceMaterial enum (irsdk_TrkSurf) into a coarse,
// human-readable surface label for overlays/widgets. iRacing numbers several variants
// per material (asphalt_1..4, grass_1..4, rumble_1..4, …); we collapse each family to a
// single label. Rumble strips map to 'kerb'. Returns undefined for "not in world" (-1)
// and "undefined" (0) so the optional field stays clean. Pure + dependency-free so
// providers and consumers share one mapping.
export function trackSurfaceMaterialLabel(raw: number | null | undefined): string | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined
  const v = Math.trunc(raw)
  if (v >= 1 && v <= 4) return 'asphalt'
  if (v === 5 || v === 6) return 'concrete'
  if (v === 7 || v === 8) return 'racing dirt'
  if (v === 9 || v === 10) return 'paint'
  if (v >= 11 && v <= 14) return 'kerb'
  if (v >= 15 && v <= 18) return 'grass'
  if (v >= 19 && v <= 22) return 'dirt'
  if (v === 23) return 'sand'
  if (v === 24 || v === 25) return 'gravel'
  if (v === 26) return 'grasscrete'
  if (v === 27) return 'astroturf'
  return undefined
}

// ─── Engine warnings (irsdk_EngineWarnings bitfield) ─────────────────────────
// iRacing publishes the `EngineWarnings` bitfield (a single int). Each bit is a
// distinct dashboard warning lamp. Decoded into named booleans so widgets can light
// individual tell-tales without re-deriving the masks. Bit map (irsdk_defines.h):
//   0x001 waterTemp   0x002 fuelPressure  0x004 oilPressure  0x008 stalled
//   0x010 pitLimiter  0x020 revLimiter    0x040 oilTemp      0x080 mandRepair
//   0x100 optRepair
export interface EngineWarnings {
  waterTemp: boolean
  fuelPressure: boolean
  oilPressure: boolean
  oilTemp: boolean
  stalled: boolean
  pitLimiter: boolean
  revLimiter: boolean
  mandRepair: boolean
  optRepair: boolean
}

// Bit masks from irsdk_EngineWarnings. Kept next to the decoder so providers and
// tests share one source of truth.
export const ENGINE_WARNING_BITS = {
  waterTemp: 0x0001,
  fuelPressure: 0x0002,
  oilPressure: 0x0004,
  stalled: 0x0008,
  pitLimiter: 0x0010,
  revLimiter: 0x0020,
  oilTemp: 0x0040,
  mandRepair: 0x0080,
  optRepair: 0x0100
} as const

// Decodes the raw `EngineWarnings` bitfield into named booleans. Returns undefined for
// missing/non-finite input so the optional field stays clean (consumers render '—').
// A present value of 0 decodes to an all-false object (no warnings active). Pure +
// dependency-free so providers and tests share one mapping.
export function engineWarningsFromBitfield(raw: number | null | undefined): EngineWarnings | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined
  const bits = Math.trunc(raw)
  return {
    waterTemp: (bits & ENGINE_WARNING_BITS.waterTemp) !== 0,
    fuelPressure: (bits & ENGINE_WARNING_BITS.fuelPressure) !== 0,
    oilPressure: (bits & ENGINE_WARNING_BITS.oilPressure) !== 0,
    oilTemp: (bits & ENGINE_WARNING_BITS.oilTemp) !== 0,
    stalled: (bits & ENGINE_WARNING_BITS.stalled) !== 0,
    pitLimiter: (bits & ENGINE_WARNING_BITS.pitLimiter) !== 0,
    revLimiter: (bits & ENGINE_WARNING_BITS.revLimiter) !== 0,
    mandRepair: (bits & ENGINE_WARNING_BITS.mandRepair) !== 0,
    optRepair: (bits & ENGINE_WARNING_BITS.optRepair) !== 0
  }
}

// ─── Session state (irsdk_SessionState enum) ─────────────────────────────────
// The overall session phase the sim is in. String union so overlays can branch on a
// readable value instead of magic ints.
export type SessionState =
  | 'invalid'
  | 'getInCar'
  | 'warmup'
  | 'paradeLaps'
  | 'racing'
  | 'checkered'
  | 'coolDown'

const SESSION_STATE_BY_ENUM: readonly SessionState[] = [
  'invalid', // 0 irsdk_StateInvalid
  'getInCar', // 1 irsdk_StateGetInCar
  'warmup', // 2 irsdk_StateWarmup
  'paradeLaps', // 3 irsdk_StateParadeLaps
  'racing', // 4 irsdk_StateRacing
  'checkered', // 5 irsdk_StateCheckered
  'coolDown' // 6 irsdk_StateCoolDown
]

// Maps the raw irsdk_SessionState enum int into its label. Returns undefined for
// missing/non-finite/out-of-range input so the optional field stays clean. Pure.
export function sessionStateLabel(raw: number | null | undefined): SessionState | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined
  return SESSION_STATE_BY_ENUM[Math.trunc(raw)]
}

// ─── Pace mode / pace flags (irsdk_PaceMode / irsdk_PaceFlags) ───────────────
// PaceMode is the pacing formation the sim is running (single/double file
// start/restart, or not pacing). PaceFlags is a per-player bitfield of pace
// situations (end of line / free pass / waved around).
export type PaceMode =
  | 'singleFileStart'
  | 'doubleFileStart'
  | 'singleFileRestart'
  | 'doubleFileRestart'
  | 'notPacing'

const PACE_MODE_BY_ENUM: readonly PaceMode[] = [
  'singleFileStart', // 0
  'doubleFileStart', // 1
  'singleFileRestart', // 2
  'doubleFileRestart', // 3
  'notPacing' // 4
]

// Maps the raw irsdk_PaceMode enum int into its label. Returns undefined for
// missing/non-finite/out-of-range input so the optional field stays clean. Pure.
export function paceModeLabel(raw: number | null | undefined): PaceMode | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined
  return PACE_MODE_BY_ENUM[Math.trunc(raw)]
}

export const PACE_FLAG_BITS = {
  endOfLine: 0x0001,
  freePass: 0x0002,
  wavedAround: 0x0004
} as const

// Decodes the raw irsdk_PaceFlags bitfield into the list of active flag names.
// Returns undefined for missing/non-finite input so the optional field stays clean.
// A present value of 0 decodes to an empty array (pacing with no special status). Pure.
export function paceFlagsList(raw: number | null | undefined): string[] | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined
  const bits = Math.trunc(raw)
  const out: string[] = []
  for (const [name, mask] of Object.entries(PACE_FLAG_BITS)) {
    if ((bits & mask) !== 0) out.push(name)
  }
  return out
}

// Number of cars on the busy side of the player from the raw irsdk_CarLeftRight enum.
// Complements `carLeftRightStateFromEnum` (which decides the SIDE) by reporting HOW
// MANY cars are there: 2 for LR2CarsLeft/LR2CarsRight (5/6), 1 for a single car on a
// side or one on each side (CarLeft/CarRight/CarLeftRight = 2/3/4). Returns undefined
// when there are no cars (Off/Clear = 0/1) so the optional field stays clean. Pure.
export function carLeftRightCountFromEnum(raw: number | null | undefined): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined
  switch (Math.trunc(raw)) {
    case 2: // CarLeft
    case 3: // CarRight
    case 4: // CarLeftRight (one each side)
      return 1
    case 5: // 2CarsLeft
    case 6: // 2CarsRight
      return 2
    default:
      return undefined
  }
}

// ─── Derived TC-active (ON by default — see TC_ACTIVE_DERIVED) ────────────────
// iRacing exposes NO native traction-control-active boolean (SimHub DERIVES it). Per
// the product decision, we DERIVE it like SimHub and wire it into the live `tcActive`
// for iRacing (TC_ACTIVE_DERIVED = true). This pure helper is the single, tunable,
// unit-tested derivation so the thresholds can be recalibrated later in one place.
//
// SIGNALS AVAILABLE IN A SINGLE SNAPSHOT: iRacing's per-player snapshot does NOT expose
// per-wheel rotational speeds or gear ratios, so a literal "wheel speed vs ground speed"
// slip ratio isn't computable here, and there is no telemetry history to detect an RPM
// DROP. We therefore use a single, GRIP-DISCRIMINATING proxy the snapshot DOES expose,
// evaluated only inside the traction-loss regime (HARD on throttle, rolling, not
// trail-braking, and below an upper speed where aero drag — not wheelspin — flattens G):
//   POWER-DOWN proxy: the driver is HARD on throttle yet the car is going BACKWARDS in
//   speed — longitudinal G clearly NEGATIVE (decelerating while flooring it) ⇒ the drive
//   wheels are slipping and TC is cutting power.
// This is the key discriminator and why the default threshold is NEGATIVE, not ~0: normal
// grippy acceleration (even at the top of a gear, a gearshift, or steady throttle) keeps
// longG at or above ~0, so a longG-near-0 proxy cried wolf on "qualquer acelerada". Genuine
// traction loss is the car DECELERATING under full throttle — longG clearly below zero —
// which a hooked-up car never shows. An earlier RPM-near-limiter term was removed — it
// false-fired on every normal low-gear upshift with full grip. This is an APPROXIMATION,
// not a sim signal; all thresholds are tunable via TcDeriveOptions (and surfaced to the
// user through the `tcSensitivity` setting → tcOptionsForSensitivity) so the calibration
// lives in one place.
export interface TcDeriveOptions {
  throttleThreshold?: number // min throttle (0..1) — must be HARD on power; default 0.85
  longAccelThresholdG?: number // forward G at/below which (on throttle) signals slip; NEGATIVE by default (-0.10)
  minSpeedKmh?: number // ignore standing starts / stationary; default 5
  slipMaxSpeedKmh?: number // upper bound of the traction-loss regime (drag, not slip, above); default 160
  maxBrake?: number // ignore trail-braking (brake above this disables); default 0.05
}

// Master gate. TRUE = derive tcActive for iRacing (product decision); flipping it to
// false reverts tcActive to undefined (no native var) in one line. See provider.ts. The
// per-user `tcSensitivity` setting also governs this at runtime ('off' ⇒ no derivation).
export const TC_ACTIVE_DERIVED = true

// User-facing TC-active sensitivity. The derivation is an approximation, so the user picks
// how aggressive the wheelspin proxy is. 'off' disables it entirely (tcActive stays
// undefined — there is no native var). Lower = more conservative (only clear wheelspin),
// higher = more eager. Mapped to TcDeriveOptions by tcOptionsForSensitivity.
export const TC_SENSITIVITIES = ['off', 'low', 'medium', 'high'] as const
export type TcSensitivity = (typeof TC_SENSITIVITIES)[number]

export function isTcSensitivity(value: unknown): value is TcSensitivity {
  return TC_SENSITIVITIES.includes(value as TcSensitivity)
}

// Maps a sensitivity level to the deriveTcActive thresholds. Returns null when the
// derivation is OFF (tcActive must stay undefined). The longG threshold is NEGATIVE on the
// conservative levels: only a car DECELERATING under full throttle (clear traction loss)
// fires. 'high' relaxes it back to ~0 (most eager). minSpeed/slipMaxSpeed/maxBrake are
// shared across levels; only the discriminating throttle + longG thresholds change.
export function tcOptionsForSensitivity(level: TcSensitivity): TcDeriveOptions | null {
  switch (level) {
    case 'off':
      return null
    case 'low':
      // Baixa — only strong wheelspin (car clearly slowing while flooring it).
      return { throttleThreshold: 0.9, longAccelThresholdG: -0.25, minSpeedKmh: 5, slipMaxSpeedKmh: 160, maxBrake: 0.05 }
    case 'high':
      // Alta — most sensitive (longG back at ~0, lower throttle gate).
      return { throttleThreshold: 0.75, longAccelThresholdG: 0.0, minSpeedKmh: 5, slipMaxSpeedKmh: 160, maxBrake: 0.05 }
    case 'medium':
    default:
      // Média — the balanced default (matches deriveTcActive's own defaults).
      return { throttleThreshold: 0.85, longAccelThresholdG: -0.1, minSpeedKmh: 5, slipMaxSpeedKmh: 160, maxBrake: 0.05 }
  }
}

export function deriveTcActive(
  snapshot: Pick<TelemetrySnapshot, 'throttle' | 'tcEnabled' | 'longAccelG' | 'speedKmh' | 'brake'> | null | undefined,
  options: TcDeriveOptions = {}
): boolean {
  if (!snapshot) return false
  // TC can only intervene if the car's TC is switched on.
  if (snapshot.tcEnabled === false) return false

  const throttleMin = options.throttleThreshold ?? 0.85
  const accelMax = options.longAccelThresholdG ?? -0.1
  const minSpeed = options.minSpeedKmh ?? 5
  const slipMaxSpeed = options.slipMaxSpeedKmh ?? 160
  const maxBrake = options.maxBrake ?? 0.05

  const finite = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  const throttle = finite(snapshot.throttle)
  const speed = finite(snapshot.speedKmh)
  const brake = finite(snapshot.brake)
  const longG = finite(snapshot.longAccelG)

  // Traction-loss regime: HARD on throttle, rolling but not flat-out (above slipMaxSpeed a
  // flat longG is aero drag, not wheelspin), and not trail-braking.
  if (throttle < throttleMin) return false
  if (speed < minSpeed || speed > slipMaxSpeed) return false
  if (brake > maxBrake) return false

  // Power-down proxy: HARD on throttle yet DECELERATING (longG at/below a NEGATIVE
  // threshold) ⇒ drive wheels slipping / TC cutting. Normal grippy acceleration keeps longG
  // at or above ~0 (strongly positive), so it reads false — no more "qualquer acelerada".
  return longG <= accelMax
}

// ─── TcLatch — stateful debounce / hysteresis around the pure deriveTcActive ─────────────
// deriveTcActive is a PURE per-frame predicate, but longAccelG oscillates around 0 on every
// corner exit, so the raw boolean chatters frame-to-frame — a big part of the "lights on any
// acceleration" perception. TcLatch adds TIME-BASED hysteresis using poll timestamps:
//   • RISE debounce: the raw condition must hold continuously for `minOnMs` before tcActive
//     LATCHES true — a single-frame spike below that window never lights it.
//   • FALL debounce (min-on / release): once latched, a raw drop must persist for `releaseMs`
//     before it releases — a brief flicker back to false within the window stays true.
// It is intentionally a tiny, clock-injected state machine (no Date.now inside) so it is fully
// unit-testable: update(rawActive, nowMs) → debounced boolean. Lives here (not in the provider)
// only so it can be tested in isolation; the provider owns the single live instance.
export interface TcLatchOptions {
  minOnMs?: number // raw must hold this long before latching true (rise debounce); default 150
  releaseMs?: number // raw must stay false this long before releasing (fall debounce); default 200
}

export class TcLatch {
  private latched = false
  private candidateSinceMs: number | null = null // when raw first went true while NOT latched
  private clearSinceMs: number | null = null // when raw first went false while latched
  private readonly minOnMs: number
  private readonly releaseMs: number

  constructor(options: TcLatchOptions = {}) {
    this.minOnMs = Math.max(0, options.minOnMs ?? 150)
    this.releaseMs = Math.max(0, options.releaseMs ?? 200)
  }

  // Feed the raw per-frame predicate plus a monotonic-ish poll timestamp (ms). Returns the
  // debounced, latched value. Out-of-order/non-finite timestamps are tolerated (treated as
  // "no time elapsed") so a bad clock never spuriously latches or releases.
  update(rawActive: boolean, nowMs: number): boolean {
    const now = typeof nowMs === 'number' && Number.isFinite(nowMs) ? nowMs : 0
    if (!this.latched) {
      if (rawActive) {
        if (this.candidateSinceMs === null) this.candidateSinceMs = now
        if (now - this.candidateSinceMs >= this.minOnMs) {
          this.latched = true
          this.candidateSinceMs = null
          this.clearSinceMs = null
        }
      } else {
        this.candidateSinceMs = null
      }
    } else {
      if (rawActive) {
        this.clearSinceMs = null
      } else {
        if (this.clearSinceMs === null) this.clearSinceMs = now
        if (now - this.clearSinceMs >= this.releaseMs) {
          this.latched = false
          this.candidateSinceMs = null
          this.clearSinceMs = null
        }
      }
    }
    return this.latched
  }

  get value(): boolean {
    return this.latched
  }

  reset(): void {
    this.latched = false
    this.candidateSinceMs = null
    this.clearSinceMs = null
  }
}

// Debounce windows per sensitivity level: lower sensitivity holds LONGER (more confirmation
// before lighting, slower to release) so it stays calm; higher reacts faster. 'off' is never
// used (the derivation is disabled) but returns the medium window for completeness.
export function tcLatchTimingsForSensitivity(level: TcSensitivity): Required<TcLatchOptions> {
  switch (level) {
    case 'low':
      return { minOnMs: 250, releaseMs: 300 }
    case 'high':
      return { minOnMs: 100, releaseMs: 150 }
    case 'medium':
    case 'off':
    default:
      return { minOnMs: 150, releaseMs: 200 }
  }
}

// Formats iRacing SessionTimeOfDay (seconds since midnight) into a 24h "HH:MM" string.
// Wraps into [0, 86400) so negative/overflowing inputs stay valid. Returns undefined for
// missing/non-finite input so the optional field stays clean.
export function formatTimeOfDay(secondsSinceMidnight: number | null | undefined): string | undefined {
  if (typeof secondsSinceMidnight !== 'number' || !Number.isFinite(secondsSinceMidnight)) return undefined
  const total = Math.floor(((secondsSinceMidnight % 86400) + 86400) % 86400)
  const hh = Math.floor(total / 3600)
  const mm = Math.floor((total % 3600) / 60)
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

// iRacing pit status snapshot. `repairNeeded`/`optRepairNeeded` are DERIVED from the
// repair-time-left vars (PitRepairLeft / PitOptRepairLeft > 0): iRacing has no boolean
// "repair needed" var. `svStatus` is the raw irsdk_PitSvStatus enum int (0=none,
// 1=in progress, 2=complete, 100+=error).
export interface PitStatus {
  repairNeeded: boolean
  optRepairNeeded: boolean
  pitsOpen: boolean
  inPitStall: boolean
  svStatus?: number
}

export interface TelemetrySnapshot {
  sim: SimId
  connected: boolean
  timestamp: number

  // Car
  speedKmh: number
  rpm: number
  gear: number // -1 ré, 0 neutro, 1..n
  maxRpm?: number
  // Proxy de "ignição/motor ligado". iRacing não expõe uma var de ignição confiável,
  // então o flip-cover (Controls) aplica um limiar de rpm configurável (engineRunningProxy).
  // Este campo opcional fica reservado para providers que exponham um sinal real de
  // ignição/motor — quando presente, tem prioridade sobre o proxy de rpm.
  engineRunning?: boolean
  shiftIndicatorPct?: number // 0..1 ao longo da BANDA de shift-lights do carro (DriverCarSLFirstRPM→SLLastRPM); ShiftIndicatorPct do iRacing como fallback, nunca rpm/maxRpm
  shiftRpm?: number // RPM de upshift optimal do sim (iRacing PlayerCarSLShiftRPM), quando dispolevel
  revLights?: {
    firstRpm?: number
    shiftRpm?: number
    lastRpm?: number
    blinkRpm?: number
    pct?: number
    blink?: boolean
  }
  throttle: number // 0..1
  brake: number // 0..1
  clutch: number // 0..1
  steerAngleDeg?: number
  // Steering FFB torque as a fraction of the wheel's max (iRacing SteeringWheelPctTorque,
  // 0..1) and the car's physical max lock (SteeringWheelAngleMax, converted rad→deg).
  steeringTorquePct?: number
  steeringAngleMaxDeg?: number
  // Forças G — derivadas de iRacing LatAccel/LongAccel/VertAccel (m/s² → G, ÷9.80665).
  latAccelG?: number // + direita / - esquerda
  longAccelG?: number // + aceleração / - frenagem
  vertAccelG?: number
  yawRateRadSec?: number // iRacing YawRate (rad/s)
  // Chassis attitude (iRacing Pitch/Roll/Yaw in rad; PitchRate/RollRate in rad/s; Alt in m).
  // `yawRad` is the car heading; `yawNorth` (below) is heading relative to North.
  pitchRad?: number
  rollRad?: number
  yawRad?: number
  pitchRateRadSec?: number
  rollRateRadSec?: number
  altitudeM?: number
  velocityZ?: number
  /** Legacy DRS boolean kept for existing dashboards/expressions. */
  drs?: boolean
  /** Raw iRacing DRS_Status normalized only when it is one of the documented 0..3 states. */
  drsState?: DrsState
  absActive?: boolean
  absEnabled?: boolean
  absLevel?: number | string
  tcActive?: boolean
  tcEnabled?: boolean
  tcLevel?: number | string
  // Genuine fuel-mixture / engine-power setting only. Never aliases throttleMap.
  engineMap?: number | string
  throttleMap?: number | string
  engineBraking?: number | string
  antiRollFront?: number | string
  antiRollRear?: number | string
  weightJackerRight?: number | string
  brakeBiasPct?: number
  handbrake?: number // 0..1
  waterTempC?: number
  oilTempC?: number
  oilPressureKpa?: number
  // Extra powertrain telemetry (iRacing): manifold + fuel pressure (bar), electrical
  // system voltage (V), and coolant + oil tank levels (L).
  manifoldPressBar?: number
  fuelPressBar?: number
  voltage?: number
  waterLevelL?: number
  oilLevelL?: number
  // ABS brake-pressure cut while the ABS is intervening (iRacing BrakeABSCutPct, %).
  absCutPct?: number
  // Decoded iRacing EngineWarnings bitfield — per-lamp dashboard tell-tales.
  engineWarnings?: EngineWarnings

  // Powertrain híbrido / ERS / push-to-pass (iRacing — carros híbridos GTP/LMDh, IndyCar)
  ersBatteryPct?: number // EnergyERSBatteryPct (0..1) — carga da bateria do ERS/híbrido
  pushToPass?: boolean // PushToPass (button) / P2P_Status (ativo) — undefined se o carro não tem P2P
  pushToPassCount?: number // P2P_Count — usos restantes/contagem na race

  // Session / tempo
  sessionType?: string
  // Overall session phase from irsdk_SessionState (use sessionStateLabel to decode).
  sessionState?: SessionState
  // Pace/formation state from irsdk_PaceMode (use paceModeLabel to decode).
  paceMode?: PaceMode
  // Active pace situations from the irsdk_PaceFlags bitfield (use paceFlagsList).
  paceFlags?: string[]
  carName?: string
  /** iRacing player CarPath (the car's internal folder slug, e.g. "mx5 mx52016").
   *  Stable across UI languages and renames, unlike the localized carName — soundshift
   *  keys its per-car tuning on this. */
  carPath?: string
  trackName?: string
  /** iRacing WeekendInfo.TrackConfigName — the LAYOUT within a track (e.g. "Grand
   *  Prix" vs "International"). Undefined for tracks with a single configuration.
   *  Used to key per-layout learners (pace model, corner map) so two layouts of one
   *  track don't share a model. */
  trackConfigName?: string
  sessionTimeRemainingSec?: number
  sessionNumber?: number
  sessionTimeSec?: number
  lapsRemaining?: number
  currentLap?: number
  completedLaps?: number
  lapDistPct?: number // 0..1
  lapDistanceM?: number
  lastLapTimeSec?: number
  bestLapTimeSec?: number
  bestNLapLap?: number
  bestNLapTimeSec?: number
  currentLapTimeSec?: number
  estimatedLapTimeSec?: number
  deltaToBestSec?: number
  deltaToSessionBestSec?: number
  // Delta (s) to the OPTIMAL (theoretical best-sectors) lap, the session optimal lap, and
  // the driver's own best (iRacing LapDeltaToOptimalLap/SessionOptimalLap/DriverBestLap).
  deltaToOptimalSec?: number
  deltaToSessionOptimalSec?: number
  deltaToDriverBestSec?: number
  position?: number
  classPosition?: number
  totalCars?: number
  strengthOfField?: number
  sessionUniqueId?: number // p/ Team Fuel sharing — identifica a sessão única do iRacing
  driverName?: string // nome do piloto do jogador (player car)
  sessionTimeOfDay?: number // SessionTimeOfDay — segundos desde a meia-noite (use formatTimeOfDay p/ HH:MM)
  onTrack?: boolean
  cameraCarIdx?: number
  replayPlaying?: boolean
  replayFrameNum?: number
  replayFrameEnd?: number
  replayContext?: ReplayContext

  // BoP / penalidades (iRacing)
  weightPenaltyKg?: number // PlayerCarWeightPenalty — lastro de BoP em kg
  powerAdjustPct?: number // PlayerCarPowerAdjust — ajuste de potência de BoP em %

  // Fuel
  fuelLiters?: number
  /** @deprecated Ambiguous legacy field. Use fuelPerLapLiters or fuelPerLapKg. */
  fuelPerLap?: number
  fuelPerLapLiters?: number // observed FuelLevel delta averaged across completed laps
  fuelLapsRemaining?: number // fuelLiters / fuelPerLapLiters
  fuelUsePerHourKg?: number
  fuelPerLapKg?: number
  fuelCapacityLiters?: number
  fuelLevelPct?: number // FuelLevelPct — fuel in tank as a 0..1 fraction of capacity
  /** Current fuel mass when a provider exposes it; setup experiments may otherwise use an explicit litres-to-mass estimate. */
  fuelMassKg?: number

  // Tires / brakes
  tyres?: Corners<TyreInfo>
  brakeTempC?: Corners<number>
  // Brake-line hydraulic pressure per corner (iRacing LF/RF/LR/RRbrakeLinePress, bar).
  brakeLinePressBar?: Corners<number>
  // Pressão FRIA dos tires (definida na garagem), kPa. IMPORTANTE: o iRacing NÃO expõe
  // pressão de tire AO VIVO como telemetria — apenas as pressões frias
  // (LFcoldPressure/RFcoldPressure/LRcoldPressure/RRcoldPressure). Nomeado explicitamente
  // como "cold" para não ser confundido com pressão dinâmica em tempo real.
  tireColdPressuresKpa?: Corners<number>
  pitTyreTargetsKpa?: Corners<number>

  // Bandeiras / iRacing extras
  flags?: Flags
  sessionFlagsRaw?: number
  pitLimiter?: boolean
  onPitRoad?: boolean
  pitServiceFlags?: string[] // ex.: ['fuel','lf','rf','fastRepair']
  pitFuelToAddL?: number
  repairTimeSec?: number
  optionalRepairTimeSec?: number
  pitStopActive?: boolean
  /** Explicit refuel-service state when the provider can distinguish it from a generic pit stop. */
  refuelServiceActive?: boolean
  // Status de pit (iRacing): pits abertos, carro no box, status do serviço e reparos.
  // repairNeeded/optRepairNeeded são DERIVADOS de PitRepairLeft/PitOptRepairLeft > 0.
  pit?: PitStatus
  incidentCount?: number
  incidentCountMy?: number
  incidentCountTeam?: number
  incidentLimit?: number
  fastRepairsUsed?: number
  fastRepairsAvailable?: number

  // Clima (iRacing rain)
  trackTempC?: number
  airTempC?: number
  trackWetnessPct?: number // 0..1
  isRaining?: boolean
  gripPct?: number // 0..1
  weatherDeclaredWet?: boolean // WeatherDeclaredWet — o comissário liberou tires de rain
  trackSurfaceMaterial?: number // PlayerTrackSurfaceMaterial (enum irsdk_TrkSurf) — use trackSurfaceMaterialLabel
  precipitationPct?: number
  airDensityKgM3?: number
  airPressureKpa?: number
  /** Legacy raw iRacing atmospheric pressure in inches of mercury. */
  airPressureHg?: number
  weatherType?: number
  trackLengthKm?: number
  /** Normalized experiment context signals. Missing values remain unknown and fail closed. */
  tyreStatePct?: number
  trafficDensity?: number
  flagStateIndex?: number
  damagePct?: number
  lapValidity?: 'valid' | 'invalid' | 'unknown'
  towReset?: boolean
  // Extra environment telemetry (iRacing): fog + relative humidity (0..1), wind speed (m/s)
  // + direction (rad), solar altitude/azimuth (rad), and the Skies enum (0=clear..3=overcast).
  fogPct?: number
  humidityPct?: number
  windSpeedMs?: number
  windDirRad?: number
  solarAltitudeRad?: number
  solarAzimuthRad?: number
  skies?: number

  // Standings / relativo
  playerCarIdx?: number
  drivers?: DriverEntry[]
  relatives?: RelativeCars
  radarCars?: RadarCarEntry[]

  // Proximity spotter signal. `carLeftRight` is the AUTHORITATIVE decided side
  // (from the iRacing CarLeftRight flag) used to drive the spoken left/right
  // callout; `carLeftRightRaw` keeps the raw enum int for diagnostics/logging
  // (it also distinguishes 1-car vs 2-cars on a side: 5=2CarsLeft, 6=2CarsRight).
  carLeftRight?: CarLeftRightState
  carLeftRightRaw?: number
  // Number of cars on the busy side (1 or 2) decoded from the CarLeftRight enum
  // (2 for LR2CarsLeft/LR2CarsRight). Undefined when no car is alongside.
  carLeftRightCount?: number

  // Position/orientação do carro do jogador (para construção de track map).
  // Todos opcionais — providers podem omitir se o sim/replay não expuser.
  lat?: number // graus (latitude geográfica fornecida pelo sim, quando houver)
  lon?: number // graus (longitude geográfica)
  velocityX?: number // m/s — frame do carro/mundo conforme o sim (iRacing: car frame)
  velocityY?: number // m/s — frame do carro/mundo conforme o sim
  yawNorth?: number // rad — yaw relativo ao Norte (iRacing YawNorth)
}

export function fuelPerLapLitersOf(snapshot: TelemetrySnapshot | null | undefined): number | undefined {
  const explicit = snapshot?.fuelPerLapLiters
  if (typeof explicit === 'number' && Number.isFinite(explicit) && explicit > 0) return explicit

  const legacy = snapshot?.fuelPerLap
  const legacyIsFinite = typeof legacy === 'number' && Number.isFinite(legacy) && legacy > 0
  const legacyIsKnownMass =
    snapshot?.sim === 'iracing' &&
    typeof snapshot.fuelPerLapKg === 'number' &&
    Number.isFinite(snapshot.fuelPerLapKg)
  return legacyIsFinite && !legacyIsKnownMass ? legacy : undefined
}

export function fuelLapsRemainingOf(snapshot: TelemetrySnapshot | null | undefined): number | undefined {
  const direct = snapshot?.fuelLapsRemaining
  if (typeof direct === 'number' && Number.isFinite(direct) && direct >= 0) return direct

  const fuelLiters = snapshot?.fuelLiters
  const fuelPerLapLiters = fuelPerLapLitersOf(snapshot)
  if (
    typeof fuelLiters !== 'number' ||
    !Number.isFinite(fuelLiters) ||
    fuelLiters < 0 ||
    fuelPerLapLiters === undefined
  ) {
    return undefined
  }
  return fuelLiters / fuelPerLapLiters
}

export interface TelemetryStatus {
  source: TelemetrySource
  active: SimId
  connected: boolean
  rateHz: number
}

// ─── iRacing diagnostics ─────────────────────────────────────────────────────
// Structured, step-by-step report of the native iRacing bridge so the built app
// can show exactly where the shared-memory read pipeline stops (no devtools needed).
export interface IRacingMmfDiagnostics {
  platform: string
  koffiLoaded: boolean
  nativeLoaded: boolean
  fileMappingOpened: boolean
  viewMapped: boolean
  dataEventOpened: boolean
  headerRead: boolean
  status: number | null
  statusConnected: boolean
  numVars: number | null
  bufLen: number | null
  numBuf: number | null
  tickRate: number | null
  valuesDecoded: number | null
  sampleVars: Record<string, unknown>
  notes: string[]
}

export interface IRacingDiagnostics {
  timestamp: number
  hub: TelemetryStatus
  provider: {
    started: boolean
    isConnected: boolean
    polledConnected: boolean
    sample?: {
      speedKmh?: number
      rpm?: number
      gear?: number
      currentLap?: number
    }
  }
  mmf: IRacingMmfDiagnostics
}
