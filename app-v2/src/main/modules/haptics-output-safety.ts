// Shared safe-off primitive for every haptic actuator the app can energise.
//
// P0-10: telemetry loss, a quit, or a failure must never leave a motor/piezo
// driven. The companion buzzer firmware documents the stop command explicitly —
// `Z0:0` reaches `startTone(0, 0)` → `stopTone()` → `noTone(pin)`
// (firmware/companion-buzzer/companion_buzzer.ino) — so "off" is a concrete
// frame we can send and assert, not an absence of frames.
//
// Deliberately narrow: it takes the smallest structural slice of SerialDevice it
// needs, so a test can drive it with a fake transport and never touch a port.

import { formatBuzzer } from '../../shared/companion'

/** Companion v2 silence frame. Idempotent and safe to send to a quiet device. */
export const HAPTICS_SILENCE_FRAME = formatBuzzer(0, 0)

export interface HapticActuator {
  isOpen(): boolean
  sendRaw(command: string): Promise<void>
}

/**
 * Drive an actuator to its off state. Returns true when the frame was written.
 *
 * Never throws: safe-off runs on the quit path and during telemetry loss, where
 * a rejected write (port already closing, cable pulled) must not escalate. A
 * closed/absent device is already de-energised, so it is not written to.
 */
export async function silenceHapticActuator(device: HapticActuator | null | undefined): Promise<boolean> {
  if (!device) return false
  try {
    if (!device.isOpen()) return false
    await device.sendRaw(HAPTICS_SILENCE_FRAME)
    return true
  } catch {
    return false
  }
}
