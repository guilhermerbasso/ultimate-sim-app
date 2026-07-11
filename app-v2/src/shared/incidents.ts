// Incident detection from a telemetry ring buffer — PURE, deterministic (F4).
//
// IMPORTANT: dependency-free (no node:*, no electron) like shared/strategy.ts so
// it is importable from main, renderer AND unit tests. It carries ONLY types +
// pure math. The main-process `incident-recorder` module keeps the rolling ring
// buffer and persists the JSON "clips"; the detection RULES live here so they are
// trivially unit-testable with synthetic telemetry.
//
// Detections (all approximate, documented per-rule):
//   • spin     — high yaw-rate / slip while the car is still moving.
//   • off-track— the player surface is grass/gravel/sand/dirt/astroturf.
//   • contact  — a sudden speed drop or acceleration (g) spike between samples.
//   • lockup   — hard braking with a sharp deceleration jerk (flat-spot risk).

import type { TelemetrySnapshot } from './telemetry'
import { formatMeasurement, type UnitSystem } from './units'
import { trackSurfaceMaterialLabel } from './telemetry'

// ─── IPC channels (module + renderer agree on these) ─────────────────────────

export const INCIDENT_CHANNELS = {
  /** Broadcast: a freshly saved incident clip (metadata). */
  added: 'incidents:added',
  /** invoke() → IncidentClipMeta[] (newest first). */
  list: 'incidents:list',
  /** invoke(id) → IncidentClip | null. */
  get: 'incidents:get',
  /** invoke(IncidentAnalyzeRequest) → IncidentAnalysis. */
  analyze: 'incidents:analyze',
  /** invoke() → number cleared. */
  clear: 'incidents:clear'
} as const

export type IncidentChannel = (typeof INCIDENT_CHANNELS)[keyof typeof INCIDENT_CHANNELS]

// ─── types ──────────────────────────────────────────────────────────────────

export type IncidentType = 'spin' | 'off-track' | 'contact' | 'lockup'
export type IncidentSeverity = 'minor' | 'moderate' | 'major'

export interface IncidentDetectionConfig {
  /** Yaw-rate magnitude (rad/s) that flags a spin while moving. */
  spinYawRateRadSec: number
  /** Minimum speed (km/h) for a spin to count (parked-car twitches don't). */
  spinMinSpeedKmh: number
  /** Per-sample g jump (long/lat/vert) that flags contact. */
  contactGSpike: number
  /** Per-sample speed drop (km/h) that flags contact. */
  contactSpeedDropKmh: number
  /** Brake fraction (0..1) required to consider a lockup. */
  lockupBrake: number
  /** Deceleration (g, positive magnitude) jerk that flags a lockup. */
  lockupDecelG: number
  /** Surfaces treated as "off track". */
  offTrackSurfaces: string[]
  /** Dedupe: minimum ms between two incidents of the SAME type. */
  minGapMs: number
}

export const DEFAULT_INCIDENT_CONFIG: IncidentDetectionConfig = {
  spinYawRateRadSec: 1.2,
  spinMinSpeedKmh: 25,
  contactGSpike: 2.5,
  contactSpeedDropKmh: 22,
  lockupBrake: 0.85,
  lockupDecelG: 1.6,
  offTrackSurfaces: ['grass', 'gravel', 'sand', 'racing dirt', 'dirt', 'astroturf'],
  minGapMs: 3000
}

// Compact per-sample record stored in a clip (a small subset of telemetry — the
// clip is JSON, NOT video).
export interface IncidentSample {
  t: number
  lap?: number
  lapDistPct?: number
  speedKmh?: number
  rpm?: number
  gear?: number
  throttle?: number
  brake?: number
  steerAngleDeg?: number
  latAccelG?: number
  longAccelG?: number
  vertAccelG?: number
  yawRateRadSec?: number
  surface?: string
  onPitRoad?: boolean
}

export interface IncidentMetrics {
  yawRateRadSec?: number
  latAccelG?: number
  longAccelG?: number
  vertAccelG?: number
  brake?: number
  speedKmh?: number
  speedDropKmh?: number
  gSpike?: number
  surface?: string
}

export interface IncidentEvent {
  type: IncidentType
  severity: IncidentSeverity
  /** Trigger-sample timestamp. */
  at: number
  lap?: number
  lapDistPct?: number
  metrics: IncidentMetrics
  summary: string
}

// A persisted clip = the event + a short window of pre/post samples.
export interface IncidentClip extends IncidentEvent {
  id: string
  window: IncidentSample[]
  /** Index of the trigger sample within `window`. */
  triggerIndex: number
  createdAt: number
}

export type IncidentClipMeta = Omit<IncidentClip, 'window'> & { sampleCount: number }

