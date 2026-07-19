import {
  DEFAULT_ALERTS_CONFIG,
  type AlertOutput,
  type AlertRuleConfig,
  type AlertsConfig
} from '../../../shared/alerts'
import {
  OverlayTriggerController,
  simulateOverlayTriggerSnapshot,
  type OverlayRole,
  type OverlayTrigger,
  type OverlayTriggerResult
} from '../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../shared/telemetry'

export const EDITOR_TRIGGER_PREVIEW_STORAGE_KEY = 'usa.editor.triggerOnlyActive'
export const DEFAULT_EDITOR_TRIGGER_PREVIEW_ACTIVE = true

interface EditorPreferenceStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface EditorTriggerPreviewFrame {
  snapshot: TelemetrySnapshot
  visibility: OverlayTriggerResult
  alertsConfig: AlertsConfig
  forced: boolean
}

function cloneOutputs(outputs: AlertOutput[] | undefined): AlertOutput[] | undefined {
  return outputs?.map((output) => ({ ...output }))
}

function enableRule<T extends AlertRuleConfig>(rule: T): T {
  return {
    ...rule,
    enabled: true,
    ...(rule.outputs ? { outputs: cloneOutputs(rule.outputs) } : {})
  }
}

function enableOptionalRule<T extends AlertRuleConfig>(
  fallback: T,
  current: T | undefined
): T {
  return enableRule({ ...fallback, ...current } as T)
}

function freezeTree<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value as Record<string, unknown>)) {
    freezeTree(child)
  }
  return Object.freeze(value)
}

export function createEditorPreviewAlertsConfig(
  current: AlertsConfig = DEFAULT_ALERTS_CONFIG
): AlertsConfig {
  const preview: AlertsConfig = {
    ...current,
    pitLimiter: enableRule(current.pitLimiter),
    flags: enableRule(current.flags),
    lowFuel: enableRule(current.lowFuel),
    shiftPoint: enableRule(current.shiftPoint),
    incidentLimit: enableRule(current.incidentLimit),
    tyrePressure: enableOptionalRule(
      DEFAULT_ALERTS_CONFIG.tyrePressure!,
      current.tyrePressure
    ),
    tyreTemp: enableOptionalRule(
      DEFAULT_ALERTS_CONFIG.tyreTemp!,
      current.tyreTemp
    ),
    brakeTemp: enableOptionalRule(
      DEFAULT_ALERTS_CONFIG.brakeTemp!,
      current.brakeTemp
    ),
    brakePressureLow: {
      ...DEFAULT_ALERTS_CONFIG.brakePressureLow!,
      ...current.brakePressureLow
    },
    drsAvailable: enableOptionalRule(
      DEFAULT_ALERTS_CONFIG.drsAvailable!,
      current.drsAvailable
    ),
    blueFlag: enableOptionalRule(
      DEFAULT_ALERTS_CONFIG.blueFlag!,
      current.blueFlag
    )
  }
  return freezeTree(preview)
}

export function readEditorTriggerPreviewPreference(
  storage?: EditorPreferenceStorage | null
): boolean {
  try {
    const target =
      storage ??
      (typeof window !== 'undefined' ? window.localStorage : null)
    const raw = target?.getItem(EDITOR_TRIGGER_PREVIEW_STORAGE_KEY)
    if (raw === 'false') return false
    if (raw === 'true') return true
  } catch {
    // Restricted renderer storage falls back to the editor-friendly default.
  }
  return DEFAULT_EDITOR_TRIGGER_PREVIEW_ACTIVE
}

export function persistEditorTriggerPreviewPreference(
  active: boolean,
  storage?: EditorPreferenceStorage | null
): void {
  try {
    const target =
      storage ??
      (typeof window !== 'undefined' ? window.localStorage : null)
    target?.setItem(EDITOR_TRIGGER_PREVIEW_STORAGE_KEY, String(active))
  } catch {
    // The preference is optional session UX; rendering must still work without storage.
  }
}

export function isTriggerOnlyPreview(
  role: OverlayRole | undefined,
  trigger: OverlayTrigger | null | undefined
): boolean {
  return role === 'alert' && Boolean(trigger && trigger.kind !== 'always')
}

export function resolveEditorPreviewTrigger(
  trigger: OverlayTrigger | null | undefined,
  fallback: OverlayTrigger | null | undefined
): OverlayTrigger | null | undefined {
  return trigger?.kind === 'never' && fallback ? fallback : trigger
}

export function createEditorTriggerPreviewFrame(
  base: TelemetrySnapshot,
  trigger: OverlayTrigger | null | undefined,
  forceActive: boolean,
  alertsConfig: AlertsConfig = DEFAULT_ALERTS_CONFIG,
  key = 'editor-preview'
): EditorTriggerPreviewFrame {
  if (!forceActive || !trigger || trigger.kind === 'always') {
    const controller = new OverlayTriggerController()
    return {
      snapshot: base,
      visibility: controller.evaluate(key, trigger, base, 0, alertsConfig),
      alertsConfig,
      forced: false
    }
  }

  const previewAlertsConfig = createEditorPreviewAlertsConfig(alertsConfig)
  const controller = new OverlayTriggerController()
  const sequence = [false, true, true, false] as const
  let fallback: EditorTriggerPreviewFrame | undefined

  for (let index = 0; index < sequence.length; index += 1) {
    const snapshot = simulateOverlayTriggerSnapshot(
      base,
      trigger,
      sequence[index],
      previewAlertsConfig
    )
    const visibility = controller.evaluate(
      key,
      trigger,
      snapshot,
      index * 100,
      previewAlertsConfig
    )
    const frame = {
      snapshot,
      visibility,
      alertsConfig: previewAlertsConfig,
      forced: true
    }
    fallback = frame
    if (visibility.visible) return frame
  }

  return fallback ?? {
    snapshot: base,
    visibility: {
      visible: false,
      active: false,
      held: false,
      phase: 'inactive'
    },
    alertsConfig: previewAlertsConfig,
    forced: true
  }
}
