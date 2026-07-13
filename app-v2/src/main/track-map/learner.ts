// Track-map learner — the PRIMARY, login-free way to get a real track outline.
//
// Just like SimHub, we draw the circuit by RECORDING THE CAR'S POSITION over a
// single clean lap straight from telemetry. No iRacing login, no network, works
// on every sim (and on Mac via the mock provider).
//
// The learner is fed telemetry snapshots (via the module) and captures ONE
// clean flying lap per track. A "clean" lap satisfies:
//
//   • `lapDistPct` walks 0 → 1 monotonically (small jitter allowed).
//   • The lap wraps from ~1.0 back to ~0.0 once (lap boundary).
//   • No spikes — consecutive Δpct stays below `MAX_PCT_STEP`.
//   • The car was in motion the whole time (rules out pit-lane stalls).
//
// Two acquisition modes, in priority order:
//   1. velocity + yawNorth integration (SimHub-style) — we rotate the car-frame
//      velocity by the yaw into a world frame and integrate it over Δt to get an
//      (x, y) path in metres. Preferred because it's available on iRacing and
//      doesn't depend on the sim exposing geographic coordinates.
//   2. lat/lon — used when the provider exposes geographic position. Projected
//      with a flat-earth approximation (good enough for one circuit) and
//      rescaled to a unit viewBox.
//
// WHILE recording we expose a live `getRecordingSnapshot()` so the UI can:
//   • draw the partial polyline as the lap is being driven, and
//   • show a REAL progress value (driven fraction of the current lap), instead
//     of a static number that looks "stuck".
//
// Once a lap is captured, we persist it under an immutable layout-specific file
// (`TrackID` when authoritative, otherwise normalized venue + config) and replace
// only that layout's in-memory entry. The store subsequently serves it via IPC.

import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

import type { Logger } from '../../shared/logger'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import type { TrackMapLayoutLookup, TrackMapPoint } from '../../shared/track-map'
import {
  DEFAULT_CORNER_MAP_CONFIG,
  buildCornerMap,
  cornerAt as cornerAtPct,
  cornerIndexAt as cornerIndexAtPct,
  isValidCornerMap,
  trackLayoutKey,
  type Corner,
  type CornerMapConfig,
  type CornerMapData,
  type CornerSample
} from './corner-map'
import {
  captureTrackLayout,
  catalogLayoutsForVenue,
  findCatalogLayout,
  layoutAliasKeys,
  layoutFileStem,
  normalizeLayoutPart,
  trackLayoutFromCatalog,
  trackLayoutFromSnapshot,
  type TrackCatalogLayout,
  type TrackLayoutIdentity
} from './types'

const LEARNED_DIR = 'learned'
// Auto-numbered corner maps (Turn 1..N) live alongside the learned outlines, one
// JSON per track + detection-config. They are derived from the SAME clean lap.
const CORNERS_DIR = 'corners'

// Diagnostic area used for every learner log line (greppable in the 24h logs).
const LOG_AREA = 'trackmap'

// A diagnostic that costs nothing when no logger is wired (tests / early boot).
const NOOP_LOGGER: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
}

// Tolerances tuned against the mock provider (which ticks at 30 Hz with a smooth
// analytic loop) and typical sim refresh rates. They're intentionally generous
// so we don't reject every lap.
const MIN_PCT_STEP = -0.02 // allow tiny rewinds (provider jitter)
const MAX_PCT_STEP = 0.05 // anything >5% per tick is a teleport
const START_MAX_PCT = 0.05 // anchor IMMEDIATELY at S/F when a capture starts this close
const WRAP_FROM = 0.9 // lap is "done" when pct passes this...
const WRAP_TO = 0.1 // ...and the next sample comes back below this
const MIN_SAMPLES_PER_LAP = 60 // sub-second laps are noise, not a lap
const MAX_SAMPLES_PER_LAP = 20_000 // safety cap (≈11 min at 30 Hz)
const RESAMPLE_TARGET = 500 // final polyline density
const PARTIAL_MAX_POINTS = 240 // live-trace density sent to the UI
const MIN_SPEED_KMH = 8 // car must actually be moving (enter the "too slow" pause)
// Hysteresis: once paused for being too slow, require clearing this HIGHER speed to
// resume. Stops the reason (and its per-tick log line + status broadcast) flapping
// when the car hovers right around MIN_SPEED_KMH (e.g. a slow hairpin at ~8 km/h).
const MIN_SPEED_EXIT_KMH = 12
// Largest gap we still treat as a continuous stream. Bigger gaps mean telemetry
// paused/stalled — we resync without integrating a giant (corrupting) step, but
// keep the in-flight lap so recording resumes seamlessly.
const MAX_DT_SECONDS = 0.5
const MIN_SPAN_METERS = 1 // reject degenerate (straight-line) captures
// A lap is accepted once the car has driven this fraction of the track FROM THE
// ANCHOR (start-of-recording) point. Closing the loop bridges the tiny remainder.
// This is what makes learning robust: we no longer demand one perfectly-clean
// wrap — partial/rejoined/slowed laps still finish as long as near-full coverage
// is reached. Kept high so we never accept a half-lap (= garbage map).
const LAP_FULL_COVERAGE = 0.985
// When an anchored-at-S/F lap reaches the S/F wrap with at least this much
// coverage we finalize EXACTLY on the seam, yielding a clean 0→1 outline.
const LAP_WRAP_MIN_COVERAGE = 0.9
// Throttle window for repeating the SAME stall reason to the diagnostic log.
const LOG_THROTTLE_MS = 1000
const MAX_COORDINATE_JUMP_METERS = 75
const MAX_RESUME_COORDINATE_JUMP_METERS = 30

type AcquisitionMode = 'lat-lon' | 'velocity-yaw'

// Machine-readable reason the learner is (not) capturing — surfaced to the UI
// and the 24h diagnostic log so "no map" is never a silent mystery.
export type LearnReason =
  | 'idle'
  | 'not-connected'
  | 'no-track-name'
  | 'no-lap-dist-pct'
  | 'too-slow'
  | 'no-acquisition-mode'
  | 'time-gap'
  | 'teleport-reset'
  | 'replay-suspended'
  | 'unknown-spatial'
  | 'off-track'
  | 'pit-road'
  | 'warming-up'
  | 'recording'
  | 'wrap-too-early'
  | 'too-few-samples'
  | 'degenerate-path'
  | 'learned'

export interface LearnedRecord {
  version: 2
  layoutKey: string
  trackId?: number
  trackName: string
  trackConfigName?: string
  capturedAt: number
  source: AcquisitionMode
  startFinishPct: number
  polyline: TrackMapPoint[]
}

type LegacyLearnedRecord =
  Omit<LearnedRecord, 'version' | 'layoutKey' | 'trackId' | 'trackConfigName'> & { version: 1 }
type PersistedOutline = {
  filePath: string
  raw: string
  record: LearnedRecord | LegacyLearnedRecord
}

interface RawSample {
  pct: number
  x: number
  y: number
}

interface AcquisitionState {
  layout: TrackLayoutIdentity
  // We lock the acquisition mode on the first valid sample so we never mix
  // coordinate systems mid-lap.
  mode: AcquisitionMode
  // True when the user pressed "Gravar mapa agora": we anchor IMMEDIATELY at the
  // current position instead of waiting to reach the start/finish line.
  manual: boolean
  // False during the mid-lap "warm-up": we buffer a live trace but discard it and
  // re-seed the moment we cross S/F, so the cached outline always starts at the
  // seam. Becomes true once the recording is anchored (at S/F, or immediately for
  // a manual capture).
  anchored: boolean
  startPct: number
  lastPct: number
  lastTimestamp: number
  // Forward lap fraction driven since the anchor (monotonic, wrap-aware). This is
  // the REAL recording progress and the thing we finalize on.
  covered: number
  // Position in metres for both modes. Always re-scaled at the end so we never
  // bake provider-specific magnitudes into the cache.
  raw: RawSample[]
  // Lat-lon origin (locked to the first sample) so the projection stays planar.
  originLat: number | null
  originLon: number | null
  metersPerDegLon: number
  // velocity-yaw integrator state — current position in metres relative to the
  // first sample.
  intX: number
  intY: number
  // Reduced telemetry buffered for corner detection (speed/brake/throttle/steer
  // keyed by lapDistPct). Independent of the position `raw` buffer so a paused
  // integrator never starves corner detection. Reset on (re)anchor.
  cornerSamples: CornerSample[]
  lastGeo: GeoPoint | null
}

