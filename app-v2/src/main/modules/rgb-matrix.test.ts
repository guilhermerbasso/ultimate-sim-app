import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RgbMatrixModule, decideMatrixSend, buildPreviewFrameRows, type MatrixGateState } from './rgb-matrix'
import {
  defaultMatrixLayout,
  emptyMatrixHexGrid,
  RGB_MATRIX_LED_COUNT,
  RGB_MATRIX_SIZE,
  defaultRgbMatrixProfile,
  type RgbMatrixProfile
} from '../../shared/rgb-matrix'
import type { DeviceProfile, RgbMatrixComponent } from '../../shared/devices'
import type { ModuleContext } from '../module-context'
import type { SerialDevice } from '../serial/device'
import type { TelemetrySnapshot } from '../../shared/telemetry'

// Mirror the live-drive constants (private to the module).
const MIN = 40
const KEYFRAME = 300
const QUICK_RETRY = 80

function state(partial: Partial<MatrixGateState>): MatrixGateState {
  return { lastSentAt: 0, lastPayload: null, lastKeyframeAt: 0, ...partial }
}

// The pure send decision is the heart of the gate/keyframe logic: a CHANGED
// signature sends immediately, an UNCHANGED one is deduped until KEYFRAME_MS so a
// frame the slow Nano dropped self-heals, and the per-frame min-interval throttles
// everything first.
describe('decideMatrixSend (gate + keyframe)', () => {
  it('(a) sends immediately when the signature CHANGES', () => {
    // Never sent before → treated as a change (first frame always paints).
    expect(decideMatrixSend(state({}), 'gear-1', 1_000_000, MIN, KEYFRAME)).toBe('change')
    // A different signature after a prior send (min-interval elapsed) → change.
    expect(
      decideMatrixSend(
        state({ lastSentAt: 1_000_000, lastPayload: 'gear-1', lastKeyframeAt: 1_000_000 }),
        'gear-2',
        1_000_100,
        MIN,
        KEYFRAME
      )
    ).toBe('change')
  })

  it('(b) dedups an UNCHANGED signature until KEYFRAME_MS, then re-sends (self-heal)', () => {
    const base = state({ lastSentAt: 1_000_000, lastPayload: 'gear-1', lastKeyframeAt: 1_000_000 })
    // Unchanged, well before the keyframe is due → deduped (the freeze bug window).
    expect(decideMatrixSend(base, 'gear-1', 1_000_100, MIN, KEYFRAME)).toBe('skip')
    // Unchanged, one ms before the keyframe is due → still deduped.
    expect(decideMatrixSend(base, 'gear-1', 1_000_000 + KEYFRAME - 1, MIN, KEYFRAME)).toBe('skip')
    // Unchanged, keyframe interval elapsed → redundant re-send heals a dropped frame.
    expect(decideMatrixSend(base, 'gear-1', 1_000_000 + KEYFRAME, MIN, KEYFRAME)).toBe('keyframe')
  })

  it('(c) throttles within the per-frame min-interval, even for a change or a due keyframe', () => {
    const base = state({ lastSentAt: 1_000_000, lastPayload: 'gear-1', lastKeyframeAt: 1_000_000 })
    // A change <40ms after the last send → throttled (min-interval is checked first).
    expect(decideMatrixSend(base, 'gear-2', 1_000_000 + MIN - 1, MIN, KEYFRAME)).toBe('skip')
    // A keyframe-due frame <40ms after the last send → throttled too.
    expect(
      decideMatrixSend(
        state({ lastSentAt: 2_000_000, lastPayload: 'gear-1', lastKeyframeAt: 1_000_000 }),
        'gear-1',
        2_000_000 + MIN - 1,
        MIN,
        KEYFRAME
      )
    ).toBe('skip')
    // Once the min-interval passes, the change goes through.
    expect(decideMatrixSend(base, 'gear-2', 1_000_000 + MIN, MIN, KEYFRAME)).toBe('change')
  })
})

