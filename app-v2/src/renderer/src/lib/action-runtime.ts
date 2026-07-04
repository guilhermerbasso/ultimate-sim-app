import { useEffect, useRef } from 'react'
import type { ActionBinding, HidButtonControl } from '../../../shared/actions'
import {
  decideFlipCoverPulse,
  engineRunningProxy,
  FLIP_COVER_DEFAULTS,
  INITIAL_FLIP_COVER_STATE,
  type FlipCoverState
} from '../../../shared/flip-cover'
import { readButtonPressed } from './gamepad'
import { getTelemetryStoreSnapshot, subscribeTelemetryStore } from './telemetry'

interface DashboardActivateRequest {
  dashboardId?: unknown
  dashboardName?: unknown
}

export type ActionRuntimeToast = (message: string, tone?: 'success' | 'error' | 'info') => void

let suppressed = false

export function setActionRuntimeSuppressed(value: boolean): void {
  suppressed = value
}

/** Read the global action-runtime suppression flag (set during binding capture). */
export function isActionRuntimeSuppressed(): boolean {
  return suppressed
}

async function dispatchBinding(binding: ActionBinding): Promise<void> {
  if (binding.action.type === 'app') {
    const command = binding.action.command
    switch (command.name) {
      case 'oled:setActivePage':
        await window.ipc.invoke('oled:setActivePage', command.pageIndex ?? 0)
        return
      case 'overlays:toggle':
        await window.ipc.invoke('overlays:toggle', command.overlayId ?? 'relative')
        return
      case 'dash:cycleNext':
        await window.ipc.invoke('app:dash:cycle', 'next')
        return
      case 'dash:cyclePrev':
        await window.ipc.invoke('app:dash:cycle', 'prev')
        return
      default: {
        const exhaustiveCheck: never = command.name
        void exhaustiveCheck
        return
      }
    }
  }

  await window.ipc.invoke('actions:trigger', binding.id)
}

function fireBinding(binding: ActionBinding): void {
  void dispatchBinding(binding).catch((error) => console.warn('[actions] Failed to dispatch global binding.', error))
}

export function useGlobalActionRuntime(showToast?: ActionRuntimeToast): void {
  const showToastRef = useRef<ActionRuntimeToast | undefined>(showToast)
  showToastRef.current = showToast

  useEffect(() => {
    let cancelled = false
    let frame = 0
    let pollTimer = 0
    let bindings: ActionBinding[] = []
    const state = new Map<string, boolean>()
    // Encoder detent counters: rising edges seen since the last fire, per binding.
    const detentCounters = new Map<string, number>()
    // Flip-cover reconcile bookkeeping, per binding.
    const flipState = new Map<string, FlipCoverState>()
    // Keep the telemetry store warm so getTelemetryStoreSnapshot() stays fresh for the
    // flip-cover engine-running proxy (the store only updates while it has a subscriber).
    const offTelemetry = subscribeTelemetryStore(() => {})

    const offDashboardActivate = window.ipc.subscribe('app:dash:activateRequest', (payload) => {
      const request = payload as DashboardActivateRequest | undefined
      if (typeof request?.dashboardId !== 'string' || !request.dashboardId) return
      const dashboardLabel =
        typeof request.dashboardName === 'string' && request.dashboardName
          ? request.dashboardName
          : request.dashboardId
      void window.ipc.invoke('app:dash:activate', request.dashboardId).catch((error) => {
        console.warn('[actions] Failed to activate dashboard from expression output.', error)
        // Surface the failure: a deleted/unknown dashboard id would otherwise
        // make the expression "switch dashboard" silently do nothing.
        showToastRef.current?.(
          `Não foi possível trocar para o dashboard “${dashboardLabel}”. Verifique se ele ainda existe.`,
          'error'
        )
      })
    })

    const loadBindings = async (): Promise<void> => {
      try {
        const loaded = await window.ipc.invoke<ActionBinding[]>('actions:getBindings')
        if (!cancelled) bindings = loaded
      } catch (error) {
        console.warn('[actions] Failed to load global bindings.', error)
      }
    }

    // Encoder detent gate: returns true once every `stepsPerDetent` rising edges.
    const passesDetent = (key: string, control: HidButtonControl): boolean => {
      const steps = Math.max(1, Math.round(control.stepsPerDetent ?? 1))
      if (steps <= 1) return true
      const next = (detentCounters.get(key) ?? 0) + 1
      if (next >= steps) {
        detentCounters.set(key, 0)
        return true
      }
      detentCounters.set(key, next)
      return false
    }

    // Flip-cover ignition sync. Pulses the bound virtual ignition button once per genuine
    // transition (a physical flip, or a real engine-state change) to reconcile the cover
    // position with the engine-running proxy — latched so a persistent mismatch never
    // re-pulses, and startup-suppressed so joining a session never auto-corrects.
    const handleFlipCover = (binding: ActionBinding, key: string, pressed: boolean): void => {
      const cfg = binding.control.flipCover ?? {}
      const settings = {
        engineRpmThreshold: cfg.engineRpmThreshold ?? FLIP_COVER_DEFAULTS.engineRpmThreshold,
        reconcileDebounceMs: cfg.reconcileDebounceMs ?? FLIP_COVER_DEFAULTS.reconcileDebounceMs,
        invertCover: cfg.invertCover ?? FLIP_COVER_DEFAULTS.invertCover
      }
      const now = performance.now()
      const state = flipState.get(key) ?? INITIAL_FLIP_COVER_STATE
      const engineRunning = engineRunningProxy(getTelemetryStoreSnapshot(), settings.engineRpmThreshold)

      const decision = decideFlipCoverPulse({ pressed, engineRunning, now, settings, state })

      if (decision.pulse) fireBinding(binding)
      flipState.set(key, decision.state)
    }

    const tick = (): void => {
      for (const binding of bindings) {
        if (!binding.enabled) continue
        const control = binding.control
        const key = `${binding.id}:${control.gamepadIndex ?? 'any'}:${control.buttonIndex}`
        const pressed = readButtonPressed(control.gamepadIndex, control.buttonIndex, control.gamepadId)
        const wasPressed = state.get(key) ?? false
        state.set(key, pressed)

        const switchType = control.switchType ?? 'momentary'

        if (switchType === 'flip-cover') {
          if (!suppressed) handleFlipCover(binding, key, pressed)
          continue
        }

        if (switchType === 'pulse-both-edges') {
          // Fire one pulse on every position change (rising AND falling edge).
          if (pressed !== wasPressed && !suppressed && passesDetent(key, control)) fireBinding(binding)
          continue
        }

        // 'momentary' / 'toggle': fire on the rising edge only.
        if (pressed && !wasPressed && !suppressed && passesDetent(key, control)) fireBinding(binding)
      }
      frame = window.requestAnimationFrame(tick)
    }

    void loadBindings()
    pollTimer = window.setInterval(() => void loadBindings(), 3000)
    frame = window.requestAnimationFrame(tick)

    return () => {
      cancelled = true
      offDashboardActivate()
      offTelemetry()
      window.clearInterval(pollTimer)
      window.cancelAnimationFrame(frame)
    }
  }, [])
}
