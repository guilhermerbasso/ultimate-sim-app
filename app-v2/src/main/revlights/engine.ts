import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import {
  DEFAULT_REVLIGHTS_CONFIG,
  REVLIGHTS_DEVICE_LED_COUNT,
  REVLIGHTS_PRESETS,
  applyPreset,
  computeRevlights,
  isRevlightsPresetId,
  normalizeRevlightsConfig
} from '../../shared/revlights'
import type {
  RevlightsConfig,
  RevlightsPreset,
  RevlightsPresetId,
  RevlightsStatus
} from '../../shared/revlights'
import type { ModuleContext } from '../module-context'
import { logger } from '../modules/logger'

const CONFIG_FILE = 'revlights.json'

// Compute the level/blink at most this often, even if telemetry comes in
// at a higher rate. 50 Hz is plenty for a 4-LED strip and keeps the USB
// CDC TX buffer comfortable on the Pro Micro.
const MIN_TICK_INTERVAL_MS = 20

export class RevlightsEngine {
  private config: RevlightsConfig = { ...DEFAULT_REVLIGHTS_CONFIG, updatedAt: new Date().toISOString() }
  private latest: TelemetrySnapshot | null = null
  private lastSentLevel: number | null = null
  private lastSentShift: boolean | null = null
  private lastSendAt = 0
  private lastError: string | null = null
  private disposed = false
  // True once setConfig has run, so a late initialize() can't clobber an early enable.
  private configTouched = false

  private readonly onSnapshot = (snapshot: TelemetrySnapshot | null): void => {
    this.latest = snapshot
    void this.tick().catch(() => undefined)
  }

  // When the serial session drops, the Pro Micro resets on the next port open
  // (DTR toggle), so its rev LEDs revert to the firmware boot state. Clear the
  // dedupe cache so the first tick after a reconnect always re-pushes R/B.
  private readonly onSerialDisconnect = (): void => {
    logger.info('revlights', 'serial disconnect', { enabled: this.config.enabled })
    this.lastSentLevel = null
    this.lastSentShift = null
  }

  // Fired after a (re)connect and after a manual output self-test. The box's
  // strip state is now unknown (it reset on open, or the self-test swept it), so
  // drop the dedupe and, if the user has rev lights enabled, immediately re-push
  // the current level — even with iRacing closed (sends R0) so the engine and
  // the hardware agree again instead of the strip looking dead.
  private readonly onSerialResync = (): void => {
    logger.info('revlights', 'serial resync (device reconnect/self-test)', { enabled: this.config.enabled })
    this.lastSentLevel = null
    this.lastSentShift = null
    if (this.config.enabled) void this.tick().catch(() => undefined)
  }

  constructor(private readonly ctx: ModuleContext) {}

  async initialize(): Promise<void> {
    const loaded = await this.loadConfig()
    // If a setConfig already ran (e.g. the SIM-X auto-start enabled rev-lights before
    // this readFile resolved), don't clobber it with the boot (disabled) config.
    if (!this.configTouched) this.config = loaded
    this.ctx.telemetryHub.on('snapshot', this.onSnapshot)
    this.ctx.serialManager.on('disconnect', this.onSerialDisconnect)
    this.ctx.serialManager.on('resync', this.onSerialResync)
    this.latest = this.ctx.telemetryHub.getLatest()
    logger.info('revlights', 'engine initialized', { enabled: this.config.enabled })
    // Skip pushing anything until the user enables; we don't want to grab the
    // serial port automatically on boot.
    if (this.config.enabled) void this.tick().catch(() => undefined)
  }

  async dispose(): Promise<void> {
    this.disposed = true
    logger.info('revlights', 'engine dispose')
    this.ctx.telemetryHub.off('snapshot', this.onSnapshot)
    this.ctx.serialManager.off('disconnect', this.onSerialDisconnect)
    this.ctx.serialManager.off('resync', this.onSerialResync)
    // Best-effort: pull the strip down so the LEDs aren't left lit/blinking
    // after the app exits (the firmware only auto-sleeps after 60s idle).
    await this.flushOff().catch(() => undefined)
  }

  getConfig(): RevlightsConfig {
    return this.config
  }

  getPresets(): RevlightsPreset[] {
    return REVLIGHTS_PRESETS
  }

  getStatus(): RevlightsStatus {
    const snapshot = this.latest
    const computation = computeRevlights(snapshot, this.config)
    return {
      enabled: this.config.enabled,
      level: computation.level,
      shiftActive: computation.shiftActive,
      rpm: Number(snapshot?.rpm ?? 0),
      maxRpm: Number(snapshot?.maxRpm ?? 0),
      shiftIndicatorPct: typeof snapshot?.shiftIndicatorPct === 'number' ? snapshot.shiftIndicatorPct : null,
      lastError: this.lastError,
      connected: Boolean(snapshot?.connected),
      flag: computation.flag
    }
  }

