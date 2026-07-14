// Predictive STRATEGY module (F4) — main process.
//
// register(ctx) subscribes to the telemetry hub, keeps the rolling fuel/lap/tyre
// rates fresh (READ-ONLY REUSE of the existing FuelStrategyCalculator and
// TireStrategyCalculator — it instantiates its OWN private copies, so it never
// touches or breaks the fuel-strategy / tire-strategy modules), and feeds those
// rates into the PURE `computeStrategyPlan(...)` from shared/strategy.ts.
//
// The heavy work is fully deterministic and runs in the telemetry loop (throttled).
// The local LLM is OPTIONAL and only narrates ON DEMAND (`strategy:narrate`), with
// a deterministic radio-call fallback that fully works without any model — the
// LLM is NEVER loaded or run from the telemetry loop.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ModuleContext } from '../module-context'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import type { Corners } from '../../shared/telemetry'
import type { FuelStrategyState } from '../../shared/fuel'
import type { UnitSystem } from '../../shared/units'
import type { TireCornerId, TireCornerStrategy, TireStrategyState } from '../../shared/tire-strategy'
import {
  DEFAULT_STRATEGY_CONFIG,
  STRATEGY_CHANNELS,
  computeStrategyPlan,
  mergeStrategyConfig,
  narrateStrategyPlan,
  type StrategyConfig,
  type StrategyNarrateRequest,
  type StrategyNarration,
  type StrategyPlan,
  type StrategyRates
} from '../../shared/strategy'
import { FuelStrategyCalculator } from '../strategy/fuel'
import { TireStrategyCalculator } from '../strategy/tire'
import { getLlmRuntime } from '../ai/llm-runtime'
import { getModelManager } from '../ai/model-manager'
import { logger } from './logger'
import { settingsEvents } from '../settings/events'
import {
  captureLiveTelemetryContext,
  isCurrentLiveTelemetryContext,
  LiveTelemetryGate,
  REPLAY_SPEECH_CANCEL_CHANNELS,
  type ReplaySpeechCancelEvent
} from '../../shared/replay'

const LOG_AREA = 'ai'
const CONFIG_FILE = 'strategy.json'
// Recompute + broadcast at ~1 Hz — strategy numbers don't need 30 Hz, and this
// keeps the deterministic projection cheap even though it runs in the telemetry
// subscription.
const COMPUTE_THROTTLE_MS = 1000
// Hard cap so an optional LLM phrasing stays a SHORT radio call.
const NARRATE_MAX_TOKENS = 90

const CORNERS: TireCornerId[] = ['lf', 'rf', 'lr', 'rr']

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

// ─── config persistence ────────────────────────────────────────────────────────

function clampConfig(patch: Partial<StrategyConfig> | undefined, base: StrategyConfig): StrategyConfig {
  return mergeStrategyConfig(base, patch)
}

function loadConfig(configPath: string): StrategyConfig {
  try {
    const raw = JSON.parse(readFileSync(configPath, 'utf8')) as Partial<StrategyConfig>
    return mergeStrategyConfig(DEFAULT_STRATEGY_CONFIG, raw)
  } catch {
    return { ...DEFAULT_STRATEGY_CONFIG }
  }
}

function saveConfig(configPath: string, config: StrategyConfig): void {
  try {
    mkdirSync(dirname(configPath), { recursive: true })
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  } catch (error) {
    logger.warn(LOG_AREA, 'failed to persist strategy.json', { message: error instanceof Error ? error.message : String(error) })
  }
}

// ─── rate extraction from the reused calculators ─────────────────────────────────

function cornerOf(state: TireStrategyState, id: TireCornerId | undefined): TireCornerStrategy | undefined {
  if (!id) return undefined
  const corners = state.corners as Corners<TireCornerStrategy>
  return corners[id]
}

