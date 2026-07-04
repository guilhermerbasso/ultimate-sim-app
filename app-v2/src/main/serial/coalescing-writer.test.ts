import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CoalescingFrameWriter,
  WRITE_TIMEOUT_MS,
  type FrameWriterTarget
} from './coalescing-writer'

// A controllable fake device: each sendRaw returns a promise we resolve by hand so
// the test can hold a write "in flight" and observe coalescing precisely.
class FakeDevice implements FrameWriterTarget {
  sent: string[] = []
  private resolvers: Array<() => void> = []
  constructor(readonly id: string) {}
  sendRaw(command: string): Promise<void> {
    this.sent.push(command)
    return new Promise<void>((resolve) => this.resolvers.push(resolve))
  }
  // Resolve the oldest outstanding write (simulates the wire/drain completing).
  drainOne(): void {
    const r = this.resolvers.shift()
    if (r) r()
  }
  get outstanding(): number {
    return this.resolvers.length
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

// A device whose write never settles — simulates a wedged `port.drain()` on the
// flaky old-bootloader Nano. Records every command it is asked to send.
function makeWedgingDevice(id: string, sink: string[]): FrameWriterTarget {
  return {
    id,
    sendRaw: (command: string) => {
      sink.push(command)
      return new Promise<void>(() => {}) // intentionally never resolves
    }
  }
}

describe('CoalescingFrameWriter', () => {
  afterEach(() => {
    // Defensive: ensure a fake-timer test never leaks into the real-timer tests.
    vi.useRealTimers()
  })

  it('keeps the LATEST of several frames pushed during one in-flight write (drops stale)', async () => {
    const dev = new FakeDevice('iflag')
    const w = new CoalescingFrameWriter()

    w.push(dev, ['P-frame-1'])
    expect(dev.sent).toEqual(['P-frame-1']) // started immediately
    expect(w.isInFlight('iflag')).toBe(true)

    // Three more frames arrive while frame-1 is still draining → only the newest
    // survives as the single pending job; the middle ones are discarded.
    w.push(dev, ['P-frame-2'])
    w.push(dev, ['P-frame-3'])
    w.push(dev, ['P-frame-4'])
    expect(dev.sent).toEqual(['P-frame-1']) // nothing else sent yet
    expect(w.hasPending('iflag')).toBe(true)

    dev.drainOne() // frame-1 done → flush latest pending (frame-4)
    await flush()
    expect(dev.sent).toEqual(['P-frame-1', 'P-frame-4'])
    expect(w.hasPending('iflag')).toBe(false)

    dev.drainOne()
    await flush()
    expect(w.isInFlight('iflag')).toBe(false)
  })

  it('preserves frame order WITHIN a job (brightness before pixel-stream)', async () => {
    const dev = new FakeDevice('iflag')
    const w = new CoalescingFrameWriter()
    w.push(dev, ['B255', 'P-frame'])
    expect(dev.sent).toEqual(['B255']) // first frame of the job started
    dev.drainOne() // B255 done → P-frame next (same job)
    await flush()
    expect(dev.sent).toEqual(['B255', 'P-frame'])
  })

  it('clear(deviceId) drops the pending job so a stale frame is not flushed', async () => {
    const dev = new FakeDevice('iflag')
    const w = new CoalescingFrameWriter()
    w.push(dev, ['P-1'])
    w.push(dev, ['P-2']) // pending
    expect(w.hasPending('iflag')).toBe(true)
    w.clear('iflag')
    expect(w.hasPending('iflag')).toBe(false)
    dev.drainOne() // P-1 done → nothing pending to chain
    await flush()
    expect(dev.sent).toEqual(['P-1'])
    expect(w.isInFlight('iflag')).toBe(false)
  })

  it('a write error invokes onError and does NOT wedge the writer (pending still flushes)', async () => {
    const errors: unknown[] = []
    const w = new CoalescingFrameWriter()
    const sentAll: string[] = []
    // First device write rejects; ensure the writer recovers and the next job runs.
    let reject1!: (e: unknown) => void
    const dev: FrameWriterTarget = {
      id: 'iflag',
      sendRaw: (cmd: string) => {
        sentAll.push(cmd)
        if (cmd === 'BOOM') return new Promise<void>((_res, rej) => (reject1 = rej))
        return Promise.resolve()
      }
    }

    w.push(dev, ['BOOM'], (e) => errors.push(e))
    w.push(dev, ['P-next']) // pending while BOOM is "in flight"
    reject1(new Error('port closing'))
    await flush()

    expect(errors).toHaveLength(1)
    expect(sentAll).toContain('P-next') // recovered + flushed the pending job
    expect(w.isInFlight('iflag')).toBe(false)
    expect(w.hasPending('iflag')).toBe(false)
  })

  it('coalesces per-device independently', async () => {
    const a = new FakeDevice('a')
    const b = new FakeDevice('b')
    const w = new CoalescingFrameWriter()
    w.push(a, ['a1'])
    w.push(b, ['b1'])
    w.push(a, ['a2']) // pending for a only
    expect(a.sent).toEqual(['a1'])
    expect(b.sent).toEqual(['b1'])
    expect(w.hasPending('a')).toBe(true)
    expect(w.hasPending('b')).toBe(false)
    a.drainOne()
    await flush()
    expect(a.sent).toEqual(['a1', 'a2'])
  })

  // ─── WATCHDOG / wedged-write recovery (the iFlag "stopped working" freeze) ──────

  it('watchdog: a write that never settles releases inFlight and flushes the latest pending frame', async () => {
    vi.useFakeTimers()
    const errors: unknown[] = []
    const sent: string[] = []
    const dev = makeWedgingDevice('iflag', sent)
    const w = new CoalescingFrameWriter()

    w.push(dev, ['P-stuck'], (e) => errors.push(e))
    expect(sent).toEqual(['P-stuck'])
    expect(w.isInFlight('iflag')).toBe(true)

    // Newer frames keep arriving while the first write is wedged — they coalesce to
    // the single latest pending job (the old broken behavior dropped these forever).
    w.push(dev, ['P-stale'])
    w.push(dev, ['P-fresh'])
    expect(w.hasPending('iflag')).toBe(true)
    expect(sent).toEqual(['P-stuck']) // nothing else sent while wedged

    // Just before the watchdog fires: still stuck, no recovery yet.
    await vi.advanceTimersByTimeAsync(WRITE_TIMEOUT_MS - 1)
    expect(w.isInFlight('iflag')).toBe(true)
    expect(errors).toHaveLength(0)
    expect(sent).toEqual(['P-stuck'])

    // Watchdog trips: onError fires (matrix module clears its dedup), the slot is
    // released, and the FRESHEST pending frame is flushed → the panel recovers.
    await vi.advanceTimersByTimeAsync(1)
    expect(errors).toHaveLength(1)
    expect(sent).toEqual(['P-stuck', 'P-fresh']) // stale frame discarded, freshest sent
    expect(w.hasPending('iflag')).toBe(false)
    expect(w.isInFlight('iflag')).toBe(true) // P-fresh is now the in-flight write
  })

  it('watchdog: a late settle of the abandoned write does NOT double-drive or corrupt state', async () => {
    vi.useFakeTimers()
    const errors: unknown[] = []
    const sent: string[] = []
    let resolveStuck!: () => void
    // P-stuck wedges (we keep its resolver to settle it late); everything else is
    // an instant success so we can observe the recovered path completing.
    const dev: FrameWriterTarget = {
      id: 'iflag',
      sendRaw: (command: string) => {
        sent.push(command)
        if (command === 'P-stuck') return new Promise<void>((res) => (resolveStuck = res))
        return Promise.resolve()
      }
    }
    const w = new CoalescingFrameWriter()

    w.push(dev, ['P-stuck'], (e) => errors.push(e))
    w.push(dev, ['P-fresh'])

    // Watchdog abandons P-stuck and flushes P-fresh (which resolves immediately).
    await vi.advanceTimersByTimeAsync(WRITE_TIMEOUT_MS)
    expect(sent).toEqual(['P-stuck', 'P-fresh'])
    expect(errors).toHaveLength(1)
    expect(w.isInFlight('iflag')).toBe(false)
    expect(w.hasPending('iflag')).toBe(false)

    const sentSnapshot = [...sent]
    const errorCountSnapshot = errors.length

    // The genuinely-wedged underlying write FINALLY settles much later (e.g. on
    // disconnect). The generation guard + settled latch must make it a total no-op:
    // no re-send, no duplicate onError, no slot re-entry.
    resolveStuck()
    await vi.advanceTimersByTimeAsync(0)
    expect(sent).toEqual(sentSnapshot)
    expect(errors.length).toBe(errorCountSnapshot)
    expect(w.isInFlight('iflag')).toBe(false)
    expect(w.hasPending('iflag')).toBe(false)
  })

  it('clear() releases a wedged in-flight slot so the next push can start (no permanent freeze)', () => {
    vi.useFakeTimers()
    const sent: string[] = []
    const dev = makeWedgingDevice('iflag', sent)
    const w = new CoalescingFrameWriter()

    w.push(dev, ['P-stuck'])
    expect(w.isInFlight('iflag')).toBe(true)

    // External reset (device disconnect / dedup clear) must unstick the writer even
    // though the underlying write never settled.
    w.clear('iflag')
    expect(w.isInFlight('iflag')).toBe(false)

    // A fresh push starts immediately instead of being trapped in pending forever.
    w.push(dev, ['P-after-clear'])
    expect(sent).toEqual(['P-stuck', 'P-after-clear'])
    expect(w.isInFlight('iflag')).toBe(true)
  })

  it('clearAll() releases in-flight slots for every device', () => {
    vi.useFakeTimers()
    const aSent: string[] = []
    const bSent: string[] = []
    const a = makeWedgingDevice('a', aSent)
    const b = makeWedgingDevice('b', bSent)
    const w = new CoalescingFrameWriter()

    w.push(a, ['a1'])
    w.push(b, ['b1'])
    expect(w.isInFlight('a')).toBe(true)
    expect(w.isInFlight('b')).toBe(true)

    w.clearAll()
    expect(w.isInFlight('a')).toBe(false)
    expect(w.isInFlight('b')).toBe(false)

    // Both devices can start anew after the reset.
    w.push(a, ['a2'])
    expect(aSent).toEqual(['a1', 'a2'])
    expect(w.isInFlight('a')).toBe(true)
  })

  it('clear() during a wedged write makes the eventual settle a no-op (generation guard)', async () => {
    vi.useFakeTimers()
    const sent: string[] = []
    let resolveStuck!: () => void
    const dev: FrameWriterTarget = {
      id: 'iflag',
      sendRaw: (command: string) => {
        sent.push(command)
        return new Promise<void>((res) => (resolveStuck = res))
      }
    }
    const w = new CoalescingFrameWriter()

    w.push(dev, ['P-1'])
    w.push(dev, ['P-2']) // pending
    w.clear('iflag')
    expect(w.isInFlight('iflag')).toBe(false)
    expect(w.hasPending('iflag')).toBe(false)

    // The original (now abandoned) write settles after the clear: it must not chain
    // into anything or re-enter the slot.
    resolveStuck()
    await vi.advanceTimersByTimeAsync(0)
    expect(sent).toEqual(['P-1']) // P-2 was cleared, never flushed
    expect(w.isInFlight('iflag')).toBe(false)
    expect(w.hasPending('iflag')).toBe(false)
  })
})
