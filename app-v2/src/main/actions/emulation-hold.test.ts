import { describe, expect, it } from 'vitest'
import type { GamepadEmulationCommand } from '../../shared/actions'
import {
  GAMEPAD_HOLD_MAX_MS,
  GAMEPAD_HOLD_MIN_MS,
  GAMEPAD_TAP_MS,
  resolveGamepadHoldMs
} from '../../shared/actions'

// P1-10(C): "hold" used to be a hard-coded 70 ms tap regardless of intent, while
// the keyboard macro path already had a configurable `releaseDelayMs`. A hold is
// now a real hold — but always bounded and always released, so the virtual pad
// can never be left with a stuck button.
const cmd = (over: Partial<GamepadEmulationCommand>): GamepadEmulationCommand => ({
  button: 3,
  mode: 'hold',
  ...over
})

describe('resolveGamepadHoldMs (P1-10)', () => {
  it('keeps a press as a momentary tap', () => {
    expect(resolveGamepadHoldMs(cmd({ mode: 'press', releaseDelayMs: 900 }))).toBe(GAMEPAD_TAP_MS)
  })

  it('holds for the requested duration instead of a fixed tap', () => {
    expect(resolveGamepadHoldMs(cmd({ releaseDelayMs: 450 }))).toBe(450)
    expect(resolveGamepadHoldMs(cmd({ releaseDelayMs: 450 }))).not.toBe(GAMEPAD_TAP_MS)
  })

  it('falls back to the legacy tap when no duration was configured', () => {
    expect(resolveGamepadHoldMs(cmd({}))).toBe(GAMEPAD_TAP_MS)
    expect(resolveGamepadHoldMs(cmd({ releaseDelayMs: Number.NaN }))).toBe(GAMEPAD_TAP_MS)
  })

  it('never releases faster than a tap', () => {
    expect(resolveGamepadHoldMs(cmd({ releaseDelayMs: 0 }))).toBe(GAMEPAD_HOLD_MIN_MS)
    expect(resolveGamepadHoldMs(cmd({ releaseDelayMs: -500 }))).toBe(GAMEPAD_HOLD_MIN_MS)
  })

  it('caps the hold so a virtual button can never look stuck', () => {
    expect(resolveGamepadHoldMs(cmd({ releaseDelayMs: 60_000 }))).toBe(GAMEPAD_HOLD_MAX_MS)
  })
})