type GeoPoint = { lat: number; lon: number }
type SuspensionState = { layoutKey: string; pct: number; geo: GeoPoint | null }

// Live view of the in-flight capture, surfaced to the renderer so it can draw
// the trace while the lap is still being recorded.
export interface RecordingSnapshot {
  active: boolean
  layoutKey: string | null
  trackId: number | null
  trackName: string | null
  trackConfigName: string | null
  progress: number // 0..1 driven fraction of the current lap
  sampleCount: number
  mode: AcquisitionMode | null
  // 'warming' while we drive toward S/F to anchor; 'recording' once anchored.
  phase: 'idle' | 'warming' | 'recording'
  manual: boolean
  polyline: TrackMapPoint[] // normalized 0..1, OPEN path (lap not closed yet)
}

// Always-available learning diagnostics for the UI — present even when NOTHING is
// recording (e.g. "too slow", "no position data"), so the user can see exactly
// why a map isn't being learned and act on it.
export interface LearnState {
  phase: 'idle' | 'warming' | 'recording'
  progress: number
  sampleCount: number
  manual: boolean
  mode: AcquisitionMode | null
  // Last machine reason + human (PT-BR) label, with the telemetry timestamp it
  // was observed at.
  reason: LearnReason
  reasonLabel: string
  reasonAt: number
}

export interface TrackLearnerOptions {
  // Override for the persistence root — useful in tests. Defaults to
  // `<userData>/track-maps/learned`.
  rootDir?: string
  // Diagnostic logger (the app's 24h logger in production). Defaults to a no-op
  // so the learner stays usable without electron (tests / early boot).
  logger?: Logger
  // Override the corner-detection config (tests / tuning). Defaults to
  // DEFAULT_CORNER_MAP_CONFIG.
  cornerConfig?: CornerMapConfig
}

export class TrackMapLearner {
  private readonly rootDir: string
  private readonly cornersDir: string
  private readonly cornerConfig: CornerMapConfig
  private readonly log: Logger
  private acquisition: AcquisitionState | null = null
  private suspension: SuspensionState | null = null
  private cache = new Map<string, LearnedRecord>()
  private exactAliases = new Map<string, LearnedRecord>()
  private ambiguousAliases = new Set<string>()
  private offlineFallbacks = new Map<string, LearnedRecord>()
  private catalog: TrackCatalogLayout[] = []
  private catalogFresh = false
  private persistedOutlines: PersistedOutline[] = []
  private legacyWarnings = new Set<string>()
  // In-memory corner maps keyed by track LAYOUT (trackName + TrackConfigName;
  // latest detection config wins). Keyed via trackLayoutKey() so two layouts of one
  // track don't share a map.
  private cornerCache = new Map<string, CornerMapData>()
  private hydrated = false
  private hydrating: Promise<void> | null = null
  // Set by `armManualCapture()`: the next moving snapshot starts an anchored
  // capture immediately (mid-lap allowed), discarding any in-flight warm-up.
  private manualArm = false
  // Last diagnostic reason (machine + PT-BR label) and the telemetry timestamp it
  // was seen at. Surfaced to the UI even when nothing is recording.
  private lastReason: LearnReason = 'idle'
  private lastReasonLabel = reasonLabel('idle')
  private lastReasonAt = 0
  // Throttle bookkeeping so the SAME reason isn't written to disk every tick.
  private loggedReason: LearnReason | null = null
  private loggedReasonAt = 0
  // Hysteresis latch for the too-slow gate (see MIN_SPEED_EXIT_KMH).
  private slowLatched = false
  private onTrackCapabilitySeen = false
  private pitCapabilitySeen = false
  private spatialSim: TelemetrySnapshot['sim'] | undefined

  constructor(userDataPath: string, options: TrackLearnerOptions = {}) {
    this.rootDir = options.rootDir ?? join(userDataPath, 'track-maps', LEARNED_DIR)
    this.cornersDir = join(this.rootDir, CORNERS_DIR)
    this.cornerConfig = options.cornerConfig ?? DEFAULT_CORNER_MAP_CONFIG
    this.log = options.logger ?? NOOP_LOGGER
  }

  // ── Manual controls (UI: "Gravar mapa agora" / "Reiniciar gravação") ───────
  // Arm an immediate, anchored capture. The next moving snapshot with usable
  // position data starts recording RIGHT WHERE THE CAR IS, so the user never has
  // to be near the start/finish line. Any in-flight warm-up is discarded.
  armManualCapture(): void {
    this.manualArm = true
    this.acquisition = null
    this.suspension = null
    this.log.info(LOG_AREA, 'learner: manual capture armed')
  }

  // Cancel any in-flight capture (and disarm a pending manual request).
  cancelCapture(): void {
    this.manualArm = false
    this.acquisition = null
    this.suspension = null
    this.log.info(LOG_AREA, 'learner: capture cancelled')
  }

  // Always-available learning state for the UI status panel.
  getLearnState(): LearnState {
    const acq = this.acquisition
    const phase: LearnState['phase'] = !acq ? 'idle' : acq.anchored ? 'recording' : 'warming'
    return {
      phase,
      progress: acq && acq.anchored ? clampUnit(acq.covered) : 0,
      sampleCount: acq ? acq.raw.length : 0,
      manual: acq ? acq.manual : false,
      mode: acq ? acq.mode : null,
      reason: this.lastReason,
      reasonLabel: this.lastReasonLabel,
      reasonAt: this.lastReasonAt
    }
  }

  // Load every persisted lap into memory. Idempotent — safe to call multiple
  // times. Other modules should `await` this once at startup.
  async hydrate(): Promise<void> {
    if (this.hydrated) return
    if (this.hydrating) return this.hydrating
    this.hydrating = this.runHydrate().finally(() => {
      this.hydrating = null
    })
    return this.hydrating
  }

  async setCatalog(catalog: readonly TrackCatalogLayout[], fresh = false): Promise<void> {
    this.catalog = catalog.map((row) => ({ ...row }))
    this.catalogFresh = fresh && this.catalog.length > 0
    if (this.hydrated && this.catalogFresh) await this.promotePersistedOutlines()
  }

