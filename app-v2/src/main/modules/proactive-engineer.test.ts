import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'
import type { CoachFinding, CoachFindingKind, CoachSeverity } from '../../shared/coach'
import type {
  CoachAdviceLanguage,
  CoachComparableIdentity,
  CoachLapHistoryEntry,
  RacecraftAdviceContext
} from '../../shared/coach-racecraft'
import { DEFAULT_ENGINEER_CONFIG, mergeEngineerConfig, type EngineerProactiveEvent } from '../../shared/engineer-ipc'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import {
  advanceCornerTracker,
  advanceSectorTracker,
  cadenceForSession,
  composeBrutalCornerComposite,
  composeBrutalCornerLine,
  composeBrutalSectorLine,
  composeCatchLine,
  CoachRacecraftHistoryStore,
  createCornerTracker,
  createProactiveEngine,
  createSectorTracker,
  findingsByDimensionForCorner,
  lapsToCatch,
  equalSectorStarts,
  getLatestCoachFindings,
  getLatestCoachRacecraftContext,
  isRealLapCount,
  type ProactiveConfigView,
  sectorIndexForPct,
  worstFindingForCorner,
  worstFindingForSector
} from './proactive-engineer'
import type { CornerMapData, CornerSample } from '../track-map/corner-map'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeFinding(partial: Partial<CoachFinding> & { sector: number; kind: CoachFindingKind }): CoachFinding {
  const severity: CoachSeverity = partial.severity ?? 'med'
  return {
    id: partial.id ?? `${partial.kind}-s${partial.sector}`,
    kind: partial.kind,
    phase: partial.phase,
    sector: partial.sector,
    corner: partial.corner,
    sign: partial.sign,
    zonePctStart: partial.zonePctStart ?? 0,
    zonePctEnd: partial.zonePctEnd ?? 0.1,
    severity,
    estTimeLossSec: partial.estTimeLossSec ?? 0.2,
    title: partial.title ?? 'Freada tarde',
    detail: partial.detail ?? 'detalhe',
    evidence: partial.evidence ?? 'evidence',
    confidence: partial.confidence ?? 0.9,
    metrics: partial.metrics ?? {}
  }
}

function makeSnapshot(lapDistPct: number, overrides: Partial<TelemetrySnapshot> = {}): TelemetrySnapshot {
  return {
    connected: true,
    speedKmh: 120,
    throttle: 0.5,
    brake: 0,
    clutch: 0,
    lapDistPct,
    sessionType: 'Race',
    timestamp: 1000,
    ...overrides
  } as unknown as TelemetrySnapshot
}

const DRY_IDENTITY: CoachComparableIdentity = {
  trackName: 'Interlagos',
  trackConfigName: 'Grand Prix',
  carName: 'GT3 R',
  carPath: 'gt3r',
  carClassId: 7,
  carClassName: 'GT3',
  condition: 'dry',
  airTempC: 24,
  trackTempC: 35
}

function historyLap(id: string, finding: CoachFinding, sessionId = Number(id)): CoachLapHistoryEntry {
  return {
    id,
    at: sessionId,
    sessionId,
    valid: true,
    identity: DRY_IDENTITY,
    findings: [finding],
    cornerMetrics: []
  }
}

