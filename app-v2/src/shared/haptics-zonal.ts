// Zonal Haptics Engine — shared PURE model.
//
// A ZONE-aware layer on top of the existing bass-shaker/haptics model
// (shared/haptics.ts). Where shared/haptics.ts answers "how strong is each
// EFFECT right now", this file answers "which part of the RIG should buzz, and
// how hard" by mapping a small set of telemetry EVENTS (kerb strike, lockup,
// wheelspin, contact/g-spike, gearshift, redline) onto a configurable set of
// physical ZONES (seat, pedals-left, pedals-right, wheel).
//
// PURE + dependency-light: it only imports the telemetry type and the pure
// helpers/derivation already in shared/haptics.ts (deriveHapticsFrame). It is
// therefore importable from main, preload and renderer alike, and is fully
// unit-tested as a deterministic function of (curr, prev, config).
//
// HARDWARE NOTE: the *real* tactile sensation needs bass-shakers / tactile
// transducers (e.g. Dayton Audio pucks) wired to per-zone amplifier channels,
// or per-zone vibration motors. This module produces the per-zone INTENSITY
// signal only; the main module routes it to whatever hardware exists, and the
// renderer view renders a VISUAL simulator so the mapping is usable WITHOUT any
// transducer installed.

import type { TelemetrySnapshot } from './telemetry'
import { clamp, clamp01, deriveHapticsFrame, normalizeRange } from './haptics'

// ─── Zones & events ──────────────────────────────────────────────────────────

// Physical tactile zones of a typical sim rig. Kept deliberately small and
// rig-agnostic; the per-zone `label` in config lets the user rename a channel.
export type HapticZoneId = 'seat' | 'pedalLeft' | 'pedalRight' | 'wheel'

export const HAPTIC_ZONE_IDS: readonly HapticZoneId[] = ['seat', 'pedalLeft', 'pedalRight', 'wheel']

// Telemetry-derived tactile EVENTS routed onto the zones.
export type HapticEventId = 'kerb' | 'lockup' | 'wheelspin' | 'contact' | 'gearshift' | 'redline'

export const HAPTIC_EVENT_IDS: readonly HapticEventId[] = [
  'kerb',
  'lockup',
  'wheelspin',
  'contact',
  'gearshift',
  'redline'
]

// Transient events fire a one-shot pulse on a spike/edge; the rest track a
// smoothed level. Used by the main module to throttle re-triggers and by the
// view to flash vs. sustain a zone box.
export const HAPTIC_TRANSIENT_EVENTS: readonly HapticEventId[] = ['contact', 'gearshift']

export function isTransientHapticEvent(id: HapticEventId): boolean {
  return HAPTIC_TRANSIENT_EVENTS.includes(id)
}

// ─── Config model ────────────────────────────────────────────────────────────

export interface HapticEventConfig {
  enabled: boolean
  // Multiplier (0..1) on the raw event intensity.
  gain: number
  // Floor (0..1) below which the event is silent (de-noise small signals).
  threshold: number
  // Routing weights: how strongly this event drives each zone (0..1).
  zones: Record<HapticZoneId, number>
}

export interface HapticZoneConfig {
  enabled: boolean
  // Per-zone master multiplier (0..1).
  gain: number
  // Free-form label so a user can name the channel ("Seat", "Pedal deck L"…).
  label: string
}

// OPTIONAL secondary output: a single serial buzzer/vibration motor driven with
// the STRONGEST live zone intensity (a single motor can't address zones). Mirrors
// the haptics.ts Arduino path so it reuses the same serial-hub device + companion
// `Z<freq>:<ms>` frame. The PRIMARY per-zone feel needs bass-shaker transducers.
export interface HapticsZonalArduinoConfig {
  enabled: boolean
  // Secondary serial device id (NEVER the SIM-X primary).
  deviceId: string
  // Carrier frequency (Hz) of the buzz.
  frequencyHz: number
}

