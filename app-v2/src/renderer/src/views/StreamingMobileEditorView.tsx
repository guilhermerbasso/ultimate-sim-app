import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type ReactElement
} from 'react'
import type { Dashboard } from '../../../shared/dashboards'
import {
  STREAM_DEVICE_PRESETS,
  STREAM_PRESENTATION_CHANNELS,
  cloneStreamPresentationProfile,
  createStreamPresentationProfile,
  resolveStreamPresentation,
  streamDevicePreset,
  streamPresentationTargetState,
  type StreamPresentationBreakpoint,
  type StreamPresentationFitMode,
  type StreamPresentationProfile,
  type StreamPresentationProfileListItem,
  type StreamPresentationTargetDescriptor,
  type StreamSafeAreaInsets,
  type StreamVisibilityOverride
} from '../../../shared/stream-presentation'
import { STREAMING_CHANNELS, type StreamingStartResult } from '../../../shared/streaming'
import { parseButtonBoxPanel, type ButtonBoxPanel } from '../../../shared/touch-panel'
import type { AppViewProps } from '../App'
import { tt } from '../i18n'
import { navigateToView } from '../lib/app-navigation'
import StreamingSourceManager from '../components/StreamingSourceManager'
import { ResponsiveStreamPresentationFrame } from '../stream-presentation/ResponsiveStreamPresentationFrame'
import './streaming-mobile-editor.css'

type VisibilityScope = 'base' | string

interface VisibilityItem {
  id: string
  label: string
  detail: string
}

function targetKey(target: Pick<StreamPresentationTargetDescriptor, 'kind' | 'id'>): string {
  return `${target.kind}:${target.id}`
}

function numberFromInput(event: ChangeEvent<HTMLInputElement>, fallback: number): number {
  const value = Number(event.target.value)
  return Number.isFinite(value) ? Math.round(value) : fallback
}

function optionalNumberFromInput(event: ChangeEvent<HTMLInputElement>): number | undefined {
  if (!event.target.value.trim()) return undefined
  const value = Number(event.target.value)
  return Number.isFinite(value) ? Math.round(value) : undefined
}

function baseVisibility(profile: StreamPresentationProfile, id: string): boolean {
  return profile.settings.visibilityOverrides.find((item) => item.elementId === id)?.visible ?? true
}

function scopeVisibility(profile: StreamPresentationProfile, scope: VisibilityScope, id: string): boolean {
  const base = baseVisibility(profile, id)
  if (scope === 'base') return base
  const breakpoint = profile.settings.breakpoints.find((item) => item.id === scope)
  return breakpoint?.visibilityOverrides?.find((item) => item.elementId === id)?.visible ?? base
}

function updatedOverrides(
  current: readonly StreamVisibilityOverride[],
  id: string,
  visible: boolean,
  inherited = true
): StreamVisibilityOverride[] {
  const next = current.filter((item) => item.elementId !== id)
  if (visible !== inherited) next.push({ elementId: id, visible })
  return next
}

function profileTargetLabel(
  item: StreamPresentationProfileListItem,
  language: AppViewProps['language']
): string {
  if (!item.target) return tt(language, 'streamMobile.targetMissing')
  return `${item.target.kind === 'dashboard' ? tt(language, 'streamMobile.dashboard') : tt(language, 'streamMobile.touchControls')} · ${item.target.name}`
}

