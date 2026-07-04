import { useRef, useSyncExternalStore } from 'react'
import type { TelemetrySnapshot, TelemetrySource, TelemetryStatus, IRacingDiagnostics } from '../../../shared/telemetry'

type TelemetrySelector<T> = (snapshot: TelemetrySnapshot | null) => T
type TelemetryEquality<T> = (left: T, right: T) => boolean
type TelemetryPatch = Partial<TelemetrySnapshot> | null

// Helpers tipados sobre window.ipc para os consumidores de telemetria no renderer.
export function onTelemetry(callback: (snapshot: TelemetrySnapshot | null) => void): () => void {
  return window.ipc.subscribe<TelemetrySnapshot | null>('telemetry:snapshot', callback)
}

export function getIRacingDiagnostics(): Promise<IRacingDiagnostics> {
  return window.ipc.invoke<IRacingDiagnostics>('telemetry:iracingDiagnostics')
}

export function getTelemetryStatus(): Promise<TelemetryStatus> {
  return window.ipc.invoke<TelemetryStatus>('telemetry:status')
}

export function getLatestTelemetry(): Promise<TelemetrySnapshot | null> {
  return window.ipc.invoke<TelemetrySnapshot | null>('telemetry:getLatest')
}

export function setTelemetrySource(source: TelemetrySource): Promise<TelemetryStatus> {
  return window.ipc.invoke<TelemetryStatus>('telemetry:setSource', source)
}

let telemetryStoreStarted = false
let telemetrySnapshot: TelemetrySnapshot | null = null
let telemetryNotifyRaf: number | null = null
const telemetryListeners = new Set<() => void>()
const telemetryUnsubscribe: Array<() => void> = []

export function getTelemetryStoreSnapshot(): TelemetrySnapshot | null {
  return telemetrySnapshot
}

export function subscribeTelemetryStore(listener: () => void): () => void {
  startTelemetryStore()
  telemetryListeners.add(listener)
  return () => {
    telemetryListeners.delete(listener)
    if (telemetryListeners.size === 0) stopTelemetryStore()
  }
}

export function useTelemetrySelector<T>(
  selector: TelemetrySelector<T>,
  equality: TelemetryEquality<T> = Object.is
): T {
  const selectorRef = useRef(selector)
  const equalityRef = useRef(equality)
  selectorRef.current = selector
  equalityRef.current = equality
  const cacheRef = useRef<{ has: boolean; value: T }>({ has: false, value: undefined as unknown as T })

  // useSyncExternalStore-driven: getSnapshot caches by the provided equality so that
  // object/array selectors stay referentially stable across renders (avoids the classic
  // inline-selector + Object.is infinite-render loop). Refs are refreshed each render so
  // the latest selector/equality are always used.
  const getSnapshot = (): T => {
    const next = selectorRef.current(telemetrySnapshot)
    if (cacheRef.current.has && equalityRef.current(cacheRef.current.value, next)) {
      return cacheRef.current.value
    }
    cacheRef.current = { has: true, value: next }
    return next
  }

  return useSyncExternalStore(subscribeTelemetryStore, getSnapshot, getSnapshot)
}

function startTelemetryStore(): void {
  if (telemetryStoreStarted) return
  telemetryStoreStarted = true
  void window.ipc.invoke<number>('telemetry:tiersSubscribe').catch(() => undefined)
  telemetryUnsubscribe.push(
    window.ipc.subscribe<TelemetrySnapshot | null>('telemetry:snapshot', applyTelemetrySnapshot),
    window.ipc.subscribe<TelemetryPatch>('telemetry:fast', mergeTelemetryPatch),
    window.ipc.subscribe<TelemetryPatch>('telemetry:race', mergeTelemetryPatch),
    window.ipc.subscribe<TelemetryPatch>('telemetry:drivers', mergeTelemetryPatch),
    window.ipc.subscribe<TelemetryPatch>('telemetry:session', mergeTelemetryPatch),
    () => {
      void window.ipc.invoke<number>('telemetry:tiersUnsubscribe').catch(() => undefined)
    }
  )
  void window.ipc
    .invoke<TelemetrySnapshot | null>('telemetry:getLatest')
    .then(applyTelemetrySnapshot)
    .catch(() => applyTelemetrySnapshot(null))
}

function stopTelemetryStore(): void {
  if (!telemetryStoreStarted) return
  telemetryStoreStarted = false
  while (telemetryUnsubscribe.length > 0) telemetryUnsubscribe.pop()?.()
  if (telemetryNotifyRaf !== null) {
    window.cancelAnimationFrame(telemetryNotifyRaf)
    telemetryNotifyRaf = null
  }
}

function applyTelemetrySnapshot(snapshot: TelemetrySnapshot | null): void {
  telemetrySnapshot = snapshot
  scheduleTelemetryNotify()
}

function mergeTelemetryPatch(patch: TelemetryPatch): void {
  if (!patch) {
    telemetrySnapshot = null
    scheduleTelemetryNotify()
    return
  }
  if (telemetrySnapshot) {
    telemetrySnapshot = { ...telemetrySnapshot, ...patch }
  } else if (hasSnapshotBase(patch)) {
    telemetrySnapshot = patch
  } else {
    return
  }
  scheduleTelemetryNotify()
}

function hasSnapshotBase(patch: Partial<TelemetrySnapshot>): patch is TelemetrySnapshot {
  return (
    typeof patch.sim === 'string' &&
    typeof patch.connected === 'boolean' &&
    typeof patch.timestamp === 'number' &&
    typeof patch.speedKmh === 'number' &&
    typeof patch.rpm === 'number' &&
    typeof patch.gear === 'number' &&
    typeof patch.throttle === 'number' &&
    typeof patch.brake === 'number' &&
    typeof patch.clutch === 'number'
  )
}

function scheduleTelemetryNotify(): void {
  if (telemetryNotifyRaf !== null) return
  telemetryNotifyRaf = window.requestAnimationFrame(() => {
    telemetryNotifyRaf = null
    for (const listener of telemetryListeners) listener()
  })
}
