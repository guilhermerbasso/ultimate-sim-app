// ── Hi-fi widget registry (aggregator) ────────────────────────────────────────
// Combines every per-category group into one flat list WITHOUT touching any shared
// union — each group owns its own folder/index, so groups build fully in parallel.
// This file is created ONCE (foundation) and imports the per-group arrays; the group
// agents only edit their own `<group>/index.ts`.
import type { HifiWidgetModule } from './types'
import { mergeTags } from '../../../../shared/tags'
import { INPUTS_WIDGETS } from './inputs'
import { DRIVE_WIDGETS } from './drive'
import { TIMING_WIDGETS } from './timing'
import { GAPS_WIDGETS } from './gaps'
import { FUEL_WIDGETS } from './fuel'
import { TYRES_WIDGETS } from './tyres'
import { BRAKES_ENGINE_WIDGETS } from './brakesEngine'
import { SESSION_ENV_WIDGETS } from './sessionEnv'
import { AI_WIDGETS } from './ai'

export const HIFI_WIDGET_GROUPS = {
  inputs: INPUTS_WIDGETS,
  drive: DRIVE_WIDGETS,
  timing: TIMING_WIDGETS,
  gaps: GAPS_WIDGETS,
  fuel: FUEL_WIDGETS,
  tyres: TYRES_WIDGETS,
  brakesEngine: BRAKES_ENGINE_WIDGETS,
  sessionEnv: SESSION_ENV_WIDGETS,
  ai: AI_WIDGETS
} as const

/** Every hi-fi per-telemetry widget/overlay. */
export const HIFI_WIDGETS: HifiWidgetModule[] = [
  ...INPUTS_WIDGETS,
  ...DRIVE_WIDGETS,
  ...TIMING_WIDGETS,
  ...GAPS_WIDGETS,
  ...FUEL_WIDGETS,
  ...TYRES_WIDGETS,
  ...BRAKES_ENGINE_WIDGETS,
  ...SESSION_ENV_WIDGETS,
  ...AI_WIDGETS
]

export const HIFI_WIDGETS_BY_ID: Record<string, HifiWidgetModule> = Object.fromEntries(
  HIFI_WIDGETS.map((w) => [w.id, w])
)

/** Full tag set for a module: its manual tags + category + auto sim tags (from requires). */
export function hifiWidgetTags(m: HifiWidgetModule): string[] {
  return mergeTags(m.tags, m.requires, m.category)
}
