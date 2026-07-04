// 3D Spotter — shared PURE model (config + spatial cue mapping + IPC channels).
//
// The pure half of the 3D Spotter. It maps nearby cars (telemetry radar metres,
// or the authoritative CarLeftRight flag) into POSITIONED spatial cues
// (pan + 3D x/z + distance + intensity). The Web Audio RUNTIME that turns these
// cues into panned tones lives in renderer/src/lib/spotter-3d.ts; the main
// module (main/modules/spotter3d.ts) persists the config. Keeping the model here
// lets main, renderer and tests share one source of truth (mirrors shared/spotter.ts).

import type { RadarCarEntry, RelativeCarEntry, TelemetrySnapshot } from './telemetry'

// ─── Config ──────────────────────────────────────────────────────────────────

export interface Spotter3DConfig {
  version: 1
  enabled: boolean
  // Master output volume (0..1).
  masterVolume: number
  // Cars beyond this straight-line distance (m) produce no cue.
  maxDistanceM: number
  // |relativeX| (m) that maps to a full left/right pan.
  panWidthM: number
  // |relativeY| (m) window within which a car counts as "alongside" (most urgent).
  alongsideM: number
  // Cull cues weaker than this (0..1).
  minIntensity: number
  // Base cue tone (Hz); cars behind are pitched a little lower.
  toneHz: number
  // Max simultaneous spatial voices.
  maxVoices: number
  updatedAt: number
}

export const DEFAULT_SPOTTER_3D_CONFIG: Spotter3DConfig = {
  version: 1,
  // Enabled by default: the spatial spotter is meant to run for the whole
  // session automatically (silent until there are nearby cars), so a fresh
  // install hears positional cues during a race without flipping any switch.
  enabled: true,
  masterVolume: 0.5,
  maxDistanceM: 30,
  panWidthM: 8,
  alongsideM: 6,
  minIntensity: 0.08,
  toneHz: 320,
  maxVoices: 3,
  updatedAt: 0
}

export type Spotter3DConfigPatch = Partial<Omit<Spotter3DConfig, 'version' | 'updatedAt'>> & {
  version?: 1
  updatedAt?: number
}

function clampN(value: number | undefined, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback
}

export function mergeSpotter3DConfig(base: Spotter3DConfig, patch: Spotter3DConfigPatch): Spotter3DConfig {
  return {
    version: 1,
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : base.enabled,
    masterVolume: clampN(patch.masterVolume, 0, 1, base.masterVolume),
    maxDistanceM: clampN(patch.maxDistanceM, 2, 200, base.maxDistanceM),
    panWidthM: clampN(patch.panWidthM, 1, 50, base.panWidthM),
    alongsideM: clampN(patch.alongsideM, 1, 50, base.alongsideM),
    minIntensity: clampN(patch.minIntensity, 0, 1, base.minIntensity),
    toneHz: clampN(patch.toneHz, 80, 2000, base.toneHz),
    maxVoices: Math.round(clampN(patch.maxVoices, 1, 6, base.maxVoices)),
    updatedAt: Date.now()
  }
}

export const SPOTTER_3D_CHANNELS = {
  getConfig: 'spotter3d:getConfig',
  setConfig: 'spotter3d:setConfig',
  configEvent: 'spotter3d:config'
} as const

// ─── Pure cue mapping ────────────────────────────────────────────────────────

export type SpatialSide = 'left' | 'right' | 'center'

export interface SpatialCue {
  id: number // carIdx (or a synthetic id for the CarLeftRight fallback)
  side: SpatialSide
  // -1 (full left) .. +1 (full right) — for the visual meter & stereo intuition.
  pan: number
  // True when the car is ahead of (or alongside) the listener, false when behind.
  // Derived from z >= 0 so the engine can pitch/voice front vs back distinctly
  // without re-deriving the sign everywhere.
  front: boolean
  // Web Audio listener frame: +x right, +z FORWARD (ahead). The engine negates z
  // for the PannerNode (which faces -z).
  x: number
  z: number
  distanceM: number
  intensity: number // 0..1
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return value < 0 ? 0 : value > 1 ? 1 : value
}

function clampPan(value: number): number {
  if (!Number.isFinite(value)) return 0
  return value < -1 ? -1 : value > 1 ? 1 : value
}

// Pure distance → proximity (0..1) mapping: 1 when on top of you, falling
// linearly to 0 at maxDistanceM and clamped beyond. Shared by the cue mapping
// and unit tests so the "near = loud, far = quiet" curve has one definition.
export function proximityFromDistance(distanceM: number, maxDistanceM: number): number {
  const max = Number.isFinite(maxDistanceM) && maxDistanceM > 0 ? maxDistanceM : 1
  const d = Number.isFinite(distanceM) ? Math.max(0, distanceM) : max
  return clamp01(1 - d / max)
}

// Pure exponential smoothing used by the runtime to ramp scalar values (gain,
// position) between frames and avoid zipper noise. alpha 0 keeps prev, alpha 1
// jumps to next; a non-finite prev (first sample) snaps straight to next.
export function smoothScalar(prev: number, next: number, alpha: number): number {
  if (!Number.isFinite(next)) return Number.isFinite(prev) ? prev : 0
  if (!Number.isFinite(prev)) return next
  const a = clamp01(alpha)
  return prev + (next - prev) * a
}

export function sideFromPan(pan: number): SpatialSide {
  if (pan <= -0.5) return 'left'
  if (pan >= 0.5) return 'right'
  return 'center'
}

