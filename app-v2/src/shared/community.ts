// Community share packs — LOCAL-FIRST, dependency-free, deterministic.
//
// This module is the SINGLE SOURCE OF TRUTH for the portable ".simshare" file
// format used to export/import GHOST LAPS, TELEMETRY snapshot-series and SETUPS
// as plain JSON files (no server, no account — 100% local). It is PURE: no node,
// no electron, no `Date`/`Math.random`, no filesystem. The main process owns IDs,
// timestamps and disk I/O; this file only builds/validates/compares the data so
// it can be unit-tested in isolation and reused verbatim by a FUTURE network
// backend (see CommunityBackend in src/main/modules/community-local.ts).
//
// Versioning: every pack carries `magic: 'simshare'` + `version`. `parseSharePack`
// REJECTS anything that is not exactly the current version, so a future format
// bump can never be silently misread by an old build (and vice-versa).

import type { SimId } from './telemetry'

// ─── Format constants ───────────────────────────────────────────────────────

// Magic marker stamped on every pack so a random JSON file can't be mistaken for
// a share pack. Kept lowercase + matches the `.simshare` file extension.
export const SHARE_PACK_MAGIC = 'simshare' as const

// Bump this ONLY with a matching migration in `parseSharePack`. Old files of a
// different version are rejected (never silently coerced).
export const SHARE_PACK_VERSION = 1 as const

// File extension written to disk by the main module (no leading dot).
export const SHARE_PACK_EXTENSION = 'simshare' as const

// Default number of uniform lapDistPct buckets a ghost is resampled onto. Keeps
// ghosts portable (fixed footprint) and makes `compareGhosts` align bucket-for-
// bucket regardless of the original capture rate. Matches the analysis engine's
// NUM_BINS so a ghost reads like an in-app reference lap.
export const GHOST_SAMPLE_COUNT = 200 as const

// Hard cap on imported sample arrays (untrusted .simshare files): live capture is
// already bounded far below this; reject anything absurd before mapping so a
// malformed/huge pack can't freeze the main process.
const MAX_SHARE_SAMPLES = 100000

export type SharePackKind = 'ghost' | 'telemetry' | 'setup'

// ─── Pack shapes ────────────────────────────────────────────────────────────

// Portable, mostly-optional descriptor. `createdAt` is epoch-ms supplied by the
// caller (this module never reads the clock). Identifiers (car/track) are free
// text so packs stay readable and match across sims even without numeric ids.
export interface SharePackMeta {
  createdAt: number
  sim?: SimId
  car?: string
  track?: string
  trackConfig?: string
  author?: string // local, user-chosen display name — never a network identity
  note?: string
  appVersion?: string
}

// One ghost sample on the uniform lapDistPct grid. `steer` is degrees of steering
// wheel angle (telemetry `steerAngleDeg`); defaults to 0 when the sim omits it.
// `rpm`/`gear` are optional extras kept only when the source had them.
export interface GhostSample {
  lapDistPct: number // 0..1
  speedKmh: number
  throttle: number // 0..1
  brake: number // 0..1
  steer: number // degrees
  rpm?: number
  gear?: number
}

export interface GhostLap {
  lapTimeSec?: number
  sampleCount: number
  samples: GhostSample[]
}

// One snapshot in a free-running telemetry series. `t` is milliseconds since the
// series start (monotonic, non-negative). Everything else is optional so partial
// captures still serialize.
export interface TelemetrySeriesSample {
  t: number
  lapDistPct?: number
  speedKmh?: number
  rpm?: number
  gear?: number
  throttle?: number
  brake?: number
  steer?: number
}

export interface TelemetrySeries {
  durationSec?: number
  sampleCount: number
  samples: TelemetrySeriesSample[]
}

// A shared setup. `sections` mirrors the parsed `.sto` shape (see sto-parser.ts)
// so an imported setup can be diffed with the existing setup tooling. `raw` keeps
// the original text when available so it can be re-installed byte-for-byte.
export interface SetupShare {
  format: 'sto'
  sections: Record<string, Record<string, string>>
  fileName?: string
  raw?: string
}

