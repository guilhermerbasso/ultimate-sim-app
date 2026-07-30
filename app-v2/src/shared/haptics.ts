// Tátil / Bass Shaker & Haptics — shared model (SimHub "ShakeIt"-style tactile feedback).
//
// Single source of truth shared by THREE consumers:
//   1. the renderer Web Audio engine (lib/haptics-runtime.ts) — the PRIMARY
//      bass-shaker path: low-frequency oscillators whose gain is driven by
//      telemetry, summed into a master output routed to a selectable audio sink
//      that feeds the shaker amplifier;
//   2. the config UI (views/HapticsView.tsx);
//   3. the main-process module (main/modules/haptics.ts) — persistence + the
//      OPTIONAL Arduino vibration-motor path.
//
// Keep this file dependency-free (only the telemetry type): it must be
// importable from main, preload and renderer alike — mirrors shared/soundshift.ts.

import type { TelemetrySnapshot } from './telemetry'

// ─── Effects ──────────────────────────────────────────────────────────────────

export type HapticsEffectId =
  | 'engine'
  | 'gearShift'
  | 'abs'
  | 'wheelLock'
  | 'kerb'
  | 'roadTexture'
  | 'impact'
  | 'tcCut'
  | 'suspension'
  | 'gearGrind'

export const HAPTICS_EFFECT_IDS: HapticsEffectId[] = [
  'engine',
  'gearShift',
  'abs',
  'wheelLock',
  'kerb',
  'roadTexture',
  'impact',
  'tcCut',
  'suspension',
  'gearGrind'
]

// Transient effects fire a one-shot envelope on a rising edge / spike; the rest
// track a smoothed level every telemetry tick (continuous, some amplitude-pulsed).
export const HAPTICS_TRANSIENT_EFFECTS: HapticsEffectId[] = ['gearShift', 'kerb', 'impact', 'tcCut', 'gearGrind']

export function isTransientEffect(id: HapticsEffectId): boolean {
  return HAPTICS_TRANSIENT_EFFECTS.includes(id)
}

export interface HapticsEffectConfig {
  enabled: boolean
  // Carrier frequency in Hz delivered to the shaker. Low frequencies (40–90 Hz)
  // are where transducers move the most air/body.
  frequencyHz: number
  // Upper carrier frequency for effects that sweep with a signal (engine RPM).
  // Undefined for fixed-frequency effects.
  frequencyToHz?: number
  // Per-effect intensity (0..1), multiplied by the global masterGain.
  intensity: number
  // Input window mapped to 0..1 output: below `minThreshold` is silent, at/above
  // `maxThreshold` is full. The input signal differs per effect (see meta.signal).
  minThreshold: number
  maxThreshold: number
  // 0 = instant, 1 = very slow. Time-smoothing applied to the effect level so it
  // doesn't crackle. Ignored for the attack of transient pulses.
  smoothing: number
  // Also drive this effect on the OPTIONAL Arduino vibration-motor output
  // (discrete buzzes). Only honored for discrete-friendly effects (see main).
  arduino: boolean
}

export interface HapticsArduinoConfig {
  enabled: boolean
  // Secondary serial device id (from the serial hub / "Arduinos" hub). NEVER the
  // SIM-X primary — discrete buzzes go to a vibration motor on a companion board.
  deviceId: string
  // ms floor between buzzes per effect, so a motor isn't machine-gunned.
  minIntervalMs: number
}

export interface HapticsConfig {
  version: 1
  // Global master switch and a big mute. Mute keeps the config but silences output.
  enabled: boolean
  muted: boolean
  // Global output gain (0..1) multiplying every effect.
  masterGain: number
  // Audio output device (HTMLMediaElement/AudioContext sinkId) that feeds the
  // bass-shaker amplifier. Empty string = system default.
  outputDeviceId: string
  effects: Record<HapticsEffectId, HapticsEffectConfig>
  arduino: HapticsArduinoConfig
  updatedAt: number
}

export const HAPTICS_CHANNELS = {
  getConfig: 'haptics:getConfig',
  setConfig: 'haptics:setConfig',
  configEvent: 'haptics:config',
  testArduino: 'haptics:testArduino'
} as const

// ─── Defaults ───────────────────────────────────────────────────────────────

