import {
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import type { ActionBinding } from '../../../shared/actions'
import type { AlertsConfig } from '../../../shared/alerts'
import { COACH_CHANNELS, type CoachConfig } from '../../../shared/coach'
import {
  analyzeContextDebt,
  CONTEXT_DEBT_EXPERIMENT,
  CONTEXT_DEBT_THRESHOLD_BOUNDS,
  DEFAULT_CONTEXT_DEBT_THRESHOLDS,
  previewContextDebtSuggestions,
  reconcileContextDebtPreviewSelection,
  selectContextDebtProfileSnapshot,
  updateContextDebtThreshold,
  type ContextDebtConfigSnapshot,
  type ContextDebtDeviceKind,
  type ContextDebtIssue,
  type ContextDebtPreviewSelection,
  type ContextDebtReport,
  type ContextDebtScanStatus,
  type ContextDebtSourceFamily,
  type ContextDebtSuggestion,
  type ContextDebtThresholds
} from '../../../shared/context-debt'
import { ENGINEER_CHANNELS, type EngineerConfig } from '../../../shared/engineer-ipc'
import { HAPTICS_CHANNELS, type HapticsConfig } from '../../../shared/haptics'
import {
  HAPTICS_ZONAL_CHANNELS,
  type HapticsZonalConfig
} from '../../../shared/haptics-zonal'
import type { OverlaysConfig } from '../../../shared/overlays'
import type { RaceProfile } from '../../../shared/raceprofiles'
import { SPOTTER_CHANNELS, type SpotterConfig } from '../../../shared/spotter'
import { SPOTTER_3D_CHANNELS, type Spotter3DConfig } from '../../../shared/spotter3d'
import { SOUNDSHIFT_CHANNELS, type SoundsConfig } from '../../../shared/soundshift'
import type { AppViewProps } from '../App'
import { tt, type ResolvedLanguage } from '../i18n'
import { navigateToView } from '../lib/app-navigation'
import {
  acceptedContextDebtSuggestionIds,
  clearContextDebtDecision,
  currentContextDebtDecisions,
  readContextDebtExperimentState,
  recordContextDebtDecision,
  recordContextDebtRun,
  writeContextDebtExperimentState,
  type ContextDebtDecision,
  type ContextDebtExperimentState
} from '../lib/context-debt-storage'
import { scanContextDebtDevices } from '../lib/context-debt-device-scan'
import { useDevices } from '../lib/devices/DeviceRegistry'
import { listConnectedGamepads } from '../lib/gamepad'
import './context-debt.css'

interface LoadedContextDebtSnapshot extends ContextDebtConfigSnapshot {
  profiles: RaceProfile[]
  sourceAvailability: Partial<Record<ContextDebtSourceFamily, boolean>>
}

interface AnalysisResult {
  report: ContextDebtReport
  elapsedMs: number
}

const LIVE_PROFILE_KEY = 'live'

function settledValue<T>(result: PromiseSettledResult<T>): T | undefined {
  return result.status === 'fulfilled' ? result.value : undefined
}

function percent(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0
  return Math.round((numerator / denominator) * 100)
}

function humanize(value: string): string {
  return value
    .replace(/[-_.:]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function signalLabel(language: ResolvedLanguage | undefined, signalId: string): string {
  const key = `contextDebt.signal.${signalId}`
  const translated = tt(language, key)
  return translated === key ? humanize(signalId) : translated
}

function issueCopy(language: ResolvedLanguage | undefined, issue: ContextDebtIssue): string {
  switch (issue.kind) {
    case 'competing-cue':
      return tt(language, 'contextDebt.issue.competing', {
        signal: signalLabel(language, issue.signalId ?? String(issue.details.signal ?? '')),
        routes: issue.details.routes,
        modalities: issue.details.modalities
      })
    case 'duplicate-route':
      return tt(language, 'contextDebt.issue.duplicate', {
        label: issue.details.label,
        count: issue.details.count,
        target: issue.details.target
      })
    case 'unknown-device':
      return tt(language, 'contextDebt.issue.unknownDevice', {
        device: issue.details.deviceId,
        kind: issue.details.kind,
        routes: issue.details.routes
      })
    case 'control-conflict':
      return tt(language, 'contextDebt.issue.controlConflict', {
        control: issue.details.control,
        actions: issue.details.actions
      })
    case 'threshold-exceeded':
      return tt(language, 'contextDebt.issue.threshold', {
        metric: issue.details.metric,
        actual: issue.details.actual,
        limit: issue.details.limit
      })
    case 'source-missing':
      return tt(language, 'contextDebt.issue.sourceMissing', { source: issue.details.source })
    case 'scan-incomplete':
      return tt(language, 'contextDebt.issue.scanIncomplete', {
        kind: issue.details.kind,
        status: issue.details.status,
        routes: issue.details.routes
      })
  }
}

function suggestionCopy(language: ResolvedLanguage | undefined, suggestion: ContextDebtSuggestion): string {
  switch (suggestion.kind) {
    case 'dedupe-route':
      return tt(language, 'contextDebt.suggestion.dedupe', {
        label: suggestion.details.label,
        kept: suggestion.details.kept
      })
    case 'trim-cue':
      return tt(language, 'contextDebt.suggestion.trimCue', {
        signal: signalLabel(language, suggestion.signalId ?? String(suggestion.details.signal ?? '')),
        before: suggestion.details.before,
        after: suggestion.details.after
      })
    case 'trim-overlays':
      return tt(language, 'contextDebt.suggestion.trimOverlays', {
        before: suggestion.details.before,
        target: suggestion.details.target
      })
    case 'trim-audio':
      return tt(language, 'contextDebt.suggestion.trimAudio', {
        before: suggestion.details.before,
        target: suggestion.details.target
      })
    case 'trim-haptics':
      return tt(language, 'contextDebt.suggestion.trimHaptics', {
        before: suggestion.details.before,
        target: suggestion.details.target
      })
    case 'repair-device':
      return tt(language, 'contextDebt.suggestion.repairDevice', {
        device: suggestion.details.deviceId,
        kind: suggestion.details.kind
      })
    case 'resolve-control':
      return tt(language, 'contextDebt.suggestion.resolveControl', {
        control: suggestion.details.control,
        actions: suggestion.details.actions
      })
  }
}

function decisionLabel(
  language: ResolvedLanguage | undefined,
  decision: ContextDebtDecision | undefined
): string | null {
  if (decision === 'accepted') return tt(language, 'contextDebt.decision.accepted')
  if (decision === 'rejected') return tt(language, 'contextDebt.decision.rejected')
  return null
}

export default function ContextDebtView({ showToast, language }: AppViewProps): ReactElement {
  const {
    audioOutputs,
    displays,
    refreshAudioOutputs,
    refreshDisplays,
    refreshFleet,
    serialDevices
  } = useDevices()
  const [snapshot, setSnapshot] = useState<LoadedContextDebtSnapshot | null>(null)
  const [selectedProfileKey, setSelectedProfileKey] = useState(LIVE_PROFILE_KEY)
  const [thresholds, setThresholds] = useState<ContextDebtThresholds>(DEFAULT_CONTEXT_DEBT_THRESHOLDS)
  const [experimentState, setExperimentState] = useState<ContextDebtExperimentState>(
    () => readContextDebtExperimentState()
  )
  const [previewSelection, setPreviewSelection] = useState<ContextDebtPreviewSelection | null>(null)
  const [gamepadIds, setGamepadIds] = useState<string[]>([])
  const [deviceScanStatus, setDeviceScanStatus] = useState<Record<ContextDebtDeviceKind, ContextDebtScanStatus>>({
    audio: 'not-run',
    serial: 'not-run',
    display: 'not-run',
    gamepad: 'not-run'
  })
  const [busy, setBusy] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const lastRecordedFingerprint = useRef<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    setBusy(true)
    setLoadError(null)
    const deviceScan = scanContextDebtDevices({
      refreshAudioOutputs: () => refreshAudioOutputs(false),
      refreshSerialDevices: refreshFleet,
      refreshDisplays,
      listGamepads: () => {
        if (typeof navigator.getGamepads !== 'function') throw new Error('Gamepad enumeration unavailable.')
        return listConnectedGamepads().map((gamepad) => gamepad.id)
      }
    })
    const results = await Promise.allSettled([
      window.ipc.invoke<AlertsConfig>('alerts:getConfig'),
      window.ipc.invoke<OverlaysConfig>('overlays:getConfig'),
      window.ipc.invoke<SoundsConfig>(SOUNDSHIFT_CHANNELS.getConfig),
      window.ipc.invoke<HapticsConfig>(HAPTICS_CHANNELS.getConfig),
      window.ipc.invoke<HapticsZonalConfig>(HAPTICS_ZONAL_CHANNELS.getConfig),
      window.ipc.invoke<ActionBinding[]>('actions:getBindings'),
      window.ipc.invoke<SpotterConfig>(SPOTTER_CHANNELS.getConfig),
      window.ipc.invoke<Spotter3DConfig>(SPOTTER_3D_CHANNELS.getConfig),
      window.ipc.invoke<EngineerConfig>(ENGINEER_CHANNELS.getConfig),
      window.ipc.invoke<CoachConfig>(COACH_CHANNELS.getConfig),
      window.ipc.invoke<RaceProfile[]>('profilesv2:list')
    ])

    const scannedDevices = await deviceScan
    setDeviceScanStatus(scannedDevices.scanStatus)
    setGamepadIds(scannedDevices.gamepadIds)

    const [
      alerts,
      overlays,
      sounds,
      haptics,
      zonalHaptics,
      bindings,
      spotter,
      spotter3d,
      engineer,
      coach,
      profiles
    ] = results
    const sourceAvailability: Partial<Record<ContextDebtSourceFamily, boolean>> = {
      alerts: alerts.status === 'fulfilled',
      overlays: overlays.status === 'fulfilled',
      sounds: sounds.status === 'fulfilled',
      haptics: haptics.status === 'fulfilled',
      zonalHaptics: zonalHaptics.status === 'fulfilled',
      controls: bindings.status === 'fulfilled',
      spotter: spotter.status === 'fulfilled',
      spotter3d: spotter3d.status === 'fulfilled',
      engineer: engineer.status === 'fulfilled',
      coach: coach.status === 'fulfilled'
    }

    setSnapshot({
      alerts: settledValue(alerts),
      overlays: settledValue(overlays),
      sounds: settledValue(sounds),
      haptics: settledValue(haptics),
      zonalHaptics: settledValue(zonalHaptics),
      bindings: settledValue(bindings),
      spotter: settledValue(spotter),
      spotter3d: settledValue(spotter3d),
      engineer: settledValue(engineer),
      coach: settledValue(coach),
      profiles: settledValue(profiles) ?? [],
      sourceAvailability
    })

    const failed = results.slice(0, 10).filter((result) => result.status === 'rejected').length
    if (failed > 0) {
      setLoadError(tt(language, 'contextDebt.partialLoad', { count: failed }))
    }
    setBusy(false)
  }, [language, refreshAudioOutputs, refreshDisplays, refreshFleet])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!snapshot || selectedProfileKey === LIVE_PROFILE_KEY) return
    const id = selectedProfileKey.replace(/^race:/, '')
    if (!snapshot.profiles.some((profile) => profile.id === id)) setSelectedProfileKey(LIVE_PROFILE_KEY)
  }, [selectedProfileKey, snapshot])

  useEffect(() => {
    const patch = <K extends keyof LoadedContextDebtSnapshot>(key: K, value: LoadedContextDebtSnapshot[K]): void => {
      setSnapshot((current) => current ? { ...current, [key]: value } : current)
    }
    const unsubscribers = [
      window.ipc.subscribe<AlertsConfig>('alerts:config', (value) => patch('alerts', value)),
      window.ipc.subscribe<SoundsConfig>(SOUNDSHIFT_CHANNELS.configEvent, (value) => patch('sounds', value)),
      window.ipc.subscribe<HapticsConfig>(HAPTICS_CHANNELS.configEvent, (value) => patch('haptics', value)),
      window.ipc.subscribe<HapticsZonalConfig>(HAPTICS_ZONAL_CHANNELS.configEvent, (value) => patch('zonalHaptics', value)),
      window.ipc.subscribe<SpotterConfig>(SPOTTER_CHANNELS.configEvent, (value) => patch('spotter', value)),
      window.ipc.subscribe<Spotter3DConfig>(SPOTTER_3D_CHANNELS.configEvent, (value) => patch('spotter3d', value)),
      window.ipc.subscribe<CoachConfig>(COACH_CHANNELS.configEvent, (value) => patch('coach', value))
    ]
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
  }, [])

  const selectedProfile = useMemo(() => {
    if (!snapshot || selectedProfileKey === LIVE_PROFILE_KEY) return null
    const id = selectedProfileKey.replace(/^race:/, '')
    return snapshot.profiles.find((profile) => profile.id === id) ?? null
  }, [selectedProfileKey, snapshot])

  const analysis = useMemo<AnalysisResult | null>(() => {
    if (!snapshot) return null
    const selectedSnapshot = selectContextDebtProfileSnapshot(snapshot, selectedProfile)
    const start = performance.now()
    const report = analyzeContextDebt({
      ...selectedSnapshot,
      profile: selectedProfile
        ? { key: `race:${selectedProfile.id}`, name: selectedProfile.name, source: 'race-profile' }
        : { key: LIVE_PROFILE_KEY, name: tt(language, 'contextDebt.currentSetup'), source: 'live' },
      devices: {
        audioOutputIds: audioOutputs.map((device) => device.deviceId),
        serialDeviceIds: serialDevices.map((device) => device.id),
        displayIds: displays.map((display) => display.id),
        gamepadIds,
        scanStatus: deviceScanStatus
      },
      sourceAvailability: snapshot.sourceAvailability,
      thresholds
    })
    return { report, elapsedMs: Math.round((performance.now() - start) * 10) / 10 }
  }, [
    audioOutputs,
    deviceScanStatus,
    displays,
    gamepadIds,
    language,
    selectedProfile,
    serialDevices,
    snapshot,
    thresholds
  ])

  const report = analysis?.report ?? null

  useEffect(() => {
    if (!report) return
    setPreviewSelection((current) => reconcileContextDebtPreviewSelection(current, report))
    if (lastRecordedFingerprint.current === report.fingerprint) return
    lastRecordedFingerprint.current = report.fingerprint
    setExperimentState((current) => {
      const next = recordContextDebtRun(current, report)
      writeContextDebtExperimentState(next)
      return next
    })
  }, [report])

  const decisions = useMemo(
    () => report ? currentContextDebtDecisions(experimentState, report) : {},
    [experimentState, report]
  )
  const acceptedIds = useMemo(
    () => report ? acceptedContextDebtSuggestionIds(experimentState, report) : [],
    [experimentState, report]
  )
  const acceptedPreview = useMemo(
    () => report ? previewContextDebtSuggestions(report, acceptedIds) : null,
    [acceptedIds, report]
  )
  const activeSuggestion = useMemo(
    () => report?.suggestions.find((suggestion) => suggestion.id === previewSelection?.suggestionId) ?? null,
    [previewSelection?.suggestionId, report]
  )
  const activePreview = useMemo(
    () => report && activeSuggestion ? previewContextDebtSuggestions(report, [activeSuggestion.id]) : null,
    [activeSuggestion, report]
  )
  const signalRows = useMemo(() => {
    if (!report) return []
    const grouped = new Map<string, ContextDebtReport['routes']>()
    for (const route of report.routes.filter((candidate) => candidate.modality !== 'control')) {
      const current = grouped.get(route.signalId)
      if (current) current.push(route)
      else grouped.set(route.signalId, [route])
    }
    return [...grouped.entries()].sort((a, b) => {
      const criticalDelta = Number(b[1].some((route) => route.critical)) - Number(a[1].some((route) => route.critical))
      return criticalDelta || b[1].length - a[1].length || a[0].localeCompare(b[0])
    })
  }, [report])

  const updateDecision = (suggestionId: string, decision: ContextDebtDecision): void => {
    if (!report) return
    setExperimentState((current) => {
      const next = recordContextDebtDecision(current, report, suggestionId, decision)
      writeContextDebtExperimentState(next)
      return next
    })
    showToast(
      decision === 'accepted'
        ? tt(language, 'contextDebt.acceptedToast')
        : tt(language, 'contextDebt.rejectedToast'),
      'success'
    )
  }

  const clearDecision = (suggestionId: string): void => {
    if (!report) return
    setExperimentState((current) => {
      const next = clearContextDebtDecision(current, report.profile.key, suggestionId)
      writeContextDebtExperimentState(next)
      return next
    })
  }

  const updateThreshold = (key: keyof ContextDebtThresholds, value: number): void => {
    setThresholds((current) => updateContextDebtThreshold(current, key, value))
  }

  if (busy && !report) {
    return (
      <section className="context-debt context-debt--loading" role="status">
        <div className="context-debt-spinner" aria-hidden="true" />
        <strong>{tt(language, 'contextDebt.loading')}</strong>
      </section>
    )
  }

  if (!report || !analysis) {
    return (
      <section className="context-debt context-debt--loading" role="alert">
        <strong>{tt(language, 'contextDebt.unavailable')}</strong>
        <button className="context-debt-button context-debt-button--primary" onClick={() => void refresh()} type="button">
          {tt(language, 'contextDebt.retry')}
        </button>
      </section>
    )
  }

  const decisionCoverage = report.suggestions.length === 0
    ? 100
    : percent(Object.keys(decisions).length, report.suggestions.length)
  const profileExperiment = experimentState.profiles[report.profile.key]
  const bandLabel = tt(language, `contextDebt.band.${report.band}`)

  return (
    <section className="context-debt">
      <header className="context-debt-hero">
        <div>
          <div className="context-debt-badges" aria-label={tt(language, 'contextDebt.experimentLabels')}>
            <span>{CONTEXT_DEBT_EXPERIMENT.id}</span>
            <span>{CONTEXT_DEBT_EXPERIMENT.allocation}</span>
            <span className="is-warn">{CONTEXT_DEBT_EXPERIMENT.evidence}</span>
            <span>{tt(language, 'contextDebt.localOnly')}</span>
          </div>
          <h3>{tt(language, 'contextDebt.title')}</h3>
          <p>{tt(language, 'contextDebt.intro')}</p>
        </div>
        <div className="context-debt-guard" role="note">
          <strong>{tt(language, 'contextDebt.guardTitle')}</strong>
          <span>{tt(language, 'contextDebt.guardBody')}</span>
        </div>
      </header>

      <div className="context-debt-toolbar">
        <label>
          <span>{tt(language, 'contextDebt.profile')}</span>
          <select value={selectedProfileKey} onChange={(event) => setSelectedProfileKey(event.target.value)}>
            <option value={LIVE_PROFILE_KEY}>{tt(language, 'contextDebt.currentSetup')}</option>
            {snapshot?.profiles.map((profile) => (
              <option key={profile.id} value={`race:${profile.id}`}>{profile.name}</option>
            ))}
          </select>
        </label>
        <div className="context-debt-toolbar__meta">
          <span>{tt(language, 'contextDebt.fingerprint')}: <code>{report.fingerprint}</code></span>
          <span>{tt(language, 'contextDebt.analysisTime')}: <strong>{analysis.elapsedMs} ms</strong></span>
        </div>
        <button className="context-debt-button" disabled={busy} onClick={() => void refresh()} type="button">
          {busy ? tt(language, 'contextDebt.refreshing') : tt(language, 'contextDebt.refresh')}
        </button>
      </div>

      {selectedProfile && (
        <p className="context-debt-profile-note">
          {tt(language, 'contextDebt.profileFallbackNote')}
        </p>
      )}
      {loadError && <p className="context-debt-alert" role="status">{loadError}</p>}

      <section className={`context-debt-meter is-${report.band}`} aria-label={tt(language, 'contextDebt.meterAria')}>
        <div className="context-debt-meter__dial">
          <span>{tt(language, 'contextDebt.debtPoints')}</span>
          <strong>{report.metrics.debtPoints}</strong>
          <em>{bandLabel}</em>
        </div>
        <div className="context-debt-meter__copy">
          <strong>{tt(language, `contextDebt.bandTitle.${report.band}`)}</strong>
          <p>{tt(language, `contextDebt.bandBody.${report.band}`)}</p>
          <small>{tt(language, 'contextDebt.notDiagnosis')}</small>
        </div>
      </section>

      <section className="context-debt-counts" aria-label={tt(language, 'contextDebt.countsAria')}>
        {([
          ['competingCues', report.counts.competingCues],
          ['alerts', report.counts.alerts],
          ['overlays', report.counts.overlays],
          ['audio', report.counts.audio],
          ['haptics', report.counts.haptics],
          ['controlConflicts', report.counts.controlConflicts]
        ] as const).map(([key, value]) => (
          <article key={key}>
            <span>{tt(language, `contextDebt.count.${key}`)}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </section>

      <div className="context-debt-layout">
        <section className="context-debt-panel context-debt-loom">
          <div className="context-debt-panel__heading">
            <div>
              <span>{tt(language, 'contextDebt.evidenceEyebrow')}</span>
              <h4>{tt(language, 'contextDebt.signalLoom')}</h4>
            </div>
            <small>{tt(language, 'contextDebt.signalLoomHelp')}</small>
          </div>
          <div className="context-debt-loom__rows">
            {signalRows.length === 0 && <p>{tt(language, 'contextDebt.noRoutes')}</p>}
            {signalRows.map(([signalId, routes]) => {
              const critical = routes.some((route) => route.critical)
              return (
                <div className={`context-debt-loom__row ${critical ? 'is-critical' : ''}`} key={signalId}>
                  <div className="context-debt-loom__signal">
                    <strong>{signalLabel(language, signalId)}</strong>
                    <span>{routes.length} {tt(language, 'contextDebt.routes')}</span>
                  </div>
                  <div className="context-debt-loom__rail" aria-hidden="true" />
                  <div className="context-debt-loom__routes">
                    {routes.map((route) => (
                      <span
                        className={`context-debt-route is-${route.modality}`}
                        key={route.id}
                        title={`${route.label} · ${route.target}`}
                      >
                        {route.critical ? '▣ ' : ''}{tt(language, `contextDebt.modality.${route.modality}`)}
                      </span>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        <aside className="context-debt-panel context-debt-thresholds">
          <div className="context-debt-panel__heading">
            <div>
              <span>{tt(language, 'contextDebt.thresholdEyebrow')}</span>
              <h4>{tt(language, 'contextDebt.thresholdTitle')}</h4>
            </div>
          </div>
          <p>{tt(language, 'contextDebt.thresholdHelp')}</p>
          <p className="context-debt-formula">{tt(language, 'contextDebt.scoreFormula')}</p>
          {([
            'maxRoutesPerCue',
            'maxModalitiesPerCue',
            'maxOverlays',
            'maxAudioRoutes',
            'maxHapticRoutes',
            'maxTotalRoutes'
          ] as const).map((key) => (
            <label className="context-debt-threshold" key={key}>
              <span>{tt(language, `contextDebt.threshold.${key}`)}</span>
              <input
                max={CONTEXT_DEBT_THRESHOLD_BOUNDS[key].max}
                min={CONTEXT_DEBT_THRESHOLD_BOUNDS[key].min}
                onChange={(event) => updateThreshold(key, Number(event.target.value))}
                type="number"
                value={thresholds[key]}
              />
            </label>
          ))}
          <button
            className="context-debt-button context-debt-button--quiet"
            onClick={() => setThresholds(DEFAULT_CONTEXT_DEBT_THRESHOLDS)}
            type="button"
          >
            {tt(language, 'contextDebt.resetThresholds')}
          </button>
        </aside>
      </div>

      <section className="context-debt-panel">
        <div className="context-debt-panel__heading">
          <div>
            <span>{tt(language, 'contextDebt.findingsEyebrow')}</span>
            <h4>{tt(language, 'contextDebt.evidenceTitle')}</h4>
          </div>
          <small>{report.issues.length} {tt(language, 'contextDebt.findings')}</small>
        </div>
        <div className="context-debt-findings">
          {report.issues.length === 0 && <p>{tt(language, 'contextDebt.noFindings')}</p>}
          {report.issues.map((issue) => (
            <article className={`context-debt-finding is-${issue.severity}`} key={issue.id}>
              <span>{tt(language, `contextDebt.issueKind.${issue.kind}`)}</span>
              <p>{issueCopy(language, issue)}</p>
              {issue.signalId && <code>{issue.signalId}</code>}
            </article>
          ))}
        </div>
      </section>

      <section className="context-debt-panel">
        <div className="context-debt-panel__heading">
          <div>
            <span>{tt(language, 'contextDebt.planEyebrow')}</span>
            <h4>{tt(language, 'contextDebt.planTitle')}</h4>
          </div>
          <small>{tt(language, 'contextDebt.planHelp')}</small>
        </div>
        <div className="context-debt-suggestions">
          {report.suggestions.length === 0 && <p>{tt(language, 'contextDebt.noSuggestions')}</p>}
          {report.suggestions.map((suggestion) => {
            const decision = decisions[suggestion.id]?.decision
            const label = decisionLabel(language, decision)
            return (
              <article className={`context-debt-suggestion ${decision ? `is-${decision}` : ''}`} key={suggestion.id}>
                <div>
                  <span>{tt(language, `contextDebt.suggestionKind.${suggestion.kind}`)}</span>
                  <h5>{suggestionCopy(language, suggestion)}</h5>
                  <p>
                    {suggestion.estimatedRouteReduction > 0
                      ? tt(language, 'contextDebt.reductionEstimate', { count: suggestion.estimatedRouteReduction })
                      : tt(language, 'contextDebt.manualReview')}
                  </p>
                </div>
                <div className="context-debt-suggestion__actions">
                  {label && <span className="context-debt-decision">{label}</span>}
                  <button
                    className="context-debt-button"
                    onClick={() => setPreviewSelection({
                      profileKey: report.profile.key,
                      fingerprint: report.fingerprint,
                      suggestionId: suggestion.id
                    })}
                    type="button"
                  >
                    {tt(language, 'contextDebt.preview')}
                  </button>
                  <button className="context-debt-button context-debt-button--quiet" onClick={() => navigateToView(suggestion.navigateTo)} type="button">
                    {tt(language, 'contextDebt.openSettings')}
                  </button>
                  {decision && (
                    <button className="context-debt-button context-debt-button--quiet" onClick={() => clearDecision(suggestion.id)} type="button">
                      {tt(language, 'contextDebt.undoDecision')}
                    </button>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      </section>

      {activeSuggestion && activePreview && (
        <section className="context-debt-preview" aria-live="polite">
          <div className="context-debt-preview__header">
            <div>
              <span>{tt(language, 'contextDebt.previewEyebrow')}</span>
              <h4>{tt(language, 'contextDebt.previewTitle')}</h4>
              <p>{tt(language, 'contextDebt.previewSafety')}</p>
            </div>
            <button
              aria-label={tt(language, 'contextDebt.closePreview')}
              className="context-debt-preview__close"
              onClick={() => setPreviewSelection((current) => current ? { ...current, suggestionId: null } : current)}
              type="button"
            >
              ×
            </button>
          </div>
          <div className="context-debt-preview__metrics">
            <div><span>{tt(language, 'contextDebt.preview.routes')}</span><strong>{activePreview.beforeRouteCount} → {activePreview.afterRouteCount}</strong></div>
            <div><span>{tt(language, 'contextDebt.preview.overlap')}</span><strong>{activePreview.overlapReductionPct}%</strong></div>
            <div><span>{tt(language, 'contextDebt.preview.critical')}</span><strong>{activePreview.criticalRoutesAfter}/{activePreview.criticalRoutesBefore}</strong></div>
            <div><span>{tt(language, 'contextDebt.preview.output')}</span><strong>{tt(language, 'contextDebt.preview.none')}</strong></div>
          </div>
          {activePreview.removedRoutes.length > 0 ? (
            <ul>
              {activePreview.removedRoutes.map((route) => (
                <li key={route.id}><strong>{route.label}</strong><span>{route.target}</span></li>
              ))}
            </ul>
          ) : (
            <p className="context-debt-preview__manual">{tt(language, 'contextDebt.previewManual')}</p>
          )}
          <div className="context-debt-preview__guard">
            <strong>{activePreview.safe ? tt(language, 'contextDebt.previewSafe') : tt(language, 'contextDebt.previewBlocked')}</strong>
            <span>{tt(language, 'contextDebt.previewGuard', { count: activePreview.criticalRoutesAfter })}</span>
          </div>
          <div className="context-debt-preview__actions">
            <button className="context-debt-button context-debt-button--primary" onClick={() => updateDecision(activeSuggestion.id, 'accepted')} type="button">
              {tt(language, 'contextDebt.acceptPlan')}
            </button>
            <button className="context-debt-button context-debt-button--reject" onClick={() => updateDecision(activeSuggestion.id, 'rejected')} type="button">
              {tt(language, 'contextDebt.rejectPlan')}
            </button>
          </div>
        </section>
      )}

      <section className="context-debt-panel context-debt-metrics">
        <div className="context-debt-panel__heading">
          <div>
            <span>{tt(language, 'contextDebt.metricsEyebrow')}</span>
            <h4>{tt(language, 'contextDebt.metricsTitle')}</h4>
          </div>
          <small>{tt(language, 'contextDebt.metricsN0')}</small>
        </div>
        <div className="context-debt-metrics__grid">
          <article>
            <span>{tt(language, 'contextDebt.metric.overlap')}</span>
            <strong>{report.metrics.overlapRatePct}%</strong>
            <small>{tt(language, 'contextDebt.metric.overlapTarget', { target: CONTEXT_DEBT_EXPERIMENT.targetOverlapReductionPct })}</small>
          </article>
          <article>
            <span>{tt(language, 'contextDebt.metric.acceptedProjection')}</span>
            <strong>{acceptedPreview?.overlapReductionPct ?? 0}%</strong>
            <small>{tt(language, 'contextDebt.metric.planOnly')}</small>
          </article>
          <article>
            <span>{tt(language, 'contextDebt.metric.criticalDrops')}</span>
            <strong>{acceptedPreview?.criticalDrops ?? 0}</strong>
            <small>{tt(language, 'contextDebt.metric.criticalTarget')}</small>
          </article>
          <article>
            <span>{tt(language, 'contextDebt.metric.decisionCoverage')}</span>
            <strong>{decisionCoverage}%</strong>
            <small>{tt(language, 'contextDebt.metric.decisionTarget', { target: CONTEXT_DEBT_EXPERIMENT.targetDecisionCoveragePct })}</small>
          </article>
          <article>
            <span>{tt(language, 'contextDebt.metric.analysisTime')}</span>
            <strong>{analysis.elapsedMs} ms</strong>
            <small>{tt(language, 'contextDebt.metric.analysisTarget', { target: CONTEXT_DEBT_EXPERIMENT.targetAnalysisP95Ms })}</small>
          </article>
          <article>
            <span>{tt(language, 'contextDebt.metric.coverage')}</span>
            <strong>{report.metrics.sourceCoveragePct}% / {report.metrics.hardwareScanCoveragePct}%</strong>
            <small>{tt(language, 'contextDebt.metric.coverageBreakdown')}</small>
            <small>{tt(language, 'contextDebt.metric.runs', { count: profileExperiment?.runs ?? 0 })}</small>
          </article>
        </div>
        <p className="context-debt-method">
          {tt(language, 'contextDebt.method')}
        </p>
      </section>
    </section>
  )
}
