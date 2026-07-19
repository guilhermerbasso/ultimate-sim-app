import { buttonActionEventToIpc } from '../../../shared/touch-panel'
import type { TouchActionResult, TouchControlActionEvent } from './ButtonBoxRenderer'
import { streamEndpoint } from '../stream/urls'

export function isBrowserStreamRuntime(): boolean {
  return typeof window.ipc?.invoke !== 'function'
}

export async function fetchStreamPanel(panelId: string): Promise<unknown> {
  const url = streamEndpoint(`api/touch/panel/${encodeURIComponent(panelId)}`)
  const response = await fetch(url, { credentials: 'same-origin' })
  if (!response.ok) throw new Error(`Panel load failed (HTTP ${response.status}).`)
  return response.json()
}

function resultFromIpc(value: unknown): TouchActionResult {
  if (value && typeof value === 'object' && 'ok' in value) {
    const result = value as { ok?: unknown; message?: unknown }
    return {
      ok: result.ok !== false,
      message: typeof result.message === 'string' ? result.message : undefined
    }
  }
  return { ok: true }
}

/** Execute a semantic renderer event through only its exact mapped IPC channel. */
export async function executeTouchControlAction(event: TouchControlActionEvent): Promise<TouchActionResult> {
  if (isBrowserStreamRuntime()) {
    throw new Error('Touch controls are read-only in browser streaming mode.')
  }
  const ipc = buttonActionEventToIpc(event.action, event.phase, event.token, event.zone)
  if (!ipc) return { ok: true }
  try {
    const result = resultFromIpc(await window.ipc.invoke(ipc.channel, ...ipc.args))
    if (!result.ok) throw new Error(result.message ?? 'Action was rejected.')
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Action dispatch failed.'
    console.warn('[touchpanel] action dispatch failed', ipc.channel, error)
    throw new Error(message)
  }
}
