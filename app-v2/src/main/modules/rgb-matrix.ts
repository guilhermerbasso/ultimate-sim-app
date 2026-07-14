import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { formatBrightness, formatMatrixLayout, formatMatrixPixelProbe, formatMatrixRowRgb, formatStripRgb } from '../../shared/companion'
import type { DeviceProfile, RgbMatrixComponent } from '../../shared/devices'
import {
  RGB_MATRIX_EFFECT_CATALOG,
  RGB_MATRIX_GROUP_CATALOG,
  RGB_MATRIX_LED_COUNT,
  RGB_MATRIX_PROFILE_VERSION,
  RGB_MATRIX_SPECIAL_CATALOG,
  RGB_MATRIX_STATUS_LED_CATALOG,
  applyCustomMapToHexRows,
  buildCalibrationRows,
  defaultRgbMatrixProfile,
  detectFlag,
  isMatrixTestMode,
  isValidCustomMap,
  isValidHexGrid,
  normalizeMatrixLayout,
  normalizeRgbMatrixEffects,
  renderMatrixFrame,
  rgbToHex,
  selectRedlineReachedWithHysteresis,
  shiftIndicatorLevel,
  wireLayoutByte,
  type MatrixLayout,
  type RgbMatrixGearEffect,
  type RgbMatrixLeafEffect,
  type RgbMatrixProfile
} from '../../shared/rgb-matrix'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import { getDeviceConfigStore } from '../devices/store'
import { logger } from './logger'
import type { ModuleContext } from '../module-context'
import type { SerialDevice } from '../serial/device'
import { CoalescingFrameWriter } from '../serial/coalescing-writer'
import type { SerialDeviceSummary } from '../../shared/arduino'
import {
  CONFIG_SECTION_RELOAD_SIGNAL,
  type ConfigSectionReloadCallback,
  type ConfigSectionReloadResult
} from '../../shared/config-io'
import {
  addCurrentRgbMatrixBindings,
  bindRgbMatrixProfilesToTargets,
  parseRgbMatrixProfilesPayload,
  rgbMatrixTargetsFromDeviceProfiles,
  type RgbMatrixProfilesPayload
} from './rgb-matrix-profile-store'

const STORE_FILE = 'rgb-matrix-profiles.json'
const PROFILE_REFRESH_MS = 2000
// Per-write cap for the quit-time `allOff()` so a wedged port can't hang the app exit.
const MATRIX_OFF_WRITE_TIMEOUT_MS = 600
const MATRIX_MIN_INTERVAL_MS = 40
const TEST_COMMAND_SETTLE_MS = MATRIX_MIN_INTERVAL_MS
// Steady cadence at which we re-drive every matrix even when NO telemetry
// snapshot is arriving (no sim running). Without this, driveMatrix only ran on
// telemetry snapshots, so with the sim closed a calibration/test pattern stayed
// on the panel forever after its hold expired ("ficou preso no teste"). The
// per-matrix payload gate dedups identical frames, so this never spams serial.
const STEADY_TICK_MS = MATRIX_MIN_INTERVAL_MS
// Re-send the CURRENT matrix frame even when its signature is UNCHANGED at least
// this often (bypassing the per-key dedup). On the slow OLD-bootloader Nano,
// `FastLED.show()` disables interrupts ~2ms during the WS2812 latch and can EAT
// the next atomic `P` pixel-stream; that frame is dropped and the firmware keeps
// the PREVIOUS image — the gear digit "freezes on the previous gear" after a
// shift. The dedup otherwise never re-sends a static frame, so the panel stayed
// stuck until the gear changed AGAIN. At 300ms the worst case — a change-frame
// AND its quick-retry both dropped — self-heals in ~300ms instead of ~700ms; a
// static frame re-sends only ~3.3x/s, negligible on 115200.
const KEYFRAME_MS = 300
// On a CHANGE (gear/flag/content), additionally re-send the SAME frame once this
// soon after, so a single dropped change-frame self-corrects within ~1 tick →
// snappy shifts (the ~300ms keyframe is the slower safety net).
const QUICK_RETRY_MS = 80
// A quick-retry only helps a DISCRETE change (a gear shift / flag onset after the
// panel was otherwise quiet). During CONTINUOUS change (rev-lights animating every
// tick) every frame is a "change", so scheduling a retry per frame would double the
// serial load for no benefit — the 300ms keyframe + the coalescing writer already
// cover dropped frames there. So we only schedule a retry when the previous change
// for this panel was at least this long ago (i.e. the panel had settled).
const DISCRETE_CHANGE_GAP_MS = 150
// After an app-side test we briefly stop driving normal frames to that panel so
// the unambiguous pattern stays visible without leaving the panel frozen.
const CALIBRATION_HOLD_MS = 4000
// The manual per-pixel remap probe lights ONE physical LED and waits for the
// user to tap the matching cell — that can take a while, so hold normal frames
// much longer than a quick calibration test. Cleared as soon as the user
// applies/cancels (setLayout drops the hold).
const MANUAL_PROBE_HOLD_MS = 5 * 60 * 1000
// Forced-visible floor for app-driven panel tests, so a test is never invisible
// because of a low/zero per-component brightness (mirrors the firmware probe).
const PROBE_TEST_BRIGHTNESS = 160
// Green flag "flash" window: when the green flag goes active (standing start or a
// restart, incl. the held-green bit), the iFlag shows green over the gear for this
// long, then returns to the gear even if the green flag is still being waved — so a
// long green display never hides the gear for the whole stint.
const GREEN_FLASH_MS = 4000

// LIVE PAINT PREVIEW (iFlag editor): while the user paints a pixel/frame, the
// renderer debounce-pushes the ACTIVE edited grid here so the physical panel
// mirrors exactly what's on screen (WYSIWYG). We hold off normal frames for this
// long after each push so the steady/telemetry tick can't repaint over the
// painted image; the hold is re-armed on every push (so it stays during active
// editing), auto-restores the live image on expiry (so it never gets stuck if
// the user wanders off), and is cleared immediately by `resume` on editor exit.
const PREVIEW_HOLD_MS = 6000
// Visibility floor for the preview so a 0/low per-component brightness doesn't
// make the painted frame invisible on the panel (mirrors the content tests).
const PREVIEW_MIN_BRIGHTNESS = 48

export type MatrixSendDecision = 'skip' | 'change' | 'keyframe'

export interface MatrixGateState {
  // ms timestamp of the last actual send for this key (0 = never sent).
  lastSentAt: number
  // signature of the last sent frame (null = never sent).
  lastPayload: string | null
  // ms timestamp anchoring the keyframe cadence — set to the last send (0 = never).
  lastKeyframeAt: number
}

// Pure send decision for ONE matrix key, so the gate/keyframe logic is unit
// testable without the Electron module. Order matters: the per-frame min-interval
// is checked FIRST so neither a change nor a keyframe can exceed the frame rate.
//   'change'   — signature differs from the last sent frame → send now (caller
//                also schedules a quick redundant re-send).
//   'keyframe' — signature UNCHANGED but keyframeMs elapsed → re-send the SAME
//                frame so a dropped frame self-heals (bypasses the dedup).
//   'skip'     — throttled by the min-interval, or deduped before a keyframe is due.
export function decideMatrixSend(
  state: MatrixGateState,
  payload: string,
  now: number,
  minIntervalMs: number,
  keyframeMs: number
): MatrixSendDecision {
  if (now - state.lastSentAt < minIntervalMs) return 'skip'
  if (state.lastPayload !== payload) return 'change'
  if (now - state.lastKeyframeAt >= keyframeMs) return 'keyframe'
  return 'skip'
}

