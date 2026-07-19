import { useEffect, useReducer, useRef } from 'react'
import {
  OverlayTriggerController,
  type OverlayTrigger,
  type OverlayTriggerResult
} from '../../../shared/overlays'
import type { AlertsConfig } from '../../../shared/alerts'
import type { TelemetrySnapshot } from '../../../shared/telemetry'

export function overlayMonotonicNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
}

export function useOverlayTriggerController(
  snapshot: TelemetrySnapshot | null,
  alertsConfig: AlertsConfig
) {
  const controller = useRef<OverlayTriggerController | null>(null)
  if (!controller.current) controller.current = new OverlayTriggerController()
  const [, tick] = useReducer((value: number) => value + 1, 0)
  const now = overlayMonotonicNow()

  useEffect(() => {
    const deadline = controller.current?.nextDeadline(overlayMonotonicNow())
    if (deadline == null) return
    const delay = Math.max(0, deadline - overlayMonotonicNow())
    const timer = window.setTimeout(tick, Math.ceil(delay) + 1)
    return () => window.clearTimeout(timer)
  })

  return {
    controller: controller.current,
    evaluate(key: string, trigger: OverlayTrigger | null | undefined): OverlayTriggerResult {
      return controller.current!.evaluate(key, trigger, snapshot, now, alertsConfig)
    }
  }
}