function deriveRates(fuel: FuelStrategyState, tyre: TireStrategyState): StrategyRates {
  // TyreStrategy stores life on a 0..100 scale; the strategy math uses 0..1.
  const worst = cornerOf(tyre, tyre.worstCorner)
  let lifePct = worst && finite(worst.wearPct) ? worst.wearPct / 100 : undefined
  let wearPerLapPct = worst && finite(worst.wearPerLap) ? worst.wearPerLap / 100 : undefined

  if (!finite(lifePct)) {
    const lives = CORNERS.map((c) => cornerOf(tyre, c)?.wearPct).filter(finite) as number[]
    if (lives.length > 0) lifePct = Math.min(...lives) / 100
  }
  if (!finite(wearPerLapPct) && finite(tyre.avgWearPerLap)) wearPerLapPct = (tyre.avgWearPerLap as number) / 100

  return {
    fuelPerLap: finite(fuel.usedPerLap) ? fuel.usedPerLap : undefined,
    lapTimeSec: finite(fuel.stint.estimatedLapTimeSec) ? fuel.stint.estimatedLapTimeSec : undefined,
    tyreLifePct: finite(lifePct) ? lifePct : undefined,
    tyreWearPerLapPct: finite(wearPerLapPct) ? wearPerLapPct : undefined
  }
}

// ─── optional LLM narration (deterministic fallback always works) ─────────────────

async function tryLlmNarrate(system: string, prompt: string): Promise<string | null> {
  try {
    const modelManager = getModelManager()
    // Only narrate with the model if it is ALREADY present on disk — never trigger
    // a (~1 GB) download from a narrate click, and never block on the network.
    const modelPath = modelManager.getActiveModelPath()
    if (!modelPath) return null

    const runtime = getLlmRuntime()
    runtime.setOptions({ modelPath, maxTokens: NARRATE_MAX_TOKENS, temperature: 0.3 })
    const result = await runtime.generateWithTools({ system, prompt, maxTokens: NARRATE_MAX_TOKENS, temperature: 0.3 })
    if (result.ok) {
      const text = (result.text ?? '').trim()
      return text.length > 0 ? text : null
    }
    return null
  } catch (error) {
    logger.warn(LOG_AREA, 'strategy narrate LLM unavailable', { message: error instanceof Error ? error.message : String(error) })
    return null
  }
}

function narratePrompt(plan: StrategyPlan, lang: 'pt' | 'en', unitSystem: UnitSystem): { system: string; prompt: string } {
  const units = unitSystem === 'imperial' ? 'Use US customary units (mph, °F, psi, US gal).' : 'Use metric units (km/h, °C, bar or kPa, L).'
  const system =
    lang === 'pt'
      ? `You are a race engineer on the radio. Rewrite the plan in ONE short, calm, direct American English sentence. Do not invent numbers. ${units}`
      : `You are a race engineer on the radio. Rephrase the plan as ONE short, calm, direct sentence in English. Do not invent numbers. ${units}`
  const facts = [
    `action=${plan.action}`,
    plan.headline,
    finite(plan.fuel.marginLaps) ? `fuel margin ${plan.fuel.marginLaps} laps` : '',
    finite(plan.tyres.lapsToThreshold) ? `tyres ${plan.tyres.lapsToThreshold} laps to limit` : '',
    plan.pitWindow.open && plan.pitWindow.optimalLap ? `pit by lap ${plan.pitWindow.optimalLap}` : '',
    plan.undercut.available ? plan.undercut.summary : ''
  ]
    .filter((s) => s.length > 0)
    .join('. ')
  return { system, prompt: `${facts}\n\nRadio call:` }
}

// ─── registration ────────────────────────────────────────────────────────────────

