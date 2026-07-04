// Typed "tool" descriptors + implementations for the AI Race Engineer.
//
// These are framework-agnostic: each tool exposes `name`, `description`, a
// JSON-schema-ish `parameters`, and an async `run(args)`. The LLM orchestrator
// adapts them to node-llama-cpp's `defineChatSessionFunction` — NOTHING here
// imports node-llama-cpp. All data comes read-only from the live engines via the
// `EngineerContext` adapter (the orchestrator wires its real calculator
// instances into the optional getters; missing states are derived from the raw
// telemetry snapshot).

import type {
  CarTrackToolResult,
  CoachFindingsToolResult,
  CoachTipsToolResult,
  DeltaToolResult,
  EngineerContext,
  EngineerTool,
  EngineerToolset,
  FuelToolResult,
  GapsToolResult,
  PackEvent,
  PositionToolResult,
  PredictionsToolResult,
  RecentEventsToolResult,
  StrategyToolResult,
  TyreCornerToolResult,
  TyresToolResult,
  WeatherToolResult
} from '../../shared/ai-engineer'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import {
  computePitRecommendation,
  deriveCarTrack,
  deriveFuel,
  deriveGaps,
  derivePosition,
  deriveTiming,
  deriveTyres,
  deriveWeather,
  formatLapTime,
  formatSignedSec,
  isFiniteNum,
  isPositive
} from './context-pack'

const NO_OBJECT_PARAMS = { type: 'object' as const, properties: {} }

export const TOOL_NAMES = [
  'getFuelState',
  'getDelta',
  'getStrategy',
  'getPosition',
  'getGaps',
  'getTyres',
  'getWeather',
  'getCarTrack',
  'getRecentEvents',
  'getCoachTips',
  'getCoachFindings',
  'getPredictions'
] as const

export type ToolName = (typeof TOOL_NAMES)[number]

// Convenience: a minimal EngineerContext from a bare snapshot (tests / simple
// callers). The orchestrator normally supplies a richer context with live
// engine-state getters.
export function engineerContextFromSnapshot(snapshot: TelemetrySnapshot | null): EngineerContext {
  return { getSnapshot: () => snapshot }
}

function connected(ctx: EngineerContext): boolean {
  return ctx.getSnapshot()?.connected ?? false
}

// ─── individual tools ────────────────────────────────────────────────────────

function fuelTool(ctx: EngineerContext): EngineerTool<Record<string, never>, FuelToolResult> {
  return {
    name: 'getFuelState',
    description: 'Current fuel: litres on board, usage per lap, laps left, fuel needed to finish, surplus/deficit, save target and pit-window status.',
    parameters: NO_OBJECT_PARAMS,
    run: async () => {
      const snapshot = ctx.getSnapshot()
      const f = deriveFuel(snapshot, ctx.getFuelState?.())
      const available = connected(ctx) && (isFiniteNum(f.liters) || isFiniteNum(f.lapsLeft))
      const summary = available
        ? [
            isFiniteNum(f.liters) ? `${f.liters}L` : null,
            isFiniteNum(f.perLap) ? `${f.perLap}L/lap` : null,
            isFiniteNum(f.lapsLeft) ? `~${f.lapsLeft} laps` : null,
            f.canFinish === false ? 'short to finish' : f.canFinish === true ? 'can finish' : null,
            f.status ? f.status : null
          ].filter(Boolean).join(', ')
        : 'no fuel data'
      return {
        available,
        fuelLiters: f.liters,
        fuelPerLap: f.perLap,
        lapsLeft: f.lapsLeft,
        raceLapsRemaining: f.raceLapsRemaining,
        fuelToFinishLiters: f.toFinishLiters,
        deltaToFinishLiters: f.deltaToFinishLiters,
        saveTargetPerLap: f.saveTargetPerLap,
        canFinish: f.canFinish,
        status: f.status,
        summary
      }
    }
  }
}

