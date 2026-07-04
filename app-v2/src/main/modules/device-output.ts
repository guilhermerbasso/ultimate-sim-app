// Generic-device output engine: turns telemetry snapshots into companion-v2
// serial frames for the Arduino "Hardware Hub" — but ONLY for generic
// (non SIM-X) devices. The legacy rev-lights/OLED engines own the SIM-X primary
// box; double-driving it would corrupt its serial stream, so every profile that
// resolves to the SIM-X primary (or to a missing/closed device) is skipped here.
//
// This module is additive: it owns its own DeviceConfigStore reads (re-polled at
// low frequency because there is no main-side device-config event bus) and never
// touches the SIM-X engines, the hub UI/backend, or the OLED/RevlightsViews.
//
// Robustness rules: never throw inside the tick, swallow serial errors per send
// (a disconnected device must not crash the loop), throttle each component to
// ≤25Hz, and dedup identical frames so the bus isn't flooded.

import {
  COMPANION_V2_MAX_COMMAND_LEN,
  formatAddressableLed,
  formatBrightness,
  formatGaugeAngle,
  formatOledRow,
  formatSegText,
  formatStripRgb
} from '../../shared/companion'
import type { DeviceComponent, DeviceProfile } from '../../shared/devices'
import { getDeviceConfigStore } from '../devices/store'
import {
  gaugeAngle,
  oledRows,
  segValue,
  startLedOn,
  stripColors
} from '../devices/engines/render'
import type { ModuleContext } from '../module-context'
import type { SerialDevice } from '../serial/device'
import type { TelemetrySnapshot } from '../../shared/telemetry'

// Re-read the persisted device profiles this often. The device-config module
// broadcasts `DEVICES_CHANNELS.changed` to renderers, but there is no main-side
// bus, so we poll the store file at low frequency and cache the parsed copy.
const PROFILE_REFRESH_MS = 2000

// Don't run the per-profile work more than ~33Hz even if snapshots arrive faster.
const TICK_MIN_INTERVAL_MS = 30

// Per-component serial send floors (ms). None exceed 25Hz (40ms) per the cap.
const STRIP_MIN_INTERVAL_MS = 40 // ≤25Hz — rev lights / shift blink
const SCREEN_MIN_INTERVAL_MS = 250 // ~4Hz — OLED text page
const SEG_MIN_INTERVAL_MS = 120 // ~8Hz
const GAUGE_MIN_INTERVAL_MS = 60 // ~16Hz
const STARTLED_MIN_INTERVAL_MS = 60 // event-driven via dedup

// This engine only drives generic (non SIM-X) devices, whose firmware accepts the
// full v2 line length; SerialDevice.sendRaw enforces the per-kind ceiling. Frames
// longer than this are capped (strip) or skipped (others) rather than thrown.
const MAX_FRAME_LEN = COMPANION_V2_MAX_COMMAND_LEN
// Largest LED count that fits one `P<rrggbb...>` strip frame within the ceiling.
// The companion firmware parses `P` as a pixel stream (6 hex/LED) terminated by
// '\n' (see firmware/companion-iflag/companion_iflag.ino → startPixelStream),
// so this `P` frame and the firmware parser MUST stay in sync. A full 8x8 iFlag
// (64 px = 385 chars) exceeds the ceiling, which is why the RGB Matrix is driven
// row-by-row with `Q<row>:<hex>` frames in modules/rgb-matrix.ts instead.
const MAX_STRIP_LEDS = Math.floor((MAX_FRAME_LEN - 1) / 6)

export function register(ctx: ModuleContext): void {
  const engine = new DeviceOutputEngine(ctx)
  engine.initialize()
}

class DeviceOutputEngine {
  private profiles: DeviceProfile[] = []
  private profilesSig = ''
  private latest: TelemetrySnapshot | null = null
  private lastTickAt = 0
  private refreshTimer: ReturnType<typeof setInterval> | null = null
  private disposed = false

  // key → last serial send timestamp (ms) for ≤Hz throttling.
  private readonly lastSentAt = new Map<string, number>()
  // key → last rendered payload string (dedup identical sends).
  private readonly lastPayload = new Map<string, string>()

  private readonly onSnapshot = (snapshot: TelemetrySnapshot | null): void => {
    this.latest = snapshot
    this.tick(snapshot)
  }

  // A board resets on serial (re)open and loses its output state, so drop the
  // dedup cache whenever the fleet changes; the next tick re-pushes everything.
  private readonly onFleetChanged = (): void => {
    this.clearDedup()
  }

  constructor(private readonly ctx: ModuleContext) {}

