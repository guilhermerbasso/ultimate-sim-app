// F6 "Dashboard AI" module — wires the builder + adaptive engine to IPC.
//
// register(ctx) binds two channels under the `dashai:` prefix:
//   • dashai:build           → phrase ⇒ a new Dashboard (LLM-first, deterministic
//                              fallback). Optionally persisted through the EXISTING
//                              dashboards store (same path as app:dash:save).
//   • dashai:adaptiveSuggest → current telemetry snapshot ⇒ emphasis plan.
//
// This file is NEW and self-contained: it does not edit modules/index.ts,
// preload, the registry or nav. See the REGISTRATION NEEDED note for the three
// one-line wirings an integrator must add (module register, `dashai:` allowlist
// prefix, and the view ViewDef).

import type { ModuleContext } from '../module-context'
import {
  DASHBOARD_AI_CHANNELS,
  type DashboardAiAdaptiveRequest,
  type DashboardAiBuildRequest,
  type DashboardAiBuildResponse
} from '../../shared/dashboard-ai-ipc'
import type { AdaptivePlan } from '../../shared/dashboard-adaptive'
import { adaptiveSuggest, buildFromPhrase } from '../ai/dashboard-builder'
import { getDashboardManager } from './dashboards'
import { logger } from './logger'

const LOG_AREA = 'ai'

function coercePhrase(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && typeof (value as { phrase?: unknown }).phrase === 'string') {
    return (value as { phrase: string }).phrase
  }
  return ''
}

export function register(ctx: ModuleContext): void {
  ctx.ipcMain.handle(DASHBOARD_AI_CHANNELS.build, async (_event, request: DashboardAiBuildRequest | string): Promise<DashboardAiBuildResponse> => {
    const req: DashboardAiBuildRequest = typeof request === 'string' ? { phrase: request } : request ?? { phrase: '' }
    const phrase = coercePhrase(req.phrase ?? request)

    const result = await buildFromPhrase(phrase, {
      useLlm: req.useLlm,
      detail: req.detail,
      archetype: req.archetype,
      family: req.family,
      emphasis: req.emphasis,
      logger
    })

    // Optional server-side persistence via the existing store (write-through to
    // disk + in-memory map + `app:dash:list`/`app:dash:updated` broadcast).
    let persisted = false
    if (req.persist) {
      const manager = getDashboardManager()
      if (manager) {
        try {
          await manager.save(result.dashboard)
          persisted = true
        } catch (error) {
          logger.warn(LOG_AREA, 'dashai:build persist failed', { message: error instanceof Error ? error.message : String(error) })
        }
      } else {
        logger.warn(LOG_AREA, 'dashai:build persist skipped: dashboards module not registered yet')
      }
    }

    return {
      dashboard: result.dashboard,
      widgetIds: result.widgetIds,
      matched: result.matched,
      source: result.source,
      usedDefault: result.usedDefault,
      archetype: result.archetype,
      family: result.family,
      emphasis: result.emphasis,
      llmNote: result.llmNote,
      persisted
    }
  })

  ctx.ipcMain.handle(DASHBOARD_AI_CHANNELS.adaptiveSuggest, (_event, request?: DashboardAiAdaptiveRequest): AdaptivePlan => {
    const snapshot = ctx.telemetryHub.getLatest()
    return adaptiveSuggest(snapshot, request?.phase ? { phase: request.phase } : undefined)
  })
}