  async setConfig(patch: Partial<RevlightsConfig>): Promise<RevlightsConfig> {
    this.configTouched = true
    const wasEnabled = this.config.enabled
    this.config = normalizeRevlightsConfig({ ...this.config, ...patch, updatedAt: new Date().toISOString() })
    if (this.config.enabled !== wasEnabled) {
      logger.info('revlights', `rev-lights ${this.config.enabled ? 'enabled' : 'disabled'}`, {
        ledCount: this.config.ledCount,
        connected: Boolean(this.latest?.connected)
      })
    }
    await this.saveConfig()
    this.broadcastStatus()
    if (this.config.enabled) {
      // Force a re-send next tick by clearing the dedupe cache.
      this.lastSentLevel = null
      this.lastSentShift = null
      await this.tick()
    } else {
      // Pull the rev lights down to zero when disabled so the strip is dark.
      await this.flushOff().catch(() => undefined)
    }
    return this.config
  }

  async setEnabled(enabled: boolean): Promise<RevlightsConfig> {
    return this.setConfig({ enabled })
  }

  // Re-read the persisted config after an IMPORT overwrote revlights.json so the
  // change applies live, with no app restart. Mirrors boot semantics (never
  // auto-resume): we KEEP the current `enabled` state rather than letting an
  // imported file light the strip on its own. Replacing our cached config also
  // means a later setConfig merges onto the imported state, not the stale boot
  // copy — and it removes any clobber risk, since we now hold the fresh data.
  async reloadFromDisk(): Promise<void> {
    if (this.disposed) return
    const loaded = await this.loadConfig()
    const wasEnabled = this.config.enabled
    this.config = normalizeRevlightsConfig({ ...loaded, enabled: wasEnabled })
    logger.info('revlights', 'config reloaded after import (hot-apply)', { enabled: this.config.enabled })
    this.broadcastStatus()
    if (this.config.enabled) {
      this.lastSentLevel = null
      this.lastSentShift = null
      await this.tick().catch(() => undefined)
    }
  }

  async applyPreset(presetId: RevlightsPresetId): Promise<RevlightsConfig> {
    if (!isRevlightsPresetId(presetId)) {
      throw new Error(`Preset desconhecido: ${presetId}`)
    }
    const next = applyPreset(presetId, this.config)
    return this.setConfig(next)
  }

  // ─── Internals ────────────────────────────────────────────────────────────
  private async tick(): Promise<void> {
    if (this.disposed || !this.config.enabled) return
    const now = Date.now()
    if (now - this.lastSendAt < MIN_TICK_INTERVAL_MS) return

    const result = computeRevlights(this.latest, this.config)
    const ledCount = Math.min(this.config.ledCount, REVLIGHTS_DEVICE_LED_COUNT)
    // Scale the engine level (0..config.ledCount) to the firmware strip
    // (0..REVLIGHTS_DEVICE_LED_COUNT) so the UI can preview longer strips.
    const scaledLevel = this.config.ledCount > 0
      ? Math.round((result.level / this.config.ledCount) * REVLIGHTS_DEVICE_LED_COUNT)
      : 0
    const clampedLevel = Math.max(0, Math.min(REVLIGHTS_DEVICE_LED_COUNT, scaledLevel || (result.level > 0 ? 1 : 0)))
    void ledCount // configured ledCount kept for status only

    try {
      if (this.lastSentLevel !== clampedLevel) {
        await this.ctx.serialManager.sendRevLevel(clampedLevel)
        this.lastSentLevel = clampedLevel
      }
      if (this.lastSentShift !== result.shiftActive) {
        await this.ctx.serialManager.sendShiftBlink(result.shiftActive)
        this.lastSentShift = result.shiftActive
      }
      this.lastError = null
    } catch (error) {
      // A failed write means the box state is now unknown (port closed, SimHub
      // grabbed it, cable yanked). Drop the dedupe cache so the next successful
      // tick re-pushes the current level/blink instead of assuming it stuck.
      this.lastSentLevel = null
      this.lastSentShift = null
      this.lastError = getErrorMessage(error)
    } finally {
      this.lastSendAt = now
      this.broadcastStatus()
    }
  }

  private async flushOff(): Promise<void> {
    try {
      await this.ctx.serialManager.sendRevLevel(0)
      await this.ctx.serialManager.sendShiftBlink(false)
      this.lastSentLevel = 0
      this.lastSentShift = false
    } catch (error) {
      this.lastError = getErrorMessage(error)
    } finally {
      this.broadcastStatus()
    }
  }

  private async loadConfig(): Promise<RevlightsConfig> {
    try {
      const raw = JSON.parse(await readFile(this.configPath, 'utf8')) as Partial<RevlightsConfig>
      // Don't auto-resume on boot — same reasoning as the OLED engine.
      return normalizeRevlightsConfig({ ...raw, enabled: false })
    } catch {
      return { ...DEFAULT_REVLIGHTS_CONFIG, updatedAt: new Date().toISOString() }
    }
  }

  private async saveConfig(): Promise<void> {
    await mkdir(dirname(this.configPath), { recursive: true })
    await writeFile(this.configPath, JSON.stringify(this.config, null, 2), 'utf8')
  }

  private get configPath(): string {
    return join(this.ctx.app.getPath('userData'), CONFIG_FILE)
  }

  private broadcastStatus(): void {
    this.ctx.broadcast('revlights:status', this.getStatus())
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
