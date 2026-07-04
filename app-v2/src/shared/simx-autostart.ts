import type { PortInfo } from './ipc'

// Pick the best SIM-X serial port to auto-connect on startup.
//
// Priority:
//   1. The last successfully-connected SIM-X port, if it is still present — even if
//      its `isSimX` heuristic is false. The SIM-X firmware doesn't customise its USB
//      descriptors, so a perfectly good device can report isSimX=false; the fact that
//      the user connected it there before is the strongest signal.
//   2. Otherwise the first port flagged `isSimX` by the friendly-name/VID heuristic.
//
// Returns the chosen path, or null when there is no candidate yet (the caller keeps
// retrying in the background as ports come and go). Pure + deterministic for testing.
export function resolveSimXPort(ports: PortInfo[], lastPort: string | null | undefined): string | null {
  if (!Array.isArray(ports) || ports.length === 0) return null
  if (lastPort) {
    // The remembered port is the STRONGEST signal — the user actually connected the
    // SIM-X there. We prefer it over the `isSimX` heuristic even when the heuristic is
    // false, because that heuristic matches ANY Leonardo/Pro-Micro-class board (a maker
    // rig often has several), so trusting it over the real last-used port would mis-pick
    // a different Arduino. Tradeoff: if Windows reassigned the old path to another device
    // we'd connect there; that's rarer than the multi-board mis-pick, and a wrong device
    // simply ignores the SIM-X protocol.
    const previous = ports.find((port) => port.path === lastPort)
    if (previous) return previous.path
  }
  const detected = ports.find((port) => port.isSimX === true)
  return detected ? detected.path : null
}
