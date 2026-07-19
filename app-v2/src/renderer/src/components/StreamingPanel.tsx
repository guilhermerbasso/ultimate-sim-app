import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import type { DashboardSummary } from '../../../shared/dashboards'
import type { AppSettings } from '../../../shared/settings'
import type { ButtonBoxSummary } from '../../../shared/touch-panel'
import { STREAMING_CHANNELS, type StreamingAccessMode, type StreamingLayoutKind, type StreamingSelfTestResult, type StreamingStartResult, type StreamingStatus } from '../../../shared/streaming'
import {
  addStreamTargetProfile,
  clearMissingStreamTargetProfiles,
  deleteStreamTargetProfile,
  emptyStreamTargetSettings,
  listUserAddedStreamTargetSources,
  migrateStreamTargetSettings,
  moveStreamTargetProfile,
  renameStreamTargetProfile,
  resolveStreamTargetProfiles,
  selectStreamTargetProfile,
  streamTargetSettingsEqual,
  type StreamTargetProfile,
  type StreamTargetSettings
} from '../../../shared/stream-targets'
import { tt, type ResolvedLanguage } from '../i18n'
import { navigateToView } from '../lib/app-navigation'

function statusAccessMode(status: StreamingStatus): StreamingAccessMode {
  return status.accessMode ?? (status.lanEnabled ? 'lan' : 'local')
}

function accessHelp(
  language: ResolvedLanguage | undefined,
  accessMode: StreamingAccessMode,
  publicBaseUrl: string,
  autoTunnel: boolean,
  autoTunnelAvailable: boolean
): string {
  if (accessMode === 'internet') {
    if (autoTunnel) {
      return autoTunnelAvailable
        ? tt(language, 'streaming.help.internetAuto')
        : tt(language, 'streaming.help.internetAutoUnavailable')
    }
    return publicBaseUrl.trim()
      ? tt(language, 'streaming.help.internetReady')
      : tt(language, 'streaming.help.internetNeedsUrl')
  }
  if (accessMode === 'lan') return tt(language, 'streaming.help.lan')
  return tt(language, 'streaming.help.local')
}

