import { useEffect, useMemo, useState, type CSSProperties, type ReactElement } from 'react'
import {
  destinationToDashboardElement,
  sourceDisplayName,
  type ExpressionDestination,
  type ExpressionDestinationCapability,
  type ExpressionDestinationFormat,
  type ExpressionDestinationSurface,
  type ExpressionPresentation,
  type ExpressionStudioSnapshot,
  type ExpressionVisualizationSource
} from '../../../../shared/expression-studio'
import { PREVIEW_SNAPSHOT } from '../../dashboard/widgets/gt3-theme'
import { renderDashboardElement } from '../../dashboard/DashboardRoot'
import { navigateToEditor } from '../../lib/app-navigation'

const field: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  marginTop: 5,
  padding: '8px 9px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid rgba(255,255,255,0.14)',
  background: 'rgba(0,0,0,0.24)',
  color: '#fff'
}

const SURFACE_LABELS: Record<ExpressionDestinationSurface, string> = {
  dashboard: 'Dashboard',
  overlay: 'Overlay',
  oled: 'OLED',
  touch: 'Touch'
}

const PRESENTATION_LABELS: Record<ExpressionPresentation, string> = {
  value: 'Value',
  bar: 'Bar',
  gauge: 'Gauge',
  status: 'Status'
}

interface Props {
  studio: ExpressionStudioSnapshot
  source: ExpressionVisualizationSource
  onCommit(destinations: ExpressionDestination[], enabledVars: string[]): Promise<void>
  onClose(): void
}

