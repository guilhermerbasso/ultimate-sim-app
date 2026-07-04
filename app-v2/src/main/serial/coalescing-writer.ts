// Per-device coalescing serial writer for the iFlag / RGB-matrix HOT PATH.
//
// Why this exists: a live matrix frame is an ASCII `P` pixel-stream of ~385 bytes.
// At 115200 baud that is ~34 ms on the wire, so the link tops out near ~29 fps.
// The matrix module used to fire frames with `void device.sendRaw(...)` (no await),
// so when the app produced frames faster than the slow old-bootloader Nano could
// drain them, node-serialport's internal write queue grew without bound and the
// panel fell further and further behind reality (the "delay").
//
// This writer keeps AT MOST ONE write in flight and ONE pending job per device:
// when a new frame arrives while a write is in flight it REPLACES the pending job
// (dropping the now-stale one) instead of enqueuing. On drain it flushes the latest.
// Net effect: latency is bounded to ~1–2 frames, the effective frame rate self-
// throttles to whatever the link can carry, and the panel ALWAYS renders the most
// recent state. Stale intermediate frames are intentionally discarded.
//
// WATCHDOG: a single in-flight write is only safe if it ALWAYS settles. On an
// old-bootloader Nano with a flaky COM port a `port.drain()` can wedge and never
// call back, so `device.sendRaw()` would hang forever — the in-flight slot would
// never release and every subsequent frame would just overwrite `pending` and be
// dropped, freezing the panel permanently with no recovery. To prevent that each
// write is raced against WRITE_TIMEOUT_MS; on a timeout the job is abandoned (its
// genuinely-wedged underlying write becomes a harmless orphan that settles/rejects
// later, e.g. on disconnect), the slot is released and the freshest pending frame
// is flushed so the panel recovers. A per-device GENERATION counter makes any late
// settle of an abandoned (or externally cleared) write a no-op so it can never
// double-process or corrupt the coalescing state.

import { logger } from '../modules/logger'

// Far above a normal ~34 ms `P` pixel-stream write at 115200 baud (≈29×), so it only
// ever fires on a genuinely wedged write — never on a merely slow-but-progressing link.
// Kept ≤1 s so a transient wedge unfreezes the panel within a second rather than 1.5 s.
export const WRITE_TIMEOUT_MS = 1000

export interface FrameWriterTarget {
  readonly id: string
  sendRaw(command: string): Promise<void>
}

interface PendingJob {
  device: FrameWriterTarget
  frames: string[]
  onError?: (error: unknown) => void
}

// Outcome of a single watchdog-guarded write. The race never rejects: a rejected
// underlying write is reported as `error`, a wedged one as `timeout`.
type WriteResult =
  | { kind: 'ok' }
  | { kind: 'timeout' }
  | { kind: 'error'; error: unknown }

export class CoalescingFrameWriter {
  private readonly inFlight = new Set<string>()
  private readonly pending = new Map<string, PendingJob>()
  // Per-device run generation. Bumped whenever the current in-flight job is
  // abandoned (watchdog timeout) or externally cleared (clear/clearAll). A run
  // captures its generation when it starts and, after every `await`, bails out
  // without touching shared state if the generation has moved on — so a stale
  // completion (late settle of an orphaned write, or a write that finishes after
  // an external reset) can never re-release the slot, re-drive pending, or fire a
  // duplicate onError.
  private readonly generation = new Map<string, number>()

  // Queue a logical frame (one or more wire frames sent in order, e.g. an optional
  // brightness frame followed by the `P` pixel-stream). If a write is already in
  // flight for this device the newest job supersedes any not-yet-started one.
  push(device: FrameWriterTarget, frames: string[], onError?: (error: unknown) => void): void {
    if (frames.length === 0) return
    if (this.inFlight.has(device.id)) {
      this.pending.set(device.id, { device, frames, onError })
      return
    }
    void this.run({ device, frames, onError })
  }

  // Drop the pending (not-yet-started) job for a device AND release any in-flight
  // slot — used when the device disconnects or the dedup state is cleared. Bumping
  // the generation abandons the current run (its eventual settle becomes a no-op)
  // so even a wedged writer is unstuck and the next push can start cleanly. We never
  // chain into a cleared pending job.
  clear(deviceId: string): void {
    this.pending.delete(deviceId)
    this.abandon(deviceId)
  }

  clearAll(): void {
    this.pending.clear()
    for (const deviceId of [...this.inFlight]) {
      this.abandon(deviceId)
    }
  }

  // Release the in-flight slot for a device and bump its generation so the
  // currently running job (if any) bails out on its next resumption and any late
  // settle of its write is ignored. Safe to call when nothing is in flight.
  private abandon(deviceId: string): void {
    this.inFlight.delete(deviceId)
    this.generation.set(deviceId, (this.generation.get(deviceId) ?? 0) + 1)
  }

  // Test/diagnostic helpers.
  isInFlight(deviceId: string): boolean {
    return this.inFlight.has(deviceId)
  }

  hasPending(deviceId: string): boolean {
    return this.pending.has(deviceId)
  }

  private async run(job: PendingJob): Promise<void> {
    const { device } = job
    const id = device.id
    this.inFlight.add(id)
    const gen = this.generation.get(id) ?? 0

    for (const frame of job.frames) {
      const result = await this.raceWrite(device, frame)

      // Superseded while awaiting: an external clear()/clearAll() (or another path)
      // bumped the generation and already released the slot. Touch NO shared state —
      // whoever bumped us owns the recovery — and let this stale completion vanish.
      if ((this.generation.get(id) ?? 0) !== gen) return

      if (result.kind === 'ok') continue

      if (result.kind === 'timeout') {
        // Watchdog tripped: the underlying write wedged (never drained). Abandon it —
        // bumping the generation makes its eventual late settle a harmless no-op —
        // release the slot, surface the failure (the matrix module clears its dedup
        // and re-sends), then flush the freshest pending frame so the panel recovers.
        logger.verbose('serial', 'matrix write timeout — recovering', { deviceId: id })
        this.generation.set(id, gen + 1)
        this.inFlight.delete(id)
        job.onError?.(new Error(`matrix write timed out after ${WRITE_TIMEOUT_MS}ms`))
        this.flushNext(id)
        return
      }

      // A normal rejected write (port closing, etc.): surface it but never wedge the
      // writer — recover the slot and flush the latest pending job.
      job.onError?.(result.error)
      this.inFlight.delete(id)
      this.flushNext(id)
      return
    }

    // Every frame in the job settled successfully.
    this.inFlight.delete(id)
    this.flushNext(id)
  }

  // Start the freshest pending job for a device, if one is queued.
  private flushNext(deviceId: string): void {
    const next = this.pending.get(deviceId)
    if (next) {
      this.pending.delete(deviceId)
      void this.run(next)
    }
  }

  // Race a single write against the watchdog. Resolves (never rejects) with the
  // outcome: `ok`, `error` (the write rejected), or `timeout` (the write wedged).
  // A local `settled` latch guarantees the orphaned underlying write's eventual
  // settle after a timeout is ignored here too (belt-and-suspenders with the
  // generation guard). setTimeout (not a hand-rolled delay) keeps the watchdog
  // advanceable under vitest fake timers.
  private raceWrite(device: FrameWriterTarget, frame: string): Promise<WriteResult> {
    return new Promise<WriteResult>((resolve) => {
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        resolve({ kind: 'timeout' })
      }, WRITE_TIMEOUT_MS)
      device.sendRaw(frame).then(
        () => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve({ kind: 'ok' })
        },
        (error: unknown) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve({ kind: 'error', error })
        }
      )
    })
  }
}
