// 3D Spotter — GLOBAL renderer runtime (app-wide, view-independent).
//
// Mounted ONCE at the app root (App.tsx, next to useSpotterRuntime /
// useSoundshiftRuntime / useHapticsRuntime) so the spatial spotter runs for the
// whole session — any view open, or none. It owns a SINGLE active
// Spotter3DEngine (never per-view), rebuilds its audio graph at canonical context
// boundaries, feeds it the live telemetry stream, and respects config live.
//
// AUTOPLAY UNLOCK: Chromium starts every AudioContext suspended until a user
// gesture. Instead of a dedicated "Enable áudio" button, we install ONE app-wide
// pointerdown/keydown listener that resumes the context on the user's first
// interaction anywhere. Until then the engine is armed but silent (it never
// throws). A status store lets the view show a gentle "click to unlock" hint.
//
// The pure cue mapping lives in shared/spotter3d.ts; the audio engine in
// lib/spotter-3d.ts. This file only wires lifecycle + the global gesture unlock.

import { useEffect } from 'react'
import type { TelemetrySnapshot } from '../../../shared/telemetry'
import {
  DEFAULT_SPOTTER_3D_CONFIG,
  SPOTTER_3D_CHANNELS,
  Spotter3DEngine,
  type Spotter3DConfig
} from './spotter-3d'
import {
  LiveTelemetryGate,
  type LiveTelemetryState,
  type ReplaySpeechCancelEvent
} from '../../../shared/replay'
import { registerSpeechOwnerCanceller } from './speech-owner-runtime'

// ─── Module singletons (one engine + config for the whole app) ────────────────

let engine: Spotter3DEngine | null = null
let currentConfig: Spotter3DConfig = DEFAULT_SPOTTER_3D_CONFIG
let canonicalState: LiveTelemetryState = 'unknown'

export interface Spotter3DStatus {
  // True once the AudioContext is actually running (sound can be heard).
  unlocked: boolean
  // Live `enabled` config (default true).
  enabled: boolean
  // Engine is armed and driving telemetry cues.
  running: boolean
}

let status: Spotter3DStatus = { unlocked: false, enabled: DEFAULT_SPOTTER_3D_CONFIG.enabled, running: false }
const statusListeners = new Set<(status: Spotter3DStatus) => void>()

function publishStatus(next: Partial<Spotter3DStatus>): void {
  const merged = { ...status, ...next }
  if (merged.unlocked === status.unlocked && merged.enabled === status.enabled && merged.running === status.running) {
    return
  }
  status = merged
  for (const listener of statusListeners) listener(status)
}

// Lazily create/own the single engine. Safe before any gesture: the engine only
// builds the (suspended) AudioContext on first start()/resume().
export function getSpotter3DEngine(): Spotter3DEngine {
  if (!engine) engine = new Spotter3DEngine(currentConfig)
  return engine
}

export function getSpotter3DStatus(): Spotter3DStatus {
  return status
}

export function subscribeSpotter3DStatus(listener: (status: Spotter3DStatus) => void): () => void {
  statusListeners.add(listener)
  listener(status)
  return () => {
    statusListeners.delete(listener)
  }
}

export function stopSpotter3DPlayback(): void {
  removeGestureListeners()
  const active = engine
  engine = null
  if (active) {
    try { active.update(null) } catch { /* best effort cue reset */ }
    try { active.stop() } catch { /* best effort silence */ }
    try { active.dispose() } catch { /* best effort teardown */ }
  }
  publishStatus({ running: false, unlocked: false })
}

// ─── App-wide gesture unlock (install once) ───────────────────────────────────

const GESTURE_EVENTS: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'touchstart']
let gestureArmed = false
let gestureGeneration = 0
let gestureEngine: Spotter3DEngine | null = null
let gestureHandler: (() => void) | null = null

function removeGestureListeners(expectedGeneration?: number): void {
  if (expectedGeneration !== undefined && expectedGeneration !== gestureGeneration) return
  const handler = gestureHandler
  gestureGeneration += 1
  gestureArmed = false
  gestureEngine = null
  gestureHandler = null
  if (!handler || typeof window === 'undefined') return
  for (const type of GESTURE_EVENTS) {
    window.removeEventListener(type, handler)
  }
}

