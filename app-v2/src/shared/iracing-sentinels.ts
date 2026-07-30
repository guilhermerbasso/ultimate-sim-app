// Field-specific contract for iRacing's per-car sentinel values.
//
// iRacing does NOT use one "invalid" marker. Each channel has its own convention, and
// several channels use -1 as a LEGITIMATE value:
//
//   CarIdxGear        -1 = REVERSE                    -> valid, must survive untouched
//   CarIdxTrackSurface -1 = irsdk_NotInWorld          -> the car is not in the world
//   CarIdxLapDistPct  -1 = not in world               -> unavailable (0..1 otherwise)
//   CarIdxEstTime     < 0 = not available             -> unavailable
//   CarIdxF2Time      < 0 = not available             -> unavailable
//   CarIdx*LapTime    <= 0 = no lap set yet           -> unavailable
//   CarIdxLap(Completed) -1 = no lap / not in world   -> unavailable
//   CarIdxPosition    0 = no position                 -> unavailable
//   CarIdxPaceLine/Row -1 = not in a pace line/row    -> not applicable (unavailable)
//   PlayerCarIdx      -1 = spectating / no player car -> unavailable
//
// A blanket "reject negatives" guard would therefore be a NEW defect: it would turn
// reverse gear into an unavailable channel. Every helper here is deliberately scoped to
// one field family, and each one is covered by a test that pins the sentinel it accepts
// and the values it must NOT reject.
//
// Unavailability is expressed as `undefined` — never as 0, and never as a clamped value
// that looks plausible. A car that is not in the world must disappear from relatives,
// radar and the track map instead of being drawn on the start/finish line.

/** irsdk_TrkLoc. `notInWorld` is the sentinel; the rest are real locations. */
export const IRSDK_TRACK_SURFACE = {
  notInWorld: -1,
  offTrack: 0,
  inPitStall: 1,
  approachingPits: 2,
  onTrack: 3
} as const

export type IrsdkTrackSurface = (typeof IRSDK_TRACK_SURFACE)[keyof typeof IRSDK_TRACK_SURFACE]

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function finiteInt(value: unknown): number | undefined {
  const n = finite(value)
  return n === undefined ? undefined : Math.trunc(n)
}

/**
 * True when `CarIdxTrackSurface` reports irsdk_NotInWorld (-1): the car exists in the
 * session roster but has no position, no lap distance and no live telemetry. This is the
 * single gate that removes a car from relatives, radar and the track map.
 *
 * An ABSENT value is NOT treated as not-in-world: providers that never expose
 * CarIdxTrackSurface would otherwise lose their whole field.
 */
export function isNotInWorld(trackSurface: unknown): boolean {
  return finiteInt(trackSurface) === IRSDK_TRACK_SURFACE.notInWorld
}

/** Real track location, or undefined for the not-in-world sentinel / a missing value. */
export function carIdxTrackSurface(value: unknown): number | undefined {
  const n = finiteInt(value)
  if (n === undefined || n === IRSDK_TRACK_SURFACE.notInWorld) return undefined
  return n
}

/**
 * `CarIdxLapDistPct` is 0..1 for a car in the world and -1 when it is not. Clamping -1
 * to 0 is exactly the bug this replaces: it parks every garaged car on the start/finish
 * line and fabricates a lap-distance gap for it.
 */
export function carIdxLapDistPct(value: unknown): number | undefined {
  const n = finite(value)
  if (n === undefined || n < 0) return undefined
  return Math.min(1, n)
}

/** `CarIdxEstTime` / `CarIdxF2Time`: negative means the SDK has no estimate. */
export function carIdxEstTime(value: unknown): number | undefined {
  const n = finite(value)
  if (n === undefined || n < 0) return undefined
  return n
}

/** Lap times are only valid when strictly positive; -1 and 0 mean "no lap set". */
export function carIdxLapTime(value: unknown): number | undefined {
  const n = finite(value)
  if (n === undefined || n <= 0) return undefined
  return n
}

/** `CarIdxLap` / `CarIdxLapCompleted`: -1 means no lap yet or not in the world. */
export function carIdxLapCount(value: unknown): number | undefined {
  const n = finiteInt(value)
  if (n === undefined || n < 0) return undefined
  return n
}

/** `CarIdxPosition` / `CarIdxClassPosition`: 0 means the car has no position. */
export function carIdxPosition(value: unknown): number | undefined {
  const n = finiteInt(value)
  if (n === undefined || n <= 0) return undefined
  return n
}

/** `CarIdxBestLapNum`: -1 means no best lap has been set. */
export function carIdxLapNum(value: unknown): number | undefined {
  const n = finiteInt(value)
  if (n === undefined || n < 0) return undefined
  return n
}

/**
 * `CarIdxGear`: -1 is REVERSE and 0 is NEUTRAL — both legitimate. Only a non-finite
 * value is unavailable. This helper exists so a future "reject negatives" sweep cannot
 * silently swallow reverse.
 */
export function carIdxGear(value: unknown): number | undefined {
  return finiteInt(value)
}

/** `CarIdxRPM`: negative means the SDK is not publishing RPM for that car. */
export function carIdxRpm(value: unknown): number | undefined {
  const n = finite(value)
  if (n === undefined || n < 0) return undefined
  return n
}

/**
 * `CarIdxPaceLine` / `CarIdxPaceRow`: -1 means the car is not in a pace line/row. That
 * is "not applicable", not a number to render — it must not reach the UI as "-1".
 */
export function carIdxPaceLineOrRow(value: unknown): number | undefined {
  const n = finiteInt(value)
  if (n === undefined || n < 0) return undefined
  return n
}

/** `CarIdxP2P_Count`: negative means push-to-pass is not exposed for that car. */
export function carIdxPushToPassCount(value: unknown): number | undefined {
  const n = finiteInt(value)
  if (n === undefined || n < 0) return undefined
  return n
}

/** `PlayerCarIdx`: -1 means there is no player car (spectator / replay of another car). */
export function playerCarIdxOf(value: unknown): number | undefined {
  const n = finiteInt(value)
  if (n === undefined || n < 0) return undefined
  return n
}

/**
 * `(0, 0)` latitude/longitude is iRacing's "car not placed yet" sentinel: a real track
 * never sits on Null Island.
 */
export function hasUsablePosition(lat: unknown, lon: unknown): boolean {
  const latitude = finite(lat)
  const longitude = finite(lon)
  if (latitude === undefined || longitude === undefined) return false
  return !(latitude === 0 && longitude === 0)
}
