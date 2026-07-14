import type { ModuleContext } from '../module-context'
import type { Corners, TelemetrySnapshot, TyreInfo } from '../../shared/telemetry'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  COACH_CHANNELS,
  DEFAULT_COACH_CONFIG,
  buildCoachReport,
  coachSampleFromSnapshot,
  composeCornerAdvice,
  deterministicPhrasing,
  mergeCoachConfig,
  type CoachCornerMap,
  type CoachConfig,
  type CoachConfigPatch,
  type CoachExplainRequest,
  type CoachExplainResult,
  type CoachFinding,
  type CoachFindingKind,
  type CoachIssueKind,
  type CoachLapSample,
  type CoachPhase,
  type CoachReferenceLap,
  type CoachReport,
  type CoachReportPayload,
  type CoachSettings,
  type CoachSpeakEvent,
  type CoachStatus,
  type CoachTip,
  type CoachTipsPayload,
  type ComposedCornerAdvice
} from '../../shared/coach'
import {
  advanceCornerTracker,
  advanceSectorTracker,
  createCornerTracker,
  createSectorTracker,
  equalSectorStarts,
  type CornerTracker,
  type SectorTracker
} from './proactive-engineer'
import { buildCornerMap, trackLayoutKey, type CornerMapData, type CornerSample } from '../track-map/corner-map'
import { createDefaultIntentRegistry } from '../../shared/driver-intent-catalog'
import { recordLapEvents } from '../../shared/coach-baseline'
import { findingEventKeys } from '../../shared/coach-intent-gate'
import { CoachBaselineStore, getCoachBaselineStore } from './coach-baselines'
import { deriveSessionKind } from '../ai/context-pack'
import type { SessionKind } from '../../shared/ai-engineer'
import {
  buildSetupReport,
  type CornerTyres,
  type SetupBalanceSignal,
  type SetupReport,
  type TyreTreadTemps
} from '../../shared/setup-advisor'
import { getLlmRuntime } from '../ai/llm-runtime'
import { getModelManager } from '../ai/model-manager'
import { logger } from './logger'
import { settingsEvents } from '../settings/events'
import type { UnitSystem } from '../../shared/units'
import {
  speechLanguageFromAppLanguage,
  type SpeechLanguage
} from '../../shared/tts-voice'
import {
  LiveTelemetryGate,
  sameLiveTelemetryContext,
  type LiveTelemetryContext
} from '../../shared/replay'

// One shared, immutable driver-intent registry so the Live Coach gates deliberate
// racecraft/management/condition choices (context/silence) exactly like the proactive engine.
const intentRegistry = createDefaultIntentRegistry()

// ─────────────────────────────────────────────────────────────────────────────
// F1 — Live Coach engine (corner-aware spoken coaching).
//
// The Live Coach SPEAKS short, per-CORNER corrections while the driver laps in
// practice/qualy (in a RACE the proactive engineer owns the audio — see
// `speakSegment`). It learns the track's numbered corners (Turn 1..N) from the
// first clean lap, then on every lap completion runs the PURE shared analyzer to
// rank findings across ALL driving dimensions — brake point, turn-in timing,
// steering angle, throttle application, rotation — keyed to each corner. As the car
// EXITS a corner it speaks that corner's COMPOSITE line, e.g.
// "Turn 3: brake earlier, turn in earlier, throttle later." Until a corner map exists it
// falls back to the 3-sector cadence ("Sector N: …") so a fresh install still
// coaches from the first lap it can analyze.
// ─────────────────────────────────────────────────────────────────────────────

const SECTORS = 3
const MAX_TIPS = 8
/** Buffer caps for the per-lap analysis (mirrors the lap analyzer). */
const ENGINE_MAX_LAP_SAMPLES = 8000
const ENGINE_MIN_LAP_SAMPLES = 30
const ENGINE_RECENT_LAPS = 8
/** How long a UI tip survives without a refreshing lap. */
const TIP_TTL_MS = 45_000
const BROADCAST_MIN_MS = 450
/** Min gap between two spoken corner call-outs — keeps the coach from firehosing. */
const SPEAK_COOLDOWN_MS = 5_000
/**
 * A corner must cost at least this (seconds, on its WORST dimension) before the
 * Live Coach spends a spoken call-out on it. Tuned LOW so meaningful mistakes
 * actually fire (the old engine barely spoke), but above the analyzer's
 * `goodLossSec` so clean corners stay silent.
 */
const MIN_SPEAK_LOSS_SEC = 0.04
/** At most this many dimensions are chained into one corner line. */
const MAX_CORNER_DIMS = 3
/**
 * Before the first lap is analyzed the coach has no findings, so it would sit
 * silent for minutes while the driver waits. After this many on-track samples with
 * still-empty findings it speaks a single warm-up cue so the driver knows it's
 * alive and collecting a reference lap.
 */
const WARMUP_MIN_SAMPLES = 120

