import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactElement } from 'react'
import { evaluateExpression, flattenExpressionScope } from '../../../shared/expr-eval'
import {
  buildIracingExpressionScope,
  getIracingTelemetryValue,
  IRACING_VAR_CATEGORY_LABELS,
  IRACING_VAR_CATEGORY_ORDER,
  IRACING_VARIABLES
} from '../../../shared/iracing-vars'
import {
  EXPR_CHANNELS,
  type ExpressionDef,
  type ExpressionResultEntry,
  type ExpressionResultsBatch,
  type ExpressionValue
} from '../../../shared/expr'
import {
  isMappedIracingVariable,
  unmappedIracingVariableReason,
  type ExpressionDestination,
  type ExpressionStudioSnapshot,
  type ExpressionVisualizationSource
} from '../../../shared/expression-studio'
import type { TelemetrySnapshot } from '../../../shared/telemetry'
import type { AppViewProps } from '../App'
import { getLatestTelemetry, onTelemetry } from '../lib/telemetry'
import { SectionExportImport } from '../components/SectionExportImport'
import { ExpressionVisualizationPanel } from './expressions/ExpressionVisualizationPanel'

const card: CSSProperties = {
  background: 'var(--surface-raised)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 'var(--radius-sm)',
  padding: 16
}

const label: CSSProperties = { fontSize: 11, letterSpacing: 1.1, textTransform: 'uppercase', opacity: 0.62 }
const input: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  marginTop: 6,
  padding: '10px 11px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid rgba(255,255,255,0.14)',
  background: 'rgba(0,0,0,0.22)',
  color: '#fff'
}

function blankExpression(): ExpressionDef {
  return { id: `expr-${Date.now()}`, name: 'New expression', expr: 'speedKmh > 100 ? "fast" : "slow"' }
}