function deltaTool(ctx: EngineerContext): EngineerTool<Record<string, never>, DeltaToolResult> {
  return {
    name: 'getDelta',
    description: "Lap-time delta vs the driver's best lap, plus last/best/predicted lap times and whether they're gaining or losing.",
    parameters: NO_OBJECT_PARAMS,
    run: async () => {
      const t = deriveTiming(ctx.getSnapshot(), ctx.getLapTiming?.())
      const available = connected(ctx) && (isFiniteNum(t.deltaSec) || isPositive(t.bestSec) || isPositive(t.lastSec))
      const trend = isFiniteNum(t.deltaSec) ? (t.deltaSec < -0.02 ? 'gaining' : t.deltaSec > 0.02 ? 'losing' : 'flat') : undefined
      const summary = available
        ? [
            isFiniteNum(t.deltaSec) ? `Δ ${formatSignedSec(t.deltaSec)}` : null,
            isPositive(t.lastSec) ? `last ${formatLapTime(t.lastSec)}` : null,
            isPositive(t.bestSec) ? `best ${formatLapTime(t.bestSec)}` : null
          ].filter(Boolean).join(', ')
        : 'no lap-time data'
      return {
        available,
        deltaToBestSec: t.deltaSec,
        lastLapSec: t.lastSec,
        bestLapSec: t.bestSec,
        predictedSec: t.predictedSec,
        trend,
        summary
      }
    }
  }
}

function strategyTool(ctx: EngineerContext): EngineerTool<Record<string, never>, StrategyToolResult> {
  return {
    name: 'getStrategy',
    description: 'Deterministic pit recommendation combining fuel status, tyre life and damage: whether to pit, why, and the suggested pit lap.',
    parameters: NO_OBJECT_PARAMS,
    run: async () => {
      const rec = computePitRecommendation(ctx.getSnapshot(), ctx.getFuelState?.(), ctx.getTireState?.())
      return {
        available: connected(ctx),
        recommendPit: rec.recommendPit,
        reason: rec.reason,
        fuelStatus: rec.fuelStatus,
        fuelLapsLeft: rec.fuelLapsLeft,
        tyreLapsLeft: rec.tyreLapsLeft,
        recommendedPitLap: rec.recommendedPitLap,
        summary: rec.reason
      }
    }
  }
}

function positionTool(ctx: EngineerContext): EngineerTool<Record<string, never>, PositionToolResult> {
  return {
    name: 'getPosition',
    description: 'Current overall and class position and the total number of cars in the session.',
    parameters: NO_OBJECT_PARAMS,
    run: async () => {
      const p = derivePosition(ctx.getSnapshot())
      const available = connected(ctx) && (isPositive(p.position) || isPositive(p.classPosition))
      const summary = available
        ? [
            isPositive(p.position) ? `P${p.position}` : null,
            isPositive(p.classPosition) ? `class P${p.classPosition}` : null,
            isPositive(p.totalCars) ? `of ${p.totalCars}` : null
          ].filter(Boolean).join(' ')
        : 'no position data'
      return { available, position: p.position, classPosition: p.classPosition, totalCars: p.totalCars, summary }
    }
  }
}

function gapsTool(ctx: EngineerContext): EngineerTool<{ side?: string }, GapsToolResult> {
  return {
    name: 'getGaps',
    description: 'Time gap to the car ahead and the car behind (seconds), with their names when available.',
    parameters: {
      type: 'object',
      properties: {
        side: { type: 'string', description: 'Which gap to focus on.', enum: ['ahead', 'behind', 'both'] }
      }
    },
    run: async (args) => {
      const g = deriveGaps(ctx.getSnapshot())
      const side = args?.side === 'ahead' || args?.side === 'behind' ? args.side : 'both'
      const available = connected(ctx) && (isFiniteNum(g.aheadSec) || isFiniteNum(g.behindSec))
      const parts: string[] = []
      if ((side === 'ahead' || side === 'both') && isFiniteNum(g.aheadSec)) parts.push(`ahead ${g.aheadSec}s`)
      if ((side === 'behind' || side === 'both') && isFiniteNum(g.behindSec)) parts.push(`behind ${g.behindSec}s`)
      return {
        available,
        aheadSec: g.aheadSec,
        behindSec: g.behindSec,
        aheadName: g.aheadName,
        behindName: g.behindName,
        summary: parts.length ? parts.join(', ') : 'no cars close'
      }
    }
  }
}

function tyresTool(ctx: EngineerContext): EngineerTool<Record<string, never>, TyresToolResult> {
  return {
    name: 'getTyres',
    description: 'Tyre temperatures and wear per corner (LF/RF/LR/RR), the worst corner, laps left on the tyres, and whether wear is estimated.',
    parameters: NO_OBJECT_PARAMS,
    run: async () => {
      const tyres = deriveTyres(ctx.getSnapshot(), ctx.getTireState?.())
      const tire = ctx.getTireState?.()
      const corners: TyreCornerToolResult[] = []
      for (const id of ['lf', 'rf', 'lr', 'rr'] as const) {
        const corner = tyres[id]
        if (!corner) continue
        corners.push({
          id: id.toUpperCase(),
          tempC: corner.tempC,
          wearPct: corner.wearPct,
          lapsToThreshold: tire?.corners?.[id]?.lapsToThreshold
        })
      }
      const available = connected(ctx) && corners.length > 0
      const summary = available
        ? corners.map((c) => `${c.id} ${[isFiniteNum(c.tempC) ? `${c.tempC}°` : null, isFiniteNum(c.wearPct) ? `${c.wearPct}%` : null].filter(Boolean).join('/')}`).join(', ')
        : 'no tyre data'
      return {
        available,
        corners,
        worstCorner: tyres.worst,
        lapsLeft: tyres.lapsLeft,
        estimated: tyres.estimated ?? false,
        summary
      }
    }
  }
}

