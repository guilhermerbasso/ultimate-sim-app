import {
  buttonActionEventToIpc,
  type ButtonAction,
  type TouchActionPhase
} from '../../../shared/touch-panel'
import type { TouchActionResult, TouchControlActionEvent } from './ButtonBoxRenderer'

function authToken(): string {
  try {
    return new URLSearchParams(window.location.search).get('token') ?? ''
  } catch {
    return ''
  }
}

export function isBrowserStreamRuntime(): boolean {
  return typeof window.ipc?.invoke !== 'function'
}

export async function fetchStreamPanel(panelId: string): Promise<unknown> {
  const url = new URL(`/api/touch/panel/${encodeURIComponent(panelId)}`, window.location.origin)
  url.searchParams.set('token', authToken())
  const response = await fetch(url)
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

async function executeBrowserAction(action: ButtonAction, phase: TouchActionPhase): Promise<TouchActionResult> {
  // The browser streaming branch currently supports discrete actions only. Never
  // fake a hold: without a guaranteed release path that could leave a key stuck.
  if (phase !== 'trigger') {
    throw new Error('Press-and-hold is unavailable in browser streaming mode.')
  }
  const url = new URL('/api/touch/action', window.location.origin)
  url.searchParams.set('token', authToken())
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify(action)
  })
  if (!response.ok) throw new Error(`Action failed (HTTP ${response.status}).`)
  return { ok: true, message: 'Action sent.' }
}

/** Execute a semantic renderer event through only its exact mapped IPC channel. */
export async function executeTouchControlAction(event: TouchControlActionEvent): Promise<TouchActionResult> {
  if (isBrowserStreamRuntime()) return executeBrowserAction(event.action, event.phase)
  const ipc = buttonActionEventToIpc(event.action, event.phase, event.token)
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
