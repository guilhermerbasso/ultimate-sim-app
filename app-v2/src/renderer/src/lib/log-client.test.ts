import { describe, expect, it } from 'vitest'
import { LogThrottle } from './log-client'

// Guards M1: a renderer error fired every frame (60Hz) used to forward 60 IPC
// log writes per second, each forcing a disk flush in the main logger. The
// throttle coalesces identical keys and caps the overall event rate.
describe('LogThrottle (renderer log dedup + rate cap)', () => {
  it('coalesces identical keys within the dedup window', () => {
    const t = new LogThrottle(1000, 100)
    expect(t.shouldSend('error:renderer:boom', 0)).toBe(true)
    // ~60 identical events over the next second (16ms apart) all coalesce away.
    let emitted = 0
    for (let ms = 16; ms < 1000; ms += 16) {
      if (t.shouldSend('error:renderer:boom', ms)) emitted += 1
    }
    expect(emitted).toBe(0)
    // After the window the same key is allowed through once more.
    expect(t.shouldSend('error:renderer:boom', 1000)).toBe(true)
  })

  it('lets DISTINCT keys through but caps the total events/sec', () => {
    const t = new LogThrottle(1000, 20)
    let sent = 0
    for (let i = 0; i < 100; i += 1) {
      if (t.shouldSend(`error:renderer:msg-${i}`, 5)) sent += 1 // all in the same second
    }
    expect(sent).toBe(20)
  })

  it('refills the per-second budget in the next second', () => {
    const t = new LogThrottle(1000, 2)
    expect(t.shouldSend('a', 0)).toBe(true)
    expect(t.shouldSend('b', 0)).toBe(true)
    expect(t.shouldSend('c', 0)).toBe(false) // over budget this second
    expect(t.shouldSend('c', 1000)).toBe(true) // new second → budget refilled
  })
})