  private async runHydrate(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true })
    let entries: string[]
    try {
      entries = await readdir(this.rootDir)
    } catch {
      entries = []
    }
    for (const file of entries) {
      if (!file.endsWith('.json')) continue
      try {
        const filePath = join(this.rootDir, file)
        const raw = await readFile(filePath, 'utf8')
        const parsed = JSON.parse(raw) as Partial<LearnedRecord | LegacyLearnedRecord>
        if (!isPersistedRecord(parsed)) continue
        if (parsed.version === 2) {
          const record = normalizeRecord(parsed as LearnedRecord)
          this.rememberRecord(record)
          if (!record.trackId && !record.trackConfigName) this.rememberFallback(record)
          this.persistedOutlines.push({ filePath, raw, record })
        } else {
          const record = parsed as LegacyLearnedRecord
          this.rememberFallback(legacyAsRecord(record))
          this.persistedOutlines.push({ filePath, raw, record })
        }
      } catch {
        // Skip corrupted files — they'll be replaced on the next capture.
      }
    }
    if (this.catalogFresh) await this.promotePersistedOutlines()
    this.rebuildAliases()
    await this.hydrateCorners()
    this.hydrated = true
  }

  private rememberRecord(record: LearnedRecord): void {
    const current = this.cache.get(record.layoutKey)
    if (!current || compareRecords(record, current) > 0) this.cache.set(record.layoutKey, record)
  }

  private rememberFallback(record: LearnedRecord): void {
    const key = normalizeLayoutPart(record.trackName)
    const current = this.offlineFallbacks.get(key)
    if (!current || compareRecords(record, current) > 0) this.offlineFallbacks.set(key, record)
  }

  private async promotePersistedOutlines(): Promise<void> {
    if (!this.catalogFresh) return
    const groups = new Map<number, { row: TrackCatalogLayout; outlines: PersistedOutline[] }>()
    for (const outline of this.persistedOutlines) {
      const lookup = outline.record.version === 2
        ? captureTrackLayout(outline.record)
        : captureTrackLayout({ trackName: outline.record.trackName })
      const row = lookup ? findCatalogLayout(lookup, this.catalog) : null
      if (!row) {
        if (this.catalog.length && outline.record.version === 1) this.warnAmbiguousLegacy(outline.record)
        continue
      }
      const group = groups.get(row.trackId) ?? { row, outlines: [] }
      group.outlines.push(outline)
      groups.set(row.trackId, group)
    }

    const processed = new Set<PersistedOutline>()
    const promotedOutlines: PersistedOutline[] = []
    for (const { row, outlines } of groups.values()) {
      const ranked = outlines.map((outline) => ({
        outline,
        record: promoteOutline(outline.record, trackLayoutFromCatalog(row))
      }))
      ranked.sort((a, b) => compareOutlineCandidates(b, a))
      const winner = ranked[0]
      const targetPath = this.recordPath(winner.record)
      const targetLoser = ranked.find(({ outline }) =>
        outline.filePath === targetPath && outline !== winner.outline
      )
      if (targetLoser) await this.quarantineOutline(targetLoser.outline, 'superseded')
      let saved: PersistedOutline
      try {
        saved = await this.persist(winner.record)
      } catch (error) {
        this.log.warn(LOG_AREA, 'learner: outline promotion failed', {
          trackName: winner.record.trackName, error: error instanceof Error ? error.message : String(error)
        })
        continue
      }
      for (const candidate of ranked) {
        processed.add(candidate.outline)
        if (candidate.outline !== targetLoser?.outline && candidate.outline.filePath !== saved.filePath) {
          await this.quarantineOutline(
            candidate.outline,
            candidate.outline === winner.outline ? 'promoted-source' : 'superseded'
          )
        }
        if (candidate.outline.record.version === 2) {
          const old = normalizeRecord(candidate.outline.record)
          if (sameRecord(this.cache.get(old.layoutKey), old)) this.cache.delete(old.layoutKey)
        }
      }
      this.rememberRecord(winner.record)
      promotedOutlines.push(saved)
    }
    this.persistedOutlines = this.persistedOutlines.filter((outline) => !processed.has(outline))
      .concat(promotedOutlines)
    this.rebuildFallbacks()
    this.rebuildAliases()
  }

  private warnAmbiguousLegacy(record: LegacyLearnedRecord): void {
    const matches = catalogLayoutsForVenue(record.trackName, this.catalog).length
    if (matches <= 1) return
    const key = `${normalizeLayoutPart(record.trackName)}:${matches}`
    if (this.legacyWarnings.has(key)) return
    this.legacyWarnings.add(key)
    this.log.warn(LOG_AREA, 'learner: legacy outline kept configless', {
      trackName: record.trackName, catalogLayouts: matches
    })
  }

  private rebuildFallbacks(): void {
    this.offlineFallbacks.clear()
    for (const record of this.cache.values()) {
      if (!record.trackId && !record.trackConfigName) this.rememberFallback(record)
    }
    for (const outline of this.persistedOutlines) {
      if (outline.record.version === 1) this.rememberFallback(legacyAsRecord(outline.record))
    }
  }

  private rebuildAliases(): void {
    const groups = new Map<string, Map<string, LearnedRecord>>()
    this.exactAliases.clear()
    this.ambiguousAliases.clear()
    for (const record of this.cache.values()) {
      for (const alias of layoutAliasKeys(record)) {
        const layouts = groups.get(alias) ?? new Map<string, LearnedRecord>()
        const identity = record.trackId ? `id:${record.trackId}` : record.layoutKey
        const current = layouts.get(identity)
        if (!current || compareRecords(record, current) > 0) layouts.set(identity, record)
        groups.set(alias, layouts)
      }
    }
    for (const [alias, layouts] of groups) {
      if (layouts.size !== 1) {
        this.ambiguousAliases.add(alias)
        continue
      }
      this.exactAliases.set(alias, layouts.values().next().value as LearnedRecord)
    }
  }

  private async quarantineOutline(outline: PersistedOutline, reason: string): Promise<void> {
    try {
      const dir = join(this.rootDir, 'quarantine')
      await mkdir(dir, { recursive: true })
      const name = `${basename(outline.filePath, '.json')}__${reason}__${hashText(outline.raw)}.json`
      await writeFile(join(dir, name), outline.raw, 'utf8')
      await rm(outline.filePath, { force: true })
      this.log.warn(LOG_AREA, 'learner: outline quarantined', { file: basename(outline.filePath), reason })
    } catch (error) {
      this.log.warn(LOG_AREA, 'learner: outline quarantine failed', {
        file: basename(outline.filePath), error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  // Load every persisted corner map into memory. Only records that match the
  // CURRENT detection config are served; stale-config maps are re-learned on the
  // next clean lap.
  private async hydrateCorners(): Promise<void> {
    await mkdir(this.cornersDir, { recursive: true })
    let entries: string[]
    try {
      entries = await readdir(this.cornersDir)
    } catch {
      entries = []
    }
    for (const file of entries) {
      if (!file.endsWith('.json')) continue
      try {
        const raw = await readFile(join(this.cornersDir, file), 'utf8')
        const parsed = JSON.parse(raw) as unknown
        if (isValidCornerMap(parsed)) {
          this.cornerCache.set(trackLayoutKey(parsed.trackName, parsed.trackConfigName), parsed)
        }
      } catch {
        // Skip corrupted files — they'll be replaced on the next capture.
      }
    }
  }

  has(layout: TrackMapLayoutLookup | TrackLayoutIdentity | string | undefined | null): boolean {
    return this.get(layout) !== null
  }

  get(layout: TrackMapLayoutLookup | TrackLayoutIdentity | string | undefined | null): LearnedRecord | null {
    const captured = lookupLayout(layout)
    if (!captured) return null
    const direct = this.cache.get(captured.key)
    if (direct) return direct
    const aliases = layoutAliasKeys(captured)
    if (aliases.some((alias) => this.ambiguousAliases.has(alias))) return null
    const aliasMatches = aliases
      .map((alias) => this.exactAliases.get(alias))
      .filter((record): record is LearnedRecord => !!record)
    if (aliasMatches.length) {
      const layoutKeys = new Set(aliasMatches.map((record) => record.layoutKey))
      if (layoutKeys.size === 1) return aliasMatches.reduce((best, record) =>
        compareRecords(record, best) > 0 ? record : best
      )
      return null
    }
    if (this.catalogFresh) {
      const row = findCatalogLayout(captured, this.catalog)
      const promoted = row ? this.cache.get(trackLayoutFromCatalog(row).key) : null
      if (promoted) return promoted
    }
    const fallback = this.offlineFallbacks.get(normalizeLayoutPart(captured.trackName))
    if (!fallback) return null
    if (captured.trackConfigName && this.catalog.length > 0) return null
    return normalizeRecord({
      ...fallback,
      layoutKey: captured.key,
      trackId: captured.trackId,
      trackName: captured.trackName,
      trackConfigName: captured.trackConfigName
    })
  }

  list(): LearnedRecord[] {
    return Array.from(this.cache.values())
  }

  // ── Corner map (Turn 1..N) public getters ─────────────────────────────────
  // Auto-numbered corner map for a track LAYOUT, scoped to the CURRENT detection
  // config (a config change re-learns the map on the next clean lap). Pass the
  // iRacing TrackConfigName so two layouts of one track resolve to their own map;
  // omit it for single-config tracks (backward-compatible). Null until a lap has
  // been learned for the track/layout.
  getCornerMap(trackName: string | undefined | null, trackConfigName?: string | null): CornerMapData | null {
    if (!trackName) return null
    return this.cornerCache.get(trackLayoutKey(trackName, trackConfigName)) ?? null
  }

  // True once an auto-numbered corner map exists for the track/layout.
  hasCornerMap(trackName: string | undefined | null, trackConfigName?: string | null): boolean {
    return !!trackName && this.cornerCache.has(trackLayoutKey(trackName, trackConfigName))
  }

  // The corner (with extent) that owns `lapDistPct`, or null on a straight.
  cornerAt(trackName: string | undefined | null, lapDistPct: number, trackConfigName?: string | null): Corner | null {
    return cornerAtPct(this.getCornerMap(trackName, trackConfigName)?.corners ?? null, lapDistPct)
  }

  // 1-based corner index for `lapDistPct`, or null on a straight.
  cornerIndexAt(
    trackName: string | undefined | null,
    lapDistPct: number,
    trackConfigName?: string | null
  ): number | null {
    return cornerIndexAtPct(this.getCornerMap(trackName, trackConfigName)?.corners ?? null, lapDistPct)
  }

  listCornerMaps(): CornerMapData[] {
    return Array.from(this.cornerCache.values())
  }

  // Live state of the in-flight capture. Cheap to call every tick — only does a
  // light projection/resample of the points captured so far.
  getRecordingSnapshot(): RecordingSnapshot {
    const acq = this.acquisition
    if (!acq) {
      return {
        active: false,
        layoutKey: null,
        trackId: null,
        trackName: null,
        trackConfigName: null,
        progress: 0,
        sampleCount: 0,
        mode: null,
        phase: 'idle',
        manual: false,
        polyline: []
      }
    }
    return {
      active: true,
      layoutKey: acq.layout.key,
      trackId: acq.layout.trackId ?? null,
      trackName: acq.layout.trackName,
      trackConfigName: acq.layout.trackConfigName ?? null,
      progress: acq.anchored ? clampUnit(acq.covered) : 0,
      sampleCount: acq.raw.length,
      mode: acq.mode,
      phase: acq.anchored ? 'recording' : 'warming',
      manual: acq.manual,
      polyline: buildPartialPolyline(acq.raw)
    }
  }

  // Process one telemetry snapshot. Returns the new record when a lap was
  // captured this tick, otherwise null. The caller is responsible for
  // broadcasting changes — we keep this class side-effect-free except for disk
  // I/O of the captured lap. Logging is throttled and wrapped so it never throws.
  async ingest(snapshot: TelemetrySnapshot | null, resolvedLayout?: TrackLayoutIdentity): Promise<LearnedRecord | null> {
    const nowMs = snapshot && Number.isFinite(snapshot.timestamp) ? snapshot.timestamp : Date.now()
    if (!snapshot || !snapshot.connected) {
      this.acquisition = null
      this.suspension = null
      this.slowLatched = false
      this.onTrackCapabilitySeen = false
      this.pitCapabilitySeen = false
      this.spatialSim = undefined
      this.note('not-connected', nowMs)
      return null
    }
    const layout = resolvedLayout ?? trackLayoutFromSnapshot(snapshot)
    if (!layout) {
      this.note('no-track-name', nowMs)
      return null
    }
    const pct = snapshot.lapDistPct
    if (typeof pct !== 'number' || !Number.isFinite(pct)) {
      this.note('no-lap-dist-pct', nowMs)
      return null
    }
    if (this.spatialSim !== snapshot.sim) {
      this.spatialSim = snapshot.sim
      this.onTrackCapabilitySeen = false
      this.pitCapabilitySeen = false
    }

    if (this.acquisition && this.acquisition.layout.key !== layout.key) {
      this.acquisition = null
      this.suspension = null
      this.slowLatched = false
    }
    if (replaySuspended(snapshot)) {
      this.captureSuspension()
      this.note('replay-suspended', nowMs)
      return null
    }
    if (typeof snapshot.onTrack === 'boolean') this.onTrackCapabilitySeen = true
    if (typeof snapshot.onPitRoad === 'boolean' || typeof snapshot.pit?.inPitStall === 'boolean') {
      this.pitCapabilitySeen = true
    }
    const spatialState = getSpatialState(snapshot, this.onTrackCapabilitySeen, this.pitCapabilitySeen)
    if (spatialState === 'pit' || spatialState === 'off-track') {
      this.acquisition = null
      this.suspension = null
      this.slowLatched = false
      this.note(spatialState === 'pit' ? 'pit-road' : 'off-track', nowMs)
      return null
    }
    if (spatialState === 'unknown') {
      this.captureSuspension()
      this.note('unknown-spatial', nowMs)
      return null
    }
    if (this.suspension && this.acquisition) {
      const currentGeo = geoPoint(snapshot)
      const forward = strictForwardStep(this.suspension.pct, pct)
      const hasGeoPair = !!this.suspension.geo && !!currentGeo
      const stationaryWithoutGps = forward === 0 && !this.suspension.geo && !currentGeo
      const jump = this.suspension.geo && currentGeo
        ? geoDeltaMeters(this.suspension.geo, currentGeo).distance : Number.POSITIVE_INFINITY
      if (
        this.suspension.layoutKey !== layout.key ||
        forward === null || forward > MAX_PCT_STEP ||
        (!hasGeoPair && !stationaryWithoutGps) ||
        (hasGeoPair && jump > MAX_RESUME_COORDINATE_JUMP_METERS)
      ) {
        this.acquisition = null
        this.suspension = null
        this.note('teleport-reset', nowMs, { forward, coordinateJumpM: jump })
        return null
      }
      if (currentGeo) bridgeSuspension(this.acquisition, snapshot, pct, forward, currentGeo)
      else {
        this.acquisition.lastPct = pct
        this.acquisition.lastTimestamp = snapshot.timestamp
      }
      this.suspension = null
      this.note(this.acquisition.anchored ? 'recording' : 'warming-up', nowMs, { resumed: true })
      return null
    }
    this.suspension = null
    const currentGeo = geoPoint(snapshot)
    if (this.acquisition?.lastGeo && currentGeo &&
      geoDeltaMeters(this.acquisition.lastGeo, currentGeo).distance > MAX_COORDINATE_JUMP_METERS) {
      this.acquisition = null
      this.note('teleport-reset', nowMs, { reason: 'coordinate-jump' })
      return null
    }

    // Slow / stationary samples destroy the path quality. We no longer DESTROY an
    // in-flight lap when the car slows (a hairpin, spin, brief traffic or a quick
    // stop used to force a full restart and was a major reason "no map" happened):
    // instead we PAUSE — resync the clock/pct so we never integrate across the
    // slow patch, and keep buffering when the car speeds back up.
    const speedKmh = snapshot.speedKmh
    const tooSlow = this.updateSlowLatch(speedKmh)
    if (tooSlow) {
      if (this.acquisition) {
        // A TOW drags the car a long way along the track while it reports <8 km/h
        // every tick — lastPct tracks the tow but the velocity integrator stays
        // frozen, so on resume the post-tow path is drawn translated. Detect it by
        // the pct jumping more than one normal step while paused (a slow corner or
        // spin barely moves pct) and drop the in-flight lap. A genuine lap wrap
        // (~1 → ~0) is not a tow, so never drop on the seam.
        const pausedStep = pct - this.acquisition.lastPct
        const wrappedWhilePaused = this.acquisition.lastPct > WRAP_FROM && pct < WRAP_TO
        if (!wrappedWhilePaused && Math.abs(pausedStep) > MAX_PCT_STEP) {
          this.acquisition = null
          this.note('teleport-reset', nowMs, { step: pausedStep, pct, speedKmh })
          return null
        }
        this.acquisition.lastPct = pct
        this.acquisition.lastTimestamp = snapshot.timestamp
        this.acquisition.lastGeo = currentGeo
      }
      this.note('too-slow', nowMs, { speedKmh, pct })
      return null
    }

    if (!this.acquisition) {
      const mode = pickAcquisitionMode(snapshot)
      if (!mode) {
        this.note('no-acquisition-mode', nowMs, acquisitionFields(snapshot))
        return null
      }
      // A manual capture (or starting within reach of S/F) anchors IMMEDIATELY.
      // Otherwise we begin a mid-lap warm-up that anchors at the next S/F crossing
      // so the cached outline always starts on the seam.
      const manual = this.manualArm
      this.manualArm = false
      const anchored = manual || pct <= START_MAX_PCT
      this.acquisition = newAcquisitionState(layout, mode, snapshot, { manual, anchored })
      this.note(anchored ? 'recording' : 'warming-up', nowMs, { pct, mode, manual })
      return null
    }

    const acq = this.acquisition
    const dtRaw = (snapshot.timestamp - acq.lastTimestamp) / 1000

    // Stall / clock-reset handling: never integrate across a large gap (that
    // would teleport the integrator). Resync and keep recording.
    if (!Number.isFinite(dtRaw) || dtRaw < 0 || dtRaw > MAX_DT_SECONDS) {
      // A tow can ALSO pause telemetry: if the car jumped far along the track
      // during the gap (not a lap wrap), the frozen integrator would draw a
      // translated path on resume — drop the lap. A small pct delta across the gap
      // is a normal stall/clock-reset: resync and keep recording.
      const gapStep = pct - acq.lastPct
      const wrappedAcrossGap = acq.lastPct > WRAP_FROM && pct < WRAP_TO
      if (!wrappedAcrossGap && Math.abs(gapStep) > MAX_PCT_STEP) {
        this.acquisition = null
        this.note('teleport-reset', nowMs, { step: gapStep, dt: dtRaw })
        return null
      }
      acq.lastPct = pct
      acq.lastTimestamp = snapshot.timestamp
      acq.lastGeo = currentGeo
      this.note('time-gap', nowMs, { dt: dtRaw })
      return null
    }
    const dt = dtRaw
    const step = pct - acq.lastPct

    // Detect a genuine lap wrap FIRST. At the start/finish line `lapDistPct`
    // jumps from "almost 1" back to "almost 0" in a single sample, which looks
    // EXACTLY like a big backwards teleport. The teleport gate below must never
    // run on a real wrap, or it would discard the nearly-complete lap forever.
    const wrapped = acq.lastPct > WRAP_FROM && pct < WRAP_TO

    // Reject teleports and big rewinds — but never a real wrap. A small backwards
    // step (provider jitter) is fine; we just don't move forward in the path.
    if (!wrapped && (step > MAX_PCT_STEP || step < MIN_PCT_STEP)) {
      // A LARGE discontinuity (tow/reset/teleport) is unsalvageable — drop the lap.
      // After a reset the next moving tick re-arms automatically.
      if (Math.abs(step) > MAX_PCT_STEP * 4) {
        this.acquisition = null
        this.note('teleport-reset', nowMs, { step, pct })
        return null
      }
      // A MODERATE skip (a dropped frame / brief spike): don't integrate this tick,
      // but RESYNC lastPct/lastTimestamp so the very next sample is a normal step.
      // Without this resync the gate kept firing against a frozen lastPct, stalling
      // recording for several ticks until the cumulative drift crossed the reset
      // threshold; now it self-heals in one tick.
      acq.lastPct = pct
      acq.lastTimestamp = snapshot.timestamp
      acq.lastGeo = currentGeo
      this.note('teleport-reset', nowMs, { step, pct, skipped: true })
      return null
    }

    // Still warming up (mid-lap start): keep a live trace, but the moment we cross
    // S/F re-seed the capture there so the cached lap is a clean seam-to-seam loop.
    if (!acq.anchored) {
      if (wrapped) {
        reanchorAtStartFinish(acq, snapshot)
        this.note('recording', nowMs, { anchoredAt: 'start-finish' })
        return null
      }
      // Show the partial warm-up trace even before we anchor.
      appendSample(acq, snapshot, pct, step, dt)
      acq.lastPct = pct
      acq.lastTimestamp = snapshot.timestamp
      acq.lastGeo = currentGeo
      if (acq.raw.length > MAX_SAMPLES_PER_LAP) this.acquisition = null
      this.note('warming-up', nowMs, { pct })
      return null
    }

    // Anchored — accumulate the lap. The wrap is just a normal forward step here
    // (its true delta is tiny); position integration is pct-independent so the
    // seam never corrupts the path.
    appendSample(acq, snapshot, pct, step, dt)
    pushCornerSample(acq, snapshot, pct)
    const forward = wrapped ? pct + 1 - acq.lastPct : Math.max(0, step)
    if (forward > 0 && forward <= MAX_PCT_STEP * 2) acq.covered += forward
    acq.lastPct = pct
    acq.lastTimestamp = snapshot.timestamp
    acq.lastGeo = currentGeo

    if (acq.raw.length > MAX_SAMPLES_PER_LAP) {
      this.acquisition = null
      this.note('idle', nowMs, { reason: 'sample-cap' })
      return null
    }

    // Finalize when the car has driven a near-full lap from the anchor. An
    // anchored-at-S/F lap finalizes EXACTLY on the wrap (clean 0→1); any other
    // lap (manual mid-lap start, or a missed wrap) finalizes on full coverage and
    // closes the small remainder. We never accept less than near-full coverage,
    // so a half-lap can't produce a garbage map.
    const finalizeOnWrap = wrapped && acq.covered >= LAP_WRAP_MIN_COVERAGE
    const finalizeOnCoverage = acq.covered >= LAP_FULL_COVERAGE
    if (!finalizeOnWrap && !finalizeOnCoverage) {
      this.note('recording', nowMs, { covered: round3(acq.covered), samples: acq.raw.length })
      return null
    }

    const captured = acq
    this.acquisition = null
    if (captured.raw.length < MIN_SAMPLES_PER_LAP) {
      this.note('too-few-samples', nowMs, { samples: captured.raw.length })
      return null
    }

    const finalMap = buildFinalPolyline(captured.raw, captured.startPct)
    if (!finalMap) {
      this.note('degenerate-path', nowMs, { samples: captured.raw.length })
      return null
    }

    const record: LearnedRecord = {
      version: 2,
      layoutKey: captured.layout.key,
      trackId: captured.layout.trackId,
      trackName: captured.layout.trackName,
      trackConfigName: captured.layout.trackConfigName,
      capturedAt: snapshot.timestamp,
      source: captured.mode,
      startFinishPct: finalMap.startFinishPct,
      polyline: finalMap.polyline
    }
    this.rememberRecord(record)
    this.rebuildAliases()
    if (!record.trackId && !record.trackConfigName) this.rememberFallback(record)
    await this.persist(record).then((stored) => {
      this.persistedOutlines.push(stored)
    }).catch((error) => {
      this.log.warn(LOG_AREA, 'learner: persist failed (map kept in memory)', {
        trackName: record.trackName,
        error: error instanceof Error ? error.message : String(error)
      })
    })
    // Derive & persist the auto-numbered corner map (Turn 1..N) from the SAME
    // clean lap. Failure here never blocks the outline — the corner map is a
    // best-effort overlay (no map → per-sector coaching still works).
    await this.learnCornerMap(captured, snapshot.timestamp)
    this.lastReason = 'learned'
    this.lastReasonLabel = reasonLabel('learned')
    this.lastReasonAt = nowMs
    this.log.info(LOG_AREA, 'learner: map learned', {
      trackName: record.trackName,
      source: record.source,
      points: finalMap.polyline.length,
      samples: captured.raw.length,
      covered: round3(captured.covered),
      manual: captured.manual
    })
    return record
  }

  private captureSuspension(): void {
    const acq = this.acquisition
    if (!acq || this.suspension) return
    this.suspension = { layoutKey: acq.layout.key, pct: acq.lastPct, geo: acq.lastGeo }
  }

  // Too-slow gate with hysteresis: ENTER the slow/pause state below MIN_SPEED_KMH,
  // LEAVE it only once speed clears the higher MIN_SPEED_EXIT_KMH. Non-finite speed
  // clears the latch (we can't tell, so don't keep pausing). Keeps the reason — and
  // its per-tick log/broadcast — stable when the car hovers around the threshold.
  private updateSlowLatch(speedKmh: number | undefined): boolean {
    if (typeof speedKmh !== 'number' || !Number.isFinite(speedKmh)) {
      this.slowLatched = false
      return false
    }
    this.slowLatched = this.slowLatched ? speedKmh < MIN_SPEED_EXIT_KMH : speedKmh < MIN_SPEED_KMH
    return this.slowLatched
  }

  // Record the current learner reason for the UI and (throttled) for the 24h log.
  // Never throws — diagnostics must never break telemetry.
  private note(reason: LearnReason, nowMs: number, detail?: Record<string, unknown>): void {
    try {
      this.lastReason = reason
      this.lastReasonLabel = reasonLabel(reason)
      this.lastReasonAt = nowMs
      const changed = reason !== this.loggedReason
      if (changed || nowMs - this.loggedReasonAt >= LOG_THROTTLE_MS) {
        this.loggedReason = reason
        this.loggedReasonAt = nowMs
        this.log.debug(LOG_AREA, `learner: ${reason}`, detail)
      }
    } catch {
      // Logging must never throw into telemetry handling.
    }
  }

  private recordPath(record: LearnedRecord): string {
    const layout = captureTrackLayout(record) as TrackLayoutIdentity
    return join(this.rootDir, `${layoutFileStem(layout)}.json`)
  }

  private async persist(record: LearnedRecord): Promise<PersistedOutline> {
    await mkdir(this.rootDir, { recursive: true })
    const filePath = this.recordPath(record)
    const raw = `${JSON.stringify(record, null, 2)}\n`
    await writeFile(filePath, raw, 'utf8')
    return { filePath, raw, record }
  }

  // Detect, cache and persist the auto-numbered corner map for a captured lap.
  // Best-effort: a too-short / featureless lap simply yields no corners and the
  // map is skipped, leaving per-sector coaching intact.
  private async learnCornerMap(captured: AcquisitionState, nowMs: number): Promise<void> {
    try {
      const map = buildCornerMap(
        captured.layout.trackName,
        captured.cornerSamples,
        this.cornerConfig,
        nowMs,
        captured.layout.trackConfigName
      )
      if (map.corners.length === 0) {
        this.log.debug(LOG_AREA, 'learner: no corners detected', {
          trackName: captured.layout.trackName,
          samples: captured.cornerSamples.length
        })
        return
      }
      this.cornerCache.set(trackLayoutKey(map.trackName, map.trackConfigName), map)
      await this.persistCornerMap(map)
      this.log.info(LOG_AREA, 'learner: corner map learned', {
        trackName: map.trackName,
        trackConfigName: map.trackConfigName ?? null,
        corners: map.corners.length,
        samples: map.sampleCount
      })
    } catch (error) {
      this.log.warn(LOG_AREA, 'learner: corner map failed (outline kept)', {
        trackName: captured.layout.trackName,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  private async persistCornerMap(map: CornerMapData): Promise<void> {
    await mkdir(this.cornersDir, { recursive: true })
    // Include the LAYOUT in the file name so two configs of one track don't
    // overwrite each other on disk. Backward-compatible: configless maps keep the
    // original `<track>__<detectionConfig>.json` name.
    const layoutSegment = map.trackConfigName ? `__cfg-${safeFileName(map.trackConfigName)}` : ''
    const file = join(
      this.cornersDir,
      `${safeFileName(map.trackName)}${layoutSegment}__${safeFileName(map.configKey)}.json`
    )
    await writeFile(file, `${JSON.stringify(map, null, 2)}\n`, 'utf8')
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const METERS_PER_DEG_LAT = 111_320

function pickAcquisitionMode(snapshot: TelemetrySnapshot): AcquisitionMode | null {
  // Prefer velocity+yaw integration (SimHub-style) — it's the most widely
  // available signal and doesn't need geographic coordinates. We require ALL
  // three components (velocityX, velocityY, yawNorth) to be finite, because the
  // integrator rotates the full car-frame vector and a missing/NaN velocityY
  // would silently corrupt the path.
  if (
    typeof snapshot.velocityX === 'number' &&
    Number.isFinite(snapshot.velocityX) &&
    typeof snapshot.velocityY === 'number' &&
    Number.isFinite(snapshot.velocityY) &&
    typeof snapshot.yawNorth === 'number' &&
    Number.isFinite(snapshot.yawNorth)
  ) {
    return 'velocity-yaw'
  }
  // lat-lon only when the sim actually placed the car. iRacing (and some others)
  // report Lat=0,Lon=0 before the car exists on track; accepting that sentinel
  // would lock a bogus origin off the coast of Africa and produce a junk map.
  if (hasValidLatLon(snapshot)) return 'lat-lon'
  return null
}

// True when lat/lon are finite AND not the (0,0) "car not placed yet" sentinel.
function hasValidLatLon(snapshot: TelemetrySnapshot): boolean {
  return (
    typeof snapshot.lat === 'number' &&
    Number.isFinite(snapshot.lat) &&
    typeof snapshot.lon === 'number' &&
    Number.isFinite(snapshot.lon) &&
    !(snapshot.lat === 0 && snapshot.lon === 0)
  )
}

function replaySuspended(snapshot: TelemetrySnapshot): boolean {
  if (snapshot.replayContext) return snapshot.replayContext.active || snapshot.replayContext.state !== 'live'
  return snapshot.replayPlaying === true
}

function getSpatialState(
  snapshot: TelemetrySnapshot,
  requireOnTrack: boolean,
  requirePitState: boolean
): 'track' | 'pit' | 'off-track' | 'unknown' {
  if (snapshot.onPitRoad === true || snapshot.pit?.inPitStall === true) return 'pit'
  if (snapshot.onTrack === false) return 'off-track'
  if (requireOnTrack && snapshot.onTrack !== true) return 'unknown'
  if (
    requirePitState &&
    snapshot.onPitRoad !== false &&
    snapshot.pit?.inPitStall !== false
  ) return 'unknown'
  return 'track'
}

function geoPoint(snapshot: TelemetrySnapshot): GeoPoint | null {
  return hasValidLatLon(snapshot) ? { lat: snapshot.lat as number, lon: snapshot.lon as number } : null
}

function geoDeltaMeters(from: GeoPoint, to: GeoPoint): { east: number; north: number; distance: number } {
  const meanLat = ((from.lat + to.lat) * Math.PI) / 360
  const north = (to.lat - from.lat) * METERS_PER_DEG_LAT
  const east = (to.lon - from.lon) * METERS_PER_DEG_LAT * Math.cos(meanLat)
  return { east, north, distance: Math.hypot(east, north) }
}

function strictForwardStep(previousPct: number, pct: number): number | null {
  if (previousPct > WRAP_FROM && pct < WRAP_TO) return pct + 1 - previousPct
  const step = pct - previousPct
  return step >= 0 ? step : null
}

function bridgeSuspension(
  acq: AcquisitionState, snapshot: TelemetrySnapshot, pct: number, forward: number, currentGeo: GeoPoint
): void {
  if (forward > 0) {
    if (acq.mode === 'lat-lon') {
      appendLatLon(acq, snapshot, pct)
    } else if (acq.lastGeo) {
      const delta = geoDeltaMeters(acq.lastGeo, currentGeo)
      acq.intX += delta.east
      acq.intY += delta.north
      acq.raw.push({ pct, x: acq.intX, y: acq.intY })
    }
    if (acq.anchored) {
      acq.covered += forward
      pushCornerSample(acq, snapshot, pct)
    }
  }
  acq.lastPct = pct
  acq.lastTimestamp = snapshot.timestamp
  acq.lastGeo = currentGeo
}

// Presence/finiteness of each position field — logged when no mode can be picked
// so the user can see EXACTLY which signal the sim isn't exposing.
function acquisitionFields(snapshot: TelemetrySnapshot): Record<string, unknown> {
  return {
    velocityX: finiteOrNull(snapshot.velocityX),
    velocityY: finiteOrNull(snapshot.velocityY),
    yawNorth: finiteOrNull(snapshot.yawNorth),
    lat: finiteOrNull(snapshot.lat),
    lon: finiteOrNull(snapshot.lon)
  }
}

function newAcquisitionState(
  layout: TrackLayoutIdentity,
  mode: AcquisitionMode,
  snapshot: TelemetrySnapshot,
  init: { manual: boolean; anchored: boolean }
): AcquisitionState {
  const startPct = snapshot.lapDistPct ?? 0
  const state: AcquisitionState = {
    layout,
    mode,
    manual: init.manual,
    anchored: init.anchored,
    startPct,
    lastPct: startPct,
    lastTimestamp: snapshot.timestamp,
    covered: 0,
    raw: [],
    originLat: null,
    originLon: null,
    metersPerDegLon: METERS_PER_DEG_LAT,
    intX: 0,
    intY: 0,
    cornerSamples: [],
    lastGeo: geoPoint(snapshot)
  }
  if (mode === 'lat-lon' && hasValidLatLon(snapshot)) {
    state.originLat = snapshot.lat ?? null
    state.originLon = snapshot.lon ?? null
    state.metersPerDegLon = METERS_PER_DEG_LAT * Math.cos(((snapshot.lat ?? 0) * Math.PI) / 180)
  }
  // Seed the path with the start point so the trace shows up immediately.
  state.raw.push({ pct: startPct, x: 0, y: 0 })
  // Seed a corner sample so an immediately-anchored (manual) capture has data.
  if (init.anchored) pushCornerSample(state, snapshot, startPct)
  return state
}

// Re-seed a warm-up capture at the start/finish line: drop the partial pre-seam
// buffer and reset the integrator so the cached lap is a clean seam-to-seam loop.
function reanchorAtStartFinish(acq: AcquisitionState, snapshot: TelemetrySnapshot): void {
  const startPct = snapshot.lapDistPct ?? 0
  acq.anchored = true
  acq.startPct = startPct
  acq.lastPct = startPct
  acq.lastTimestamp = snapshot.timestamp
  acq.lastGeo = geoPoint(snapshot)
  acq.covered = 0
  acq.intX = 0
  acq.intY = 0
  acq.raw = [{ pct: startPct, x: 0, y: 0 }]
  // Corner detection only uses the anchored seam-to-seam lap, so drop the warm-up
  // corner buffer and re-seed at the seam.
  acq.cornerSamples = []
  pushCornerSample(acq, snapshot, startPct)
  if (acq.mode === 'lat-lon' && hasValidLatLon(snapshot)) {
    acq.originLat = snapshot.lat ?? null
    acq.originLon = snapshot.lon ?? null
    acq.metersPerDegLon = METERS_PER_DEG_LAT * Math.cos(((snapshot.lat ?? 0) * Math.PI) / 180)
  }
}

// Append one position sample for the active mode. Velocity-yaw always integrates
// (so position stays exact across slow/no-pct-advance ticks) but only records a
// point when pct moved forward; lat-lon records on forward motion with a valid
// (non-sentinel) coordinate.
function appendSample(
  acq: AcquisitionState,
  snapshot: TelemetrySnapshot,
  pct: number,
  step: number,
  dt: number
): void {
  if (acq.mode === 'velocity-yaw') {
    const integrated = integrateVelocityYaw(acq, snapshot, dt)
    if (integrated && step > 0) acq.raw.push({ pct, x: acq.intX, y: acq.intY })
  } else if (step > 0) {
    appendLatLon(acq, snapshot, pct)
  }
}

// Buffer one reduced telemetry frame for corner detection. Unlike the position
// path, this records EVERY anchored tick (corner detection wants the full speed
// trace, including the slow apex samples the position integrator may skip).
const CORNER_SAMPLE_CAP = MAX_SAMPLES_PER_LAP
function pushCornerSample(acq: AcquisitionState, snapshot: TelemetrySnapshot, pct: number): void {
  if (acq.cornerSamples.length >= CORNER_SAMPLE_CAP) return
  const speedKmh = snapshot.speedKmh
  if (typeof speedKmh !== 'number' || !Number.isFinite(speedKmh)) return
  const sample: CornerSample = { lapDistPct: pct, speedKmh }
  if (typeof snapshot.brake === 'number' && Number.isFinite(snapshot.brake)) sample.brake = snapshot.brake
  if (typeof snapshot.throttle === 'number' && Number.isFinite(snapshot.throttle)) sample.throttle = snapshot.throttle
  if (typeof snapshot.steerAngleDeg === 'number' && Number.isFinite(snapshot.steerAngleDeg)) {
    sample.steerAbsDeg = Math.abs(snapshot.steerAngleDeg)
  }
  acq.cornerSamples.push(sample)
}

function appendLatLon(acq: AcquisitionState, snapshot: TelemetrySnapshot, pct: number): void {
  if (
    typeof snapshot.lat !== 'number' ||
    typeof snapshot.lon !== 'number' ||
    acq.originLat === null ||
    acq.originLon === null ||
    // Skip the (0,0) "car not placed" sentinel so it can't yank the path home.
    (snapshot.lat === 0 && snapshot.lon === 0)
  ) {
    return
  }
  const x = (snapshot.lon - acq.originLon) * acq.metersPerDegLon
  const y = (snapshot.lat - acq.originLat) * METERS_PER_DEG_LAT
  acq.raw.push({ pct, x, y })
}

// Integrate one tick of car-frame velocity into the world-frame position.
// Returns `true` when the sample was integrated, `false` when it was skipped
// because the input was non-finite (NaN/Infinity) — `x ?? 0` does NOT catch NaN,
// so without this guard a single bad sample would permanently poison intX/intY.
// A skipped tick is treated as a resync by the caller (lastPct/lastTimestamp
// still advance), never as an integrated step.
function integrateVelocityYaw(acq: AcquisitionState, snapshot: TelemetrySnapshot, dt: number): boolean {
  if (dt <= 0) return false
  const vx = snapshot.velocityX
  const vy = snapshot.velocityY
  const yaw = snapshot.yawNorth
  if (
    vx === undefined ||
    !Number.isFinite(vx) ||
    vy === undefined ||
    !Number.isFinite(vy) ||
    yaw === undefined ||
    !Number.isFinite(yaw)
  ) {
    return false
  }
  // velocityX/Y are in the CAR frame in iRacing (x=forward, y=right). Rotate
  // them by yawNorth so we accumulate a world-frame path (east, north).
  // yawNorth is measured clockwise from North, so:
  //    east  =  vx * sin(yaw) + vy * cos(yaw)
  //    north =  vx * cos(yaw) - vy * sin(yaw)
  const sin = Math.sin(yaw)
  const cos = Math.cos(yaw)
  const vEast = vx * sin + vy * cos
  const vNorth = vx * cos - vy * sin
  acq.intX += vEast * dt
  acq.intY += vNorth * dt
  return true
}

interface UnitProjection {
  minX: number
  minY: number
  scale: number
  offsetX: number
  offsetY: number
}

// Compute a centred, aspect-preserving projection of metre-space points into a
// [margin, 1-margin]² box. Returns null when the data is too degenerate to draw
// (e.g. a single straight line).
function computeUnitProjection(raw: RawSample[]): UnitProjection | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of raw) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  const widthMeters = maxX - minX
  const heightMeters = maxY - minY
  const span = Math.max(widthMeters, heightMeters)
  if (!Number.isFinite(span) || span <= MIN_SPAN_METERS) return null

  const margin = 0.06
  const usable = 1 - 2 * margin
  const scale = usable / span
  return {
    minX,
    minY,
    scale,
    offsetX: margin + (usable - widthMeters * scale) / 2,
    offsetY: margin + (usable - heightMeters * scale) / 2
  }
}

function projectToUnit(raw: RawSample[], proj: UnitProjection): TrackMapPoint[] {
  return raw.map((p) => projectPointToUnit(p, proj))
}

function projectPointToUnit(p: Pick<RawSample, 'x' | 'y'>, proj: UnitProjection): TrackMapPoint {
  return {
    x: proj.offsetX + (p.x - proj.minX) * proj.scale,
    // Y is flipped so "north" points up in SVG-style top-left-origin space.
    y: 1 - (proj.offsetY + (p.y - proj.minY) * proj.scale)
  }
}

// Final, closed, smoothed polyline used as the cached learned map.
function buildFinalPolyline(
  raw: RawSample[],
  captureStartPct: number
): { polyline: TrackMapPoint[]; startFinishPct: number } | null {
  if (raw.length < MIN_SAMPLES_PER_LAP) return null
  const proj = computeUnitProjection(raw)
  if (!proj) return null
  const projected = projectToUnit(raw, proj)
  const resampled = resamplePolyline(projected, RESAMPLE_TARGET)
  // Smooth on the ring (treat as closed) so the seam stays continuous.
  const smoothed = smoothPolyline(resampled, true, 2)
  // Close the loop so the renderer can draw a simple closed path.
  const out = smoothed.slice()
  const first = out[0]
  const last = out[out.length - 1]
  if (first && last && Math.hypot(first.x - last.x, first.y - last.y) > 0.001) {
    out.push({ x: first.x, y: first.y })
  }
  const startFinishPct =
    findStartFinishFraction(raw) ?? normalizeLapPct(1 - normalizeLapPct(captureStartPct))
  return { polyline: out, startFinishPct }
}

function findStartFinishFraction(raw: RawSample[]): number | null {
  if (normalizeLapPct(raw[0]?.pct ?? 1) === 0) return 0
  const closingLength = Math.hypot(raw[0].x - raw[raw.length - 1].x, raw[0].y - raw[raw.length - 1].y)
  let total = closingLength
  for (let i = 1; i < raw.length; i += 1) {
    total += Math.hypot(raw[i].x - raw[i - 1].x, raw[i].y - raw[i - 1].y)
  }
  if (total <= 0) return null
  let traversed = 0
  for (let i = 1; i < raw.length; i += 1) {
    const before = raw[i - 1]
    const after = raw[i]
    const segmentLength = Math.hypot(after.x - before.x, after.y - before.y)
    if (before.pct > WRAP_FROM && after.pct < WRAP_TO) {
      const beforeSpan = 1 - normalizeLapPct(before.pct)
      const afterSpan = normalizeLapPct(after.pct)
      const pctSpan = beforeSpan + afterSpan
      const t = pctSpan > 0 ? beforeSpan / pctSpan : 0.5
      return clampUnit((traversed + segmentLength * t) / total)
    }
    traversed += segmentLength
  }
  return null
}

function normalizeLapPct(value: number): number {
  if (!Number.isFinite(value)) return 0
  const normalized = value % 1
  return normalized < 0 ? normalized + 1 : normalized
}

// Partial, OPEN, lightly-smoothed polyline used for the live recording trace.
function buildPartialPolyline(raw: RawSample[]): TrackMapPoint[] {
  if (raw.length < 2) return []
  const proj = computeUnitProjection(raw)
  if (!proj) return []
  const projected = projectToUnit(raw, proj)
  const resampled = resamplePolyline(projected, PARTIAL_MAX_POINTS)
  return smoothPolyline(resampled, false, 1)
}

// Uniform arc-length resampling — keeps the polyline cheap to render without
// losing the corners that make a track recognisable.
function resamplePolyline(points: TrackMapPoint[], target: number): TrackMapPoint[] {
  if (points.length <= target || target < 2) return points
  let totalLength = 0
  const segments: number[] = []
  for (let i = 1; i < points.length; i += 1) {
    const dx = points[i].x - points[i - 1].x
    const dy = points[i].y - points[i - 1].y
    const len = Math.hypot(dx, dy)
    segments.push(len)
    totalLength += len
  }
  if (totalLength <= 0) return points

  const out: TrackMapPoint[] = [points[0]]
  const stride = totalLength / (target - 1)
  let segIdx = 0
  let segStart = 0

  for (let i = 1; i < target - 1; i += 1) {
    const cursor = stride * i
    while (segIdx < segments.length && segStart + segments[segIdx] < cursor) {
      segStart += segments[segIdx]
      segIdx += 1
    }
    if (segIdx >= segments.length) break
    const segLen = segments[segIdx]
    const t = segLen === 0 ? 0 : (cursor - segStart) / segLen
    const a = points[segIdx]
    const b = points[segIdx + 1]
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
  }
  out.push(points[points.length - 1])
  return out
}

// Light moving-average smoother to knock down per-tick jitter. `closed` treats
// the polyline as a ring (wraps neighbours); otherwise endpoints are preserved.
function smoothPolyline(points: TrackMapPoint[], closed: boolean, passes: number): TrackMapPoint[] {
  if (points.length < 3 || passes <= 0) return points
  let pts = points
  for (let pass = 0; pass < passes; pass += 1) {
    const n = pts.length
    const out: TrackMapPoint[] = new Array(n)
    for (let i = 0; i < n; i += 1) {
      if (!closed && (i === 0 || i === n - 1)) {
        out[i] = pts[i]
        continue
      }
      const prev = pts[(i - 1 + n) % n]
      const cur = pts[i]
      const next = pts[(i + 1) % n]
      out[i] = {
        x: prev.x * 0.25 + cur.x * 0.5 + next.x * 0.25,
        y: prev.y * 0.25 + cur.y * 0.5 + next.y * 0.25
      }
    }
    pts = out
  }
  return pts
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

function finiteOrNull(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function round3(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0
}

// PT-BR, user-facing explanation for each learner reason — drives the status line
// in the track-map UI so "no map" always comes with an actionable cause.
function reasonLabel(reason: LearnReason): string {
  switch (reason) {
    case 'idle':
      return 'Waiting for telemetry'
    case 'not-connected':
      return 'Sim not connected'
    case 'no-track-name':
      return 'Waiting for track name'
    case 'no-lap-dist-pct':
      return 'No lap progress (LapDistPct) from the sim'
    case 'too-slow':
      return 'Car too slow — speed up to record the map'
    case 'no-acquisition-mode':
      return 'No position data from the sim (speed/yaw or lat/lon)'
    case 'time-gap':
      return 'Telemetry paused — resuming recording'
    case 'teleport-reset':
      return 'Position reset (tow/reset) — restarting recording'
    case 'replay-suspended':
      return 'Replay active — map recording suspended'
    case 'unknown-spatial':
      return 'Waiting for confirmed on-track position'
    case 'off-track':
      return 'Car off track — restarting recording'
    case 'pit-road':
      return 'Car in pit lane — restarting recording'
    case 'warming-up':
      return 'Going to the start/finish line to begin recording…'
    case 'recording':
      return 'Learning map…'
    case 'wrap-too-early':
      return 'Lap too short — restarting recording'
    case 'too-few-samples':
      return 'Amostras insuficientes na lap — gravando novamente'
    case 'degenerate-path':
      return 'Degenerate racing line — recording again'
    case 'learned':
      return 'Map learned'
    default:
      return ''
  }
}

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9.-]+/g, '_').slice(0, 120) || 'unknown-track'
}

function lookupLayout(value: TrackMapLayoutLookup | TrackLayoutIdentity | string | undefined | null): TrackLayoutIdentity | null {
  if (!value) return null
  return typeof value === 'string' ? captureTrackLayout({ trackName: value }) : captureTrackLayout(value)
}

function legacyAsRecord(record: LegacyLearnedRecord): LearnedRecord {
  const layout = captureTrackLayout({ trackName: record.trackName }) as TrackLayoutIdentity
  return normalizeRecord({ ...record, version: 2, layoutKey: layout.key })
}

function promoteOutline(
  record: LearnedRecord | LegacyLearnedRecord,
  layout: TrackLayoutIdentity
): LearnedRecord {
  return normalizeRecord({
    ...record,
    version: 2,
    layoutKey: layout.key,
    trackId: layout.trackId,
    trackName: layout.trackName,
    trackConfigName: layout.trackConfigName
  })
}

function compareRecords(a: LearnedRecord, b: LearnedRecord): number {
  const captured = finiteTimestamp(a.capturedAt) - finiteTimestamp(b.capturedAt)
  return captured || recordContentKey(a).localeCompare(recordContentKey(b))
}

function compareOutlineCandidates(
  a: { outline: PersistedOutline; record: LearnedRecord },
  b: { outline: PersistedOutline; record: LearnedRecord }
): number {
  return compareRecords(a.record, b.record) ||
    Number(a.outline.record.version === 2) - Number(b.outline.record.version === 2) ||
    basename(a.outline.filePath).localeCompare(basename(b.outline.filePath))
}

function recordContentKey(record: LearnedRecord): string {
  return JSON.stringify([record.source, record.startFinishPct, record.polyline])
}

function sameRecord(a: LearnedRecord | undefined, b: LearnedRecord): boolean {
  return !!a && a.layoutKey === b.layoutKey && a.capturedAt === b.capturedAt &&
    recordContentKey(a) === recordContentKey(b)
}

function finiteTimestamp(value: number): number {
  return Number.isFinite(value) ? value : 0
}

function hashText(value: string): string {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619)
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function isPersistedRecord(value: Partial<LearnedRecord | LegacyLearnedRecord>): value is LearnedRecord | LegacyLearnedRecord {
  return (value.version === 1 || value.version === 2) && typeof value.trackName === 'string' &&
    Array.isArray(value.polyline) && value.polyline.length > 0
}

function normalizeRecord(record: LearnedRecord): LearnedRecord {
  const layout = captureTrackLayout(record) as TrackLayoutIdentity
  return {
    ...record,
    version: 2,
    layoutKey: layout.key,
    trackId: layout.trackId,
    trackName: layout.trackName,
    trackConfigName: layout.trackConfigName,
    polyline: record.polyline.filter(
      (p) =>
        typeof p.x === 'number' &&
        typeof p.y === 'number' &&
        Number.isFinite(p.x) &&
        Number.isFinite(p.y)
    )
  }
}