/** Map an analyzer finding kind to the coarse live-tip issue kind (UI grouping). */
function issueKindForFindingKind(kind: CoachFindingKind): CoachIssueKind {
  switch (kind) {
    case 'brake-early':
    case 'brake-late':
    case 'trail-brake-lock':
    case 'time-loss':
      return 'braking'
    case 'abs-overuse':
      return 'abs'
    case 'throttle-early':
    case 'throttle-late':
    case 'throttle-hesitation':
      return 'throttle'
    case 'tc-overuse':
      return 'tc'
    case 'steering-early':
    case 'steering-late':
    case 'steering-busy':
    case 'steering-insufficient':
      return 'steering'
    case 'coast':
      return 'coast'
    case 'inconsistency':
      return 'consistency'
    case 'min-speed-gain':
    case 'brake-gain':
    case 'throttle-gain':
    case 'good':
      return 'optimal'
  }
}

/** Dependencies the Live Coach engine needs — injectable so it is unit-testable. */
export interface LiveCoachDeps {
  broadcast(channel: string, payload: unknown): void
  /** Corner-map builder (defaults to the real detector). Injectable for tests. */
  buildCornerMap?: (
    trackName: string,
    samples: CornerSample[],
    cfg?: undefined,
    now?: number,
    trackConfigName?: string
  ) => CornerMapData
  /** Clock (defaults to Date.now). Injectable so tests control cooldowns/TTL. */
  now?: () => number
  /** Optional per-driver baseline store (car+track) for lap-to-lap repetition gating. */
  baselineStore?: CoachBaselineStore
  getUnitSystem?: () => UnitSystem
  getLanguage?: () => SpeechLanguage
}

export class LiveCoachEngine {
  private readonly liveGate = new LiveTelemetryGate()
  private running = false
  private startedAt: number | undefined
  private sampleCount = 0
  private lastUpdatedAt: number | undefined
  private lastBroadcastAt = 0
  private lastSpeakAt = -Number.MAX_SAFE_INTEGER
  /** One-shot guard so the "collecting reference lap" warm-up cue speaks once. */
  private warmupCueSent = false
  private settings: CoachSettings = { speakTopTip: DEFAULT_COACH_CONFIG.speakTopTip }
  private autoStartEnabled = DEFAULT_COACH_CONFIG.enabled
  private lastSessionKind: SessionKind = 'practice'

  // Per-lap analysis state.
  private buffer: CoachLapSample[] = []
  private previousSample: CoachLapSample | null = null
  private previousLapNumber: number | undefined
  private recentLapTimes: number[] = []
  // Learned once from the first clean lap, then reused so corner numbers stay stable.
  private cornerMap: CoachCornerMap | null = null
  // Driver's own best lap, reduced to per-corner metrics (bidirectional reference).
  private reference: CoachReferenceLap | null = null
  private referenceLapTimeSec: number | undefined
  // Latest completed-lap findings — the source for both spoken + UI tips.
  private findings: CoachFinding[] = []

  // Live segment cadence — speak the segment we just EXITED.
  private cornerTracker: CornerTracker = createCornerTracker()
  private sectorTracker: SectorTracker = createSectorTracker()
  private readonly sectorStarts = equalSectorStarts(SECTORS)

  // UI tips (one composite per segment), rebuilt each lap.
  private tips = new Map<string, CoachTip>()

  private readonly buildCornerMapFn: NonNullable<LiveCoachDeps['buildCornerMap']>

  constructor(private readonly deps: LiveCoachDeps) {
    this.buildCornerMapFn = deps.buildCornerMap ?? buildCornerMap
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now()
  }

  /**
   * Live-apply the persisted config. `speakTopTip` drives default-on speech;
   * `enabled` arms (or disarms) auto-start. Disabling while running stops the
   * engine so the user's "Parar" sticks.
   */
  applyConfig(config: CoachConfig): void {
    this.settings = { ...this.settings, speakTopTip: config.speakTopTip }
    this.autoStartEnabled = config.enabled
    if (!config.enabled && this.running) this.stop()
  }

  start(settings?: Partial<CoachSettings>): CoachTipsPayload {
    this.settings = { ...this.settings, ...(settings ?? {}) }
    this.running = true
    this.startedAt = this.now()
    this.sampleCount = 0
    this.lastUpdatedAt = undefined
    this.previousLapNumber = undefined
    this.warmupCueSent = false
    this.resetLap()
    this.findings = []
    this.recentLapTimes = []
    this.reference = null
    this.referenceLapTimeSec = undefined
    this.tips.clear()
    this.publish(true)
    return this.payload()
  }

  stop(): CoachTipsPayload {
    this.running = false
    this.resetLap()
    this.publish(true)
    return this.payload()
  }

  payload(): CoachTipsPayload {
    return { status: this.status(), tips: this.currentTips() }
  }

  status(): CoachStatus {
    return {
      running: this.running,
      startedAt: this.startedAt,
      sampleCount: this.sampleCount,
      lastUpdatedAt: this.lastUpdatedAt,
      settings: this.settings
    }
  }

