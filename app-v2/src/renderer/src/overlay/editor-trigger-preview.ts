import { DEFAULT_ALERTS_CONFIG, type AlertsConfig } from '../../../shared/alerts'
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
  forced: boolean
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
      forced: false
    }
  }

  const controller = new OverlayTriggerController()
  const sequence = [false, true, true, false] as const
  let fallback: EditorTriggerPreviewFrame | undefined

  for (let index = 0; index < sequence.length; index += 1) {
    const snapshot = simulateOverlayTriggerSnapshot(
      base,
      trigger,
      sequence[index],
      alertsConfig
    )
    const visibility = controller.evaluate(
      key,
      trigger,
      snapshot,
      index * 100,
      alertsConfig
    )
    const frame = { snapshot, visibility, forced: true }
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
    forced: true
  }
}
