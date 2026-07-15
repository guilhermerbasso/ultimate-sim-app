// ── Hi-fi widget registry (aggregator) ────────────────────────────────────────
// Combines every per-category group into one flat list WITHOUT touching any shared
// union — each group owns its own folder/index, so groups build fully in parallel.
// This file is created ONCE (foundation) and imports the per-group arrays; the group
// agents only edit their own `<group>/index.ts`.
import type { HifiWidgetModule } from './types'
import { mergeTags } from '../../../../shared/tags'
import {
  RELEASE_A_CATALOG_ORDER,
  RELEASE_A_RELEASED_AT,
  RELEASE_A_TAG
} from '../../../../shared/catalog-order'
import {
  overlayTriggerTags,
  semanticTriggerForHifiModule
} from '../../../../shared/overlays'
import { INPUTS_WIDGETS } from './inputs'
import { DRIVE_WIDGETS } from './drive'
import { TIMING_WIDGETS } from './timing'
import { GAPS_WIDGETS } from './gaps'
import { FUEL_WIDGETS } from './fuel'
import { TYRES_WIDGETS } from './tyres'
import { BRAKES_ENGINE_WIDGETS } from './brakesEngine'
import { SESSION_ENV_WIDGETS } from './sessionEnv'
import { AI_WIDGETS } from './ai'
import { ALERTS_WIDGETS } from './alerts'
import { ALERTS2_WIDGETS } from './alerts2'
import { THEMED_WIDGETS } from './themed'
import { CARS_REAL_WIDGETS } from './carsReal'
import { COMPARE_WIDGETS } from './compare'
import { IR_VITALS_WIDGETS } from './irVitals'
import { IR_ENV2_WIDGETS } from './irEnv2'
import { IR_TIMING2_WIDGETS } from './irTiming2'
import { IR_SESSION2_WIDGETS } from './irSession2'
import { IR_CONDITIONS2_WIDGETS } from './irConditions2'
import { IR_CHASSIS_WIDGETS } from './irChassis'
import { IR_ELECTRONICS_WIDGETS } from './irElectronics'
import { IR_PIT2_WIDGETS } from './irPit2'
import { IR_AIDS_WIDGETS } from './irAids'
import { IR_INCIDENTS_WIDGETS } from './irIncidents'
import { IR_SESSIONINFO_WIDGETS } from './irSessionInfo'
import { IR_EXTRA_WIDGETS } from './irExtra'
import { IR_DERIVED_WIDGETS } from './irDerived'
import { THEMED_DERIVED_WIDGETS } from './themedDerived'
import { THEMED_CHANNEL_WIDGETS } from './themedChannels'
import { TELEMETRY_VARIANT_WIDGETS } from './variants'
import { REMAINING_TELEMETRY_WIDGETS } from './variants/complex-widgets'

const ALL_TELEMETRY_VARIANT_WIDGETS = [
  ...TELEMETRY_VARIANT_WIDGETS,
  ...REMAINING_TELEMETRY_WIDGETS
]

export const HIFI_WIDGET_GROUPS = {
  inputs: INPUTS_WIDGETS,
  drive: DRIVE_WIDGETS,
  timing: TIMING_WIDGETS,
  gaps: GAPS_WIDGETS,
  fuel: FUEL_WIDGETS,
  tyres: TYRES_WIDGETS,
  brakesEngine: BRAKES_ENGINE_WIDGETS,
  sessionEnv: SESSION_ENV_WIDGETS,
  ai: AI_WIDGETS,
  alerts: ALERTS_WIDGETS,
  alerts2: ALERTS2_WIDGETS,
  themed: THEMED_WIDGETS,
  carsReal: CARS_REAL_WIDGETS,
  compare: COMPARE_WIDGETS,
  irVitals: IR_VITALS_WIDGETS,
  irEnv2: IR_ENV2_WIDGETS,
  irTiming2: IR_TIMING2_WIDGETS,
  irSession2: IR_SESSION2_WIDGETS,
  irConditions2: IR_CONDITIONS2_WIDGETS,
  irChassis: IR_CHASSIS_WIDGETS,
  irElectronics: IR_ELECTRONICS_WIDGETS,
  irPit2: IR_PIT2_WIDGETS,
  irAids: IR_AIDS_WIDGETS,
  irIncidents: IR_INCIDENTS_WIDGETS,
  irSessionInfo: IR_SESSIONINFO_WIDGETS,
  irExtra: IR_EXTRA_WIDGETS,
  irDerived: IR_DERIVED_WIDGETS,
  themedDerived: THEMED_DERIVED_WIDGETS,
  themedChannels: THEMED_CHANNEL_WIDGETS,
  telemetryVariants: ALL_TELEMETRY_VARIANT_WIDGETS
} as const

