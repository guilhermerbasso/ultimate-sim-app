import type { TelemetrySnapshot } from './telemetry'
import { sessionKindForSnapshot } from './telemetry'
import { coachComparableIdentityFromSnapshot, type CoachTrackCondition } from './coach-racecraft'

// Canonical Coach/Engineer session key.
//
// §24-17 requires ALL Coach context to be dropped on any change of track, track
// configuration, car, session or condition. Nothing may survive such a change: a corner
// map learned at Spa is meaningless at Monza, a reference lap set in a GT3 is
// meaningless in a GT4, and a dry reference is meaningless once the track is wet.
//
// The replay session identity is NOT sufficient on its own. For iRacing it is
// `SessionID:SubSessionID:SessionUniqueID:SessionNum` (see `replaySessionIdentity` in
// src/main/iracing/provider.ts), which carries no track, no car and no condition — so a
// car change inside a session, or a track drying out, would not invalidate anything.
//
// This is the single key shared by the Live Coach and the proactive Engineer so the two
// can never disagree about when context becomes stale.

export type CoachSessionKeyOptions = {
  /**
   * Replay/session identity from the provider, when available. Included verbatim so a
   * new session on the same track in the same car still resets.
   */
  sessionIdentity?: string
  /**
   * Pre-stabilised condition. Callers that debounce wet/dry transitions pass their own
   * value so the key does not flicker while the track is drying.
   */
  condition?: CoachTrackCondition
  /** Previous wetness reading, used to distinguish "drying" from "intermediate". */
  previousTrackWetnessPct?: number
}

/** Lower-cased, whitespace-collapsed identity segment. Absent and empty are the same. */
export function normalizedIdentityPart(value: string | undefined | null): string {
  if (typeof value !== 'string') return ''
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Build the canonical key. Every component is something that, when it changes, makes
 * previously learned Coach context invalid.
 */
export function coachSessionKey(
  snapshot: TelemetrySnapshot | null | undefined,
  options: CoachSessionKeyOptions = {}
): string {
  const parts = coachSessionKeyParts(snapshot, options)
  if (!parts) return ''
  return `${parts.stable}::${parts.condition}`
}

/**
 * The key split into its DISCRETE half and its MEASURED half.
 *
 * Track, layout, car, class, session type and session id are discrete facts: when one
 * changes, it really changed. Track condition is a continuous measurement classified
 * into bands, so it can flicker around a threshold — which is why the tracker confirms
 * it over several frames instead of wiping the corner map on a single noisy sample.
 */
export function coachSessionKeyParts(
  snapshot: TelemetrySnapshot | null | undefined,
  options: CoachSessionKeyOptions = {}
): { stable: string; condition: string } | null {
  if (!snapshot) return null
  const identity = coachComparableIdentityFromSnapshot(snapshot, options.previousTrackWetnessPct)
  return {
    stable: [
      normalizedIdentityPart(snapshot.sim),
      normalizedIdentityPart(identity.trackId === undefined ? undefined : String(identity.trackId)),
      normalizedIdentityPart(identity.trackName),
      normalizedIdentityPart(identity.trackConfigName),
      normalizedIdentityPart(identity.carPath || identity.carName),
      Number.isFinite(identity.carClassId) ? String(identity.carClassId) : '',
      sessionKindForSnapshot(snapshot),
      normalizedIdentityPart(options.sessionIdentity),
      snapshot.sessionUniqueId === undefined ? '' : String(snapshot.sessionUniqueId)
    ].join('::'),
    condition: String(options.condition ?? identity.condition)
  }
}

/** Frames a NEW track condition must hold before it is accepted as a real transition. */
export const CONDITION_CONFIRM_FRAMES = 30

/**
 * Tracks the key across snapshots. `observe` reports whether the context must be reset.
 *
 * The FIRST observed key is never reported as a change: there is no previous context to
 * invalidate, and treating it as one would discard the session the user just joined.
 *
 * A discrete change (track/layout/car/class/session) resets immediately. A condition
 * change must hold for `confirmFrames` consecutive snapshots first, so wetness hovering
 * around a band threshold cannot repeatedly wipe a learned corner map.
 */
export class CoachSessionKeyTracker {
  private stable: string | null = null
  private condition: string | null = null
  private pendingCondition: string | null = null
  private pendingCount = 0
  private readonly confirmFrames: number

  constructor(options: { confirmFrames?: number } = {}) {
    this.confirmFrames = Math.max(1, Math.trunc(options.confirmFrames ?? CONDITION_CONFIRM_FRAMES))
  }

  /** True when the caller must drop every piece of Coach context it holds. */
  observe(snapshot: TelemetrySnapshot | null | undefined, options: CoachSessionKeyOptions = {}): boolean {
    // A null snapshot means "disconnected": keep the key so reconnecting to the SAME
    // session does not needlessly throw away a learned corner map.
    if (!snapshot) return false
    const parts = coachSessionKeyParts(snapshot, options)
    if (!parts) return false

    const first = this.stable === null
    const stableChanged = !first && this.stable !== parts.stable
    if (first || stableChanged) {
      this.stable = parts.stable
      this.condition = parts.condition
      this.pendingCondition = null
      this.pendingCount = 0
      return stableChanged
    }

    if (parts.condition === this.condition) {
      this.pendingCondition = null
      this.pendingCount = 0
      return false
    }

    this.pendingCount = parts.condition === this.pendingCondition ? this.pendingCount + 1 : 1
    this.pendingCondition = parts.condition
    if (this.pendingCount < this.confirmFrames) return false

    this.condition = parts.condition
    this.pendingCondition = null
    this.pendingCount = 0
    return true
  }

  key(): string | null {
    return this.stable === null ? null : `${this.stable}::${this.condition ?? ''}`
  }

  reset(): void {
    this.stable = null
    this.condition = null
    this.pendingCondition = null
    this.pendingCount = 0
  }
}