function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `destination-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function defaultFormat(presentation: ExpressionPresentation, label: string): ExpressionDestinationFormat {
  if (presentation === 'bar' || presentation === 'gauge') {
    return { label, decimals: 1, min: 0, max: 100, color: '#35d07f' }
  }
  if (presentation === 'status') {
    return { label, trueText: 'ON', falseText: 'OFF', color: '#35d07f' }
  }
  return { label, decimals: 1 }
}

function fitGeometry(capability: ExpressionDestinationCapability | undefined, targetId: string) {
  const target = capability?.targets.find((item) => item.id === targetId)
  const maxWidth = target?.width ?? 1024
  const maxHeight = target?.height ?? 600
  const width = Math.min(260, maxWidth)
  const height = Math.min(120, maxHeight)
  return {
    x: Math.min(24, Math.max(0, maxWidth - width)),
    y: Math.min(24, Math.max(0, maxHeight - height)),
    width,
    height
  }
}

function initialDestination(
  studio: ExpressionStudioSnapshot,
  source: ExpressionVisualizationSource
): ExpressionDestination {
  const capability =
    studio.capabilities.find((item) => item.surface === 'dashboard' && item.available && item.targets.length > 0) ??
    studio.capabilities.find((item) => item.surface === 'overlay' && item.available && item.targets.length > 0) ??
    studio.capabilities[0]
  const surface = capability?.surface ?? 'dashboard'
  const targetId = capability?.targets[0]?.id ?? ''
  const presentation: ExpressionPresentation = 'value'
  const label = sourceDisplayName(source, studio.expressions)
  return {
    id: createId(),
    source: { ...source },
    surface,
    targetId,
    presentation,
    geometry: fitGeometry(capability, targetId),
    format: defaultFormat(presentation, label),
    enabled: true
  }
}

export function ExpressionDestinationPreview({
  destination,
  studio
}: {
  destination: ExpressionDestination
  studio: ExpressionStudioSnapshot
}): ReactElement {
  const rendered = destinationToDashboardElement(destination, studio.expressions)
  const element = {
    ...rendered,
    x: 0,
    y: 0,
    w: 280,
    h: 130,
    binding: destination.presentation === 'status' ? 'connected' : 'speedKmh'
  }
  return (
    <div
      data-testid="expression-destination-preview"
      style={{
        position: 'relative',
        width: 280,
        height: 130,
        overflow: 'hidden',
        background: 'rgba(0,0,0,0.32)',
        borderRadius: 'var(--radius-sm)',
        pointerEvents: 'none'
      }}
    >
      {renderDashboardElement({ element, snapshot: PREVIEW_SNAPSHOT })}
    </div>
  )
}

export function ExpressionVisualizationPanel({ studio, source, onCommit, onClose }: Props): ReactElement {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<ExpressionDestination>(() => initialDestination(studio, source))
  const [error, setError] = useState<string | null>(null)
  const sourceLabel = sourceDisplayName(source, studio.expressions)

  useEffect(() => {
    setEditingId(null)
    setDraft(initialDestination(studio, source))
    setError(null)
  }, [source, studio.revision])

  const capability = studio.capabilities.find((item) => item.surface === draft.surface)
  const targets = capability?.targets ?? []
  const destinations = useMemo(
    () => studio.destinations.filter((item) =>
      'expressionId' in source
        ? 'expressionId' in item.source && item.source.expressionId === source.expressionId
        : 'variableId' in item.source && item.source.variableId === source.variableId
    ),
    [source, studio.destinations]
  )
  const statusById = useMemo(
    () => new Map(studio.destinationStatuses.map((item) => [item.destinationId, item])),
    [studio.destinationStatuses]
  )

  function chooseSurface(surface: ExpressionDestinationSurface): void {
    const nextCapability = studio.capabilities.find((item) => item.surface === surface)
    if (!nextCapability?.available) return
    const targetId = nextCapability.targets[0]?.id ?? ''
    setDraft((current) => ({
      ...current,
      surface,
      targetId,
      geometry: fitGeometry(nextCapability, targetId)
    }))
  }

  function choosePresentation(presentation: ExpressionPresentation): void {
    setDraft((current) => ({
      ...current,
      presentation,
      format: defaultFormat(presentation, current.format.label ?? sourceLabel)
    }))
  }

  async function save(): Promise<void> {
    setError(null)
    try {
      const next = editingId
        ? studio.destinations.map((item) => (item.id === editingId ? draft : item))
        : [...studio.destinations, draft]
      const enabledVars =
        'variableId' in source && !studio.enabledVars.includes(source.variableId)
          ? [...studio.enabledVars, source.variableId]
          : studio.enabledVars
      await onCommit(next, enabledVars)
      setEditingId(null)
      setDraft(initialDestination({ ...studio, destinations: next, enabledVars }, source))
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
    }
  }

  function edit(destination: ExpressionDestination): void {
    setEditingId(destination.id)
    setDraft({
      ...destination,
      source: { ...destination.source },
      geometry: { ...destination.geometry },
      format: { ...destination.format }
    })
  }

  async function remove(destinationId: string): Promise<void> {
    setError(null)
    try {
      await onCommit(studio.destinations.filter((item) => item.id !== destinationId), studio.enabledVars)
      if (editingId === destinationId) {
        setEditingId(null)
        setDraft(initialDestination(studio, source))
      }
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : String(removeError))
    }
  }

  async function toggle(destination: ExpressionDestination): Promise<void> {
    setError(null)
    try {
      await onCommit(
        studio.destinations.map((item) => item.id === destination.id ? { ...item, enabled: !item.enabled } : item),
        studio.enabledVars
      )
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : String(toggleError))
    }
  }

  const updateGeometry = (key: keyof ExpressionDestination['geometry'], value: number): void => {
    setDraft((current) => ({ ...current, geometry: { ...current.geometry, [key]: value } }))
  }
  const updateFormat = <K extends keyof ExpressionDestinationFormat>(
    key: K,
    value: ExpressionDestinationFormat[K]
  ): void => {
    setDraft((current) => ({ ...current, format: { ...current.format, [key]: value } }))
  }

  return (
    <section
      style={{
        border: '1px solid rgba(var(--accent-rgb),0.45)',
        borderRadius: 'var(--radius-sm)',
        padding: 14,
        background: 'rgba(var(--accent-rgb),0.08)',
        display: 'grid',
        gap: 14
      }}
      aria-label={`Visualize ${sourceLabel}`}
    >
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 11, opacity: 0.64, textTransform: 'uppercase', letterSpacing: 1 }}>Visualize on…</div>
          <strong>{sourceLabel}</strong>
        </div>
        <button type="button" className="ghost-action compact" onClick={onClose}>Close</button>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(120px, 1fr))', gap: 8 }}>
        {studio.capabilities.map((item) => (
          <button
            key={item.surface}
            type="button"
            disabled={!item.available}
            onClick={() => chooseSurface(item.surface)}
            title={item.reason}
            style={{
              textAlign: 'left',
              padding: 10,
              borderRadius: 'var(--radius-sm)',
              color: '#fff',
              border: draft.surface === item.surface ? '1px solid var(--accent-primary)' : '1px solid rgba(255,255,255,0.1)',
              background: draft.surface === item.surface ? 'rgba(var(--accent-rgb),0.16)' : 'rgba(0,0,0,0.2)',
              opacity: item.available ? 1 : 0.56
            }}
          >
            <strong>{SURFACE_LABELS[item.surface]}</strong>
            <span style={{ display: 'block', marginTop: 4, fontSize: 11, opacity: 0.7 }}>
              {item.available ? `${item.targets.length} target(s)` : item.reason}
            </span>
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1fr) 300px', gap: 14, alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 10 }}>
          <label>
            Exact target
            <select
              style={field}
              value={draft.targetId}
              disabled={!capability?.available || targets.length === 0}
              onChange={(event) => {
                const targetId = event.target.value
                setDraft((current) => ({
                  ...current,
                  targetId,
                  geometry: fitGeometry(capability, targetId)
                }))
              }}
            >
              {targets.length === 0 && <option value="">No target available</option>}
              {targets.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.label} · {target.id} · {target.width}×{target.height}
                </option>
              ))}
            </select>
          </label>

          <div>
            <span>Presentation</span>
            <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
              {(capability?.presentations ?? []).map((presentation) => (
                <button
                  key={presentation}
                  type="button"
                  className={draft.presentation === presentation ? 'primary-action compact' : 'ghost-action compact'}
                  onClick={() => choosePresentation(presentation)}
                >
                  {PRESENTATION_LABELS[presentation]}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {(['x', 'y', 'width', 'height'] as const).map((key) => (
              <label key={key}>
                {key}
                <input
                  type="number"
                  min={key === 'width' || key === 'height' ? 8 : 0}
                  style={field}
                  value={draft.geometry[key]}
                  onChange={(event) => updateGeometry(key, Number(event.target.value))}
                />
              </label>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(120px, 1fr))', gap: 8 }}>
            <label>
              Label
              <input style={field} value={draft.format.label ?? ''} onChange={(event) => updateFormat('label', event.target.value)} />
            </label>
            <label>
              Color
              <input style={field} value={draft.format.color ?? ''} placeholder="#35d07f" onChange={(event) => updateFormat('color', event.target.value || undefined)} />
            </label>
            {draft.presentation !== 'status' && (
              <>
                <label>
                  Prefix
                  <input style={field} value={draft.format.prefix ?? ''} onChange={(event) => updateFormat('prefix', event.target.value || undefined)} />
                </label>
                <label>
                  Suffix / unit
                  <input style={field} value={draft.format.suffix ?? ''} onChange={(event) => updateFormat('suffix', event.target.value || undefined)} />
                </label>
                <label>
                  Decimals
                  <input type="number" min={0} max={6} style={field} value={draft.format.decimals ?? 0} onChange={(event) => updateFormat('decimals', Number(event.target.value))} />
                </label>
              </>
            )}
            {(draft.presentation === 'bar' || draft.presentation === 'gauge') && (
              <>
                <label>
                  Minimum
                  <input type="number" style={field} value={draft.format.min ?? 0} onChange={(event) => updateFormat('min', Number(event.target.value))} />
                </label>
                <label>
                  Maximum
                  <input type="number" style={field} value={draft.format.max ?? 100} onChange={(event) => updateFormat('max', Number(event.target.value))} />
                </label>
              </>
            )}
            {draft.presentation === 'status' && (
              <>
                <label>
                  True text
                  <input style={field} value={draft.format.trueText ?? ''} onChange={(event) => updateFormat('trueText', event.target.value || undefined)} />
                </label>
                <label>
                  False text
                  <input style={field} value={draft.format.falseText ?? ''} onChange={(event) => updateFormat('falseText', event.target.value || undefined)} />
                </label>
              </>
            )}
          </div>

          {error && <div style={{ color: 'var(--accent-danger)' }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="primary-action compact"
              type="button"
              disabled={!capability?.available || !draft.targetId}
              onClick={() => void save()}
            >
              {editingId ? 'Update placement' : 'Add placement'}
            </button>
            {editingId && (
              <button type="button" className="ghost-action compact" onClick={() => {
                setEditingId(null)
                setDraft(initialDestination(studio, source))
              }}>
                Cancel edit
              </button>
            )}
          </div>
        </div>

        <div>
          <div style={{ fontSize: 11, opacity: 0.64, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            Real inert preview
          </div>
          <ExpressionDestinationPreview destination={draft} studio={studio} />
        </div>
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        <strong>Saved placements</strong>
        {destinations.length === 0 && <span style={{ opacity: 0.68 }}>No visualization destination for this source.</span>}
        {destinations.map((destination) => {
          const status = statusById.get(destination.id)
          return (
            <div
              key={destination.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                gap: 10,
                alignItems: 'center',
                padding: 10,
                borderRadius: 'var(--radius-sm)',
                border: '1px solid rgba(255,255,255,0.1)',
                background: 'rgba(0,0,0,0.18)'
              }}
            >
              <div>
                <strong>{SURFACE_LABELS[destination.surface]} · {PRESENTATION_LABELS[destination.presentation]}</strong>
                <code style={{ display: 'block', opacity: 0.66, marginTop: 4 }}>{destination.targetId}</code>
                <span style={{ display: 'block', opacity: 0.7, marginTop: 3 }}>
                  {status?.status ?? 'unresolved'}{status?.reason ? ` · ${status.reason}` : ''}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <button type="button" className="ghost-action compact" onClick={() => edit(destination)}>Edit</button>
                <button type="button" className="ghost-action compact" onClick={() => void toggle(destination)}>
                  {destination.enabled ? 'Disable' : 'Enable'}
                </button>
                {(destination.surface === 'dashboard' || destination.surface === 'overlay') && (
                  <button
                    type="button"
                    className="ghost-action compact"
                    onClick={() => navigateToEditor(
                      destination.surface === 'dashboard' ? 'dashboard' : 'overlay',
                      destination.targetId
                    )}
                  >
                    Open in editor
                  </button>
                )}
                <button type="button" className="ghost-action danger compact" onClick={() => void remove(destination.id)}>Remove</button>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
