import {
  type CSSProperties,
  type FormEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import type { AppViewProps } from '../App'
import { tt } from '../i18n'
import type { TelemetrySnapshot } from '../../../shared/telemetry'
import {
  SETUP_EXPERIMENT_CHANNELS,
  DEFAULT_SETUP_EXPERIMENT_TOLERANCES,
  compareSetupExperimentContexts,
  expectedSetupPathForTreatment,
  nextSetupExperimentStep,
  setupExperimentContextFromTelemetry,
  type SetupExperimentAnalysis,
  type SetupExperimentContext,
  type SetupExperimentDefinition,
  type SetupExperimentDisposition,
  type SetupExperimentExportResult,
  type SetupExperimentSnapshot
} from '../../../shared/setup-experiment'
import {
  SETUP_MANAGER_CHANNELS,
  type SetupLibraryItem,
  type SetupLibraryResult
} from '../../../shared/setup-manager'

const page: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 16 }
const panel: CSSProperties = {
  background: 'var(--surface-raised)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md)',
  padding: 18
}
const grid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
  gap: 12
}
const label: CSSProperties = {
  color: 'var(--text-muted)',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase'
}
const input: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  marginTop: 5,
  padding: '9px 10px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border-default)',
  background: 'var(--surface-sunken)',
  color: 'var(--text-primary)'
}
const button: CSSProperties = {
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--accent-primary)',
  color: 'var(--text-on-accent)',
  cursor: 'pointer',
  fontWeight: 700,
  padding: '8px 12px'
}
const secondaryButton: CSSProperties = {
  ...button,
  background: 'var(--surface-sunken)',
  color: 'var(--text-primary)'
}
const LIVE_CONTEXT_UPDATE_INTERVAL_MS = 250
const LIVE_CONTEXT_FIELDS = [
  'sim',
  'car',
  'carLabel',
  'track',
  'layout',
  'layoutSource',
  'condition',
  'session',
  'sessionId',
  'fuelMassSource',
  'trackWetnessPct',
  'trackTempC',
  'airTempC',
  'fuelMassKg',
  'tyreStatePct',
  'trafficDensity',
  'flagStateIndex',
  'damagePct',
  'gripPct'
] as const satisfies readonly (keyof SetupExperimentContext)[]

function sameLiveContext(
  left: SetupExperimentContext | null | undefined,
  right: SetupExperimentContext | null | undefined
): boolean {
  if (left === right) return true
  if (!left || !right) return false
  return LIVE_CONTEXT_FIELDS.every((field) => left[field] === right[field])
}