export interface HapticsZonalConfig {
  version: 1
  // Global master switch + a big mute (keeps config, silences output).
  enabled: boolean
  muted: boolean
  // Global gain (0..1) multiplying every zone.
  masterGain: number
  // ms floor between transient re-triggers per event (de-machine-gun a motor).
  minIntervalMs: number
  events: Record<HapticEventId, HapticEventConfig>
  zones: Record<HapticZoneId, HapticZoneConfig>
  arduino: HapticsZonalArduinoConfig
  updatedAt: number
}

// Per-event/per-zone output of the engine. `events` are the EFFECTIVE (post
// enabled/threshold/gain) intensities used to light the simulator; `zones` are
// the final mixed intensities sent to hardware.
export interface ZonalFrame {
  events: Record<HapticEventId, number>
  zones: Record<HapticZoneId, number>
}

// ─── Defaults ────────────────────────────────────────────────────────────────

// rpm fraction (rpm/maxRpm) at/above which the "redline" buzz starts ramping.
export const REDLINE_START_FRAC = 0.95

function zeroZones(): Record<HapticZoneId, number> {
  return { seat: 0, pedalLeft: 0, pedalRight: 0, wheel: 0 }
}

function zeroEvents(): Record<HapticEventId, number> {
  return { kerb: 0, lockup: 0, wheelspin: 0, contact: 0, gearshift: 0, redline: 0 }
}

// Default event→zone routing weights, chosen from the physical feel of each
// event. No per-wheel data exists, so lockup/wheelspin drive both pedal/seat
// zones rather than guessing a side.
const DEFAULT_EVENT_ROUTING: Record<HapticEventId, Record<HapticZoneId, number>> = {
  // Curb strike: mostly through the seat, some through the wheel rim.
  kerb: { seat: 1, pedalLeft: 0.15, pedalRight: 0.15, wheel: 0.5 },
  // Brake lockup: felt in the pedal deck (you're on the brake), a bit in seat.
  lockup: { seat: 0.3, pedalLeft: 1, pedalRight: 1, wheel: 0.2 },
  // Power-on wheelspin: rear of the seat + a wheel buzz.
  wheelspin: { seat: 0.85, pedalLeft: 0.2, pedalRight: 0.2, wheel: 0.45 },
  // Contact / g-spike: whole-body jolt.
  contact: { seat: 1, pedalLeft: 0.6, pedalRight: 0.6, wheel: 0.85 },
  // Gearshift: a wheel/shifter kick + small seat jolt.
  gearshift: { seat: 0.4, pedalLeft: 0.1, pedalRight: 0.1, wheel: 1 },
  // Redline: an upshift buzz in the wheel + seat.
  redline: { seat: 0.5, pedalLeft: 0, pedalRight: 0, wheel: 1 }
}

const DEFAULT_EVENT_GATE: Record<HapticEventId, { gain: number; threshold: number }> = {
  kerb: { gain: 0.9, threshold: 0.12 },
  lockup: { gain: 0.95, threshold: 0.18 },
  wheelspin: { gain: 0.9, threshold: 0.18 },
  contact: { gain: 1, threshold: 0.2 },
  gearshift: { gain: 0.85, threshold: 0 },
  redline: { gain: 0.7, threshold: 0.05 }
}

const DEFAULT_ZONE_LABELS: Record<HapticZoneId, string> = {
  seat: 'Banco',
  pedalLeft: 'Pedais (esq.)',
  pedalRight: 'Pedais (dir.)',
  wheel: 'Volante'
}

function defaultEvents(): Record<HapticEventId, HapticEventConfig> {
  const out = {} as Record<HapticEventId, HapticEventConfig>
  for (const id of HAPTIC_EVENT_IDS) {
    out[id] = {
      enabled: true,
      gain: DEFAULT_EVENT_GATE[id].gain,
      threshold: DEFAULT_EVENT_GATE[id].threshold,
      zones: { ...DEFAULT_EVENT_ROUTING[id] }
    }
  }
  return out
}