export interface SharePack {
  magic: typeof SHARE_PACK_MAGIC
  version: number
  kind: SharePackKind
  id: string
  meta: SharePackMeta
  ghost?: GhostLap
  telemetry?: TelemetrySeries
  setup?: SetupShare
}

// Lightweight, list-friendly projection of a pack (no heavy sample arrays).
export interface SharePackSummary {
  id: string
  kind: SharePackKind
  createdAt: number
  sim?: SimId
  car?: string
  track?: string
  trackConfig?: string
  author?: string
  note?: string
  lapTimeSec?: number
  sampleCount: number
}

// ─── Ghost compare ──────────────────────────────────────────────────────────

export interface GhostCompareBin {
  lapDistPct: number // bucket center, 0..1
  deltaSec: number // cumulative time delta A−B up to here (+ slower, − faster)
  localDeltaSec: number // marginal time gained/lost inside this bucket
  speedAKmh: number
  speedBKmh: number
  speedDeltaKmh: number // A−B (+ A faster here)
}

export interface GhostCompareRegion {
  fromPct: number
  toPct: number
  deltaSec: number // signed: negative = A gains, positive = A loses
}

export interface GhostCompareResult {
  bins: GhostCompareBin[]
  // Final cumulative delta A−B (≈ lapTimeA − lapTimeB when both lap times known).
  // Negative = A (you) is faster overall.
  totalDeltaSec: number
  lapTimeASec?: number
  lapTimeBSec?: number
  gainSec: number // total time A is FASTER than B (sum of gains, ≥ 0)
  lossSec: number // total time A is SLOWER than B (sum of losses, ≥ 0)
  bestGain?: GhostCompareRegion // contiguous stretch where A gains the most
  worstLoss?: GhostCompareRegion // contiguous stretch where A loses the most
}

// Raw, ungridded ghost input (straight off the telemetry buffer). `buildGhostLap`
// turns an arbitrary cloud of these into a clean, uniform `GhostLap`.
export interface RawGhostSample {
  lapDistPct: number
  speedKmh: number
  throttle: number
  brake: number
  steer?: number
  rpm?: number
  gear?: number
  currentLapTimeSec?: number
}

// ─── Errors ─────────────────────────────────────────────────────────────────

// Thrown by `parseSharePack`/`serializeSharePack` on any structural or version
// problem. A distinct class lets the IPC layer show a friendly message and the
// tests assert on the failure mode.
export class SharePackError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SharePackError'
  }
}

// ─── Small numeric helpers (pure) ───────────────────────────────────────────

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function finiteOrUndefined(value: unknown): number | undefined {
  return isFiniteNumber(value) ? value : undefined
}

function clamp01(value: number): number {
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

// Linear interpolation of `values` (sampled at ascending `dists`) at `target`.
// Clamps to the endpoints outside the sampled range. `values`/`dists` must be the
// same non-empty length and `dists` must be sorted ascending.
function interpolateAlong(values: number[], dists: number[], target: number): number {
  const n = values.length
  if (n === 0) return 0
  if (n === 1) return values[0]
  if (target <= dists[0]) return values[0]
  if (target >= dists[n - 1]) return values[n - 1]

  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (dists[mid] <= target) lo = mid
    else hi = mid
  }
  const span = dists[hi] - dists[lo]
  if (span <= 0) return values[lo]
  const frac = (target - dists[lo]) / span
  return values[lo] + (values[hi] - values[lo]) * frac
}

// Cumulative lap time per bucket from a bucketed speed trace. Δt in each bucket is
// proportional to 1/speed; the integral is renormalized so the final value equals
// `totalSec`. Mirrors the analysis engine so ghost deltas read like in-app deltas.
// Falls back to a flat ramp when speeds are unusable.
function cumulativeTimeFromSpeed(binSpeedKmh: number[], totalSec: number): number[] {
  const n = binSpeedKmh.length
  if (n === 0) return []
  const inv = binSpeedKmh.map((s) => (s > 1 ? 1 / s : 1))
  const total = inv.reduce((acc, v) => acc + v, 0)
  if (!(total > 0) || !(totalSec > 0)) {
    return binSpeedKmh.map((_, i) => (totalSec * (i + 1)) / n)
  }
  const cum: number[] = []
  let acc = 0
  for (const v of inv) {
    acc += v
    cum.push((acc / total) * totalSec)
  }
  return cum
}