// Player ground speed (m/s) used to turn a time gap (seconds) into a front/back
// distance (metres). Floored so a near-stationary car still maps a gap to a
// sensible distance instead of collapsing every cue onto the listener.
function speedMsFromSnap(snap: TelemetrySnapshot): number {
  const kmh = Number.isFinite(snap.speedKmh) ? snap.speedKmh : 0
  return Math.max(8, kmh / 3.6)
}

function cueFromRadarCar(car: RadarCarEntry, config: Spotter3DConfig, speedMs: number): SpatialCue | null {
  const x = Number.isFinite(car.relativeX) ? car.relativeX : 0
  // Front/back (z) comes from relativeY (metres, ahead +/behind −). When that is
  // missing or collapses to ~0 we fall back to the SIGNED time gap × speed, so a
  // car's ahead/behind placement survives even when the radar X/Y is unavailable.
  let z = Number.isFinite(car.relativeY) ? car.relativeY : 0
  if (Math.abs(z) < 0.01 && typeof car.gapSec === 'number' && Number.isFinite(car.gapSec) && Math.abs(car.gapSec) > 0.001) {
    z = car.gapSec * speedMs
  }
  const distance = Math.hypot(x, z)
  if (distance > config.maxDistanceM) return null

  const proximity = proximityFromDistance(distance, config.maxDistanceM)
  // Most urgent when alongside (small |relativeY|) — the "closing"/side cue.
  const alongside = 1 - clamp01(Math.abs(z) / Math.max(0.5, config.alongsideM))
  const intensity = clamp01(proximity * (0.4 + 0.6 * alongside))
  if (intensity < config.minIntensity) return null

  const pan = clampPan(x / Math.max(0.5, config.panWidthM))
  return { id: car.carIdx, side: sideFromPan(pan), pan, front: z >= 0, x, z, distanceM: distance, intensity }
}

// Front/back cues synthesised from the relatives feed (the single closest car
// ahead and behind) when no per-car radar metres exist. The SIGNED time gap is
// the only reliable directional signal here, so each cue is placed dead-centre
// (x≈0) with z = gapSec × speed — giving a real ahead (z>0)/behind (z<0) image
// even on sims/sessions that never expose radar X/Y. L/R is intentionally left
// neutral: relatives carry no lateral offset, so guessing a side would mislead.
function cuesFromRelatives(snap: TelemetrySnapshot, config: Spotter3DConfig, speedMs: number): SpatialCue[] {
  const rel = snap.relatives
  if (!rel) return []
  const out: SpatialCue[] = []
  const add = (entry: RelativeCarEntry | undefined): void => {
    if (!entry || typeof entry.gapSec !== 'number' || !Number.isFinite(entry.gapSec) || Math.abs(entry.gapSec) < 0.001) return
    const rawZ = entry.gapSec * speedMs
    const distance = Math.abs(rawZ)
    if (distance > config.maxDistanceM) return
    // Keep the boundary case audible: clamp the imaged z without dropping a cue
    // that the proximity curve still rates as in-range.
    const z = Math.max(-config.maxDistanceM, Math.min(config.maxDistanceM, rawZ))
    const proximity = proximityFromDistance(distance, config.maxDistanceM)
    const intensity = clamp01(proximity * 0.7)
    if (intensity < config.minIntensity) return
    out.push({ id: entry.carIdx, side: 'center', pan: 0, front: z >= 0, x: 0, z, distanceM: distance, intensity })
  }
  add(rel.ahead)
  add(rel.behind)
  return out
}

// Fallback when no per-car radar metres exist: synthesise coarse cues from the
// AUTHORITATIVE CarLeftRight flag (clear/left/right/both). Distance is unknown,
// so a fixed moderate intensity is used and the cue is placed at a nominal side.
function cuesFromCarLeftRight(snap: TelemetrySnapshot, config: Spotter3DConfig): SpatialCue[] {
  const state = snap.carLeftRight
  if (!state || state === 'clear') return []
  const nominalX = config.panWidthM * 0.7
  const out: SpatialCue[] = []
  const mk = (sign: -1 | 1, id: number): SpatialCue => {
    const x = sign * nominalX
    const pan = clampPan(x / Math.max(0.5, config.panWidthM))
    return { id, side: sideFromPan(pan), pan, front: true, x, z: 0, distanceM: Math.abs(x), intensity: 0.6 }
  }
  if (state === 'left' || state === 'both') out.push(mk(-1, -1))
  if (state === 'right' || state === 'both') out.push(mk(1, -2))
  return out
}

// Map the snapshot to the strongest spatial cues (radar preferred, then the
// relatives feed for front/back, then the CarLeftRight flag for L/R only),
// sorted by intensity and capped at maxVoices.
export function computeSpatialCues(snap: TelemetrySnapshot | null, config: Spotter3DConfig): SpatialCue[] {
  if (!snap || !snap.connected) return []
  const speedMs = speedMsFromSnap(snap)
  let cues: SpatialCue[] = []
  if (Array.isArray(snap.radarCars) && snap.radarCars.length > 0) {
    for (const car of snap.radarCars) {
      const cue = cueFromRadarCar(car, config, speedMs)
      if (cue) cues.push(cue)
    }
  }
  // No radar metres: prefer the relatives feed (real ahead/behind from the gap)
  // over the CarLeftRight flag (L/R only, no front/back) so front/back imaging
  // still works on sims/sessions without radar X/Y.
  if (cues.length === 0) cues = cuesFromRelatives(snap, config, speedMs)
  if (cues.length === 0) cues = cuesFromCarLeftRight(snap, config)
  cues.sort((a, b) => b.intensity - a.intensity)
  return cues.slice(0, Math.max(1, config.maxVoices))
}
