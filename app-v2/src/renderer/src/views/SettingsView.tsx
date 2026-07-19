import { type CSSProperties, type ReactElement, useEffect, useMemo, useRef, useState } from 'react'
import {
  APP_LANGUAGES,
  APP_TELEMETRY_SOURCES,
  APP_THEMES,
  APP_THEME_PRESETS,
  DEFAULT_APP_SETTINGS,
  TC_SENSITIVITIES,
  type AppLanguage,
  type AppSettings,
  type AppTelemetrySource,
  type AppTheme,
  type TcSensitivity
} from '../../../shared/settings'
import type { AppViewProps } from '../App'
import { UNIT_SYSTEMS, type UnitSystem } from '../../../shared/units'
import { applyAppTheme } from '../lib/theme'
import { TrackMapSetup } from '../components/TrackMapSetup'
import { SectionExportImport } from '../components/SectionExportImport'
import { SavedConfigsPanel } from '../components/SavedConfigsPanel'
import { UpdatePanel } from '../components/UpdatePanel'
import { MqttSetupPanel } from '../components/MqttSetupPanel'
import packageJson from '../../../../package.json'
import {
  CONFIG_IO_CHANNELS,
  type ConfigExportResult
} from '../../../shared/config-io'
import { LOG_CHANNELS, type LogExportResult, type LogInfo } from '../../../shared/logger'
import { APP_SETTINGS_CHANGED_EVENT, LANGUAGE_LABELS, resolveAppLanguage, t, tt } from '../i18n'

const SOURCE_LABEL_KEYS: Record<AppTelemetrySource, string> = {
  off: 'settings.source.off',
  auto: 'settings.source.auto',
  mock: 'settings.source.mock',
  iracing: 'settings.source.iracing',
  acc: 'settings.source.acc',
  ac: 'settings.source.ac',
  ams2: 'settings.source.ams2',
  lmu: 'settings.source.lmu'
}

const THEME_LABEL_KEYS: Record<AppTheme, string> = {
  raceRed: 'settings.theme.raceRed',
  amberGt: 'settings.theme.amberGt',
  mono: 'settings.theme.mono',
  midnight: 'settings.theme.midnight',
  graphite: 'settings.theme.graphite',
  azure: 'settings.theme.azure',
  ember: 'settings.theme.ember',
  lemans: 'settings.theme.lemans',
  gulf: 'settings.theme.gulf',
  synthwave: 'settings.theme.synthwave',
  carbon: 'settings.theme.carbon',
  championship: 'settings.theme.championship',
  martini: 'settings.theme.martini',
  verde: 'settings.theme.verde',
  ice: 'settings.theme.ice',
  auroraGlass: 'settings.theme.auroraGlass',
  neonNoir: 'settings.theme.neonNoir',
  carbonGlow: 'settings.theme.carbonGlow',
  royalGlass: 'settings.theme.royalGlass',
  custom: 'settings.theme.custom'
}

const PRESET_THEMES = APP_THEMES.filter((theme): theme is Exclude<AppTheme, 'custom'> => theme !== 'custom')

const TC_SENSITILITY_LABEL_KEYS: Record<TcSensitivity, string> = {
  off: 'settings.tc.off',
  low: 'settings.tc.low',
  medium: 'settings.tc.medium',
  high: 'settings.tc.high'
}

const UNIT_SYSTEM_LABEL_KEYS: Record<UnitSystem, string> = {
  metric: 'settings.units.metric',
  imperial: 'settings.units.imperial'
}

function Toggle({
  checked,
  disabled,
  label: title,
  description,
  onChange
}: {
  checked: boolean
  disabled?: boolean
  label: string
  description: string
  onChange(checked: boolean): void
}): ReactElement {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 14,
        padding: '12px 0',
        cursor: disabled ? 'not-allowed' : 'pointer'
      }}
    >
      <span>
        <strong>{title}</strong>
        <small style={{ display: 'block', marginTop: 3, color: 'var(--muted)' }}>{description}</small>
      </span>
      <input
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
        style={{ width: 22, height: 22, accentColor: 'var(--accent)' }}
        type="checkbox"
      />
    </label>
  )
}

function sameSettings(left: AppSettings, right: AppSettings): boolean {
  return (
    left.autoStart === right.autoStart &&
    left.startMinimized === right.startMinimized &&
    left.autoStartSimX === right.autoStartSimX &&
    left.autoConnectDevices === right.autoConnectDevices &&
    left.closeToTray === right.closeToTray &&
    left.language === right.language &&
    left.theme === right.theme &&
    left.accentColor === right.accentColor &&
    left.defaultTelemetrySource === right.defaultTelemetrySource &&
    left.unitSystem === right.unitSystem &&
    left.tcSensitivity === right.tcSensitivity
  )
}