describe('CoachRacecraftHistoryStore', () => {
  it('persists valid-lap evidence locally across engine restarts', () => {
    const folder = join(process.cwd(), `.coach-racecraft-history-test-${process.pid}-${Date.now()}`)
    mkdirSync(folder, { recursive: true })
    try {
      const lap = historyLap(
        '1',
        makeFinding({ kind: 'throttle-late', sector: 2, corner: 7, phase: 'exit' })
      )
      new CoachRacecraftHistoryStore(folder).replace([lap])

      expect(new CoachRacecraftHistoryStore(folder).all()).toEqual([lap])
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })
})

const BRUTAL_PT: ProactiveConfigView = {
  enabled: true,
  proactiveCoaching: true,
  language: 'pt-BR',
  assertiveness: 'brutal',
  intentSensitivity: 0.6
}

// ─── Sector geometry ──────────────────────────────────────────────────────────

describe('sectorIndexForPct', () => {
  const starts = equalSectorStarts(3) // [0, 1/3, 2/3]

  it('maps lap-distance to a 1-based sector with equal-width starts', () => {
    expect(sectorIndexForPct(0.0, starts)).toBe(1)
    expect(sectorIndexForPct(0.32, starts)).toBe(1)
    expect(sectorIndexForPct(0.34, starts)).toBe(2)
    expect(sectorIndexForPct(0.67, starts)).toBe(3)
    expect(sectorIndexForPct(0.999, starts)).toBe(3)
  })

  it('honours custom (uneven) sector start fractions from SplitTimeInfo', () => {
    const custom = [0, 0.45, 0.8]
    expect(sectorIndexForPct(0.1, custom)).toBe(1)
    expect(sectorIndexForPct(0.5, custom)).toBe(2)
    expect(sectorIndexForPct(0.85, custom)).toBe(3)
  })

  it('guards against non-finite / out-of-range input', () => {
    expect(sectorIndexForPct(Number.NaN, starts)).toBe(1)
    expect(sectorIndexForPct(-1, starts)).toBe(1)
    expect(sectorIndexForPct(5, starts)).toBe(3)
  })
})

describe('isRealLapCount (iRacing 32767 / >= 9999 sentinel guard)', () => {
  it('accepts genuine lap counters', () => {
    expect(isRealLapCount(0)).toBe(true)
    expect(isRealLapCount(42)).toBe(true)
  })

  it('rejects the timed-session sentinels', () => {
    expect(isRealLapCount(32767)).toBe(false)
    expect(isRealLapCount(9999)).toBe(false)
    expect(isRealLapCount(Number.NaN)).toBe(false)
    expect(isRealLapCount(-1)).toBe(false)
    expect(isRealLapCount(undefined)).toBe(false)
  })
})

// ─── Sector-boundary crossing ───────────────────────────────────────────────────

describe('advanceSectorTracker', () => {
  const starts = equalSectorStarts(3)

  it('fires when a forward sector boundary is crossed (reports the sector just left)', () => {
    const t = createSectorTracker()
    expect(advanceSectorTracker(t, 0.1, starts).completedSector).toBeNull() // first sample, sector 1
    expect(advanceSectorTracker(t, 0.2, starts).completedSector).toBeNull() // still sector 1
    const r = advanceSectorTracker(t, 0.4, starts) // into sector 2
    expect(r.sector).toBe(2)
    expect(r.completedSector).toBe(1)
  })

  it('de-dupes jitter at a boundary (does not re-fire the same sector)', () => {
    const t = createSectorTracker()
    advanceSectorTracker(t, 0.3, starts) // sector 1
    expect(advanceSectorTracker(t, 0.34, starts).completedSector).toBe(1) // crossed into 2
    expect(advanceSectorTracker(t, 0.32, starts).completedSector).toBeNull() // jitter back to 1
    expect(advanceSectorTracker(t, 0.35, starts).completedSector).toBeNull() // re-cross, already announced
  })

  it('detects the start/finish wrap-around and completes the LAST sector', () => {
    const t = createSectorTracker()
    advanceSectorTracker(t, 0.7, starts) // sector 3
    advanceSectorTracker(t, 0.96, starts) // still sector 3
    const r = advanceSectorTracker(t, 0.02, starts) // crossed S/F
    expect(r.wrapped).toBe(true)
    expect(r.completedSector).toBe(3)
    expect(r.sector).toBe(1)
  })

  it('falls back to a per-LAP call when sectors are unavailable (single sector)', () => {
    const t = createSectorTracker()
    const one = equalSectorStarts(1) // [0]
    advanceSectorTracker(t, 0.4, one)
    advanceSectorTracker(t, 0.9, one)
    const r = advanceSectorTracker(t, 0.05, one) // wrap
    expect(r.wrapped).toBe(true)
    expect(r.completedSector).toBe(1)
  })
})

// ─── Worst-finding selection ────────────────────────────────────────────────────

describe('worstFindingForSector', () => {
  it('picks the highest estimated time loss within the sector', () => {
    const findings = [
      makeFinding({ sector: 2, kind: 'coast', estTimeLossSec: 0.1, id: 'a' }),
      makeFinding({ sector: 2, kind: 'brake-late', estTimeLossSec: 0.45, id: 'b' }),
      makeFinding({ sector: 1, kind: 'brake-early', estTimeLossSec: 0.9, id: 'c' })
    ]
    expect(worstFindingForSector(findings, 2)?.id).toBe('b')
  })

  it('breaks ties on severity', () => {
    const findings = [
      makeFinding({ sector: 1, kind: 'coast', estTimeLossSec: 0.2, severity: 'low', id: 'lo' }),
      makeFinding({ sector: 1, kind: 'brake-late', estTimeLossSec: 0.2, severity: 'high', id: 'hi' })
    ]
    expect(worstFindingForSector(findings, 1)?.id).toBe('hi')
  })

  it('ignores `good` findings and returns null when there is nothing to call out', () => {
    const findings = [makeFinding({ sector: 3, kind: 'good', estTimeLossSec: 0, severity: 'good', id: 'g' })]
    expect(worstFindingForSector(findings, 3)).toBeNull()
    expect(worstFindingForSector([], 1)).toBeNull()
  })
})

// ─── Brutal templates ───────────────────────────────────────────────────────────

describe('composeBrutalSectorLine', () => {
  const finding = makeFinding({ sector: 2, kind: 'brake-late', estTimeLossSec: 0.4 })

  it('brutal PT is blunt, names the sector, the loss and demands a fix', () => {
    const line = composeBrutalSectorLine(finding, { language: 'pt-BR', assertiveness: 'brutal' })
    expect(line).toBe('Setor 2: você perdeu 0.4s freando tarde demais. Corrija.')
  })

  it('assertive and balanced PT are progressively softer', () => {
    expect(composeBrutalSectorLine(finding, { language: 'pt-BR', assertiveness: 'assertive' })).toContain('Setor 2')
    expect(composeBrutalSectorLine(finding, { language: 'pt-BR', assertiveness: 'assertive' })).toContain('foco')
    const balanced = composeBrutalSectorLine(finding, { language: 'pt-BR', assertiveness: 'balanced' })
    expect(balanced).toContain('há cerca de 0.4s para ganhar porque você está freando tarde demais')
    expect(balanced).toContain('Ajuste na próxima volta')
    expect(balanced).not.toContain('para ganhar freando tarde demais')
  })

  it('brutal EN mirrors the blunt cadence', () => {
    const line = composeBrutalSectorLine(finding, { language: 'en-US', assertiveness: 'brutal' })
    expect(line).toBe('Sector 2: you threw away 0.4s braking too late. Fix it.')
  })

  it('omits the number when the finding has no measured loss', () => {
    const noLoss = makeFinding({ sector: 1, kind: 'steering-busy', estTimeLossSec: 0 })
    expect(composeBrutalSectorLine(noLoss, { language: 'pt-BR', assertiveness: 'brutal' })).toBe(
      'Setor 1: corrigindo demais o volante. Corrija.'
    )
  })
})

// ─── Config merge (new fields, backward compatible) ─────────────────────────────

describe('mergeEngineerConfig — assertiveness + proactiveCoaching', () => {
  it('defaults to brutal + proactive ON (corner+directional call-outs; Live Coach yields in races)', () => {
    expect(DEFAULT_ENGINEER_CONFIG.assertiveness).toBe('brutal')
    expect(DEFAULT_ENGINEER_CONFIG.proactiveCoaching).toBe(true)
  })

  it('an OLD config (missing the new fields) merges to the defaults', () => {
    const legacy = { enabled: true, language: 'pt-BR', modelId: 'x', threads: 0, idleUnloadMs: 60_000, speakAnswers: true, maxTokens: 150 }
    const merged = mergeEngineerConfig(DEFAULT_ENGINEER_CONFIG, legacy as never)
    expect(merged.assertiveness).toBe('brutal')
    expect(merged.proactiveCoaching).toBe(true)
  })

  it('validates + applies patches, rejecting bad values', () => {
    expect(mergeEngineerConfig(DEFAULT_ENGINEER_CONFIG, { assertiveness: 'assertive' }).assertiveness).toBe('assertive')
    expect(mergeEngineerConfig(DEFAULT_ENGINEER_CONFIG, { proactiveCoaching: false }).proactiveCoaching).toBe(false)
    expect(mergeEngineerConfig(DEFAULT_ENGINEER_CONFIG, { assertiveness: 'nope' as never }).assertiveness).toBe('brutal')
  })
})

// ─── Engine integration ─────────────────────────────────────────────────────────

interface Harness {
  events: EngineerProactiveEvent[]
  config: ProactiveConfigView
  time: { value: number }
}

function makeEngine(
  configOverrides: Partial<ProactiveConfigView> = {},
  opts: {
    minEmitIntervalMs?: number
    cadence?: 'sector' | 'corner' | 'auto'
    buildCornerMap?: (trackName: string, samples: CornerSample[]) => CornerMapData
    history?: CoachLapHistoryEntry[]
    persistHistory?: (history: readonly CoachLapHistoryEntry[]) => void
    publishRacecraftContext?: (context: RacecraftAdviceContext | null) => void
    adviceLanguage?: CoachAdviceLanguage
  } = {}
) {
  const harness: Harness = {
    events: [],
    config: { ...BRUTAL_PT, ...configOverrides },
    time: { value: 100_000 }
  }
  const engine = createProactiveEngine({
    emit: (e) => harness.events.push(e),
    getConfig: () => harness.config,
    publishFindings: () => undefined,
    publishRacecraftContext: opts.publishRacecraftContext ?? (() => undefined),
    now: () => harness.time.value,
    minEmitIntervalMs: opts.minEmitIntervalMs ?? 1000,
    sectorCount: 3,
    cadence: opts.cadence,
    buildCornerMap: opts.buildCornerMap,
    history: opts.history,
    persistHistory: opts.persistHistory,
    getAdviceLanguage: opts.adviceLanguage ? () => opts.adviceLanguage as CoachAdviceLanguage : undefined
  })
  return { harness, engine }
}

describe('createProactiveEngine', () => {
  it('emits a brutal call-out when a sector with a finding completes', () => {
    const { harness, engine } = makeEngine()
    engine.setFindings([makeFinding({ sector: 1, kind: 'brake-late', estTimeLossSec: 0.4 })])
    engine.onSnapshot(makeSnapshot(0.1)) // sector 1
    engine.onSnapshot(makeSnapshot(0.4)) // completes sector 1
    expect(harness.events).toHaveLength(1)
    expect(harness.events[0].sector).toBe(1)
    expect(harness.events[0].text).toContain('Setor 1')
    expect(harness.events[0].speak).toBe(true)
  })

  it('stays SILENT when the completed sector has no finding (never invents)', () => {
    const { harness, engine } = makeEngine()
    engine.setFindings([makeFinding({ sector: 3, kind: 'coast', estTimeLossSec: 0.3 })])
    engine.onSnapshot(makeSnapshot(0.1))
    engine.onSnapshot(makeSnapshot(0.4)) // completes sector 1 — no sector-1 finding
    expect(harness.events).toHaveLength(0)
  })

  it('does not emit when proactiveCoaching is OFF', () => {
    const { harness, engine } = makeEngine({ proactiveCoaching: false })
    engine.setFindings([makeFinding({ sector: 1, kind: 'brake-late' })])
    engine.onSnapshot(makeSnapshot(0.1))
    engine.onSnapshot(makeSnapshot(0.4))
    expect(harness.events).toHaveLength(0)
  })

  it('does nothing at all when the engineer is disabled', () => {
    const { harness, engine } = makeEngine({ enabled: false })
    engine.setFindings([makeFinding({ sector: 1, kind: 'brake-late' })])
    engine.onSnapshot(makeSnapshot(0.1))
    engine.onSnapshot(makeSnapshot(0.4))
    expect(harness.events).toHaveLength(0)
  })

  it('anti-spam: respects the minimum interval between call-outs', () => {
    const { harness, engine } = makeEngine({}, { minEmitIntervalMs: 5000 })
    engine.setFindings([
      makeFinding({ sector: 1, kind: 'brake-late', estTimeLossSec: 0.4, id: 's1' }),
      makeFinding({ sector: 2, kind: 'coast', estTimeLossSec: 0.3, id: 's2' })
    ])
    engine.onSnapshot(makeSnapshot(0.1)) // sector 1
    engine.onSnapshot(makeSnapshot(0.4)) // completes 1 → emit (s1)
    engine.onSnapshot(makeSnapshot(0.7)) // completes 2 → within interval, blocked
    expect(harness.events).toHaveLength(1)
    expect(harness.events[0].sector).toBe(1)

    harness.time.value += 6000 // interval elapsed
    engine.onSnapshot(makeSnapshot(0.96)) // still sector 3
    engine.onSnapshot(makeSnapshot(0.02)) // wrap completes sector 3 (no finding) → silent
    engine.onSnapshot(makeSnapshot(0.4)) // completes sector 1 again → same finding id, deduped
    engine.onSnapshot(makeSnapshot(0.7)) // completes sector 2 → different finding, interval ok → emit
    expect(harness.events).toHaveLength(2)
    expect(harness.events[1].sector).toBe(2)
  })

  it('emits on the start/finish wrap for the last sector', () => {
    const { harness, engine } = makeEngine()
    engine.setFindings([makeFinding({ sector: 3, kind: 'throttle-hesitation', estTimeLossSec: 0.25 })])
    engine.onSnapshot(makeSnapshot(0.7)) // sector 3
    engine.onSnapshot(makeSnapshot(0.96))
    engine.onSnapshot(makeSnapshot(0.02)) // wrap → completes sector 3
    expect(harness.events).toHaveLength(1)
    expect(harness.events[0].sector).toBe(3)
  })

  it('keeps findings across a pit stop (last green lap advice stays valid) but stays silent', () => {
    const { harness, engine } = makeEngine()
    engine.setFindings([makeFinding({ sector: 1, kind: 'brake-late' })])
    engine.onSnapshot(makeSnapshot(0.1))
    engine.onSnapshot(makeSnapshot(0.4, { onPitRoad: true })) // boundary but in pits
    expect(harness.events).toHaveLength(0)
    expect(engine.getFindings()).toHaveLength(1) // pit does NOT clear coaching
  })

  it('clears findings on disconnect (next session may be a different car/track)', () => {
    const { engine } = makeEngine()
    engine.setFindings([makeFinding({ sector: 1, kind: 'brake-late' })])
    engine.onSnapshot(makeSnapshot(0.1))
    engine.onSnapshot(null) // disconnected
    expect(engine.getFindings()).toHaveLength(0)
  })

  it('does NOT coach the out-lap after a pit stop, and the sim lap counter still completes the lap', () => {
    const { harness, engine } = makeEngine()
    engine.setFindings([
      makeFinding({ sector: 1, kind: 'brake-late', estTimeLossSec: 0.4, id: 's1' }),
      makeFinding({ sector: 2, kind: 'coast', estTimeLossSec: 0.3, id: 's2' })
    ])
    // Enter the pits → the next flying lap is an out-lap.
    engine.onSnapshot(makeSnapshot(0.5, { onPitRoad: true }))
    // Out-lap (lap 5): warm-up. Sector boundaries cross but NOTHING is coached.
    engine.onSnapshot(makeSnapshot(0.1, { currentLap: 5 }))
    engine.onSnapshot(makeSnapshot(0.4, { currentLap: 5 })) // completes S1 — suppressed
    engine.onSnapshot(makeSnapshot(0.7, { currentLap: 5 })) // completes S2 — suppressed
    expect(harness.events).toHaveLength(0)
    // Lap completes via the SIM LAP COUNTER without a lap-distance wrap (choppy
    // telemetry: 0.7 → 0.2 is not a >0.5 backward jump). This ends the out-lap.
    engine.onSnapshot(makeSnapshot(0.2, { currentLap: 6 }))
    // Next green lap (lap 6): coaching resumes.
    engine.onSnapshot(makeSnapshot(0.4, { currentLap: 6 })) // completes S1 → emit
    expect(harness.events).toHaveLength(1)
    expect(harness.events[0].sector).toBe(1)
  })

  it('does NOT coach the out-lap on a clean geometric start/finish wrap (regression: was only suppressed on the counter-only path)', () => {
    const { harness, engine } = makeEngine()
    engine.setFindings([
      makeFinding({ sector: 3, kind: 'throttle-hesitation', estTimeLossSec: 0.5, id: 's3' }),
      makeFinding({ sector: 1, kind: 'brake-late', estTimeLossSec: 0.4, id: 's1' })
    ])
    // Enter the pits → the next flying lap is an out-lap.
    engine.onSnapshot(makeSnapshot(0.5, { onPitRoad: true }))
    // Out-lap (lap 5): warm-up through sector 3, which HAS a retained pre-pit finding.
    engine.onSnapshot(makeSnapshot(0.7, { currentLap: 5 }))
    engine.onSnapshot(makeSnapshot(0.96, { currentLap: 5 }))
    // The out-lap completes via a CLEAN geometric wrap (0.96 → 0.02): the trailing
    // sector 3 must stay SILENT even though it has a finding (onLapComplete clears the
    // out-lap flag, so the emit guard must use the pre-completion state).
    engine.onSnapshot(makeSnapshot(0.02, { currentLap: 6 }))
    expect(harness.events).toHaveLength(0)
    // Next green lap (lap 6): coaching resumes — sector 1 emits.
    engine.onSnapshot(makeSnapshot(0.4, { currentLap: 6 }))
    expect(harness.events).toHaveLength(1)
    expect(harness.events[0].sector).toBe(1)
  })

  it('resets and stays silent in the pits / when disconnected', () => {
    const { harness, engine } = makeEngine()
    engine.setFindings([makeFinding({ sector: 1, kind: 'brake-late' })])
    engine.onSnapshot(makeSnapshot(0.1))
    engine.onSnapshot(makeSnapshot(0.4, { onPitRoad: true })) // boundary but in pits
    expect(harness.events).toHaveLength(0)
  })

  it('does not emit when the car is not moving', () => {
    const { harness, engine } = makeEngine()
    engine.setFindings([makeFinding({ sector: 1, kind: 'brake-late' })])
    engine.onSnapshot(makeSnapshot(0.1, { speedKmh: 0 }))
    engine.onSnapshot(makeSnapshot(0.4, { speedKmh: 0 }))
    expect(harness.events).toHaveLength(0)
  })

  it.each([
    { flags: { yellow: true } as TelemetrySnapshot['flags'] },
    { flags: { blue: true } as TelemetrySnapshot['flags'] },
    { paceMode: 'doubleFileRestart' as const },
    { sessionState: 'paradeLaps' as const }
  ])('stays silent under race-control state %#', (unsafe) => {
    const { harness, engine } = makeEngine()
    engine.setFindings([makeFinding({ sector: 1, kind: 'brake-late' })])
    engine.onSnapshot(makeSnapshot(0.1, { sessionType: 'Race', ...unsafe }))
    engine.onSnapshot(makeSnapshot(0.4, { sessionType: 'Race', ...unsafe }))
    expect(harness.events).toHaveLength(0)
  })

  it('emits one honest qualifying-start summary but no per-sector qualifying coaching', () => {
    const { harness, engine } = makeEngine({ language: 'en-US' })
    engine.setFindings([makeFinding({ sector: 1, kind: 'brake-late' })])
    engine.onSnapshot(makeSnapshot(0.1, { sessionType: 'Qualify' }))
    engine.onSnapshot(makeSnapshot(0.4, { sessionType: 'Qualify' }))
    expect(harness.events).toHaveLength(1)
    expect(harness.events[0].text).toContain('QUALIFY')
    expect(harness.events[0].eventType).toBe('insufficient-history')
    expect(harness.events[0].sector).toBeUndefined()
    expect(harness.events[0].kind).toBeUndefined()
    expect(harness.events[0].estTimeLossSec).toBeUndefined()
    expect(harness.events[0].text).toContain('insufficient evidence')
  })

  it('emits the qualifying briefing on the first qualifying frame only', () => {
    const { harness, engine } = makeEngine({ language: 'en-US' })
    const identity = {
      sessionUniqueId: 77,
      trackName: 'Interlagos',
      trackConfigName: 'Grand Prix',
      carName: 'GT3 R',
      carPath: 'gt3r',
      trackWetnessPct: 0,
      isRaining: false
    }

    engine.onSnapshot(makeSnapshot(0.1, { ...identity, sessionType: 'Race', timestamp: 1000 }))
    expect(harness.events).toHaveLength(0)
    engine.onSnapshot(
      makeSnapshot(0.2, {
        ...identity,
        sessionType: 'Qualify',
        timestamp: 2000,
        trackConfigName: undefined
      })
    )
    expect(harness.events).toHaveLength(1)
    expect(harness.events[0].id).toContain('eng-quali')
    expect(harness.events[0].text).toContain('insufficient dry history')
    engine.onSnapshot(
      makeSnapshot(0.3, {
        ...identity,
        sessionType: 'Qualify',
        timestamp: 3000,
        trackConfigName: 'Grand Prix'
      })
    )
    expect(harness.events).toHaveLength(1)
  })

  it('deduplicates qualifying announcements across replay/disconnect/reconnect in the same session', () => {
    const { harness, engine } = makeEngine({ language: 'en-US' })
    const snapshot = (
      state: 'live' | 'replay',
      sessionIdentity: string,
      connectionEpoch: number,
      revision: number
    ) =>
      makeSnapshot(0.1, {
        sessionType: 'Qualify',
        sessionUniqueId: 99,
        trackName: 'Interlagos',
        trackConfigName: 'Grand Prix',
        carName: 'GT3 R',
        carPath: 'gt3r',
        trackWetnessPct: 0,
        isRaining: false,
        replayContext: {
          state,
          reason: state === 'live' ? 'confirmed-live' : 'replay-playing',
          inputs: {},
          active: state !== 'live',
          revision,
          token: `${connectionEpoch}:${revision}`,
          sessionIdentity,
          connectionEpoch
        }
      })

    engine.onSnapshot(snapshot('live', 'session-a', 1, 0))
    expect(harness.events).toHaveLength(1)
    engine.onSnapshot(snapshot('replay', 'session-a', 1, 1))
    engine.onSnapshot(null)
    engine.onSnapshot(snapshot('live', 'session-a', 2, 2))
    expect(harness.events).toHaveLength(1)
    engine.onSnapshot(snapshot('live', 'session-b', 2, 3))
    expect(harness.events).toHaveLength(2)
  })

  it('uses sufficient comparable valid-lap history in the qualifying-start summary', () => {
    const recurring = makeFinding({
      sector: 2,
      corner: 7,
      kind: 'throttle-late',
      phase: 'exit',
      estTimeLossSec: 0.24
    })
    const { harness, engine } = makeEngine(
      { language: 'en-US' },
      {
        history: [
          historyLap('1', recurring, 1),
          historyLap('2', recurring, 2),
          historyLap('3', recurring, 3)
        ]
      }
    )
    engine.onSnapshot(
      makeSnapshot(0.01, {
        sessionType: 'Qualify',
        sessionUniqueId: 99,
        trackName: 'Interlagos',
        trackConfigName: 'Grand Prix',
        carName: 'GT3 R',
        carPath: 'gt3r',
        airTempC: 24,
        trackTempC: 35,
        trackWetnessPct: 0,
        isRaining: false,
        drivers: [
          {
            carIdx: 0,
            name: 'Player',
            carNumber: '7',
            position: 1,
            classPosition: 1,
            classId: 7,
            className: 'GT3',
            isPlayer: true
          }
        ]
      })
    )

    expect(harness.events).toHaveLength(1)
    expect(harness.events[0].eventType).toBe('quali-briefing')
    expect(harness.events[0].text).toContain('player dry history, 3 comparable completed laps')
    expect(harness.events[0].text).toContain('Turn 7')
    expect(harness.events[0].text).toContain('3/3 laps')
  })

  it('publishes compact comparable history for on-demand ahead/behind answers', () => {
    const recurring = makeFinding({
      sector: 2,
      corner: 7,
      kind: 'throttle-late',
      phase: 'exit',
      estTimeLossSec: 0.24
    })
    const published: Array<RacecraftAdviceContext | null> = []
    const { engine } = makeEngine(
      { language: 'en-US' },
      {
        history: [
          historyLap('1', recurring, 1),
          historyLap('2', recurring, 2),
          historyLap('3', recurring, 3)
        ],
        publishRacecraftContext: (context) => published.push(context)
      }
    )
    engine.onSnapshot(
      makeSnapshot(0.01, {
        sessionType: 'Race',
        sessionUniqueId: 99,
        trackName: 'Interlagos',
        trackConfigName: 'Grand Prix',
        carName: 'GT3 R',
        carPath: 'gt3r',
        airTempC: 24,
        trackTempC: 35,
        trackWetnessPct: 0,
        isRaining: false,
        relatives: {
          ahead: { carIdx: 10, name: 'Ahead', carNumber: '10', gapSec: 0.8 },
          behind: { carIdx: 20, name: 'Behind', carNumber: '20', gapSec: -0.7 }
        }
      })
    )

    const context = published.filter((entry): entry is RacecraftAdviceContext => entry !== null).at(-1)
    expect(context?.historyEvidence).toMatchObject({
      condition: 'dry',
      comparableLapCount: 3,
      sufficientHistory: true
    })
    expect(context?.historyEvidence?.patterns[0]).toMatchObject({
      finding: { corner: 7, kind: 'throttle-late' },
      lapsSeen: 3,
      lapsCompared: 3
    })
    expect(context?.currentGapAheadSec).toBe(0.8)
    expect(context?.currentGapBehindSec).toBe(0.7)
  })

  it('does not use dry history for a wet qualifying start', () => {
    const recurring = makeFinding({
      sector: 2,
      corner: 7,
      kind: 'throttle-late',
      phase: 'exit',
      estTimeLossSec: 0.24
    })
    const { harness, engine } = makeEngine(
      { language: 'en-US' },
      {
        history: [
          historyLap('1', recurring, 1),
          historyLap('2', recurring, 2),
          historyLap('3', recurring, 3)
        ]
      }
    )
    engine.onSnapshot(
      makeSnapshot(0.01, {
        sessionType: 'Qualify',
        sessionUniqueId: 99,
        trackName: 'Interlagos',
        trackConfigName: 'Grand Prix',
        carName: 'GT3 R',
        carPath: 'gt3r',
        airTempC: 24,
        trackTempC: 35,
        trackWetnessPct: 0.75,
        isRaining: true,
        drivers: [
          {
            carIdx: 0,
            name: 'Player',
            carNumber: '7',
            position: 1,
            classPosition: 1,
            classId: 7,
            className: 'GT3',
            isPlayer: true
          }
        ]
      })
    )

    expect(harness.events).toHaveLength(1)
    expect(harness.events[0].eventType).toBe('insufficient-history')
    expect(harness.events[0].text).toContain('insufficient wet history (0/3 completed laps)')
    expect(harness.events[0].text).not.toContain('Turn 7')
  })

  it('uses the full app language for deterministic qualifying briefings', () => {
    const { harness, engine } = makeEngine(
      { language: 'en-US' },
      { adviceLanguage: 'es' }
    )
    engine.onSnapshot(
      makeSnapshot(0.01, {
        sessionType: 'Qualify',
        sessionUniqueId: 199,
        trackName: 'Monza',
        carName: 'GT3 R',
        carPath: 'gt3r',
        trackWetnessPct: 0,
        isRaining: false
      })
    )

    expect(harness.events).toHaveLength(1)
    expect(harness.events[0].lang).toBe('es')
    expect(harness.events[0].text).toContain('CLASIFICACIÓN')
    expect(harness.events[0].text).toContain('historial seco insuficiente')
  })

  it('does not persist an iRacing lap whose incident count increased', () => {
    const persisted = vi.fn()
    const { engine } = makeEngine({}, { persistHistory: persisted })
    const base = {
      currentLap: 1,
      sim: 'iracing' as const,
      incidentCountMy: 0,
      trackName: 'Interlagos',
      trackConfigName: 'Grand Prix',
      carName: 'GT3 R',
      carPath: 'gt3r',
      airTempC: 24,
      trackTempC: 35,
      trackWetnessPct: 0
    }
    for (let i = 0; i < 34; i += 1) {
      engine.onSnapshot(makeSnapshot((i / 34) * 0.99, { ...base, timestamp: 1000 + i }))
    }
    engine.onSnapshot(
      makeSnapshot(0.02, {
        ...base,
        currentLap: 2,
        incidentCountMy: 1,
        lastLapTimeSec: 90,
        timestamp: 2000
      })
    )

    expect(engine.getHistory()).toHaveLength(0)
    expect(persisted).not.toHaveBeenCalled()
  })
})

// ─── Shared findings singleton (stamped with car/track) ─────────────────────────

describe('getLatestCoachFindings — car/track scoping', () => {
  // This engine writes to the MODULE singleton (no publishFindings override).
  function singletonEngine() {
    return createProactiveEngine({
      emit: () => undefined,
      getConfig: () => ({ ...BRUTAL_PT }),
      now: () => 0,
      sectorCount: 3
    })
  }

  it('returns the findings unfiltered when no live snapshot is supplied', () => {
    const engine = singletonEngine()
    engine.setFindings([makeFinding({ sector: 1, kind: 'brake-late' })], { carName: 'A', trackName: 'X' })
    expect(getLatestCoachFindings()).toHaveLength(1)
  })

  it('returns the findings when the live car + track match the stamp', () => {
    const engine = singletonEngine()
    engine.setFindings([makeFinding({ sector: 1, kind: 'brake-late' })], { carName: 'A', trackName: 'X' })
    expect(getLatestCoachFindings(makeSnapshot(0.1, { carName: 'A', trackName: 'X' }))).toHaveLength(1)
  })

  it('DROPS the findings after a car change (never cites a previous session)', () => {
    const engine = singletonEngine()
    engine.setFindings([makeFinding({ sector: 1, kind: 'brake-late' })], { carName: 'A', trackName: 'X' })
    expect(getLatestCoachFindings(makeSnapshot(0.1, { carName: 'B', trackName: 'X' }))).toHaveLength(0)
  })

  it('DROPS the findings after a track change', () => {
    const engine = singletonEngine()
    engine.setFindings([makeFinding({ sector: 1, kind: 'brake-late' })], { carName: 'A', trackName: 'X' })
    expect(getLatestCoachFindings(makeSnapshot(0.1, { carName: 'A', trackName: 'Y' }))).toHaveLength(0)
  })

  it('DROPS findings and racecraft evidence after a track-config change', () => {
    const engine = singletonEngine()
    engine.setFindings(
      [makeFinding({ sector: 1, kind: 'brake-late' })],
      {
        carName: 'A',
        carPath: 'a',
        trackName: 'X',
        trackConfigName: 'Grand Prix',
        condition: 'dry'
      }
    )
    const changed = makeSnapshot(0.1, {
      carName: 'A',
      carPath: 'a',
      trackName: 'X',
      trackConfigName: 'Moto',
      trackWetnessPct: 0
    })
    expect(getLatestCoachFindings(changed)).toHaveLength(0)
    expect(getLatestCoachRacecraftContext(changed)).toBeNull()
  })

  it('does not reuse config-scoped evidence when the live config is unknown', () => {
    const engine = singletonEngine()
    engine.setFindings(
      [makeFinding({ sector: 1, kind: 'brake-late' })],
      {
        carName: 'A',
        carPath: 'a',
        trackName: 'X',
        trackConfigName: 'Grand Prix',
        condition: 'dry'
      }
    )
    const missingConfig = makeSnapshot(0.1, {
      carName: 'A',
      carPath: 'a',
      trackName: 'X',
      trackWetnessPct: 0
    })

    expect(getLatestCoachFindings(missingConfig)).toHaveLength(0)
    expect(getLatestCoachRacecraftContext(missingConfig)).toBeNull()
  })

  it('keeps a drying condition stable while the damp track continues to improve', () => {
    const engine = singletonEngine()
    const identity = {
      carName: 'A',
      carPath: 'a',
      trackName: 'X',
      trackConfigName: 'Grand Prix',
      isRaining: false,
      weatherDeclaredWet: false
    }
    engine.onSnapshot(makeSnapshot(0.1, { ...identity, timestamp: 1000, trackWetnessPct: 0.35 }))
    engine.onSnapshot(makeSnapshot(0.2, { ...identity, timestamp: 2000, trackWetnessPct: 0.3 }))
    const drying = makeSnapshot(0.3, { ...identity, timestamp: 3000, trackWetnessPct: 0.29 })
    engine.onSnapshot(drying)

    expect(getLatestCoachRacecraftContext(drying)?.condition).toBe('drying')
  })

  it('is cleared on disconnect (publishes [])', () => {
    const engine = singletonEngine()
    engine.setFindings([makeFinding({ sector: 1, kind: 'brake-late' })], { carName: 'A', trackName: 'X' })
    engine.onSnapshot(makeSnapshot(0.1, { carName: 'A', trackName: 'X' }))
    engine.onSnapshot(null) // disconnect → setFindings([]) → singleton cleared
    expect(getLatestCoachFindings()).toHaveLength(0)
    expect(getLatestCoachFindings(makeSnapshot(0.1, { carName: 'A', trackName: 'X' }))).toHaveLength(0)
  })
})

// ─── Per-corner cadence (Turn N) ─────────────────────────────────────────────

const CORNERS = [
  { index: 1, startPct: 0.2, apexPct: 0.25, endPct: 0.3 },
  { index: 2, startPct: 0.5, apexPct: 0.55, endPct: 0.6 },
  { index: 3, startPct: 0.8, apexPct: 0.85, endPct: 0.9 }
]

describe('advanceCornerTracker', () => {
  it('reports a corner as completed when the car exits it', () => {
    const t = createCornerTracker()
    // Enter corner 1.
    expect(advanceCornerTracker(t, 0.25, CORNERS).completedCorner).toBeNull()
    expect(advanceCornerTracker(t, 0.28, CORNERS).corner).toBe(1)
    // Exit corner 1 onto the straight → corner 1 completed.
    const exit = advanceCornerTracker(t, 0.35, CORNERS)
    expect(exit.completedCorner).toBe(1)
    expect(exit.corner).toBeNull()
  })

  it('de-dupes so a corner only completes once per lap, and resets on wrap', () => {
    const t = createCornerTracker()
    advanceCornerTracker(t, 0.25, CORNERS) // in C1
    advanceCornerTracker(t, 0.35, CORNERS) // exit C1 (completed)
    // Jitter back into C1 then out again must NOT re-complete it.
    advanceCornerTracker(t, 0.28, CORNERS)
    expect(advanceCornerTracker(t, 0.34, CORNERS).completedCorner).toBeNull()
    // Drive to the end of the lap, then cross start/finish → wrap resets the de-dupe set.
    advanceCornerTracker(t, 0.95, CORNERS)
    const wrap = advanceCornerTracker(t, 0.02, CORNERS)
    expect(wrap.wrapped).toBe(true)
    advanceCornerTracker(t, 0.25, CORNERS)
    expect(advanceCornerTracker(t, 0.35, CORNERS).completedCorner).toBe(1)
  })

  it('returns null corner on a straight', () => {
    const t = createCornerTracker()
    expect(advanceCornerTracker(t, 0.05, CORNERS).corner).toBeNull()
    expect(advanceCornerTracker(t, 0.4, CORNERS).corner).toBeNull()
  })
})

describe('worstFindingForCorner', () => {
  it('returns the worst loss finding for a corner and ignores gains/good', () => {
    const findings: CoachFinding[] = [
      makeFinding({ sector: 1, kind: 'brake-late', corner: 1, estTimeLossSec: 0.1 }),
      makeFinding({ sector: 1, kind: 'steering-late', corner: 1, estTimeLossSec: 0.3 }),
      makeFinding({ sector: 1, kind: 'min-speed-gain', corner: 1, estTimeLossSec: 0, sign: 'gain' }),
      makeFinding({ sector: 2, kind: 'throttle-late', corner: 2, estTimeLossSec: 0.5 })
    ]
    const worst = worstFindingForCorner(findings, 1)
    expect(worst?.kind).toBe('steering-late')
    expect(worstFindingForCorner(findings, 9)).toBeNull()
  })
})

describe('composeBrutalCornerLine', () => {
  it('speaks "Curva N: <erro>" in PT-BR brutal mode', () => {
    const f = makeFinding({ sector: 2, kind: 'brake-late', corner: 2, estTimeLossSec: 0.4 })
    const line = composeBrutalCornerLine(f, { language: 'pt-BR', assertiveness: 'brutal' })
    expect(line).toContain('Curva 2')
    expect(line).toMatch(/0\.4s/)
  })

  it('uses "Turn N" in English', () => {
    const f = makeFinding({ sector: 2, kind: 'brake-late', corner: 3, estTimeLossSec: 0.2 })
    const line = composeBrutalCornerLine(f, { language: 'en-US', assertiveness: 'assertive' })
    expect(line).toContain('Turn 3')
  })

  it('falls back to the sector line when the finding has no corner', () => {
    const f = makeFinding({ sector: 1, kind: 'brake-late' })
    const cornerLine = composeBrutalCornerLine(f, { language: 'pt-BR', assertiveness: 'brutal' })
    const sectorLine = composeBrutalSectorLine(f, { language: 'pt-BR', assertiveness: 'brutal' })
    expect(cornerLine).toBe(sectorLine)
  })

  // Terse, improvement-only cues: each kind maps to a short "what to fix" fragment.
  const PT = { language: 'pt-BR', assertiveness: 'brutal' } as const
  const cueCases: Array<[CoachFindingKind, string]> = [
    ['steering-late', 'vire antes'],
    ['steering-early', 'vire mais tarde'],
    ['throttle-late', 'acelere antes'],
    ['throttle-early', 'acelere mais tarde'],
    ['steering-busy', 'faça menos correções no volante'],
    ['steering-insufficient', 'vire mais o volante'],
    ['brake-late', 'freie antes'],
    ['brake-early', 'freie mais tarde']
  ]
  it.each(cueCases)('Curva cue for %s says "%s"', (kind, cue) => {
    const f = makeFinding({ sector: 1, kind, corner: 3, estTimeLossSec: 0.2 })
    const line = composeBrutalCornerLine(f, PT)
    expect(line).toContain('Curva 3')
    expect(line).toContain(cue)
  })

  it('surfaces what to IMPROVE only — no praise verbs in a corner cue', () => {
    const line = composeBrutalCornerLine(
      makeFinding({ sector: 1, kind: 'min-speed-gain', corner: 2, sign: 'gain', estTimeLossSec: 0 }),
      PT
    )
    // Improvement-only phrasing: never the verbose "jogou/perdeu Xs" praise/scold form.
    expect(line).not.toMatch(/jogou|perdeu/i)
  })

  it('English corner cue maps under-rotation to "more steering"', () => {
    const f = makeFinding({ sector: 1, kind: 'steering-insufficient', corner: 5, estTimeLossSec: 0.3 })
    const line = composeBrutalCornerLine(f, { language: 'en-US', assertiveness: 'brutal' })
    expect(line).toContain('Turn 5')
    expect(line).toContain('more steering')
  })
})

describe('composeBrutalCornerComposite', () => {
  const PT = { language: 'pt-BR', assertiveness: 'brutal' } as const

  it('chains the worst mistake per dimension into ONE corner line', () => {
    const findings = [
      makeFinding({ id: 'b', sector: 2, kind: 'brake-late', corner: 3, estTimeLossSec: 0.3 }),
      makeFinding({ id: 's', sector: 2, kind: 'steering-late', corner: 3, estTimeLossSec: 0.25 }),
      makeFinding({ id: 't', sector: 2, kind: 'throttle-early', corner: 3, estTimeLossSec: 0.15 })
    ]
    const line = composeBrutalCornerComposite(findings, 3, PT)
    expect(line).toContain('Curva 3')
    expect(line).toContain('freie antes') // brake
    expect(line).toContain('vire antes') // turn-in timing
    expect(line).toContain('acelere mais tarde') // throttle
    // Ordered by time lost (brake worst first).
    expect(line.indexOf('freie antes')).toBeLessThan(line.indexOf('vire antes'))
  })

  it('collapses to the single-finding phrasing when only one dimension is off', () => {
    const f = makeFinding({ sector: 2, kind: 'steering-late', corner: 1, estTimeLossSec: 0.3 })
    const composite = composeBrutalCornerComposite([f], 1, PT)
    const single = composeBrutalCornerLine(f, PT)
    expect(composite).toBe(single)
  })

  it('keeps only the WORST finding per dimension (no duplicate brake cues)', () => {
    const findings = [
      makeFinding({ id: 'b1', sector: 2, kind: 'brake-late', corner: 2, estTimeLossSec: 0.1 }),
      makeFinding({ id: 'b2', sector: 2, kind: 'brake-late', corner: 2, estTimeLossSec: 0.4 })
    ]
    const ranked = findingsByDimensionForCorner(findings, 2)
    expect(ranked).toHaveLength(1)
    expect(ranked[0].id).toBe('b2')
  })

  it('ignores gains / clean findings and returns "" when nothing is actionable', () => {
    const findings = [
      makeFinding({ sector: 1, kind: 'min-speed-gain', corner: 4, sign: 'gain', estTimeLossSec: 0 }),
      makeFinding({ sector: 1, kind: 'good', corner: 4, estTimeLossSec: 0 })
    ]
    expect(composeBrutalCornerComposite(findings, 4, PT)).toBe('')
  })

  it('FALLS BACK to the generic time-loss cue when a corner has no specific dimension', () => {
    // Regression guard (v2.36.0): a race corner whose ONLY loss is dimension-less
    // `time-loss` must still speak (not be filtered out by the composite).
    const ranked = findingsByDimensionForCorner(
      [makeFinding({ sector: 2, kind: 'time-loss', corner: 3, estTimeLossSec: 0.3 })],
      3
    )
    expect(ranked).toHaveLength(1)
    expect(ranked[0].kind).toBe('time-loss')
    const line = composeBrutalCornerComposite(
      [makeFinding({ sector: 2, kind: 'time-loss', corner: 3, estTimeLossSec: 0.3 })],
      3,
      PT
    )
    expect(line).toContain('Curva 3')
    expect(line).toContain('ganhe mais tempo aqui')
  })

  it('does NOT let time-loss crowd out or duplicate a SPECIFIC cue when both exist', () => {
    const line = composeBrutalCornerComposite(
      [
        makeFinding({ id: 'b', sector: 2, kind: 'brake-late', corner: 3, estTimeLossSec: 0.2 }),
        makeFinding({ id: 'tl', sector: 2, kind: 'time-loss', corner: 3, estTimeLossSec: 0.9 })
      ],
      3,
      PT
    )
    expect(line).toContain('freie antes')
    expect(line).not.toContain('ganhe mais tempo aqui')
  })
})

describe('cadenceForSession', () => {
  it('auto → CORNER cadence in a race (Turn N)', () => {
    expect(cadenceForSession('auto', 'Race')).toBe('corner')
    expect(cadenceForSession('auto', 'Offline Race')).toBe('corner')
  })
  it('auto → SECTOR cadence in practice / qualify / warm-up / unknown', () => {
    expect(cadenceForSession('auto', 'Practice')).toBe('sector')
    expect(cadenceForSession('auto', 'Qualify')).toBe('sector')
    expect(cadenceForSession('auto', 'Warmup')).toBe('sector')
    expect(cadenceForSession('auto', undefined)).toBe('sector')
    expect(cadenceForSession('auto', 'Lobby')).toBe('sector')
  })
  it('forced sector/corner overrides the session kind', () => {
    expect(cadenceForSession('sector', 'Race')).toBe('sector')
    expect(cadenceForSession('corner', 'Practice')).toBe('corner')
  })
})

describe('createProactiveEngine — corner cadence in a race', () => {
  const FAKE_MAP = { corners: CORNERS } as unknown as CornerMapData

  it('calls out by CORNER ("Curva N") once a map is learned in a race', () => {
    const { harness, engine } = makeEngine({}, { buildCornerMap: () => FAKE_MAP })

    // Lap 1 (Race): fill the buffer past MIN_LAP_SAMPLES so the map can be learned.
    for (let i = 0; i < 34; i += 1) {
      const pct = (i / 34) * 0.99
      engine.onSnapshot(makeSnapshot(pct, { currentLap: 1, trackName: 'Interlagos' }))
    }
    // Cross start/finish into lap 2 → finalizeLap learns the (fake) corner map.
    engine.onSnapshot(makeSnapshot(0.05, { currentLap: 2, trackName: 'Interlagos' }))

    // Inject a corner-1 mistake (overwrites lap-1 auto findings) and isolate lap-2 events.
    engine.setFindings([makeFinding({ sector: 1, kind: 'steering-late', corner: 1, estTimeLossSec: 0.3 })])
    harness.events.length = 0
    harness.time.value += 10_000 // clear any anti-spam window from lap 1

    // Lap 2: enter then exit corner 1 → the engine speaks by CORNER.
    engine.onSnapshot(makeSnapshot(0.25, { currentLap: 2, trackName: 'Interlagos' })) // in C1
    engine.onSnapshot(makeSnapshot(0.35, { currentLap: 2, trackName: 'Interlagos' })) // exit C1

    const cornerEvents = harness.events.filter((e) => e.text.includes('Curva'))
    expect(cornerEvents.length).toBeGreaterThan(0)
    expect(cornerEvents[0].text).toContain('Curva 1')
    expect(cornerEvents[0].text).toContain('vire antes')
    // Observability: the race call-out is attributed to the engineer + tagged with the corner.
    expect(cornerEvents[0].source).toBe('engineer')
    expect(cornerEvents[0].corner).toBe(1)
  })

  it('chains MULTIPLE dimensions into one race corner call-out ("Curva N, freie antes, vire antes, …")', () => {
    const { harness, engine } = makeEngine({}, { buildCornerMap: () => FAKE_MAP })

    for (let i = 0; i < 34; i += 1) {
      const pct = (i / 34) * 0.99
      engine.onSnapshot(makeSnapshot(pct, { currentLap: 1, trackName: 'Interlagos' }))
    }
    engine.onSnapshot(makeSnapshot(0.05, { currentLap: 2, trackName: 'Interlagos' }))

    // Corner 1 carries THREE independent mistakes this lap.
    engine.setFindings([
      makeFinding({ id: 'b', sector: 1, kind: 'brake-late', corner: 1, estTimeLossSec: 0.35 }),
      makeFinding({ id: 's', sector: 1, kind: 'steering-late', corner: 1, estTimeLossSec: 0.25 }),
      makeFinding({ id: 't', sector: 1, kind: 'throttle-early', corner: 1, estTimeLossSec: 0.15 })
    ])
    harness.events.length = 0
    harness.time.value += 10_000

    engine.onSnapshot(makeSnapshot(0.25, { currentLap: 2, trackName: 'Interlagos' })) // in C1
    engine.onSnapshot(makeSnapshot(0.35, { currentLap: 2, trackName: 'Interlagos' })) // exit C1

    const cornerEvents = harness.events.filter((e) => e.text.includes('Curva'))
    expect(cornerEvents.length).toBeGreaterThan(0)
    const line = cornerEvents[0].text
    expect(line).toContain('Curva 1')
    expect(line).toContain('freie antes')
    expect(line).toContain('vire antes')
    expect(line).toContain('acelere mais tarde')
    expect(cornerEvents[0].corner).toBe(1)
  })

  it('speaks the generic time-loss cue in a race when a corner has no specific dimension', () => {
    // Regression guard (v2.36.0): corner whose ONLY loss is dimension-less `time-loss`
    // must still be coached during the race, not silenced by the composite filter.
    const { harness, engine } = makeEngine({}, { buildCornerMap: () => FAKE_MAP })

    for (let i = 0; i < 34; i += 1) {
      const pct = (i / 34) * 0.99
      engine.onSnapshot(makeSnapshot(pct, { currentLap: 1, trackName: 'Interlagos' }))
    }
    engine.onSnapshot(makeSnapshot(0.05, { currentLap: 2, trackName: 'Interlagos' }))

    engine.setFindings([makeFinding({ id: 'tl', sector: 1, kind: 'time-loss', corner: 1, estTimeLossSec: 0.3 })])
    harness.events.length = 0
    harness.time.value += 10_000

    engine.onSnapshot(makeSnapshot(0.25, { currentLap: 2, trackName: 'Interlagos' })) // in C1
    engine.onSnapshot(makeSnapshot(0.35, { currentLap: 2, trackName: 'Interlagos' })) // exit C1

    const cornerEvents = harness.events.filter((e) => e.text.includes('Curva'))
    expect(cornerEvents.length).toBeGreaterThan(0)
    expect(cornerEvents[0].text).toContain('Curva 1')
    expect(cornerEvents[0].text).toContain('ganhe mais tempo aqui')
    expect(cornerEvents[0].corner).toBe(1)
  })

  it('falls back to sector coaching on lap 1 before a corner map is learned', () => {
    // No corner map learned yet (findings injected directly, first lap) → graceful
    // sector fallback so the driver still gets coached on lap 1.
    const { harness, engine } = makeEngine({}, { buildCornerMap: () => FAKE_MAP })
    engine.setFindings([makeFinding({ sector: 1, kind: 'brake-late', estTimeLossSec: 0.4 })])
    engine.onSnapshot(makeSnapshot(0.1, { currentLap: 1 }))
    engine.onSnapshot(makeSnapshot(0.4, { currentLap: 1 })) // completes sector 1
    expect(harness.events).toHaveLength(1)
    expect(harness.events[0].text).toContain('Setor 1')
  })
})

describe('lapsToCatch', () => {
  it('rounds up laps when the chaser is faster (closing)', () => {
    expect(lapsToCatch(6, 89, 90)).toBe(6) // 6s gap, 1s/lap faster → 6 laps
    expect(lapsToCatch(2.5, 89, 90)).toBe(3) // ceil(2.5)
  })
  it('returns null when not closing or noisy', () => {
    expect(lapsToCatch(6, 90, 90)).toBeNull() // same pace
    expect(lapsToCatch(6, 91, 90)).toBeNull() // chaser slower
    expect(lapsToCatch(undefined, 89, 90)).toBeNull()
  })
})

describe('composeCatchLine', () => {
  it('speaks catch estimates in Brazilian Portuguese', () => {
    expect(composeCatchLine('behind', 1, 'pt-BR')).toBe('O carro de trás alcança você em 1 volta.')
    expect(composeCatchLine('behind', 3, 'pt-BR')).toBe('O carro de trás alcança você em 3 voltas.')
    expect(composeCatchLine('ahead', 2, 'pt-BR')).toBe('Você alcança o carro da frente em 2 voltas.')
  })

  it('keeps the English radio copy when requested', () => {
    expect(composeCatchLine('behind', 2, 'en-US')).toBe('Car behind catches you in 2 laps.')
    expect(composeCatchLine('ahead', 1, 'en-US')).toBe('You catch the car ahead in 1 lap.')
  })
})