export const DEFAULT_HAPTICS_CONFIG: HapticsConfig = {
  version: 1,
  enabled: false,
  muted: false,
  masterGain: 0.8,
  outputDeviceId: '',
  effects: {
    engine: { enabled: false, frequencyHz: 45, frequencyToHz: 70, intensity: 0.75, minThreshold: 0.1, maxThreshold: 0.98, smoothing: 0.18, arduino: false },
    gearShift: { enabled: false, frequencyHz: 60, intensity: 0.9, minThreshold: 0, maxThreshold: 1, smoothing: 0, arduino: false },
    abs: { enabled: false, frequencyHz: 55, intensity: 0.85, minThreshold: 0.2, maxThreshold: 1, smoothing: 0.06, arduino: false },
    wheelLock: { enabled: false, frequencyHz: 80, intensity: 0.8, minThreshold: 0.5, maxThreshold: 1, smoothing: 0.1, arduino: false },
    kerb: { enabled: false, frequencyHz: 60, intensity: 0.7, minThreshold: 0.15, maxThreshold: 1, smoothing: 0, arduino: false },
    roadTexture: { enabled: false, frequencyHz: 50, intensity: 0.35, minThreshold: 0.05, maxThreshold: 1, smoothing: 0.28, arduino: false },
    impact: { enabled: false, frequencyHz: 65, intensity: 1, minThreshold: 0.3, maxThreshold: 1, smoothing: 0, arduino: false },
    tcCut: { enabled: false, frequencyHz: 55, intensity: 0.75, minThreshold: 0, maxThreshold: 1, smoothing: 0, arduino: false },
    suspension: { enabled: false, frequencyHz: 45, intensity: 0.45, minThreshold: 0.05, maxThreshold: 1, smoothing: 0.2, arduino: false },
    gearGrind: { enabled: false, frequencyHz: 70, intensity: 0.8, minThreshold: 0, maxThreshold: 1, smoothing: 0, arduino: false }
  },
  arduino: { enabled: false, deviceId: '', minIntervalMs: 120 },
  updatedAt: 0
}

// ─── UI metadata ──────────────────────────────────────────────────────────────

export interface HapticsEffectMeta {
  id: HapticsEffectId
  label: string
  blurb: string
  // Which telemetry signal drives this effect (shown in the UI for tuning).
  signal: string
  freqMin: number
  freqMax: number
  transient: boolean
  sweep: boolean
  // True when the effect leans on telemetry the current provider may not expose,
  // so the UI can flag it as "best-effort heuristic".
  heuristic: boolean
}

export const HAPTICS_EFFECT_META: Record<HapticsEffectId, HapticsEffectMeta> = {
  engine: { id: 'engine', label: 'Engine / RPM', blurb: 'Continuous vibration that follows engine RPM.', signal: 'rpm / maxRpm (weighted by throttle)', freqMin: 30, freqMax: 90, transient: false, sweep: true, heuristic: false },
  gearShift: { id: 'gearShift', label: 'Gear shift', blurb: 'Short pulse on every gear change.', signal: 'gear change', freqMin: 40, freqMax: 90, transient: true, sweep: false, heuristic: false },
  abs: { id: 'abs', label: 'ABS', blurb: 'Fast on/off pulse while ABS is active.', signal: 'absActive + brake', freqMin: 40, freqMax: 80, transient: false, sweep: false, heuristic: false },
  wheelLock: { id: 'wheelLock', label: 'Lockup / slide', blurb: 'Irregular vibration when locking a wheel under braking or losing traction.', signal: 'brake + deceleration / tcActive (heuristic)', freqMin: 60, freqMax: 110, transient: false, sweep: false, heuristic: true },
  kerb: { id: 'kerb', label: 'Kerbs / rumble', blurb: 'Dry pulses when riding kerbs.', signal: 'lateral acceleration (heuristic ? ideal: vertical accel)', freqMin: 45, freqMax: 80, transient: true, sweep: false, heuristic: true },
  roadTexture: { id: 'roadTexture', label: 'Road texture', blurb: 'Continuous low-amplitude rumble based on speed.', signal: 'speedKmh', freqMin: 35, freqMax: 70, transient: false, sweep: false, heuristic: false },
  impact: { id: 'impact', label: 'Impacts / collision', blurb: 'Strong burst on crashes and sudden speed drops.', signal: 'long./lat. acceleration peak (derived)', freqMin: 45, freqMax: 90, transient: true, sweep: false, heuristic: true },
  tcCut: { id: 'tcCut', label: 'TC Cut', blurb: 'Fast pulse when traction control cuts power.', signal: 'tcActive + throttle > 25%', freqMin: 40, freqMax: 80, transient: true, sweep: false, heuristic: false },
  suspension: { id: 'suspension', label: 'Suspension / G-Force', blurb: 'Rumble proportional to lateral and longitudinal force.', signal: '|latAccel| + |longAccel|*0.5 normalized by speed', freqMin: 30, freqMax: 70, transient: false, sweep: false, heuristic: true },
  gearGrind: { id: 'gearGrind', label: 'Gear grind', blurb: 'Short pulse on harsh downshifts (gearbox grind simulation).', signal: 'downshift + brake > 30% + low RPM', freqMin: 55, freqMax: 90, transient: true, sweep: false, heuristic: true }
}

