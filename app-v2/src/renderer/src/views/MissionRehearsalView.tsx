import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactElement } from 'react'
import type { AppViewProps } from '../App'
import { tt } from '../i18n'
import {
  DEFAULT_MISSION_REHEARSAL_MANIFEST,
  MISSION_MAX_IMPORT_CHARS,
  MISSION_REHEARSAL_SOURCE,
  MISSION_TRAINING_WATERMARK,
  MissionSchemaError,
  advanceMissionRun,
  assertMissionManifest,
  buildMissionDebrief,
  canRoleSelectMissionDecision,
  compareMissionRuns,
  createMissionRun,
  getMissionCheckpoint,
  materializeMissionEvents,
  parseMissionManifestJson,
  scoreMissionRun,
  serializeMissionManifest,
  serializeMissionRun,
  type MissionRun,
  type MissionRunComparison,
  type MissionScenarioManifest,
  type MissionValidationIssue
} from '../../../shared/mission-rehearsal'
import {
  finalizeMissionRun,
  loadMissionDraft,
  loadMissionResume,
  loadMissionRunHistory,
  resetAllMissionTrainingData,
  resetMissionTrainingBoundary,
  saveMissionDraft,
  saveMissionResume
} from '../../../shared/mission-rehearsal-storage'
import '../styles/mission-rehearsal.css'

type MissionTab = 'author' | 'run' | 'debrief'

function cloneBundledManifest(): MissionScenarioManifest {
  return JSON.parse(JSON.stringify(DEFAULT_MISSION_REHEARSAL_MANIFEST)) as MissionScenarioManifest
}

function formatManifest(manifest: MissionScenarioManifest): string {
  return JSON.stringify(manifest, null, 2)
}

