import { describe, expect, it } from 'vitest'
import {
  decideFlipCoverPulse,
  engineRunningProxy,
  FLIP_COVER_DEFAULTS,
  INITIAL_FLIP_COVER_STATE,
  type FlipCoverDecision,
  type FlipCoverSettings,
  type FlipCoverState
} from './flip-cover'

const settings: FlipCoverSettings = { ...FLIP_COVER_DEFAULTS }

// Drives a sequence of ticks through the stateful decision function, carrying state
// forward exactly like the renderer runtime does, and returns every decision.
function run(
  ticks: Array<{ pressed: boolean; engineRunning: boolean | null; now?: number }>,
  override: Partial<FlipCoverSettings> = {},
  initial: FlipCoverState = INITIAL_FLIP_COVER_STATE
): FlipCoverDecision[] {
  const s: FlipCoverSettings = { ...settings, ...override }
  let state = initial
  const out: FlipCoverDecision[] = []
  ticks.forEach((tick, index) => {
    const decision = decideFlipCoverPulse({
      pressed: tick.pressed,
      engineRunning: tick.engineRunning,
      now: tick.now ?? index * 100,
      settings: s,
      state
    })
    state = decision.state
    out.push(decision)
  })
  return out
}

const pulses = (decisions: FlipCoverDecision[]): number => decisions.filter((d) => d.pulse).length

describe('engineRunningProxy', () => {
  it('returns null when telemetry is missing or disconnected', () => {
    expect(engineRunningProxy(null, 200)).toBeNull()
    expect(engineRunningProxy({ connected: false, rpm: 3000 }, 200)).toBeNull()
  })

  it('prefers an explicit engineRunning field when present', () => {
    expect(engineRunningProxy({ connected: true, rpm: 0, engineRunning: true }, 200)).toBe(true)
    expect(engineRunningProxy({ connected: true, rpm: 6000, engineRunning: false }, 200)).toBe(false)
  })

  it('honors the configurable rpm threshold against raw rpm', () => {
    expect(engineRunningProxy({ connected: true, rpm: 250 }, 200)).toBe(true)
    expect(engineRunningProxy({ connected: true, rpm: 250 }, 300)).toBe(false)
    expect(engineRunningProxy({ connected: true, rpm: 200 }, 200)).toBe(false)
  })
})

describe('decideFlipCoverPulse — startup suppression', () => {
  it('never pulses on the first observation, even with a mismatch (engine on, cover off)', () => {
    const [first] = run([{ pressed: false, engineRunning: true }])
    expect(first.pulse).toBe(false)
  })

  it('does not auto-correct a pre-existing mismatch that just sits there', () => {
    // Join a running session with the cover OFF and never touch it: zero pulses.
    const decisions = run([
      { pressed: false, engineRunning: true },
      { pressed: false, engineRunning: true },
      { pressed: false, engineRunning: true },
      { pressed: false, engineRunning: true }
    ])
    expect(pulses(decisions)).toBe(0)
  })
})

