// Pure decision logic for the flip-cover ignition sync (Controls → ButtonBox read).
//
// A flip cover is a maintained On/Off switch. iRacing's ignition is a toggle that only
// reacts to the "On" press, so turning the car off normally means flipping Off→On again.
// This module decides when to pulse the bound virtual ignition button so that the cover
// position stays in sync with the car's engine/ignition state:
//   - cover ON  ⇒ engine should be running (ignition on)
//   - cover OFF ⇒ engine should be off
//
// It keeps the file dependency-light (only the telemetry type) so the renderer runtime
// and unit tests can both import it.

import type { TelemetrySnapshot } from './telemetry'

export interface FlipCoverSettings {
  // RPM above which the engine counts as "running" (proxy for ignition on).
  engineRpmThreshold: number
  // Minimum gap between reconcile pulses, in ms (debounce against telemetry lag).
  reconcileDebounceMs: number
  // When true, a PRESSED contact means cover OFF (inverted wiring).
  invertCover: boolean
}

export const FLIP_COVER_DEFAULTS: FlipCoverSettings = {
  engineRpmThreshold: 200,
  reconcileDebounceMs: 1500,
  invertCover: false
}

// Engine-running proxy. iRacing exposes no reliable ignition var, so we prefer an explicit
// `engineRunning` field when a provider supplies one and otherwise fall back to rpm above a
// small threshold. Returns null when telemetry is disconnected (engine state unknown).
export function engineRunningProxy(
  snapshot: Pick<TelemetrySnapshot, 'connected' | 'rpm' | 'engineRunning'> | null,
  rpmThreshold: number
): boolean | null {
  if (!snapshot || !snapshot.connected) return null
  if (typeof snapshot.engineRunning === 'boolean') return snapshot.engineRunning
  if (typeof snapshot.rpm === 'number') return snapshot.rpm > rpmThreshold
  return null
}

export type FlipCoverPulseReason = 'idle' | 'edge-fallback' | 'reconcile'

// Per-binding memory carried between ticks. `cover`/`engine` are the LAST observed
// positions (null = not yet seen this session); `lastPulseAt` backs the debounce floor.
// Tracking the previous positions is what lets us pulse only on genuine transitions
// (latching) instead of re-pulsing a steady mismatch.
export interface FlipCoverState {
  cover: boolean | null
  engine: boolean | null
  lastPulseAt: number
}

export const INITIAL_FLIP_COVER_STATE: FlipCoverState = {
  cover: null,
  engine: null,
  lastPulseAt: Number.NEGATIVE_INFINITY
}

export interface FlipCoverDecisionInput {
  pressed: boolean
  engineRunning: boolean | null
  now: number
  settings: FlipCoverSettings
  state: FlipCoverState
}

export interface FlipCoverDecision {
  pulse: boolean
  reason: FlipCoverPulseReason
  // The state to carry into the next tick.
  state: FlipCoverState
}

// Decides whether to emit a single momentary ignition pulse this tick.
//
// Because the bound output is a TOGGLE, we must pulse at most once per state change —
// never on a persistent mismatch (which would oscillate the ignition on/off forever).
// The rules:
//
//  - Telemetry/engine state UNKNOWN (null): degrade to a pure both-edge pulse so one
//    physical flip still produces exactly one ignition toggle (offline behaviour).
//  - Telemetry KNOWN: reconcile ONLY on a genuine transition and only when the cover
//    and engine now disagree:
//      · a COVER flip is deliberate user intent — always honoured immediately;
//      · an ENGINE-only change (stall / spin-down / rpm jitter) is rate-limited by the
//        debounce floor so a signal flapping around the threshold can't pulse-storm.
//    A steady mismatch with no new transition is left alone (latched), so a kill-in-gear
//    / stall / slow spin-down can't trigger a re-pulse storm.
//  - STARTUP suppression: the first observation of either signal (previous value null)
//    is recorded WITHOUT pulsing, so joining a running session with the cover OFF never
//    auto-kills an engine the user didn't touch.
export function decideFlipCoverPulse(input: FlipCoverDecisionInput): FlipCoverDecision {
  const { settings, state } = input
  const coverOn = settings.invertCover ? !input.pressed : input.pressed
  const coverEdge = state.cover !== null && coverOn !== state.cover

  if (input.engineRunning === null) {
    // Engine state unknown — one flip = one toggle, no debounce (offline use).
    const next: FlipCoverState = { cover: coverOn, engine: null, lastPulseAt: state.lastPulseAt }
    if (coverEdge) return { pulse: true, reason: 'edge-fallback', state: { ...next, lastPulseAt: input.now } }
    return { pulse: false, reason: 'idle', state: next }
  }

  const engineEdge = state.engine !== null && input.engineRunning !== state.engine
  const mismatch = coverOn !== input.engineRunning
  const next: FlipCoverState = { cover: coverOn, engine: input.engineRunning, lastPulseAt: state.lastPulseAt }

  if (mismatch) {
    // A deliberate cover flip is always honoured. An engine-only transition is
    // rate-limited so rpm jitter around the threshold can't pulse-storm.
    if (coverEdge) {
      return { pulse: true, reason: 'reconcile', state: { ...next, lastPulseAt: input.now } }
    }
    if (engineEdge && input.now - state.lastPulseAt >= settings.reconcileDebounceMs) {
      return { pulse: true, reason: 'reconcile', state: { ...next, lastPulseAt: input.now } }
    }
  }
  return { pulse: false, reason: 'idle', state: next }
}