function isMissionRunBoundaryLocked(run: MissionRun | null, history: MissionRun[]): boolean {
  return Boolean(run && (run.status === 'in-progress' || !history.some((entry) => entry.id === run.id)))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function schemaIssues(error: unknown): MissionValidationIssue[] {
  if (error instanceof MissionSchemaError) return error.issues
  return [{ path: '$', message: errorMessage(error) }]
}

function downloadJson(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json;charset=UTF-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function safeFilename(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'mission-rehearsal'
}

function formatOffset(offsetMs: number): string {
  if (offsetMs === 0) return 'T+0'
  return `T+${(offsetMs / 1_000).toFixed(offsetMs % 1_000 === 0 ? 0 : 1)}s`
}

function formatRunDate(timestamp: number, language: string): string {
  try {
    return new Intl.DateTimeFormat(language, {
      dateStyle: 'short',
      timeStyle: 'short'
    }).format(timestamp)
  } catch {
    return new Date(timestamp).toLocaleString()
  }
}

export default function MissionRehearsalView({ language = 'en', showToast }: AppViewProps): ReactElement {
  const [tab, setTab] = useState<MissionTab>('run')
  const [manifest, setManifest] = useState<MissionScenarioManifest>(() => cloneBundledManifest())
  const [draft, setDraft] = useState(() => formatManifest(cloneBundledManifest()))
  const [draftIssues, setDraftIssues] = useState<MissionValidationIssue[]>([])
  const [roleId, setRoleId] = useState('race-engineer')
  const [run, setRun] = useState<MissionRun | null>(null)
  const [history, setHistory] = useState<MissionRun[]>([])
  const [boundaryError, setBoundaryError] = useState<string | null>(null)
  const [baselineRunId, setBaselineRunId] = useState<string>('')
  const importInputRef = useRef<HTMLInputElement>(null)
  const activeRunLockedRef = useRef(false)

  const hydrateManifestState = useCallback((
    nextManifest: MissionScenarioManifest,
    startupError: string | null = null
  ): void => {
    try {
      const resume = loadMissionResume(window.localStorage, nextManifest)
      const storedHistory = loadMissionRunHistory(window.localStorage, nextManifest)
      const errors = [resume.error, storedHistory.error].filter(Boolean)
      const storageError = errors.length > 0
        ? errors.flatMap((error) => error?.issues ?? []).map((issue) => `${issue.path}: ${issue.message}`).join(' · ')
        : null
      const nextHistory = (storedHistory.value ?? []).slice().sort((left, right) => left.updatedAt - right.updatedAt)
      activeRunLockedRef.current = isMissionRunBoundaryLocked(resume.value, nextHistory)
      setBoundaryError([startupError, storageError].filter(Boolean).join(' · ') || null)
      setRun(resume.value)
      setHistory(nextHistory)
      const resumedRole = resume.value?.roleId
      const preferredRole = resumedRole ?? nextManifest.roles.find((role) => role.permissions.includes('run'))?.id
      setRoleId(preferredRole ?? nextManifest.roles[0]?.id ?? '')
    } catch (error) {
      activeRunLockedRef.current = false
      setBoundaryError([startupError, errorMessage(error)].filter(Boolean).join(' · '))
      setRun(null)
      setHistory([])
    }
  }, [])

  useEffect(() => {
    let nextManifest = cloneBundledManifest()
    let startupError: string | null = null
    try {
      const loaded = loadMissionDraft(window.localStorage)
      if (loaded.value) nextManifest = loaded.value
      if (loaded.error) {
        startupError = loaded.error.issues.map((issue) => `${issue.path}: ${issue.message}`).join(' · ')
      }
    } catch (error) {
      startupError = errorMessage(error)
    }
    setManifest(nextManifest)
    setDraft(formatManifest(nextManifest))
    hydrateManifestState(nextManifest, startupError)
  }, [hydrateManifestState])

  const currentCheckpoint = useMemo(
    () => run?.currentCheckpointId ? getMissionCheckpoint(manifest, run.currentCheckpointId) : null,
    [manifest, run]
  )
  const currentEvents = useMemo(
    () => currentCheckpoint && run
      ? materializeMissionEvents(manifest, currentCheckpoint.id, run.roleId)
      : [],
    [currentCheckpoint, manifest, run]
  )
  const debrief = useMemo(
    () => run?.status === 'completed' ? buildMissionDebrief(manifest, run) : null,
    [manifest, run]
  )
  const comparisonCandidates = useMemo(
    () => history.filter((entry) => entry.status === 'completed' && entry.id !== run?.id),
    [history, run?.id]
  )
  const runArchived = Boolean(run && history.some((entry) => entry.id === run.id))
  const activeRunLocked = isMissionRunBoundaryLocked(run, history)

  useEffect(() => {
    if (comparisonCandidates.length === 0) {
      setBaselineRunId('')
      return
    }
    if (!comparisonCandidates.some((entry) => entry.id === baselineRunId)) {
      setBaselineRunId(comparisonCandidates[comparisonCandidates.length - 1].id)
    }
  }, [baselineRunId, comparisonCandidates])

  const comparison = useMemo<MissionRunComparison | null>(() => {
    if (!run || run.status !== 'completed' || !baselineRunId) return null
    const baseline = comparisonCandidates.find((entry) => entry.id === baselineRunId)
    return baseline ? compareMissionRuns(manifest, baseline, run) : null
  }, [baselineRunId, comparisonCandidates, manifest, run])

  useEffect(() => {
    if (activeRunLocked && tab !== 'run') setTab('run')
  }, [activeRunLocked, tab])

  const requireUnlockedBoundary = useCallback((): boolean => {
    if (!activeRunLockedRef.current) return true
    setTab('run')
    showToast(tt(language, 'mission.toast.activeRunLocked'), 'info')
    return false
  }, [language, showToast])

  const applyManifest = useCallback((nextManifest: MissionScenarioManifest, toastKey: string): void => {
    if (!requireUnlockedBoundary()) return
    try {
      const valid = assertMissionManifest(nextManifest)
      saveMissionDraft(window.localStorage, valid)
      setManifest(valid)
      setDraft(formatManifest(valid))
      setDraftIssues([])
      hydrateManifestState(valid)
      showToast(tt(language, toastKey), 'success')
    } catch (error) {
      const issues = schemaIssues(error)
      setDraftIssues(issues)
      showToast(tt(language, 'mission.toast.invalidManifest'), 'error')
    }
  }, [hydrateManifestState, language, requireUnlockedBoundary, showToast])

  const validateAndApplyDraft = useCallback((): void => {
    if (!requireUnlockedBoundary()) return
    try {
      if (draft.length > MISSION_MAX_IMPORT_CHARS) {
        throw new MissionSchemaError('Draft is too large.', [
          { path: '$', message: `must contain no more than ${MISSION_MAX_IMPORT_CHARS} characters` }
        ])
      }
      const parsed = JSON.parse(draft) as unknown
      applyManifest(assertMissionManifest(parsed), 'mission.toast.manifestApplied')
    } catch (error) {
      const issues = error instanceof SyntaxError
        ? [{ path: '$', message: tt(language, 'mission.error.invalidJson') }]
        : schemaIssues(error)
      setDraftIssues(issues)
      showToast(tt(language, 'mission.toast.invalidManifest'), 'error')
    }
  }, [applyManifest, draft, language, requireUnlockedBoundary, showToast])

  const importManifest = useCallback(async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!requireUnlockedBoundary()) return
    try {
      const text = await file.text()
      if (!requireUnlockedBoundary()) return
      const imported = parseMissionManifestJson(text)
      applyManifest(imported, 'mission.toast.manifestImported')
    } catch (error) {
      setDraftIssues(schemaIssues(error))
      showToast(tt(language, 'mission.toast.importFailed'), 'error')
    }
  }, [applyManifest, language, requireUnlockedBoundary, showToast])

  const exportManifest = useCallback((): void => {
    if (!requireUnlockedBoundary()) return
    downloadJson(
      `${safeFilename(manifest.id)}-v${manifest.revision}.mission.json`,
      serializeMissionManifest(manifest)
    )
    showToast(tt(language, 'mission.toast.manifestExported'), 'success')
  }, [language, manifest, requireUnlockedBoundary, showToast])

  const startRun = useCallback((): void => {
    if (!requireUnlockedBoundary()) return
    try {
      const now = Date.now()
      const next = createMissionRun(manifest, roleId, {
        id: `run-${now.toString(36)}-${(history.length + 1).toString(36)}`,
        now
      })
      saveMissionResume(window.localStorage, manifest, next)
      activeRunLockedRef.current = true
      setRun(next)
      setTab('run')
      setBoundaryError(null)
      showToast(tt(language, 'mission.toast.runStarted'), 'success')
    } catch (error) {
      setBoundaryError(errorMessage(error))
      showToast(errorMessage(error), 'error')
    }
  }, [history.length, language, manifest, requireUnlockedBoundary, roleId, showToast])

  const selectDecision = useCallback((decisionId: string): void => {
    if (!run) return
    try {
      const next = advanceMissionRun(manifest, run, decisionId)
      if (next.status === 'completed') {
        const finalized = finalizeMissionRun(window.localStorage, manifest, next)
        setRun(next)
        if (finalized.error) {
          activeRunLockedRef.current = true
          throw finalized.error
        }
        if (finalized.value) setHistory(finalized.value)
        activeRunLockedRef.current = isMissionRunBoundaryLocked(next, finalized.value ?? history)
        setTab('debrief')
        showToast(tt(language, 'mission.toast.runCompleted'), 'success')
      } else {
        saveMissionResume(window.localStorage, manifest, next)
        activeRunLockedRef.current = true
        setRun(next)
        showToast(tt(language, 'mission.toast.checkpointSaved'), 'info')
      }
      setBoundaryError(null)
    } catch (error) {
      setBoundaryError(errorMessage(error))
      showToast(errorMessage(error), 'error')
    }
  }, [history, language, manifest, run, showToast])

  const retryRunArchive = useCallback((): void => {
    if (!run || run.status !== 'completed') return
    const finalized = finalizeMissionRun(window.localStorage, manifest, run)
    if (finalized.error) {
      setBoundaryError(errorMessage(finalized.error))
      showToast(errorMessage(finalized.error), 'error')
      return
    }
    if (finalized.value) setHistory(finalized.value)
    activeRunLockedRef.current = isMissionRunBoundaryLocked(run, finalized.value ?? history)
    setBoundaryError(null)
    setTab('debrief')
    showToast(tt(language, 'mission.toast.runCompleted'), 'success')
  }, [history, language, manifest, run, showToast])

  const resetActiveRun = useCallback((): void => {
    if (!window.confirm(tt(language, 'mission.reset.activeConfirm'))) return
    try {
      resetMissionTrainingBoundary(window.localStorage, manifest)
      activeRunLockedRef.current = false
      setRun(null)
      setBoundaryError(null)
      showToast(tt(language, 'mission.toast.activeReset'), 'info')
    } catch (error) {
      setBoundaryError(errorMessage(error))
    }
  }, [language, manifest, showToast])

  const resetAllTrainingData = useCallback((): void => {
    if (!requireUnlockedBoundary()) return
    if (!window.confirm(tt(language, 'mission.reset.allConfirm'))) return
    try {
      resetAllMissionTrainingData(window.localStorage)
      const bundled = cloneBundledManifest()
      activeRunLockedRef.current = false
      setManifest(bundled)
      setDraft(formatManifest(bundled))
      setDraftIssues([])
      setRun(null)
      setHistory([])
      setRoleId('race-engineer')
      setBoundaryError(null)
      showToast(tt(language, 'mission.toast.allReset'), 'info')
    } catch (error) {
      setBoundaryError(errorMessage(error))
    }
  }, [language, requireUnlockedBoundary, showToast])

  const exportRun = useCallback((): void => {
    if (!run) return
    if (!requireUnlockedBoundary()) return
    downloadJson(`${safeFilename(manifest.id)}-${run.id}.mission-run.json`, serializeMissionRun(manifest, run))
    showToast(tt(language, 'mission.toast.runExported'), 'success')
  }, [language, manifest, requireUnlockedBoundary, run, showToast])

  const openHistoryRun = useCallback((historyRun: MissionRun): void => {
    if (!requireUnlockedBoundary()) return
    activeRunLockedRef.current = false
    setRun(historyRun)
    setRoleId(historyRun.roleId)
    setTab('debrief')
  }, [requireUnlockedBoundary])

  const runRole = run ? manifest.roles.find((role) => role.id === run.roleId) : null

  return (
    <div className="mission-rehearsal" data-watermark={MISSION_TRAINING_WATERMARK}>
      <header className="mission-boundary-banner" role="status" aria-live="polite">
        <div className="mission-watermark" aria-label={tt(language, 'mission.watermarkAria')}>
          {MISSION_TRAINING_WATERMARK}
        </div>
        <div>
          <strong>{tt(language, 'mission.boundary.title')}</strong>
          <p>{tt(language, 'mission.boundary.body')}</p>
        </div>
        <ul aria-label={tt(language, 'mission.boundary.guards')}>
          <li>{tt(language, 'mission.boundary.noNetwork')}</li>
          <li>{tt(language, 'mission.boundary.noLiveWrites')}</li>
          <li>{tt(language, 'mission.boundary.explicitReset')}</li>
        </ul>
      </header>

      <nav className="mission-tabs" role="tablist" aria-label={tt(language, 'mission.tabs.label')}>
        {(['author', 'run', 'debrief'] as const).map((item) => (
          <button
            key={item}
            id={`mission-tab-${item}`}
            type="button"
            role="tab"
            aria-selected={tab === item}
            aria-controls={`mission-panel-${item}`}
            aria-describedby={activeRunLocked && item !== 'run' ? 'mission-run-lock' : undefined}
            className={tab === item ? 'is-active' : ''}
            disabled={activeRunLocked && item !== 'run'}
            title={activeRunLocked && item !== 'run' ? tt(language, 'mission.tabs.lockedDuringRun') : undefined}
            onClick={() => {
              if (activeRunLocked && item !== 'run') return
              setTab(item)
            }}
          >
            {tt(language, `mission.tabs.${item}`)}
          </button>
        ))}
      </nav>
      {activeRunLocked && (
        <p id="mission-run-lock" className="mission-help" role="status">
          {tt(language, 'mission.tabs.lockedDuringRun')}
        </p>
      )}

      {boundaryError && (
        <div className="mission-alert mission-alert--error" role="alert">
          <strong>{tt(language, 'mission.boundary.errorTitle')}</strong>
          <span>{boundaryError}</span>
        </div>
      )}

      {tab === 'author' && (
        <section
          id="mission-panel-author"
          role="tabpanel"
          aria-labelledby="mission-tab-author"
          className="mission-panel mission-author"
        >
          <div className="mission-panel-heading">
            <div>
              <span className="mission-eyebrow">{tt(language, 'mission.author.eyebrow')}</span>
              <h3>{tt(language, 'mission.author.title')}</h3>
              <p>{tt(language, 'mission.author.body')}</p>
            </div>
            <div className="mission-actions">
              <button type="button" className="mission-button" disabled={activeRunLocked} onClick={() => importInputRef.current?.click()}>
                {tt(language, 'mission.author.import')}
              </button>
              <input
                ref={importInputRef}
                type="file"
                accept="application/json,.json"
                disabled={activeRunLocked}
                hidden
                onChange={(event) => void importManifest(event)}
              />
              <button type="button" className="mission-button" disabled={activeRunLocked} onClick={exportManifest}>
                {tt(language, 'mission.author.export')}
              </button>
              <button type="button" className="mission-button mission-button--primary" disabled={activeRunLocked} onClick={validateAndApplyDraft}>
                {tt(language, 'mission.author.validateApply')}
              </button>
            </div>
          </div>

          <div className="mission-author-grid">
            <div className="mission-card">
              <label className="mission-label" htmlFor="mission-manifest-editor">
                {tt(language, 'mission.author.editorLabel')}
              </label>
              <p id="mission-editor-help" className="mission-help">
                {tt(language, 'mission.author.editorHelp')}
              </p>
              <textarea
                id="mission-manifest-editor"
                className="mission-json-editor"
                value={draft}
                readOnly={activeRunLocked}
                spellCheck={false}
                aria-describedby="mission-editor-help mission-validation-status"
                onChange={(event) => {
                  setDraft(event.target.value)
                  setDraftIssues([])
                }}
              />
              <div id="mission-validation-status" aria-live="polite">
                {draftIssues.length > 0 ? (
                  <div className="mission-validation-errors" role="alert">
                    <strong>{tt(language, 'mission.author.validationFailed')}</strong>
                    <ul>
                      {draftIssues.slice(0, 20).map((issue, index) => (
                        <li key={`${issue.path}-${index}`}><code>{issue.path}</code> — {issue.message}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="mission-validation-ok">
                    {tt(language, 'mission.author.strictSchema')}
                  </div>
                )}
              </div>
            </div>

            <aside className="mission-card mission-manifest-summary" aria-label={tt(language, 'mission.author.summary')}>
              <span className="mission-eyebrow">v{manifest.schemaVersion} · r{manifest.revision}</span>
              <h3>{manifest.title}</h3>
              <p>{manifest.description}</p>
              <dl>
                <div><dt>{tt(language, 'mission.author.objective')}</dt><dd>{manifest.objective}</dd></div>
                <div><dt>{tt(language, 'mission.author.seed')}</dt><dd>{manifest.seed}</dd></div>
                <div><dt>{tt(language, 'mission.author.roles')}</dt><dd>{manifest.roles.length}</dd></div>
                <div><dt>{tt(language, 'mission.author.checkpoints')}</dt><dd>{manifest.checkpoints.length}</dd></div>
              </dl>
              <h4>{tt(language, 'mission.author.rolePermissions')}</h4>
              <ul className="mission-role-list">
                {manifest.roles.map((role) => (
                  <li key={role.id}>
                    <strong>{role.name}</strong>
                    <span>{role.permissions.join(' · ')}</span>
                  </li>
                ))}
              </ul>
              <h4>{tt(language, 'mission.author.branchMap')}</h4>
              <ol className="mission-branch-list">
                {manifest.checkpoints.map((checkpoint) => (
                  <li key={checkpoint.id}>
                    <strong>{checkpoint.title}</strong>
                    <span>
                      {checkpoint.decisions.map((decision) =>
                        `${decision.label} → ${decision.nextCheckpointId ?? tt(language, 'mission.author.finish')}`
                      ).join(' · ')}
                    </span>
                  </li>
                ))}
              </ol>
            </aside>
          </div>
        </section>
      )}

      {tab === 'run' && (
        <section
          id="mission-panel-run"
          role="tabpanel"
          aria-labelledby="mission-tab-run"
          className="mission-panel mission-runner"
        >
          <div className="mission-panel-heading">
            <div>
              <span className="mission-eyebrow">{tt(language, 'mission.runner.eyebrow')}</span>
              <h3>{manifest.title}</h3>
              <p>{manifest.objective}</p>
            </div>
            <div className="mission-actions">
              <label className="mission-compact-field" htmlFor="mission-role">
                <span>{tt(language, 'mission.runner.role')}</span>
                <select
                  id="mission-role"
                  value={run?.status === 'in-progress' ? run.roleId : roleId}
                  disabled={activeRunLocked}
                  onChange={(event) => setRoleId(event.target.value)}
                >
                  {manifest.roles.filter((role) => role.permissions.includes('run')).map((role) => (
                    <option key={role.id} value={role.id}>{role.name}</option>
                  ))}
                </select>
              </label>
              {!run || run.status === 'completed' ? (
                <button type="button" className="mission-button mission-button--primary" disabled={activeRunLocked} onClick={startRun}>
                  {tt(language, run?.status === 'completed' ? 'mission.runner.repeat' : 'mission.runner.start')}
                </button>
              ) : (
                <button type="button" className="mission-button mission-button--danger" onClick={resetActiveRun}>
                  {tt(language, 'mission.runner.reset')}
                </button>
              )}
            </div>
          </div>

          {!run && (
            <div className="mission-empty-state">
              <strong>{tt(language, 'mission.runner.ready')}</strong>
              <p>{tt(language, 'mission.runner.readyBody')}</p>
              <ul>
                {manifest.roles.filter((role) => role.permissions.includes('run')).map((role) => (
                  <li key={role.id}><strong>{role.name}:</strong> {role.description}</li>
                ))}
              </ul>
            </div>
          )}

          {run && run.status === 'completed' && (
            <div className="mission-alert mission-alert--success" role="status">
              <strong>{tt(language, 'mission.runner.complete')}</strong>
              <span>
                {tt(language, activeRunLocked ? 'mission.runner.archivePending' : 'mission.runner.openDebrief')}
              </span>
              {activeRunLocked ? (
                <button type="button" className="mission-button" onClick={retryRunArchive}>
                  {tt(language, 'mission.runner.retryArchive')}
                </button>
              ) : (
                <button type="button" className="mission-button" onClick={() => setTab('debrief')}>
                  {tt(language, 'mission.tabs.debrief')}
                </button>
              )}
            </div>
          )}

          {run && currentCheckpoint && (
            <>
              <div className="mission-run-status" aria-live="polite">
                <div>
                  <span>{tt(language, 'mission.runner.activeRole')}</span>
                  <strong>{runRole?.name ?? run.roleId}</strong>
                </div>
                <div>
                  <span>{tt(language, 'mission.runner.savedCheckpoint')}</span>
                  <strong>{run.steps.length}</strong>
                </div>
                <div>
                  <span>{tt(language, 'mission.runner.manifestRevision')}</span>
                  <strong>v{manifest.schemaVersion} · r{manifest.revision}</strong>
                </div>
                <label>
                  <span>{tt(language, 'mission.runner.progress')}</span>
                  <progress value={run.steps.length} max={manifest.checkpoints.length}>
                    {run.steps.length}/{manifest.checkpoints.length}
                  </progress>
                </label>
              </div>

              <article className="mission-checkpoint" aria-labelledby={`checkpoint-${currentCheckpoint.id}`}>
                <span className="mission-eyebrow">{tt(language, 'mission.runner.checkpoint')}</span>
                <h3 id={`checkpoint-${currentCheckpoint.id}`}>{currentCheckpoint.title}</h3>
                <p>{currentCheckpoint.briefing}</p>
              </article>

              <section className="mission-event-section" aria-labelledby="mission-events-title">
                <div className="mission-section-title">
                  <div>
                    <span className="mission-eyebrow">{MISSION_REHEARSAL_SOURCE}</span>
                    <h4 id="mission-events-title">{tt(language, 'mission.runner.injectedEvents')}</h4>
                  </div>
                  <span className="mission-badge mission-badge--warning">
                    {tt(language, 'mission.runner.syntheticOnly')}
                  </span>
                </div>
                {currentEvents.length === 0 ? (
                  <p className="mission-help">{tt(language, 'mission.runner.noEvents')}</p>
                ) : (
                  <ol className="mission-event-list">
                    {currentEvents.map((event) => (
                      <li key={event.id} className="mission-event-card">
                        <div>
                          <span className="mission-event-time">{formatOffset(event.offsetMs)}</span>
                          <span className="mission-badge">{event.kind}</span>
                        </div>
                        <strong>{event.title}</strong>
                        <p>{event.description}</p>
                        <dl>
                          {Object.entries(event.payload).map(([key, value]) => (
                            <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>
                          ))}
                        </dl>
                      </li>
                    ))}
                  </ol>
                )}
              </section>

              <fieldset className="mission-decisions">
                <legend>{tt(language, 'mission.runner.chooseDecision')}</legend>
                <p>{tt(language, 'mission.runner.expectedHidden')}</p>
                <div className="mission-decision-grid">
                  {currentCheckpoint.decisions.map((decision) => {
                    const allowed = canRoleSelectMissionDecision(
                      manifest,
                      run.roleId,
                      currentCheckpoint.id,
                      decision.id
                    )
                    return (
                      <button
                        key={decision.id}
                        type="button"
                        className="mission-decision"
                        disabled={!allowed}
                        aria-describedby={`decision-${decision.id}-description`}
                        onClick={() => selectDecision(decision.id)}
                      >
                        <strong>{decision.label}</strong>
                        <span id={`decision-${decision.id}-description`}>{decision.description}</span>
                        <small>
                          {allowed
                            ? tt(language, 'mission.runner.permitted')
                            : tt(language, 'mission.runner.roleRestricted')}
                        </small>
                      </button>
                    )
                  })}
                </div>
              </fieldset>
            </>
          )}
        </section>
      )}

      {tab === 'debrief' && (
        <section
          id="mission-panel-debrief"
          role="tabpanel"
          aria-labelledby="mission-tab-debrief"
          className="mission-panel mission-debrief"
        >
          {!debrief ? (
            <div className="mission-empty-state">
              <strong>{tt(language, 'mission.debrief.empty')}</strong>
              <p>{tt(language, 'mission.debrief.emptyBody')}</p>
              {history.length > 0 && (
                <ul className="mission-history-list">
                  {history.slice().reverse().map((historyRun) => (
                    <li key={historyRun.id}>
                      <div>
                        <strong>{formatRunDate(historyRun.updatedAt, language)}</strong>
                        <span>{scoreMissionRun(manifest, historyRun).percent}% · {historyRun.roleId}</span>
                      </div>
                      <button type="button" className="mission-button" disabled={activeRunLocked} onClick={() => openHistoryRun(historyRun)}>
                        {tt(language, 'mission.debrief.open')}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <>
              <div className="mission-panel-heading">
                <div>
                  <span className="mission-eyebrow">{tt(language, 'mission.debrief.eyebrow')}</span>
                  <h3>{tt(language, 'mission.debrief.title')}</h3>
                  <p>{tt(language, 'mission.debrief.body')}</p>
                </div>
                <div className="mission-actions">
                  <button type="button" className="mission-button" onClick={exportRun}>
                    {tt(language, 'mission.debrief.export')}
                  </button>
                  <button type="button" className="mission-button mission-button--primary" onClick={startRun}>
                    {tt(language, 'mission.runner.repeat')}
                  </button>
                </div>
              </div>

              <div className="mission-score-grid">
                <div className="mission-score-card" role="status" aria-label={tt(language, 'mission.debrief.scoreAria', { score: debrief.score.percent })}>
                  <span>{tt(language, 'mission.debrief.score')}</span>
                  <strong>{debrief.score.percent}%</strong>
                  <small>{debrief.score.points}/{debrief.score.maxPoints} {tt(language, 'mission.debrief.points')}</small>
                </div>
                <div className="mission-blameless-card">
                  <span className="mission-badge mission-badge--success">{tt(language, 'mission.debrief.blameless')}</span>
                  <p>{tt(language, 'mission.debrief.blamelessStatement')}</p>
                </div>
              </div>

              <ol className="mission-debrief-list">
                {debrief.checkpoints.map((checkpoint) => (
                  <li key={checkpoint.checkpointId} className={checkpoint.aligned ? 'is-aligned' : 'is-variance'}>
                    <div className="mission-debrief-heading">
                      <div>
                        <span className="mission-eyebrow">{checkpoint.points}/{checkpoint.maxPoints}</span>
                        <h4>{checkpoint.checkpointTitle}</h4>
                      </div>
                      <span className={`mission-badge ${checkpoint.aligned ? 'mission-badge--success' : 'mission-badge--warning'}`}>
                        {tt(language, checkpoint.aligned ? 'mission.debrief.aligned' : 'mission.debrief.variance')}
                      </span>
                    </div>
                    <dl>
                      <div><dt>{tt(language, 'mission.debrief.selected')}</dt><dd>{checkpoint.selectedDecisionLabel}</dd></div>
                      <div><dt>{tt(language, 'mission.debrief.expected')}</dt><dd>{checkpoint.expectedDecisionLabel}</dd></div>
                    </dl>
                    <p>
                      {tt(
                        language,
                        checkpoint.aligned ? 'mission.debrief.reviewAligned' : 'mission.debrief.reviewVariance',
                        {
                          checkpoint: checkpoint.checkpointTitle,
                          selected: checkpoint.selectedDecisionLabel,
                          expected: checkpoint.expectedDecisionLabel
                        }
                      )}
                    </p>
                    <div className="mission-outcomes">
                      <strong>{tt(language, 'mission.debrief.outcomes')}</strong>
                      {checkpoint.selectedOutcomes.map((outcome) => (
                        <span key={outcome.id} data-tone={outcome.tone}>{outcome.title}: {outcome.description}</span>
                      ))}
                    </div>
                    {!checkpoint.aligned && (
                      <div className="mission-outcomes">
                        <strong>{tt(language, 'mission.debrief.expectedOutcomes')}</strong>
                        {checkpoint.expectedOutcomes.map((outcome) => (
                          <span key={outcome.id} data-tone={outcome.tone}>{outcome.title}: {outcome.description}</span>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ol>

              <section className="mission-comparison" aria-labelledby="mission-comparison-title">
                <div className="mission-section-title">
                  <div>
                    <span className="mission-eyebrow">{tt(language, 'mission.comparison.eyebrow')}</span>
                    <h4 id="mission-comparison-title">{tt(language, 'mission.comparison.title')}</h4>
                  </div>
                  {comparisonCandidates.length > 0 && (
                    <label className="mission-compact-field" htmlFor="mission-baseline">
                      <span>{tt(language, 'mission.comparison.baseline')}</span>
                      <select
                        id="mission-baseline"
                        value={baselineRunId}
                        onChange={(event) => setBaselineRunId(event.target.value)}
                      >
                        {comparisonCandidates.slice().reverse().map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {formatRunDate(candidate.updatedAt, language)} · {scoreMissionRun(manifest, candidate).percent}%
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>

                {!comparison ? (
                  <p className="mission-help">{tt(language, 'mission.comparison.empty')}</p>
                ) : (
                  <>
                    <div className="mission-comparison-metrics">
                      <div><span>{tt(language, 'mission.comparison.scoreDelta')}</span><strong>{comparison.percentDelta >= 0 ? '+' : ''}{comparison.percentDelta} pp</strong></div>
                      <div><span>{tt(language, 'mission.comparison.consistency')}</span><strong>{comparison.consistencyPercent}%</strong></div>
                      <div><span>{tt(language, 'mission.comparison.changed')}</span><strong>{comparison.changedCheckpointIds.length}</strong></div>
                    </div>
                    <div className="mission-table-wrap">
                      <table>
                        <caption>{tt(language, 'mission.comparison.caption')}</caption>
                        <thead>
                          <tr>
                            <th scope="col">{tt(language, 'mission.comparison.checkpoint')}</th>
                            <th scope="col">{tt(language, 'mission.comparison.previous')}</th>
                            <th scope="col">{tt(language, 'mission.comparison.current')}</th>
                            <th scope="col">{tt(language, 'mission.comparison.delta')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {comparison.checkpoints.map((checkpoint) => (
                            <tr key={checkpoint.checkpointId}>
                              <th scope="row">{checkpoint.checkpointTitle}</th>
                              <td>{checkpoint.baselineDecisionLabel ?? '—'}</td>
                              <td>{checkpoint.currentDecisionLabel ?? '—'}</td>
                              <td>{checkpoint.pointDelta >= 0 ? '+' : ''}{checkpoint.pointDelta}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </section>
            </>
          )}
        </section>
      )}

      <footer className="mission-reset-boundary">
        <div>
          <span className="mission-eyebrow">{tt(language, 'mission.reset.eyebrow')}</span>
          <strong>{tt(language, 'mission.reset.title')}</strong>
          <p>{tt(language, 'mission.reset.body')}</p>
        </div>
        <div className="mission-actions">
          <button type="button" className="mission-button" disabled={!run} onClick={resetActiveRun}>
            {tt(language, 'mission.reset.active')}
          </button>
          <button
            type="button"
            className="mission-button mission-button--danger"
            disabled={activeRunLocked}
            title={activeRunLocked ? tt(language, 'mission.tabs.lockedDuringRun') : undefined}
            onClick={resetAllTrainingData}
          >
            {tt(language, 'mission.reset.all')}
          </button>
        </div>
      </footer>
    </div>
  )
}