// Internal surface poked by the live-drive tests (driveMatrix + the calibration
// hold map are private; the live-drive timing is deterministic because driveMatrix
// takes `now` explicitly).
interface DriveableModule {
  driveMatrix(
    device: SerialDevice,
    deviceProfile: DeviceProfile,
    component: RgbMatrixComponent,
    profile: RgbMatrixProfile,
    snapshot: TelemetrySnapshot | null,
    now: number
  ): void
  calibrationHoldUntil: Map<string, number>
  clearDedup(): void
  lastBrightness: Map<string, number>
  sendAtomicTestFrame(
    device: SerialDevice,
    sendKey: string,
    layout: RgbMatrixProfile['layout'],
    rows: string[][],
    brightness: number
  ): Promise<boolean>
  allOff(): Promise<void>
  profiles: DeviceProfile[]
  loaded: boolean
}

function internals(mod: RgbMatrixModule): DriveableModule {
  return mod as unknown as DriveableModule
}

function makeModule(): RgbMatrixModule {
  const hub = { on: () => {}, off: () => {} }
  const ctx = {
    app: { getPath: () => process.cwd() },
    telemetryHub: hub,
    serialHub: { ...hub, getPrimaryId: () => null, getDevice: () => null }
  } as unknown as ModuleContext
  return new RgbMatrixModule(ctx)
}

function makeDevice(): { device: SerialDevice; sent: string[] } {
  const sent: string[] = []
  const device = {
    id: 'dev-1',
    sendRaw: (frame: string): Promise<void> => {
      sent.push(frame)
      return Promise.resolve()
    }
  } as unknown as SerialDevice
  return { device, sent }
}

const deviceProfile = { id: 'profA' } as unknown as DeviceProfile
const component = { id: 'comp1', brightness: 120 } as unknown as RgbMatrixComponent
const TARGET_KEY = 'profA:comp1'

// A frame is the atomic `P` pixel-stream (formatStripRgb). `Y`/`M` (brightness /
// layout) are not the rendered image, so the freeze bug only concerns `P`.
const countP = (frames: string[]): number => frames.filter((f) => f.startsWith('P')).length

// An effect-less profile renders a fixed all-black frame, so the signature is
// stable across ticks — letting us exercise the UNCHANGED keyframe/dedup path
// end-to-end without animation drift.
function staticProfile(): RgbMatrixProfile {
  return { ...defaultRgbMatrixProfile(), effects: [] }
}

// Live frames now flow through the CoalescingFrameWriter, whose sendRaw completes on
// a microtask. Awaiting this drains the in-flight write so the next pushed frame is
// sent immediately instead of coalescing into "pending" — mirroring production, where
// a ~34ms write finishes long before the next keyframe/retry/tick.
const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