// ─── Derived telemetry signals (pure, stateless over a 2-sample window) ───────

export interface HapticsFrame {
  // Continuous raw signals, 0..1 (before the per-effect min/max window + intensity).
  engine: number
  engineRpmFrac: number
  roadTexture: number
  wheelLock: number
  suspension: number
  // Discrete / transient raw signals.
  absActive: boolean
  gearShift: boolean
  kerb: number
  impact: number
  tcCut: boolean
  gearGrind: boolean
  // Derived kinematics exposed for the UI / debugging.
  longAccelMs2: number
  latAccelMs2: number
}

const EMPTY_FRAME: HapticsFrame = {
  engine: 0,
  engineRpmFrac: 0,
  roadTexture: 0,
  wheelLock: 0,
  suspension: 0,
  absActive: false,
  gearShift: false,
  kerb: 0,
  impact: 0,
  tcCut: false,
  gearGrind: false,
  longAccelMs2: 0,
  latAccelMs2: 0
}

// Impact spike window (m/s²). ~18 m/s² ≈ 1.8 g of sudden change starts to register;
// ~80 m/s² is a hard crash. Tuned conservatively so normal hard braking (~12–15
// m/s²) does not trip it.
const IMPACT_FLOOR_MS2 = 18
const IMPACT_CEIL_MS2 = 80

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return value < 0 ? 0 : value > 1 ? 1 : value
}

export function clamp(value: number, min: number, max: number, fallback: number): number {
  if (value == null || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, value))
}

// Map a raw value to 0..1 across [min,max]. Returns 0 when the window is invalid.
export function normalizeRange(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 0
  if (max <= min) return value >= max ? 1 : 0
  return clamp01((value - min) / (max - min))
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp01(t)
}

function speedMsOf(snap: TelemetrySnapshot): number {
  if (Number.isFinite(snap.speedKmh)) return Math.max(0, snap.speedKmh) / 3.6
  return 0
}

function normalizeAngle(rad: number): number {
  let a = rad
  while (a > Math.PI) a -= 2 * Math.PI
  while (a < -Math.PI) a += 2 * Math.PI
  return a
}

// Apply a per-effect window + intensity to a raw 0..1 signal. Used by both the
// audio engine and the Arduino path so they agree on "how strong is this effect".
export function effectLevel(raw: number, cfg: HapticsEffectConfig): number {
  if (!cfg.enabled) return 0
  if (raw <= cfg.minThreshold) return 0
  const t = normalizeRange(raw, cfg.minThreshold, cfg.maxThreshold)
  return clamp01(cfg.intensity) * t
}

// The GLOBAL gate every haptic output path must apply before it energises
// anything: the master enable, the mute, and the master gain. `effectLevel`
// only knows about a single effect's own enable/intensity, so a path that uses
// it alone will happily drive a physical motor while the user believes haptics
// are muted (P1-10). Returns 0 when nothing may be driven.
export function globalHapticsGain(cfg: HapticsConfig): number {
  if (!cfg.enabled || cfg.muted) return 0
  return clamp01(cfg.masterGain)
}

// Carrier frequency for an effect, sweeping with the engine RPM fraction when the
// effect defines an upper bound; fixed otherwise.
export function engineCarrierHz(cfg: HapticsEffectConfig, rpmFrac: number): number {
  if (cfg.frequencyToHz == null) return cfg.frequencyHz
  return lerp(cfg.frequencyHz, cfg.frequencyToHz, clamp01(rpmFrac))
}