function weatherTool(ctx: EngineerContext): EngineerTool<Record<string, never>, WeatherToolResult> {
  return {
    name: 'getWeather',
    description: 'Air/track temperature, track wetness, whether it is raining, whether wet conditions are declared, and the current surface under the car.',
    parameters: NO_OBJECT_PARAMS,
    run: async () => {
      const w = deriveWeather(ctx.getSnapshot())
      const available = connected(ctx) && (isFiniteNum(w.airTempC) || isFiniteNum(w.trackTempC) || typeof w.raining === 'boolean' || isFiniteNum(w.wetnessPct))
      const wet = w.declaredWet === true || w.raining === true || (isFiniteNum(w.wetnessPct) && w.wetnessPct >= 15)
      const summary = available
        ? [
            wet ? 'wet' : 'dry',
            isFiniteNum(w.airTempC) ? `air ${w.airTempC}°` : null,
            isFiniteNum(w.trackTempC) ? `track ${w.trackTempC}°` : null
          ].filter(Boolean).join(', ')
        : 'no weather data'
      return {
        available,
        airTempC: w.airTempC,
        trackTempC: w.trackTempC,
        wetnessPct: w.wetnessPct,
        raining: w.raining,
        declaredWet: w.declaredWet,
        surface: w.surface,
        summary
      }
    }
  }
}

function carTrackTool(ctx: EngineerContext): EngineerTool<Record<string, never>, CarTrackToolResult> {
  return {
    name: 'getCarTrack',
    description: 'The current car, track, sim and session type.',
    parameters: NO_OBJECT_PARAMS,
    run: async () => {
      const snapshot = ctx.getSnapshot()
      const ct = deriveCarTrack(snapshot)
      const available = Boolean(ct.car || ct.track)
      const summary = [ct.car, ct.track ? `@ ${ct.track}` : null, ct.sim ? `(${ct.sim})` : null].filter(Boolean).join(' ') || 'no car/track data'
      return { available, car: ct.car, track: ct.track, sim: ct.sim, sessionType: snapshot?.sessionType, summary }
    }
  }
}

function recentEventsTool(ctx: EngineerContext): EngineerTool<{ limit?: number }, RecentEventsToolResult> {
  return {
    name: 'getRecentEvents',
    description: 'The last few notable session events (incidents, flags, pit calls, coach notes), newest last.',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Max events to return (default 5).' } }
    },
    run: async (args) => {
      const all: PackEvent[] = ctx.getRecentEvents?.() ?? []
      const limit = isPositive(args?.limit) ? Math.floor(args!.limit as number) : 5
      const events = all.slice(-limit)
      return { events, summary: events.length ? events.map((e) => e.text).join(' | ') : 'no recent events' }
    }
  }
}

function coachTipsTool(ctx: EngineerContext): EngineerTool<Record<string, never>, CoachTipsToolResult> {
  return {
    name: 'getCoachTips',
    description: 'Current driving-coach tips (where time is being lost): severity, message and sector.',
    parameters: NO_OBJECT_PARAMS,
    run: async () => {
      const raw = ctx.getCoachTips?.() ?? []
      const tips = raw.slice(0, 5).map((tip) => ({ severity: tip.severity, message: tip.message, sector: tip.sector, kind: tip.kind }))
      return { tips, summary: tips.length ? tips.map((t) => `[${t.severity}] ${t.message}`).join(' | ') : 'no coach tips' }
    }
  }
}

