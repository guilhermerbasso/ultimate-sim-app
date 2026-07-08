import { type CSSProperties, type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_SEMANTIC_SOURCES,
  SEMANTIC_SOURCE_LABELS,
  type SemanticIndexStatus,
  type SemanticModelProgress,
  type SemanticSearchResult,
  type SemanticSourceKind
} from '../../../shared/semantic-search-ipc'
import {
  ensureSearchModel,
  getSearchStatus,
  onModelProgress,
  onStatusChanged,
  reindexSearch,
  runSearch
} from '../lib/semantic-search'
import type { AppViewProps } from '../App'

// ─── Style kit — warm chrome; cool (teal/green) accents the semantic mode ─────

const card: CSSProperties = {
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 'var(--radius-sm)',
  padding: '14px 16px'
}
const label: CSSProperties = { fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', opacity: 0.6 }
const row: CSSProperties = { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }
const input: CSSProperties = {
  flex: 1,
  minWidth: 200,
  background: 'rgba(0,0,0,0.25)',
  border: '1px solid rgba(255,255,255,0.14)',
  borderRadius: 'var(--radius-sm)',
  color: '#fff',
  padding: '9px 11px',
  fontSize: 14
}
const button: CSSProperties = {
  padding: '7px 12px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid rgba(255,255,255,0.14)',
  background: 'transparent',
  color: '#fff',
  cursor: 'pointer',
  fontSize: 12
}
const primaryButton: CSSProperties = {
  ...button,
  border: '1px solid rgba(var(--accent-rgb),0.55)',
  background: 'rgba(var(--accent-rgb),0.16)'
}

const SOURCE_TONE: Record<SemanticSourceKind, string> = {
  setup: 'var(--accent-success)',
  ghost: 'var(--accent-success)',
  telemetry: 'var(--accent-success)',
  'driver-note': 'var(--accent-primary)',
  'coach-finding': 'var(--accent-primary)',
  'engineer-note': 'var(--accent-primary)'
}

const ALL_SOURCES: SemanticSourceKind[] = ['setup', 'ghost', 'telemetry', 'driver-note', 'coach-finding', 'engineer-note']

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function formatBytes(n: number): string {
  if (!n || n <= 0) return ''
  const mb = n / (1024 * 1024)
  return mb >= 1 ? `${mb.toFixed(0)} MB` : `${(n / 1024).toFixed(0)} KB`
}

export default function SemanticSearchView({ showToast }: AppViewProps): ReactElement {
  const [status, setStatus] = useState<SemanticIndexStatus | null>(null)
  const [progress, setProgress] = useState<SemanticModelProgress | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SemanticSearchResult[]>([])
  const [mode, setMode] = useState<'semantic' | 'keyword'>('keyword')
  const [searching, setSearching] = useState(false)
  const [filters, setFilters] = useState<Set<SemanticSourceKind>>(new Set())
  const debounceRef = useRef<number | null>(null)

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await getSearchStatus())
    } catch {
      // keep last known status
    }
  }, [])

  useEffect(() => {
    void refreshStatus()
    const offStatus = onStatusChanged((s) => setStatus(s))
    const offProgress = onModelProgress((p) => {
      setProgress(p)
      if (p.phase === 'ready' || p.phase === 'error' || p.phase === 'unavailable') void refreshStatus()
    })
    return () => {
      offStatus()
      offProgress()
    }
  }, [refreshStatus])

  const doSearch = useCallback(
    async (q: string, active: Set<SemanticSourceKind>) => {
      const trimmed = q.trim()
      if (!trimmed) {
        setResults([])
        return
      }
      setSearching(true)
      try {
        const sources = active.size ? [...active] : undefined
        const res = await runSearch({ query: trimmed, sources, limit: 30 })
        setResults(res.results)
        setMode(res.mode)
      } catch (e) {
        showToast(`Busca falhou: ${errorMessage(e)}`, 'error')
      } finally {
        setSearching(false)
      }
    },
    [showToast]
  )

  // Debounced live search as the user types.
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => void doSearch(query, filters), 220)
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current)
    }
  }, [query, filters, doSearch])

  const onDownloadModel = useCallback(async () => {
    setProgress({ phase: 'downloading', loadedBytes: 0, totalBytes: 0, ratio: 0 })
    try {
      const next = await ensureSearchModel()
      setStatus(next)
      if (next.modelReady) {
        showToast('Semantic search model ready.', 'success')
        void doSearch(query, filters)
      }
    } catch (e) {
      showToast(`Download falhou: ${errorMessage(e)}`, 'error')
    }
  }, [doSearch, filters, query, showToast])

  const onReindex = useCallback(async () => {
    try {
      setStatus(await reindexSearch())
      showToast('Search index updated.', 'success')
      void doSearch(query, filters)
    } catch (e) {
      showToast(`Reindexing failed: ${errorMessage(e)}`, 'error')
    }
  }, [doSearch, filters, query, showToast])

  const toggleFilter = useCallback((kind: SemanticSourceKind) => {
    setFilters((prev) => {
      const next = new Set(prev)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })
  }, [])

  const sources = status?.sources ?? DEFAULT_SEMANTIC_SOURCES
  const downloading = progress?.phase === 'downloading' || progress?.phase === 'loading' || status?.modelDownloading
  const ratioPct = Math.round((progress?.ratio ?? 0) * 100)

  const modeBadge = useMemo(() => {
    if (mode === 'semantic') {
      return { text: 'Semantic', tone: 'var(--accent-success)', bg: 'rgba(var(--accent-success-rgb,73,197,177),0.14)' }
    }
    return { text: 'Palavra-chave', tone: 'var(--accent-primary)', bg: 'rgba(var(--accent-rgb),0.14)' }
  }, [mode])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <section style={card}>
        <div style={label}>Semantic search</div>
        <h2 style={{ margin: '4px 0 10px' }}>Encontre setups, ghosts, notas e achados</h2>

        <div style={row}>
          <input
            style={input}
            type="search"
            placeholder="Ex.: setup macio para chuva em Interlagos, freada tardia na curva 1…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Termo de busca"
          />
          <span
            style={{
              ...label,
              opacity: 1,
              color: modeBadge.tone,
              background: modeBadge.bg,
              padding: '5px 9px',
              borderRadius: 'var(--radius-sm)'
            }}
            title={mode === 'semantic' ? 'Results by meaning similarity' : 'Keyword results (model missing or no semantic match)'}
          >
            {modeBadge.text}
          </span>
        </div>

        <div style={{ ...row, marginTop: 10, gap: 6 }}>
          {ALL_SOURCES.map((kind) => {
            const active = filters.has(kind)
            const count = sources[kind] ?? 0
            return (
              <button
                key={kind}
                type="button"
                onClick={() => toggleFilter(kind)}
                style={{
                  ...button,
                  padding: '4px 9px',
                  opacity: count === 0 ? 0.4 : 1,
                  borderColor: active ? SOURCE_TONE[kind] : 'rgba(255,255,255,0.14)',
                  background: active ? 'rgba(255,255,255,0.06)' : 'transparent'
                }}
              >
                {SEMANTIC_SOURCE_LABELS[kind]} {count > 0 ? `· ${count}` : ''}
              </button>
            )
          })}
        </div>
      </section>

      {/* Model panel ─────────────────────────────────────────────────────── */}
      <section style={card}>
        <div style={{ ...row, justifyContent: 'space-between' }}>
          <div>
            <div style={label}>Modelo de embeddings</div>
            <div style={{ marginTop: 4, fontSize: 13 }}>
              {status?.modelReady ? (
                <span style={{ color: 'var(--accent-success)' }}>● Modelo ativo — busca por significado habilitada</span>
              ) : downloading ? (
                <span style={{ color: 'var(--accent-primary)' }}>● Lowndo/carregando modelo… {ratioPct}%</span>
              ) : status && !status.modelAvailable ? (
                <span style={{ opacity: 0.8 }}>○ Pacote de IA no instalado — using busca por palavra-chave</span>
              ) : (
                <span style={{ opacity: 0.8 }}>○ Modelo no baixado — using busca por palavra-chave</span>
              )}
            </div>
          </div>
          <div style={row}>
            {!status?.modelReady && status?.modelAvailable !== false ? (
              <button style={primaryButton} type="button" disabled={!!downloading} onClick={() => void onDownloadModel()}>
                {downloading ? `Lowndo ${ratioPct}%` : `Lowr modelo (${status?.modelSizeLabel ?? '~470 MB'})`}
              </button>
            ) : null}
            <button style={button} type="button" onClick={() => void onReindex()}>
              Reindexar
            </button>
          </div>
        </div>

        {downloading ? (
          <div style={{ marginTop: 10 }}>
            <div style={{ height: 6, borderRadius: 4, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${ratioPct}%`,
                  background: 'var(--accent-primary)',
                  transition: 'width 200ms ease'
                }}
              />
            </div>
            <small style={{ opacity: 0.6 }}>
              {progress?.file ? `${progress.file} · ` : ''}
              {progress?.totalBytes ? `${formatBytes(progress.loadedBytes)} / ${formatBytes(progress.totalBytes)}` : 'preparando…'}
            </small>
          </div>
        ) : null}

        <p style={{ opacity: 0.6, margin: '10px 0 0', fontSize: 12 }}>
          100% offline e open-source (Transformers.js, CPU). O download é sob demanda e fica em cache. Without the model, search
          continua funcionando por palavra-chave/fuzzy.
        </p>
      </section>

      {/* Results ─────────────────────────────────────────────────────────── */}
      <section style={{ ...card, padding: results.length ? '8px 8px' : '14px 16px' }}>
        {searching && results.length === 0 ? (
          <p style={{ opacity: 0.7, margin: '6px 8px' }}>Buscando…</p>
        ) : results.length === 0 ? (
          <p style={{ opacity: 0.7, margin: 0 }}>
            {query.trim()
              ? 'No results. Try other terms, reindex, or download the model for meaning-based search.'
              : 'Digite algo para buscar nos seus setups, ghosts, notas de pilotos e achados do Coach/Engenheiro.'}
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {results.map((r) => (
              <ResultRow key={`${r.source}:${r.id}`} result={r} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function ResultRow({ result }: { result: SemanticSearchResult }): ReactElement {
  const tone = SOURCE_TONE[result.source]
  const pct = Math.round(result.score * 100)
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '10px 12px',
        borderBottom: '1px solid rgba(255,255,255,0.06)'
      }}
    >
      <div style={{ ...row, gap: 8, justifyContent: 'space-between' }}>
        <div style={{ ...row, gap: 8, minWidth: 0 }}>
          <span style={{ ...label, opacity: 1, color: tone }}>{SEMANTIC_SOURCE_LABELS[result.source]}</span>
          <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{result.title}</strong>
        </div>
        <div style={{ ...row, gap: 6, flexShrink: 0 }}>
          <div style={{ width: 60, height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: tone }} />
          </div>
          <small style={{ opacity: 0.7, width: 34, textAlign: 'right' }}>{pct}%</small>
        </div>
      </div>
      <small style={{ opacity: 0.75 }}>{result.snippet}</small>
    </div>
  )
}