// ─── Ghost building + resampling ────────────────────────────────────────────

interface ResampledGhost {
  centers: number[]
  speed: number[]
  cumTimeSec: number[]
  lapTimeSec: number
}

function sanitizeRawSamples(samples: readonly RawGhostSample[]): RawGhostSample[] {
  return samples
    .filter(
      (s) =>
        isPlainObject(s) &&
        isFiniteNumber(s.lapDistPct) &&
        isFiniteNumber(s.speedKmh) &&
        isFiniteNumber(s.throttle) &&
        isFiniteNumber(s.brake)
    )
    .map((s) => ({
      lapDistPct: clamp01(s.lapDistPct),
      speedKmh: Math.max(0, s.speedKmh),
      throttle: clamp01(s.throttle),
      brake: clamp01(s.brake),
      steer: finiteOrUndefined(s.steer),
      rpm: finiteOrUndefined(s.rpm),
      gear: finiteOrUndefined(s.gear),
      currentLapTimeSec: finiteOrUndefined(s.currentLapTimeSec)
    }))
    .sort((a, b) => a.lapDistPct - b.lapDistPct)
}

function lapTimeFromSamples(sorted: RawGhostSample[], explicit?: number): number | undefined {
  if (isFiniteNumber(explicit) && explicit > 0) return explicit
  const withTime = sorted.filter((s) => isFiniteNumber(s.currentLapTimeSec)) as Array<
    RawGhostSample & { currentLapTimeSec: number }
  >
  if (withTime.length >= 2) {
    const span = withTime[withTime.length - 1].currentLapTimeSec - withTime[0].currentLapTimeSec
    if (span > 0) return span
  }
  return undefined
}

// Turn a raw, arbitrarily-spaced telemetry cloud into a clean uniform `GhostLap`
// of `gridSize` samples along lapDistPct. Deterministic. Optional channels
// (steer/rpm/gear) are only emitted when at least one source sample carried them.
export function buildGhostLap(
  samples: readonly RawGhostSample[],
  opts: { lapTimeSec?: number; gridSize?: number } = {}
): GhostLap {
  const gridSize = Math.max(2, Math.floor(opts.gridSize ?? GHOST_SAMPLE_COUNT))
  const sorted = sanitizeRawSamples(samples)
  const lapTimeSec = lapTimeFromSamples(sorted, opts.lapTimeSec)

  if (sorted.length < 2) {
    const out: GhostSample[] = sorted.map((s) => {
      const sample: GhostSample = {
        lapDistPct: s.lapDistPct,
        speedKmh: s.speedKmh,
        throttle: s.throttle,
        brake: s.brake,
        steer: s.steer ?? 0
      }
      if (s.rpm !== undefined) sample.rpm = s.rpm
      if (s.gear !== undefined) sample.gear = s.gear
      return sample
    })
    return { lapTimeSec, sampleCount: out.length, samples: out }
  }

  const dists = sorted.map((s) => s.lapDistPct)
  const speeds = sorted.map((s) => s.speedKmh)
  const throttles = sorted.map((s) => s.throttle)
  const brakes = sorted.map((s) => s.brake)
  const hasSteer = sorted.some((s) => s.steer !== undefined)
  const hasRpm = sorted.some((s) => s.rpm !== undefined)
  const hasGear = sorted.some((s) => s.gear !== undefined)
  const steers = sorted.map((s) => s.steer ?? 0)
  const rpms = sorted.map((s) => s.rpm ?? 0)
  const gears = sorted.map((s) => s.gear ?? 0)

  const out: GhostSample[] = []
  for (let i = 0; i < gridSize; i += 1) {
    const t = (i + 0.5) / gridSize
    const sample: GhostSample = {
      lapDistPct: t,
      speedKmh: Math.max(0, interpolateAlong(speeds, dists, t)),
      throttle: clamp01(interpolateAlong(throttles, dists, t)),
      brake: clamp01(interpolateAlong(brakes, dists, t)),
      steer: hasSteer ? interpolateAlong(steers, dists, t) : 0
    }
    if (hasRpm) sample.rpm = Math.max(0, interpolateAlong(rpms, dists, t))
    if (hasGear) sample.gear = Math.round(interpolateAlong(gears, dists, t))
    out.push(sample)
  }
  return { lapTimeSec, sampleCount: out.length, samples: out }
}