function normalizeHex(value: string): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : DEFAULT_APP_SETTINGS.accentColor
}

export default function SettingsView({ showToast, language }: AppViewProps): ReactElement {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS)
  const [savedSettings, setSavedSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [backupBusy, setBackupBusy] = useState<false | 'export'>(false)
  const [needsRestart, setNeedsRestart] = useState(false)
  const [logsBusy, setLogsBusy] = useState(false)
  const [logInfo, setLogInfo] = useState<LogInfo | null>(null)
  const [verbose, setVerbose] = useState(false)
  const [verboseBusy, setVerboseBusy] = useState(false)
  const settingsRef = useRef<AppSettings>(DEFAULT_APP_SETTINGS)
  const saveRevision = useRef(0)

  useEffect(() => {
    window.ipc
      .invoke<LogInfo>(LOG_CHANNELS.info)
      .then(setLogInfo)
      .catch(() => {})
    window.ipc
      .invoke<boolean>(LOG_CHANNELS.getVerbose)
      .then((value) => setVerbose(Boolean(value)))
      .catch(() => {})
  }, [])

  useEffect(() => {
    window.ipc
      .invoke<AppSettings>('app:getSettings')
      .then((loaded) => {
        settingsRef.current = loaded
        setSettings(loaded)
        setSavedSettings(loaded)
        applyAppTheme(loaded)
      })
      .catch((error) => showToast(error instanceof Error ? error.message : String(error), 'error'))
      .finally(() => setLoading(false))
  }, [showToast])

  useEffect(() => {
    applyAppTheme(settings)
  }, [settings])

  const dirty = useMemo(() => !sameSettings(settings, savedSettings), [settings, savedSettings])

  const persistSettings = async (nextSettings: AppSettings): Promise<boolean> => {
    const revision = ++saveRevision.current
    setSaving(true)
    try {
      const saved = await window.ipc.invoke<AppSettings>('app:setSettings', nextSettings)
      if (revision !== saveRevision.current) return false
      settingsRef.current = saved
      setSettings(saved)
      setSavedSettings(saved)
      applyAppTheme(saved)
      window.dispatchEvent(new CustomEvent<AppSettings>(APP_SETTINGS_CHANGED_EVENT, { detail: saved }))
      showToast(t(resolveAppLanguage(saved.language), 'settingsSaved'), 'success')
      return true
    } catch (error) {
      if (revision === saveRevision.current) {
        showToast(error instanceof Error ? error.message : String(error), 'error')
      }
      return false
    } finally {
      if (revision === saveRevision.current) setSaving(false)
    }
  }

  const patch = (next: Partial<AppSettings>): void => {
    const nextSettings = { ...settingsRef.current, ...next }
    settingsRef.current = nextSettings
    setSettings(nextSettings)
    void persistSettings(nextSettings)
  }

  const selectTheme = (theme: AppTheme): void => {
    patch({
      theme,
      accentColor: theme === 'custom' ? settingsRef.current.accentColor : APP_THEME_PRESETS[theme].accent
    })
  }

  const save = async (): Promise<void> => {
    await persistSettings(settingsRef.current)
  }

  const quitApp = (): void => {
    const confirmed = window.confirm(tt(language, 'settings.exitWarning'))
    if (!confirmed) return
    // The main process turns the hardware off and exits; this invoke never resolves.
    void window.ipc.invoke('app:quit').catch(() => {})
  }

  const openFolder = async (channel: 'app:openUserData' | 'app:openRecordings', successMessage: string): Promise<void> => {
    try {
      const result = await window.ipc.invoke<string>(channel)
      if (result) showToast(result, 'error')
      else showToast(successMessage, 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  const exportLogs = async (): Promise<void> => {
    setLogsBusy(true)
    try {
      const result = await window.ipc.invoke<LogExportResult>(LOG_CHANNELS.export)
      if (result.canceled) return
      const files = result.files ?? 0
      showToast(tt(language, 'settings.logsExported', { files, fileLabel: tt(language, files === 1 ? 'settings.file.singular' : 'settings.file.plural') }), 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setLogsBusy(false)
    }
  }

  const openLogsFolder = async (): Promise<void> => {
    try {
      const failure = await window.ipc.invoke<string>(LOG_CHANNELS.openFolder)
      if (failure) showToast(failure, 'error')
      else showToast(tt(language, 'settings.logsFolderOpened'), 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  const toggleVerbose = async (next: boolean): Promise<void> => {
    setVerboseBusy(true)
    try {
      const applied = await window.ipc.invoke<boolean>(LOG_CHANNELS.setVerbose, next)
      setVerbose(Boolean(applied))
      showToast(
        applied ? tt(language, 'settings.detailedLogOn') : tt(language, 'settings.detailedLogOff'),
        'success'
      )
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setVerboseBusy(false)
    }
  }

  const exportProfile = async (): Promise<void> => {
    setBackupBusy('export')
    try {
      const result = await window.ipc.invoke<ConfigExportResult>(CONFIG_IO_CHANNELS.exportAll)
      if (result.canceled) return
      const count = result.sections?.length ?? 0
      showToast(
        tt(language, 'settings.profileExported', {
          count,
          sectionLabel: tt(language, count === 1 ? 'settings.section.singular' : 'settings.section.plural')
        }),
        'success'
      )
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBackupBusy(false)
    }
  }

  const restartNow = async (): Promise<void> => {
    // The main process exits the renderer as it relaunches; never resolves.
    await window.ipc.invoke(CONFIG_IO_CHANNELS.relaunch).catch(() => {})
  }

  // Language changes apply live to migrated views, but a restart guarantees EVERY
  // string (including any mount-time text) is re-rendered in the new language.
  const changeLanguage = async (nextLanguage: AppLanguage): Promise<void> => {
    if (nextLanguage === settingsRef.current.language) return
    const prev = settingsRef.current
    const next = { ...prev, language: nextLanguage }
    settingsRef.current = next
    setSettings(next)
    const ok = await persistSettings(next)
    if (!ok) {
      settingsRef.current = prev
      setSettings(prev)
      return
    }
    setNeedsRestart(true)
    if (window.confirm(tt(language, 'settings.languageRestartConfirm'))) {
      void restartNow()
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minHeight: 0 }}>
      <UpdatePanel language={language} currentVersion={packageJson.version} />
      <div className="panel-card">
        <div className="field-label">{tt(language, 'settings.startup')}</div>
        <Toggle
          checked={settings.autoStart}
          description={tt(language, 'settings.autoStartDesc')}
          disabled={loading || saving}
          label={tt(language, 'settings.autoStart')}
          onChange={(autoStart) => patch({ autoStart })}
        />
        <Toggle
          checked={settings.startMinimized}
          description={tt(language, 'settings.startMinimizedDesc')}
          disabled={loading || saving}
          label={tt(language, 'settings.startMinimized')}
          onChange={(startMinimized) => patch({ startMinimized })}
        />
        <Toggle
          checked={settings.autoStartSimX}
          description={tt(language, 'settings.connectSimxStartupDesc')}
          disabled={loading || saving}
          label={tt(language, 'settings.connectSimxStartup')}
          onChange={(autoStartSimX) => patch({ autoStartSimX })}
        />
        <Toggle
          checked={settings.autoConnectDevices}
          description={tt(language, 'settings.connectSerialStartupDesc')}
          disabled={loading || saving}
          label={tt(language, 'settings.connectSerialStartup')}
          onChange={(autoConnectDevices) => patch({ autoConnectDevices })}
        />
        <Toggle
          checked={settings.closeToTray}
          description={tt(language, 'settings.closeToTrayDesc')}
          disabled={loading || saving}
          label={tt(language, 'settings.closeToTray')}
          onChange={(closeToTray) => patch({ closeToTray })}
        />
        <div
          style={{
            display: 'flex',
            gap: 12,
            flexWrap: 'wrap',
            alignItems: 'center',
            borderTop: '1px solid var(--border-subtle)',
            paddingTop: 12,
            marginTop: 4
          }}
        >
          <span style={{ color: 'var(--muted)', fontSize: 13, marginRight: 'auto', maxWidth: 540 }}>
            {tt(language, 'settings.quitHelp')}
          </span>
          <button disabled={loading || saving} onClick={quitApp} className="ghost-action" type="button">
            {tt(language, 'settings.quitButton')}
          </button>
        </div>
      </div>

      <div className="panel-card" style={{ display: 'grid', gap: 14 }}>
        <div>
          <label className="field-label" htmlFor="language">
            {tt(language, 'settings.language')}
          </label>
          <select
            disabled={loading || saving}
            id="language"
            onChange={(event) => void changeLanguage(event.currentTarget.value as AppLanguage)}
            className="select-field wide"
            value={settings.language}
          >
            {APP_LANGUAGES.map((language) => (
              <option key={language} value={language}>
                {LANGUAGE_LABELS[language]}
              </option>
            ))}
          </select>
          <p style={{ margin: '8px 0 0', color: 'var(--muted)', fontSize: 13 }}>
            {t(resolveAppLanguage(settings.language), 'languageHelp')}
          </p>
        </div>

        <div>
          <label className="field-label" htmlFor="unitSystem">
            {tt(language, 'settings.units')}
          </label>
          <select
            disabled={loading || saving}
            id="unitSystem"
            onChange={(event) => patch({ unitSystem: event.currentTarget.value as UnitSystem })}
            className="select-field wide"
            value={settings.unitSystem}
          >
            {UNIT_SYSTEMS.map((unitSystem) => (
              <option key={unitSystem} value={unitSystem}>
                {tt(language, UNIT_SYSTEM_LABEL_KEYS[unitSystem])}
              </option>
            ))}
          </select>
          <p style={{ margin: '8px 0 0', color: 'var(--muted)', fontSize: 13 }}>
            {tt(language, 'settings.unitsHelp')}
          </p>
        </div>

        <div>
          <label className="field-label" htmlFor="defaultTelemetrySource">
            {tt(language, 'settings.defaultTelemetry')}
          </label>
          <select
            disabled={loading || saving}
            id="defaultTelemetrySource"
            onChange={(event) => patch({ defaultTelemetrySource: event.currentTarget.value as AppTelemetrySource })}
            className="select-field wide"
            value={settings.defaultTelemetrySource}
          >
            {APP_TELEMETRY_SOURCES.map((source) => (
              <option key={source} value={source}>
                {tt(language, SOURCE_LABEL_KEYS[source])}
              </option>
            ))}
          </select>
          <p style={{ margin: '8px 0 0', color: 'var(--muted)', fontSize: 13 }}>
            {tt(language, 'settings.defaultTelemetryHelp')}
          </p>
        </div>

        <div>
          <label className="field-label" htmlFor="tcSensitivity">
            {tt(language, 'settings.tcSensitivity')}
          </label>
          <select
            disabled={loading || saving}
            id="tcSensitivity"
            onChange={(event) => patch({ tcSensitivity: event.currentTarget.value as TcSensitivity })}
            className="select-field wide"
            value={settings.tcSensitivity}
          >
            {TC_SENSITIVITIES.map((level) => (
              <option key={level} value={level}>
                {tt(language, TC_SENSITILITY_LABEL_KEYS[level])}
              </option>
            ))}
          </select>
          <p style={{ margin: '8px 0 0', color: 'var(--muted)', fontSize: 13 }}>
            {tt(language, 'settings.tcHelp')}
          </p>
        </div>

        <div>
          <label className="field-label" htmlFor="trackmap-setup">{tt(language, 'settings.trackMap')}</label>
          <p style={{ margin: '4px 0 8px', color: 'var(--muted)', fontSize: 13 }}>
            {tt(language, 'settings.trackMapHelp')}
          </p>
          <TrackMapSetup language={language} />
        </div>

        <div>
          <label className="field-label" htmlFor="theme">
            {tt(language, 'settings.theme')}
          </label>
          <select
            disabled={loading || saving}
            id="theme"
            onChange={(event) => selectTheme(event.currentTarget.value as AppTheme)}
            className="select-field wide"
            value={settings.theme}
          >
            {APP_THEMES.map((theme) => (
              <option key={theme} value={theme}>
                {tt(language, THEME_LABEL_KEYS[theme])}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          {PRESET_THEMES.map((theme) => (
            <button
              disabled={loading || saving}
              key={theme}
              onClick={() => selectTheme(theme)}
              className={settings.theme === theme ? 'mode-card active' : 'mode-card'}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: loading || saving ? 'not-allowed' : 'pointer'
              }}
              type="button"
            >
              <span>{tt(language, THEME_LABEL_KEYS[theme])}</span>
              <span
                aria-hidden="true"
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 'var(--radius-sm)',
                  background: APP_THEME_PRESETS[theme].accent,
                  border: '1px solid var(--border-strong)'
                }}
              />
            </button>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 12, alignItems: 'end' }}>
          <label style={{ display: 'grid', gap: 8 }} htmlFor="accentColor">
            <span className="field-label" style={{ margin: 0 }}>{tt(language, 'settings.customAccent')}</span>
            <input
              disabled={loading || saving}
              id="accentColor"
              onChange={(event) => patch({ theme: 'custom', accentColor: event.currentTarget.value })}
              className="text-field" style={{ height: 42, padding: 4 }}
              type="color"
              value={normalizeHex(settings.accentColor)}
            />
          </label>
          <label style={{ display: 'grid', gap: 8 }} htmlFor="accentHex">
            <span className="field-label" style={{ margin: 0 }}>{tt(language, 'settings.hex')}</span>
            <input
              disabled={loading || saving}
              id="accentHex"
              maxLength={7}
              onBlur={(event) => patch({ accentColor: normalizeHex(event.currentTarget.value) })}
              onChange={(event) => patch({ theme: 'custom', accentColor: event.currentTarget.value })}
              placeholder={DEFAULT_APP_SETTINGS.accentColor}
              className="text-field"
              type="text"
              value={settings.accentColor}
            />
          </label>
        </div>
      </div>

      <MqttSetupPanel language={language} showToast={showToast} />

      <div className="panel-card" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="field-label" style={{ margin: 0, marginRight: 'auto' }}>{tt(language, 'settings.appFolders')}</span>
        <button
          disabled={loading || saving}
          onClick={() => openFolder('app:openUserData', tt(language, 'settings.dataFolderOpened'))}
          className="ghost-action compact"
          type="button"
        >
          {tt(language, 'settings.openUserData')}
        </button>
        <button
          disabled={loading || saving}
          onClick={() => openFolder('app:openRecordings', tt(language, 'settings.recordingsFolderOpened'))}
          className="ghost-action compact"
          type="button"
        >
          {tt(language, 'settings.openRecordings')}
        </button>
      </div>

      <div className="panel-card" style={{ display: 'grid', gap: 12 }}>
        <div>
          <span className="field-label" style={{ margin: 0 }}>{tt(language, 'settings.diagnosticsLogs')}</span>
          <p style={{ margin: '4px 0 0', color: 'var(--muted)', fontSize: 13 }}>
            {tt(language, 'settings.logsHelp')}
          </p>
          {logInfo?.dir && (
            <p style={{ margin: '6px 0 0', color: 'var(--muted)', fontSize: 12, wordBreak: 'break-all' }}>
              <code>{logInfo.dir}</code>
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button disabled={logsBusy} onClick={exportLogs} className="primary-action" type="button">
            {logsBusy ? tt(language, 'settings.exporting') : tt(language, 'settings.exportLogs')}
          </button>
          <button disabled={logsBusy} onClick={openLogsFolder} className="ghost-action" type="button">
            {tt(language, 'settings.openLogsFolder')}
          </button>
        </div>
        <Toggle
          checked={verbose}
          description={tt(language, 'settings.fullDebugDesc')}
          disabled={verboseBusy}
          label={tt(language, 'settings.fullDebug')}
          onChange={(next) => void toggleVerbose(next)}
        />
      </div>

      <div className="panel-card" style={{ display: 'grid', gap: 12 }}>
        <div>
          <span className="field-label" style={{ margin: 0 }}>{tt(language, 'settings.profileBackup')}</span>
          <p style={{ margin: '4px 0 0', color: 'var(--muted)', fontSize: 13 }}>
            {tt(language, 'settings.backupHelp')}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            disabled={loading || saving || backupBusy !== false}
            onClick={exportProfile}
            className="primary-action"
            type="button"
          >
            {backupBusy === 'export' ? tt(language, 'settings.exporting') : tt(language, 'settings.exportProfile')}
          </button>
          <button
            disabled
            aria-describedby="full-profile-import-disabled"
            className="ghost-action"
            type="button"
          >
            {tt(language, 'settings.importProfile')}
          </button>
        </div>
        <p id="full-profile-import-disabled" style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>
          {tt(language, 'settings.fullImportDisabled')}
        </p>
        {needsRestart && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span
              title={tt(language, 'settings.restartBadgeTitle')}
              style={{
                background: 'var(--danger, #e5484d)',
                color: '#fff',
                borderRadius: 6,
                padding: '2px 10px',
                fontSize: 12,
                fontWeight: 600,
                whiteSpace: 'nowrap'
              }}
            >
              {tt(language, 'settings.restartToApply')}
            </span>
            <span style={{ color: 'var(--muted)', fontSize: 13 }}>
              {tt(language, 'settings.restartBadgeHelp')}
            </span>
            <button className="primary-action" onClick={() => void restartNow()} type="button">
              {tt(language, 'settings.restartNow')}
            </button>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }}>
          <span className="field-label" style={{ margin: 0 }}>{tt(language, 'settings.appThemeOnly')}</span>
          <SectionExportImport sectionId="settings" label={tt(language, 'settings.appThemeSection')} language={language} />
        </div>
      </div>

      <SavedConfigsPanel language={language} />

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button
          disabled={loading || saving || !dirty}
          onClick={save}
          className={dirty ? 'primary-action' : 'ghost-action'}
          type="button"
        >
          {saving ? tt(language, 'settings.saving') : tt(language, 'settings.save')}
        </button>
      </div>
    </div>
  )
}
