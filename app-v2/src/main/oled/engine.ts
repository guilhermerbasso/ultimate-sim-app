import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import {
  DEFAULT_OLED_CONFIG,
  OLED_PRESETS,
  formatOledConfigPage,
  normalizeOledConfig
} from '../../shared/oled'
import type {
  OledDashboardConfig,
  OledDashboardStatus,
  OledPreset,
  OledPresetId
} from '../../shared/oled'
import type { ModuleContext } from '../module-context'
import { logger } from '../modules/logger'
import type { UnitSystem } from '../../shared/units'
import { settingsEvents } from '../settings/events'

const CONFIG_FILE = 'oled-dashboard.json'

export class OledDashboardEngine {
  private config: OledDashboardConfig = { ...DEFAULT_OLED_CONFIG, updatedAt: new Date().toISOString() }
  private latest: TelemetrySnapshot | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private lastPayload: string | null = null
  private lastError: string | null = null
  private disposed = false
  private unitSystem: UnitSystem = 'metric'
  private unsubscribeSettings: (() => void) | null = null
  private readonly onSnapshot = (snapshot: TelemetrySnapshot | null): void => {
    this.latest = snapshot
  }

  // Fired after a (re)connect and after a manual output self-test. The OLED was
  // reset (port open) or overwritten (self-test greeting), so re-push the active
  // page immediately when streaming is enabled instead of waiting up to a full
  // rotation interval — gives instant proof the OLED link is live.
  private readonly onSerialResync = (): void => {
    this.lastPayload = null
    if (this.config.enabled) {
      this.restartTimer()
      void this.sendCurrentPage().catch(() => undefined)
    }
  }

  constructor(private readonly ctx: ModuleContext) {}

  async initialize(): Promise<void> {
    this.unsubscribeSettings = settingsEvents.onChanged((settings) => {
      this.unitSystem = settings.unitSystem
      this.lastPayload = null
      if (this.config.enabled) void this.sendCurrentPage().catch(() => undefined)
    })
    this.config = await this.loadConfig()
    this.ctx.telemetryHub.on('snapshot', this.onSnapshot)
    this.ctx.serialManager.on('resync', this.onSerialResync)
    this.latest = this.ctx.telemetryHub.getLatest()
    if (this.config.enabled) await this.start()
  }

  getPresets(): OledPreset[] {
    return OLED_PRESETS
  }

  getConfig(): OledDashboardConfig {
    return this.config
  }

  getStatus(): OledDashboardStatus {
    const activePresetId = this.config.pages[this.config.activeIndex] ?? this.config.pages[0]
    return {
      enabled: this.config.enabled,
      activeIndex: this.config.activeIndex,
      activePresetId,
      connected: Boolean(this.latest?.connected),
      lastPayload: this.lastPayload,
      lastError: this.lastError
    }
  }

  async setConfig(patch: Partial<OledDashboardConfig>): Promise<OledDashboardConfig> {
    const enabled = this.config.enabled
    this.config = normalizeOledConfig({ ...this.config, ...patch, enabled, updatedAt: new Date().toISOString() })
    await this.saveConfig()
    if (this.config.enabled) this.restartTimer()
    this.broadcastStatus()
    await this.sendCurrentPage()
    return this.config
  }

  async setActivePage(activeIndex: number): Promise<OledDashboardConfig> {
    this.config = normalizeOledConfig({ ...this.config, activeIndex, updatedAt: new Date().toISOString() })
    await this.saveConfig()
    this.broadcastStatus()
    await this.sendCurrentPage()
    return this.config
  }

  async setStreaming(enabled: boolean): Promise<OledDashboardConfig> {
    this.config = normalizeOledConfig({ ...this.config, enabled, updatedAt: new Date().toISOString() })
    await this.saveConfig()
    if (enabled) await this.start()
    else await this.stop()
    this.broadcastStatus()
    return this.config
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.ctx.telemetryHub.off('snapshot', this.onSnapshot)
    this.ctx.serialManager.off('resync', this.onSerialResync)
    this.unsubscribeSettings?.()
    this.unsubscribeSettings = null
    await this.stop()
  }

  private async start(): Promise<void> {
    // Confirm the serial session is open before scheduling the rotation timer.
    // The session is opened from DevicesView via SerialManager.connect(); if
    // the user hasn't connected yet, surface a clear error instead of spinning
    // an interval that will fail on every tick.
    try {
      await this.ctx.serialManager.startOledStreaming()
    } catch (error) {
      this.lastError = getErrorMessage(error)
      logger.warn('oled', 'start failed (device not connected?)', { message: this.lastError })
      this.broadcastStatus()
      throw error
    }
    this.restartTimer()
    this.lastError = null
    logger.info('oled', 'streaming started', { intervalMs: this.config.intervalMs, pages: this.config.pages.length, connected: Boolean(this.latest?.connected) })
    await this.sendCurrentPage()
  }

  private async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    await this.ctx.serialManager.stopOledStreaming()
  }

  private restartTimer(): void {
    if (this.timer) clearInterval(this.timer)
    if (!this.config.enabled || this.disposed) return
    this.timer = setInterval(() => void this.rotateAndSend(), this.config.intervalMs)
  }

  private async rotateAndSend(): Promise<void> {
    if (!this.config.enabled) return
    const nextIndex = (this.config.activeIndex + 1) % this.config.pages.length
    this.config = normalizeOledConfig({ ...this.config, activeIndex: nextIndex })
    await this.sendCurrentPage()
  }

  private async sendCurrentPage(): Promise<void> {
    if (!this.config.enabled) return
    const rendered = formatOledConfigPage(this.config, this.latest, this.unitSystem)
    try {
      if (rendered.kind === 'bignum') {
        await this.ctx.serialManager.sendBigNum(rendered.value)
      } else {
        await this.ctx.serialManager.sendOled(rendered.lines[0], rendered.lines[1], rendered.lines[2])
      }
      this.lastPayload = rendered.payload
      this.lastError = null
      logger.verbose('oled', 'sent page', { preset: this.config.pages[this.config.activeIndex], kind: rendered.kind, payload: rendered.payload })
    } catch (error) {
      this.lastError = getErrorMessage(error)
      logger.warn('oled', 'send failed', { message: this.lastError })
    } finally {
      this.broadcastStatus()
    }
  }

  private async loadConfig(): Promise<OledDashboardConfig> {
    try {
      const raw = JSON.parse(await readFile(this.configPath, 'utf8')) as Partial<OledDashboardConfig>
      // OLED streams to the primary SIM-X (shares the open session with rev-lights/
      // iFlag). Force ON at boot so the panel always updates; users disable per-session
      // via setStreaming if they don't want it. (Previously persisted-false kept the
      // panel dark forever — the "OLED stuck" bug.)
      return normalizeOledConfig({ ...raw, enabled: true })
    } catch {
      return { ...DEFAULT_OLED_CONFIG, updatedAt: new Date().toISOString() }
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
    this.ctx.broadcast('oled:status', this.getStatus())
  }
}

export function presetIdFromIndex(config: OledDashboardConfig, index: number): OledPresetId {
  const normalized = normalizeOledConfig({ ...config, activeIndex: index })
  return normalized.pages[normalized.activeIndex]
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
