import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  APP_THEME_PRESETS,
  DEFAULT_APP_SETTINGS,
  type AppSettings,
  isAppLanguage,
  isAppTelemetrySource,
  isAppTheme,
  isTcSensitivity
} from '../../shared/settings'
import { isUnitSystem } from '../../shared/units'
import {
  cloneStreamTargetSettings,
  normalizeStreamTargetSettings
} from '../../shared/stream-targets'

const STORE_FILE = 'settings.json'

export function writeSettingsAtomic(path: string, settings: AppSettings): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
    renameSync(temporary, path)
  } finally {
    rmSync(temporary, { force: true })
  }
}

export interface SettingsStoreOptions {
  writeAtomic?: (path: string, settings: AppSettings) => void
}

function normalizeAccentColor(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_APP_SETTINGS.accentColor
  return /^#[0-9a-f]{6}$/i.test(value) ? value : DEFAULT_APP_SETTINGS.accentColor
}

function normalizeSettings(value: Partial<AppSettings> | null | undefined): AppSettings {
  const theme = isAppTheme(value?.theme) ? value.theme : DEFAULT_APP_SETTINGS.theme
  const presetAccent = theme === 'custom' ? DEFAULT_APP_SETTINGS.accentColor : APP_THEME_PRESETS[theme].accent

  return {
    autoStart: Boolean(value?.autoStart ?? DEFAULT_APP_SETTINGS.autoStart),
    startMinimized: Boolean(value?.startMinimized ?? DEFAULT_APP_SETTINGS.startMinimized),
    autoStartSimX: Boolean(value?.autoStartSimX ?? DEFAULT_APP_SETTINGS.autoStartSimX),
    autoConnectDevices: Boolean(value?.autoConnectDevices ?? DEFAULT_APP_SETTINGS.autoConnectDevices),
    closeToTray: Boolean(value?.closeToTray ?? DEFAULT_APP_SETTINGS.closeToTray),
    language: isAppLanguage(value?.language) ? value.language : DEFAULT_APP_SETTINGS.language,
    theme,
    accentColor: theme === 'custom' ? normalizeAccentColor(value?.accentColor) : presetAccent,
    defaultTelemetrySource: isAppTelemetrySource(value?.defaultTelemetrySource)
      ? value.defaultTelemetrySource
      : DEFAULT_APP_SETTINGS.defaultTelemetrySource,
    unitSystem: isUnitSystem(value?.unitSystem)
      ? value.unitSystem
      : DEFAULT_APP_SETTINGS.unitSystem,
    tcSensitivity: isTcSensitivity(value?.tcSensitivity)
      ? value.tcSensitivity
      : DEFAULT_APP_SETTINGS.tcSensitivity,
    streamTargets: normalizeStreamTargetSettings(value?.streamTargets)
  }
}

export class SettingsStore {
  private readonly filePath: string
  private readonly writeAtomic: (path: string, settings: AppSettings) => void
  private settings: AppSettings = { ...DEFAULT_APP_SETTINGS }
  private loaded = false

  constructor(userDataPath: string, options: SettingsStoreOptions = {}) {
    this.filePath = join(userDataPath, STORE_FILE)
    this.writeAtomic = options.writeAtomic ?? writeSettingsAtomic
  }

  load(): AppSettings {
    try {
      const raw = readFileSync(this.filePath, 'utf8')
      this.settings = normalizeSettings(JSON.parse(raw) as Partial<AppSettings>)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') console.warn('[settings] Failed to load settings, using defaults.', error)
      const fallback = normalizeSettings(DEFAULT_APP_SETTINGS)
      if (code === 'ENOENT') this.writeAtomic(this.filePath, fallback)
      this.settings = fallback
    }

    this.loaded = true
    return this.getSnapshot()
  }

  getSettings(): AppSettings {
    if (!this.loaded) this.load()
    return this.getSnapshot()
  }

  setSettings(nextSettings: Partial<AppSettings>): AppSettings {
    if (!this.loaded) this.load()
    const candidate = normalizeSettings({
      ...this.settings,
      ...nextSettings,
      streamTargets: nextSettings.streamTargets ?? this.settings.streamTargets
    })
    this.writeAtomic(this.filePath, candidate)
    this.settings = candidate
    return this.getSnapshot()
  }

  private getSnapshot(): AppSettings {
    return {
      ...this.settings,
      streamTargets: cloneStreamTargetSettings(this.settings.streamTargets)
    }
  }
}