export default function StreamingMobileEditorView({ showToast, language }: AppViewProps): ReactElement {
  const [targets, setTargets] = useState<StreamPresentationTargetDescriptor[]>([])
  const [profiles, setProfiles] = useState<StreamPresentationProfileListItem[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null)
  const [draft, setDraft] = useState<StreamPresentationProfile | null>(null)
  const [baseRevision, setBaseRevision] = useState<number | null>(null)
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [touchPanel, setTouchPanel] = useState<ButtonBoxPanel | null>(null)
  const [newTargetKey, setNewTargetKey] = useState('')
  const [visibilityScope, setVisibilityScope] = useState<VisibilityScope>('base')
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const refreshCatalog = useCallback(async (): Promise<void> => {
    const [nextTargets, nextProfiles] = await Promise.all([
      window.ipc.invoke<StreamPresentationTargetDescriptor[]>(STREAM_PRESENTATION_CHANNELS.targets),
      window.ipc.invoke<StreamPresentationProfileListItem[]>(STREAM_PRESENTATION_CHANNELS.list)
    ])
    setTargets(Array.isArray(nextTargets) ? nextTargets : [])
    setProfiles(Array.isArray(nextProfiles) ? nextProfiles : [])
    setNewTargetKey((current) => {
      if (current && nextTargets.some((target) => targetKey(target) === current)) return current
      const first = nextTargets.find((target) => !target.hidden) ?? nextTargets[0]
      return first ? targetKey(first) : ''
    })
    setSelectedProfileId((current) => {
      if (current !== null && nextProfiles.some((item) => item.profile.id === current)) return current
      return nextProfiles[0]?.profile.id ?? null
    })
  }, [])
  const handleSourcesChanged = useCallback((): void => {
    void refreshCatalog().catch(() => undefined)
  }, [refreshCatalog])

  useEffect(() => {
    void refreshCatalog().catch((error) => {
      setLoadError(error instanceof Error ? error.message : tt(language, 'streamMobile.loadFailed'))
    })
    const offProfiles = window.ipc.subscribe<StreamPresentationProfileListItem[]>(
      STREAM_PRESENTATION_CHANNELS.list,
      (items) => setProfiles(Array.isArray(items) ? items : [])
    )
    return () => {
      offProfiles()
    }
  }, [language, refreshCatalog])

  useEffect(() => {
    const item = profiles.find((candidate) => candidate.profile.id === selectedProfileId)
    if (!item) return
    if (!draft || draft.id !== item.profile.id || (!dirty && draft.revision !== item.profile.revision)) {
      setDraft(cloneStreamPresentationProfile(item.profile))
      setBaseRevision(item.profile.revision)
    }
    if (!dirty) setVisibilityScope('base')
  }, [dirty, draft?.id, draft?.revision, profiles, selectedProfileId])

  const currentTarget = useMemo(
    () => draft
      ? targets.find((target) => target.kind === draft.target.kind && target.id === draft.target.id) ?? null
      : null,
    [draft, targets]
  )
  const targetState = draft ? streamPresentationTargetState(draft, currentTarget) : 'missing'

  useEffect(() => {
    setDashboard(null)
    setTouchPanel(null)
    setLoadError(null)
    if (!draft || !currentTarget) return
    let alive = true
    const request = draft.target.kind === 'dashboard'
      ? window.ipc.invoke<Dashboard | null>('app:dash:get', draft.target.id)
      : window.ipc.invoke('app:touchpanel:get', draft.target.id)
    void request
      .then((raw) => {
        if (!alive) return
        if (draft.target.kind === 'dashboard') {
          setDashboard(raw as Dashboard | null)
          return
        }
        const parsed = parseButtonBoxPanel(raw)
        if (!parsed) throw new Error(tt(language, 'streamMobile.invalidTouchTarget'))
        setTouchPanel(parsed)
      })
      .catch((error) => {
        if (alive) setLoadError(error instanceof Error ? error.message : tt(language, 'streamMobile.targetLoadFailed'))
      })
    return () => {
      alive = false
    }
  }, [currentTarget, draft?.target.id, draft?.target.kind, language])

  useEffect(() => {
    if (
      visibilityScope !== 'base' &&
      !draft?.settings.breakpoints.some((breakpoint) => breakpoint.id === visibilityScope)
    ) {
      setVisibilityScope('base')
    }
  }, [draft?.settings.breakpoints, visibilityScope])

  const resolved = useMemo(() => draft ? resolveStreamPresentation(draft) : null, [draft])
  const selectedStoredItem = profiles.find((item) => item.profile.id === draft?.id) ?? null
  const visibilityItems = useMemo<VisibilityItem[]>(() => {
    if (dashboard) {
      return dashboard.elements.map((element) => ({
        id: element.id,
        label: element.id,
        detail: element.type
      }))
    }
    if (touchPanel) {
      return touchPanel.buttons.map((button, index) => ({
        id: button.id,
        label: button.label || `${tt(language, 'streamMobile.control')} ${index + 1}`,
        detail: button.control.kind
      }))
    }
    return []
  }, [dashboard, language, touchPanel])

  function updateDraft(update: (profile: StreamPresentationProfile) => StreamPresentationProfile): void {
    setDraft((current) => current ? update(cloneStreamPresentationProfile(current)) : current)
    setDirty(true)
  }

  function selectStoredProfile(id: string): void {
    if (id === selectedProfileId) return
    if (dirty && !window.confirm(tt(language, 'streamMobile.discardConfirm'))) return
    const item = profiles.find((candidate) => candidate.profile.id === id)
    if (!item) return
    setSelectedProfileId(id)
    setDraft(cloneStreamPresentationProfile(item.profile))
    setBaseRevision(item.profile.revision)
    setVisibilityScope('base')
    setDirty(false)
  }

  function createProfile(): void {
    if (dirty && !window.confirm(tt(language, 'streamMobile.discardConfirm'))) return
    const target = targets.find((candidate) => targetKey(candidate) === newTargetKey)
    if (!target) return
    const profile = createStreamPresentationProfile(target)
    setSelectedProfileId(profile.id)
    setDraft(profile)
    setBaseRevision(null)
    setVisibilityScope('base')
    setDirty(true)
  }

  async function saveProfile(): Promise<void> {
    if (!draft || targetState === 'missing') return
    setBusy(true)
    try {
      const saved = await window.ipc.invoke<StreamPresentationProfileListItem>(
        STREAM_PRESENTATION_CHANNELS.save,
        {
          profile: draft,
          expectedRevision: baseRevision
        }
      )
      setDraft(cloneStreamPresentationProfile(saved.profile))
      setBaseRevision(saved.profile.revision)
      setSelectedProfileId(saved.profile.id)
      setProfiles((current) => [
        saved,
        ...current.filter((item) => item.profile.id !== saved.profile.id)
      ])
      setDirty(false)
      showToast(tt(language, 'streamMobile.saved'), 'success')
    } catch (error) {
      await refreshCatalog().catch(() => undefined)
      showToast(error instanceof Error ? error.message : tt(language, 'streamMobile.saveFailed'), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function startProfile(): Promise<void> {
    if (!selectedStoredItem || dirty || targetState !== 'current') return
    setBusy(true)
    try {
      await window.ipc.invoke<StreamingStartResult>(STREAMING_CHANNELS.start, {
        presentationProfileId: selectedStoredItem.profile.id
      })
      showToast(tt(language, 'streamMobile.started'), 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : tt(language, 'streamMobile.startFailed'), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function deleteProfile(): Promise<void> {
    if (
      !selectedStoredItem ||
      baseRevision === null ||
      !window.confirm(tt(language, 'streamMobile.deleteConfirm'))
    ) return
    setBusy(true)
    try {
      const remaining = await window.ipc.invoke<StreamPresentationProfileListItem[]>(
        STREAM_PRESENTATION_CHANNELS.delete,
        {
          id: selectedStoredItem.profile.id,
          expectedRevision: baseRevision
        }
      )
      setProfiles(remaining)
      setSelectedProfileId(remaining[0]?.profile.id ?? null)
      setDraft(remaining[0] ? cloneStreamPresentationProfile(remaining[0].profile) : null)
      setBaseRevision(remaining[0]?.profile.revision ?? null)
      setDirty(false)
      showToast(tt(language, 'streamMobile.deleted'), 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : tt(language, 'streamMobile.deleteFailed'), 'error')
    } finally {
      setBusy(false)
    }
  }

  function applyDevicePreset(id: string): void {
    const preset = streamDevicePreset(id)
    updateDraft((profile) => ({
      ...profile,
      settings: {
        ...profile.settings,
        devicePresetId: preset.id,
        viewport: { ...preset.viewport },
        safeArea: { ...preset.safeArea },
        minimumTouchTarget: preset.minimumTouchTarget
      }
    }))
  }

  function updateSafeArea(edge: keyof StreamSafeAreaInsets, value: number): void {
    updateDraft((profile) => ({
      ...profile,
      settings: {
        ...profile.settings,
        safeArea: {
          ...profile.settings.safeArea,
          [edge]: Math.max(0, Math.min(4096, value))
        }
      }
    }))
  }

  function addBreakpoint(): void {
    updateDraft((profile) => ({
      ...profile,
      settings: {
        ...profile.settings,
        breakpoints: [
          ...profile.settings.breakpoints,
          {
            id: `breakpoint-${Date.now().toString(36)}`,
            name: tt(language, 'streamMobile.compactBreakpoint'),
            maxWidth: 480,
            fitMode: 'fit',
            minimumTouchTarget: profile.settings.minimumTouchTarget,
            visibilityOverrides: []
          }
        ]
      }
    }))
  }

  function updateBreakpoint(id: string, patch: Partial<StreamPresentationBreakpoint>): void {
    updateDraft((profile) => ({
      ...profile,
      settings: {
        ...profile.settings,
        breakpoints: profile.settings.breakpoints.map((breakpoint) =>
          breakpoint.id === id ? { ...breakpoint, ...patch } : breakpoint
        )
      }
    }))
  }

  function removeBreakpoint(id: string): void {
    updateDraft((profile) => ({
      ...profile,
      settings: {
        ...profile.settings,
        breakpoints: profile.settings.breakpoints.filter((breakpoint) => breakpoint.id !== id)
      }
    }))
  }

  function setVisibility(id: string, visible: boolean): void {
    updateDraft((profile) => {
      if (visibilityScope === 'base') {
        profile.settings.visibilityOverrides = updatedOverrides(
          profile.settings.visibilityOverrides,
          id,
          visible
        )
        return profile
      }
      profile.settings.breakpoints = profile.settings.breakpoints.map((breakpoint) => {
        if (breakpoint.id !== visibilityScope) return breakpoint
        const inherited = baseVisibility(profile, id)
        return {
          ...breakpoint,
          visibilityOverrides: updatedOverrides(
            breakpoint.visibilityOverrides ?? [],
            id,
            visible,
            inherited
          )
        }
      })
      return profile
    })
  }

  function retarget(key: string): void {
    const target = targets.find((candidate) => targetKey(candidate) === key)
    if (!target) return
    updateDraft((profile) => ({
      ...profile,
      target: { kind: target.kind, id: target.id, revision: target.revision }
    }))
  }

  function adoptLatestTarget(): void {
    if (!currentTarget) return
    updateDraft((profile) => ({
      ...profile,
      target: {
        kind: currentTarget.kind,
        id: currentTarget.id,
        revision: currentTarget.revision
      }
    }))
  }

  return (
    <div className="stream-mobile-editor">
      <section className="stream-mobile-hero" aria-labelledby="stream-mobile-title">
        <div>
          <span className="stream-mobile-kicker">{tt(language, 'streamMobile.kicker')}</span>
          <h2 id="stream-mobile-title">{tt(language, 'streamMobile.title')}</h2>
          <p>{tt(language, 'streamMobile.summary')}</p>
        </div>
        <div className="stream-mobile-hero-note" role="note">
          <strong>{tt(language, 'streamMobile.nonDestructive')}</strong>
          <span>{tt(language, 'streamMobile.nonDestructiveDetail')}</span>
          <button type="button" className="stream-mobile-link" onClick={() => navigateToView('streaming')}>
            {tt(language, 'streamMobile.openStreaming')}
          </button>
        </div>
      </section>

      {loadError ? <div className="stream-mobile-alert is-error" role="alert">{loadError}</div> : null}

      <StreamingSourceManager
        language={language}
        onSourcesChanged={handleSourcesChanged}
      />

      <div className="stream-mobile-workbench">
        <aside className="stream-mobile-sidebar" aria-label={tt(language, 'streamMobile.profiles')}>
          <div className="stream-mobile-section-heading">
            <div>
              <span>{tt(language, 'streamMobile.savedProfiles')}</span>
              <strong>{profiles.length}</strong>
            </div>
          </div>
          <div className="stream-mobile-profile-list">
            {profiles.map((item) => (
              <button
                key={item.profile.id}
                type="button"
                className={`stream-mobile-profile ${item.profile.id === selectedProfileId ? 'is-selected' : ''}`}
                onClick={() => selectStoredProfile(item.profile.id)}
                aria-pressed={item.profile.id === selectedProfileId}
              >
                <span>{item.profile.name}</span>
                <small>{profileTargetLabel(item, language)}</small>
                <em className={`is-${item.targetState}`}>
                  {tt(language, `streamMobile.state.${item.targetState}`)}
                </em>
              </button>
            ))}
            {profiles.length === 0 ? (
              <p className="stream-mobile-empty-copy">{tt(language, 'streamMobile.noProfiles')}</p>
            ) : null}
          </div>
          <div className="stream-mobile-new-profile">
            <label>
              <span>{tt(language, 'streamMobile.newTarget')}</span>
              <select value={newTargetKey} onChange={(event) => setNewTargetKey(event.target.value)}>
                {targets.length === 0 ? (
                  <option value="">{tt(language, 'streaming.sources.emptyTitle')}</option>
                ) : null}
                {targets.map((target) => (
                  <option key={targetKey(target)} value={targetKey(target)}>
                    {target.kind === 'dashboard' ? tt(language, 'streamMobile.dashboard') : tt(language, 'streamMobile.touchControls')} · {target.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="stream-mobile-primary" onClick={createProfile} disabled={!newTargetKey}>
              {tt(language, 'streamMobile.createProfile')}
            </button>
          </div>
        </aside>

        <main className="stream-mobile-main">
          {!draft ? (
            <section className="stream-mobile-zero" aria-live="polite">
              <span aria-hidden="true">▱</span>
              <h3>{tt(language, 'streamMobile.chooseProfile')}</h3>
              <p>{tt(language, 'streamMobile.chooseProfileDetail')}</p>
            </section>
          ) : (
            <>
              <section className="stream-mobile-toolbar" aria-label={tt(language, 'streamMobile.profileActions')}>
                <label className="stream-mobile-name">
                  <span>{tt(language, 'streamMobile.profileName')}</span>
                  <input
                    value={draft.name}
                    maxLength={120}
                    onChange={(event) => updateDraft((profile) => ({ ...profile, name: event.target.value }))}
                  />
                </label>
                <div className="stream-mobile-actions">
                  <span className={dirty ? 'is-dirty' : 'is-saved'} aria-live="polite">
                    {dirty ? tt(language, 'streamMobile.unsaved') : tt(language, 'streamMobile.savedState')}
                  </span>
                  <button
                    type="button"
                    className="stream-mobile-primary"
                    onClick={() => void saveProfile()}
                    disabled={busy || !dirty || targetState === 'missing'}
                  >
                    {tt(language, 'streamMobile.save')}
                  </button>
                  <button
                    type="button"
                    className="stream-mobile-primary"
                    onClick={() => void startProfile()}
                    disabled={busy || dirty || !selectedStoredItem || targetState !== 'current'}
                  >
                    {tt(language, 'streamMobile.start')}
                  </button>
                  <button
                    type="button"
                    className="stream-mobile-danger"
                    onClick={() => void deleteProfile()}
                    disabled={busy || !selectedStoredItem}
                  >
                    {tt(language, 'streamMobile.delete')}
                  </button>
                </div>
              </section>

              {targetState !== 'current' ? (
                <div className={`stream-mobile-alert is-${targetState}`} role="alert">
                  <div>
                    <strong>{tt(language, `streamMobile.target.${targetState}.title`)}</strong>
                    <span>{tt(language, `streamMobile.target.${targetState}.detail`)}</span>
                  </div>
                  {targetState === 'stale' ? (
                    <button type="button" onClick={adoptLatestTarget}>
                      {tt(language, 'streamMobile.useLatestTarget')}
                    </button>
                  ) : null}
                </div>
              ) : null}

              <div className="stream-mobile-editor-grid">
                <div className="stream-mobile-controls">
                  <fieldset>
                    <legend>{tt(language, 'streamMobile.targetAndDevice')}</legend>
                    <label>
                      <span>{tt(language, 'streamMobile.target')}</span>
                      <select value={targetKey(draft.target)} onChange={(event) => retarget(event.target.value)}>
                        {!currentTarget ? (
                          <option value={targetKey(draft.target)}>
                            {tt(language, 'streamMobile.missingTargetOption')} · {draft.target.id}
                          </option>
                        ) : null}
                        {targets.map((target) => (
                          <option key={targetKey(target)} value={targetKey(target)}>
                            {target.kind === 'dashboard' ? tt(language, 'streamMobile.dashboard') : tt(language, 'streamMobile.touchControls')} · {target.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>{tt(language, 'streamMobile.devicePreset')}</span>
                      <select
                        value={draft.settings.devicePresetId}
                        onChange={(event) => applyDevicePreset(event.target.value)}
                      >
                        {STREAM_DEVICE_PRESETS.map((preset) => (
                          <option key={preset.id} value={preset.id}>{preset.label}</option>
                        ))}
                      </select>
                    </label>
                    <div className="stream-mobile-segmented" aria-label={tt(language, 'streamMobile.orientation')}>
                      {(['portrait', 'landscape'] as const).map((orientation) => (
                        <button
                          key={orientation}
                          type="button"
                          className={draft.settings.orientation === orientation ? 'is-active' : ''}
                          aria-pressed={draft.settings.orientation === orientation}
                          onClick={() => updateDraft((profile) => ({
                            ...profile,
                            settings: { ...profile.settings, orientation }
                          }))}
                        >
                          {tt(language, `streamMobile.${orientation}`)}
                        </button>
                      ))}
                    </div>
                    <div className="stream-mobile-inline-fields">
                      <label>
                        <span>{tt(language, 'streamMobile.portraitWidth')}</span>
                        <input
                          type="number"
                          min={240}
                          max={4096}
                          value={draft.settings.viewport.width}
                          onChange={(event) => updateDraft((profile) => ({
                            ...profile,
                            settings: {
                              ...profile.settings,
                              viewport: {
                                ...profile.settings.viewport,
                                width: numberFromInput(event, profile.settings.viewport.width)
                              }
                            }
                          }))}
                        />
                      </label>
                      <label>
                        <span>{tt(language, 'streamMobile.portraitHeight')}</span>
                        <input
                          type="number"
                          min={240}
                          max={4096}
                          value={draft.settings.viewport.height}
                          onChange={(event) => updateDraft((profile) => ({
                            ...profile,
                            settings: {
                              ...profile.settings,
                              viewport: {
                                ...profile.settings.viewport,
                                height: numberFromInput(event, profile.settings.viewport.height)
                              }
                            }
                          }))}
                        />
                      </label>
                    </div>
                  </fieldset>

                  <fieldset>
                    <legend>{tt(language, 'streamMobile.safeAreaAndFit')}</legend>
                    <div className="stream-mobile-safe-grid">
                      {(['top', 'right', 'bottom', 'left'] as const).map((edge) => (
                        <label key={edge}>
                          <span>{tt(language, `streamMobile.safe.${edge}`)}</span>
                          <input
                            type="number"
                            min={0}
                            max={4096}
                            value={draft.settings.safeArea[edge]}
                            onChange={(event) => updateSafeArea(edge, numberFromInput(event, draft.settings.safeArea[edge]))}
                          />
                        </label>
                      ))}
                    </div>
                    <div className="stream-mobile-segmented" aria-label={tt(language, 'streamMobile.fitMode')}>
                      {(['fit', 'fill'] as StreamPresentationFitMode[]).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          className={draft.settings.fitMode === mode ? 'is-active' : ''}
                          aria-pressed={draft.settings.fitMode === mode}
                          onClick={() => updateDraft((profile) => ({
                            ...profile,
                            settings: { ...profile.settings, fitMode: mode }
                          }))}
                        >
                          {tt(language, `streamMobile.${mode}`)}
                        </button>
                      ))}
                    </div>
                    <label>
                      <span>{tt(language, 'streamMobile.minimumTouch')}</span>
                      <input
                        type="range"
                        min={44}
                        max={96}
                        step={2}
                        value={draft.settings.minimumTouchTarget}
                        onChange={(event) => updateDraft((profile) => ({
                          ...profile,
                          settings: {
                            ...profile.settings,
                            minimumTouchTarget: numberFromInput(event, profile.settings.minimumTouchTarget)
                          }
                        }))}
                        aria-valuetext={`${draft.settings.minimumTouchTarget} CSS px`}
                      />
                      <output>{resolved?.minimumTouchTarget ?? draft.settings.minimumTouchTarget} px</output>
                    </label>
                  </fieldset>

                  <fieldset>
                    <legend>
                      <span>{tt(language, 'streamMobile.breakpoints')}</span>
                      <button type="button" className="stream-mobile-link" onClick={addBreakpoint}>
                        {tt(language, 'streamMobile.addBreakpoint')}
                      </button>
                    </legend>
                    {draft.settings.breakpoints.length === 0 ? (
                      <p className="stream-mobile-helper">{tt(language, 'streamMobile.noBreakpoints')}</p>
                    ) : null}
                    <div className="stream-mobile-breakpoints">
                      {draft.settings.breakpoints.map((breakpoint) => (
                        <div key={breakpoint.id} className="stream-mobile-breakpoint">
                          <label>
                            <span>{tt(language, 'streamMobile.breakpointName')}</span>
                            <input
                              value={breakpoint.name}
                              onChange={(event) => updateBreakpoint(breakpoint.id, { name: event.target.value })}
                            />
                          </label>
                          <div className="stream-mobile-inline-fields">
                            <label>
                              <span>{tt(language, 'streamMobile.minWidth')}</span>
                              <input
                                type="number"
                                min={240}
                                max={4096}
                                value={breakpoint.minWidth ?? ''}
                                onChange={(event) => updateBreakpoint(breakpoint.id, { minWidth: optionalNumberFromInput(event) })}
                              />
                            </label>
                            <label>
                              <span>{tt(language, 'streamMobile.maxWidth')}</span>
                              <input
                                type="number"
                                min={240}
                                max={4096}
                                value={breakpoint.maxWidth ?? ''}
                                onChange={(event) => updateBreakpoint(breakpoint.id, { maxWidth: optionalNumberFromInput(event) })}
                              />
                            </label>
                          </div>
                          <div className="stream-mobile-inline-fields">
                            <label>
                              <span>{tt(language, 'streamMobile.breakpointOrientation')}</span>
                              <select
                                value={breakpoint.orientation ?? ''}
                                onChange={(event) => updateBreakpoint(breakpoint.id, {
                                  orientation: event.target.value === 'portrait' || event.target.value === 'landscape'
                                    ? event.target.value
                                    : undefined
                                })}
                              >
                                <option value="">{tt(language, 'streamMobile.any')}</option>
                                <option value="portrait">{tt(language, 'streamMobile.portrait')}</option>
                                <option value="landscape">{tt(language, 'streamMobile.landscape')}</option>
                              </select>
                            </label>
                            <label>
                              <span>{tt(language, 'streamMobile.breakpointFit')}</span>
                              <select
                                value={breakpoint.fitMode ?? ''}
                                onChange={(event) => updateBreakpoint(breakpoint.id, {
                                  fitMode: event.target.value === 'fit' || event.target.value === 'fill'
                                    ? event.target.value
                                    : undefined
                                })}
                              >
                                <option value="">{tt(language, 'streamMobile.inherit')}</option>
                                <option value="fit">{tt(language, 'streamMobile.fit')}</option>
                                <option value="fill">{tt(language, 'streamMobile.fill')}</option>
                              </select>
                            </label>
                          </div>
                          <label>
                            <span>{tt(language, 'streamMobile.breakpointTouch')}</span>
                            <input
                              type="number"
                              min={44}
                              max={128}
                              value={breakpoint.minimumTouchTarget ?? ''}
                              onChange={(event) => updateBreakpoint(breakpoint.id, {
                                minimumTouchTarget: optionalNumberFromInput(event)
                              })}
                            />
                          </label>
                          <button type="button" className="stream-mobile-link is-danger" onClick={() => removeBreakpoint(breakpoint.id)}>
                            {tt(language, 'streamMobile.removeBreakpoint')}
                          </button>
                        </div>
                      ))}
                    </div>
                  </fieldset>

                  <fieldset>
                    <legend>{tt(language, 'streamMobile.visibility')}</legend>
                    <label>
                      <span>{tt(language, 'streamMobile.visibilityScope')}</span>
                      <select value={visibilityScope} onChange={(event) => setVisibilityScope(event.target.value)}>
                        <option value="base">{tt(language, 'streamMobile.baseProfile')}</option>
                        {draft.settings.breakpoints.map((breakpoint) => (
                          <option key={breakpoint.id} value={breakpoint.id}>{breakpoint.name}</option>
                        ))}
                      </select>
                    </label>
                    <div className="stream-mobile-visibility-list">
                      {visibilityItems.map((item) => (
                        <label key={item.id}>
                          <input
                            type="checkbox"
                            checked={scopeVisibility(draft, visibilityScope, item.id)}
                            onChange={(event) => setVisibility(item.id, event.target.checked)}
                          />
                          <span>
                            <strong>{item.label}</strong>
                            <small>{item.detail} · {item.id}</small>
                          </span>
                        </label>
                      ))}
                      {visibilityItems.length === 0 ? (
                        <p className="stream-mobile-helper">{tt(language, 'streamMobile.noVisibilityItems')}</p>
                      ) : null}
                    </div>
                  </fieldset>
                </div>

                <section className="stream-mobile-preview-panel" aria-labelledby="stream-mobile-preview-title">
                  <div className="stream-mobile-preview-header">
                    <div>
                      <span>{tt(language, 'streamMobile.exactPreview')}</span>
                      <h3 id="stream-mobile-preview-title">
                        {resolved ? `${resolved.viewport.width} × ${resolved.viewport.height}` : '—'}
                      </h3>
                    </div>
                    <dl>
                      <div>
                        <dt>{tt(language, 'streamMobile.aspect')}</dt>
                        <dd>{resolved ? (resolved.viewport.width / resolved.viewport.height).toFixed(3) : '—'}</dd>
                      </div>
                      <div>
                        <dt>{tt(language, 'streamMobile.content')}</dt>
                        <dd>{resolved ? `${resolved.content.width} × ${resolved.content.height}` : '—'}</dd>
                      </div>
                      <div>
                        <dt>{tt(language, 'streamMobile.activeBreakpoint')}</dt>
                        <dd>{resolved?.activeBreakpointId ?? tt(language, 'streamMobile.none')}</dd>
                      </div>
                    </dl>
                  </div>
                  <div className="stream-mobile-preview-deck">
                    {draft && resolved ? (
                      <ResponsiveStreamPresentationFrame
                        className="stream-mobile-preview-frame"
                        profile={draft}
                        dashboard={dashboard}
                        touchPanel={touchPanel}
                        mode="preview"
                        interactiveTouch={draft.target.kind === 'touch'}
                        viewportAware={false}
                        ariaLabel={tt(language, 'streamMobile.previewAria', {
                          width: resolved.viewport.width,
                          height: resolved.viewport.height
                        })}
                        unavailableLabel={tt(language, 'streamMobile.previewUnavailable')}
                      />
                    ) : null}
                  </div>
                  <p className="stream-mobile-preview-note">
                    {draft.target.kind === 'touch'
                      ? tt(language, 'streamMobile.touchPreviewLocal')
                      : tt(language, 'streamMobile.dashboardPreviewDetail')}
                  </p>
                </section>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  )
}