  onSnapshot(snapshot: TelemetrySnapshot | null): void {
    const live = this.liveGate.observe(snapshot)
    if (!live.live) {
      if (live.boundary) this.resetLiveSession()
      return
    }
    if (live.boundary) this.resetLiveSession()

    if (!this.running) {
      // Auto-start on the first LIVE frame (connected + on-track) when enabled.
      if (this.autoStartEnabled && snapshot && snapshot.connected && snapshot.onPitRoad !== true) {
        this.start()
      } else {
        return
      }
    }
    if (!snapshot || !snapshot.connected || snapshot.onPitRoad === true) {
      this.resetLap()
      return
    }
    const sample = coachSampleFromSnapshot(snapshot)
    if (!sample) return

    this.lastSessionKind = deriveSessionKind(snapshot.sessionType)
    this.sampleCount += 1
    this.lastUpdatedAt = this.now()

    // On a completed lap, analyze the buffer (learn corners, findings, reference).
    if (this.crossedLine(snapshot, sample)) {
      this.finalizeLap(snapshot)
      this.buffer = []
    }
    if (this.buffer.length < ENGINE_MAX_LAP_SAMPLES) this.buffer.push(sample)
    this.previousSample = sample
    this.previousLapNumber = finiteOrUndefined(snapshot.currentLap) ?? this.previousLapNumber

    // Live cadence: speak the corner/sector we just exited.
    this.advanceSegments(sample.lapDistPct)
    this.maybeWarmupCue()
    this.publish()
  }

  private resetLiveSession(): void {
    this.sampleCount = 0
    this.lastUpdatedAt = undefined
    this.lastBroadcastAt = 0
    this.lastSpeakAt = -Number.MAX_SAFE_INTEGER
    this.warmupCueSent = false
    this.previousLapNumber = undefined
    this.recentLapTimes = []
    this.cornerMap = null
    this.reference = null
    this.referenceLapTimeSec = undefined
    this.findings = []
    this.lastSessionKind = 'practice'
    this.tips.clear()
    this.resetLap()
    this.publish(true)
  }

  private resetLap(): void {
    this.buffer = []
    this.previousSample = null
    this.cornerTracker = createCornerTracker()
    this.sectorTracker = createSectorTracker()
  }

  // Lap completion: prefer the sim's lap counter; fall back to a lap-distance wrap.
  private crossedLine(snapshot: TelemetrySnapshot, sample: CoachLapSample): boolean {
    const lap = finiteOrUndefined(snapshot.currentLap)
    if (lap !== undefined && this.previousLapNumber !== undefined && lap > this.previousLapNumber) return true
    if (this.previousSample && sample.lapDistPct < 0.08 && this.previousSample.lapDistPct > 0.92) return true
    return false
  }

  private finalizeLap(snapshot: TelemetrySnapshot): void {
    if (this.buffer.length < ENGINE_MIN_LAP_SAMPLES) return
    const samples = this.buffer.slice()
    const lapTimeSec = finiteOrUndefined(snapshot.lastLapTimeSec)
    if (lapTimeSec !== undefined && lapTimeSec > 0) {
      this.recentLapTimes.push(lapTimeSec)
      this.recentLapTimes = this.recentLapTimes.slice(-ENGINE_RECENT_LAPS)
    }
    // Learn the corner map once and reuse it so numbering stays stable.
    if (!this.cornerMap || this.cornerMap.corners.length === 0) {
      const learned = this.buildCornerMapFn(
        snapshot.trackName ?? 'unknown',
        toCornerSamples(samples),
        undefined,
        this.now(),
        snapshot.trackConfigName
      )
      if (learned.corners.length > 0) this.cornerMap = { corners: learned.corners }
    }
    const layoutKey = trackLayoutKey(snapshot.trackName ?? '', snapshot.trackConfigName)
    const baseline = this.deps.baselineStore?.get(layoutKey, snapshot.carName)
    const report = buildCoachReport(
      {
        sectorCount: SECTORS,
        samples,
        lapNumber: this.previousLapNumber,
        lapTimeSec,
        bestLapTimeSec: finiteOrUndefined(snapshot.bestLapTimeSec)
      },
      { recentLapTimesSec: this.recentLapTimes, cornerMap: this.cornerMap, reference: this.reference, registry: intentRegistry, baseline, unitSystem: this.deps.getUnitSystem?.() }
    )
    this.findings = report.findings
    // Learn this lap's events so future laps can tell a repeated issue from noise.
    if (this.deps.baselineStore && baseline) {
      this.deps.baselineStore.put({
        ...baseline,
        repetition: recordLapEvents(baseline.repetition, this.previousLapNumber ?? 0, findingEventKeys(report.findings))
      })
    }
    // Update the bidirectional reference on the fastest valid lap so far.
    if (
      lapTimeSec !== undefined &&
      lapTimeSec > 0 &&
      report.cornerMetrics.length > 0 &&
      (this.referenceLapTimeSec === undefined || lapTimeSec < this.referenceLapTimeSec)
    ) {
      this.reference = { corners: report.cornerMetrics }
      this.referenceLapTimeSec = lapTimeSec
    }
    this.rebuildTips()
  }

  private advanceSegments(lapDistPct: number): void {
    const corners = this.cornerMap?.corners ?? []
    if (corners.length > 0) {
      const adv = advanceCornerTracker(this.cornerTracker, lapDistPct, corners)
      if (adv.completedCorner !== null) this.speakSegment({ corner: adv.completedCorner })
      // Item 4 — sparse/partial corner map: also run the sector tracker so mistakes
      // in regions the map never numbered aren't dropped silently. `findingsForSector`
      // only returns findings with `corner === undefined`, so a sector that fully maps
      // to learned corners yields no advice → no double-speak.
      const sadv = advanceSectorTracker(this.sectorTracker, lapDistPct, this.sectorStarts)
      if (sadv.completedSector !== null) this.speakSegment({ sector: sadv.completedSector })
    } else {
      const adv = advanceSectorTracker(this.sectorTracker, lapDistPct, this.sectorStarts)
      if (adv.completedSector !== null) this.speakSegment({ sector: adv.completedSector })
    }
  }

