import {
  type CSSProperties,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState
} from 'react'
import {
  RACEOPS_BLUEPRINT_CHANNELS,
  type RaceOpsBlueprintCatalogEntry,
  type RaceOpsBlueprintDryRunResponse,
  type RaceOpsBlueprintParameter,
  type RaceOpsBlueprintRegistrySnapshot,
  type RaceOpsBlueprintStageResponse,
  type RaceOpsCompatibilityStatus,
  type RaceOpsScalar
} from '../../../shared/raceops-blueprints'
import type { AppViewProps } from '../App'
import { tt } from '../i18n'

const card: CSSProperties = {
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--surface-raised)',
  padding: 16
}

const inset: CSSProperties = {
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--surface-sunken)',
  padding: 12
}

const eyebrow: CSSProperties = {
  color: 'var(--accent-primary)',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.15em',
  textTransform: 'uppercase'
}

const muted: CSSProperties = {
  color: 'var(--text-secondary)',
  fontSize: 12,
  lineHeight: 1.45
}

const button: CSSProperties = {
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--surface-overlay)',
  color: 'var(--text-primary)',
  cursor: 'pointer',
  fontSize: 12,
  padding: '8px 12px'
}

const primaryButton: CSSProperties = {
  ...button,
  borderColor: 'var(--border-accent)',
  background: 'var(--accent-primary)',
  color: 'var(--text-on-accent)',
  fontWeight: 700
}

const input: CSSProperties = {
  width: '100%',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--surface-sunken)',
  color: 'var(--text-primary)',
  fontSize: 13,
  padding: '8px 10px'
}

const mono: CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
  overflowWrap: 'anywhere'
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function formatDate(value: string): string {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : value
}

function statusColor(status: RaceOpsCompatibilityStatus): string {
  if (status === 'compatible') return 'var(--accent-success)'
  if (status === 'incompatible-app' || status === 'trace-mismatch') return 'var(--text-danger)'
  if (status === 'stale') return 'var(--accent-warning)'
  return 'var(--text-muted)'
}

function StatusBadge({
  status,
  language
}: {
  status: RaceOpsCompatibilityStatus
  language: AppViewProps['language']
}): ReactElement {
  const color = statusColor(status)
  return (
    <span
      style={{
        display: 'inline-flex',
        border: `1px solid color-mix(in srgb, ${color} 55%, transparent)`,
        borderRadius: 'var(--radius-pill)',
        color,
        fontSize: 11,
        fontWeight: 700,
        padding: '4px 8px'
      }}
    >
      {tt(language, `blueprints.status.${status}`)}
    </span>
  )
}

function parameterDefaults(parameters: RaceOpsBlueprintParameter[]): Record<string, RaceOpsScalar> {
  return Object.fromEntries(parameters.map((parameter) => [parameter.id, parameter.default]))
}

