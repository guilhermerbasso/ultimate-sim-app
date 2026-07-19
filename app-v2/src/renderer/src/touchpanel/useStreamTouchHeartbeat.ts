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
    let inFlight = false
    let timer: ReturnType<typeof setInterval> | null = null

    const stopLoop = (): void => {
      if (timer) clearInterval(timer)
      timer = null
    }
    const online = (): boolean => typeof navigator === 'undefined' || navigator.onLine !== false
    const heartbeat = async (): Promise<void> => {
      if (disposed || inFlight || !online()) return
      inFlight = true
      try {
        const health = await fetchStreamInteractionHealth(panelId)
        if (!disposed) callbacks.current.onHealth(health)
      } catch (error) {
        if (disposed) return
        callbacks.current.onFailure(error)
        if (
          error instanceof StreamInteractionRequestError &&
          (error.status === 401 || error.status === 403)
        ) {
          revoked = true
          stopLoop()
          callbacks.current.onAuthLoss()
        }
      } finally {
        inFlight = false
      }
    }
    const startLoop = (): void => {
      if (disposed || revoked || timer || !online()) return
      void heartbeat()
      timer = setInterval(() => void heartbeat(), STREAM_TOUCH_HEARTBEAT_MS)
    }
    const handleOffline = (): void => {
      stopLoop()
      callbacks.current.onFailure(new Error('Touch receiver is offline.'))
    }
    const handleOnline = (): void => startLoop()

    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)
    startLoop()
    return () => {
      disposed = true
      stopLoop()
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
    }
  }, [
    options.enabled,
    options.panelId,
    options.interaction?.csrfToken
  ])
}
