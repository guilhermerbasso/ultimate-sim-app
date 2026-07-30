// Edge detection for physical controls bound to actions.
//
// P1-10: the runtimes used `state.get(key) ?? false` as "previous", which makes
// a control that is ALREADY HELD when the runtime mounts (app start, view
// switch, a binding loaded by the 3s poll, a binding re-enabled) look like a
// fresh rising edge â€” so it fires immediately. On a sim rig that can mean the
// pit limiter, ignition or a pit-service command firing the moment the app
// launches, purely because a toggle switch was left in the on position.
//
// The rule here: the FIRST observation of a control only ARMS the detector at
// the level it is actually in, and yields no edge. Real edges start from the
// second sample. Pure and dependency-free so it can be unit tested without a
// DOM, a gamepad or any hardware.

export interface BindingEdgeReading {
  /** Level to persist as "previous" for the next tick. */
  pressed: boolean
  /** True only for a genuine released â†’ pressed transition. */
  rising: boolean
  /** True for any genuine transition (used by `pulse-both-edges`). */
  changed: boolean
  /** True when this control had never been sampled before. Never an edge. */
  armed: boolean
}

/**
 * @param previous the level recorded on the last tick, or `undefined` when this
 *   control has never been sampled. `undefined` and `false` are NOT the same:
 *   collapsing them is exactly the held-at-start bug.
 */
export function observeBindingEdge(previous: boolean | undefined, pressed: boolean): BindingEdgeReading {
  if (previous === undefined) {
    return { pressed, rising: false, changed: false, armed: true }
  }
  return {
    pressed,
    rising: pressed && !previous,
    changed: pressed !== previous,
    armed: false
  }
}