  /**
   * Item 1 — warm-up silence: before any lap is analyzed the coach has no findings
   * and would say nothing for minutes. Emit ONE "collecting reference lap" cue once
   * enough samples are in, so the driver knows it's alive. Suppressed in races (the
   * proactive engineer owns race audio) and once real findings exist.
   */
  private maybeWarmupCue(): void {
    if (this.warmupCueSent) return
    if (!this.settings.speakTopTip) return
    if (this.lastSessionKind === 'race') return
    if (this.findings.length > 0) return
    if (this.sampleCount < WARMUP_MIN_SAMPLES) return
    this.warmupCueSent = true
    this.lastSpeakAt = this.now()
    const lang = this.deps.getLanguage?.() ?? 'pt-BR'
    const payload: CoachSpeakEvent = {
      text: lang === 'pt-BR' ? 'Coletando volta de referência.' : 'Collecting reference lap.',
      priority: 3,
      tipId: 'live:warmup',
      lang,
      source: 'coach'
    }
    this.deps.broadcast(COACH_CHANNELS.speak, payload)
  }

  /** Findings scoped to one numbered corner. */
  private findingsForCorner(corner: number): CoachFinding[] {
    return this.findings.filter((f) => f.corner === corner)
  }

  /** Findings scoped to one sector that did NOT map to a corner (sector fallback). */
  private findingsForSector(sector: number): CoachFinding[] {
    return this.findings.filter((f) => f.sector === sector && f.corner === undefined)
  }

  private adviceFor(where: { corner?: number; sector?: number }): ComposedCornerAdvice | null {
    const fs = where.corner !== undefined ? this.findingsForCorner(where.corner) : this.findingsForSector(where.sector ?? 0)
    return composeCornerAdvice(fs, where, { maxDims: MAX_CORNER_DIMS })
  }

  private speakSegment(where: { corner?: number; sector?: number }): void {
    if (!this.settings.speakTopTip) return
    // In a RACE the proactive engineer owns the audio (corner-numbered call-outs);
    // muting the live coach here avoids double-speak. Practice/qualy keep speaking.
    if (this.lastSessionKind === 'race') return
    const advice = this.adviceFor(where)
    if (!advice) return
    if (advice.worstLossSec < MIN_SPEAK_LOSS_SEC) return
    const now = this.now()
    if (now - this.lastSpeakAt < SPEAK_COOLDOWN_MS) return
    this.lastSpeakAt = now
    const lang = this.deps.getLanguage?.() ?? 'pt-BR'
    const payload: CoachSpeakEvent = {
      text: advice.text,
      priority: advice.severity === 'high' ? 8 : 5,
      tipId: where.corner !== undefined ? `live:corner:${where.corner}` : `live:sector:${where.sector}`,
      lang,
      source: 'coach',
      corner: where.corner
    }
    this.deps.broadcast(COACH_CHANNELS.speak, payload)
  }

  /** Rebuild the UI tip list — one COMPOSITE tip per segment plus lap-global ones. */
  private rebuildTips(): void {
    const now = this.now()
    const next = new Map<string, CoachTip>()
    const corners = this.cornerMap?.corners ?? []
    const segments: Array<{ where: { corner?: number; sector?: number }; id: string }> = []
    if (corners.length > 0) {
      for (const c of corners) segments.push({ where: { corner: c.index }, id: `live:corner:${c.index}` })
    } else {
      for (let s = 1; s <= SECTORS; s += 1) segments.push({ where: { sector: s }, id: `live:sector:${s}` })
    }
    for (const seg of segments) {
      const advice = this.adviceFor(seg.where)
      if (!advice) continue
      next.set(seg.id, {
        id: seg.id,
        kind: issueKindForFindingKind(advice.kinds[0]),
        sector: seg.where.sector,
        corner: seg.where.corner,
        severity: advice.severity,
        message: advice.text,
        estTimeLossSec: advice.worstLossSec,
        evidence: advice.actions.join(', '),
        action: advice.actions.join(', '),
        createdAt: now
      })
    }
    // Lap-global findings (inconsistency) carry no corner/sector → a bare tip.
    for (const f of this.findings) {
      if (f.kind !== 'inconsistency') continue
      next.set('live:inconsistency', {
        id: 'live:inconsistency',
        kind: 'consistency',
        severity: f.severity,
        message: f.detail,
        estTimeLossSec: f.estTimeLossSec,
        evidence: f.evidence,
        action: 'repita os pontos de freada',
        createdAt: now
      })
    }
    this.tips = next
  }

  private currentTips(): CoachTip[] {
    const now = this.now()
    return Array.from(this.tips.values())
      .filter((tip) => now - tip.createdAt <= TIP_TTL_MS)
      .sort((a, b) => {
        const lossA = a.estTimeLossSec ?? (a.severity === 'good' ? -1 : 0)
        const lossB = b.estTimeLossSec ?? (b.severity === 'good' ? -1 : 0)
        return lossB - lossA || b.createdAt - a.createdAt
      })
      .slice(0, MAX_TIPS)
  }

