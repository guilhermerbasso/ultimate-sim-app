import { buttonActionEventToIpc } from '../../../shared/touch-panel'
import type {
  StreamingTouchActionResponse,
  StreamingTouchHealthResponse,
  StreamingTouchInteractionSession,
  StreamingTouchPanelPayload
} from '../../../shared/streaming'
import type { TouchActionResult, TouchControlActionEvent } from './ButtonBoxRenderer'
import { streamEndpoint } from '../stream/urls'

let streamInteraction: StreamingTouchInteractionSession | null = null
let streamActionQueue: Promise<void> = Promise.resolve()

export class StreamInteractionRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'StreamInteractionRequestError'
  }
}

export function isBrowserStreamRuntime(): boolean {
  return typeof window.ipc?.invoke !== 'function'
}

function isStreamPanelPayload(value: unknown): value is StreamingTouchPanelPayload {
  if (!value || typeof value !== 'object') return false
  const payload = value as Partial<StreamingTouchPanelPayload>
  return Boolean(
    payload.panel &&
    payload.interaction?.interactive === true &&
    payload.interaction.role === 'touch-controller' &&
    payload.interaction.targetId === payload.panel.id &&
    typeof payload.interaction.csrfToken === 'string' &&
    typeof payload.interaction.nonce === 'string' &&
    typeof payload.interaction.leaseExpiresAt === 'number' &&
    Array.isArray(payload.interaction.capabilities)
  )
}

export function activateStreamInteraction(interaction: StreamingTouchInteractionSession): void {
  streamInteraction = interaction
  streamActionQueue = Promise.resolve()
}

export function clearStreamInteraction(panelId?: string): void {
  if (panelId && streamInteraction?.targetId !== panelId) return
  streamInteraction = null
  streamActionQueue = Promise.resolve()
}

export async function fetchStreamPanel(
  panelId: string,
  options: { activate?: boolean } = {}
): Promise<StreamingTouchPanelPayload> {
  const url = streamEndpoint(`api/touch/panel/${encodeURIComponent(panelId)}`)
  const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin' })
  if (!response.ok) throw new StreamInteractionRequestError(`Panel load failed (HTTP ${response.status}).`, response.status)
  const payload = await response.json() as unknown
  if (!isStreamPanelPayload(payload)) throw new Error('Panel interaction session is invalid.')
  if (options.activate !== false) activateStreamInteraction(payload.interaction)
  return payload
}

export async function fetchStreamInteractionHealth(panelId: string): Promise<StreamingTouchHealthResponse> {
  const interaction = streamInteraction
  if (!interaction || interaction.targetId !== panelId) {
    throw new Error('Interactive Touch session is unavailable.')
  }
  const response = await fetch(streamEndpoint(`api/touch/health/${encodeURIComponent(panelId)}`), {
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { 'X-Stream-CSRF': interaction.csrfToken }
  })
  if (!response.ok) {
    throw new StreamInteractionRequestError(`Interaction health failed (HTTP ${response.status}).`, response.status)
  }
  const health = await response.json() as StreamingTouchHealthResponse
  interaction.health = health.health
  interaction.expiresAt = health.expiresAt
  interaction.leaseExpiresAt = health.leaseExpiresAt
  interaction.activeControls = health.activeControls
  interaction.lastFeedback = health.lastFeedback
  return health
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
    const interaction = streamInteraction
    if (!interaction) throw new Error('Interactive Touch session is unavailable.')
    const capability = interaction.capabilities.find((candidate) =>
      candidate.controlId === event.button.id &&
      candidate.zone === event.zone &&
      candidate.phases.includes(event.phase)
    )
    if (!capability) {
      return { ok: false, message: 'This Touch control is not allowed for remote interaction.' }
    }

    const run = async (): Promise<TouchActionResult> => {
      const response = await fetch(
        streamEndpoint(`api/touch/action/${encodeURIComponent(interaction.targetId)}`),
        {
          method: 'POST',
          cache: 'no-store',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'X-Stream-CSRF': interaction.csrfToken
          },
          body: JSON.stringify({
            targetId: interaction.targetId,
            capabilityId: capability.id,
            phase: event.phase,
            nonce: interaction.nonce
          })
        }
      )
      const payload = await response.json().catch(() => null) as StreamingTouchActionResponse | null
      if (payload?.nextNonce) interaction.nonce = payload.nextNonce
      if (typeof payload?.leaseExpiresAt === 'number') {
        interaction.leaseExpiresAt = payload.leaseExpiresAt
      }
      if (!response.ok || !payload?.ok) {
        interaction.health = 'degraded'
        throw new Error(payload?.message ?? `Touch action failed (HTTP ${response.status}).`)
      }
      interaction.health = payload.health
      interaction.activeControls = payload.activeControls
      interaction.lastFeedback = payload.message
      return { ok: true, message: payload.message }
    }
    const result = streamActionQueue.then(run, run)
    streamActionQueue = result.then(() => undefined, () => undefined)
    return result
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
