// Incident RECORDER module (F4) — main process.
//
// register(ctx) keeps a rolling ring buffer (~60 s) of compact telemetry samples,
// runs the PURE incident detector from shared/incidents.ts on every tick, and —
// when an incident fires — saves a TELEMETRY "clip" (JSON, NOT video) to userData
// once a short post-window of samples has been collected.
//
// Detection is fully deterministic. The local LLM is OPTIONAL and only summarises
// a clip ON DEMAND (`incidents:analyze`), with a deterministic fallback that fully
// works without any model — the LLM is NEVER loaded or run from the telemetry loop.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ModuleContext } from '../module-context'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import {
  DEFAULT_INCIDENT_CONFIG,
  INCIDENT_CHANNELS,
  buildIncidentWindow,
  classifyIncident,
  summarizeIncident,
  toClipMeta,
  toIncidentSample,
  type IncidentAnalysis,
  type IncidentAnalyzeRequest,
  type IncidentClip,
  type IncidentClipMeta,
  type IncidentEvent,
  type IncidentSample
} from '../../shared/incidents'
import { getLlmRuntime } from '../ai/llm-runtime'
import { getModelManager } from '../ai/model-manager'
import { logger } from './logger'

const LOG_AREA = 'incidents'
const CLIPS_DIR = 'incident-clips'
// Rolling buffer length and the window captured around each incident.
const RING_MS = 60_000
const MAX_RING_SAMPLES = 2_400
const PRE_MS = 4_000
const POST_MS = 3_000
// Keep the newest N clips on disk; older ones are pruned.
const MAX_CLIPS = 60
const ANALYZE_MAX_TOKENS = 130

interface PendingCapture {
  event: IncidentEvent
  finalizeAt: number
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function safeFileName(id: string): string {
  return `${id.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`
}

// ─── clip store (userData/incident-clips/*.json) ─────────────────────────────────

class ClipStore {
  private index: IncidentClipMeta[] = []

  constructor(private readonly dir: string) {}

  load(): void {
    try {
      if (!existsSync(this.dir)) {
        mkdirSync(this.dir, { recursive: true })
        return
      }
      const files = readdirSync(this.dir).filter((name) => name.endsWith('.json'))
      const metas: IncidentClipMeta[] = []
      for (const file of files) {
        try {
          const clip = JSON.parse(readFileSync(join(this.dir, file), 'utf8')) as IncidentClip
          if (clip && typeof clip.id === 'string' && Array.isArray(clip.window)) metas.push(toClipMeta(clip))
        } catch {
          // skip a corrupt clip file
        }
      }
      metas.sort((a, b) => b.createdAt - a.createdAt)
      this.index = metas
    } catch (error) {
      logger.warn(LOG_AREA, 'failed to load incident clips', { message: error instanceof Error ? error.message : String(error) })
    }
  }

  list(): IncidentClipMeta[] {
    return this.index.slice()
  }

  get(id: string): IncidentClip | null {
    const path = join(this.dir, safeFileName(id))
    try {
      if (!existsSync(path)) return null
      return JSON.parse(readFileSync(path, 'utf8')) as IncidentClip
    } catch {
      return null
    }
  }

  save(clip: IncidentClip): IncidentClipMeta | null {
    try {
      mkdirSync(this.dir, { recursive: true })
      writeFileSync(join(this.dir, safeFileName(clip.id)), JSON.stringify(clip), 'utf8')
      this.index.unshift(toClipMeta(clip))
      this.prune()
      return this.index[0]
    } catch (error) {
      logger.warn(LOG_AREA, 'failed to save incident clip', { message: error instanceof Error ? error.message : String(error) })
      return null
    }
  }

  clear(): number {
    const count = this.index.length
    for (const meta of this.index) {
      try {
        rmSync(join(this.dir, safeFileName(meta.id)), { force: true })
      } catch {
        // best effort
      }
    }
    this.index = []
    return count
  }