describe('decideFlipCoverPulse — one pulse per transition (latch)', () => {
  it('pulses exactly once when the cover is flipped ON while the engine is off', () => {
    const decisions = run([
      { pressed: false, engineRunning: false }, // init (match)
      { pressed: true, engineRunning: false }, // flip ON -> mismatch -> pulse
      { pressed: true, engineRunning: false }, // still cranking, no new edge -> latched
      { pressed: true, engineRunning: false }
    ])
    expect(pulses(decisions)).toBe(1)
    expect(decisions[1]).toMatchObject({ pulse: true, reason: 'reconcile' })
  })

  it('kill-in-gear: one pulse on the OFF flip, then latched while rpm stays > threshold', () => {
    // The classic bug: cover OFF but drivetrain keeps the engine "running" forever.
    const decisions = run([
      { pressed: true, engineRunning: true }, // init: cover ON, engine ON (match)
      { pressed: false, engineRunning: true }, // flip OFF -> mismatch -> ONE pulse
      { pressed: false, engineRunning: true }, // rolling in gear, rpm high -> latched
      { pressed: false, engineRunning: true },
      { pressed: false, engineRunning: true }
    ])
    expect(pulses(decisions)).toBe(1)
  })

  it('stall with cover ON: one reconcile attempt on the engine OFF transition, then latched', () => {
    const decisions = run([
      { pressed: true, engineRunning: true }, // init match
      { pressed: true, engineRunning: false }, // engine stalls -> engine edge + mismatch -> ONE pulse
      { pressed: true, engineRunning: false }, // still stalled, no new edge -> latched
      { pressed: true, engineRunning: false }
    ])
    expect(pulses(decisions)).toBe(1)
    expect(decisions[1].reason).toBe('reconcile')
  })

  it('re-arms after the mismatch clears: a new flip pulses again', () => {
    const decisions = run([
      { pressed: false, engineRunning: false }, // init match
      { pressed: true, engineRunning: false }, // flip ON -> pulse
      { pressed: true, engineRunning: true }, // engine started -> match, no pulse
      { pressed: false, engineRunning: true }, // flip OFF -> mismatch -> pulse
      { pressed: false, engineRunning: false } // engine stopped -> match, no pulse
    ])
    expect(pulses(decisions)).toBe(2)
  })

  it('does not pulse when cover and engine already agree on a flip', () => {
    const decisions = run([
      { pressed: false, engineRunning: false }, // init
      { pressed: true, engineRunning: true } // flip ON but engine already ON -> match -> no pulse
    ])
    expect(pulses(decisions)).toBe(0)
  })
})

describe('decideFlipCoverPulse — telemetry unknown (offline)', () => {
  it('pulses once per flip on both edges, never on a steady position', () => {
    const decisions = run([
      { pressed: false, engineRunning: null }, // init
      { pressed: true, engineRunning: null }, // edge -> pulse
      { pressed: true, engineRunning: null }, // steady -> no pulse
      { pressed: false, engineRunning: null }, // edge -> pulse
      { pressed: false, engineRunning: null } // steady -> no pulse
    ])
    expect(pulses(decisions)).toBe(2)
    expect(decisions[1].reason).toBe('edge-fallback')
    expect(decisions[3].reason).toBe('edge-fallback')
  })

  it('does not pulse when telemetry connects mid-session into a mismatch', () => {
    // null -> known engine value is treated like a fresh observation (no engine edge).
    const decisions = run([
      { pressed: false, engineRunning: null }, // cover OFF, unknown
      { pressed: false, engineRunning: true } // telemetry appears, engine ON: mismatch but no edge
    ])
    expect(pulses(decisions)).toBe(0)
  })
})

describe('decideFlipCoverPulse — debounce floor', () => {
  it('rate-limits reconcile pulses from rpm jitter around the threshold', () => {
    // Engine signal flaps while the cover stays ON: without debounce this would pulse on
    // every flap. With a 1500ms floor and 100ms ticks, only the first lands.
    const decisions = run([
      { pressed: true, engineRunning: true, now: 0 }, // init match
      { pressed: true, engineRunning: false, now: 100 }, // edge + mismatch -> pulse
      { pressed: true, engineRunning: true, now: 200 }, // edge but match -> no pulse
      { pressed: true, engineRunning: false, now: 300 }, // edge + mismatch but within debounce -> no pulse
      { pressed: true, engineRunning: false, now: 1700 } // mismatch persists, no NEW edge -> no pulse (latched)
    ])
    expect(pulses(decisions)).toBe(1)
  })
})

describe('decideFlipCoverPulse — inverted wiring', () => {
  it('treats a pressed contact as cover OFF', () => {
    const idle = run(
      [
        { pressed: false, engineRunning: false }, // init: not pressed -> cover ON; engine OFF (startup, no pulse)
        { pressed: true, engineRunning: false } // pressed -> cover OFF; engine OFF -> match -> no pulse
      ],
      { invertCover: true }
    )
    expect(pulses(idle)).toBe(0)

    const kill = run(
      [
        { pressed: false, engineRunning: true }, // init: cover ON, engine ON (match)
        { pressed: true, engineRunning: true } // pressed -> cover OFF, engine ON -> mismatch -> pulse
      ],
      { invertCover: true }
    )
    expect(pulses(kill)).toBe(1)
    expect(kill[1].reason).toBe('reconcile')
  })
})
