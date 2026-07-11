import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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

const STORE_FILE = 'settings.json'

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
      : DEFAULT_APP_SETTINGS.tcSensitivity
  }
}

export class SettingsStore {
  private readonly filePath: string
  private settings: AppSettings = { ...DEFAULT_APP_SETTINGS }
  private loaded = false

  constructor(userDataPath: string) {
    this.filePath = join(userDataPath, STORE_FILE)
  }

  load(): AppSettings {
    try {
      const raw = readFileSync(this.filePath, 'utf8')
      this.settings = normalizeSettings(JSON.parse(raw) as Partial<AppSettings>)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') console.warn('[settings] Failed to load settings, using defaults.', error)
      this.settings = { ...DEFAULT_APP_SETTINGS }
      if (code === 'ENOENT') this.save()
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
    this.settings = normalizeSettings({ ...this.settings, ...nextSettings })
    this.save()
    return this.getSnapshot()
  }

  private getSnapshot(): AppSettings {
    return { ...this.settings }
  }

  private save(): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, `${JSON.stringify(this.settings, null, 2)}\n`, 'utf8')
  }
}