export function register(ctx: ModuleContext): void {
  const configPath = join(ctx.app.getPath('userData'), CONFIG_FILE)
  let config = loadConfig(configPath)
  let unitSystem: UnitSystem = 'metric'
  settingsEvents.onChanged((settings) => {
    unitSystem = settings.unitSystem
  })

  // PRIVATE calculator copies — read-only reuse; the existing fuel-strategy and
  // tire-strategy modules keep their own independent instances.
  const fuelCalc = new FuelStrategyCalculator()
  const tireCalc = new TireStrategyCalculator()

  let latestSnapshot: TelemetrySnapshot | null = null
  let latestPlan: StrategyPlan = computeStrategyPlan(null, {}, config)
  let lastComputeAt = 0
  const liveGate = new LiveTelemetryGate()

  const buildPlan = (): StrategyPlan => {
    const fuelState = fuelCalc.get()
    const tyreState = tireCalc.get()
    const rates = deriveRates(fuelState, tyreState)
    return computeStrategyPlan(latestSnapshot, rates, config)
  }

  const resetLiveState = (): void => {
    latestSnapshot = null
    fuelCalc.update(null)
    fuelCalc.reset()
    tireCalc.update(null)
    tireCalc.reset()
    lastComputeAt = 0
    latestPlan = buildPlan()
    ctx.broadcast(STRATEGY_CHANNELS.update, latestPlan)
  }

  ctx.telemetryHub.on('snapshot', (snapshot: TelemetrySnapshot | null) => {
    const live = liveGate.observe(snapshot)
    if (!live.live) {
      if (live.boundary) {
        const state = live.state === 'live' ? 'unknown' : live.state
        for (const [owner, channel] of Object.entries(REPLAY_SPEECH_CANCEL_CHANNELS)) {
          const event: ReplaySpeechCancelEvent = {
            owner: owner as ReplaySpeechCancelEvent['owner'],
            state,
            revision: snapshot?.replayContext?.revision
          }
          ctx.broadcast(channel, event)
        }
        resetLiveState()
      }
      return
    }
    if (live.boundary) resetLiveState()
    latestSnapshot = snapshot
    // Keep the rolling samples fresh every tick (cheap; this is the sampling the
    // pure projection depends on).
    fuelCalc.update(snapshot)
    tireCalc.update(snapshot)

    const now = Date.now()
    if (now - lastComputeAt < COMPUTE_THROTTLE_MS) return
    lastComputeAt = now
    latestPlan = buildPlan()
    ctx.broadcast(STRATEGY_CHANNELS.update, latestPlan)
  })

  ctx.ipcMain.handle(STRATEGY_CHANNELS.getPlan, (_event, patch?: Partial<StrategyConfig>) => {
    if (patch && typeof patch === 'object') {
      config = clampConfig(patch, config)
      saveConfig(configPath, config)
    }
    latestPlan = buildPlan()
    return latestPlan
  })

  // Persisted strategy config (e.g. the "usar IA local" toggle). Mirrors the
  // spotter module's getConfig/setConfig pattern so the StrategyView toggle
  // survives navigation/reloads instead of living only in renderer state.
  ctx.ipcMain.handle(STRATEGY_CHANNELS.getConfig, () => config)

  ctx.ipcMain.handle(STRATEGY_CHANNELS.setConfig, (_event, patch?: Partial<StrategyConfig>): StrategyConfig => {
    config = clampConfig(patch && typeof patch === 'object' ? patch : {}, config)
    saveConfig(configPath, config)
    ctx.broadcast(STRATEGY_CHANNELS.configEvent, config)
    return config
  })

  ctx.ipcMain.handle(STRATEGY_CHANNELS.narrate, async (_event, request?: StrategyNarrateRequest): Promise<StrategyNarration> => {
    const lang: 'pt' | 'en' = request?.lang === 'en' ? 'en' : 'pt'
    const context = captureLiveTelemetryContext(ctx.telemetryHub.getLatest())
    if (!context) return { text: '', source: 'deterministic', plan: latestPlan }
    if (request?.settings && typeof request.settings === 'object') {
      config = clampConfig(request.settings, config)
      saveConfig(configPath, config)
    }
    const plan = buildPlan()
    const deterministic = narrateStrategyPlan(plan, lang, unitSystem)

    if (request?.useLlm === true && plan.connected) {
      const { system, prompt } = narratePrompt(plan, lang, unitSystem)
      const llmText = await tryLlmNarrate(system, prompt)
      if (!isCurrentLiveTelemetryContext(ctx.telemetryHub.getLatest(), context)) {
        return { text: '', source: 'deterministic', plan: latestPlan }
      }
      if (llmText) return { text: llmText, source: 'llm', plan }
    }
    return { text: deterministic, source: 'deterministic', plan }
  })
}