  private publish(force = false): void {
    const now = this.now()
    if (!force && now - this.lastBroadcastAt < BROADCAST_MIN_MS) return
    this.lastBroadcastAt = now
    this.deps.broadcast(COACH_CHANNELS.updated, this.payload())
  }
}


function clamp01(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function finiteOrUndefined(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) ? value : undefined
}

/** Reduce a buffered lap to the minimal samples the corner-map detector needs. */
function toCornerSamples(samples: CoachLapSample[]): CornerSample[] {
  return samples.map((s) => ({
    lapDistPct: s.lapDistPct,
    speedKmh: s.speedKmh,
    brake: s.brake,
    throttle: s.throttle,
    steerAbsDeg: s.steerAbsDeg
  }))
}

// ─────────────────────────────────────────────────────────────────────────────
// F2 — Lap-buffered coach + setup advisor (on-demand, deterministic-first).
//
// Buffers each lap of reduced telemetry, runs the PURE analyzers in shared/coach.ts
// + shared/setup-advisor.ts on lap completion, and exposes report/explain IPC. The
// local LLM is NEVER touched in the telemetry path: it is only (optionally) invoked
// by `coach:explain` to PHRASE a single finding, and only when a model is already
// on disk — every finding ships with deterministic text that fully works offline.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_LAP_SAMPLES = 8000
const MIN_LAP_SAMPLES = 30
const MAX_REPORTS = 6
const RECENT_LAPS = 8
const EXPLAIN_TIMEOUT_MS = 8000
const EXPLAIN_MAX_TOKENS = 96

export interface LapCoachDeps {
  broadcast(channel: string, payload: unknown): void
  /** Lazy LLM accessors — kept optional so the analyzer works with the model off. */
  getModelPath?: () => string | null
  getModelId?: () => string
  generate?: (request: {
    system?: string
    prompt: string
    maxTokens?: number
    temperature?: number
    signal?: AbortSignal
  }) => Promise<{ ok: boolean; text?: string }>
  setModel?: (modelPath: string, modelId: string) => void
  getUnitSystem?: () => UnitSystem
}

export class LapCoachAnalyzer {
  private readonly liveGate = new LiveTelemetryGate()
  private liveContext: LiveTelemetryContext | null = null
  private explainAbort: AbortController | null = null
  private buffer: CoachLapSample[] = []
  private previous: CoachLapSample | null = null
  private previousLapNumber: number | undefined
  private recentLapTimes: number[] = []
  private reports: CoachReport[] = []
  private latestReport: CoachReport | null = null
  private latestSetup: SetupReport | null = null
  // Per-track corner map, learned lazily from the first full clean lap and then
  // reused for every subsequent lap so corner numbers stay stable.
  private cornerMap: CornerMapData | null = null
  // Driver's own best lap, reduced to per-corner metrics — the bidirectional
  // gain/loss reference. Updated whenever a faster valid lap completes.
  private reference: CoachReferenceLap | null = null
  private referenceLapTimeSec: number | undefined

  constructor(private readonly deps: LapCoachDeps) {}

  onSnapshot(snapshot: TelemetrySnapshot | null): void {
    const live = this.liveGate.observe(snapshot)
    if (!live.live) {
      if (live.boundary) this.resetLiveSession()
      return
    }
    if (live.boundary) this.resetLiveSession()
    this.liveContext = live.context
    if (!snapshot) return

    if (snapshot.onPitRoad === true) {
      // Discard a partial lap in the pits / when disconnected.
      this.buffer = []
      this.previous = null
      return
    }
    const sample = coachSampleFromSnapshot(snapshot)
    if (!sample) return

    if (this.crossedLine(snapshot, sample)) {
      this.finalizeLap(snapshot)
      this.buffer = []
    }

    if (this.buffer.length < MAX_LAP_SAMPLES) this.buffer.push(sample)
    this.previous = sample
    this.previousLapNumber = finiteOrUndefined(snapshot.currentLap)
  }

  private resetLiveSession(): void {
    this.explainAbort?.abort()
    this.explainAbort = null
    this.liveContext = null
    this.buffer = []
    this.previous = null
    this.previousLapNumber = undefined
    this.recentLapTimes = []
    this.reports = []
    this.latestReport = null
    this.latestSetup = null
    this.cornerMap = null
    this.reference = null
    this.referenceLapTimeSec = undefined
    this.deps.broadcast(COACH_CHANNELS.report, this.payload())
  }

  // Lap completion: prefer the sim's lap counter; fall back to a lap-distance wrap.
  private crossedLine(snapshot: TelemetrySnapshot, sample: CoachLapSample): boolean {
    const lap = finiteOrUndefined(snapshot.currentLap)
    if (lap !== undefined && this.previousLapNumber !== undefined) {
      if (lap > this.previousLapNumber) return true
    }
    if (this.previous && sample.lapDistPct < 0.08 && this.previous.lapDistPct > 0.92) return true
    return false
  }