function installGestureListeners(eng: Spotter3DEngine): void {
  if (typeof window === 'undefined') return
  if (gestureArmed && gestureEngine === eng) return
  removeGestureListeners()
  const generation = ++gestureGeneration
  const handler = (): void => {
    if (generation !== gestureGeneration || engine !== eng) return
    void eng.resume().then(() => {
      if (generation !== gestureGeneration || engine !== eng) return
      const unlocked = eng.isUnlocked()
      publishStatus({ unlocked })
      if (unlocked) removeGestureListeners(generation)
    })
  }
  gestureArmed = true
  gestureEngine = eng
  gestureHandler = handler
  for (const type of GESTURE_EVENTS) {
    window.addEventListener(type, handler, { passive: true })
  }
}

function syncGestureUnlock(eng: Spotter3DEngine): void {
  const unlocked = eng.isUnlocked()
  publishStatus({ unlocked })
  if (unlocked) removeGestureListeners()
  else installGestureListeners(eng)
}

// Apply config without arming audio until telemetry is canonically live.
function applyConfig(config: Spotter3DConfig): void {
  currentConfig = config
  if (!config.enabled || canonicalState !== 'live') {
    stopSpotter3DPlayback()
    publishStatus({ enabled: config.enabled })
    return
  }
  const eng = getSpotter3DEngine()
  eng.setConfig(config)
  if (!eng.isRunning()) eng.start()
  publishStatus({ enabled: true, running: eng.isRunning() })
  syncGestureUnlock(eng)
}

// ─── Ref-counted subscriptions (telemetry + config) ───────────────────────────

let subscriberCount = 0
let offConfig: (() => void) | null = null
let offTelemetry: (() => void) | null = null
let offOwnerCancel: (() => void) | null = null
let subscriptionGeneration = 0
let configRevision = 0

function startSubscriptions(): void {
  const generation = ++subscriptionGeneration
  canonicalState = 'unknown'
  removeGestureListeners()
  offOwnerCancel = registerSpeechOwnerCanceller('spotter', (event?: ReplaySpeechCancelEvent) => {
    if (event) canonicalState = event.state
    stopSpotter3DPlayback()
  })

  const loadRevision = configRevision
  void window.ipc
    .invoke<Spotter3DConfig>(SPOTTER_3D_CHANNELS.getConfig)
    .then((config) => {
      if (generation === subscriptionGeneration && loadRevision === configRevision) applyConfig(config)
    })
    .catch(() => {
      if (generation === subscriptionGeneration && loadRevision === configRevision) {
        applyConfig(DEFAULT_SPOTTER_3D_CONFIG)
      }
    })

  offConfig = window.ipc.subscribe<Spotter3DConfig>(SPOTTER_3D_CHANNELS.configEvent, (config) => {
    configRevision += 1
    applyConfig(config)
  })

  const liveGate = new LiveTelemetryGate()
  offTelemetry = window.ipc.subscribe<TelemetrySnapshot | null>('telemetry:snapshot', (snapshot) => {
    const live = liveGate.observe(snapshot)
    canonicalState = live.state
    if (!live.live) {
      if (live.boundary) stopSpotter3DPlayback()
      return
    }
    // Never throw in the telemetry path: if there is no snapshot / no nearby
    // cars the engine simply stays silent. update() is a no-op while stopped.
    try {
      if (live.boundary) stopSpotter3DPlayback()
      if (!currentConfig.enabled) {
        publishStatus({ enabled: false, running: false })
        return
      }
      const eng = getSpotter3DEngine()
      eng.setConfig(currentConfig)
      if (!eng.isRunning()) eng.start()
      eng.update(snapshot)
      publishStatus({ enabled: true, running: eng.isRunning() })
      syncGestureUnlock(eng)
    } catch {
      // Audio runtime hiccup must not break telemetry delivery.
    }
  })
}

function stopSubscriptions(): void {
  subscriptionGeneration += 1
  canonicalState = 'unknown'
  offConfig?.()
  offTelemetry?.()
  offOwnerCancel?.()
  offConfig = null
  offTelemetry = null
  offOwnerCancel = null
}

// Mount ONCE at the app root. Ref-counted so it is safe even if mounted in more
// than one place; the engine + gesture unlock are module singletons.
export function useSpotter3DRuntime(): void {
  useEffect(() => {
    subscriberCount += 1
    if (subscriberCount === 1) startSubscriptions()
    return () => {
      subscriberCount -= 1
      if (subscriberCount === 0) {
        stopSubscriptions()
        removeGestureListeners()
        stopSpotter3DPlayback()
        engine?.dispose()
        engine = null
        publishStatus({ running: false, unlocked: false })
      }
    }
  }, [])
}