  private prune(): void {
    while (this.index.length > MAX_CLIPS) {
      const oldest = this.index.pop()
      if (!oldest) break
      try {
        rmSync(join(this.dir, safeFileName(oldest.id)), { force: true })
      } catch {
        // best effort
      }
    }
  }
}

// ─── optional LLM analysis (deterministic fallback always works) ─────────────────

async function tryLlmAnalyze(system: string, prompt: string): Promise<string | null> {
  try {
    const modelManager = getModelManager()
    // Only use the model if it is ALREADY on disk — never trigger a download or
    // block on the network from an analyze click.
    const modelPath = modelManager.getActiveModelPath()
    if (!modelPath) return null

    const runtime = getLlmRuntime()
    runtime.setOptions({ modelPath, maxTokens: ANALYZE_MAX_TOKENS, temperature: 0.3 })
    const result = await runtime.generateWithTools({ system, prompt, maxTokens: ANALYZE_MAX_TOKENS, temperature: 0.3 })
    if (result.ok) {
      const text = (result.text ?? '').trim()
      return text.length > 0 ? text : null
    }
    return null
  } catch (error) {
    logger.warn(LOG_AREA, 'incident analyze LLM unavailable', { message: error instanceof Error ? error.message : String(error) })
    return null
  }
}

function analyzePrompt(clip: IncidentClip, lang: 'pt' | 'en'): { system: string; prompt: string } {
  const system =
    lang === 'pt'
      ? 'You are a race engineer. Explain in 1-2 short American English sentences what likely happened in this incident and give one tip. Do not invent numbers.'
      : 'You are a race engineer. In 1-2 short English sentences, explain what likely happened in this incident and one tip. Do not invent numbers.'
  const m = clip.metrics
  const facts = [
    `type=${clip.type}`,
    `severity=${clip.severity}`,
    finite(clip.lap) ? `lap=${clip.lap}` : '',
    finite(clip.lapDistPct) ? `trackPct=${Math.round((clip.lapDistPct as number) * 100)}` : '',
    finite(m.speedKmh) ? `speed=${Math.round(m.speedKmh as number)}kmh` : '',
    finite(m.yawRateRadSec) ? `yaw=${(m.yawRateRadSec as number).toFixed(1)}` : '',
    finite(m.gSpike) ? `gSpike=${(m.gSpike as number).toFixed(1)}` : '',
    finite(m.speedDropKmh) ? `speedDrop=${Math.round(m.speedDropKmh as number)}kmh` : '',
    finite(m.brake) ? `brake=${Math.round((m.brake as number) * 100)}%` : '',
    m.surface ? `surface=${m.surface}` : ''
  ]
    .filter((s) => s.length > 0)
    .join(', ')
  return { system, prompt: `Incident data: ${facts}.\n\nAnalysis:` }
}

// ─── registration ────────────────────────────────────────────────────────────────

export function register(ctx: ModuleContext): void {
  const store = new ClipStore(join(ctx.app.getPath('userData'), CLIPS_DIR))
  store.load()

  const config = DEFAULT_INCIDENT_CONFIG
  let ring: IncidentSample[] = []
  let prevSnapshot: TelemetrySnapshot | null = null
  const lastDetectedAt: Partial<Record<IncidentEvent['type'], number>> = {}
  let pending: PendingCapture[] = []

  const finalizeReady = (nowMs: number): void => {
    if (pending.length === 0) return
    const ready = pending.filter((capture) => capture.finalizeAt <= nowMs)
    if (ready.length === 0) return
    pending = pending.filter((capture) => capture.finalizeAt > nowMs)
    for (const capture of ready) {
      const { window, triggerIndex } = buildIncidentWindow(ring, capture.event.at, PRE_MS, POST_MS)
      const clip: IncidentClip = {
        ...capture.event,
        id: `inc-${capture.event.at}-${capture.event.type}`,
        window,
        triggerIndex,
        createdAt: Date.now()
      }
      const meta = store.save(clip)
      if (meta) {
        ctx.broadcast(INCIDENT_CHANNELS.added, meta)
        logger.info(LOG_AREA, 'incident clip saved', { type: clip.type, severity: clip.severity, lap: clip.lap })
      }
    }
  }

  ctx.telemetryHub.on('snapshot', (snapshot: TelemetrySnapshot | null) => {
    if (!snapshot || !snapshot.connected) {
      // Finalize whatever is pending with the samples we have, then reset the
      // buffer + per-lap continuity so a reconnect (timestamps may reset) can't
      // fabricate a contact/lockup or splice a window across the gap.
      finalizeReady(Number.MAX_SAFE_INTEGER)
      ring = []
      prevSnapshot = null
      return
    }

    const sample = toIncidentSample(snapshot)
    ring.push(sample)
    const cutoff = snapshot.timestamp - RING_MS
    if (ring.length > MAX_RING_SAMPLES || (ring.length > 0 && ring[0].t < cutoff)) {
      ring = ring.filter((s) => s.t >= cutoff).slice(-MAX_RING_SAMPLES)
    }

    const event = classifyIncident(prevSnapshot, snapshot, config)
    prevSnapshot = snapshot

    if (event) {
      const last = lastDetectedAt[event.type]
      if (!finite(last) || event.at - (last as number) >= config.minGapMs) {
        lastDetectedAt[event.type] = event.at
        pending.push({ event, finalizeAt: snapshot.timestamp + POST_MS })
      }
    }

    finalizeReady(snapshot.timestamp)
  })

  ctx.ipcMain.handle(INCIDENT_CHANNELS.list, () => store.list())
  ctx.ipcMain.handle(INCIDENT_CHANNELS.get, (_event, id: unknown) => (typeof id === 'string' ? store.get(id) : null))
  ctx.ipcMain.handle(INCIDENT_CHANNELS.clear, () => store.clear())

  ctx.ipcMain.handle(INCIDENT_CHANNELS.analyze, async (_event, request?: IncidentAnalyzeRequest): Promise<IncidentAnalysis> => {
    const id = request?.id ?? ''
    const lang: 'pt' | 'en' = request?.lang === 'en' ? 'en' : 'pt'
    const clip = id ? store.get(id) : null
    if (!clip) {
      return { id, text: lang === 'pt' ? 'Incident clip not found.' : 'Incident clip not found.', source: 'deterministic' }
    }
    const deterministic = summarizeIncident(clip, lang)
    if (request?.useLlm === true) {
      const { system, prompt } = analyzePrompt(clip, lang)
      const llmText = await tryLlmAnalyze(system, prompt)
      if (llmText) return { id, text: llmText, source: 'llm', clip: toClipMeta(clip) }
    }
    return { id, text: deterministic, source: 'deterministic', clip: toClipMeta(clip) }
  })
}