  private finalizeLap(snapshot: TelemetrySnapshot): void {
    if (this.buffer.length < MIN_LAP_SAMPLES) return
    const lapTimeSec = finiteOrUndefined(snapshot.lastLapTimeSec)
    if (lapTimeSec !== undefined && lapTimeSec > 0) {
      this.recentLapTimes.push(lapTimeSec)
      this.recentLapTimes = this.recentLapTimes.slice(-RECENT_LAPS)
    }
    const samples = this.buffer.slice()
    // Learn the corner map once from the first complete lap; reuse it afterwards
    // so corner numbering stays stable across the session.
    if (!this.cornerMap || this.cornerMap.corners.length === 0) {
      const learned = buildCornerMap(snapshot.trackName ?? 'unknown', toCornerSamples(samples))
      if (learned.corners.length > 0) this.cornerMap = learned
    }
    const report = buildCoachReport(
      {
        sectorCount: 3,
        samples,
        lapNumber: this.previousLapNumber,
        lapTimeSec,
        bestLapTimeSec: finiteOrUndefined(snapshot.bestLapTimeSec)
      },
      { recentLapTimesSec: this.recentLapTimes, cornerMap: this.cornerMap, reference: this.reference, registry: intentRegistry, unitSystem: this.deps.getUnitSystem?.() }
    )
    // Update the bidirectional reference when this is the fastest valid lap so far.
    if (
      lapTimeSec !== undefined &&
      lapTimeSec > 0 &&
      report.cornerMetrics.length > 0 &&
      (this.referenceLapTimeSec === undefined || lapTimeSec < this.referenceLapTimeSec)
    ) {
      this.reference = { corners: report.cornerMetrics }
      this.referenceLapTimeSec = lapTimeSec
    }
    const setup = buildSetupReport(buildSetupInput(snapshot, report.findings), { unitSystem: this.deps.getUnitSystem?.() })
    this.latestReport = report
    this.latestSetup = setup
    this.reports.push(report)
    this.reports = this.reports.slice(-MAX_REPORTS)
    this.deps.broadcast(COACH_CHANNELS.report, this.payload())
  }

  payload(): CoachReportPayload {
    return { report: this.latestReport, setup: this.latestSetup }
  }

  lastFindings(): { findings: CoachFinding[]; setup: SetupReport | null } {
    return { findings: this.latestReport?.findings ?? [], setup: this.latestSetup }
  }

  private findFinding(req: CoachExplainRequest): CoachFinding | null {
    if (req.finding) return req.finding
    if (req.findingId && this.latestReport) {
      return this.latestReport.findings.find((f) => f.id === req.findingId) ?? null
    }
    return null
  }

  async explain(req: CoachExplainRequest): Promise<CoachExplainResult> {
    const finding = this.findFinding(req)
    if (!finding) {
      return { text: 'No coaching data to explain yet. Complete a lap first.', source: 'deterministic' }
    }
    const deterministic = deterministicPhrasing(finding)
    if (!req.useLlm || !this.deps.generate || !this.deps.getModelPath) {
      return { text: deterministic, source: 'deterministic', findingId: finding.id }
    }
    // Only touch the LLM when a model is already present — never trigger a download.
    const modelPath = this.deps.getModelPath()
    if (!modelPath) return { text: deterministic, source: 'deterministic', findingId: finding.id }
    const context = this.liveContext
    if (!context) return { text: deterministic, source: 'deterministic', findingId: finding.id }
    const controller = new AbortController()
    try {
      this.deps.setModel?.(modelPath, this.deps.getModelId?.() ?? '')
      this.explainAbort?.abort()
      this.explainAbort = controller
      const timer = setTimeout(() => controller.abort(), EXPLAIN_TIMEOUT_MS)
      if (typeof timer === 'object' && timer && 'unref' in timer) (timer as { unref?: () => void }).unref?.()
      const result = await this.deps
        .generate({
          system:
            'You are an objective, practical driving coach. Rewrite the technical observation in 1 to 2 short, direct American English sentences telling the driver what to do. Do not invent data; use only the provided numbers.',
          prompt: explainPrompt(finding),
          maxTokens: EXPLAIN_MAX_TOKENS,
          temperature: 0.3,
          signal: controller.signal
        })
        .finally(() => clearTimeout(timer))
      if (!sameLiveTelemetryContext(this.liveContext, context)) {
        return { text: '', source: 'deterministic', findingId: finding.id }
      }
      const text = (result.text ?? '').trim()
      if (result.ok && text.length > 0) {
        return { text, source: 'llm', findingId: finding.id }
      }
    } catch {
      // fall through to deterministic
    } finally {
      if (this.explainAbort === controller) this.explainAbort = null
    }
    if (!sameLiveTelemetryContext(this.liveContext, context)) {
      return { text: '', source: 'deterministic', findingId: finding.id }
    }
    return { text: deterministic, source: 'deterministic', findingId: finding.id }
  }
}

function explainPrompt(finding: CoachFinding): string {
  const metrics = Object.entries(finding.metrics)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ')
  const phase = finding.phase ? ` (fase: ${finding.phase})` : ''
  return [
    `Observation: ${finding.title}${phase}, sector ${finding.sector}.`,
    `Detalhe: ${finding.detail}`,
    `Evidence: ${finding.evidence}.`,
    metrics ? `Metrics: ${metrics}.` : '',
    finding.severity !== 'good' ? `Perda estimada: ${finding.estTimeLossSec.toFixed(2)}s.` : '',
    'Reply only with the advice to the driver.'
  ]
    .filter(Boolean)
    .join('\n')
}