// Pure: validate a painted 8×8 hex grid coming from the editor and map it to the
// rows we STREAM to the device for a live paint preview. When a manual wiring
// permutation (customMap) is active the device runs an identity layout and the
// app delivers PHYSICAL-ordered frames, so we re-order the logical grid through
// the map — exactly like driveMatrix does for a real frame — so the preview lands
// on the same physical LEDs as the race image. Returns null for a malformed grid
// so the paint handler can safely no-op instead of throwing.
export function buildPreviewFrameRows(gridInput: unknown, layout: MatrixLayout): string[][] | null {
  if (!isValidHexGrid(gridInput)) return null
  const rows = gridInput.map((row) => row.slice())
  if (isValidCustomMap(layout.customMap)) return applyCustomMapToHexRows(rows, layout.customMap)
  return rows
}

export const RGB_MATRIX_CHANNELS = {
  getProfile: 'rgbmatrix:getProfile',
  setProfile: 'rgbmatrix:setProfile',
  listEffects: 'rgbmatrix:listEffects',
  setLayout: 'rgbmatrix:setLayout',
  calibrate: 'rgbmatrix:calibrate',
  testMapped: 'rgbmatrix:testMapped',
  lightPhysical: 'rgbmatrix:lightPhysical',
  resume: 'rgbmatrix:resume',
  previewFrame: 'rgbmatrix:previewFrame',
  changed: 'rgbmatrix:changed'
} as const

export function register(ctx: ModuleContext): RgbMatrixModule {
  const engine = new RgbMatrixModule(ctx)
  engine.initialize()
  return engine
}

export class RgbMatrixModule {
  private payload: RgbMatrixProfilesPayload = emptyPayload()
  private activeProfiles: Record<string, RgbMatrixProfile> = {}
  private sourceKeyByTarget: Record<string, string> = {}
  private loadError: Error | null = null
  private loadSummary: ConfigSectionReloadResult = emptyReloadResult()
  private loaded = false
  private profiles: DeviceProfile[] = []
  private profilesSig = ''
  private lastSentAt = new Map<string, number>()
  private lastPayload = new Map<string, string>()
  // Per-sendKey anchor for the keyframe cadence: the timestamp of the last frame
  // we actually pushed. Even when the signature is UNCHANGED we re-send (bypassing
  // the dedup) once KEYFRAME_MS has elapsed, so a frame the slow Nano dropped
  // self-heals instead of freezing the panel on the previous image.
  private lastKeyframeAt = new Map<string, number>()
  // Per-sendKey one-shot timer that re-sends a CHANGE frame ~QUICK_RETRY_MS later
  // so a single dropped change-frame corrects within ~1 tick. Replaced by a newer
  // change; cleared on dispose.
  private quickRetryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  // Hot-path serial writer: coalesces live matrix frames so a slow Nano never builds
  // a growing backlog (the panel always renders the freshest frame; stale ones drop).
  private readonly frameWriter = new CoalescingFrameWriter()
  // Last brightness (`B` frame) actually sent per sendKey, so we only re-send the
  // brightness frame when it CHANGES instead of prefixing it to every single frame.
  private lastBrightness = new Map<string, number>()
  // Timestamp of the last CHANGE frame per sendKey — gates the quick-retry so it
  // fires only for discrete shifts/flags, not during continuous rev-light animation.
  private lastChangeAt = new Map<string, number>()
  private effectActivatedAt = new Map<string, number>()
  // Per-flag / per-gear-label activation clock. Key: `${sendKey}:flag:${flag}` or
  // `${sendKey}:gear:${label}`. Lets each flag / gear digit animate on its own
  // clock so a 'once' animation replays every time that specific flag / label
  // becomes active. Pruned when the flag / label is no longer rendered.
  private scopeActivatedAt = new Map<string, number>()
  private gearRedlineLatched = new Map<string, boolean>()
  private transportFailureLogged = new Set<string>()
  // Devices we have already pushed the persisted layout byte to since they last
  // connected. Cleared on any fleet change so a reconnect re-sends the layout.
  private layoutSentTo = new Set<string>()
  // Matrix key (`profileId:componentId`) → timestamp until which we hold off
  // normal frames so a calibration test pattern stays visible.
  private calibrationHoldUntil = new Map<string, number>()
  private holdClearTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private refreshTimer: ReturnType<typeof setInterval> | null = null
  // Steady re-drive timer (drives frames even with no telemetry) — see STEADY_TICK_MS.
  private steadyTimer: ReturnType<typeof setInterval> | null = null
  // Latest telemetry snapshot (may be null when no sim is connected). The steady
  // tick and the resume IPC re-drive the panel with this so a hold expiry / leave
  // immediately repaints the live (or empty) image instead of a stuck test.
  private lastSnapshot: TelemetrySnapshot | null = null
  private disposed = false

  // Green-flag flash state (session-wide). Edge-detect the green flag going active
  // and start a GREEN_FLASH_MS window; re-armed on every fresh green onset (each
  // restart). Evaluated at most once per `now` so all matrix panels share the same
  // flash within a tick.
  private greenFlashAnchorMs: number | null = null
  private greenWasActive = false
  private greenEvalAt = -1
  private greenFlashActiveCached = false

  // F3 iFlag DYNAMIC panel: optional handle injected by index.ts. When enabled it
  // OVERRIDES the normal gear/flag/rev frame with a live race-state panel
  // (position/gap/delta). Structural type to avoid coupling to the module.
  iflagDynamic: { isEnabled(): boolean; getHexGrid(): string[][] | null } | null = null

  private readonly storePath: string

  private readonly onSnapshot = (snapshot: TelemetrySnapshot | null): void => {
    this.lastSnapshot = snapshot
    this.tick(snapshot, Date.now())
  }

  private readonly onFleetChanged = (): void => {
    this.clearDedup()
  }

  private readonly onDeviceConnected = (summary: SerialDeviceSummary): void => {
    if (!summary || !summary.connected) return
    void this.resendLayoutsForDevice(summary.id)
  }

  // The user imported the `rgb-matrix` (iFlag) section: its file on disk was just
  // overwritten, but our `payload` is the OLD in-memory copy cached at boot. Drop
  // it, re-read the file, and clear every per-device dedup/keyframe cache so the
  // next steady tick PUSHES the freshly-imported layout/effects to the panel —
  // applying the import live, with no app restart.
  private readonly onSectionReload = (
    _event: unknown,
    sectionId: string,
    done?: ConfigSectionReloadCallback
  ): void => {
    if (sectionId !== 'rgb-matrix') return
    if (this.disposed) {
      done?.('The iFlag module is not running, so the imported profiles could not be applied.')
      return
    }
    this.loaded = false
    this.loadError = null
    void this.ensureLoaded()
      .then((result) => {
        this.clearDedup()
        const detail = {
          profiles: result.itemCount,
          hotApplied: result.hotAppliedCount,
          unmatched: result.unmatchedItemCount
        }
        if (result.unmatchedItemCount > 0 || (result.itemCount > 0 && result.hotAppliedCount === 0)) {
          logger.error('iflag', 'rgb-matrix profiles reloaded but could not be fully hot-applied', detail)
        } else {
          logger.info('iflag', 'rgb-matrix profiles reloaded after import (hot-apply)', detail)
        }
        done?.(null, result)
      })
      .catch((error) => {
        const message = errorMessage(error)
        logger.error('iflag', 'rgb-matrix profile reload failed (section import)', { message })
        done?.(message)
      })
  }

