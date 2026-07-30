import { describe, expect, it } from 'vitest'
import { observeBindingEdge } from './binding-edge'

// A tiny replay of the runtime tick loop: the runtimes keep a Map keyed by
// binding+control and feed the previous level back in on every frame.
function replay(levels: boolean[]): { fires: number; pulses: number } {
  const state = new Map<string, boolean>()
  let fires = 0
  let pulses = 0
  for (const pressed of levels) {
    const reading = observeBindingEdge(state.get('k'), pressed)
    state.set('k', reading.pressed)
    if (reading.rising) fires += 1
    if (reading.changed) pulses += 1
  }
  return { fires, pulses }
}

describe('observeBindingEdge (P1-10 held-at-start)', () => {
  it('does NOT fire for a control that is already held on the first sample', () => {
    // Toggle switch left ON when the app launches.
    expect(replay([true, true, true]).fires).toBe(0)
  })

  it('fires on the next genuine press after a held-at-start control is released', () => {
    expect(replay([true, true, false, true]).fires).toBe(1)
  })

  it('still fires normally for a control that starts released', () => {
    expect(replay([false, true, false, true]).fires).toBe(2)
  })

  it('does not double-fire while a control stays held', () => {
    expect(replay([false, true, true, true, true]).fires).toBe(1)
  })

  it('suppresses the pulse-both-edges pulse on the first sample too', () => {
    // Held at start, then released: only the genuine release is a pulse.
    expect(replay([true, true, false]).pulses).toBe(1)
    // Released at start, then pressed and released: two genuine pulses.
    expect(replay([false, true, false]).pulses).toBe(2)
  })

  it('reports the arming sample explicitly', () => {
    expect(observeBindingEdge(undefined, true)).toEqual({
      pressed: true,
      rising: false,
      changed: false,
      armed: true
    })
    expect(observeBindingEdge(false, true)).toEqual({
      pressed: true,
      rising: true,
      changed: true,
      armed: false
    })
  })

  it('treats a previously-recorded false as a real level, not as "unseen"', () => {
    // The bug was collapsing `undefined` and `false`; a recorded false must
    // still produce a rising edge.
    expect(observeBindingEdge(false, true).rising).toBe(true)
    expect(observeBindingEdge(undefined, true).rising).toBe(false)
  })
})