// ── Telemetry → setup-advisor input (tyre tread mapping + heuristic balance) ──

function num(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) ? value : undefined
}

// "left/middle/right" are across the tread as mounted. The INNER edge (toward the
// car centreline) is the RIGHT side for left-hand tyres and the LEFT side for
// right-hand tyres — so camber/pressure logic stays car-agnostic downstream.
function treadFor(side: 'left' | 'right', info: TyreInfo | undefined): TyreTreadTemps | undefined {
  if (!info) return undefined
  const left = num(info.tempLeftC) ?? num(info.surfaceTempLeftC)
  const middle = num(info.tempMiddleC) ?? num(info.surfaceTempMiddleC)
  const right = num(info.tempRightC) ?? num(info.surfaceTempRightC)
  const inner = side === 'left' ? right : left
  const outer = side === 'left' ? left : right
  const tread: TyreTreadTemps = {}
  if (inner !== undefined) tread.innerC = inner
  if (middle !== undefined) tread.middleC = middle
  if (outer !== undefined) tread.outerC = outer
  const core = num(info.tempC)
  if (core !== undefined) tread.coreC = core
  const pressure = num(info.pressureKpa)
  if (pressure !== undefined) tread.pressureKpa = pressure
  const wear = num(info.wearPct)
  if (wear !== undefined) tread.wearPct = wear
  return Object.keys(tread).length > 0 ? tread : undefined
}

function buildTyres(corners: Corners<TyreInfo> | undefined): CornerTyres | undefined {
  if (!corners) return undefined
  const out: CornerTyres = {}
  const lf = treadFor('left', corners.lf)
  const rf = treadFor('right', corners.rf)
  const lr = treadFor('left', corners.lr)
  const rr = treadFor('right', corners.rr)
  if (lf) out.lf = lf
  if (rf) out.rf = rf
  if (lr) out.lr = lr
  if (rr) out.rr = rr
  return Object.keys(out).length > 0 ? out : undefined
}

// HEURISTIC: infer a per-phase understeer(-)/oversteer(+) bias from the coach
// findings so the setup advisor can suggest a balance change. This is a coarse
// signal (no chassis model), weighted by each finding's estimated time loss.
function deriveBalanceSignals(findings: CoachFinding[]): SetupBalanceSignal[] {
  const score: Record<CoachPhase, number> = { entry: 0, mid: 0, exit: 0 }
  const note: Record<CoachPhase, string[]> = { entry: [], mid: [], exit: [] }
  for (const f of findings) {
    if (f.severity === 'good') continue
    const w = Math.max(0.04, f.estTimeLossSec)
    const phase: CoachPhase = f.phase ?? 'mid'
    switch (f.kind) {
      case 'trail-brake-lock':
        score.entry += 1.5 * w
        note.entry.push('trail-brake travando')
        break
      case 'tc-overuse':
        score.exit += 1.5 * w
        note.exit.push('TC cutting on exit')
        break
      case 'brake-early':
        score.entry -= w
        note.entry.push('freada cedo')
        break
      case 'abs-overuse':
        score.entry -= 0.5 * w
        note.entry.push('ABS demais')
        break
      case 'steering-busy':
        score[phase] -= 1.5 * w
        note[phase].push('steering agitado')
        break
      case 'coast':
        if (phase === 'mid') {
          score.mid -= w
          note.mid.push('coasting at the apex')
        }
        break
      case 'throttle-hesitation':
        score.exit -= 0.5 * w
        note.exit.push('hesitant exit')
        break
      default:
        break
    }
  }
  const out: SetupBalanceSignal[] = []
  for (const phase of ['entry', 'mid', 'exit'] as CoachPhase[]) {
    const bias = Math.max(-1, Math.min(1, score[phase] * 3))
    if (Math.abs(bias) >= 0.25) {
      out.push({ phase, bias, evidence: note[phase].length ? `Sinais: ${note[phase].join(', ')}` : undefined })
    }
  }
  return out
}

function deriveFrontLock(findings: CoachFinding[]): boolean {
  return findings.some((f) => f.kind === 'brake-late' || f.kind === 'trail-brake-lock' || f.kind === 'abs-overuse')
}

function buildSetupInput(
  snapshot: TelemetrySnapshot,
  findings: CoachFinding[]
): {
  tyres?: CornerTyres
  brakeBiasPct?: number
  balance?: SetupBalanceSignal[]
  frontLock?: boolean
} {
  return {
    tyres: buildTyres(snapshot.tyres),
    brakeBiasPct: num(snapshot.brakeBiasPct),
    balance: deriveBalanceSignals(findings),
    frontLock: deriveFrontLock(findings)
  }
}

let engine: LiveCoachEngine | null = null
let analyzer: LapCoachAnalyzer | null = null

// Lazy, fault-tolerant access to the app-wide LLM singletons. The coach module
// registers BEFORE the engineer module that owns these singletons, so we must NOT
// touch them at register() time (getModelManager throws before it is configured).
// By the time `coach:explain` can fire, the engineer has constructed both.
function tryModelManager(): ReturnType<typeof getModelManager> | null {
  try {
    return getModelManager()
  } catch {
    return null
  }
}