  constructor(private readonly ctx: ModuleContext) {
    this.storePath = join(ctx.app.getPath('userData'), STORE_FILE)
  }

  initialize(): void {
    this.registerIpc()
    void this.ensureLoaded().catch((error) => {
      logger.error('iflag', 'failed to load rgb-matrix profiles', { message: errorMessage(error) })
    })
    void this.refreshDeviceProfiles()
    this.refreshTimer = setInterval(() => void this.refreshDeviceProfiles(), PROFILE_REFRESH_MS)
    // Re-drive every matrix on a steady cadence so the panel updates to the live
    // (or empty) image even when no telemetry snapshots arrive — this is what
    // releases a panel "preso no teste" once its calibration hold expires.
    this.steadyTimer = setInterval(() => this.tick(this.lastSnapshot, Date.now()), STEADY_TICK_MS)
    this.ctx.telemetryHub.on('snapshot', this.onSnapshot)
    this.ctx.serialHub.on('device-added', this.onFleetChanged)
    this.ctx.serialHub.on('device-removed', this.onFleetChanged)
    this.ctx.serialHub.on('device-updated', this.onDeviceConnected)
    this.ctx.ipcMain.on(CONFIG_SECTION_RELOAD_SIGNAL, this.onSectionReload)
    this.ctx.app.once('before-quit', () => this.dispose())
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer)
      this.refreshTimer = null
    }
    if (this.steadyTimer) {
      clearInterval(this.steadyTimer)
      this.steadyTimer = null
    }
    this.clearQuickRetries()
    this.frameWriter.clearAll()
    this.clearAllTestHolds()
    this.ctx.telemetryHub.off('snapshot', this.onSnapshot)
    this.ctx.serialHub.off('device-added', this.onFleetChanged)
    this.ctx.serialHub.off('device-removed', this.onFleetChanged)
    this.ctx.serialHub.off('device-updated', this.onDeviceConnected)
    this.ctx.ipcMain?.off(CONFIG_SECTION_RELOAD_SIGNAL, this.onSectionReload)
  }

  // Turn EVERY iFlag matrix panel OFF (black) and stop driving — used on app quit so
  // the WS2812 LEDs don't hold their last lit frame after the serial port closes
  // (the firmware only auto-sleeps after ~60s). Devices drain concurrently while
  // each device's ordered brightness/black writes have their own short watchdog.
  // Best-effort; never throws.
  async allOff(): Promise<void> {
    // Stop the drive loop first so nothing repaints over the black frame.
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer)
      this.refreshTimer = null
    }
    if (this.steadyTimer) {
      clearInterval(this.steadyTimer)
      this.steadyTimer = null
    }
    this.clearQuickRetries()
    this.frameWriter.clearAll()
    this.ctx.telemetryHub.off('snapshot', this.onSnapshot)
    // Pull the latest device configs ONLY if we don't already have them. allOff()
    // iterates this.profiles, which the 2s refresh loop populates; on an early quit
    // that loop may not have run yet, leaving it empty — a silent no-op that would
    // leave the panel lit. A lit panel is always driven from this.profiles, so a
    // non-empty list already contains every connected matrix; only refresh when it's
    // empty. refreshDeviceProfiles() is best-effort (never throws) and the all-zeros
    // black frame needs no effect payload, so we don't depend on ensureLoaded() here.
    if (this.profiles.length === 0) {
      await this.refreshDeviceProfiles()
    }
    const primaryId = this.ctx.serialHub.getPrimaryId()
    const black = formatStripRgb(new Array(64).fill('000000'))
    const seen = new Set<string>()
    const targets: Array<{
      device: SerialDevice
      profileId: string
      componentId: string
    }> = []
    for (const profile of this.profiles) {
      for (const component of profile.components) {
        if (component.type !== 'rgbMatrix') continue
        const target = this.resolveMatrixTarget(`${profile.id}:${component.id}`, primaryId)
        if (!target || seen.has(target.device.id)) continue
        seen.add(target.device.id)
        targets.push({
          device: target.device,
          profileId: profile.id,
          componentId: component.id
        })
      }
    }
    await Promise.all(
      targets.map(async ({ device, profileId, componentId }) => {
        try {
          await withWriteTimeout(device.sendRaw(formatBrightness(0)), MATRIX_OFF_WRITE_TIMEOUT_MS)
          if (black) await withWriteTimeout(device.sendRaw(black), MATRIX_OFF_WRITE_TIMEOUT_MS)
        } catch (error) {
          logger.error('iflag', 'failed to turn matrix off during shutdown', {
            deviceId: device.id,
            profileId,
            componentId,
            message: errorMessage(error)
          })
          // best effort — the panel may already be gone or the port wedged
        }
      })
    )
  }

  private registerIpc(): void {
    this.ctx.ipcMain.handle(RGB_MATRIX_CHANNELS.getProfile, async (_event, key: string) => {
      await this.ensureLoaded()
      return this.profileForKey(key) ?? defaultRgbMatrixProfile()
    })
    this.ctx.ipcMain.handle(RGB_MATRIX_CHANNELS.setProfile, async (_event, key: string, input: unknown) => {
      await this.ensureLoaded()
      const profile = normalizeProfile(input)
      this.setProfileForKey(key, profile)
      await this.persist()
      this.lastPayload.clear()
      this.ctx.broadcast(RGB_MATRIX_CHANNELS.changed, { key, profile })
      // Drive the live panel immediately so effect edits auto-apply without
      // waiting for the next steady tick (the renderer debounces these pushes;
      // the per-matrix send-gate still dedups identical frames downstream).
      const target = this.resolveMatrixTarget(key, this.ctx.serialHub.getPrimaryId())
      if (target) {
        this.driveMatrix(target.device, target.deviceProfile, target.component, profile, this.lastSnapshot, Date.now())
      }
      return profile
    })
    this.ctx.ipcMain.handle(RGB_MATRIX_CHANNELS.listEffects, () => ({
      effects: RGB_MATRIX_EFFECT_CATALOG,
      statusLeds: RGB_MATRIX_STATUS_LED_CATALOG,
      groups: RGB_MATRIX_GROUP_CATALOG,
      special: RGB_MATRIX_SPECIAL_CATALOG
    }))
    // Persist the panel layout into the matrix profile and push `M<byte>` to the
    // live device so its EEPROM-stored mapping matches the app immediately.
    this.ctx.ipcMain.handle(RGB_MATRIX_CHANNELS.setLayout, async (_event, key: string, input: unknown) => {
      await this.ensureLoaded()
      const layout = normalizeMatrixLayout(input)
      const existing = this.profileForKey(key) ?? defaultRgbMatrixProfile()
      const profile: RgbMatrixProfile = { ...existing, layout }
      this.setProfileForKey(key, profile)
      await this.persist()
      // Invalidate the per-matrix send-gate so the next live frame re-sends and
      // the firmware re-maps the CURRENT image through the new layout, and drop
      // any calibration hold so live content resumes immediately after "Aplicar
      // layout" (a serpentine toggle then visibly re-maps even a static image).
      this.lastPayload.clear()
      this.clearTestHold(key)
      const sent = this.sendLayoutForKey(key, layout)
      this.ctx.broadcast(RGB_MATRIX_CHANNELS.changed, { key, profile })
      return { profile, sent }
    })
    // Fire a calibration test pattern at the live device so the user can identify
    // the physical wiring. The pixels are streamed as one P-frame (not T/Q) so
    // old-bootloader Nanos never drop row 0 during app-side tests.
    this.ctx.ipcMain.handle(RGB_MATRIX_CHANNELS.calibrate, async (_event, key: string, mode: unknown) => {
      await this.ensureLoaded()
      const target = this.resolveMatrixTarget(key, this.ctx.serialHub.getPrimaryId())
      if (!target) return false
      const value = Number(mode)
      const modes = ['corner', 'row', 'col', 'f'] as const
      const testMode = modes[Number.isFinite(value) ? Math.min(3, Math.max(0, Math.trunc(value))) : 0]
      const matrixProfile = this.profileForKey(key)
      const layout = matrixProfile?.layout ?? defaultRgbMatrixProfile().layout
      let rows = buildCalibrationRows(testMode, matrixProfile)
      if (isValidCustomMap(layout.customMap)) rows = applyCustomMapToHexRows(rows, layout.customMap)
      const targetKey = `${target.deviceProfile.id}:${target.component.id}`
      const sendKey = `${targetKey}:rgbmatrix`
      // Hold BEFORE the awaited M/Y/P send so a steady/telemetry tick during the
      // send can't repaint a normal frame mid-test (TOCTOU), then refresh after.
      this.setTestHold(targetKey, CALIBRATION_HOLD_MS, key)
      const sent = await this.sendAtomicTestFrame(target.device, sendKey, layout, rows, Math.max(PROBE_TEST_BRIGHTNESS, target.component.brightness))
      if (!sent) {
        this.clearTestHold(targetKey)
        return false
      }
      this.setTestHold(targetKey, CALIBRATION_HOLD_MS, key)
      // Invalidate the cached frame signature so the first tick AFTER the hold
      // expires unconditionally re-sends the live frame — otherwise, with static
      // telemetry, the gate would match the pre-calibration cache and leave the
      // panel stuck on the calibration test pattern.
      this.lastPayload.delete(sendKey)
      this.lastSentAt.delete(sendKey)
      return true
    })
    // Manual per-pixel remap probe: light EXACTLY one physical LED (white) so the
    // user can tell the app where it physically sits and build a custom wiring
    // permutation. We use the firmware's raw `I<idx>` command (not a logical Q
    // frame) so the lit LED is deterministic and bright regardless of the layout
    // byte, the per-component brightness, or how a slow board handles a burst of
    // multi-row frames — the exact failure modes that left the panel dark before.
    this.ctx.ipcMain.handle(RGB_MATRIX_CHANNELS.lightPhysical, async (_event, key: string, indexInput: unknown) => {
      await this.ensureLoaded()
      const target = this.resolveMatrixTarget(key, this.ctx.serialHub.getPrimaryId())
      if (!target) return false
      const value = Number(indexInput)
      const physicalIndex = Number.isFinite(value) ? Math.min(RGB_MATRIX_LED_COUNT - 1, Math.max(0, Math.trunc(value))) : 0
      const targetKey = `${target.deviceProfile.id}:${target.component.id}`
      const sendKey = `${target.deviceProfile.id}:${target.component.id}:rgbmatrix`
      this.clearTestHold(targetKey)
      this.safeSend(target.device, sendKey, formatMatrixPixelProbe(physicalIndex))
      // Hold normal frames and invalidate the gate so the lit pixel persists
      // until the user taps (or applies/cancels, which drops the hold).
      this.setTestHold(targetKey, MANUAL_PROBE_HOLD_MS, key)
      this.lastPayload.delete(sendKey)
      this.lastSentAt.delete(sendKey)
      return true
    })

    // Clear any calibration/test hold for a matrix and immediately repaint the
    // live (or empty) image. The workspace calls this when it unmounts or when
    // the user leaves a test, so a panel never stays "preso no teste".
    this.ctx.ipcMain.handle(RGB_MATRIX_CHANNELS.resume, async (_event, key: string) => {
      await this.ensureLoaded()
      this.clearTestHold(key)
      const target = this.resolveMatrixTarget(key, this.ctx.serialHub.getPrimaryId())
      if (!target) return false
      const sendKey = `${target.deviceProfile.id}:${target.component.id}:rgbmatrix`
      this.lastPayload.delete(sendKey)
      this.lastSentAt.delete(sendKey)
      const profile = this.profileForKey(key) ?? defaultRgbMatrixProfile()
      this.driveMatrix(target.device, target.deviceProfile, target.component, profile, this.lastSnapshot, Date.now())
      return true
    })
    // LIVE PAINT PREVIEW: stream the ACTIVE edited 8×8 grid to the panel so the
    // user (e.g. painting a flag/gear frame) sees their pixels on the physical
    // iFlag in real time. Reuses the SAME serial path as the race frames (one
    // atomic `P` stream through the coalescing writer, brightness on-change) —
    // no new protocol. Returns whether a live device was actually reached so the
    // renderer can show an honest "connect the iFlag" hint when it wasn't.
    this.ctx.ipcMain.handle(RGB_MATRIX_CHANNELS.previewFrame, async (_event, key: string, gridInput: unknown) => {
      await this.ensureLoaded()
      const target = this.resolveMatrixTarget(key, this.ctx.serialHub.getPrimaryId())
      if (!target) return false
      const profile = this.profileForKey(key) ?? defaultRgbMatrixProfile()
      const rows = buildPreviewFrameRows(gridInput, profile.layout)
      if (!rows) return false
      const targetKey = `${target.deviceProfile.id}:${target.component.id}`
      const sendKey = `${targetKey}:rgbmatrix`
      // Hold normal frames so a steady/telemetry tick can't repaint over the
      // painted image; re-armed on every push (stays during active editing) and
      // auto-restores live on expiry. Cleared immediately by `resume` on exit.
      this.setTestHold(targetKey, PREVIEW_HOLD_MS, key)
      // Force the wiring byte first (in case no frame has driven this panel yet),
      // then stream the painted grid. Invalidate the per-key gate so the first
      // frame AFTER the hold/resume unconditionally re-sends the live image.
      this.ensureLayout(target.device, profile)
      this.lastPayload.delete(sendKey)
      this.lastSentAt.delete(sendKey)
      const brightness = Math.max(PREVIEW_MIN_BRIGHTNESS, target.component.brightness)
      this.sendFrameRows(target.device, sendKey, rows, brightness, true)
      return true
    })
    // (all-white, corner, row, col, "F"), pushes it through the active customMap
    // (or the firmware layout when none) and streams it as a SINGLE `P` frame at a
    // forced-visible brightness — so the user can confirm the panel + their manual
    // map even with no telemetry, and a slow board renders it in one show.
    this.ctx.ipcMain.handle(RGB_MATRIX_CHANNELS.testMapped, async (_event, key: string, modeInput: unknown) => {
      await this.ensureLoaded()
      const target = this.resolveMatrixTarget(key, this.ctx.serialHub.getPrimaryId())
      if (!target) return false
      const mode = isMatrixTestMode(modeInput) ? modeInput : 'all'
      const matrixProfile = this.profileForKey(key)
      const layout = matrixProfile?.layout
      // Pass the profile so the flag/gear CONTENT tests mirror any custom pixels
      // the user painted for that flag/gear.
      let rows = buildCalibrationRows(mode, matrixProfile)
      if (layout && isValidCustomMap(layout.customMap)) {
        rows = applyCustomMapToHexRows(rows, layout.customMap)
      }
      const targetKey = `${target.deviceProfile.id}:${target.component.id}`
      const sendKey = `${targetKey}:rgbmatrix`
      // Hold BEFORE the awaited send (set here, refreshed after) so a tick during
      // the M/Y/P sequence can't repaint a normal frame mid-test (TOCTOU).
      this.setTestHold(targetKey, CALIBRATION_HOLD_MS, key)
      // Force the correct WIRE layout for this test first (identity when a custom
      // map is active, else the bitfield), so the frame lands correctly even if
      // no telemetry has driven the panel yet this session and the device is still
      // on a stale EEPROM layout.
      // Wiring/shape tests use a forced-visible floor so they're never dark on a
      // low brightness. Content tests (flags/gear) instead honour the component's
      // LIVE brightness — the same value driveMatrix sends in a race — so what the
      // user sees here matches the race (a modest floor still guards against a
      // fully-invisible 0). This stops a bright test from implying a bright race.
      const isContentTest = mode.startsWith('flag-') || mode === 'gear'
      const brightness = isContentTest
        ? Math.max(48, target.component.brightness)
        : Math.max(PROBE_TEST_BRIGHTNESS, target.component.brightness)
      const sent = await this.sendAtomicTestFrame(target.device, sendKey, layout ?? defaultRgbMatrixProfile().layout, rows, brightness)
      if (!sent) {
        this.clearTestHold(targetKey)
        return false
      }
      this.setTestHold(targetKey, CALIBRATION_HOLD_MS, key)
      this.lastPayload.delete(sendKey)
      this.lastSentAt.delete(sendKey)
      return true
    })
  }

  private async sendAtomicTestFrame(
    device: SerialDevice,
    sendKey: string,
    layout: MatrixLayout,
    rows: string[][],
    brightness: number
  ): Promise<boolean> {
    const flat: string[] = []
    for (const row of rows) for (const px of row) flat.push(px)
    const frame = formatStripRgb(flat)
    if (!frame) return false
    try {
      this.layoutSentTo.add(device.id)
      await device.sendRaw(formatMatrixLayout(wireLayoutByte(layout)))
      await delay(TEST_COMMAND_SETTLE_MS)
      await device.sendRaw(formatBrightness(brightness))
      // Keep the brightness latch faithful to the device's ACTUAL state: this test
      // frame just forced the panel to `brightness` (a visibility floor), so record
      // it. Otherwise the on-change gate would think the live brightness was never
      // changed and skip re-asserting `Y` after the hold, stranding the panel at the
      // test brightness until the user moved the slider or reconnected.
      this.lastBrightness.set(sendKey, brightness)
      await delay(TEST_COMMAND_SETTLE_MS)
      await device.sendRaw(frame)
      return true
    } catch (error) {
      logger.error('iflag', 'failed to send matrix test frame', {
        deviceId: device.id,
        sendKey,
        message: errorMessage(error)
      })
      this.layoutSentTo.delete(device.id)
      this.lastPayload.delete(sendKey)
      this.lastSentAt.delete(sendKey)
      return false
    }
  }

  private setTestHold(targetKey: string, durationMs: number, profileKey: string): void {
    this.clearTestHold(targetKey)
    this.calibrationHoldUntil.set(targetKey, Date.now() + durationMs)
    const timer = setTimeout(() => {
      this.clearTestHold(targetKey)
      void this.repaintMatrix(profileKey)
    }, durationMs)
    this.holdClearTimers.set(targetKey, timer)
  }

  private clearTestHold(targetKey: string): void {
    this.calibrationHoldUntil.delete(targetKey)
    const timer = this.holdClearTimers.get(targetKey)
    if (timer) clearTimeout(timer)
    this.holdClearTimers.delete(targetKey)
  }

  private clearAllTestHolds(): void {
    for (const timer of this.holdClearTimers.values()) clearTimeout(timer)
    this.holdClearTimers.clear()
    this.calibrationHoldUntil.clear()
  }

  private async repaintMatrix(key: string): Promise<boolean> {
    await this.ensureLoaded()
    const target = this.resolveMatrixTarget(key, this.ctx.serialHub.getPrimaryId())
    if (!target) return false
    const sendKey = `${target.deviceProfile.id}:${target.component.id}:rgbmatrix`
    this.lastPayload.delete(sendKey)
    this.lastSentAt.delete(sendKey)
    const profile = this.profileForKey(key) ?? defaultRgbMatrixProfile()
    this.driveMatrix(target.device, target.deviceProfile, target.component, profile, this.lastSnapshot, Date.now())
    return true
  }

  // Push a full 8×8 frame. The LIVE path ALWAYS streams (see driveMatrix): one
  // `P` pixel-stream is a single accumulate-then-show on the firmware — atomic and
  // far more robust on slow/old boards than a burst of eight per-row `Q` frames,
  // where a single dropped row leaves a stale logical row that the firmware's
  // serpentine/rotation remap surfaces as a frozen physical column. The per-row
  // `Q` path is kept only as an explicit fallback (`stream === false`). Whether
  // the rows are logical- or physical-ordered is decided by the caller (customMap)
  // and is orthogonal to the transport.
  private sendFrameRows(device: SerialDevice, sendKey: string, rows: string[][], brightness: number, stream: boolean): void {
    // Brightness (`B`) is device-global and changes rarely (the user dragging the
    // slider), so send it ONLY when it changes — and via the DIRECT path, never the
    // coalescing writer, so a brightness change can never be dropped by frame
    // coalescing. Roll the latch back if the write fails so the next frame re-asserts.
    if (this.lastBrightness.get(sendKey) !== brightness) {
      const prev = this.lastBrightness.get(sendKey)
      this.lastBrightness.set(sendKey, brightness)
      void device.sendRaw(formatBrightness(brightness)).catch((error) => {
        if (prev === undefined) this.lastBrightness.delete(sendKey)
        else this.lastBrightness.set(sendKey, prev)
        this.lastPayload.delete(sendKey)
        this.lastSentAt.delete(sendKey)
        this.logTransportFailureOnce(`${sendKey}:brightness`, 'failed to send matrix brightness', {
          deviceId: device.id,
          sendKey,
          brightness,
          message: errorMessage(error)
        })
      })
    }
    const frames: string[] = []
    if (stream) {
      const flat: string[] = []
      for (const row of rows) for (const px of row) flat.push(px)
      const frame = formatStripRgb(flat)
      if (frame) frames.push(frame)
    } else {
      for (let row = 0; row < rows.length; row += 1) {
        frames.push(formatMatrixRowRgb(row, rows[row], 8))
      }
    }
    if (frames.length === 0) return
    // Route the live frame through the coalescing writer: at most one write in flight
    // + one pending (latest) per device, so a slow Nano never builds a growing
    // backlog — the panel always renders the freshest frame; stale frames are dropped.
    this.frameWriter.push(device, frames, (error) => {
      this.lastPayload.delete(sendKey)
      this.lastSentAt.delete(sendKey)
      this.logTransportFailureOnce(`${sendKey}:frame`, 'failed to send matrix frame', {
        deviceId: device.id,
        sendKey,
        frames: frames.length,
        message: errorMessage(error)
      })
    })
  }

  private async ensureLoaded(): Promise<ConfigSectionReloadResult> {
    if (this.loaded) {
      if (this.loadError) throw this.loadError
      return this.loadSummary
    }
    if (this.profiles.length === 0) await this.refreshDeviceProfiles()
    try {
      const raw = JSON.parse(await readFile(this.storePath, 'utf8')) as unknown
      this.payload = parseRgbMatrixProfilesPayload(raw).payload
      this.rebindProfiles()
      this.loadError = null
    } catch (error) {
      if (isMissingFile(error)) {
        this.payload = emptyPayload()
        this.activeProfiles = {}
        this.sourceKeyByTarget = {}
        this.loadSummary = emptyReloadResult()
        this.loadError = null
      } else {
        const parsedError =
          error instanceof SyntaxError
            ? new Error(`Invalid iFlag profile file: malformed JSON (${error.message}).`)
            : error instanceof Error
              ? error
              : new Error(String(error))
        this.payload = emptyPayload()
        this.activeProfiles = {}
        this.sourceKeyByTarget = {}
        this.loadSummary = emptyReloadResult()
        this.loadError = parsedError
      }
    }
    this.loaded = true
    if (this.loadError) throw this.loadError
    return this.loadSummary
  }

  private rebindProfiles(): void {
    const bound = bindRgbMatrixProfilesToTargets(
      this.payload,
      rgbMatrixTargetsFromDeviceProfiles(this.profiles)
    )
    this.activeProfiles = bound.profiles
    this.sourceKeyByTarget = bound.sourceKeyByTarget
    this.loadSummary = {
      sectionId: 'rgb-matrix',
      itemCount: bound.sourceProfileCount,
      hotAppliedCount: bound.appliedTargetCount,
      unmatchedItemCount: bound.unmatchedSourceKeys.length
    }
  }

  private profileForKey(key: string): RgbMatrixProfile | undefined {
    return this.activeProfiles[key] ?? this.payload.profiles[key]
  }

  private localizeSourceProfile(sourceKey: string): void {
    const targetKeys = Object.entries(this.sourceKeyByTarget)
      .filter(([, mappedSourceKey]) => mappedSourceKey === sourceKey)
      .map(([targetKey]) => targetKey)
    if (targetKeys.length === 0 || targetKeys.every((targetKey) => targetKey === sourceKey)) return
    for (const targetKey of targetKeys) {
      const active = this.activeProfiles[targetKey]
      if (!active) continue
      this.payload.profiles[targetKey] = active
      this.sourceKeyByTarget[targetKey] = targetKey
    }
    delete this.payload.profiles[sourceKey]
    if (this.payload.bindings) delete this.payload.bindings[sourceKey]
  }

  private setProfileForKey(key: string, profile: RgbMatrixProfile): void {
    const sourceKey = this.sourceKeyByTarget[key]
    if (sourceKey && sourceKey !== key) this.localizeSourceProfile(sourceKey)
    this.payload.profiles[key] = profile
    this.activeProfiles[key] = profile
    this.sourceKeyByTarget[key] = key
  }

  private async persist(): Promise<void> {
    addCurrentRgbMatrixBindings(this.payload, rgbMatrixTargetsFromDeviceProfiles(this.profiles))
    this.payload.updatedAt = new Date().toISOString()
    await mkdir(dirname(this.storePath), { recursive: true })
    await writeFile(this.storePath, JSON.stringify(this.payload, null, 2), 'utf8')
  }

  private async refreshDeviceProfiles(): Promise<void> {
    try {
      const store = getDeviceConfigStore(this.ctx.app)
      await store.ensureLoaded()
      const list = store.list()
      const sig = JSON.stringify(list, (key, value) => (key === 'updatedAt' || key === 'createdAt' ? undefined : value))
      if (sig !== this.profilesSig) {
        this.profilesSig = sig
        this.profiles = list
        if (this.loaded && !this.loadError) this.rebindProfiles()
        this.clearDedup()
      }
    } catch {
      // Keep last known device profiles.
    }
  }

  private tick(snapshot: TelemetrySnapshot | null, now: number): void {
    if (this.disposed || this.profiles.length === 0) return
    const primaryId = this.ctx.serialHub.getPrimaryId()
    for (const [key, matrixProfile] of Object.entries(this.activeProfiles)) {
      const target = this.resolveMatrixTarget(key, primaryId)
      if (!target) continue
      this.driveMatrix(target.device, target.deviceProfile, target.component, matrixProfile, snapshot, now)
    }
  }

  // Resolve the live serial device that should be driven for a matrix profile.
  // The ONLY device we must never treat as a matrix target is the actual SIM-X
  // buttonbox (kind === 'sim-x'). We must NOT skip a device merely because it is
  // the hub's primary: a standalone iFlag panel is frequently the only connected
  // serial device and therefore the primaryId, and skipping it left the panel
  // unresponsive to every effect/layout edit. `primaryId` is kept in the
  // signature for call-site compatibility but is intentionally not used to gate.
  private resolveGenericDevice(profile: DeviceProfile, _primaryId: string | null): SerialDevice | null {
    if (!profile.deviceId) return null
    const device = this.ctx.serialHub.getDevice(profile.deviceId)
    if (!device || !device.isOpen()) return null
    if (device.kind === 'sim-x') return null
    return device
  }

  private resolveMatrixTarget(
    key: string,
    primaryId: string | null
  ): { device: SerialDevice; deviceProfile: DeviceProfile; component: RgbMatrixComponent } | null {
    const separator = key.indexOf(':')
    if (separator <= 0 || separator >= key.length - 1) return null
    const deviceProfileId = key.slice(0, separator)
    const componentId = key.slice(separator + 1)
    const deviceProfile = this.profiles.find((profile) => profile.id === deviceProfileId)
    if (!deviceProfile) return null
    const component = deviceProfile.components.find(
      (entry): entry is RgbMatrixComponent => entry.type === 'rgbMatrix' && entry.id === componentId
    )
    if (!component || !component.enabled || component.mode !== 'iflag') return null
    const device = this.resolveGenericDevice(deviceProfile, primaryId)
    if (!device) return null
    return { device, deviceProfile, component }
  }

  // Session-wide green-flag flash gate. Rising edge of the green flag (incl. held
  // green at restarts) anchors a GREEN_FLASH_MS window; clearing the flag disarms it
  // so the NEXT green onset (restart) flashes again. Memoised per `now` so every
  // panel in a tick agrees.
  private greenFlashActive(snapshot: TelemetrySnapshot | null, now: number): boolean {
    if (now === this.greenEvalAt) return this.greenFlashActiveCached
    this.greenEvalAt = now
    // Anchor on the VISIBLE green (detectFlag), not the raw green bit: at a restart
    // greenHeld (0x0400) co-asserts while a caution is still up, so the raw bit would
    // start (and expire) the window behind the yellow and never flash. detectFlag
    // gives caution priority, so this only fires once green is actually shown.
    const active = Boolean(snapshot?.connected) && detectFlag(snapshot?.flags ?? undefined) === 'green'
    if (active && !this.greenWasActive) this.greenFlashAnchorMs = now
    if (!active) this.greenFlashAnchorMs = null
    this.greenWasActive = active
    this.greenFlashActiveCached =
      active && this.greenFlashAnchorMs !== null && now - this.greenFlashAnchorMs < GREEN_FLASH_MS
    return this.greenFlashActiveCached
  }

  private driveMatrix(
    device: SerialDevice,
    deviceProfile: DeviceProfile,
    component: RgbMatrixComponent,
    profile: RgbMatrixProfile,
    snapshot: TelemetrySnapshot | null,
    now: number
  ): void {
    this.ensureLayout(device, profile)
    const targetKey = `${deviceProfile.id}:${component.id}`
    if (now < (this.calibrationHoldUntil.get(targetKey) ?? 0)) return
    const sendKey = `${deviceProfile.id}:${component.id}:rgbmatrix`
    const renderedEffectKeys = new Set<string>()
    const renderedScopeKeys = new Set<string>()
    const frame = renderMatrixFrame(profile, snapshot, now, {
      elapsedMsForEffect: (effect) => this.effectElapsedMs(sendKey, effect, now, renderedEffectKeys),
      elapsedMsForAnimationScope: (_effect, scope, key) => this.scopeElapsedMs(sendKey, scope, key, now, renderedScopeKeys),
      redlineReachedForEffect: (effect, telemetry) => this.redlineReached(sendKey, effect, telemetry),
      greenFlashActive: this.greenFlashActive(snapshot, now)
    })
    this.pruneInactiveEffects(sendKey, renderedEffectKeys)
    this.pruneInactiveScopes(sendKey, renderedScopeKeys)
    let rows = frame.map((row) => row.map(rgbToHex))
    // F3 iFlag DYNAMIC panel: when the user enables it, override the normal
    // gear/flag/rev frame with the live race-state grid (position/gap/delta). Only
    // when enabled AND it returns a valid 8-row grid; otherwise the normal frame stands.
    const dynamicRows = this.iflagDynamic?.isEnabled() ? this.iflagDynamic.getHexGrid() : null
    if (dynamicRows && dynamicRows.length === rows.length && dynamicRows.every((r) => r.length === rows[0]?.length)) rows = dynamicRows
    // When a manual wiring permutation is active, the device runs an identity
    // layout and the app delivers PHYSICAL-ordered frames (streamed as one `P`):
    // re-order the logical image into physical order so customMap alone decides
    // the wiring.
    let custom = false
    if (isValidCustomMap(profile.layout.customMap)) {
      custom = true
      rows = applyCustomMapToHexRows(rows, profile.layout.customMap)
    }
    // Drive the LIVE frame as ONE atomic `P` stream (never eight per-row `Q`
    // frames). On a slow/old Nano a dropped/corrupted `Q` row used to leave that
    // LOGICAL row stale; after the firmware's serpentine/rotation remap a stale
    // logical row surfaces as a FROZEN physical column ("the first column doesn't
    // match the current state"). A single P-stream is all-or-nothing — the
    // firmware only shows it once every pixel arrived — so every frame refreshes
    // all 64 physical LEDs or none, never a mix of fresh + stale. `custom` only
    // marks whether the rows were pre-mapped to physical order (identity wiring).
    const signature = `${component.brightness}|${custom ? 'C' : 'L'}|${rows.map((row) => row.join('')).join('|')}`
    const decision = this.gate(sendKey, signature, MATRIX_MIN_INTERVAL_MS, now)
    if (decision === 'skip') return
    this.sendFrameRows(device, sendKey, rows, component.brightness, true)
    // A CHANGE frame is the one a dropped P-stream would FREEZE on the previous
    // image, so schedule ONE quick redundant re-send to self-correct a single drop.
    // But ONLY for a DISCRETE change (the panel had settled ≥ DISCRETE_CHANGE_GAP_MS
    // ago) — during continuous rev-light animation every tick is a "change", so a
    // per-tick retry would just double the serial load; the ~300ms keyframe + the
    // coalescing writer already self-heal drops there.
    if (decision === 'change') {
      const prevChangeAt = this.lastChangeAt.get(sendKey) ?? 0
      this.lastChangeAt.set(sendKey, now)
      if (now - prevChangeAt >= DISCRETE_CHANGE_GAP_MS) {
        // Semantic render decision on a DISCRETE change (shift / flag / gear digit),
        // NOT during continuous rev-light animation — so a log capture shows WHICH
        // flag/gear the panel decided to paint (e.g. proves a yellow was chosen).
        logger.debug('iflag', 'render', {
          sendKey,
          flag: detectFlag(snapshot?.flags ?? undefined),
          gear: snapshot?.gear,
          greenFlash: this.greenFlashActiveCached,
          brightness: component.brightness,
          custom,
          head: signature.slice(0, 18)
        })
        this.scheduleQuickRetry(targetKey, sendKey, device, rows, component.brightness)
      } else {
        // Continuous change (rev-lights): the stream of live frames + the ~300ms
        // keyframe already self-heal a dropped frame, so cancel any pending (now
        // stale) retry from the previous discrete change instead of re-sending it.
        this.cancelQuickRetry(sendKey)
      }
    }
  }

  private effectElapsedMs(sendKey: string, effect: RgbMatrixLeafEffect, now: number, renderedEffectKeys: Set<string>): number {
    const key = this.effectStateKey(sendKey, effect.id)
    renderedEffectKeys.add(key)
    let activatedAt = this.effectActivatedAt.get(key)
    if (activatedAt === undefined) {
      activatedAt = now
      this.effectActivatedAt.set(key, activatedAt)
    }
    return Math.max(0, now - activatedAt)
  }

  // Activation clock for ONE flag / gear-label sub-animation. The key
  // (`${sendKey}:flag:${flag}` / `${sendKey}:gear:${label}`) is distinct per flag
  // / digit, so each animates independently and — because the clock is pruned the
  // moment that flag / label stops rendering — a 'once' animation restarts from
  // frame 0 every time it becomes active again.
  private scopeElapsedMs(sendKey: string, scope: 'flag' | 'gear', key: string, now: number, renderedScopeKeys: Set<string>): number {
    const stateKey = `${sendKey}:${scope}:${key}`
    renderedScopeKeys.add(stateKey)
    let activatedAt = this.scopeActivatedAt.get(stateKey)
    if (activatedAt === undefined) {
      activatedAt = now
      this.scopeActivatedAt.set(stateKey, activatedAt)
    }
    return Math.max(0, now - activatedAt)
  }

  private redlineReached(sendKey: string, effect: RgbMatrixGearEffect, telemetry: TelemetrySnapshot | null): boolean {
    const key = this.effectStateKey(sendKey, `${effect.id}:redline`)
    const pct = shiftIndicatorLevel(telemetry)
    const wasLatched = this.gearRedlineLatched.get(key) === true
    const next = selectRedlineReachedWithHysteresis(pct, wasLatched)
    this.gearRedlineLatched.set(key, next)
    return next
  }

  private pruneInactiveEffects(sendKey: string, activeKeys: Set<string>): void {
    const prefix = `${sendKey}:effect:`
    for (const key of this.effectActivatedAt.keys()) {
      if (key.startsWith(prefix) && !activeKeys.has(key)) this.effectActivatedAt.delete(key)
    }
    for (const key of this.gearRedlineLatched.keys()) {
      if (key.startsWith(prefix) && !activeKeys.has(key.replace(/:redline$/, ''))) this.gearRedlineLatched.delete(key)
    }
  }

  // Drop per-flag / per-gear-label clocks that were not rendered this frame, so an
  // inactive flag / gear digit restarts its animation next time it shows.
  private pruneInactiveScopes(sendKey: string, activeKeys: Set<string>): void {
    const flagPrefix = `${sendKey}:flag:`
    const gearPrefix = `${sendKey}:gear:`
    for (const key of this.scopeActivatedAt.keys()) {
      if ((key.startsWith(flagPrefix) || key.startsWith(gearPrefix)) && !activeKeys.has(key)) {
        this.scopeActivatedAt.delete(key)
      }
    }
  }

  private effectStateKey(sendKey: string, effectId: string): string {
    return `${sendKey}:effect:${effectId}`
  }

  // Push the persisted layout byte to a device exactly once per connection,
  // right before its first frame, so the firmware's EEPROM mapping matches the
  // saved profile even if the layout changed while the panel was unplugged.
  private ensureLayout(device: SerialDevice, profile: RgbMatrixProfile): void {
    if (this.layoutSentTo.has(device.id)) return
    this.layoutSentTo.add(device.id)
    this.safeSendLayout(device, formatMatrixLayout(wireLayoutByte(profile.layout)))
  }

  // Send the layout for a single profile key to its live device (used by the
  // setLayout IPC so "Aplicar layout" takes effect without waiting for a tick).
  private sendLayoutForKey(key: string, layout: MatrixLayout): boolean {
    const target = this.resolveMatrixTarget(key, this.ctx.serialHub.getPrimaryId())
    if (!target) return false
    this.layoutSentTo.add(target.device.id)
    this.safeSendLayout(target.device, formatMatrixLayout(wireLayoutByte(layout)))
    return true
  }

  // Re-send saved layouts when a device (re)connects (device-updated event).
  private async resendLayoutsForDevice(deviceId: string): Promise<void> {
    await this.ensureLoaded()
    const primaryId = this.ctx.serialHub.getPrimaryId()
    for (const [key, profile] of Object.entries(this.activeProfiles)) {
      const target = this.resolveMatrixTarget(key, primaryId)
      if (target && target.device.id === deviceId) {
        this.layoutSentTo.add(target.device.id)
        this.safeSendLayout(target.device, formatMatrixLayout(wireLayoutByte(profile.layout)))
      }
    }
  }

  private safeSendLayout(device: SerialDevice, frame: string): void {
    void device.sendRaw(frame).catch((error) => {
      // Port may not have been ready yet; allow a retry on the next tick/event.
      this.layoutSentTo.delete(device.id)
      this.logTransportFailureOnce(`${device.id}:layout`, 'failed to send matrix layout', {
        deviceId: device.id,
        frame,
        message: errorMessage(error)
      })
    })
  }

  private gate(key: string, payload: string, minIntervalMs: number, now: number): MatrixSendDecision {
    const decision = decideMatrixSend(
      {
        lastSentAt: this.lastSentAt.get(key) ?? 0,
        lastPayload: this.lastPayload.get(key) ?? null,
        lastKeyframeAt: this.lastKeyframeAt.get(key) ?? 0
      },
      payload,
      now,
      minIntervalMs,
      KEYFRAME_MS
    )
    if (decision === 'skip') return 'skip'
    // On any actual send (change OR keyframe) reset all three clocks: lastSentAt +
    // lastPayload feed the min-interval + dedup, and lastKeyframeAt re-anchors the
    // next redundant keyframe so a STATIC frame re-sends only ~3.3x/s.
    this.lastSentAt.set(key, now)
    this.lastPayload.set(key, payload)
    this.lastKeyframeAt.set(key, now)
    return decision
  }

  // Schedule ONE redundant re-send of the SAME frame shortly after a CHANGE so a
  // single dropped change-frame (the slow Nano eating the `P` stream during a
  // FastLED latch) self-corrects within ~1 tick → snappy shifts. A newer change
  // replaces this timer; dispose() clears it. The re-send bypasses the dedup gate
  // but is suppressed if a calibration hold has begun since, and safeSend swallows
  // any disconnect error — so it is safe if the device went away.
  private scheduleQuickRetry(
    targetKey: string,
    sendKey: string,
    device: SerialDevice,
    rows: string[][],
    brightness: number
  ): void {
    const existing = this.quickRetryTimers.get(sendKey)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      this.quickRetryTimers.delete(sendKey)
      if (this.disposed) return
      if (Date.now() < (this.calibrationHoldUntil.get(targetKey) ?? 0)) return
      this.sendFrameRows(device, sendKey, rows, brightness, true)
    }, QUICK_RETRY_MS)
    this.quickRetryTimers.set(sendKey, timer)
  }

  private clearQuickRetries(): void {
    for (const timer of this.quickRetryTimers.values()) clearTimeout(timer)
    this.quickRetryTimers.clear()
  }

  // Cancel a single pending quick-retry (used when a continuous change supersedes it,
  // so a now-stale frame is never re-sent over the live animation).
  private cancelQuickRetry(sendKey: string): void {
    const timer = this.quickRetryTimers.get(sendKey)
    if (timer) {
      clearTimeout(timer)
      this.quickRetryTimers.delete(sendKey)
    }
  }

  private safeSend(device: SerialDevice, key: string, frame: string): void {
    void device.sendRaw(frame).catch((error) => {
      this.lastPayload.delete(key)
      this.lastSentAt.delete(key)
      this.logTransportFailureOnce(`${key}:command`, 'failed to send matrix command', {
        deviceId: device.id,
        key,
        frameHead: frame.slice(0, 8),
        message: errorMessage(error)
      })
    })
  }

  private logTransportFailureOnce(key: string, message: string, detail: unknown): void {
    if (this.transportFailureLogged.has(key)) return
    this.transportFailureLogged.add(key)
    logger.error('iflag', message, detail)
  }

  private clearDedup(): void {
    this.lastSentAt.clear()
    this.lastPayload.clear()
    this.lastKeyframeAt.clear()
    this.clearQuickRetries()
    this.frameWriter.clearAll()
    this.lastBrightness.clear()
    this.lastChangeAt.clear()
    this.effectActivatedAt.clear()
    this.scopeActivatedAt.clear()
    this.gearRedlineLatched.clear()
    this.layoutSentTo.clear()
    this.transportFailureLogged.clear()
    this.clearAllTestHolds()
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Resolve when `p` settles OR after `ms` — so a never-draining serial write can't
// hang the quit-time allOff(). The orphaned write settles/rejects later harmlessly.
function withWriteTimeout<T>(p: Promise<T>, ms: number): Promise<T | void> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<void>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`matrix shutdown write timed out after ${ms}ms`)), ms)
  })
  return Promise.race([p.finally(() => clearTimeout(timer)), timeout])
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT'
}

function emptyReloadResult(): ConfigSectionReloadResult {
  return { sectionId: 'rgb-matrix', itemCount: 0, hotAppliedCount: 0, unmatchedItemCount: 0 }
}

function emptyPayload(): RgbMatrixProfilesPayload {
  return { version: RGB_MATRIX_PROFILE_VERSION, profiles: {}, updatedAt: new Date(0).toISOString() }
}

function normalizeProfile(input: unknown): RgbMatrixProfile {
  if (!input || typeof input !== 'object') return defaultRgbMatrixProfile()
  const candidate = input as Partial<RgbMatrixProfile>
  return {
    version: RGB_MATRIX_PROFILE_VERSION,
    layout: normalizeMatrixLayout(candidate.layout),
    // Fills missing per-effect brightness (→ full), defaults gear/flags modes and
    // drops malformed custom grids, so profiles saved before these fields existed
    // keep working without a version migration.
    effects: normalizeRgbMatrixEffects(candidate.effects)
  }
}