function defaultZones(): Record<HapticZoneId, HapticZoneConfig> {
  const out = {} as Record<HapticZoneId, HapticZoneConfig>
  for (const id of HAPTIC_ZONE_IDS) out[id] = { enabled: true, gain: 0.85, label: DEFAULT_ZONE_LABELS[id] }
  return out
}

export const DEFAULT_HAPTICS_ZONAL_CONFIG: HapticsZonalConfig = {
  version: 1,
  enabled: false,
  muted: false,
  masterGain: 0.85,
  minIntervalMs: 90,
  events: defaultEvents(),
  zones: defaultZones(),
  arduino: { enabled: false, deviceId: '', frequencyHz: 60 },
  updatedAt: 0
}

// ─── UI metadata ─────────────────────────────────────────────────────────────

export interface HapticEventMeta {
  id: HapticEventId
  label: string
  blurb: string
  signal: string
  transient: boolean
  // True when it leans on telemetry the provider may not expose / a heuristic.
  heuristic: boolean
}

export const HAPTIC_EVENT_META: Record<HapticEventId, HapticEventMeta> = {
  kerb: {
    id: 'kerb',
    label: 'Zebra / rumble',
    blurb: 'Pulsos drys ao pisar nas zebras.',
    signal: 'lateral acceleration (heuristic ? ideal: vertical accel)',
    transient: false,
    heuristic: true
  },
  lockup: {
    id: 'lockup',
    label: 'Trava de roda',
    blurb: 'Vibration when locking a wheel under braking (or ABS active).',
    signal: 'brake + deceleration / absActive',
    transient: false,
    heuristic: true
  },
  wheelspin: {
    id: 'wheelspin',
    label: 'Traction loss',
    blurb: 'Vibration when the wheel spins on acceleration (or TC cuts).',
    signal: 'throttle + giro do motor / tcActive',
    transient: false,
    heuristic: true
  },
  contact: {
    id: 'contact',
    label: 'Contato / impacto',
    blurb: 'Estouro forte em batidas e quedas bruscas de speed.',
    signal: 'long./lat. acceleration peak (derived)',
    transient: true,
    heuristic: true
  },
  gearshift: {
    id: 'gearshift',
    label: 'Troca de gear',
    blurb: 'Short pulse on every gear change.',
    signal: 'gear change',
    transient: true,
    heuristic: false
  },
  redline: {
    id: 'redline',
    label: 'Redline',
    blurb: 'Buzz crescente perto do corte para avisar o upshift.',
    signal: 'rpm / maxRpm',
    transient: false,
    heuristic: false
  }
}

export interface HapticZoneMeta {
  id: HapticZoneId
  label: string
  blurb: string
}

export const HAPTIC_ZONE_META: Record<HapticZoneId, HapticZoneMeta> = {
  seat: { id: 'seat', label: 'Banco', blurb: 'Transdutor sob o banco — corpo inteiro.' },
  pedalLeft: { id: 'pedalLeft', label: 'Pedais (esq.)', blurb: 'Canal sob a base dos pedais, lado esquerdo.' },
  pedalRight: { id: 'pedalRight', label: 'Pedais (dir.)', blurb: 'Canal sob a base dos pedais, lado direito.' },
  wheel: { id: 'wheel', label: 'Volante', blurb: 'Motor/transdutor no steering ou na coluna.' }
}

// ─── Derivation (pure) ───────────────────────────────────────────────────────