describe('RgbMatrixModule live drive (keyframe + quick retry)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('(d) a calibration hold suppresses sends (incl. keyframes) until it expires', () => {
    const mod = makeModule()
    const { device, sent } = makeDevice()
    const profile = staticProfile()
    const t0 = 1_000_000
    // Active hold for this target → no live frame is painted over the test pattern.
    internals(mod).calibrationHoldUntil.set(TARGET_KEY, t0 + 5000)
    internals(mod).driveMatrix(device, deviceProfile, component, profile, null, t0)
    internals(mod).driveMatrix(device, deviceProfile, component, profile, null, t0 + 1000)
    // Even past KEYFRAME_MS the hold must still suppress the redundant keyframe.
    internals(mod).driveMatrix(device, deviceProfile, component, profile, null, t0 + KEYFRAME + 100)
    expect(countP(sent)).toBe(0)
    // Once the hold expires, the live frame paints again.
    internals(mod).driveMatrix(device, deviceProfile, component, profile, null, t0 + 6000)
    expect(countP(sent)).toBe(1)
    mod.dispose()
  })

  it('keyframe re-sends an UNCHANGED frame after KEYFRAME_MS (dropped-frame self-heal)', async () => {
    const mod = makeModule()
    const { device, sent } = makeDevice()
    const profile = staticProfile()
    const t0 = 1_000_000
    internals(mod).driveMatrix(device, deviceProfile, component, profile, null, t0) // change → send
    await flush()
    expect(countP(sent)).toBe(1)
    // Unchanged and before the keyframe is due → deduped (no spam).
    internals(mod).driveMatrix(device, deviceProfile, component, profile, null, t0 + 200)
    await flush()
    expect(countP(sent)).toBe(1)
    // Unchanged but the keyframe interval elapsed → redundant re-send heals a drop.
    internals(mod).driveMatrix(device, deviceProfile, component, profile, null, t0 + KEYFRAME)
    await flush()
    expect(countP(sent)).toBe(2)
    mod.dispose()
  })

  it('schedules ONE quick re-send of the SAME frame on a CHANGE (snappy shift recovery)', async () => {
    const mod = makeModule()
    const { device, sent } = makeDevice()
    const profile = staticProfile()
    const t0 = 1_000_000
    internals(mod).driveMatrix(device, deviceProfile, component, profile, null, t0) // change → send now
    await flush()
    expect(countP(sent)).toBe(1)
    const firstP = sent.filter((f) => f.startsWith('P'))[0]
    // The redundant re-send fires ~80ms later, bypassing the dedup.
    vi.advanceTimersByTime(QUICK_RETRY)
    await flush()
    const pFrames = sent.filter((f) => f.startsWith('P'))
    expect(pFrames).toHaveLength(2)
    expect(pFrames[1]).toBe(firstP) // identical frame, idempotent on the firmware
    // No further timers pending → exactly one quick retry per change.
    vi.advanceTimersByTime(QUICK_RETRY * 5)
    await flush()
    expect(countP(sent)).toBe(2)
    mod.dispose()
  })

  it('a CONTINUOUS change (< gap) cancels the pending retry instead of re-sending a stale frame', async () => {
    const mod = makeModule()
    const { device, sent } = makeDevice()
    const profile = staticProfile()
    const t0 = 1_000_000
    // First change (panel had settled) is DISCRETE → schedules one quick retry.
    internals(mod).driveMatrix(device, deviceProfile, component, profile, null, t0)
    await flush()
    // A second change only MIN (40ms) later is CONTINUOUS (rev-lights) → it must
    // CANCEL the pending retry (which now holds a stale image) and add none.
    internals(mod).driveMatrix(device, deviceProfile, { ...component, brightness: 30 } as RgbMatrixComponent, profile, null, t0 + MIN)
    await flush()
    const live = countP(sent)
    expect(live).toBe(2) // one live P per change, no retry yet
    vi.advanceTimersByTime(QUICK_RETRY * 3)
    await flush()
    // No stale retry fired — the continuous change suppressed it.
    expect(countP(sent)).toBe(live)
    mod.dispose()
  })

  it('a quick retry after the device disconnects is safe (no throw)', () => {
    const mod = makeModule()
    const sent: string[] = []
    let open = true
    const device = {
      id: 'dev-x',
      sendRaw: (frame: string): Promise<void> => {
        if (!open) return Promise.reject(new Error('port closed'))
        sent.push(frame)
        return Promise.resolve()
      }
    } as unknown as SerialDevice
    const t0 = 1_000_000
    internals(mod).driveMatrix(device, deviceProfile, component, staticProfile(), null, t0)
    open = false // device goes away before the retry fires
    expect(() => vi.advanceTimersByTime(QUICK_RETRY)).not.toThrow()
    mod.dispose()
  })

  it('sends the brightness (Y) frame ONLY when it changes, not before every frame', async () => {
    const mod = makeModule()
    const { device, sent } = makeDevice()
    const profile = staticProfile()
    const t0 = 1_000_000
    const countY = (): number => sent.filter((f) => f.startsWith('Y')).length
    // First frame establishes brightness 120 → one Y frame.
    internals(mod).driveMatrix(device, deviceProfile, component, profile, null, t0)
    await flush()
    expect(countY()).toBe(1)
    // Subsequent UNCHANGED-brightness frames (incl. the keyframe re-send) add NO Y.
    internals(mod).driveMatrix(device, deviceProfile, component, profile, null, t0 + KEYFRAME)
    await flush()
    internals(mod).driveMatrix(device, deviceProfile, component, profile, null, t0 + KEYFRAME * 2)
    await flush()
    expect(countY()).toBe(1)
    // A genuine brightness change emits exactly one more Y.
    internals(mod).driveMatrix(device, deviceProfile, { ...component, brightness: 40 } as RgbMatrixComponent, profile, null, t0 + KEYFRAME * 2 + MIN)
    await flush()
    expect(countY()).toBe(2)
    mod.dispose()
  })

  it('re-asserts brightness after clearDedup (reconnect / reconfigure)', async () => {
    const mod = makeModule()
    const { device, sent } = makeDevice()
    const profile = staticProfile()
    const t0 = 1_000_000
    const countY = (): number => sent.filter((f) => f.startsWith('Y')).length
    internals(mod).driveMatrix(device, deviceProfile, component, profile, null, t0)
    await flush()
    expect(countY()).toBe(1)
    // clearDedup() (fleet change / reconnect) must drop the brightness latch so the
    // next frame re-sends Y — a reconnected panel powers up at default brightness.
    internals(mod).clearDedup()
    internals(mod).driveMatrix(device, deviceProfile, component, profile, null, t0 + 1000)
    await flush()
    expect(countY()).toBe(2)
    mod.dispose()
  })

  it('re-asserts the live brightness after a calibration/test frame (no stuck-bright regression)', async () => {
    // The wiring/calibration test forces the panel to a visibility FLOOR (160) via the
    // direct path. The brightness-on-change latch must track that so the first live
    // frame after the hold re-asserts the configured brightness instead of leaving the
    // panel stuck at 160. Real timers so sendAtomicTestFrame's internal delays elapse;
    // we read `sent` right after the microtask drain, before the 80ms retry can fire.
    vi.useRealTimers()
    const mod = makeModule()
    const { device, sent } = makeDevice()
    const profile = staticProfile()
    const KEY = 'profA:comp1:rgbmatrix'
    const ys = (): string[] => sent.filter((f) => f.startsWith('Y'))
    // Simulate the panel already live at the configured brightness 120.
    internals(mod).lastBrightness.set(KEY, 120)
    const ok = await internals(mod).sendAtomicTestFrame(device, KEY, defaultRgbMatrixProfile().layout, [['ff0000']], 160)
    expect(ok).toBe(true)
    expect(ys()).toEqual(['Y160']) // panel physically at 160 now; latch tracks it
    // First live frame after the hold must emit a fresh Y120 (panel was left at 160).
    internals(mod).driveMatrix(device, deviceProfile, component, profile, null, 2_000_000)
    await flush()
    expect(ys()).toEqual(['Y160', 'Y120'])
    mod.dispose() // clears the pending quick-retry timer before it can fire
  })
})