function resampleGhost(ghost: GhostLap, gridSize: number, partnerLapTimeSec?: number): ResampledGhost | null {
  const samples = [...ghost.samples]
    .filter((s) => isFiniteNumber(s.lapDistPct) && isFiniteNumber(s.speedKmh))
    .sort((a, b) => a.lapDistPct - b.lapDistPct)
  if (samples.length < 2) return null

  const dists = samples.map((s) => clamp01(s.lapDistPct))
  const speeds = samples.map((s) => Math.max(0, s.speedKmh))

  const centers: number[] = []
  const binSpeed: number[] = []
  for (let i = 0; i < gridSize; i += 1) {
    const t = (i + 0.5) / gridSize
    centers.push(t)
    binSpeed.push(interpolateAlong(speeds, dists, t))
  }

  const lapTimeSec =
    isFiniteNumber(ghost.lapTimeSec) && ghost.lapTimeSec > 0
      ? ghost.lapTimeSec
      : isFiniteNumber(partnerLapTimeSec) && partnerLapTimeSec > 0
        ? partnerLapTimeSec
        : 1

  return { centers, speed: binSpeed, cumTimeSec: cumulativeTimeFromSpeed(binSpeed, lapTimeSec), lapTimeSec }
}

function biggestRegions(centers: number[], localDeltas: number[]): {
  bestGain?: GhostCompareRegion
  worstLoss?: GhostCompareRegion
} {
  const n = localDeltas.length
  if (n === 0) return {}
  const step = n > 0 ? 1 / n : 0
  let bestGain: GhostCompareRegion | undefined
  let worstLoss: GhostCompareRegion | undefined

  let runSign = 0
  let runSum = 0
  let runStart = 0

  const flush = (endExclusive: number): void => {
    if (runSign === 0) return
    const fromPct = Math.max(0, centers[runStart] - step / 2)
    const toPct = Math.min(1, centers[endExclusive - 1] + step / 2)
    const region: GhostCompareRegion = { fromPct, toPct, deltaSec: runSum }
    if (runSum < 0 && (!bestGain || runSum < bestGain.deltaSec)) bestGain = region
    if (runSum > 0 && (!worstLoss || runSum > worstLoss.deltaSec)) worstLoss = region
  }

  for (let i = 0; i < n; i += 1) {
    const sign = localDeltas[i] > 0 ? 1 : localDeltas[i] < 0 ? -1 : 0
    if (sign !== runSign) {
      flush(i)
      runSign = sign
      runSum = 0
      runStart = i
    }
    runSum += localDeltas[i]
  }
  flush(n)
  return { bestGain, worstLoss }
}