// Compute the RAW (pre-config) intensity 0..1 of every tactile event from the
// current + previous telemetry snapshots. Reuses deriveHapticsFrame so the
// kerb/contact/gearshift/redline signals stay consistent with the bass-shaker
// engine; lockup vs. wheelspin are SPLIT here by braking/throttle context
// (deriveHapticsFrame only exposes a single combined wheelLock signal).
export function deriveZonalEvents(
  curr: TelemetrySnapshot | null,
  prev: TelemetrySnapshot | null
): Record<HapticEventId, number> {
  if (!curr || !curr.connected) return zeroEvents()

  const frame = deriveHapticsFrame(curr, prev)
  const brake = clamp01(curr.brake)
  const throttle = clamp01(curr.throttle)

  // Split the combined wheelLock signal into lockup (braking) vs. wheelspin
  // (on power). The two derivations in deriveHapticsFrame are already gated by
  // brake>0.55 / throttle>0.6, so they rarely overlap; the context guard keeps
  // them on the correct event.
  const braking = brake >= 0.2 && brake >= throttle
  const onPower = throttle >= 0.2 && throttle > brake
  let lockup = braking ? frame.wheelLock : 0
  let wheelspin = onPower ? frame.wheelLock : 0
  // ABS actuating is itself a strong pedal cue even though it DAMPENS the lock
  // heuristic; surface it explicitly so the pedal deck pulses with the ABS.
  if (frame.absActive) lockup = Math.max(lockup, normalizeRange(brake, 0.05, 1) * 0.85)
  // TC cutting power is an explicit loss-of-traction cue.
  if (frame.tcCut) wheelspin = Math.max(wheelspin, 0.6)

  return {
    kerb: clamp01(frame.kerb),
    lockup: clamp01(lockup),
    wheelspin: clamp01(wheelspin),
    contact: clamp01(frame.impact),
    gearshift: frame.gearShift ? 1 : 0,
    redline: clamp01(normalizeRange(frame.engineRpmFrac, REDLINE_START_FRAC, 1))
  }
}

// Apply an event's enabled/threshold/gain gate to a raw 0..1 intensity. Returns
// 0 below threshold; otherwise re-normalizes across [threshold,1] and scales by
// gain (mirrors haptics.ts effectLevel so the two engines agree on "how strong").
export function effectiveEventLevel(raw: number, cfg: HapticEventConfig): number {
  if (!cfg.enabled) return 0
  if (!Number.isFinite(raw) || raw <= cfg.threshold) return 0
  const windowed = normalizeRange(raw, cfg.threshold, 1)
  return clamp01(windowed * clamp01(cfg.gain))
}

// Mix gated event intensities onto the zones using the routing weights, then
// apply per-zone gain + global master/mute. The global enabled/muted switches
// zero EVERYTHING (so the simulator also goes dark, matching the hardware).
export function mapEventsToZones(rawEvents: Record<HapticEventId, number>, config: HapticsZonalConfig): ZonalFrame {
  const live = config.enabled && !config.muted
  const master = live ? clamp01(config.masterGain) : 0

  const events = zeroEvents()
  for (const id of HAPTIC_EVENT_IDS) {
    events[id] = live ? effectiveEventLevel(rawEvents[id] ?? 0, config.events[id]) : 0
  }

  const zones = zeroZones()
  for (const zone of HAPTIC_ZONE_IDS) {
    const zoneCfg = config.zones[zone]
    if (!zoneCfg.enabled) continue
    let sum = 0
    for (const id of HAPTIC_EVENT_IDS) {
      const weight = clamp01(config.events[id].zones[zone] ?? 0)
      sum += events[id] * weight
    }
    zones[zone] = clamp01(sum) * clamp01(zoneCfg.gain) * master
  }

  return { events, zones }
}

// Convenience: derive + map in one call.
export function computeZonalHaptics(
  curr: TelemetrySnapshot | null,
  prev: TelemetrySnapshot | null,
  config: HapticsZonalConfig
): ZonalFrame {
  return mapEventsToZones(deriveZonalEvents(curr, prev), config)
}