/** Every hi-fi per-telemetry widget/overlay. */
const RAW_HIFI_WIDGETS: HifiWidgetModule[] = [
  ...INPUTS_WIDGETS,
  ...DRIVE_WIDGETS,
  ...TIMING_WIDGETS,
  ...GAPS_WIDGETS,
  ...FUEL_WIDGETS,
  ...TYRES_WIDGETS,
  ...BRAKES_ENGINE_WIDGETS,
  ...SESSION_ENV_WIDGETS,
  ...AI_WIDGETS,
  ...ALERTS_WIDGETS,
  ...ALERTS2_WIDGETS,
  ...THEMED_WIDGETS,
  ...CARS_REAL_WIDGETS,
  ...COMPARE_WIDGETS,
  ...IR_VITALS_WIDGETS,
  ...IR_ENV2_WIDGETS,
  ...IR_TIMING2_WIDGETS,
  ...IR_SESSION2_WIDGETS,
  ...IR_CONDITIONS2_WIDGETS,
  ...IR_CHASSIS_WIDGETS,
  ...IR_ELECTRONICS_WIDGETS,
  ...IR_PIT2_WIDGETS,
  ...IR_AIDS_WIDGETS,
  ...IR_INCIDENTS_WIDGETS,
  ...IR_SESSIONINFO_WIDGETS,
  ...IR_EXTRA_WIDGETS,
  ...IR_DERIVED_WIDGETS,
  ...THEMED_DERIVED_WIDGETS,
  ...THEMED_CHANNEL_WIDGETS,
  ...ALL_TELEMETRY_VARIANT_WIDGETS
]

function normalizeHifiWidget(module: HifiWidgetModule): HifiWidgetModule {
  const semanticTrigger = semanticTriggerForHifiModule(module.id)
  const alertFamily = module.category === 'alerts' || module.category === 'alerts2'
  const role = module.role ?? (semanticTrigger || alertFamily ? 'alert' : undefined)
  const defaultTrigger = semanticTrigger ?? module.defaultTrigger
  if (role !== 'alert') return module
  return {
    ...module,
    role,
    defaultTrigger,
    preview: module.preview ?? 'simulated-active-sequence',
    catalogOrder: module.catalogOrder ?? RELEASE_A_CATALOG_ORDER,
    releasedAt: module.releasedAt ?? RELEASE_A_RELEASED_AT,
    tags: [
      ...new Set([
        ...module.tags,
        ...overlayTriggerTags(defaultTrigger),
        RELEASE_A_TAG
      ])
    ]
  }
}

export const HIFI_WIDGETS: HifiWidgetModule[] = RAW_HIFI_WIDGETS.map(normalizeHifiWidget)

export const HIFI_WIDGETS_BY_ID: Record<string, HifiWidgetModule> = Object.fromEntries(
  HIFI_WIDGETS.map((w) => [w.id, w])
)

/** Full tag set for a module: its manual tags + category + auto yes tags (from requires). */
export function hifiWidgetTags(m: HifiWidgetModule): string[] {
  return mergeTags(m.tags, m.requires, m.category)
}