function formatDeviceName(userAgent: string | null): string {
  if (!userAgent) return 'Unknown browser'
  if (/iphone|ipad/i.test(userAgent)) return 'iOS Safari'
  if (/android/i.test(userAgent)) return 'Android browser'
  if (/edg\//i.test(userAgent)) return 'Microsoft Edge'
  if (/chrome/i.test(userAgent)) return 'Chrome'
  if (/firefox/i.test(userAgent)) return 'Firefox'
  if (/safari/i.test(userAgent)) return 'Safari'
  return userAgent.slice(0, 64)
}

export default function StreamingPanel({ language }: { language?: ResolvedLanguage }): ReactElement {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [streamSafe, setStreamSafe] = useState(true)
  const [accessMode, setAccessMode] = useState<StreamingAccessMode>('local')
  const [password, setPassword] = useState('')
  const [publicBaseUrl, setPublicBaseUrl] = useState('')
  const [autoTunnel, setAutoTunnel] = useState(false)
  const [status, setStatus] = useState<StreamingStatus | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [dashboards, setDashboards] = useState<DashboardSummary[]>([])
  const [touchPanels, setTouchPanels] = useState<ButtonBoxSummary[]>([])
  const [targetSettings, setTargetSettings] = useState<StreamTargetSettings>(() => emptyStreamTargetSettings())
  const [targetLoading, setTargetLoading] = useState(true)
  const [targetSaving, setTargetSaving] = useState(false)
  const [targetError, setTargetError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [newTargetKind, setNewTargetKind] = useState<StreamingLayoutKind>('dashboard')
  const [newSourceId, setNewSourceId] = useState('')
  const [newTargetLabel, setNewTargetLabel] = useState('')
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null)
  const [editingLabel, setEditingLabel] = useState('')

  const ACCESS_LABELS: Record<StreamingAccessMode, string> = {
    local: tt(language, 'streaming.access.local'),
    lan: tt(language, 'streaming.access.lan'),
    internet: tt(language, 'streaming.access.internet')
  }
  const targetSources = useMemo(
    () => listUserAddedStreamTargetSources(dashboards, touchPanels),
    [dashboards, touchPanels]
  )
  const resolvedProfiles = useMemo(
    () => resolveStreamTargetProfiles(targetSettings, targetSources),
    [targetSettings, targetSources]
  )
  const selectedProfile = resolvedProfiles.find((profile) => profile.id === targetSettings.selectedProfileId) ?? null
  const missingProfiles = resolvedProfiles.filter((profile) => profile.missing)
  const newSourceOptions = useMemo(
    () => targetSources.filter((source) => source.kind === newTargetKind),
    [newTargetKind, targetSources]
  )

  function applyStatus(nextStatus: StreamingStatus): void {
    setStatus(nextStatus)
    setStreamSafe(nextStatus.streamSafe)
    setAccessMode(statusAccessMode(nextStatus))
    setPublicBaseUrl(nextStatus.publicBaseUrl ?? '')
    setAutoTunnel(nextStatus.autoTunnelEnabled)
  }

  async function refreshStatus(): Promise<void> {
    applyStatus(await window.ipc.invoke<StreamingStatus>(STREAMING_CHANNELS.status))
  }

  async function loadTargetProfiles(): Promise<void> {
    setTargetLoading(true)
    setTargetError(null)
    try {
      const [dashList, touchList, appSettings, nextStatus] = await Promise.all([
        window.ipc.invoke<DashboardSummary[]>('app:dash:list'),
        window.ipc.invoke<ButtonBoxSummary[]>('app:touchpanel:list'),
        window.ipc.invoke<AppSettings>('app:getSettings'),
        window.ipc.invoke<StreamingStatus>(STREAMING_CHANNELS.status).catch(() => null)
      ])
      setDashboards(dashList)
      setTouchPanels(touchList)
      if (nextStatus) applyStatus(nextStatus)
      const sources = listUserAddedStreamTargetSources(dashList, touchList)
      const migrated = migrateStreamTargetSettings(
        appSettings.streamTargets,
        sources,
        nextStatus?.layoutId
          ? { kind: nextStatus.layoutKind ?? 'dashboard', sourceId: nextStatus.layoutId }
          : null
      )
      setTargetSettings(migrated)
      if (!streamTargetSettingsEqual(appSettings.streamTargets, migrated)) {
        const saved = await window.ipc.invoke<AppSettings>('app:setSettings', { streamTargets: migrated })
        setTargetSettings(saved.streamTargets)
      }
    } catch (err) {
      setTargetError(err instanceof Error ? err.message : tt(language, 'streaming.targets.errorLoad'))
    } finally {
      setTargetLoading(false)
    }
  }

  async function persistTargetSettings(next: StreamTargetSettings): Promise<boolean> {
    if (targetSaving) return false
    const previous = targetSettings
    setTargetSaving(true)
    setTargetError(null)
    setTargetSettings(next)
    try {
      const saved = await window.ipc.invoke<AppSettings>('app:setSettings', { streamTargets: next })
      setTargetSettings(saved.streamTargets)
      return true
    } catch (err) {
      setTargetSettings(previous)
      setTargetError(err instanceof Error ? err.message : tt(language, 'streaming.targets.errorSave'))
      return false
    } finally {
      setTargetSaving(false)
    }
  }

  function beginCreateTarget(): void {
    const preferredKind = targetSources.some((source) => source.kind === 'dashboard')
      ? 'dashboard'
      : 'touch'
    const source = targetSources.find((candidate) => candidate.kind === preferredKind) ?? targetSources[0]
    setNewTargetKind(source?.kind ?? preferredKind)
    setNewSourceId(source?.id ?? '')
    setNewTargetLabel(source?.label ?? '')
    setEditingProfileId(null)
    setCreateOpen(true)
  }

  async function createTargetProfile(): Promise<void> {
    const source = targetSources.find((candidate) =>
      candidate.kind === newTargetKind && candidate.id === newSourceId
    )
    if (!source) {
      setTargetError(tt(language, 'streaming.targets.sourceRequired'))
      return
    }
    try {
      const next = addStreamTargetProfile(targetSettings, source, newTargetLabel)
      if (await persistTargetSettings(next)) {
        setCreateOpen(false)
        setNewTargetLabel('')
      }
    } catch (err) {
      setTargetError(err instanceof Error ? err.message : tt(language, 'streaming.targets.errorSave'))
    }
  }

  function beginRenameTarget(profile: StreamTargetProfile): void {
    setCreateOpen(false)
    setEditingProfileId(profile.id)
    setEditingLabel(profile.label)
  }

  async function saveRenamedTarget(profileId: string): Promise<void> {
    try {
      const next = renameStreamTargetProfile(targetSettings, profileId, editingLabel)
      if (await persistTargetSettings(next)) setEditingProfileId(null)
    } catch (err) {
      setTargetError(err instanceof Error ? err.message : tt(language, 'streaming.targets.errorSave'))
    }
  }

  async function removeTargetProfile(profileId: string): Promise<void> {
    setEditingProfileId((current) => current === profileId ? null : current)
    await persistTargetSettings(deleteStreamTargetProfile(targetSettings, profileId))
  }

  async function moveTargetProfile(profileId: string, direction: -1 | 1): Promise<void> {
    await persistTargetSettings(moveStreamTargetProfile(targetSettings, profileId, direction))
  }

  async function chooseTargetProfile(profileId: string): Promise<void> {
    await persistTargetSettings(selectStreamTargetProfile(targetSettings, profileId))
  }

  async function clearMissingTargets(): Promise<void> {
    await persistTargetSettings(clearMissingStreamTargetProfiles(targetSettings, targetSources))
  }

  async function startStreaming(): Promise<void> {
    setBusy(true)
    setError(null)
    setCopied(null)
    setTestResult(null)
    try {
      if (!selectedProfile || selectedProfile.missing) {
        throw new Error(tt(language, 'streaming.targets.selectAvailable'))
      }
      const layoutKind = selectedProfile.kind
      const layoutId = selectedProfile.sourceId
      await window.ipc.invoke<StreamingStartResult>(STREAMING_CHANNELS.start, {
        streamSafe,
        layoutKind,
        layoutId,
        touchPanelId: layoutKind === 'touch' ? layoutId : undefined,
        accessMode,
        lanEnabled: accessMode !== 'local',
        publicBaseUrl: accessMode === 'internet' ? publicBaseUrl.trim() || undefined : undefined,
        password: accessMode !== 'local' ? password.trim() || undefined : undefined,
        autoTunnel: accessMode === 'internet' && autoTunnel
      })
      setPassword('')
      await refreshStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : tt(language, 'streaming.error.start'))
    } finally {
      setBusy(false)
    }
  }

  async function stopStreaming(): Promise<void> {
    setBusy(true)
    setError(null)
    setCopied(null)
    setTestResult(null)
    try {
      const nextStatus = await window.ipc.invoke<StreamingStatus>(STREAMING_CHANNELS.stop)
      setStatus(nextStatus)
      setAccessMode('local')
      setPublicBaseUrl('')
      setAutoTunnel(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : tt(language, 'streaming.error.stop'))
    } finally {
      setBusy(false)
    }
  }

  async function copyUrl(label: string, url: string | null | undefined): Promise<void> {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(label)
    } catch (err) {
      setError(err instanceof Error ? err.message : tt(language, 'streaming.error.copy', { label }))
    }
  }

  async function testActiveEndpoint(): Promise<void> {
    if (!status?.running) return
    setTestResult(tt(language, 'streaming.test.running'))
    try {
      const result = await window.ipc.invoke<StreamingSelfTestResult>(STREAMING_CHANNELS.selfTest)
      setTestResult(result.message)
    } catch (err) {
      setTestResult(err instanceof Error ? err.message : tt(language, 'streaming.test.failed'))
    }
  }

  async function changeAutoTunnel(enabled: boolean): Promise<void> {
    if (!status?.running) {
      setAutoTunnel(enabled)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const nextStatus = await window.ipc.invoke<StreamingStatus>(
        enabled ? STREAMING_CHANNELS.startTunnel : STREAMING_CHANNELS.stopTunnel
      )
      setStatus(nextStatus)
      setAutoTunnel(nextStatus.autoTunnelEnabled)
      setPublicBaseUrl(nextStatus.publicBaseUrl ?? '')
    } catch (err) {
      setError(err instanceof Error ? err.message : tt(language, 'streaming.error.tunnel'))
      setAutoTunnel(status.autoTunnelEnabled)
    } finally {
      setBusy(false)
    }
  }

  async function rotateReceiverPairing(): Promise<void> {
    if (!status?.running) return
    setBusy(true)
    setError(null)
    setCopied(null)
    try {
      const nextStatus = await window.ipc.invoke<StreamingStatus>(STREAMING_CHANNELS.rotateReceiverPairing)
      setStatus(nextStatus)
    } catch (err) {
      setError(err instanceof Error ? err.message : tt(language, 'streaming.receiver.rotateFailed'))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void loadTargetProfiles()
  }, [])

  useEffect(() => {
    if (!status?.running) return
    const timer = window.setInterval(() => {
      void refreshStatus().catch(() => undefined)
    }, 2_000)
    return () => window.clearInterval(timer)
  }, [status?.running])

  useEffect(() => {
    const unsubscribeDashboards = window.ipc.subscribe<DashboardSummary[]>('app:dash:list', setDashboards)
    const unsubscribeTouchPanels = window.ipc.subscribe<ButtonBoxSummary[]>('app:touchpanel:list', setTouchPanels)
    const unsubscribeSettings = window.ipc.subscribe<AppSettings>('app:settingsChanged', (settings) => {
      setTargetSettings(settings.streamTargets)
    })
    return () => {
      unsubscribeDashboards()
      unsubscribeTouchPanels()
      unsubscribeSettings()
    }
  }, [])

  useEffect(() => {
    if (!createOpen) return
    const selectedSource = newSourceOptions.find((source) => source.id === newSourceId)
    if (selectedSource) return
    const fallback = newSourceOptions[0]
    setNewSourceId(fallback?.id ?? '')
    setNewTargetLabel(fallback?.label ?? '')
  }, [createOpen, newSourceId, newSourceOptions])

  const running = Boolean(status?.running)
  const accessDisabled = busy || running
  const requiresPassword = accessMode !== 'local'
  const missingPassword = requiresPassword && !password.trim()
  const autoTunnelAvailable = status?.autoTunnelAvailable ?? false
  const missingInternetUrl = accessMode === 'internet' &&
    !publicBaseUrl.trim() &&
    (!autoTunnel || !autoTunnelAvailable)
  const missingTarget = !selectedProfile || selectedProfile.missing

  return (
    <section className="panel streaming-panel">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h4 style={{ margin: '0 0 8px', color: '#f6fbff' }}>{tt(language, 'streaming.title')}</h4>
        <span className={running ? 'status-pill on' : 'status-pill'}>
          {running ? tt(language, 'streaming.status.online', { count: status?.clients ?? 0 }) : tt(language, 'streaming.status.offline')}
        </span>
      </div>
      <p className="overlay-help">{tt(language, 'streaming.summary')}</p>
      <p className="overlay-help" style={{ color: '#76f7bd', fontWeight: 800 }}>{tt(language, 'streaming.readOnly')}</p>
      {error ? <p className="overlay-help" style={{ color: 'var(--accent-danger, #fb7185)' }}>? {error}</p> : null}
      {status?.warning ? <p className="overlay-help" style={{ color: 'var(--accent-warning, #fbbf24)' }}>? {status.warning}</p> : null}
      <section aria-labelledby="stream-targets-heading" aria-busy={targetLoading || targetSaving} style={targetManagerStyle}>
        <div style={targetManagerHeaderStyle}>
          <div>
            <h5 id="stream-targets-heading" style={{ margin: 0, color: 'var(--text-primary)' }}>
              {tt(language, 'streaming.targets.title')}
            </h5>
            <p className="overlay-help" style={{ margin: '4px 0 0' }}>
              {tt(language, 'streaming.targets.help')}
            </p>
          </div>
          <div className="overlay-actions" style={{ margin: 0 }}>
            {missingProfiles.length > 0 ? (
              <button
                className="ghost-action danger"
                type="button"
                disabled={running || targetSaving}
                onClick={() => void clearMissingTargets()}
              >
                {tt(language, 'streaming.targets.clearMissing', { count: missingProfiles.length })}
              </button>
            ) : null}
            <button
              className="ghost-action"
              type="button"
              disabled={running || targetLoading || targetSaving || targetSources.length === 0}
              onClick={beginCreateTarget}
            >
              {tt(language, 'streaming.targets.create')}
            </button>
          </div>
        </div>

        {targetError ? (
          <div role="alert" style={targetErrorStyle}>
            <span>{targetError}</span>
            <button className="ghost-action" type="button" disabled={targetLoading} onClick={() => void loadTargetProfiles()}>
              {tt(language, 'streaming.targets.retry')}
            </button>
          </div>
        ) : null}

        {targetLoading ? (
          <p role="status" className="overlay-help" style={{ margin: 0 }}>
            {tt(language, 'streaming.targets.loading')}
          </p>
        ) : null}

        {!targetLoading && targetSources.length === 0 ? (
          <div role="status" style={targetEmptyStyle}>
            <strong>{tt(language, 'streaming.targets.noSourcesTitle')}</strong>
            <p className="overlay-help" style={{ margin: 0 }}>{tt(language, 'streaming.targets.noSourcesHelp')}</p>
            <div className="overlay-actions" style={{ margin: 0 }}>
              <button className="ghost-action" type="button" onClick={() => navigateToView('dashboards')}>
                {tt(language, 'streaming.targets.openDashboards')}
              </button>
              <button className="ghost-action" type="button" onClick={() => navigateToView('touch-controls')}>
                {tt(language, 'streaming.targets.openTouch')}
              </button>
            </div>
          </div>
        ) : null}

        {!targetLoading && targetSources.length > 0 && resolvedProfiles.length === 0 ? (
          <div role="status" style={targetEmptyStyle}>
            <strong>{tt(language, 'streaming.targets.emptyTitle')}</strong>
            <p className="overlay-help" style={{ margin: 0 }}>{tt(language, 'streaming.targets.emptyHelp')}</p>
            <button className="ghost-action" type="button" disabled={running || targetSaving} onClick={beginCreateTarget}>
              {tt(language, 'streaming.targets.createFirst')}
            </button>
          </div>
        ) : null}

        {resolvedProfiles.length > 0 ? (
          <ul aria-label={tt(language, 'streaming.targets.listLabel')} style={targetProfileListStyle}>
            {resolvedProfiles.map((profile, index) => {
              const selected = profile.id === targetSettings.selectedProfileId
              const profileDescriptionId = `stream-target-${index}-${profile.id.replace(/[^A-Za-z0-9_-]/g, '-')}-description`
              return (
                <li
                  key={profile.id}
                  style={{
                    ...targetProfileStyle,
                    ...(selected ? targetProfileSelectedStyle : {}),
                    ...(profile.missing ? targetProfileMissingStyle : {})
                  }}
                >
                  <div style={{ display: 'grid', gap: 5, minWidth: 0 }}>
                    {editingProfileId === profile.id ? (
                      <form
                        style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
                        onSubmit={(event) => {
                          event.preventDefault()
                          void saveRenamedTarget(profile.id)
                        }}
                      >
                        <label className="designer-field" style={{ flex: '1 1 220px' }}>
                          {tt(language, 'streaming.targets.displayLabel')}
                          <input
                            autoFocus
                            maxLength={96}
                            value={editingLabel}
                            disabled={targetSaving}
                            onChange={(event) => setEditingLabel(event.currentTarget.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Escape') setEditingProfileId(null)
                            }}
                          />
                        </label>
                        <button className="ghost-action" type="submit" disabled={targetSaving || !editingLabel.trim()}>
                          {tt(language, 'streaming.targets.saveRename')}
                        </button>
                        <button className="ghost-action" type="button" disabled={targetSaving} onClick={() => setEditingProfileId(null)}>
                          {tt(language, 'streaming.targets.cancel')}
                        </button>
                      </form>
                    ) : (
                      <label style={targetProfileLabelStyle}>
                        <input
                          type="radio"
                          name="stream-target-profile"
                          checked={selected}
                          disabled={running || targetSaving || profile.missing}
                          aria-describedby={profileDescriptionId}
                          onChange={() => void chooseTargetProfile(profile.id)}
                        />
                        <span style={{ minWidth: 0 }}>
                          <strong style={{ display: 'block', color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>
                            {profile.label}
                          </strong>
                          <small id={profileDescriptionId} style={targetKindStyle}>
                            {tt(language, profile.kind === 'touch' ? 'streaming.target.touch' : 'streaming.target.dashboard')}
                            {' · '}
                            {profile.missing
                              ? tt(language, 'streaming.targets.missingSource', { id: profile.sourceId })
                              : profile.source?.label}
                          </small>
                        </span>
                      </label>
                    )}
                  </div>
                  <div role="group" aria-label={tt(language, 'streaming.targets.actionsFor', { label: profile.label })} style={targetProfileActionsStyle}>
                    <button
                      className="ghost-action"
                      type="button"
                      aria-label={tt(language, 'streaming.targets.moveUpAria', { label: profile.label })}
                      title={tt(language, 'streaming.targets.moveUp')}
                      disabled={running || targetSaving || index === 0}
                      onClick={() => void moveTargetProfile(profile.id, -1)}
                    >
                      ↑
                    </button>
                    <button
                      className="ghost-action"
                      type="button"
                      aria-label={tt(language, 'streaming.targets.moveDownAria', { label: profile.label })}
                      title={tt(language, 'streaming.targets.moveDown')}
                      disabled={running || targetSaving || index === resolvedProfiles.length - 1}
                      onClick={() => void moveTargetProfile(profile.id, 1)}
                    >
                      ↓
                    </button>
                    <button
                      className="ghost-action"
                      type="button"
                      disabled={running || targetSaving}
                      onClick={() => beginRenameTarget(profile)}
                    >
                      {tt(language, 'streaming.targets.rename')}
                    </button>
                    <button
                      className="ghost-action danger"
                      type="button"
                      disabled={running || targetSaving}
                      onClick={() => void removeTargetProfile(profile.id)}
                    >
                      {profile.missing
                        ? tt(language, 'streaming.targets.removeMissing')
                        : tt(language, 'streaming.targets.delete')}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        ) : null}

        {createOpen ? (
          <fieldset disabled={running || targetSaving} style={targetCreateStyle}>
            <legend>{tt(language, 'streaming.targets.createTitle')}</legend>
            <label className="designer-field">
              {tt(language, 'streaming.targets.kind')}
              <select
                value={newTargetKind}
                onChange={(event) => {
                  const kind = event.currentTarget.value as StreamingLayoutKind
                  const source = targetSources.find((candidate) => candidate.kind === kind)
                  setNewTargetKind(kind)
                  setNewSourceId(source?.id ?? '')
                  setNewTargetLabel(source?.label ?? '')
                }}
              >
                <option value="dashboard">{tt(language, 'streaming.target.dashboard')}</option>
                <option value="touch">{tt(language, 'streaming.target.touch')}</option>
              </select>
            </label>
            <label className="designer-field">
              {tt(language, 'streaming.targets.source')}
              <select
                value={newSourceId}
                disabled={newSourceOptions.length === 0}
                onChange={(event) => {
                  const source = newSourceOptions.find((candidate) => candidate.id === event.currentTarget.value)
                  setNewSourceId(event.currentTarget.value)
                  setNewTargetLabel(source?.label ?? '')
                }}
              >
                {newSourceOptions.length === 0 ? (
                  <option value="">{tt(language, 'streaming.targets.noSourcesForKind')}</option>
                ) : newSourceOptions.map((source) => (
                  <option key={source.id} value={source.id}>{source.label}</option>
                ))}
              </select>
            </label>
            <label className="designer-field">
              {tt(language, 'streaming.targets.displayLabel')}
              <input
                maxLength={96}
                value={newTargetLabel}
                placeholder={tt(language, 'streaming.targets.labelPlaceholder')}
                onChange={(event) => setNewTargetLabel(event.currentTarget.value)}
              />
            </label>
            <div className="overlay-actions" style={{ margin: 0 }}>
              <button
                className="primary-action"
                type="button"
                disabled={!newSourceId || !newTargetLabel.trim()}
                onClick={() => void createTargetProfile()}
              >
                {tt(language, 'streaming.targets.add')}
              </button>
              <button className="ghost-action" type="button" onClick={() => setCreateOpen(false)}>
                {tt(language, 'streaming.targets.cancel')}
              </button>
            </div>
          </fieldset>
        ) : null}

        {selectedProfile?.missing ? (
          <p role="alert" style={targetMissingAlertStyle}>
            {tt(language, 'streaming.targets.selectedMissing')}
          </p>
        ) : null}
        {running ? (
          <p className="overlay-help" style={{ margin: 0 }}>
            {tt(language, 'streaming.targets.lockedWhileRunning')}
          </p>
        ) : null}
      </section>
      <label className="designer-check" style={{ margin: '12px 0' }}>
        <input type="checkbox" checked={streamSafe} disabled={accessDisabled} onChange={(event) => setStreamSafe(event.target.checked)} />
        {tt(language, 'streaming.streamSafe')}
      </label>
      <label className="designer-field" style={{ margin: '12px 0' }}>
        {tt(language, 'streaming.networkAccess')}
        <select
          value={accessMode}
          disabled={accessDisabled}
          onChange={(event) => {
            const nextMode = event.target.value as StreamingAccessMode
            setAccessMode(nextMode)
            if (nextMode !== 'internet') setAutoTunnel(false)
          }}
        >
          {Object.entries(ACCESS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <p className="overlay-help" style={{ marginTop: -4 }}>
        {accessHelp(language, accessMode, publicBaseUrl, autoTunnel, autoTunnelAvailable)}
      </p>
      {accessMode === 'internet' ? (
        <>
          <label className="designer-check" style={{ margin: '12px 0' }}>
            <input
              type="checkbox"
              checked={autoTunnel}
              disabled={busy}
              onChange={(event) => void changeAutoTunnel(event.target.checked)}
            />
            {tt(language, 'streaming.autoTunnel')}
          </label>
          <p className="overlay-help" style={{ marginTop: -6 }}>
            {autoTunnelAvailable
              ? tt(language, 'streaming.autoTunnelHelp')
              : tt(language, 'streaming.autoTunnelUnavailable')}
          </p>
          {status?.autoTunnelMessage ? (
            <p
              className="overlay-help"
              style={{ color: status.autoTunnelRunning ? '#76f7bd' : 'var(--accent-warning, #fbbf24)' }}
            >
              {status.autoTunnelMessage}
            </p>
          ) : null}
          <label className="designer-field" style={{ margin: '12px 0' }}>
            {autoTunnel ? tt(language, 'streaming.publicUrlFallback') : tt(language, 'streaming.publicUrl')}
            <input
              value={publicBaseUrl}
              disabled={accessDisabled}
              placeholder="https://your-tunnel.example"
              onChange={(event) => setPublicBaseUrl(event.target.value)}
            />
          </label>
        </>
      ) : null}
      <label className="designer-field" style={{ margin: '12px 0' }}>
        {requiresPassword ? tt(language, 'streaming.password.required') : tt(language, 'streaming.password.optional')}
        <input
          type="password"
          value={password}
          disabled={accessDisabled}
          placeholder={requiresPassword ? tt(language, 'streaming.password.placeholderRequired') : tt(language, 'streaming.password.placeholderOptional')}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      <div className="overlay-actions">
        <button className="primary-action" disabled={busy || running || targetLoading || targetSaving || missingPassword || missingInternetUrl || missingTarget} onClick={() => void startStreaming()}>{tt(language, 'streaming.start')}</button>
        <button className="ghost-action danger" disabled={busy || !running} onClick={() => void stopStreaming()}>{tt(language, 'streaming.stop')}</button>
        <button className="ghost-action" disabled={busy} onClick={() => void refreshStatus()}>{tt(language, 'streaming.refresh')}</button>
      </div>
      {status?.url ? (
        <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
          <p className="overlay-help">{tt(language, 'streaming.mode')}: <strong>{ACCESS_LABELS[statusAccessMode(status)]}</strong></p>
          {statusAccessMode(status) === 'lan' && status.lanAddress ? <p className="overlay-help">{tt(language, 'streaming.lanDetected')}: <strong>{status.lanAddress}</strong> ? {tt(language, 'streaming.port')}: <strong>{status.port}</strong></p> : null}
          {status.firewallMessage ? <p className="overlay-help">? {status.firewallMessage}</p> : null}
          <label className="designer-field">
            {tt(language, 'streaming.dashboardUrl')}
            <input readOnly value={status.url} onFocus={(event) => event.currentTarget.select()} />
          </label>
          {status.lanUrl && status.lanUrl !== status.url ? (
            <label className="designer-field">
              {tt(language, 'streaming.lanUrl')}
              <input readOnly value={status.lanUrl} onFocus={(event) => event.currentTarget.select()} />
            </label>
          ) : null}
          {status.password ? (
            <label className="designer-field">
              {tt(language, 'streaming.currentPassword')}
              <input readOnly value={status.password} onFocus={(event) => event.currentTarget.select()} />
            </label>
          ) : null}
          {status.qrDataUrl ? (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <div>
                <div className="overlay-help" style={{ marginBottom: 6 }}>{tt(language, 'streaming.qrDashboard')}</div>
                <img src={status.qrDataUrl} alt={tt(language, 'streaming.qrAlt')} style={{ width: 152, height: 152, borderRadius: 12 }} />
              </div>
            </div>
          ) : null}
          <div className="overlay-actions">
            <button className="ghost-action" onClick={() => void copyUrl('dashboard', status.url)}>{copied === 'dashboard' ? tt(language, 'streaming.copied') : tt(language, 'streaming.copyDashboard')}</button>
            {status.lanUrl && status.lanUrl !== status.url ? (
              <button className="ghost-action" onClick={() => void copyUrl('lan', status.lanUrl)}>{copied === 'lan' ? tt(language, 'streaming.copied') : tt(language, 'streaming.copyLan')}</button>
            ) : null}
            <button className="ghost-action" disabled={!status.running} onClick={() => void testActiveEndpoint()}>{tt(language, 'streaming.test.button')}</button>
          </div>
          {testResult ? <p className="overlay-help" style={{ margin: 0 }}>{testResult}</p> : null}
          <div style={{ display: 'grid', gap: 6, marginTop: 4 }}>
            <p className="overlay-help" style={{ margin: 0 }}>{status.passwordEnabled ? tt(language, 'streaming.authTokenPassword') : tt(language, 'streaming.authToken')}</p>
            {status.devices.length > 0 ? (
              <div>
                <div className="overlay-help" style={{ marginBottom: 6 }}>{tt(language, 'streaming.connectedDevices')}</div>
                <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-muted)' }}>
                  {status.devices.map((device) => <li key={device.id}>{device.address} ? {formatDeviceName(device.userAgent)}</li>)}
                </ul>
              </div>
            ) : (
              <p className="overlay-help" style={{ margin: 0 }}>{tt(language, 'streaming.noDevices')}</p>
            )}
          </div>
          <div style={{ display: 'grid', gap: 8, marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-default)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <strong style={{ color: '#f6fbff' }}>{tt(language, 'streaming.receiver.title')}</strong>
              <span className={status.receiverV2.clients.length > 0 ? 'status-pill on' : 'status-pill'}>
                {status.receiverV2.clients.length > 0
                  ? tt(language, 'streaming.receiver.connected', { count: status.receiverV2.clients.length })
                  : tt(language, 'streaming.receiver.waiting')}
              </span>
            </div>
            <p className="overlay-help" style={{ margin: 0, color: '#76f7bd', fontWeight: 800 }}>
              {tt(language, 'streaming.receiver.dataDiode')}
            </p>
            <p className="overlay-help" style={{ margin: 0 }}>
              {tt(language, 'streaming.receiver.transport')}: <strong>{status.receiverV2.transportProfile}</strong>
              {' · '}{tt(language, 'streaming.receiver.bind')}: <strong>{status.receiverV2.bindAddress ?? '—'}</strong>
              {' · '}v{status.receiverV2.protocolVersion}/schema {status.receiverV2.schemaVersion}
            </p>
            <p className="overlay-help" style={{ margin: 0 }}>
              {tt(language, 'streaming.receiver.transportHelp')}
            </p>
            {status.receiverV2.blockedReason ? (
              <p className="overlay-help" style={{ margin: 0, color: 'var(--accent-warning, #fbbf24)' }}>
                {status.receiverV2.blockedReason}
              </p>
            ) : null}
            {status.receiverV2.pairingUrl ? (
              <label className="designer-field">
                {tt(language, 'streaming.receiver.pairingUrl')}
                <input readOnly value={status.receiverV2.pairingUrl} onFocus={(event) => event.currentTarget.select()} />
              </label>
            ) : (
              <p className="overlay-help" style={{ margin: 0 }}>
                {status.receiverV2.pairingConsumed
                  ? tt(language, 'streaming.receiver.pairingConsumed')
                  : tt(language, 'streaming.receiver.pairingUnavailable')}
              </p>
            )}
            <p className="overlay-help" style={{ margin: 0 }}>
              {tt(language, 'streaming.receiver.secretHandling')}
            </p>
            <div className="overlay-actions">
              <button
                className="ghost-action"
                disabled={!status.receiverV2.pairingUrl}
                onClick={() => void copyUrl('receiver', status.receiverV2.pairingUrl)}
              >
                {copied === 'receiver' ? tt(language, 'streaming.copied') : tt(language, 'streaming.receiver.copy')}
              </button>
              <button className="ghost-action" disabled={busy} onClick={() => void rotateReceiverPairing()}>
                {tt(language, 'streaming.receiver.rotate')}
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
              <div className="overlay-help">
                {tt(language, 'streaming.receiver.setup')}: <strong>
                  {status.receiverV2.metrics.setupTimeMs === null ? '—' : `${status.receiverV2.metrics.setupTimeMs} ms`}
                </strong>
                {' / '}{status.receiverV2.metrics.setupBudgetMs} ms
              </div>
              <div className="overlay-help">
                {tt(language, 'streaming.receiver.latency')}: <strong>
                  {status.receiverV2.metrics.latencyP95Ms === null ? '—' : `${status.receiverV2.metrics.latencyP95Ms} ms`}
                </strong>
                {' / '}{status.receiverV2.metrics.latencyBudgetMs} ms
              </div>
              <div className="overlay-help">
                {tt(language, 'streaming.receiver.reliability')}: <strong>{status.receiverV2.metrics.reliabilityPct.toFixed(2)}%</strong>
                {' / '}{status.receiverV2.metrics.reliabilityTargetPct}%
              </div>
              <div className="overlay-help">
                {tt(language, 'streaming.receiver.reconnects')}: <strong>{status.receiverV2.metrics.reconnects}</strong>
                {' · '}{tt(language, 'streaming.receiver.resyncs')}: <strong>{status.receiverV2.metrics.resyncs}</strong>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <p className="overlay-help" style={{ marginTop: 10 }}>{tt(language, 'streaming.afterStart')}</p>
      )}
    </section>
  )
}

const targetManagerStyle: CSSProperties = {
  display: 'grid',
  gap: 12,
  margin: '16px 0',
  padding: 14,
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md, 12px)',
  background: 'var(--surface-sunken, rgba(0, 0, 0, 0.18))'
}

const targetManagerHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 12,
  flexWrap: 'wrap'
}

const targetErrorStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  flexWrap: 'wrap',
  padding: 10,
  border: '1px solid color-mix(in srgb, var(--accent-danger, #fb7185) 50%, transparent)',
  borderRadius: 8,
  color: 'var(--accent-danger, #fb7185)'
}

const targetEmptyStyle: CSSProperties = {
  display: 'grid',
  gap: 8,
  padding: 12,
  border: '1px dashed var(--border-default)',
  borderRadius: 8,
  color: 'var(--text-muted)'
}

const targetProfileListStyle: CSSProperties = {
  display: 'grid',
  gap: 8,
  margin: 0,
  padding: 0,
  listStyle: 'none',
}

const targetProfileStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  alignItems: 'center',
  gap: 12,
  padding: 10,
  border: '1px solid var(--border-default)',
  borderRadius: 9,
  background: 'var(--surface-base)'
}

const targetProfileSelectedStyle: CSSProperties = {
  borderColor: 'var(--accent-primary, #76f7bd)',
  boxShadow: '0 0 0 1px color-mix(in srgb, var(--accent-primary, #76f7bd) 35%, transparent)'
}

const targetProfileMissingStyle: CSSProperties = {
  borderColor: 'var(--accent-danger, #fb7185)'
}

const targetProfileLabelStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  cursor: 'pointer'
}

const targetProfileActionsStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 6,
  flexWrap: 'wrap'
}

const targetKindStyle: CSSProperties = {
  color: 'var(--text-muted)',
  fontWeight: 500,
  overflowWrap: 'anywhere'
}

const targetCreateStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 10,
  margin: 0,
  padding: 12,
  border: '1px solid var(--border-default)',
  borderRadius: 9
}

const targetMissingAlertStyle: CSSProperties = {
  margin: 0,
  padding: 10,
  borderRadius: 8,
  color: 'var(--accent-danger, #fb7185)',
  background: 'color-mix(in srgb, var(--accent-danger, #fb7185) 10%, transparent)'
}