// Build a synthetic raw-events map with a single event fired — used by the IPC
// `test` handler and the renderer simulator's "test" buttons.
export function rawEventsForTest(event: HapticEventId, intensity = 1): Record<HapticEventId, number> {
  const events = zeroEvents()
  events[event] = clamp01(intensity)
  return events
}

// ─── IPC channels ────────────────────────────────────────────────────────────

export const HAPTICS_ZONAL_CHANNELS = {
  getConfig: 'hapticsZonal:getConfig',
  setConfig: 'hapticsZonal:setConfig',
  configEvent: 'hapticsZonal:config',
  test: 'hapticsZonal:test'
} as const

// ─── Merge (persistence) ─────────────────────────────────────────────────────

export type HapticEventConfigPatch = {
  enabled?: boolean
  gain?: number
  threshold?: number
  zones?: Partial<Record<HapticZoneId, number>>
}

export type HapticZoneConfigPatch = Partial<HapticZoneConfig>

export type HapticsZonalConfigPatch = {
  version?: 1
  enabled?: boolean
  muted?: boolean
  masterGain?: number
  minIntervalMs?: number
  events?: Partial<Record<HapticEventId, HapticEventConfigPatch>>
  zones?: Partial<Record<HapticZoneId, HapticZoneConfigPatch>>
  arduino?: Partial<HapticsZonalArduinoConfig>
  updatedAt?: number
}

function mergeEventConfig(base: HapticEventConfig, patch: HapticEventConfigPatch): HapticEventConfig {
  const zones = { ...base.zones }
  if (patch.zones) {
    for (const zone of HAPTIC_ZONE_IDS) {
      const value = patch.zones[zone]
      if (typeof value === 'number') zones[zone] = clamp(value, 0, 1, base.zones[zone])
    }
  }
  return {
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : base.enabled,
    gain: clamp(patch.gain ?? base.gain, 0, 1, base.gain),
    threshold: clamp(patch.threshold ?? base.threshold, 0, 1, base.threshold),
    zones
  }
}

function mergeZoneConfig(base: HapticZoneConfig, patch: HapticZoneConfigPatch): HapticZoneConfig {
  return {
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : base.enabled,
    gain: clamp(patch.gain ?? base.gain, 0, 1, base.gain),
    label: typeof patch.label === 'string' && patch.label.trim().length > 0 ? patch.label.trim() : base.label
  }
}

function mergeArduinoConfig(
  base: HapticsZonalArduinoConfig,
  patch: Partial<HapticsZonalArduinoConfig>
): HapticsZonalArduinoConfig {
  return {
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : base.enabled,
    deviceId: typeof patch.deviceId === 'string' ? patch.deviceId.trim() : base.deviceId,
    frequencyHz: Math.round(clamp(patch.frequencyHz ?? base.frequencyHz, 20, 200, base.frequencyHz))
  }
}

export function mergeHapticsZonalConfig(base: HapticsZonalConfig, patch: HapticsZonalConfigPatch): HapticsZonalConfig {
  const events = {} as Record<HapticEventId, HapticEventConfig>
  for (const id of HAPTIC_EVENT_IDS) events[id] = mergeEventConfig(base.events[id], patch.events?.[id] ?? {})
  const zones = {} as Record<HapticZoneId, HapticZoneConfig>
  for (const id of HAPTIC_ZONE_IDS) zones[id] = mergeZoneConfig(base.zones[id], patch.zones?.[id] ?? {})
  return {
    version: 1,
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : base.enabled,
    muted: typeof patch.muted === 'boolean' ? patch.muted : base.muted,
    masterGain: clamp(patch.masterGain ?? base.masterGain, 0, 1, base.masterGain),
    minIntervalMs: Math.round(clamp(patch.minIntervalMs ?? base.minIntervalMs, 30, 2000, base.minIntervalMs)),
    events,
    zones,
    arduino: mergeArduinoConfig(base.arduino, patch.arduino ?? {}),
    updatedAt: Date.now()
  }
}