describe('RgbMatrixModule allOff (quit teardown)', () => {
  it('sends brightness 0 + a black P-frame to each connected iFlag and stops driving', async () => {
    const sent: string[] = []
    const device = {
      id: 'dev1',
      kind: 'generic',
      isOpen: () => true,
      sendRaw: (frame: string) => {
        sent.push(frame)
        return Promise.resolve()
      }
    } as unknown as SerialDevice
    const hub = { on: () => {}, off: () => {} }
    const ctx = {
      app: { getPath: () => process.cwd() },
      telemetryHub: hub,
      serialHub: { ...hub, getPrimaryId: () => null, getDevice: (id: string) => (id === 'dev1' ? device : null) }
    } as unknown as ModuleContext
    const mod = new RgbMatrixModule(ctx)
    internals(mod).loaded = true
    internals(mod).profiles = [
      {
        id: 'profA',
        deviceId: 'dev1',
        components: [{ id: 'comp1', type: 'rgbMatrix', mode: 'iflag', enabled: true, brightness: 120 }]
      } as unknown as DeviceProfile
    ]
    await mod.allOff()
    expect(sent).toContain('Y0') // brightness 0
    expect(sent.some((f) => /^P0{384}$/.test(f))).toBe(true) // all-black 64-pixel frame
  })

  it('is safe with no connected matrix (no throw)', async () => {
    const mod = makeModule()
    internals(mod).loaded = true
    await expect(mod.allOff()).resolves.toBeUndefined()
  })

  it('refreshes device configs when profiles are empty (early quit) then blacks the panel out', async () => {
    const sent: string[] = []
    const device = {
      id: 'dev1',
      kind: 'generic',
      isOpen: () => true,
      sendRaw: (frame: string) => {
        sent.push(frame)
        return Promise.resolve()
      }
    } as unknown as SerialDevice
    const hub = { on: () => {}, off: () => {} }
    const ctx = {
      app: { getPath: () => process.cwd() },
      telemetryHub: hub,
      serialHub: { ...hub, getPrimaryId: () => null, getDevice: (id: string) => (id === 'dev1' ? device : null) }
    } as unknown as ModuleContext
    const mod = new RgbMatrixModule(ctx)
    // profiles starts empty (the 2s refresh loop hasn't resolved yet). Simulate the
    // disk-backed refresh populating the connected matrix.
    const refreshSpy = vi
      .spyOn(mod as unknown as { refreshDeviceProfiles: () => Promise<void> }, 'refreshDeviceProfiles')
      .mockImplementation(async () => {
        internals(mod).profiles = [
          {
            id: 'profA',
            deviceId: 'dev1',
            components: [{ id: 'comp1', type: 'rgbMatrix', mode: 'iflag', enabled: true, brightness: 120 }]
          } as unknown as DeviceProfile
        ]
      })
    expect(internals(mod).profiles.length).toBe(0)
    await mod.allOff()
    expect(refreshSpy).toHaveBeenCalledTimes(1)
    expect(sent).toContain('Y0')
    expect(sent.some((f) => /^P0{384}$/.test(f))).toBe(true)
  })

  it('does not re-read device configs when profiles are already loaded', async () => {
    const mod = makeModule()
    const refreshSpy = vi.spyOn(
      mod as unknown as { refreshDeviceProfiles: () => Promise<void> },
      'refreshDeviceProfiles'
    )
    internals(mod).profiles = [
      { id: 'profA', deviceId: 'devX', components: [] } as unknown as DeviceProfile
    ]
    await mod.allOff()
    expect(refreshSpy).not.toHaveBeenCalled()
  })
})

