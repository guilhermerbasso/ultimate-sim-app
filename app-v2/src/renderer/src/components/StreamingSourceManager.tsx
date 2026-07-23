import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import {
  STREAM_SOURCE_CHANNELS,
  type StreamSourceDescriptor,
  type StreamSourceMutationRequest
} from '../../../shared/stream-sources'
import { tt, type ResolvedLanguage } from '../i18n'
import { navigateToView } from '../lib/app-navigation'
import './streaming-source-manager.css'

export interface StreamingSourceManagerProps {
  language?: ResolvedLanguage
  onSourcesChanged?(sources: StreamSourceDescriptor[]): void
  onMutationStateChange?(mutating: boolean): void
}

function sourceKey(source: Pick<StreamSourceDescriptor, 'kind' | 'id'>): string {
  return `${source.kind}:${source.id}`
}

function sourceStateKey(source: StreamSourceDescriptor): string {
  if (source.active) return 'streaming.sources.state.active'
  if (source.reason === 'missing') return 'streaming.sources.state.missing'
  if (source.reason === 'hidden') return 'streaming.sources.state.hidden'
  if (source.reason === 'built-in') return 'streaming.sources.state.builtIn'
  if (source.reason === 'invalid-id') return 'streaming.sources.state.ineligible'
  if (source.added) return 'streaming.sources.state.added'
  return 'streaming.sources.state.available'
}

export default function StreamingSourceManager({
  language,
  onSourcesChanged,
  onMutationStateChange
}: StreamingSourceManagerProps): ReactElement {
  const [sources, setSources] = useState<StreamSourceDescriptor[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const applySources = useCallback((value: unknown): StreamSourceDescriptor[] => {
    const next = Array.isArray(value) ? value as StreamSourceDescriptor[] : []
    setSources(next)
    onSourcesChanged?.(next)
    return next
  }, [onSourcesChanged])

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      applySources(await window.ipc.invoke<StreamSourceDescriptor[]>(STREAM_SOURCE_CHANNELS.list))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : tt(language, 'streaming.sources.errorLoad'))
    } finally {
      setLoading(false)
    }
  }, [applySources, language])

  useEffect(() => {
    void refresh()
    const unsubscribe = window.ipc.subscribe<StreamSourceDescriptor[]>(
      STREAM_SOURCE_CHANNELS.updated,
      applySources
    )
    return unsubscribe
  }, [applySources, refresh])

  const filteredSources = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) return sources
    return sources.filter((source) =>
      source.label.toLocaleLowerCase().includes(normalized) ||
      source.id.toLocaleLowerCase().includes(normalized) ||
      source.kind.includes(normalized) ||
      tt(language, sourceStateKey(source)).toLocaleLowerCase().includes(normalized)
    )
  }, [language, query, sources])

  async function mutate(
    channel: typeof STREAM_SOURCE_CHANNELS.add | typeof STREAM_SOURCE_CHANNELS.remove,
    source: StreamSourceDescriptor
  ): Promise<void> {
    const key = sourceKey(source)
    setBusyKey(key)
    onMutationStateChange?.(true)
    setError(null)
    const request: StreamSourceMutationRequest = { kind: source.kind, id: source.id }
    try {
      applySources(await window.ipc.invoke<StreamSourceDescriptor[]>(channel, request))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : tt(language, 'streaming.sources.errorSave'))
    } finally {
      setBusyKey(null)
      onMutationStateChange?.(false)
    }
  }

  return (
    <section className="stream-source-manager" aria-labelledby="stream-source-manager-title" aria-busy={loading}>
      <div className="stream-source-manager__header">
        <div>
          <h5 id="stream-source-manager-title">{tt(language, 'streaming.sources.title')}</h5>
          <p>{tt(language, 'streaming.sources.help')}</p>
        </div>
        <button className="ghost-action" type="button" disabled={loading} onClick={() => void refresh()}>
          {tt(language, 'streaming.sources.refresh')}
        </button>
      </div>

      {error ? <div className="stream-source-manager__error" role="alert">{error}</div> : null}

      {!loading && sources.length === 0 ? (
        <div className="stream-source-manager__empty" role="status">
          <strong>{tt(language, 'streaming.sources.emptyTitle')}</strong>
          <p>{tt(language, 'streaming.sources.emptyHelp')}</p>
          <div className="stream-source-manager__actions">
            <button className="ghost-action" type="button" onClick={() => navigateToView('dashboards')}>
              {tt(language, 'streaming.targets.openDashboards')}
            </button>
            <button className="ghost-action" type="button" onClick={() => navigateToView('touch-controls')}>
              {tt(language, 'streaming.targets.openTouch')}
            </button>
            <button className="ghost-action" type="button" onClick={() => void refresh()}>
              {tt(language, 'streaming.sources.refresh')}
            </button>
          </div>
        </div>
      ) : null}

      {sources.length > 0 ? (
        <>
          <label className="stream-source-manager__search">
            <span>{tt(language, 'streaming.sources.search')}</span>
            <input
              type="search"
              value={query}
              placeholder={tt(language, 'streaming.sources.searchPlaceholder')}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </label>
          <ul className="stream-source-manager__list" aria-label={tt(language, 'streaming.sources.listLabel')}>
            {filteredSources.map((source) => {
              const key = sourceKey(source)
              return (
                <li key={key} className={`stream-source-manager__item ${source.active ? 'is-active' : ''}`}>
                  <div className="stream-source-manager__identity">
                    <strong>{source.label}</strong>
                    <small>
                      {tt(language, source.kind === 'dashboard' ? 'streaming.target.dashboard' : 'streaming.target.touch')}
                      {' · '}
                      {source.id}
                    </small>
                  </div>
                  <span className={`stream-source-manager__state is-${source.reason ?? (source.active ? 'active' : source.added ? 'added' : 'available')}`}>
                    {tt(language, sourceStateKey(source))}
                  </span>
                  {source.added ? (
                    <button
                      className="ghost-action danger"
                      type="button"
                      disabled={busyKey !== null}
                      onClick={() => void mutate(STREAM_SOURCE_CHANNELS.remove, source)}
                    >
                      {source.active
                        ? tt(language, 'streaming.sources.removeActive')
                        : tt(language, 'streaming.sources.remove')}
                    </button>
                  ) : (
                    <button
                      className="primary-action"
                      type="button"
                      disabled={busyKey !== null || !source.eligible}
                      onClick={() => void mutate(STREAM_SOURCE_CHANNELS.add, source)}
                    >
                      {tt(language, 'streaming.sources.add')}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
          {filteredSources.length === 0 ? (
            <p className="stream-source-manager__no-results" role="status">
              {tt(language, 'streaming.sources.noResults')}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