function pct(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`
}

function seconds(value: number | null, signed = false): string {
  if (value === null) return '—'
  const prefix = signed && value > 0 ? '+' : ''
  return `${prefix}${value.toFixed(3)} s`
}

function setupName(experiment: SetupExperimentDefinition, arm: 'A1' | 'B' | 'A2'): string {
  return arm === 'B' ? experiment.variantSetup.fileName : experiment.baselineSetup.fileName
}

function directionLabel(language: AppViewProps['language'], analysis: SetupExperimentAnalysis): string {
  const direction = analysis.direction === 'abstain'
    ? analysis.exploratoryDirection ?? 'abstain'
    : analysis.direction
  const prefix = analysis.evidenceStrength === 'confirmatory'
    ? 'setupExperiment.direction.confirmatory'
    : 'setupExperiment.direction.exploratory'
  return tt(language, `${prefix}.${direction}`)
}

function reasonLabel(language: AppViewProps['language'], reason: string): string {
  const separator = reason.indexOf(':')
  const code = separator >= 0 ? reason.slice(0, separator) : reason
  const arm = separator >= 0 ? reason.slice(separator + 1) : ''
  return tt(language, `setupExperiment.reason.${code}`, { arm })
}

function Metric({
  title,
  value,
  detail
}: {
  title: string
  value: string
  detail?: string
}): ReactElement {
  return (
    <div style={{ ...panel, padding: 14 }}>
      <div style={label}>{title}</div>
      <strong style={{ display: 'block', fontSize: 22, marginTop: 4 }}>{value}</strong>
      {detail && <small style={{ color: 'var(--text-muted)' }}>{detail}</small>}
    </div>
  )
}

export default function SetupExperimentView({
  language,
  showToast
}: AppViewProps): ReactElement {
  const [snapshot, setSnapshot] = useState<SetupExperimentSnapshot | null>(null)
  const [library, setLibrary] = useState<SetupLibraryItem[]>([])
  const [name, setName] = useState('')
  const [baselinePath, setBaselinePath] = useState('')
  const [variantPath, setVariantPath] = useState('')
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [liveTelemetryContext, setLiveTelemetryContext] = useState<
    SetupExperimentContext | null | undefined
  >(undefined)
  const revisionRef = useRef<number | null>(null)
  const liveGenerationRef = useRef(0)

  const applySnapshot = useCallback((
    next: SetupExperimentSnapshot,
    source: 'hydrate' | 'live'
  ): void => {
    const rawRevision = next.state.revision
    const nextRevision = typeof rawRevision === 'number' && Number.isSafeInteger(rawRevision)
      ? rawRevision
      : null
    const currentRevision = revisionRef.current
    if (source === 'hydrate' && liveGenerationRef.current > 0) {
      if (nextRevision === null || currentRevision === null || nextRevision <= currentRevision) return
    }
    if (currentRevision !== null) {
      if (nextRevision === null || nextRevision < currentRevision) return
      if (nextRevision === currentRevision && source === 'hydrate') return
    }
    if (source === 'live') liveGenerationRef.current += 1
    revisionRef.current = nextRevision
    setSnapshot(next)
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [nextSnapshot, setupLibrary] = await Promise.all([
        window.ipc.invoke<SetupExperimentSnapshot>(SETUP_EXPERIMENT_CHANNELS.getSnapshot),
        window.ipc.invoke<SetupLibraryResult>(SETUP_MANAGER_CHANNELS.libraryList)
      ])
      applySnapshot(nextSnapshot, 'hydrate')
      setLibrary(setupLibrary.items)
      setBaselinePath((current) => current || setupLibrary.items[0]?.path || '')
      setVariantPath((current) => current || setupLibrary.items[1]?.path || '')
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [applySnapshot])

  useEffect(() => {
    let lastContextUpdateAt = 0
    let pendingContext: SetupExperimentContext | null = null
    let hasPendingContext = false
    let contextTimer: ReturnType<typeof setTimeout> | null = null
    const publishPendingContext = (): void => {
      contextTimer = null
      if (!hasPendingContext) return
      const next = pendingContext
      hasPendingContext = false
      lastContextUpdateAt = Date.now()
      setLiveTelemetryContext((current) => sameLiveContext(current, next) ? current : next)
    }
    const onTelemetry = (next: TelemetrySnapshot | null): void => {
      pendingContext = setupExperimentContextFromTelemetry(next)
      hasPendingContext = true
      const remaining = LIVE_CONTEXT_UPDATE_INTERVAL_MS - (Date.now() - lastContextUpdateAt)
      if (remaining <= 0 && contextTimer === null) {
        publishPendingContext()
      } else if (contextTimer === null) {
        contextTimer = setTimeout(publishPendingContext, remaining)
      }
    }
    void refresh()
    const offExperiment = window.ipc.subscribe<SetupExperimentSnapshot>(
      SETUP_EXPERIMENT_CHANNELS.updated,
      (next) => applySnapshot(next, 'live')
    )
    const offTelemetry = window.ipc.subscribe<TelemetrySnapshot | null>(
      'telemetry:snapshot',
      onTelemetry
    )
    return () => {
      if (contextTimer !== null) clearTimeout(contextTimer)
      offExperiment()
      offTelemetry()
    }
  }, [applySnapshot, refresh])

  const run = useCallback(async (
    key: string,
    operation: () => Promise<SetupExperimentSnapshot | SetupExperimentExportResult>
  ): Promise<void> => {
    setBusy(key)
    try {
      const result = await operation()
      if ('state' in result) applySnapshot(result, 'live')
      else if (result.ok) {
        showToast(tt(language, 'setupExperiment.exported', { file: result.fileName ?? '' }), 'success')
      }
      setError(null)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message)
      showToast(message, 'error')
    } finally {
      setBusy(null)
    }
  }, [applySnapshot, language, showToast])

  const create = (event: FormEvent): void => {
    event.preventDefault()
    void run('create', async () => {
      const next = await window.ipc.invoke<SetupExperimentSnapshot>(
        SETUP_EXPERIMENT_CHANNELS.create,
        { name, baselinePath, variantPath }
      )
      setName('')
      return next
    })
  }

  const metrics = snapshot?.metrics
  const liveContext = liveTelemetryContext === undefined
    ? snapshot?.liveContext
    : liveTelemetryContext
  const liveContextComparable = liveContext
    ? compareSetupExperimentContexts(
        liveContext,
        liveContext,
        DEFAULT_SETUP_EXPERIMENT_TOLERANCES
      ).status === 'comparable'
    : false
  const experiments = snapshot?.state.experiments ?? []
  const libraryByPath = useMemo(
    () => new Map(library.map((item) => [item.path, item])),
    [library]
  )

  const decide = (
    experiment: SetupExperimentDefinition,
    disposition: SetupExperimentDisposition
  ): void => {
    void run(`decision:${experiment.id}`, () =>
      window.ipc.invoke<SetupExperimentSnapshot>(
        SETUP_EXPERIMENT_CHANNELS.recordDecision,
        {
          experimentId: experiment.id,
          disposition,
          note: notes[experiment.id] ?? ''
        }
      )
    )
  }

  return (
    <div style={page}>
      <section style={panel}>
        <div style={label}>{tt(language, 'setupExperiment.eyebrow')}</div>
        <h3 style={{ margin: '6px 0' }}>{tt(language, 'setupExperiment.title')}</h3>
        <p style={{ margin: 0, color: 'var(--text-muted)', maxWidth: 920 }}>
          {tt(language, 'setupExperiment.description')}
        </p>
        <p style={{ margin: '10px 0 0', color: 'var(--accent-warning)' }}>
          {tt(language, 'setupExperiment.manualOnly')}
        </p>
      </section>

      {error && (
        <section style={{ ...panel, borderColor: 'var(--accent-danger)' }} role="alert">
          <strong>{tt(language, 'setupExperiment.error')}</strong>
          <div style={{ marginTop: 5 }}>{error}</div>
        </section>
      )}

      <section style={grid} aria-label={tt(language, 'setupExperiment.metrics')}>
        <Metric
          title={tt(language, 'setupExperiment.metric.protocolCompletion')}
          value={pct(metrics?.protocolCompletionRate ?? null)}
          detail={`${metrics?.completedProtocols ?? 0}/${metrics?.definitions ?? 0}`}
        />
        <Metric
          title={tt(language, 'setupExperiment.metric.decisionCoverage')}
          value={pct(metrics?.decisionCoverage ?? null)}
          detail={tt(language, 'setupExperiment.metric.coverageTarget')}
        />
        <Metric
          title={tt(language, 'setupExperiment.metric.rollbackAgreement')}
          value={pct(metrics?.rollbackAgreementRate ?? null)}
          detail={tt(language, 'setupExperiment.metric.accuracyTarget')}
        />
        <Metric
          title={tt(language, 'setupExperiment.metric.rollbackConflict')}
          value={pct(metrics?.rollbackConflictRate ?? null)}
          detail={tt(language, 'setupExperiment.metric.falseDirectionTarget')}
        />
      </section>

      {(snapshot?.state.storageIssues?.length ?? 0) > 0 && (
        <section style={{ ...panel, borderColor: 'var(--accent-danger)' }} role="alert">
          <strong>{tt(language, 'setupExperiment.storageIssue')}</strong>
          {snapshot?.state.storageIssues?.map((issue) => (
            <div key={`${issue.sourcePath}:${issue.code}`} style={{ marginTop: 8 }}>
              <div>{issue.sourcePath}</div>
              <small>
                {issue.code} · {issue.quarantineStatus ?? issue.kind}
                {issue.quarantinePath ? ` · ${issue.quarantinePath}` : ''}
              </small>
            </div>
          ))}
        </section>
      )}

      {snapshot?.activeCapture?.persistenceError && (
        <section style={{ ...panel, borderColor: 'var(--accent-danger)' }} role="alert">
          <strong>{tt(language, 'setupExperiment.pendingPersistence')}</strong>
          <div>{snapshot.activeCapture.persistenceError}</div>
          <small>
            {tt(language, 'setupExperiment.pendingLapCount', {
              count: snapshot.activeCapture.pendingLapCount ?? 0
            })}
          </small>
        </section>
      )}

      <section style={panel}>
        <div style={label}>{tt(language, 'setupExperiment.liveContext')}</div>
        {liveContext ? (
          <div style={{ ...grid, marginTop: 10 }}>
            <div><strong>{liveContext.sim ?? '—'}</strong><br /><small>{tt(language, 'setupExperiment.context.sim')}</small></div>
            <div><strong>{liveContext.carLabel ?? liveContext.car ?? '—'}</strong><br /><small>{tt(language, 'setupExperiment.context.car')}</small></div>
            <div><strong>{liveContext.track ?? '—'} · {liveContext.layout ?? '—'}</strong><br /><small>{tt(language, 'setupExperiment.context.track')}</small></div>
            <div><strong>{tt(language, `setupExperiment.condition.${liveContext.condition}`)}</strong><br /><small>{tt(language, 'setupExperiment.context.condition')}</small></div>
            <div><strong>{liveContext.session ?? '—'} · {liveContext.sessionId ?? '—'}</strong><br /><small>{tt(language, 'setupExperiment.context.session')}</small></div>
          </div>
        ) : (
          <p style={{ color: 'var(--text-muted)', marginBottom: 0 }}>
            {tt(language, 'setupExperiment.noLiveContext')}
          </p>
        )}
      </section>

      <form style={panel} onSubmit={create}>
        <div style={label}>{tt(language, 'setupExperiment.new')}</div>
        <div style={{ ...grid, marginTop: 10 }}>
          <label>
            {tt(language, 'setupExperiment.name')}
            <input
              style={input}
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
              placeholder={tt(language, 'setupExperiment.namePlaceholder')}
            />
          </label>
          <label>
            {tt(language, 'setupExperiment.baseline')}
            <select style={input} value={baselinePath} onChange={(event) => setBaselinePath(event.target.value)}>
              <option value="">{tt(language, 'setupExperiment.selectSetup')}</option>
              {library.map((item) => <option key={item.path} value={item.path}>{item.relativePath}</option>)}
            </select>
          </label>
          <label>
            {tt(language, 'setupExperiment.variant')}
            <select style={input} value={variantPath} onChange={(event) => setVariantPath(event.target.value)}>
              <option value="">{tt(language, 'setupExperiment.selectSetup')}</option>
              {library.map((item) => <option key={item.path} value={item.path}>{item.relativePath}</option>)}
            </select>
          </label>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
          <button
            style={button}
            disabled={
              busy !== null ||
              !baselinePath ||
              !variantPath ||
              baselinePath === variantPath ||
              !liveContextComparable
            }
            type="submit"
          >
            {busy === 'create' ? tt(language, 'setupExperiment.creating') : tt(language, 'setupExperiment.create')}
          </button>
          <small style={{ color: 'var(--text-muted)' }}>
            {tt(language, 'setupExperiment.oneVariableGate')}
          </small>
        </div>
      </form>

      {experiments.length === 0 && (snapshot?.state.storageIssues?.length ?? 0) === 0 && (
        <section style={{ ...panel, borderStyle: 'dashed', color: 'var(--text-muted)' }}>
          {tt(language, 'setupExperiment.empty')}
        </section>
      )}

      {experiments.map((experiment) => {
        const analysis = snapshot?.analyses[experiment.id]
        if (!analysis) return null
        const nextStep = nextSetupExperimentStep(experiment)
        const nextArm = nextStep?.arm ?? null
        const active = snapshot?.activeCapture?.experimentId === experiment.id
        const expectedPath = nextStep
          ? expectedSetupPathForTreatment(experiment, nextStep.treatment)
          : null
        const expectedItem = expectedPath ? libraryByPath.get(expectedPath) : null
        const liveGate = compareSetupExperimentContexts(
          experiment.context,
          liveContext,
          experiment.environmentTolerances
        )
        const analysisPlan = experiment.analysisPlan
        const tolerances = experiment.environmentTolerances
        return (
          <article key={experiment.id} style={panel}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
              <div>
                <div style={label}>{experiment.variable.section} · {experiment.variable.key}</div>
                <h3 style={{ margin: '5px 0' }}>{experiment.name}</h3>
                <div style={{ color: 'var(--text-muted)' }}>
                  {experiment.variable.before ?? '∅'} → {experiment.variable.after ?? '∅'}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <strong>{directionLabel(language, analysis)}</strong>
                <div>
                  {' · '}
                  {analysis.rollbackRelation === 'agreement'
                    ? tt(language, 'setupExperiment.rollback.agreement')
                    : analysis.rollbackRelation === 'conflict'
                      ? tt(language, 'setupExperiment.rollback.conflict')
                      : tt(language, 'setupExperiment.rollback.unknown')}
                </div>
                {analysis.evidenceStrength === 'confirmatory' && (
                  <small style={{ color: 'var(--accent-success)' }}>
                    {' · '}{tt(language, 'setupExperiment.evidence.confirmatory')}
                  </small>
                )}
                {analysis.evidenceStrength === 'exploratory' && (
                  <small style={{ color: 'var(--accent-warning)' }}>
                    {' · '}{tt(language, 'setupExperiment.evidence.exploratory')}
                  </small>
                )}
                <div>{seconds(analysis.effectSec, true)}</div>
                <small style={{ color: 'var(--text-muted)' }}>
                  95% CI {analysis.confidence95Sec
                    ? `${seconds(analysis.confidence95Sec.low, true)} … ${seconds(analysis.confidence95Sec.high, true)}`
                    : '—'}
                </small>
              </div>
            </div>

            <div style={{ marginTop: 10, color: 'var(--text-muted)', fontSize: 12 }}>
              {tt(language, 'setupExperiment.analysisPlanSummary', {
                seed: analysisPlan?.seed ?? '—',
                iterations: analysisPlan?.iterations ?? '—',
                block: analysisPlan?.lapBlockLength ?? '—',
                drift: analysisPlan?.maxRollbackDriftSec ?? '—'
              })}
              <br />
              {tt(language, 'setupExperiment.toleranceSummary', {
                wetness: tolerances?.trackWetnessPct ?? '—',
                trackTemp: tolerances?.trackTempC ?? '—',
                airTemp: tolerances?.airTempC ?? '—',
                fuel: tolerances?.fuelMassKg ?? '—',
                tyre: tolerances?.tyreStatePct ?? '—',
                traffic: tolerances?.trafficDensity ?? '—',
                flags: tolerances?.flagStateIndex ?? '—',
                damage: tolerances?.damagePct ?? '—',
                grip: tolerances?.gripPct ?? '—'
              })}
            </div>

            <div style={{ ...grid, marginTop: 14 }}>
              {(['A1', 'B', 'A2'] as const).map((arm) => {
                const stats = analysis.arms[arm]
                const runs = experiment.runs.filter((run) => run.arm === arm)
                const latest = runs.at(-1)
                return (
                  <div key={arm} style={{ ...panel, padding: 12 }}>
                    <div style={label}>{arm === 'A2' ? tt(language, 'setupExperiment.rollbackArm') : arm}</div>
                    <strong>{setupName(experiment, arm)}</strong>
                    <div>{stats.usedLaps}/{experiment.minCleanLapsPerArm} {tt(language, 'setupExperiment.cleanLaps')}</div>
                    <small style={{ color: 'var(--text-muted)' }}>
                      {latest ? tt(language, `setupExperiment.run.${latest.status}`) : tt(language, 'setupExperiment.run.notStarted')}
                      {' · '}{stats.outliers} {tt(language, 'setupExperiment.outliers')}
                      {' · '}{stats.unknownLaps} {tt(language, 'setupExperiment.unknown')}
                    </small>
                  </div>
                )
              })}
            </div>

            {analysis.reasons.length > 0 && (
              <div style={{ marginTop: 12, color: 'var(--accent-warning)' }}>
                {analysis.reasons.map((reason) => reasonLabel(language, reason)).join(' · ')}
              </div>
            )}

            {nextStep && nextArm && !active && (
              <div style={{ marginTop: 14 }}>
                <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <input
                    type="checkbox"
                    checked={confirmed[experiment.id] ?? false}
                    onChange={(event) => setConfirmed((current) => ({
                      ...current,
                      [experiment.id]: event.target.checked
                    }))}
                  />
                  <span>
                    {tt(language, 'setupExperiment.confirmManualSetup', {
                      arm: nextArm,
                      setup: expectedItem?.fileName ?? setupName(experiment, nextArm)
                    })}
                  </span>
                </label>
                <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
                  <button
                    style={button}
                    disabled={
                      busy !== null ||
                      snapshot?.activeCapture !== null ||
                      !(confirmed[experiment.id] ?? false) ||
                      liveGate.status !== 'comparable'
                    }
                    onClick={() => void run(`start:${experiment.id}`, async () => {
                      const next = await window.ipc.invoke<SetupExperimentSnapshot>(
                        SETUP_EXPERIMENT_CHANNELS.startArm,
                        {
                          experimentId: experiment.id,
                          arm: nextArm,
                          confirmedSetupPath: expectedPath,
                          blockId: nextStep.blockId,
                          sequence: nextStep.sequence,
                          stepIndex: nextStep.stepIndex,
                          treatment: nextStep.treatment
                        }
                      )
                      setConfirmed((current) => ({ ...current, [experiment.id]: false }))
                      return next
                    })}
                    type="button"
                  >
                    {nextStep.sequence === 'ABA' && nextStep.stepIndex === 2
                      ? tt(language, 'setupExperiment.startRollback')
                      : tt(language, 'setupExperiment.startStep', {
                          block: nextStep.blockId,
                          treatment: nextStep.treatment
                        })}
                  </button>
                  {liveGate.status !== 'comparable' && (
                    <span style={{ color: 'var(--accent-danger)' }}>
                      {tt(language, `setupExperiment.gate.${liveGate.status}`)}
                    </span>
                  )}
                </div>
              </div>
            )}

            {active && (
              <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
                <button
                  style={button}
                  disabled={busy !== null}
                  onClick={() => void run(`finish:${experiment.id}`, () =>
                    window.ipc.invoke<SetupExperimentSnapshot>(
                      SETUP_EXPERIMENT_CHANNELS.finishArm,
                      { experimentId: experiment.id }
                    )
                  )}
                  type="button"
                >
                  {tt(language, 'setupExperiment.finishArm')}
                </button>
                <button
                  style={secondaryButton}
                  disabled={busy !== null}
                  onClick={() => void run(`interrupt:${experiment.id}`, () =>
                    window.ipc.invoke<SetupExperimentSnapshot>(
                      SETUP_EXPERIMENT_CHANNELS.interruptArm,
                      { experimentId: experiment.id }
                    )
                  )}
                  type="button"
                >
                  {tt(language, 'setupExperiment.interruptArm')}
                </button>
              </div>
            )}

            {!nextStep && (
              <div style={{ ...grid, marginTop: 14 }}>
                <label>
                  {tt(language, 'setupExperiment.decisionNote')}
                  <input
                    style={input}
                    value={notes[experiment.id] ?? ''}
                    onChange={(event) => setNotes((current) => ({
                      ...current,
                      [experiment.id]: event.target.value
                    }))}
                    maxLength={1000}
                  />
                </label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
                  <button
                    style={analysis.direction === 'variant' ? button : secondaryButton}
                    disabled={busy !== null || analysis.direction !== 'variant'}
                    onClick={() => decide(experiment, 'keep-variant')}
                    type="button"
                  >
                    {tt(language, 'setupExperiment.keepVariant')}
                  </button>
                  <button
                    style={analysis.direction === 'baseline' ? button : secondaryButton}
                    disabled={busy !== null || analysis.direction !== 'baseline'}
                    onClick={() => decide(experiment, 'keep-baseline')}
                    type="button"
                  >
                    {tt(language, 'setupExperiment.keepBaseline')}
                  </button>
                  <button
                    style={secondaryButton}
                    disabled={busy !== null}
                    onClick={() => decide(experiment, 'abstain')}
                    type="button"
                  >
                    {tt(language, 'setupExperiment.abstain')}
                  </button>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
                  <button
                    style={secondaryButton}
                    disabled={busy !== null}
                    onClick={() => void run(`repeat-bab:${experiment.id}`, () =>
                      window.ipc.invoke<SetupExperimentSnapshot>(
                        SETUP_EXPERIMENT_CHANNELS.addBlock,
                        { experimentId: experiment.id, sequence: 'BAB' }
                      )
                    )}
                    type="button"
                  >
                    {tt(language, 'setupExperiment.addCounterbalancedBlock')}
                  </button>
                  <button
                    style={secondaryButton}
                    disabled={busy !== null}
                    onClick={() => void run(`repeat-aba:${experiment.id}`, () =>
                      window.ipc.invoke<SetupExperimentSnapshot>(
                        SETUP_EXPERIMENT_CHANNELS.addBlock,
                        { experimentId: experiment.id, sequence: 'ABA' }
                      )
                    )}
                    type="button"
                  >
                    {tt(language, 'setupExperiment.addRepeatBlock')}
                  </button>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
              <button
                style={secondaryButton}
                disabled={busy !== null}
                onClick={() => void run(`export:${experiment.id}`, () =>
                  window.ipc.invoke<SetupExperimentExportResult>(
                    SETUP_EXPERIMENT_CHANNELS.export,
                    { experimentId: experiment.id }
                  )
                )}
                type="button"
              >
                {tt(language, 'setupExperiment.export')}
              </button>
              <button
                style={secondaryButton}
                disabled={busy !== null || active}
                onClick={() => {
                  if (!window.confirm(tt(language, 'setupExperiment.deleteConfirm'))) return
                  void run(`delete:${experiment.id}`, () =>
                    window.ipc.invoke<SetupExperimentSnapshot>(
                      SETUP_EXPERIMENT_CHANNELS.delete,
                      { experimentId: experiment.id }
                    )
                  )
                }}
                type="button"
              >
                {tt(language, 'setupExperiment.delete')}
              </button>
              {experiment.decision && (
                <span style={{ alignSelf: 'center', color: 'var(--text-muted)' }}>
                  {tt(language, `setupExperiment.disposition.${experiment.decision.disposition}`)}
                </span>
              )}
            </div>
          </article>
        )
      })}
    </div>
  )
}
