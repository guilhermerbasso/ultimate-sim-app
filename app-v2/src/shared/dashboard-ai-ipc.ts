// Shared IPC contract for the F6 "Dashboard AI" feature.
//
// Dependency-free (no node:*, electron, node-llama-cpp or React) so it can be
// imported by main, preload, renderer AND unit tests — same rule as
// shared/engineer-ipc.ts. It carries only the channel names + serializable
// request/response payload shapes (types are erased at runtime).

import type { Dashboard } from './dashboards'
import type { AdaptivePhase, AdaptivePlan } from './dashboard-adaptive'
import type { DashboardConcept, DetailLevel } from './dashboard-nl'
import type { DashboardArchetype } from './dashboard-blueprints'
import type { EmphasisTag } from './dashboard-layout'
import type { OverlayDesignFamily } from './overlays'

// ─── Channels ────────────────────────────────────────────────────────────────
//
// Single `dashai:` prefix. NOTE: the preload allowlist (ALLOWED_PREFIXES in
// src/preload/index.ts) must include 'dashai:' for these to pass — see the
// REGISTRATION NEEDED note. Persistence reuses the existing `app:dash:*` store.
export const DASHBOARD_AI_CHANNELS = {
  /** Renderer → Main: build a dashboard from a phrase (DashboardAiBuildResponse). */
  build: 'dashai:build',
  /** Renderer → Main: emphasis plan for the current/forced phase (AdaptivePlan). */
  adaptiveSuggest: 'dashai:adaptiveSuggest'
} as const

export type DashboardAiChannel = (typeof DASHBOARD_AI_CHANNELS)[keyof typeof DASHBOARD_AI_CHANNELS]

// ─── Build ───────────────────────────────────────────────────────────────────

export interface DashboardAiBuildRequest {
  phrase: string
  /** Persist the result via the existing dashboards store (app:dash:save). */
  persist?: boolean
  /** Force the deterministic keyword path (skip the LLM). */
  useLlm?: boolean
  detail?: DetailLevel
  /** Explicit archetype override (manual UI picker — bypasses the LLM). */
  archetype?: DashboardArchetype
  /** Explicit design family / theme override (manual UI picker). */
  family?: OverlayDesignFamily
  /** Explicit emphasis tags override. */
  emphasis?: EmphasisTag[]
}

export interface DashboardAiBuildResponse {
  dashboard: Dashboard
  widgetIds: string[]
  matched: DashboardConcept[]
  source: 'llm' | 'deterministic'
  usedDefault: boolean
  /** The classification that produced the dashboard. */
  archetype: DashboardArchetype
  family: OverlayDesignFamily
  emphasis: EmphasisTag[]
  llmNote?: string
  persisted: boolean
}

// ─── Adaptive ──────────────────────────────────────────────────────────────────

export interface DashboardAiAdaptiveRequest {
  /** Override the derived phase (otherwise inferred from the live snapshot). */
  phase?: AdaptivePhase
}

export type DashboardAiAdaptiveResponse = AdaptivePlan