// The LIVE PAINT PREVIEW maps the editor's active 8×8 hex grid to the rows we
// stream to the panel. It must reject malformed grids (so the paint handler can
// no-op instead of throwing), pass a clean COPY through when no custom wiring is
// set, and re-order through the customMap (logical → physical) exactly like a
// real frame so the preview lands on the same LEDs as the race image.
describe('buildPreviewFrameRows (live paint preview)', () => {
  function litAt(y: number, x: number, hex = '#ff0000'): string[][] {
    const grid = emptyMatrixHexGrid()
    grid[y][x] = hex
    return grid
  }

  it('returns null for a malformed grid (wrong size / type)', () => {
    expect(buildPreviewFrameRows(null, defaultMatrixLayout())).toBeNull()
    expect(buildPreviewFrameRows([['#000000']], defaultMatrixLayout())).toBeNull()
    expect(buildPreviewFrameRows('nope', defaultMatrixLayout())).toBeNull()
    // 8 rows but a short row → still invalid.
    const ragged = emptyMatrixHexGrid()
    ragged[3] = ['#000000']
    expect(buildPreviewFrameRows(ragged, defaultMatrixLayout())).toBeNull()
  })

  it('passes a deep COPY through unchanged when no customMap is set', () => {
    const grid = litAt(2, 5, '#00aaff')
    const rows = buildPreviewFrameRows(grid, defaultMatrixLayout())
    expect(rows).not.toBeNull()
    expect(rows).toEqual(grid)
    // Mutating the result must not touch the caller's grid (no shared rows).
    rows![2][5] = '#000000'
    expect(grid[2][5]).toBe('#00aaff')
  })

  it('re-orders through a valid customMap (logical → physical)', () => {
    // Reverse permutation: logical i lands on physical 63 - i, so the single lit
    // pixel at logical 0 (row0,col0) must surface at physical 63 (row7,col7).
    const customMap = Array.from({ length: RGB_MATRIX_LED_COUNT }, (_, i) => RGB_MATRIX_LED_COUNT - 1 - i)
    const rows = buildPreviewFrameRows(litAt(0, 0, '#ff0000'), { ...defaultMatrixLayout(), customMap })
    expect(rows).not.toBeNull()
    const last = RGB_MATRIX_SIZE - 1
    expect(rows![last][last]).toBe('#ff0000')
    // Everything else is off.
    let lit = 0
    for (const row of rows!) for (const cell of row) if (cell !== '#000000') lit += 1
    expect(lit).toBe(1)
  })
})