// ─── numeric helpers ─────────────────────────────────────────────────────────

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function abs(value: number | undefined): number {
  return finite(value) ? Math.abs(value as number) : 0
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

// ─── sample compaction ─────────────────────────────────────────────────────────

export function toIncidentSample(snapshot: TelemetrySnapshot): IncidentSample {
  return {
    t: snapshot.timestamp,
    lap: snapshot.currentLap,
    lapDistPct: finite(snapshot.lapDistPct) ? round(snapshot.lapDistPct as number, 4) : undefined,
    speedKmh: finite(snapshot.speedKmh) ? round(snapshot.speedKmh, 1) : undefined,
    rpm: finite(snapshot.rpm) ? Math.round(snapshot.rpm) : undefined,
    gear: snapshot.gear,
    throttle: finite(snapshot.throttle) ? round(snapshot.throttle, 3) : undefined,
    brake: finite(snapshot.brake) ? round(snapshot.brake, 3) : undefined,
    steerAngleDeg: finite(snapshot.steerAngleDeg) ? round(snapshot.steerAngleDeg as number, 1) : undefined,
    latAccelG: finite(snapshot.latAccelG) ? round(snapshot.latAccelG as number, 3) : undefined,
    longAccelG: finite(snapshot.longAccelG) ? round(snapshot.longAccelG as number, 3) : undefined,
    vertAccelG: finite(snapshot.vertAccelG) ? round(snapshot.vertAccelG as number, 3) : undefined,
    yawRateRadSec: finite(snapshot.yawRateRadSec) ? round(snapshot.yawRateRadSec as number, 3) : undefined,
    surface: trackSurfaceMaterialLabel(snapshot.trackSurfaceMaterial),
    onPitRoad: snapshot.onPitRoad
  }
}

// ─── single-pair classifier (the detection RULES) ─────────────────────────────

function severityFromRatio(ratio: number): IncidentSeverity {
  if (ratio >= 2) return 'major'
  if (ratio >= 1.4) return 'moderate'
  return 'minor'
}

// Classify whether the transition prev → curr triggers an incident. Pure; returns
// the single most-severe incident at `curr`, or null. `prev` may be null (first
// sample) — only surface-based off-track can fire without a predecessor.
export function classifyIncident(
  prev: TelemetrySnapshot | null,
  curr: TelemetrySnapshot,
  config: IncidentDetectionConfig = DEFAULT_INCIDENT_CONFIG,
  unitSystem: UnitSystem = 'metric'
): IncidentEvent | null {
  // Never flag incidents in the pits / not on a flying lap.
  if (curr.onPitRoad === true) return null

  const candidates: IncidentEvent[] = []
  const speed = finite(curr.speedKmh) ? curr.speedKmh : 0
  const surface = trackSurfaceMaterialLabel(curr.trackSurfaceMaterial)

  // ── off-track: player surface is an off-track material ──
  if (surface && config.offTrackSurfaces.includes(surface)) {
    const prevSurface = prev ? trackSurfaceMaterialLabel(prev.trackSurfaceMaterial) : undefined
    // Only fire on the TRANSITION onto the off-track surface (not every sample).
    if (prevSurface !== surface) {
      const severity: IncidentSeverity = speed > 150 ? 'major' : speed > 80 ? 'moderate' : 'minor'
      candidates.push({
        type: 'off-track',
        severity,
        at: curr.timestamp,
        lap: curr.currentLap,
        lapDistPct: curr.lapDistPct,
        metrics: { surface, speedKmh: finite(speed) ? round(speed, 1) : undefined },
        summary: `Off track onto ${surface} at ${formatMeasurement(speed, 'speed-kmh', unitSystem, { decimals: 0, includeUnit: true }).display}.`
      })
    }
  }

  // ── spin: high yaw-rate while moving ──
  const yaw = abs(curr.yawRateRadSec)
  if (yaw >= config.spinYawRateRadSec && speed >= config.spinMinSpeedKmh) {
    const ratio = yaw / config.spinYawRateRadSec
    candidates.push({
      type: 'spin',
      severity: severityFromRatio(ratio),
      at: curr.timestamp,
      lap: curr.currentLap,
      lapDistPct: curr.lapDistPct,
      metrics: {
        yawRateRadSec: round(yaw, 3),
        latAccelG: finite(curr.latAccelG) ? round(curr.latAccelG as number, 2) : undefined,
        speedKmh: round(speed, 1)
      },
      summary: `Spin / slide — yaw ${yaw.toFixed(1)} rad/s at ${formatMeasurement(speed, 'speed-kmh', unitSystem, { decimals: 0, includeUnit: true }).display}.`
    })
  }

  if (prev) {
    const dtMs = curr.timestamp - prev.timestamp
    // Guard against stale/duplicate frames and huge gaps (pause / teleport).
    if (dtMs > 0 && dtMs <= 600) {
      // ── contact: sudden speed drop or g spike ──
      const speedDrop = (finite(prev.speedKmh) ? prev.speedKmh : 0) - speed
      const gSpike = Math.max(
        Math.abs(abs(curr.longAccelG) - abs(prev.longAccelG)),
        Math.abs(abs(curr.latAccelG) - abs(prev.latAccelG)),
        Math.abs(abs(curr.vertAccelG) - abs(prev.vertAccelG))
      )
      const speedHit = speedDrop >= config.contactSpeedDropKmh
      const gHit = gSpike >= config.contactGSpike
      if (speedHit || gHit) {
        const ratio = Math.max(speedDrop / config.contactSpeedDropKmh, gSpike / config.contactGSpike)
        candidates.push({
          type: 'contact',
          severity: severityFromRatio(ratio),
          at: curr.timestamp,
          lap: curr.currentLap,
          lapDistPct: curr.lapDistPct,
          metrics: {
            speedDropKmh: round(Math.max(0, speedDrop), 1),
            gSpike: round(gSpike, 2),
            longAccelG: finite(curr.longAccelG) ? round(curr.longAccelG as number, 2) : undefined,
            speedKmh: round(speed, 1)
          },
          summary: gHit
            ? `Contact / impact — ${gSpike.toFixed(1)}g spike.`
            : `Contact — lost ${formatMeasurement(speedDrop, 'speed-kmh', unitSystem, { decimals: 0, includeUnit: true }).display} instantly.`
        })
      }

      // ── lockup: hard braking + sharp deceleration jerk (flat-spot risk) ──
      const brake = finite(curr.brake) ? curr.brake : 0
      const decelJerk = abs(curr.longAccelG) - abs(prev.longAccelG)
      const decelerating = finite(curr.longAccelG) ? (curr.longAccelG as number) < 0 : true
      if (brake >= config.lockupBrake && decelerating && decelJerk >= config.lockupDecelG && speed >= config.spinMinSpeedKmh) {
        const ratio = decelJerk / config.lockupDecelG
        candidates.push({
          type: 'lockup',
          severity: severityFromRatio(ratio),
          at: curr.timestamp,
          lap: curr.currentLap,
          lapDistPct: curr.lapDistPct,
          metrics: {
            brake: round(brake, 2),
            longAccelG: finite(curr.longAccelG) ? round(curr.longAccelG as number, 2) : undefined,
            speedKmh: round(speed, 1)
          },
          summary: `Lockup risk — ${Math.round(brake * 100)}% brake, ${decelJerk.toFixed(1)}g jerk (flat-spot).`
        })
      }
    }
  }

  if (candidates.length === 0) return null
  // Return the most severe; ties broken by a stable type priority.
  const severityRank: Record<IncidentSeverity, number> = { minor: 0, moderate: 1, major: 2 }
  const typeRank: Record<IncidentType, number> = { contact: 3, spin: 2, lockup: 1, 'off-track': 0 }
  candidates.sort((a, b) => {
    const bySeverity = severityRank[b.severity] - severityRank[a.severity]
    if (bySeverity !== 0) return bySeverity
    return typeRank[b.type] - typeRank[a.type]
  })
  return candidates[0]
}

// ─── window slicing ────────────────────────────────────────────────────────────

// Slice a pre/post window of samples around a trigger timestamp. Pure.
export function buildIncidentWindow(
  samples: IncidentSample[],
  triggerTime: number,
  preMs: number,
  postMs: number
): { window: IncidentSample[]; triggerIndex: number } {
  const window = samples.filter((sample) => sample.t >= triggerTime - preMs && sample.t <= triggerTime + postMs)
  let triggerIndex = window.findIndex((sample) => sample.t === triggerTime)
  if (triggerIndex < 0) {
    // Nearest sample to the trigger.
    triggerIndex = window.reduce((best, sample, index) => {
      return Math.abs(sample.t - triggerTime) < Math.abs(window[best].t - triggerTime) ? index : best
    }, 0)
  }
  return { window, triggerIndex }
}

// ─── whole-buffer scan (pure; used by tests + as a module helper) ─────────────

export interface DetectIncidentsOptions {
  config?: IncidentDetectionConfig
  unitSystem?: UnitSystem
  /** Window captured around each detected incident (ms). */
  preMs?: number
  postMs?: number
  /** Stable id prefix for generated clips. */
  idPrefix?: string
}

// Scan an ORDERED buffer of snapshots, returning every detected incident as a
// ready-to-persist clip. Dedupes incidents of the same type within `minGapMs`.
// Fully pure — the heart of the unit tests.
export function detectIncidents(samples: TelemetrySnapshot[], options: DetectIncidentsOptions = {}): IncidentClip[] {
  const config = options.config ?? DEFAULT_INCIDENT_CONFIG
  const preMs = options.preMs ?? 3000
  const postMs = options.postMs ?? 2000
  const idPrefix = options.idPrefix ?? 'inc'

  const compact = samples.map(toIncidentSample)
  const clips: IncidentClip[] = []
  const lastByType: Partial<Record<IncidentType, number>> = {}

  for (let i = 0; i < samples.length; i++) {
    const prev = i > 0 ? samples[i - 1] : null
    const event = classifyIncident(prev, samples[i], config, options.unitSystem ?? 'metric')
    if (!event) continue
    const last = lastByType[event.type]
    if (finite(last) && event.at - (last as number) < config.minGapMs) continue
    lastByType[event.type] = event.at

    const { window, triggerIndex } = buildIncidentWindow(compact, event.at, preMs, postMs)
    clips.push({
      ...event,
      id: `${idPrefix}-${event.at}-${event.type}`,
      window,
      triggerIndex,
      createdAt: event.at
    })
  }
  return clips
}

export function toClipMeta(clip: IncidentClip): IncidentClipMeta {
  const { window, ...rest } = clip
  return { ...rest, sampleCount: window.length }
}

// ─── deterministic analysis (LLM is OPTIONAL on top) ──────────────────────────

export interface IncidentAnalyzeRequest {
  id: string
  lang?: 'pt' | 'en'
  useLlm?: boolean
}

export interface IncidentAnalysis {
  id: string
  text: string
  source: 'deterministic' | 'llm'
  clip?: IncidentClipMeta
}

const TYPE_LABEL: Record<IncidentType, { pt: string; en: string }> = {
  spin: { pt: 'Rodada/escorregada', en: 'Spin / slide' },
  'off-track': { pt: 'Off track', en: 'Off track' },
  contact: { pt: 'Contato/impacto', en: 'Contact / impact' },
  lockup: { pt: 'Brake lockup', en: 'Brake lockup' }
}

const SEVERITY_LABEL: Record<IncidentSeverity, { pt: string; en: string }> = {
  minor: { pt: 'leve', en: 'minor' },
  moderate: { pt: 'moderado', en: 'moderate' },
  major: { pt: 'grave', en: 'major' }
}

// Pure, always-works summary of what happened. PT-BR by default; EN on request.
export function summarizeIncident(clip: IncidentClip, lang: 'pt' | 'en' = 'pt', unitSystem: UnitSystem = 'metric'): string {
  const pt = lang === 'pt'
  const type = TYPE_LABEL[clip.type][lang]
  const severity = SEVERITY_LABEL[clip.severity][lang]
  const lap = finite(clip.lap) ? clip.lap : undefined
  const pct = finite(clip.lapDistPct) ? Math.round((clip.lapDistPct as number) * 100) : undefined
  const where = pt
    ? `${lap ? `lap ${lap}` : 'lap ?'}${finite(pct) ? `, ${pct}% of track` : ''}`
    : `${lap ? `lap ${lap}` : 'lap ?'}${finite(pct) ? `, ${pct}% of the lap` : ''}`

  const detailBits: string[] = []
  const m = clip.metrics
  if (finite(m.speedKmh)) detailBits.push(formatMeasurement(m.speedKmh, 'speed-kmh', unitSystem, { decimals: 0, includeUnit: true }).display)
  if (finite(m.yawRateRadSec)) detailBits.push(`yaw ${(m.yawRateRadSec as number).toFixed(1)} rad/s`)
  if (finite(m.gSpike)) detailBits.push(`${(m.gSpike as number).toFixed(1)}g`)
  if (finite(m.speedDropKmh) && (m.speedDropKmh as number) > 0) {
    detailBits.push(`−${formatMeasurement(m.speedDropKmh, 'speed-kmh', unitSystem, { decimals: 0, includeUnit: true }).display}`)
  }
  if (finite(m.brake)) detailBits.push(pt ? `brake ${Math.round((m.brake as number) * 100)}%` : `brake ${Math.round((m.brake as number) * 100)}%`)
  if (m.surface) detailBits.push(m.surface)

  const detail = detailBits.length > 0 ? ` (${detailBits.join(', ')})` : ''

  return pt
    ? `${type} ${severity} na ${where}${detail}.`
    : `${severity[0].toUpperCase()}${severity.slice(1)} ${type.toLowerCase()} at ${where}${detail}.`
}