function tryRuntime(): ReturnType<typeof getLlmRuntime> | null {
  try {
    return getLlmRuntime()
  } catch {
    return null
  }
}

const CONFIG_FILE = 'coach.json'

let coachConfig: CoachConfig = DEFAULT_COACH_CONFIG

async function loadCoachConfig(configPath: string): Promise<CoachConfig> {
  try {
    const raw = await readFile(configPath, 'utf8')
    const parsed = JSON.parse(raw) as CoachConfigPatch
    return mergeCoachConfig(DEFAULT_COACH_CONFIG, parsed)
  } catch {
    return { ...DEFAULT_COACH_CONFIG, updatedAt: Date.now() }
  }
}

async function saveCoachConfig(configPath: string, nextConfig: CoachConfig): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, 'utf8')
}

export function register(ctx: ModuleContext): void {
  let unitSystem: UnitSystem = 'metric'
  let speechLanguage: SpeechLanguage = 'en-US'
  settingsEvents.onChanged((settings) => {
    unitSystem = settings.unitSystem
    speechLanguage = speechLanguageFromAppLanguage(settings.language, ctx.app.getLocale())
  })
  engine = new LiveCoachEngine({
    broadcast: (channel, payload) => ctx.broadcast(channel, payload),
    baselineStore: getCoachBaselineStore(ctx.app.getPath('userData')),
    getUnitSystem: () => unitSystem,
    getLanguage: () => speechLanguage
  })

  // Persisted coach config (speakTopTip + phraseWithAi). Mirrors the spotter
  // module's JSON-in-userData lifecycle so the Live Coach speaks by default and
  // the "Frasear com IA" choice survives navigation/reloads.
  const configPath = join(ctx.app.getPath('userData'), CONFIG_FILE)
  void loadCoachConfig(configPath).then((loaded) => {
    coachConfig = loaded
    engine?.applyConfig(coachConfig)
    logger.info('coach', 'config loaded', {
      enabled: coachConfig.enabled,
      speakTopTip: coachConfig.speakTopTip,
      phraseWithAi: coachConfig.phraseWithAi
    })
    ctx.broadcast(COACH_CHANNELS.configEvent, coachConfig)
  })

  // The coach only PHRASES findings on demand and never downloads a model: it
  // reuses the engineer's model singletons lazily and only when one is on disk.
  analyzer = new LapCoachAnalyzer({
    broadcast: (channel, payload) => ctx.broadcast(channel, payload),
    getModelPath: () => tryModelManager()?.getActiveModelPath() ?? null,
    getModelId: () => tryModelManager()?.getActiveModelId() ?? '',
    setModel: (modelPath) => tryRuntime()?.setOptions({ modelPath }),
    getUnitSystem: () => unitSystem,
    generate: async (request) => {
      const runtime = tryRuntime()
      if (!runtime) return { ok: false }
      const r = await runtime.generate(request)
      return { ok: r.ok, text: r.ok ? r.text : undefined }
    }
  })

  ctx.telemetryHub.on('snapshot', (snapshot: TelemetrySnapshot | null) => {
    // The coach engine now runs by DEFAULT (auto-start), so a latent throw here
    // must not skip the lap analyzer for everyone — isolate it like the analyzer.
    try {
      engine?.onSnapshot(snapshot)
    } catch (error) {
      logger.warn('coach', 'coach engine failed', { message: error instanceof Error ? error.message : String(error) })
    }
    try {
      analyzer?.onSnapshot(snapshot)
    } catch (error) {
      logger.warn('coach', 'lap analyzer failed', { message: error instanceof Error ? error.message : String(error) })
    }
  })

  ctx.ipcMain.handle(COACH_CHANNELS.start, (_event, settings?: Partial<CoachSettings>) => engine?.start(settings))
  ctx.ipcMain.handle(COACH_CHANNELS.stop, () => engine?.stop())
  ctx.ipcMain.handle(COACH_CHANNELS.tips, () => engine?.payload())

  // ── Persisted config (get/set) ──
  ctx.ipcMain.handle(COACH_CHANNELS.getConfig, () => coachConfig)
  ctx.ipcMain.handle(COACH_CHANNELS.setConfig, async (_event, patch: CoachConfigPatch) => {
    coachConfig = mergeCoachConfig(coachConfig, patch ?? {})
    engine?.applyConfig(coachConfig)
    logger.info('coach', 'config changed', {
      enabled: coachConfig.enabled,
      speakTopTip: coachConfig.speakTopTip,
      phraseWithAi: coachConfig.phraseWithAi
    })
    await saveCoachConfig(configPath, coachConfig)
    ctx.broadcast(COACH_CHANNELS.configEvent, coachConfig)
    return coachConfig
  })

  // ── F2 lap coach + setup advisor ──
  ctx.ipcMain.handle(COACH_CHANNELS.getReport, () => analyzer?.payload() ?? { report: null, setup: null })
  ctx.ipcMain.handle(COACH_CHANNELS.lastFindings, () => analyzer?.lastFindings() ?? { findings: [], setup: null })
  ctx.ipcMain.handle(COACH_CHANNELS.explain, (_event, req?: CoachExplainRequest) =>
    analyzer?.explain(req ?? {}) ?? Promise.resolve({ text: '', source: 'deterministic' as const })
  )
}