function ParameterField({
  parameter,
  value,
  onChange,
  language
}: {
  parameter: RaceOpsBlueprintParameter
  value: RaceOpsScalar
  onChange(value: RaceOpsScalar): void
  language: AppViewProps['language']
}): ReactElement {
  if (parameter.type === 'number') {
    return (
      <label style={{ display: 'grid', gap: 6 }}>
        <strong style={{ fontSize: 12 }}>{parameter.label}</strong>
        {parameter.description ? <span style={muted}>{parameter.description}</span> : null}
        <input
          type="number"
          min={parameter.min}
          max={parameter.max}
          step={parameter.step}
          value={typeof value === 'number' ? value : parameter.default}
          onChange={(event) => {
            const next = Number(event.currentTarget.value)
            if (Number.isFinite(next)) onChange(next)
          }}
          style={input}
        />
        <span style={muted}>
          {tt(language, 'blueprints.parameter.number', {
            min: parameter.min,
            max: parameter.max,
            step: parameter.step
          })}
          {parameter.unit ? ` · ${parameter.unit}` : ''}
        </span>
      </label>
    )
  }

  if (parameter.type === 'boolean') {
    const checked = typeof value === 'boolean' ? value : parameter.default
    return (
      <label style={{ ...inset, display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.currentTarget.checked)}
        />
        <span style={{ display: 'grid', gap: 2 }}>
          <strong style={{ fontSize: 12 }}>{parameter.label}</strong>
          {parameter.description ? <span style={muted}>{parameter.description}</span> : null}
          <span style={muted}>
            {tt(
              language,
              checked
                ? 'blueprints.parameter.booleanOn'
                : 'blueprints.parameter.booleanOff'
            )}
          </span>
        </span>
      </label>
    )
  }

  return (
    <label style={{ display: 'grid', gap: 6 }}>
      <strong style={{ fontSize: 12 }}>{parameter.label}</strong>
      {parameter.description ? <span style={muted}>{parameter.description}</span> : null}
      <select
        value={typeof value === 'string' ? value : parameter.default}
        onChange={(event) => onChange(event.currentTarget.value)}
        style={input}
      >
        {parameter.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export default function RaceOpsBlueprintsView({
  showToast,
  language
}: AppViewProps): ReactElement {
  const [snapshot, setSnapshot] = useState<RaceOpsBlueprintRegistrySnapshot | null>(null)
  const [selectedKey, setSelectedKey] = useState('')
  const [parameters, setParameters] = useState<Record<string, RaceOpsScalar>>({})
  const [run, setRun] = useState<RaceOpsBlueprintDryRunResponse | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const loadSnapshot = useCallback(async (): Promise<RaceOpsBlueprintRegistrySnapshot> => {
    const next = await window.ipc.invoke<RaceOpsBlueprintRegistrySnapshot>(
      RACEOPS_BLUEPRINT_CHANNELS.getSnapshot
    )
    setSnapshot(next)
    return next
  }, [])

  useEffect(() => {
    void loadSnapshot().catch((error) => showToast(getErrorMessage(error), 'error'))
    return window.ipc.subscribe<RaceOpsBlueprintRegistrySnapshot>(
      RACEOPS_BLUEPRINT_CHANNELS.changed,
      (next) => setSnapshot(next)
    )
  }, [loadSnapshot, showToast])

  useEffect(() => {
    if (!snapshot?.blueprints.length) {
      setSelectedKey('')
      return
    }
    const stillExists = snapshot.blueprints.some(
      (entry) => `${entry.feedId}:${entry.id}` === selectedKey
    )
    if (!stillExists) {
      const first = snapshot.blueprints[0]
      setSelectedKey(`${first.feedId}:${first.id}`)
    }
  }, [selectedKey, snapshot])

  const selected = useMemo<RaceOpsBlueprintCatalogEntry | null>(() => {
    if (!snapshot) return null
    return (
      snapshot.blueprints.find((entry) => `${entry.feedId}:${entry.id}` === selectedKey) ??
      null
    )
  }, [selectedKey, snapshot])

  useEffect(() => {
    if (!selected) {
      setParameters({})
      setRun(null)
      return
    }
    setParameters(parameterDefaults(selected.parameters))
    setRun(null)
  }, [selected?.feedId, selected?.id, selected?.version])

  const invokeSelection = useCallback(
    async <T,>(channel: string): Promise<T> => {
      if (!selected) throw new Error('No blueprint selected.')
      return window.ipc.invoke<T>(channel, {
        feedId: selected.feedId,
        blueprintId: selected.id,
        parameters
      })
    },
    [parameters, selected]
  )

  async function refreshFeed(feedId: string): Promise<void> {
    setBusy(`feed:${feedId}`)
    try {
      const next = await window.ipc.invoke<RaceOpsBlueprintRegistrySnapshot>(
        RACEOPS_BLUEPRINT_CHANNELS.refreshFeed,
        feedId
      )
      setSnapshot(next)
      showToast(tt(language, 'blueprints.toastRefreshed'), 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      setBusy(null)
    }
  }

  async function dryRun(): Promise<void> {
    setBusy('dry-run')
    try {
      const response = await invokeSelection<RaceOpsBlueprintDryRunResponse>(
        RACEOPS_BLUEPRINT_CHANNELS.dryRun
      )
      setRun(response)
      await loadSnapshot()
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      setBusy(null)
    }
  }

  async function stage(): Promise<void> {
    setBusy('stage')
    try {
      const response = await invokeSelection<RaceOpsBlueprintStageResponse>(
        RACEOPS_BLUEPRINT_CHANNELS.stage
      )
      setRun(response)
      await loadSnapshot()
      showToast(
        tt(language, response.installed ? 'blueprints.staged' : 'blueprints.notStaged'),
        response.installed ? 'success' : 'error'
      )
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      setBusy(null)
    }
  }

  async function rollback(): Promise<void> {
    if (!selected) return
    setBusy('rollback')
    try {
      const response = await window.ipc.invoke<RaceOpsBlueprintStageResponse>(
        RACEOPS_BLUEPRINT_CHANNELS.rollback,
        selected.id
      )
      setRun(response)
      await loadSnapshot()
      showToast(
        tt(language, response.installed ? 'blueprints.rolledBack' : 'blueprints.notStaged'),
        response.installed ? 'success' : 'error'
      )
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      setBusy(null)
    }
  }

  const visibleEvidence = snapshot?.evidence.slice(0, 8) ?? []

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <section style={{ ...card, display: 'grid', gap: 10 }}>
        <div style={eyebrow}>{tt(language, 'blueprints.eyebrow')}</div>
        <h2 style={{ margin: 0, fontSize: 24 }}>{tt(language, 'blueprints.title')}</h2>
        <p style={{ ...muted, margin: 0, maxWidth: 900 }}>{tt(language, 'blueprints.help')}</p>
        <div
          style={{
            ...inset,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap'
          }}
        >
          <strong style={{ color: 'var(--accent-warning)', fontSize: 12 }}>
            {tt(language, 'blueprints.trustGate')}
          </strong>
          <span style={{ ...muted, ...mono }}>
            {tt(language, 'blueprints.executionDisabled')}
          </span>
        </div>
      </section>

      <section style={{ ...card, display: 'grid', gap: 12 }}>
        <div style={eyebrow}>{tt(language, 'blueprints.feeds')}</div>
        {(snapshot?.feeds ?? []).map((feed) => (
          <div
            key={feed.feedId}
            style={{
              ...inset,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap'
            }}
          >
            <div style={{ display: 'grid', gap: 4, minWidth: 260 }}>
              <strong>{feed.title}</strong>
              <span style={muted}>
                {tt(language, `blueprints.source.${feed.source.kind}`)} ·{' '}
                {tt(language, 'blueprints.sequence', { sequence: feed.sequence })} ·{' '}
                {tt(language, 'blueprints.expires', { date: formatDate(feed.expiresAt) })}
              </span>
              <span style={muted}>
                {tt(language, 'blueprints.reviewed', { date: formatDate(feed.reviewedAt) })} ·{' '}
                {tt(language, 'blueprints.signer', { keyId: feed.signerKeyId })}
              </span>
              <span style={{ ...muted, ...mono }}>{feed.source.url}</span>
              <span style={{ ...muted, ...mono }}>
                {tt(language, 'blueprints.envelopeHash')}: {feed.envelopeSha256}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span
                style={{
                  color: feed.offline ? 'var(--accent-warning)' : 'var(--accent-success)',
                  fontSize: 11,
                  fontWeight: 700
                }}
              >
                {tt(
                  language,
                  feed.offline
                    ? 'blueprints.offlineCache'
                    : feed.fromCache
                      ? 'blueprints.verifiedCache'
                      : 'blueprints.liveVerified'
                )}
              </span>
              <button
                type="button"
                style={button}
                disabled={busy !== null}
                onClick={() => void refreshFeed(feed.feedId)}
              >
                {busy === `feed:${feed.feedId}`
                  ? tt(language, 'blueprints.refreshing')
                  : tt(language, 'blueprints.refresh')}
              </button>
            </div>
          </div>
        ))}
      </section>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))',
          gap: 16
        }}
      >
        <section style={{ ...card, display: 'grid', gap: 10, alignContent: 'start' }}>
          <div style={eyebrow}>{tt(language, 'blueprints.catalog')}</div>
          {(snapshot?.blueprints ?? []).length === 0 ? (
            <p style={muted}>{tt(language, 'blueprints.catalogEmpty')}</p>
          ) : (
            snapshot?.blueprints.map((entry) => {
              const key = `${entry.feedId}:${entry.id}`
              const active = key === selectedKey
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedKey(key)}
                  style={{
                    ...inset,
                    textAlign: 'left',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    borderColor: active ? 'var(--border-accent)' : 'var(--border-subtle)',
                    boxShadow: active ? 'inset 3px 0 0 var(--accent-primary)' : 'none'
                  }}
                >
                  <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <strong>{entry.title}</strong>
                    <StatusBadge status={entry.compatibilityStatus} language={language} />
                  </span>
                  <span style={{ ...muted, display: 'block', marginTop: 6 }}>
                    {entry.summary}
                  </span>
                  <span style={{ ...muted, ...mono, display: 'block', marginTop: 8 }}>
                    {entry.id}@{entry.version}
                  </span>
                  {entry.installed ? (
                    <span
                      style={{
                        display: 'block',
                        color: 'var(--accent-success)',
                        fontSize: 11,
                        fontWeight: 700,
                        marginTop: 6
                      }}
                    >
                      {tt(language, 'blueprints.installed', {
                        version: entry.installed.blueprintVersion
                      })}
                    </span>
                  ) : null}
                </button>
              )
            })
          )}
        </section>

        <section style={{ ...card, display: 'grid', gap: 14, alignContent: 'start' }}>
          <div style={eyebrow}>{tt(language, 'blueprints.wizard')}</div>
          {!selected ? (
            <p style={muted}>{tt(language, 'blueprints.select')}</p>
          ) : (
            <>
              <div>
                <h3 style={{ margin: 0 }}>{selected.title}</h3>
                <p style={{ ...muted, margin: '6px 0 0' }}>
                  {tt(language, 'blueprints.wizardHelp')}
                </p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
                <div style={inset}>
                  <div style={eyebrow}>{tt(language, 'blueprints.compatibility')}</div>
                  <div style={{ ...mono, fontSize: 12, marginTop: 5 }}>
                    {selected.compatibility.app.min} – {selected.compatibility.app.max}
                  </div>
                </div>
                <div style={inset}>
                  <div style={eyebrow}>{tt(language, 'blueprints.manifestHash')}</div>
                  <div style={{ ...mono, fontSize: 11, marginTop: 5 }}>
                    {selected.manifestSha256}
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gap: 10 }}>
                <div style={eyebrow}>{tt(language, 'blueprints.capabilities')}</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {selected.capabilities.map((capability) => (
                    <span key={capability} style={{ ...inset, ...mono, padding: '5px 8px', fontSize: 11 }}>
                      {capability}
                    </span>
                  ))}
                </div>
              </div>

              <div style={{ display: 'grid', gap: 12 }}>
                {selected.parameters.length === 0 ? (
                  <p style={muted}>{tt(language, 'blueprints.noParameters')}</p>
                ) : (
                  selected.parameters.map((parameter) => (
                    <ParameterField
                      key={parameter.id}
                      parameter={parameter}
                      value={parameters[parameter.id] ?? parameter.default}
                      language={language}
                      onChange={(value) =>
                        setParameters((current) => ({ ...current, [parameter.id]: value }))
                      }
                    />
                  ))
                )}
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  style={button}
                  disabled={busy !== null}
                  onClick={() => void dryRun()}
                >
                  {busy === 'dry-run'
                    ? tt(language, 'blueprints.running')
                    : tt(language, 'blueprints.dryRun')}
                </button>
                <button
                  type="button"
                  style={primaryButton}
                  disabled={busy !== null}
                  onClick={() => void stage()}
                >
                  {busy === 'stage'
                    ? tt(language, 'blueprints.running')
                    : tt(language, 'blueprints.stage')}
                </button>
                {selected.rollbackAvailable ? (
                  <button
                    type="button"
                    style={button}
                    disabled={busy !== null}
                    onClick={() => void rollback()}
                  >
                    {busy === 'rollback'
                      ? tt(language, 'blueprints.running')
                      : tt(language, 'blueprints.rollback')}
                  </button>
                ) : null}
              </div>
            </>
          )}
        </section>
      </div>

      <section style={{ ...card, display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={eyebrow}>{tt(language, 'blueprints.trace')}</div>
          {run?.result ? (
            <strong
              style={{
                color: run.result.matchesExpected
                  ? 'var(--accent-success)'
                  : 'var(--text-danger)',
                fontSize: 12
              }}
            >
              {tt(
                language,
                run.result.matchesExpected
                  ? 'blueprints.traceMatch'
                  : 'blueprints.traceMismatch'
              )}
            </strong>
          ) : null}
        </div>
        {!run?.result?.trace.length ? (
          <p style={muted}>{tt(language, 'blueprints.traceEmpty')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  {[
                    'blueprints.traceSequence',
                    'blueprints.traceTime',
                    'blueprints.traceStep',
                    'blueprints.traceKind',
                    'blueprints.tracePayload'
                  ].map((key) => (
                    <th
                      key={key}
                      style={{
                        borderBottom: '1px solid var(--border-default)',
                        color: 'var(--text-muted)',
                        padding: '7px 8px',
                        textAlign: 'left'
                      }}
                    >
                      {tt(language, key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {run.result.trace.map((entry) => (
                  <tr key={`${entry.sequence}:${entry.stepId}`}>
                    <td style={{ borderBottom: '1px solid var(--border-subtle)', padding: 8 }}>
                      {entry.sequence}
                    </td>
                    <td style={{ borderBottom: '1px solid var(--border-subtle)', padding: 8 }}>
                      {entry.atMs} ms
                    </td>
                    <td style={{ ...mono, borderBottom: '1px solid var(--border-subtle)', padding: 8 }}>
                      {entry.stepId}
                    </td>
                    <td style={{ borderBottom: '1px solid var(--border-subtle)', padding: 8 }}>
                      {entry.kind}
                    </td>
                    <td style={{ ...mono, borderBottom: '1px solid var(--border-subtle)', padding: 8 }}>
                      {JSON.stringify(entry.payload)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section style={{ ...card, display: 'grid', gap: 10 }}>
        <div style={eyebrow}>{tt(language, 'blueprints.evidence')}</div>
        {visibleEvidence.length === 0 ? (
          <p style={muted}>{tt(language, 'blueprints.evidenceEmpty')}</p>
        ) : (
          visibleEvidence.map((evidence) => (
            <div
              key={evidence.id}
              style={{
                ...inset,
                display: 'grid',
                gridTemplateColumns: 'minmax(180px, 1fr) auto',
                gap: 10
              }}
            >
              <div style={{ display: 'grid', gap: 4 }}>
                <strong>
                  {evidence.blueprintId}@{evidence.blueprintVersion}
                </strong>
                <span style={muted}>
                  {tt(language, 'blueprints.operation')}: {evidence.operation} ·{' '}
                  {tt(language, 'blueprints.publishedAt')}: {formatDate(evidence.publishedAt)}
                </span>
                <span style={{ ...muted, ...mono }}>
                  {tt(language, 'blueprints.publisher')}: {evidence.publisher}
                </span>
                {evidence.reasons.length > 0 ? (
                  <span style={{ color: 'var(--text-danger)', fontSize: 12 }}>
                    {evidence.reasons.join(' · ')}
                  </span>
                ) : null}
              </div>
              <StatusBadge status={evidence.status} language={language} />
            </div>
          ))
        )}
      </section>
    </div>
  )
}
