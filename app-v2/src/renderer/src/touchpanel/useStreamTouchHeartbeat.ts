import { useEffect, useRef } from 'react'
import type {
  StreamingTouchHealthResponse,
  StreamingTouchInteractionSession
} from '../../../shared/streaming'
import {
  fetchStreamInteractionHealth,
  StreamInteractionRequestError
} from './runtime'

export const STREAM_TOUCH_HEARTBEAT_MS = 10_000
export const STREAM_TOUCH_HEARTBEAT_TIMEOUT_MS = 5_000

export interface StreamTouchHeartbeatOptions {
  enabled: boolean
  panelId: string | null
  interaction: StreamingTouchInteractionSession | null
  onHealth: (health: StreamingTouchHealthResponse) => void
  onFailure: (error: unknown) => void
  onAuthLoss: () => void
}

export function useStreamTouchHeartbeat(options: StreamTouchHeartbeatOptions): void {
  const callbacks = useRef({
    onHealth: options.onHealth,
    onFailure: options.onFailure,
    onAuthLoss: options.onAuthLoss
  })
  callbacks.current = {
    onHealth: options.onHealth,
    onFailure: options.onFailure,
    onAuthLoss: options.onAuthLoss
  }

  useEffect(() => {
    const panelId = options.panelId
    if (!options.enabled || !panelId || !options.interaction) return
    let disposed = false
    let revoked = false
    let generation = 0
    let timer: ReturnType<typeof setInterval> | null = null
    let activeRequest: {
      generation: number
      controller: AbortController
      timeout: ReturnType<typeof setTimeout> | null
    } | null = null

    const stopLoop = (): void => {
      if (timer) clearInterval(timer)
      timer = null
    }
    const online = (): boolean => typeof navigator === 'undefined' || navigator.onLine !== false
    const invalidateRequest = (): void => {
      generation += 1
      const request = activeRequest
      activeRequest = null
      if (request) {
        if (request.timeout) clearTimeout(request.timeout)
        request.controller.abort()
      }
    }
    const requestIsCurrent = (request: NonNullable<typeof activeRequest>): boolean => (
      !disposed &&
      !revoked &&
      online() &&
      activeRequest === request &&
      request.generation === generation
    )
    const heartbeat = async (): Promise<void> => {
      if (disposed || revoked || activeRequest || !online()) return
      const controller = new AbortController()
      const request = {
        generation,
        controller,
        timeout: null as ReturnType<typeof setTimeout> | null
      }
      request.timeout = setTimeout(() => {
        if (activeRequest !== request || request.generation !== generation) return
        invalidateRequest()
        callbacks.current.onFailure(new Error('Touch receiver heartbeat timed out.'))
      }, STREAM_TOUCH_HEARTBEAT_TIMEOUT_MS)
      activeRequest = request
      try {
        const health = await fetchStreamInteractionHealth(panelId, { signal: controller.signal })
        if (!requestIsCurrent(request)) return
        if (request.timeout) clearTimeout(request.timeout)
        activeRequest = null
        callbacks.current.onHealth(health)
      } catch (error) {
        if (!requestIsCurrent(request)) return
        if (request.timeout) clearTimeout(request.timeout)
        activeRequest = null
        if (error instanceof DOMException && error.name === 'AbortError') return
        callbacks.current.onFailure(error)
        if (
          error instanceof StreamInteractionRequestError &&
          (error.status === 401 || error.status === 403)
        ) {
          revoked = true
          generation += 1
          stopLoop()
          callbacks.current.onAuthLoss()
        }
      }
    }
    const startLoop = (): void => {
      if (disposed || revoked || timer || !online()) return
      void heartbeat()
      timer = setInterval(() => void heartbeat(), STREAM_TOUCH_HEARTBEAT_MS)
    }
    const handleOffline = (): void => {
      stopLoop()
      invalidateRequest()
      callbacks.current.onFailure(new Error('Touch receiver is offline.'))
    }
    const handleOnline = (): void => startLoop()

    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)
    startLoop()
    return () => {
      disposed = true
      stopLoop()
      invalidateRequest()
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
    }
  }, [
    options.enabled,
    options.panelId,
    options.interaction?.csrfToken
  ])
}