function formatValue(value: ExpressionValue | undefined): string {
  if (value === undefined) return '—'
  if (value === null) return 'null'
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(3)
  return String(value)
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default function ExpressionsView({ showToast }: AppViewProps): ReactElement {
  const [studio, setStudio] = useState<ExpressionStudioSnapshot | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<ExpressionDef>(() => blankExpression())
  const [latest, setLatest] = useState<TelemetrySnapshot | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [liveResults, setLiveResults] = useState<Record<string, ExpressionResultEntry>>({})
  const [visualSource, setVisualSource] = useState<ExpressionVisualizationSource | null>(null)

  const expressions = studio?.expressions ?? []
  const enabledVarIds = studio?.enabledVars ?? []
  const enabledVarSet = useMemo(() => new Set(enabledVarIds), [enabledVarIds])
  const scope = useMemo(() => ({
    ...flattenExpressionScope(latest),
    ...buildIracingExpressionScope(latest, enabledVarIds)
  }), [enabledVarIds, latest])
  const liveResult = useMemo(() => {
    if (!draft.expr.trim()) return { value: null as ExpressionValue, error: 'Enter an expression.' }
    try {
      return { value: evaluateExpression(draft.expr, scope), error: null }
    } catch (error) {
      return { value: null as ExpressionValue, error: getErrorMessage(error) }
    }
  }, [draft.expr, scope])

  const variableRows = useMemo(() => IRACING_VARIABLES
    .filter((item) => enabledVarSet.has(item.id))
    .map((item) => ({
      id: item.id,
      name: item.telemetryField ? `${item.id} · ${item.telemetryField}` : item.id,
      value: getIracingTelemetryValue(latest, item),
      unit: item.unit
    })), [enabledVarSet, latest])

  const iracingGroups = useMemo(() => IRACING_VAR_CATEGORY_ORDER.map((category) => ({
    category,
    label: IRACING_VAR_CATEGORY_LABELS[category],
    variables: IRACING_VARIABLES.filter((item) => item.category === category)
  })).filter((group) => group.variables.length > 0), [])

  const loadStudio = useCallback(async (): Promise<ExpressionStudioSnapshot> => {
    const snapshot = await window.ipc.invoke<ExpressionStudioSnapshot>(EXPR_CHANNELS.getStudio)
    setStudio(snapshot)
    setLoadError(null)
    return snapshot
  }, [])

  const mutateStudio = useCallback(async (next: {
    expressions?: ExpressionDef[]
    enabledVars?: string[]
    outputs?: ExpressionStudioSnapshot['outputs']
    destinations?: ExpressionDestination[]
  }): Promise<ExpressionStudioSnapshot> => {
    if (!studio) throw new Error('Expression Studio is still loading.')
    try {
      const saved = await window.ipc.invoke<ExpressionStudioSnapshot>(EXPR_CHANNELS.mutateStudio, {
        revision: studio.revision,
        expressions: next.expressions ?? studio.expressions,
        enabledVars: next.enabledVars ?? studio.enabledVars,
        outputs: next.outputs ?? studio.outputs,
        destinations: next.destinations ?? studio.destinations
      })
      setStudio(saved)
      return saved
    } catch (error) {
      if (getErrorMessage(error).includes('EXPRESSION_REVISION_CONFLICT')) {
        await loadStudio()
        throw new Error('Expression Studio changed elsewhere. The latest revision was loaded; retry your change.')
      }
      throw error
    }
  }, [loadStudio, studio])

  const reloadStudioAndDraft = useCallback(async (): Promise<void> => {
    const snapshot = await loadStudio()
    const next = snapshot.expressions.find((item) => item.id === selectedId) ?? snapshot.expressions[0]
    setSelectedId(next?.id ?? null)
    setDraft(next ?? blankExpression())
  }, [loadStudio, selectedId])

  useEffect(() => {
    let canceled = false
    void loadStudio()
      .then((snapshot) => {
        if (canceled || !snapshot.expressions[0]) return
        setSelectedId(snapshot.expressions[0].id)
        setDraft(snapshot.expressions[0])
      })
      .catch((error) => {
        if (!canceled) setLoadError(getErrorMessage(error))
      })

    void window.ipc
      .invoke<Record<string, ExpressionResultEntry>>(EXPR_CHANNELS.getResults)
      .then((snapshot) => {
        if (!canceled && snapshot) setLiveResults(snapshot)
      })
      .catch(() => undefined)

    const offResults = window.ipc.subscribe(EXPR_CHANNELS.results, (payload) => {
      const batch = payload as ExpressionResultsBatch | undefined
      if (!batch?.results) return
      setLiveResults((current) => {
        const next = { ...current }
        for (const [id, result] of Object.entries(batch.results)) {
          if (result.deleted) delete next[id]
          else next[id] = result
        }
        return next
      })
    })
    const offStudio = window.ipc.subscribe<ExpressionStudioSnapshot>(EXPR_CHANNELS.studioChanged, (snapshot) => {
      if (snapshot?.version !== 3) return
      setStudio(snapshot)
      setSelectedId((current) => (
        current && snapshot.expressions.some((item) => item.id === current)
          ? current
          : snapshot.expressions[0]?.id ?? null
      ))
      setDraft((current) => (
        snapshot.expressions.find((item) => item.id === current.id) ??
        snapshot.expressions[0] ??
        current
      ))
    })
    const refreshTargets = (): void => {
      void loadStudio().catch(() => undefined)
    }
    const offDashboards = window.ipc.subscribe('app:dash:list', refreshTargets)
    const offOverlays = window.ipc.subscribe('overlays:customState', refreshTargets)
    void getLatestTelemetry().then(setLatest).catch(() => undefined)
    const offTelemetry = onTelemetry(setLatest)
    return () => {
      canceled = true
      offResults()
      offStudio()
      offDashboards()
      offOverlays()
      offTelemetry()
    }
  }, [loadStudio])

  const selectExpression = useCallback((item: ExpressionDef): void => {
    setSelectedId(item.id)
    setDraft(item)
  }, [])

  const saveDraft = useCallback(async (): Promise<void> => {
    if (!draft.name.trim() || !draft.expr.trim()) {
      showToast('Enter a name and expression.', 'error')
      return
    }
    if (liveResult.error) {
      showToast(liveResult.error, 'error')
      return
    }
    const normalized: ExpressionDef = {
      id: draft.id || `expr-${Date.now()}`,
      name: draft.name.trim(),
      expr: draft.expr.trim()
    }
    const exists = expressions.some((item) => item.id === normalized.id)
    const nextExpressions = exists
      ? expressions.map((item) => (item.id === normalized.id ? normalized : item))
      : [normalized, ...expressions]
    try {
      await mutateStudio({ expressions: nextExpressions })
      setSelectedId(normalized.id)
      setDraft(normalized)
      showToast('Expression saved.', 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    }
  }, [draft, expressions, liveResult.error, mutateStudio, showToast])

  const deleteDraft = useCallback(async (): Promise<void> => {
    if (!selectedId || !studio) return
    const nextExpressions = expressions.filter((item) => item.id !== selectedId)
    const nextDestinations = studio.destinations.filter((destination) =>
      !('expressionId' in destination.source && destination.source.expressionId === selectedId)
    )
    const nextOutputs = studio.outputs.filter((output) =>
      !(output.source.kind === 'expression' && output.source.exprId === selectedId)
    )
    try {
      await mutateStudio({
        expressions: nextExpressions,
        destinations: nextDestinations,
        outputs: nextOutputs
      })
      setVisualSource((current) =>
        current && 'expressionId' in current && current.expressionId === selectedId ? null : current
      )
      setSelectedId(nextExpressions[0]?.id ?? null)
      setDraft(nextExpressions[0] ?? blankExpression())
      showToast('Expression removed.', 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    }
  }, [expressions, mutateStudio, selectedId, showToast, studio])

  const toggleIracingVar = useCallback(async (id: string): Promise<void> => {
    if (!studio) return
    const unavailableReason = unmappedIracingVariableReason(id)
    if (unavailableReason) {
      showToast(unavailableReason, 'error')
      return
    }
    if (enabledVarSet.has(id)) {
      const used = studio.destinations.some((destination) =>
        'variableId' in destination.source && destination.source.variableId === id
      )
      if (used) {
        showToast('Remove this variable’s visualization destinations before disabling it.', 'error')
        return
      }
    }
    const next = enabledVarSet.has(id) ? enabledVarIds.filter((item) => item !== id) : [...enabledVarIds, id]
    try {
      await mutateStudio({ enabledVars: next })
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    }
  }, [enabledVarIds, enabledVarSet, mutateStudio, showToast, studio])

  const commitDestinations = useCallback(async (
    destinations: ExpressionDestination[],
    enabledVars: string[]
  ): Promise<void> => {
    await mutateStudio({ destinations, enabledVars })
    showToast('Visualization destinations saved.', 'success')
  }, [mutateStudio, showToast])

  const updateLegacyOutput = useCallback(async (outputId: string, action: 'toggle' | 'remove'): Promise<void> => {
    if (!studio) return
    const outputs = action === 'remove'
      ? studio.outputs.filter((output) => output.id !== outputId)
      : studio.outputs.map((output) => output.id === outputId ? { ...output, enabled: !output.enabled } : output)
    try {
      await mutateStudio({ outputs })
      showToast(action === 'remove' ? 'Legacy output removed.' : 'Legacy output updated.', 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    }
  }, [mutateStudio, showToast, studio])

  const draftLiveValue = draft.id ? liveResults[draft.id] : undefined
  const selectedDestinationCount = studio?.destinations.filter((destination) =>
    'expressionId' in destination.source && destination.source.expressionId === draft.id
  ).length ?? 0

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(250px, 0.75fr) minmax(520px, 1.5fr)', gap: 16 }}>
      <section style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
          <div>
            <div style={label}>Library</div>
            <h3 style={{ margin: '4px 0 0' }}>Expressions</h3>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <SectionExportImport sectionId="expressions" label="Expressions" onImported={() => void reloadStudioAndDraft()} />
            <button
              className="primary-action compact"
              type="button"
              onClick={() => {
                setSelectedId(null)
                setDraft(blankExpression())
              }}
            >
              New
            </button>
          </div>
        </div>
        {loadError && <p style={{ color: 'var(--accent-danger)' }}>{loadError}</p>}
        <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
          {expressions.length === 0 && <p style={{ opacity: 0.7 }}>No expressions saved yet.</p>}
          {expressions.map((item) => {
            const destinationCount = studio?.destinations.filter((destination) =>
              'expressionId' in destination.source && destination.source.expressionId === item.id
            ).length ?? 0
            return (
              <div
                key={item.id}
                style={{
                  padding: 10,
                  borderRadius: 'var(--radius-sm)',
                  border: item.id === selectedId ? '1px solid var(--accent-primary)' : '1px solid rgba(255,255,255,0.12)',
                  background: item.id === selectedId ? 'rgba(var(--accent-rgb),0.14)' : 'rgba(0,0,0,0.18)'
                }}
              >
                <button
                  onClick={() => selectExpression(item)}
                  style={{ width: '100%', border: 0, background: 'transparent', color: '#fff', textAlign: 'left', padding: 0 }}
                  type="button"
                >
                  <strong>{item.name}</strong>
                  <code style={{ display: 'block', opacity: 0.72, marginTop: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {item.expr}
                  </code>
                </button>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 8, alignItems: 'center' }}>
                  <span style={{ opacity: 0.7, fontSize: 12 }}>{destinationCount} visualization(s) · {formatValue(liveResults[item.id]?.value)}</span>
                  <button
                    type="button"
                    className="ghost-action compact"
                    onClick={() => {
                      selectExpression(item)
                      setVisualSource({ expressionId: item.id })
                    }}
                  >
                    Visualize on…
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <div style={{ display: 'grid', gap: 16 }}>
        <section style={card}>
          <div style={label}>Editor</div>
          <label style={{ display: 'block', marginTop: 10 }}>
            Name
            <input style={input} value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
          </label>
          <label style={{ display: 'block', marginTop: 12 }}>
            Expression
            <textarea
              rows={4}
              style={{ ...input, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', resize: 'vertical' }}
              value={draft.expr}
              onChange={(event) => setDraft((current) => ({ ...current, expr: event.target.value }))}
            />
          </label>
          <p style={{ opacity: 0.72, margin: '10px 0 0' }}>
            Operators + - * / % && || ! ?:; min/max/abs/round/floor/ceil/clamp; if/iif; format/formattime;
            string helpers; coalesce/switch/between/pow/sqrt/sign/log/not/dashboard.
          </p>
          <div style={{ marginTop: 12, padding: 10, borderRadius: 'var(--radius-sm)', background: 'rgba(0,0,0,0.18)' }}>
            <strong>Preview: {formatValue(liveResult.error ? undefined : liveResult.value)}</strong>
            {liveResult.error && <span style={{ display: 'block', color: 'var(--accent-danger)', marginTop: 4 }}>{liveResult.error}</span>}
            {draftLiveValue && <span style={{ display: 'block', opacity: 0.65, marginTop: 4 }}>Engine: {formatValue(draftLiveValue.value)}</span>}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
            <button className="primary-action compact" type="button" onClick={() => void saveDraft()}>Save</button>
            <button className="ghost-action danger compact" type="button" onClick={() => void deleteDraft()} disabled={!selectedId}>Delete</button>
            <button
              className="ghost-action compact"
              type="button"
              disabled={!selectedId}
              onClick={() => selectedId && setVisualSource({ expressionId: selectedId })}
            >
              Visualize on… ({selectedDestinationCount})
            </button>
          </div>
          {(studio?.outputs.length ?? 0) > 0 && (
            <div style={{ marginTop: 12, display: 'grid', gap: 7 }}>
              <p style={{ margin: 0, opacity: 0.68 }}>
                Legacy non-visual outputs were preserved by the v3 migration. Serial, dashboard switching, and
                second-screen routes are not visualization surfaces.
              </p>
              {studio?.outputs.map((output) => (
                <div
                  key={output.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr auto',
                    gap: 8,
                    alignItems: 'center',
                    padding: 8,
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    opacity: output.enabled ? 1 : 0.62
                  }}
                >
                  <span>
                    <strong>{output.target.kind}</strong>
                    <code style={{ display: 'block', opacity: 0.66, marginTop: 3 }}>{output.id}</code>
                  </span>
                  <span style={{ display: 'flex', gap: 6 }}>
                    <button type="button" className="ghost-action compact" onClick={() => void updateLegacyOutput(output.id, 'toggle')}>
                      {output.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button type="button" className="ghost-action danger compact" onClick={() => void updateLegacyOutput(output.id, 'remove')}>
                      Remove
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {studio && visualSource && (
          <ExpressionVisualizationPanel
            studio={studio}
            source={visualSource}
            onCommit={commitDestinations}
            onClose={() => setVisualSource(null)}
          />
        )}

        <section style={card}>
          <div style={label}>iRacing Field Catalog</div>
          <h3 style={{ margin: '5px 0 8px' }}>Mapped variables only</h3>
          <p style={{ margin: 0, opacity: 0.72 }}>
            A variable is a stable source only when it has an exact TelemetrySnapshot mapping. The 57 unmapped
            catalog fields remain visible with their reason, but cannot be enabled or visualized.
          </p>
          <div style={{ display: 'grid', gap: 12, marginTop: 14 }}>
            {iracingGroups.map((group) => {
              const enabledCount = group.variables.filter((item) => enabledVarSet.has(item.id)).length
              return (
                <div key={group.category} style={{ border: '1px solid rgba(255,255,255,0.09)', borderRadius: 'var(--radius-sm)', padding: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                    <strong>{group.label}</strong>
                    <span style={{ opacity: 0.65, fontSize: 12 }}>{enabledCount}/{group.variables.length}</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 8, marginTop: 10 }}>
                    {group.variables.map((item) => {
                      const value = getIracingTelemetryValue(latest, item)
                      const mapped = isMappedIracingVariable(item.id)
                      const reason = mapped ? undefined : unmappedIracingVariableReason(item.id)
                      return (
                        <div
                          key={item.id}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'auto 1fr',
                            gap: 8,
                            alignItems: 'start',
                            padding: 9,
                            borderRadius: 'var(--radius-sm)',
                            border: enabledVarSet.has(item.id) ? '1px solid rgba(var(--accent-rgb),0.55)' : '1px solid rgba(255,255,255,0.08)',
                            background: enabledVarSet.has(item.id) ? 'rgba(var(--accent-rgb),0.12)' : 'rgba(0,0,0,0.12)',
                            opacity: mapped ? 1 : 0.62
                          }}
                        >
                          <input
                            aria-label={`Enable ${item.id}`}
                            type="checkbox"
                            checked={enabledVarSet.has(item.id)}
                            disabled={!mapped}
                            onChange={() => void toggleIracingVar(item.id)}
                            style={{ marginTop: 3 }}
                            title={reason}
                          />
                          <span>
                            <code>{item.id}</code>
                            <span style={{ display: 'block', opacity: 0.82, marginTop: 3 }}>{item.label}{item.unit ? ` · ${item.unit}` : ''}</span>
                            <span style={{ display: 'block', opacity: 0.62, marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>
                              {mapped
                                ? `${item.telemetryField}: ${formatValue(value)}${item.unit && value !== undefined ? ` ${item.unit}` : ''}`
                                : reason}
                            </span>
                            <button
                              type="button"
                              className="ghost-action compact"
                              disabled={!mapped}
                              title={reason}
                              style={{ marginTop: 7 }}
                              onClick={() => setVisualSource({ variableId: item.id })}
                            >
                              Visualize on…
                            </button>
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        <section style={card}>
          <div style={label}>Enabled sources</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, marginTop: 12, maxHeight: 260, overflow: 'auto' }}>
            {variableRows.length === 0 && <p style={{ opacity: 0.7 }}>No mapped iRacing variables enabled.</p>}
            {variableRows.map((item) => (
              <div key={item.id} style={{ border: '1px solid rgba(255,255,255,0.09)', borderRadius: 'var(--radius-sm)', padding: 9, background: 'rgba(0,0,0,0.16)' }}>
                <code>{item.name}</code>
                <div style={{ opacity: 0.68, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
                  {formatValue(item.value)}{item.unit && item.value !== undefined ? ` ${item.unit}` : ''}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