function coachFindingsTool(ctx: EngineerContext): EngineerTool<{ limit?: number }, CoachFindingsToolResult> {
  return {
    name: 'getCoachFindings',
    description:
      "The latest deterministic driving-coach findings from the F2 lap analysis (worst-first): per-sector mistakes with estimated time lost, what went wrong and how to fix it. Use this to cite the driver's biggest mistakes with real numbers.",
    parameters: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Max findings to return, by time loss (default 3, clamped 1–10).' } }
    },
    run: async (args) => {
      const raw = ctx.getCoachFindings?.() ?? []
      const requested = isPositive(args?.limit) ? Math.floor(args!.limit as number) : 3
      const limit = Math.max(1, Math.min(10, requested))
      const actionable = raw.filter((f) => f.kind !== 'good')
      const findings = actionable.slice(0, limit).map((f) => ({
        kind: f.kind,
        sector: f.sector,
        severity: f.severity,
        estTimeLossSec: f.estTimeLossSec,
        title: f.title,
        detail: f.detail,
        evidence: f.evidence
      }))
      const available = findings.length > 0
      const summary = available
        ? findings.map((f) => `S${f.sector} ${f.title} (~${f.estTimeLossSec.toFixed(2)}s)`).join(' | ')
        : 'no coach findings yet'
      return { available, findings, summary }
    }
  }
}

// ─── factory ─────────────────────────────────────────────────────────────────

function predictionsTool(ctx: EngineerContext): EngineerTool<Record<string, never>, PredictionsToolResult> {
  return {
    name: 'getPredictions',
    description:
      'Forward-looking race predictions at the current pace: time/laps to catch the car ahead, time/laps until the car behind catches you, fuel margin to the finish, tyre degradation + laps to the cliff, and the projected lap time with a confidence. Use this to answer "will I catch them / get caught", "do I have enough fuel", "when do my tyres fall off".',
    parameters: NO_OBJECT_PARAMS,
    run: async () => {
      const snap = ctx.getPredictions?.()
      if (!snap) {
        return { available: false, summary: 'no predictions available' }
      }
      const parts: string[] = []
      if (snap.catchAhead) {
        parts.push(`catch ahead in ${snap.catchAhead.etaSec.toFixed(0)}s (~${snap.catchAhead.etaLaps.toFixed(1)} laps)`)
      }
      if (snap.caughtBehind) {
        parts.push(`caught in ${snap.caughtBehind.etaSec.toFixed(0)}s (~${snap.caughtBehind.etaLaps.toFixed(1)} laps)`)
      }
      const margin = snap.fuel.finishMarginLaps
      if (isFiniteNum(margin)) {
        parts.push(margin >= 0 ? `fuel +${margin.toFixed(1)} laps` : `fuel ${margin.toFixed(1)} laps short`)
      } else if (isFiniteNum(snap.fuel.lapsLeftAtPace)) {
        parts.push(`fuel ${snap.fuel.lapsLeftAtPace.toFixed(1)} laps in tank (race distance unknown)`)
      }
      if (isFiniteNum(snap.tire.lapsToCliff)) {
        parts.push(`cliff in ~${(snap.tire.lapsToCliff as number).toFixed(0)} laps`)
      }
      parts.push(`pace ${formatLapTime(snap.pace.projectedLapSec)} (${Math.round(snap.pace.confidence * 100)}%)`)
      return {
        available: true,
        catchAheadSec: snap.catchAhead?.etaSec,
        catchAheadLaps: snap.catchAhead?.etaLaps,
        catchAheadCarIdx: snap.catchAhead?.carIdx,
        caughtBehindSec: snap.caughtBehind?.etaSec,
        caughtBehindLaps: snap.caughtBehind?.etaLaps,
        caughtBehindCarIdx: snap.caughtBehind?.carIdx,
        fuelMarginLaps: snap.fuel.finishMarginLaps,
        fuelMarginL: snap.fuel.finishMarginL,
        tireDegSecPerLap: snap.tire.degSecPerLap,
        lapsToCliff: snap.tire.lapsToCliff,
        pressureState: snap.tire.pressureState,
        tempState: snap.tire.tempState,
        projectedLapSec: snap.pace.projectedLapSec,
        paceConfidence: snap.pace.confidence,
        summary: parts.join(' | ')
      }
    }
  }
}

export function buildEngineerTools(ctx: EngineerContext): EngineerToolset {
  const tools: EngineerTool[] = [
    fuelTool(ctx),
    deltaTool(ctx),
    strategyTool(ctx),
    positionTool(ctx),
    gapsTool(ctx),
    tyresTool(ctx),
    weatherTool(ctx),
    carTrackTool(ctx),
    recentEventsTool(ctx),
    coachTipsTool(ctx),
    coachFindingsTool(ctx),
    predictionsTool(ctx)
  ]
  const record: EngineerToolset = {}
  for (const tool of tools) record[tool.name] = tool
  return record
}