// Derive every haptics input signal from the current + previous telemetry
// snapshots. Pure and provider-agnostic: degrades gracefully when optional fields
// (maxRpm, velocity, yaw) are missing. Heuristics are intentionally conservative.
export function deriveHapticsFrame(curr: TelemetrySnapshot | null, prev: TelemetrySnapshot | null): HapticsFrame {
  if (!curr || !curr.connected) return EMPTY_FRAME

  const rpmFrac = curr.maxRpm && curr.maxRpm > 0 ? clamp01(curr.rpm / curr.maxRpm) : clamp01(curr.rpm / 8000)
  const throttle = clamp01(curr.throttle)
  const brake = clamp01(curr.brake)
  // Engine body grows with revs and loads up further on throttle.
  const engine = clamp01(rpmFrac * (0.6 + 0.4 * throttle))
  const roadTexture = clamp01(speedMsOf(curr) / (240 / 3.6))
  const absActive = curr.absActive === true && brake > 0.03

  const frame: HapticsFrame = {
    ...EMPTY_FRAME,
    engine,
    engineRpmFrac: rpmFrac,
    roadTexture,
    absActive,
    tcCut: curr.tcActive === true && throttle > 0.25
  }

  if (prev) {
    const dt = (curr.timestamp - prev.timestamp) / 1000
    if (Number.isFinite(dt) && dt > 0 && dt <= 0.5) {
      const speedMs = speedMsOf(curr)
      const prevSpeedMs = speedMsOf(prev)
      const longAccel = (speedMs - prevSpeedMs) / dt // + accelerating, − braking
      let latAccel = 0
      if (Number.isFinite(curr.yawNorth) && Number.isFinite(prev.yawNorth)) {
        const yawRate = normalizeAngle((curr.yawNorth as number) - (prev.yawNorth as number)) / dt
        latAccel = yawRate * speedMs
      }
      frame.longAccelMs2 = longAccel
      frame.latAccelMs2 = latAccel

      // Gear shift: any change of gear (covers up/down, and into reverse/neutral).
      frame.gearShift = Number.isFinite(curr.gear) && Number.isFinite(prev.gear) && curr.gear !== prev.gear

      // Impact: a spike on the largest of |long|, |lat| acceleration.
      const spike = Math.max(Math.abs(longAccel), Math.abs(latAccel))
      frame.impact = normalizeRange(spike, IMPACT_FLOOR_MS2, IMPACT_CEIL_MS2)

      // Wheel lock / spin heuristic (no per-wheel speeds available):
      //  • lock under braking → hard decel while braking, dampened when ABS catches it;
      //  • power-on spin → rpm climbing while the car barely accelerates, or TC active.
      const decel = Math.max(0, -longAccel)
      let lock = 0
      if (brake > 0.55 && speedMs > 5) {
        lock = normalizeRange(brake, 0.55, 1) * (0.5 + 0.5 * normalizeRange(decel, 8, 25))
        if (absActive) lock *= 0.4
      }
      let spin = 0
      const rpmRate = (curr.rpm - prev.rpm) / dt
      if (throttle > 0.6 && speedMs > 2 && rpmRate > 500 && longAccel < 1) {
        spin = normalizeRange(throttle, 0.6, 1)
      }
      if (curr.tcActive === true && throttle > 0.3) spin = Math.max(spin, 0.6)
      frame.wheelLock = clamp01(Math.max(lock, spin))

      // Kerb proxy: sharp lateral disturbance at racing speed, away from heavy
      // braking. Coarse — real fidelity needs a vertical-accel or kerb signal.
      if (speedMs > 12 && brake < 0.7) {
        frame.kerb = normalizeRange(Math.abs(latAccel), 14, 28) * (1 - 0.5 * brake) * 0.6
      }

      // Suspension G-force: proportional to combined lateral + longitudinal load.
      if (speedMs > 5) {
        const gForce = (Math.abs(latAccel) + Math.abs(longAccel) * 0.5) / 20
        frame.suspension = clamp01(gForce * clamp01(speedMs / 30))
      }

      // Gear grind: abrupt downshift under braking at low RPM (missed rev-match).
      const isDownshift = Number.isFinite(curr.gear) && Number.isFinite(prev.gear) && curr.gear < prev.gear && curr.gear >= 1
      const prevRpmFrac = prev.maxRpm && prev.maxRpm > 0 ? clamp01(prev.rpm / prev.maxRpm) : clamp01(prev.rpm / 8000)
      frame.gearGrind = isDownshift && brake > 0.30 && prevRpmFrac < 0.45
    }
  }

  return frame
}
