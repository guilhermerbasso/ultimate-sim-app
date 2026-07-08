// 3D Spotter — GLOBAL renderer runtime (app-wide, view-independent).
//
// Mounted ONCE at the app root (App.tsx, next to useSpotterRuntime /
// useSoundshiftRuntime / useHapticsRuntime) so the spatial spotter runs for the
// whole session — any view open, or none. It owns a SINGLE long-lived
// Spotter3DEngine + AudioContext for the app lifetime (never per-view), feeds it
// the live telemetry stream, and respects the (default-enabled) config live.
//
// AUTOPLAY UNLOCK: Chromium starts every AudioContext suspended until a user
// gesture. Instead of a dedicated "Ativar áudio" button, we install ONE app-wide
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

// ─── Module singletons (one engine + config for the whole app) ────────────────

let engine: Spotter3DEngine | null = null
let currentConfig: Spotter3DConfig = DEFAULT_SPOTTER_3D_CONFIG

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

// ─── App-wide gesture unlock (install once) ───────────────────────────────────

const GESTURE_EVENTS: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'touchstart']
let gestureArmed = false

function refreshUnlockedFlag(): void {
  publishStatus({ unlocked: getSpotter3DEngine().isUnlocked() })
}

function handleGesture(): void {
  const eng = getSpotter3DEngine()
  void eng.resume().then(() => {
    refreshUnlockedFlag()
    if (eng.isUnlocked()) removeGestureListeners()
  })
}

function installGestureListeners(): void {
  if (gestureArmed || typeof window === 'undefined') return
  gestureArmed = true
  for (const type of GESTURE_EVENTS) {
    window.addEventListener(type, handleGesture, { passive: true })
  }
}

function removeGestureListeners(): void {
  if (!gestureArmed || typeof window === 'undefined') return
  gestureArmed = false
  for (const type of GESTURE_EVENTS) {
    window.removeEventListener(type, handleGesture)
  }
}

// Apply config to the engine and start/stop it to match `enabled`.
function applyConfig(config: Spotter3DConfig): void {
  currentConfig = config
  const eng = getSpotter3DEngine()
  eng.setConfig(config)
  if (config.enabled) {
    eng.start()
  } else {
    eng.stop()
  }
  publishStatus({ enabled: config.enabled, running: config.enabled && eng.isRunning(), unlocked: eng.isUnlocked() })
}

// ─── Ref-counted subscriptions (telemetry + config) ───────────────────────────

let subscriberCount = 0
let offConfig: (() => void) | null = null
let offTelemetry: (() => void) | null = null

function startSubscriptions(): void {
  installGestureListeners()

  void window.ipc
    .invoke<Spotter3DConfig>(SPOTTER_3D_CHANNELS.getConfig)
    .then((config) => applyConfig(config))
    .catch(() => {
      // No saved config yet — run on the default-enabled config so audio is live.
      applyConfig(DEFAULT_SPOTTER_3D_CONFIG)
    })

  offConfig = window.ipc.subscribe<Spotter3DConfig>(SPOTTER_3D_CHANNELS.configEvent, (config) => {
    applyConfig(config)
  })

  offTelemetry = window.ipc.subscribe<TelemetrySnapshot | null>('telemetry:snapshot', (snapshot) => {
    // Never throw in the telemetry path: if there is no snapshot / no nearby
    // cars the engine yesply stays silent. update() is a no-op while stopped.
    try {
      getSpotter3DEngine().update(snapshot)
    } catch {
      // Audio runtime hiccup must not break telemetry delivery.
    }
  })
}

function stopSubscriptions(): void {
  offConfig?.()
  offTelemetry?.()
  offConfig = null
  offTelemetry = null
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
        engine?.dispose()
        engine = null
        publishStatus({ running: false, unlocked: false })
      }
    }
  }, [])
}
