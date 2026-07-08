import { type CSSProperties, type ReactElement, useEffect, useMemo, useState } from 'react'
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
import { applyAppTheme } from '../lib/theme'
import { TrackMapSetup } from '../components/TrackMapSetup'
import { SectionExportImport } from '../components/SectionExportImport'
import { SavedConfigsPanel } from '../components/SavedConfigsPanel'
import {
  CONFIG_IO_CHANNELS,
  type ConfigExportResult,
  type ConfigImportResult
} from '../../../shared/config-io'
import { LOG_CHANNELS, type LogExportResult, type LogInfo } from '../../../shared/logger'
import { APP_SETTINGS_CHANGED_EVENT, LANGUAGE_LABELS, resolveAppLanguage, t } from '../i18n'

const SOURCE_LABELS: Record<AppTelemetrySource, string> = {
  off: 'Desligado',
  auto: 'Auto-detectar',
  mock: 'Demo (mock)',
  iracing: 'iRacing',
  acc: 'Assetto Corsa Competizione',
  ac: 'Assetto Corsa',
  ams2: 'Automobilista 2',
  lmu: 'Le Mans Ultimate'
}

const THEME_LABELS: Record<AppTheme, string> = {
  raceRed: 'Race Red',
  amberGt: 'Amber GT',
  mono: 'Mono White-on-Black',
  midnight: 'Carbon Orange',
  graphite: 'Graphite pro',
  azure: 'Azure racing',
  ember: 'Ember night',
  lemans: 'Le Mans',
  gulf: 'Gulf',
  synthwave: 'Synthwave',
  carbon: 'Carbon',
  championship: 'Championship',
  martini: 'Martini',
  verde: 'Verde',
  ice: 'Ice',
  auroraGlass: 'Aurora Glass ✦',
  neonNoir: 'Neon Noir',
  carbonGlow: 'Carbon Glow',
  royalGlass: 'Royal Glass',
  custom: 'Personalizado'
}

const PRESET_THEMES = APP_THEMES.filter((theme): theme is Exclude<AppTheme, 'custom'> => theme !== 'custom')

const TC_SENSITIVITY_LABELS: Record<TcSensitivity, string> = {
  off: 'Desligado',
  low: 'Baixa (só patinada forte)',
  medium: 'Média (recomendado)',
  high: 'Alta (mais sensível)'
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
    left.tcSensitivity === right.tcSensitivity
  )
}

function normalizeHex(value: string): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : DEFAULT_APP_SETTINGS.accentColor
}