// Compare ghost A (yours / the current lap) against ghost B (the imported ghost).
// Returns a per-distance delta trace plus gain/loss totals and the biggest gain/
// loss stretches. Negative deltas mean A is FASTER (good). Deterministic + pure.
export function compareGhosts(
  a: GhostLap,
  b: GhostLap,
  opts: { gridSize?: number } = {}
): GhostCompareResult {
  const gridSize = Math.max(2, Math.floor(opts.gridSize ?? GHOST_SAMPLE_COUNT))
  const ra = resampleGhost(a, gridSize, b.lapTimeSec)
  const rb = resampleGhost(b, gridSize, a.lapTimeSec)

  if (!ra || !rb) {
    return {
      bins: [],
      totalDeltaSec: 0,
      lapTimeASec: finiteOrUndefined(a.lapTimeSec),
      lapTimeBSec: finiteOrUndefined(b.lapTimeSec),
      gainSec: 0,
      lossSec: 0
    }
  }

  const bins: GhostCompareBin[] = []
  const localDeltas: number[] = []
  let gainSec = 0
  let lossSec = 0
  let prevCumDelta = 0

  for (let i = 0; i < gridSize; i += 1) {
    const cumDelta = ra.cumTimeSec[i] - rb.cumTimeSec[i]
    const localDelta = cumDelta - prevCumDelta
    prevCumDelta = cumDelta
    localDeltas.push(localDelta)
    if (localDelta < 0) gainSec += -localDelta
    else if (localDelta > 0) lossSec += localDelta

    bins.push({
      lapDistPct: ra.centers[i],
      deltaSec: cumDelta,
      localDeltaSec: localDelta,
      speedAKmh: ra.speed[i],
      speedBKmh: rb.speed[i],
      speedDeltaKmh: ra.speed[i] - rb.speed[i]
    })
  }

  const { bestGain, worstLoss } = biggestRegions(ra.centers, localDeltas)

  return {
    bins,
    totalDeltaSec: bins.length > 0 ? bins[bins.length - 1].deltaSec : 0,
    lapTimeASec: finiteOrUndefined(a.lapTimeSec),
    lapTimeBSec: finiteOrUndefined(b.lapTimeSec),
    gainSec,
    lossSec,
    bestGain,
    worstLoss
  }
}

// ─── Validation + (de)serialization ─────────────────────────────────────────

function validateMeta(input: unknown): SharePackMeta {
  if (!isPlainObject(input)) throw new SharePackError('share pack meta is missing or invalid')
  if (!isFiniteNumber(input.createdAt)) throw new SharePackError('share pack meta.createdAt must be a number')
  const meta: SharePackMeta = { createdAt: input.createdAt }
  if (nonEmptyString(input.sim)) meta.sim = input.sim as SimId
  if (nonEmptyString(input.car)) meta.car = input.car
  if (nonEmptyString(input.track)) meta.track = input.track
  if (nonEmptyString(input.trackConfig)) meta.trackConfig = input.trackConfig
  if (nonEmptyString(input.author)) meta.author = input.author
  if (nonEmptyString(input.note)) meta.note = input.note
  if (nonEmptyString(input.appVersion)) meta.appVersion = input.appVersion
  return meta
}

function validateGhostSample(input: unknown): GhostSample {
  if (!isPlainObject(input)) throw new SharePackError('ghost sample is invalid')
  if (!isFiniteNumber(input.lapDistPct) || !isFiniteNumber(input.speedKmh)) {
    throw new SharePackError('ghost sample requires numeric lapDistPct and speedKmh')
  }
  const sample: GhostSample = {
    lapDistPct: input.lapDistPct,
    speedKmh: input.speedKmh,
    throttle: isFiniteNumber(input.throttle) ? input.throttle : 0,
    brake: isFiniteNumber(input.brake) ? input.brake : 0,
    steer: isFiniteNumber(input.steer) ? input.steer : 0
  }
  if (isFiniteNumber(input.rpm)) sample.rpm = input.rpm
  if (isFiniteNumber(input.gear)) sample.gear = input.gear
  return sample
}

function validateGhost(input: unknown): GhostLap {
  if (!isPlainObject(input)) throw new SharePackError('ghost payload is missing or invalid')
  if (!Array.isArray(input.samples)) throw new SharePackError('ghost payload requires a samples array')
  if (input.samples.length > MAX_SHARE_SAMPLES) throw new SharePackError('ghost payload exceeds the maximum sample count')
  const samples = input.samples.map(validateGhostSample)
  const ghost: GhostLap = { sampleCount: samples.length, samples }
  if (isFiniteNumber(input.lapTimeSec)) ghost.lapTimeSec = input.lapTimeSec
  return ghost
}