  initialize(): void {
    void this.refreshProfiles()
    this.refreshTimer = setInterval(() => void this.refreshProfiles(), PROFILE_REFRESH_MS)

    this.ctx.telemetryHub.on('snapshot', this.onSnapshot)
    this.latest = this.ctx.telemetryHub.getLatest()
    this.ctx.serialHub.on('device-added', this.onFleetChanged)
    this.ctx.serialHub.on('device-removed', this.onFleetChanged)

    this.ctx.app.once('before-quit', () => this.dispose())
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer)
      this.refreshTimer = null
    }
    this.ctx.telemetryHub.off('snapshot', this.onSnapshot)
    this.ctx.serialHub.off('device-added', this.onFleetChanged)
    this.ctx.serialHub.off('device-removed', this.onFleetChanged)
  }

  // ─── Profile polling ───────────────────────────────────────────────────────

  private async refreshProfiles(): Promise<void> {
    try {
      // A fresh store re-reads the file (ensureLoaded caches per instance).
      const store = getDeviceConfigStore(this.ctx.app)
      await store.ensureLoaded()
      const list = store.list()
      // Sign only meaningful config — drop volatile updatedAt/createdAt at ANY
      // nesting level (profile + embedded revlights) so the dedup cache isn't
      // wiped every poll by re-stamped timestamps.
      const sig = JSON.stringify(list, (key, value) =>
        key === 'updatedAt' || key === 'createdAt' ? undefined : value
      )
      if (sig !== this.profilesSig) {
        this.profilesSig = sig
        this.profiles = list
        // Config changed (components added/retargeted) — force a clean re-push.
        this.clearDedup()
      }
    } catch {
      // Keep the previous cached profiles on a transient read error.
    }
  }

  // ─── Tick ────────────────────────────────────────────────────────────────────

  private tick(snapshot: TelemetrySnapshot | null): void {
    if (this.disposed) return
    const now = Date.now()
    if (now - this.lastTickAt < TICK_MIN_INTERVAL_MS) return
    this.lastTickAt = now
    if (this.profiles.length === 0) return

    const primaryId = this.ctx.serialHub.getPrimaryId()
    for (const profile of this.profiles) {
      const device = this.resolveGenericDevice(profile, primaryId)
      if (!device) continue
      for (const component of profile.components) {
        if (!component.enabled) continue
        try {
          this.driveComponent(device, profile, component, snapshot, now)
        } catch {
          // Never let one component's render/throw abort the rest of the loop.
        }
      }
    }
  }

  // Resolve the generic serial device a profile drives, or null when it must be
  // skipped: no deviceId, device absent/closed, or it is the SIM-X primary.
  private resolveGenericDevice(profile: DeviceProfile, primaryId: string | null): SerialDevice | null {
    if (!profile.deviceId) return null
    const device = this.ctx.serialHub.getDevice(profile.deviceId)
    if (!device) return null
    if (device.kind === 'sim-x') return null
    if (primaryId && device.id === primaryId) return null
    if (!device.isOpen()) return null
    return device
  }

  private driveComponent(
    device: SerialDevice,
    profile: DeviceProfile,
    component: DeviceComponent,
    snapshot: TelemetrySnapshot | null,
    now: number
  ): void {
    switch (component.type) {
      case 'rgbStrip':
        if (component.mode !== 'revlights') return
        this.driveStrip(device, profile, component, snapshot, now)
        return
      case 'rgbMatrix':
        // RGB Matrix/iFlag output is owned by modules/rgb-matrix.ts so stack
        // profiles do not fight this legacy single-effect renderer. That engine
        // sends `Y<brightness>` + eight `Q<row>:<48hex>` frames per refresh,
        // which is exactly what the companion iFlag firmware parses (see
        // firmware/companion-iflag/companion_iflag.ino).
        return
      case 'screen':
        // useOledDashboard pages are owned by the OLED engine — leave them be.
        if (component.useOledDashboard) return
        this.driveScreen(device, profile, component, snapshot, now)
        return
      case 'startLed':
        this.driveStartLed(device, profile, component, snapshot, now)
        return
      case 'segDisplay':
        this.driveSeg(device, profile, component, snapshot, now)
        return
      case 'gauge':
        this.driveGauge(device, profile, component, snapshot, now)
        return
      case 'buzzer':
      case 'control':
        // Buzzer is driven by the alerts engine; controls are inputs (no output).
        return
      default:
        return
    }
  }

  // ─── Per-component drivers ───────────────────────────────────────────────────

  // Push the configured global brightness (Y<0-255>) for an LED component. Deduped,
  // so it's sent once and then only when the slider value changes.
  private driveBrightness(
    device: SerialDevice,
    profile: DeviceProfile,
    component: Extract<DeviceComponent, { type: 'rgbStrip' }>,
    now: number
  ): void {
    const frame = formatBrightness(component.brightness)
    const key = `${profile.id}:${component.id}:bright`
    if (this.gate(key, frame, 1000, now)) this.safeSend(device, key, frame)
  }

  private driveStrip(
    device: SerialDevice,
    profile: DeviceProfile,
    component: Extract<DeviceComponent, { type: 'rgbStrip' }>,
    snapshot: TelemetrySnapshot | null,
    now: number
  ): void {
    this.driveBrightness(device, profile, component, now)
    const colors = stripColors(component, snapshot, now)
    const frame = formatStripRgb(colors.slice(0, MAX_STRIP_LEDS))
    if (!frame) return
    const key = `${profile.id}:${component.id}:strip`
    if (this.gate(key, frame, STRIP_MIN_INTERVAL_MS, now)) this.safeSend(device, key, frame)
  }

  private driveScreen(
    device: SerialDevice,
    profile: DeviceProfile,
    component: Extract<DeviceComponent, { type: 'screen' }>,
    snapshot: TelemetrySnapshot | null,
    now: number
  ): void {
    const rows = oledRows(snapshot)
    if (!rows) return
    for (let i = 0; i < rows.length; i += 1) {
      const frame = formatOledRow(i, rows[i])
      const key = `${profile.id}:${component.id}:oled${i}`
      if (this.gate(key, frame, SCREEN_MIN_INTERVAL_MS, now)) this.safeSend(device, key, frame)
    }
  }

  private driveStartLed(
    device: SerialDevice,
    profile: DeviceProfile,
    component: Extract<DeviceComponent, { type: 'startLed' }>,
    snapshot: TelemetrySnapshot | null,
    now: number
  ): void {
    const on = startLedOn(component, snapshot)
    const frame = formatAddressableLed(0, on ? component.color : '000000')
    if (!frame) return
    const key = `${profile.id}:${component.id}:led`
    if (this.gate(key, frame, STARTLED_MIN_INTERVAL_MS, now)) this.safeSend(device, key, frame)
  }

  private driveSeg(
    device: SerialDevice,
    profile: DeviceProfile,
    component: Extract<DeviceComponent, { type: 'segDisplay' }>,
    snapshot: TelemetrySnapshot | null,
    now: number
  ): void {
    const value = segValue(component, snapshot)
    if (value === null) return
    const frame = formatSegText(value, component.digits)
    const key = `${profile.id}:${component.id}:seg`
    if (this.gate(key, frame, SEG_MIN_INTERVAL_MS, now)) this.safeSend(device, key, frame)
  }

  private driveGauge(
    device: SerialDevice,
    profile: DeviceProfile,
    component: Extract<DeviceComponent, { type: 'gauge' }>,
    snapshot: TelemetrySnapshot | null,
    now: number
  ): void {
    const angle = gaugeAngle(component, snapshot)
    if (angle === null) return
    const frame = formatGaugeAngle(0, angle)
    const key = `${profile.id}:${component.id}:gauge`
    if (this.gate(key, frame, GAUGE_MIN_INTERVAL_MS, now)) this.safeSend(device, key, frame)
  }

  // ─── Throttle + dedup + send ─────────────────────────────────────────────────

  // Returns true (and records the send) when `payload` for `key` is both past
  // its throttle window and different from the last sent payload.
  private gate(key: string, payload: string, minIntervalMs: number, now: number): boolean {
    const last = this.lastSentAt.get(key) ?? 0
    if (now - last < minIntervalMs) return false
    if (this.lastPayload.get(key) === payload) return false
    this.lastSentAt.set(key, now)
    this.lastPayload.set(key, payload)
    return true
  }

  private safeSend(device: SerialDevice, key: string, frame: string): void {
    // Length guard: never hand sendRaw a frame it would reject (it throws above
    // the firmware buffer limit). Capping happens upstream for strips.
    if (frame.length > MAX_FRAME_LEN) return
    void device.sendRaw(frame).catch((error: unknown) => {
      // Transient failure (write error, cable yanked) — drop dedup so the value
      // re-sends next tick. A permanent buffer-overflow error is kept deduped so
      // we don't retry an impossible frame at the throttle rate forever.
      const message = error instanceof Error ? error.message : String(error)
      if (!/excede o buffer|m[áa]x/i.test(message)) this.lastPayload.delete(key)
    })
  }

  private clearDedup(): void {
    this.lastSentAt.clear()
    this.lastPayload.clear()
  }
}