export default function SettingsView({ showToast }: AppViewProps): ReactElement {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS)
  const [savedSettings, setSavedSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [backupBusy, setBackupBusy] = useState<false | 'export' | 'import'>(false)
  const [needsRestart, setNeedsRestart] = useState(false)
  const [logsBusy, setLogsBusy] = useState(false)
  const [logInfo, setLogInfo] = useState<LogInfo | null>(null)
  const [verbose, setVerbose] = useState(false)
  const [verboseBusy, setVerboseBusy] = useState(false)

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

  const patch = (next: Partial<AppSettings>): void => {
    setSettings((current) => ({ ...current, ...next }))
  }

  const selectTheme = (theme: AppTheme): void => {
    patch({
      theme,
      accentColor: theme === 'custom' ? settings.accentColor : APP_THEME_PRESETS[theme].accent
    })
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      const saved = await window.ipc.invoke<AppSettings>('app:setSettings', settings)
      setSettings(saved)
      setSavedSettings(saved)
      applyAppTheme(saved)
      window.dispatchEvent(new CustomEvent<AppSettings>(APP_SETTINGS_CHANGED_EVENT, { detail: saved }))
      showToast(t(resolveAppLanguage(saved.language), 'settingsSaved'), 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setSaving(false)
    }
  }

  const quitApp = (): void => {
    const confirmed = window.confirm(
      'Sair do app vai FECHAR tudo: a janela, os overlays, os dashboards e desligar o iFlag. ' +
        'O app NÃO continua na bandeja. Deseja sair agora?'
    )
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
      showToast(`Logs exportados (${files} arquivo${files === 1 ? '' : 's'}).`, 'success')
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
      else showToast('Pasta de logs aberta.', 'success')
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
        applied ? 'Log detalhado ativado.' : 'Log detalhado desativado.',
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
      showToast(`Perfil exportado (${count} seç${count === 1 ? 'ão' : 'ões'}).`, 'success')
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

  const importProfile = async (): Promise<void> => {
    const confirmed = window.confirm(
      'Importar um perfil vai SOBRESCREVER as configurações atuais (exceto login/credenciais). ' +
        'O app precisa reiniciar para aplicar. Continuar?'
    )
    if (!confirmed) return
    setBackupBusy('import')
    try {
      const result = await window.ipc.invoke<ConfigImportResult>(CONFIG_IO_CHANNELS.importAll)
      if (result.canceled) return
      const applied = result.summary?.applied.length ?? 0
      if (applied > 0) {
        // Imported files are on disk, but every store is cached in memory until
        // the next launch — do NOT refetch (it would show stale data and invite
        // an overwrite). Surface a restart prompt + persistent badge instead.
        setNeedsRestart(true)
        showToast(`Perfil importado (${applied} seç${applied === 1 ? 'ão' : 'ões'}). Reinicie para aplicar.`, 'success')
        if (window.confirm('Perfil importado. O app precisa reiniciar para aplicar. Reiniciar agora?')) {
          await restartNow()
        }
      } else {
        showToast('Arquivo válido, mas nenhuma seção reconhecida foi aplicada.', 'error')
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBackupBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minHeight: 0 }}>
      <div className="panel-card">
        <div className="field-label">Inicialização</div>
        <Toggle
          checked={settings.autoStart}
          description="Abre o app automaticamente ao entrar no Windows."
          disabled={loading || saving}
          label="Auto-start com o Windows"
          onChange={(autoStart) => patch({ autoStart })}
        />
        <Toggle
          checked={settings.startMinimized}
          description="Na próxima abertura, envia a janela para a barra de tarefas."
          disabled={loading || saving}
          label="Iniciar minimizado"
          onChange={(startMinimized) => patch({ startMinimized })}
        />
        <Toggle
          checked={settings.autoStartSimX}
          description="Ao iniciar, conecta o SIM-X automaticamente (e reconecta se cair) e ativa os rev-lights."
          disabled={loading || saving}
          label="Conectar SIM-X e ativar rev-lights ao iniciar"
          onChange={(autoStartSimX) => patch({ autoStartSimX })}
        />
        <Toggle
          checked={settings.autoConnectDevices}
          description="Ao iniciar, conecta automaticamente os dispositivos serial salvos (como o iFlag), reconectando se caírem e tentando de novo até aparecerem."
          disabled={loading || saving}
          label="Conectar dispositivos serial (iFlag etc.) ao iniciar"
          onChange={(autoConnectDevices) => patch({ autoConnectDevices })}
        />
        <Toggle
          checked={settings.closeToTray}
          description="Ao clicar em fechar, o app vai para a bandeja do Windows (ao lado do relógio) e continua rodando. Use 'Sair' no menu da bandeja para fechar de verdade."
          disabled={loading || saving}
          label="Fechar para a bandeja (system tray)"
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
            Fechar pela janela (X) só esconde o app na bandeja. Para fechar de verdade — a janela,
            os overlays, os dashboards e desligar o iFlag — use este botão (ou "Sair" no menu da bandeja).
          </span>
          <button disabled={loading || saving} onClick={quitApp} className="ghost-action" type="button">
            Sair do app (fechar tudo)
          </button>
        </div>
      </div>

      <div className="panel-card" style={{ display: 'grid', gap: 14 }}>
        <div>
          <label className="field-label" htmlFor="language">
            Idioma / Language
          </label>
          <select
            disabled={loading || saving}
            id="language"
            onChange={(event) => patch({ language: event.currentTarget.value as AppLanguage })}
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
          <label className="field-label" htmlFor="defaultTelemetrySource">
            Fonte de telemetria padrão
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
                {SOURCE_LABELS[source]}
              </option>
            ))}
          </select>
          <p style={{ margin: '8px 0 0', color: 'var(--muted)', fontSize: 13 }}>
            Aplicada ao salvar e novamente no boot do app.
          </p>
        </div>

        <div>
          <label className="field-label" htmlFor="tcSensitivity">
            Sensibilidade do TC (iRacing)
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
                {TC_SENSITIVITY_LABELS[level]}
              </option>
            ))}
          </select>
          <p style={{ margin: '8px 0 0', color: 'var(--muted)', fontSize: 13 }}>
            O iRacing não expõe um sinal nativo de TC atuando — ele é derivado. Se o indicador
            acende em qualquer acelerada, reduza a sensibilidade. &quot;Desligado&quot; oculta o indicador.
          </p>
        </div>

        <div>
          <label className="field-label" htmlFor="trackmap-setup">Mapa de pista (iRacing)</label>
          <p style={{ margin: '4px 0 8px', color: 'var(--muted)', fontSize: 13 }}>
            Faça login no iRacing uma vez para baixar o mapa oficial da pista (overlay e widgets). Sem login, um traçado é aprendido de uma volta limpa.
          </p>
          <TrackMapSetup />
        </div>

        <div>
          <label className="field-label" htmlFor="theme">
            Tema visual
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
                {THEME_LABELS[theme]}
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
              <span>{THEME_LABELS[theme]}</span>
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
            <span className="field-label" style={{ margin: 0 }}>Accent custom</span>
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
            <span className="field-label" style={{ margin: 0 }}>Hex</span>
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

      <div className="panel-card" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="field-label" style={{ margin: 0, marginRight: 'auto' }}>Pastas do app</span>
        <button
          disabled={loading || saving}
          onClick={() => openFolder('app:openUserData', 'Pasta de dados aberta.')}
          className="ghost-action compact"
          type="button"
        >
          Abrir userData
        </button>
        <button
          disabled={loading || saving}
          onClick={() => openFolder('app:openRecordings', 'Pasta de gravações aberta.')}
          className="ghost-action compact"
          type="button"
        >
          Abrir gravações
        </button>
      </div>

      <div className="panel-card" style={{ display: 'grid', gap: 12 }}>
        <div>
          <span className="field-label" style={{ margin: 0 }}>Diagnóstico — logs (24h)</span>
          <p style={{ margin: '4px 0 0', color: 'var(--muted)', fontSize: 13 }}>
            O app grava logs de diagnóstico e <strong>apaga automaticamente tudo com mais de 24&nbsp;horas</strong>.
            Quando houver um problema, exporte os logs e me envie o arquivo. Tokens, senhas e cookies NUNCA são gravados.
          </p>
          {logInfo?.dir && (
            <p style={{ margin: '6px 0 0', color: 'var(--muted)', fontSize: 12, wordBreak: 'break-all' }}>
              <code>{logInfo.dir}</code>
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button disabled={logsBusy} onClick={exportLogs} className="primary-action" type="button">
            {logsBusy ? 'Exportando…' : 'Exportar logs'}
          </button>
          <button disabled={logsBusy} onClick={openLogsFolder} className="ghost-action" type="button">
            Abrir pasta de logs
          </button>
        </div>
        <Toggle
          checked={verbose}
          description="Registra ABSOLUTAMENTE TUDO para debug: cada snapshot de telemetria recebido do jogo (~2x/s + toda mudança), todas as chamadas internas (IPC) e broadcasts, eventos de serial/dispositivos e o console do app. Aumenta bastante o volume (limitado pela retenção de 24h) e permanece ativo após reiniciar; desliga sozinho após 48h."
          disabled={verboseBusy}
          label="Log completo de debug (captura tudo, inclusive a telemetria recebida)"
          onChange={(next) => void toggleVerbose(next)}
        />
      </div>

      <div className="panel-card" style={{ display: 'grid', gap: 12 }}>
        <div>
          <span className="field-label" style={{ margin: 0 }}>Backup do perfil</span>
          <p style={{ margin: '4px 0 0', color: 'var(--muted)', fontSize: 13 }}>
            Exporta TODA a sua configuração (dashboards, overlays, RGB matrix, dispositivos, ações, spotter, temas e mais) para
            um arquivo <code>.json</code>, e importa de volta. Login e credenciais NUNCA são incluídos.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            disabled={loading || saving || backupBusy !== false}
            onClick={exportProfile}
            className="primary-action"
            type="button"
          >
            {backupBusy === 'export' ? 'Exportando…' : 'Exportar perfil completo'}
          </button>
          <button
            disabled={loading || saving || backupBusy !== false}
            onClick={importProfile}
            className="ghost-action"
            type="button"
          >
            {backupBusy === 'import' ? 'Importando…' : 'Importar perfil'}
          </button>
        </div>
        {needsRestart && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span
              title="A configuração importada só é carregada quando o app reinicia."
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
              Reinicie para aplicar
            </span>
            <span style={{ color: 'var(--muted)', fontSize: 13 }}>
              A configuração foi gravada no disco, mas só é carregada ao reiniciar.
            </span>
            <button className="primary-action" onClick={() => void restartNow()} type="button">
              Reiniciar agora
            </button>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }}>
          <span className="field-label" style={{ margin: 0 }}>Apenas app &amp; tema</span>
          <SectionExportImport sectionId="settings" label="Configurações do app & tema" />
        </div>
      </div>

      <SavedConfigsPanel />

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button
          disabled={loading || saving || !dirty}
          onClick={save}
          className={dirty ? 'primary-action' : 'ghost-action'}
          type="button"
        >
          {saving ? 'Salvando...' : 'Salvar configurações'}
        </button>
      </div>
    </div>
  )
}