function validateTelemetrySample(input: unknown): TelemetrySeriesSample {
  if (!isPlainObject(input)) throw new SharePackError('telemetry sample is invalid')
  if (!isFiniteNumber(input.t)) throw new SharePackError('telemetry sample requires numeric t')
  const sample: TelemetrySeriesSample = { t: input.t }
  if (isFiniteNumber(input.lapDistPct)) sample.lapDistPct = input.lapDistPct
  if (isFiniteNumber(input.speedKmh)) sample.speedKmh = input.speedKmh
  if (isFiniteNumber(input.rpm)) sample.rpm = input.rpm
  if (isFiniteNumber(input.gear)) sample.gear = input.gear
  if (isFiniteNumber(input.throttle)) sample.throttle = input.throttle
  if (isFiniteNumber(input.brake)) sample.brake = input.brake
  if (isFiniteNumber(input.steer)) sample.steer = input.steer
  return sample
}

function validateTelemetry(input: unknown): TelemetrySeries {
  if (!isPlainObject(input)) throw new SharePackError('telemetry payload is missing or invalid')
  if (!Array.isArray(input.samples)) throw new SharePackError('telemetry payload requires a samples array')
  if (input.samples.length > MAX_SHARE_SAMPLES) throw new SharePackError('telemetry payload exceeds the maximum sample count')
  const samples = input.samples.map(validateTelemetrySample)
  const series: TelemetrySeries = { sampleCount: samples.length, samples }
  if (isFiniteNumber(input.durationSec)) series.durationSec = input.durationSec
  return series
}

function validateSetupSections(input: unknown): Record<string, Record<string, string>> {
  if (!isPlainObject(input)) throw new SharePackError('setup payload requires a sections object')
  const sections: Record<string, Record<string, string>> = {}
  for (const [sectionName, rawSection] of Object.entries(input)) {
    if (!isPlainObject(rawSection)) continue
    const section: Record<string, string> = {}
    for (const [key, value] of Object.entries(rawSection)) {
      if (typeof value === 'string') section[key] = value
      else if (isFiniteNumber(value)) section[key] = String(value)
    }
    sections[sectionName] = section
  }
  return sections
}

function validateSetup(input: unknown): SetupShare {
  if (!isPlainObject(input)) throw new SharePackError('setup payload is missing or invalid')
  const setup: SetupShare = { format: 'sto', sections: validateSetupSections(input.sections) }
  if (nonEmptyString(input.fileName)) setup.fileName = input.fileName
  if (typeof input.raw === 'string') setup.raw = input.raw
  return setup
}

// Validate + normalize an unknown value (parsed JSON or object) into a SharePack.
// Throws SharePackError on any problem, including a version mismatch.
export function validateSharePack(input: unknown): SharePack {
  if (!isPlainObject(input)) throw new SharePackError('share pack must be an object')
  if (input.magic !== SHARE_PACK_MAGIC) {
    throw new SharePackError('not a sim-share pack (missing magic marker)')
  }
  if (!isFiniteNumber(input.version)) throw new SharePackError('share pack version is missing')
  if (input.version !== SHARE_PACK_VERSION) {
    throw new SharePackError(
      `unsupported share pack version ${input.version} (this build reads version ${SHARE_PACK_VERSION})`
    )
  }
  const kind = input.kind
  if (kind !== 'ghost' && kind !== 'telemetry' && kind !== 'setup') {
    throw new SharePackError(`unknown share pack kind: ${String(kind)}`)
  }
  if (!nonEmptyString(input.id)) throw new SharePackError('share pack id is missing')

  const pack: SharePack = {
    magic: SHARE_PACK_MAGIC,
    version: SHARE_PACK_VERSION,
    kind,
    id: input.id,
    meta: validateMeta(input.meta)
  }

  if (kind === 'ghost') {
    pack.ghost = validateGhost(input.ghost)
  } else if (kind === 'telemetry') {
    pack.telemetry = validateTelemetry(input.telemetry)
  } else {
    pack.setup = validateSetup(input.setup)
  }
  return pack
}

// Serialize a pack to a portable JSON string. Validates first so a malformed pack
// can never reach disk.
export function serializeSharePack(pack: SharePack): string {
  return JSON.stringify(validateSharePack(pack), null, 2)
}

// Parse + validate a pack from a JSON string or an already-parsed object. Rejects
// malformed JSON, the wrong magic/version, and structurally invalid payloads.
export function parseSharePack(input: string | unknown): SharePack {
  let raw: unknown = input
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input)
    } catch {
      throw new SharePackError('share pack is not valid JSON')
    }
  }
  return validateSharePack(raw)
}

// Cheap projection for listing imported packs without shipping the heavy sample
// arrays around. Pure.
export function summarizeSharePack(pack: SharePack): SharePackSummary {
  const summary: SharePackSummary = {
    id: pack.id,
    kind: pack.kind,
    createdAt: pack.meta.createdAt,
    sampleCount:
      pack.ghost?.sampleCount ?? pack.telemetry?.sampleCount ?? (pack.setup ? Object.keys(pack.setup.sections).length : 0)
  }
  if (pack.meta.sim) summary.sim = pack.meta.sim
  if (pack.meta.car) summary.car = pack.meta.car
  if (pack.meta.track) summary.track = pack.meta.track
  if (pack.meta.trackConfig) summary.trackConfig = pack.meta.trackConfig
  if (pack.meta.author) summary.author = pack.meta.author
  if (pack.meta.note) summary.note = pack.meta.note
  if (isFiniteNumber(pack.ghost?.lapTimeSec)) summary.lapTimeSec = pack.ghost?.lapTimeSec
  return summary
}

// Type guard for non-throwing callers (UI list filters, etc.).
export function isSharePack(input: unknown): input is SharePack {
  try {
    validateSharePack(input)
    return true
  } catch {
    return false
  }
}

// ─── IPC contract (shared by main, preload allowlist + renderer) ─────────────
// The preload bridge must allow the `community:` prefix (see REGISTRATION NEEDED
// in src/main/modules/community-local.ts). Channels live here so every layer
// imports one symbol instead of typing string literals.

export const COMMUNITY_CHANNELS = {
  exportGhost: 'community:exportGhost',
  exportSetup: 'community:exportSetup',
  exportTelemetry: 'community:exportTelemetry',
  import: 'community:import',
  listLocal: 'community:listLocal',
  compareTo: 'community:compareTo',
  get: 'community:get',
  delete: 'community:delete',
  status: 'community:status',
  // Broadcast emitted after a successful import/delete so views can refresh.
  changed: 'community:changed'
} as const

export type CommunityChannel = (typeof COMMUNITY_CHANNELS)[keyof typeof COMMUNITY_CHANNELS]

// Snapshot of what can currently be shared, surfaced to the UI so it can enable
// the export buttons and show the captured car/track/lap time.
export interface CommunityStatus {
  liveGhostReady: boolean
  liveLapTimeSec?: number
  sim?: SimId
  car?: string
  track?: string
  liveSampleCount: number
  telemetryReady: boolean
  telemetrySampleCount: number
  importedCount: number
}

export interface CommunityExportResult {
  canceled: boolean
  filePath?: string
  id?: string
  kind?: SharePackKind
}

export interface CommunityImportResult {
  canceled: boolean
  summary?: SharePackSummary
}

// Optional, user-supplied metadata attached to an export (e.g. a note typed in
// the view). Never a network identity — purely local annotation.
export interface CommunityExportOptions {
  note?: string
  author?: string
}

// Wrapped compare output returned by `community:compareTo`: the raw delta trace
// plus enough labels for the UI to caption the chart.
export interface GhostCompareReport {
  result: GhostCompareResult
  targetId: string
  targetLabel: string
  baselineLabel: string
  baselineSource: 'live' | 'imported'
}
