import { type CSSProperties, type ReactElement, useCallback, useEffect, useMemo, useState } from 'react'
import {
  COMMUNITY_CHANNELS,
  type CommunityExportOptions,
  type CommunityExportResult,
  type CommunityImportResult,
  type CommunityStatus,
  type GhostCompareBin,
  type GhostCompareReport,
  type SharePackSummary
} from '../../../shared/community'
import type { AppViewProps } from '../App'
import { tt, type ResolvedLanguage } from '../i18n'
import ThirdPartyDashboardCatalog from '../components/ThirdPartyDashboardCatalog'

// ─── Warm-chrome style kit (cool/green is reserved for "faster than ghost") ───

const card: CSSProperties = {
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 'var(--radius-sm)',
  padding: '14px 16px'
}
const label: CSSProperties = { fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', opacity: 0.6 }
const row: CSSProperties = { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }
const input: CSSProperties = {
  background: 'rgba(0,0,0,0.25)',
  border: '1px solid rgba(255,255,255,0.14)',
  borderRadius: 'var(--radius-sm)',
  color: '#fff',
  padding: '7px 9px'
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
const fasterText: CSSProperties = { color: 'var(--accent-success)' }
const slowerText: CSSProperties = { color: 'var(--accent-primary)' }

const KIND_LABEL_KEY: Record<string, string> = { ghost: 'community.kind.ghost', telemetry: 'community.kind.telemetry', setup: 'community.kind.setup' }
type CommunitySourceSim = 'iracing' | 'acc' | 'ac' | 'ams2' | 'lmu'
type CommunitySourceKind = 'telemetry' | 'setup' | 'community'

interface CommunitySource {
  id: string
  sim: CommunitySourceSim
  kind: CommunitySourceKind
  name: string
  url: string
  description: string
}

const COMMUNITY_SOURCE_CHANNELS = {
  list: 'community:sources:list',
  add: 'community:sources:add',
  remove: 'community:sources:remove',
  reset: 'community:sources:reset'
} as const

const SIM_LABEL: Record<CommunitySourceSim, string> = {
  iracing: 'iRacing',
  acc: 'ACC',
  ac: 'Assetto Colorsa',
  ams2: 'Automobilista 2',
  lmu: 'Le Mans Ultimate'
}

const SOURCE_KIND_LABEL: Record<CommunitySourceKind, string> = {
  telemetry: 'Telemetry',
  setup: 'Setup',
  community: 'Community'
}

const SIMS = Object.keys(SIM_LABEL) as CommunitySourceSim[]
const EMPTY_SOURCE_FORM: Omit<CommunitySource, 'id'> = {
  sim: 'iracing',
  kind: 'telemetry',
  name: '',
  url: 'https://',
  description: ''
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function formatLapTime(sec?: number): string {
  if (sec === undefined || !Number.isFinite(sec) || sec <= 0) return '--:--'
  const m = Math.floor(sec / 60)
  const s = sec - m * 60
  return `${m}:${s.toFixed(3).padStart(6, '0')}`
}

function formatDelta(sec: number): string {
  if (!Number.isFinite(sec)) return '--'
  const sign = sec > 0 ? '+' : sec < 0 ? '−' : ''
  return `${sign}${Math.abs(sec).toFixed(3)}s`
}

function formatDate(ms: number): string {
  try {
    return new Date(ms).toLocaleString()
  } catch {
    return '—'
  }
}

function summaryLabel(summary: SharePackSummary, language?: ResolvedLanguage): string {
  const bits = [summary.track, summary.car].filter(Boolean)
  return bits.join(' · ') || summary.author || summary.kind || 'Pack'
}

// Cumulative delta ribbon. Bars BELOW the centre line + green = you are faster
// than the ghost here; bars ABOVE + warm orange = you are slower. Everything else
// stays warm chrome on purpose.
function DeltaTrace({ bins, language }: { bins: GhostCompareBin[]; language?: ResolvedLanguage }): ReactElement {
  const points = useMemo(() => {
    if (bins.length === 0) return [] as GhostCompareBin[]
    const target = 160
    const step = Math.max(1, Math.floor(bins.length / target))
    return bins.filter((_, i) => i % step === 0)
  }, [bins])

  const maxAbs = useMemo(
    () => Math.max(0.05, ...points.map((p) => Math.abs(p.deltaSec))),
    [points]
  )

  if (points.length === 0) {
    return <div style={{ opacity: 0.6, padding: 12 }}>{tt(language, 'community.noComparisonData')}</div>
  }

  const width = 100 / points.length
  return (
    <svg
      viewBox="0 0 100 40"
      preserveAspectRatio="none"
      role="img"
      aria-label={tt(language, 'community.deltaAria')}
      style={{ width: '100%', height: 120, background: 'var(--surface-sunken)', borderRadius: 'var(--radius-sm)' }}
    >
      <line x1={0} y1={20} x2={100} y2={20} stroke="rgba(255,255,255,0.2)" strokeWidth={0.25} />
      {points.map((p, i) => {
        const h = (p.deltaSec / maxAbs) * 18
        const faster = p.deltaSec < 0
        const magnitude = Math.max(0.25, Math.abs(h))
        return (
          <rect
            key={i}
            x={p.lapDistPct * 100}
            y={faster ? 20 : 20 - magnitude}
            width={Math.max(width, 0.4)}
            height={magnitude}
            fill={faster ? 'var(--accent-success)' : 'var(--accent-primary)'}
            opacity={0.85}
          />
        )
      })}
    </svg>
  )
}

export default function CommunityView({ showToast, language }: AppViewProps): ReactElement {
  const [status, setStatus] = useState<CommunityStatus | null>(null)
  const [imported, setImported] = useState<SharePackSummary[]>([])
  const [note, setNote] = useState('')
  const [author, setAuthor] = useState('')
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<GhostCompareReport | null>(null)
  const [baselineId, setBaselineId] = useState('')
  const [communitySources, setCommunitySources] = useState<CommunitySource[]>([])
  const [sourceForm, setSourceForm] = useState<Omit<CommunitySource, 'id'>>({ ...EMPTY_SOURCE_FORM })

  const exportOpts = useCallback((): CommunityExportOptions => ({ note: note.trim() || undefined, author: author.trim() || undefined }), [note, author])

  const refreshStatus = useCallback(async (): Promise<void> => {
    try {
      setStatus(await window.ipc.invoke<CommunityStatus>(COMMUNITY_CHANNELS.status))
    } catch {
      // status is best-effort; ignore transient errors
    }
  }, [])

  const refreshList = useCallback(async (): Promise<void> => {
    try {
      setImported(await window.ipc.invoke<SharePackSummary[]>(COMMUNITY_CHANNELS.listLocal))
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    }
  }, [showToast])

  const refreshSources = useCallback(async (): Promise<void> => {
    try {
      setCommunitySources(await window.ipc.invoke<CommunitySource[]>(COMMUNITY_SOURCE_CHANNELS.list))
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    }
  }, [showToast])

  useEffect(() => {
    void refreshStatus()
    void refreshList()
    void refreshSources()
    const offChanged = window.ipc.subscribe(COMMUNITY_CHANNELS.changed, () => {
      void refreshList()
      void refreshStatus()
    })
    const timer = window.setInterval(() => void refreshStatus(), 2000)
    return () => {
      offChanged()
      window.clearInterval(timer)
    }
  }, [refreshList, refreshSources, refreshStatus])

  const ghostImports = useMemo(() => imported.filter((pack) => pack.kind === 'ghost'), [imported])

  async function runExport(channel: string, kind: string): Promise<void> {
    setBusy(true)
    try {
      const result = await window.ipc.invoke<CommunityExportResult>(channel, exportOpts())
      if (result.canceled) return
      showToast(tt(language, 'community.exported', { kind }), 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function runImport(): Promise<void> {
    setBusy(true)
    try {
      const result = await window.ipc.invoke<CommunityImportResult>(COMMUNITY_CHANNELS.import)
      if (result.canceled) return
      showToast(tt(language, 'community.imported', { summary: result.summary ? summaryLabel(result.summary, language) : tt(language, 'community.kind.pack') }), 'success')
      await refreshList()
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function compareTo(targetId: string): Promise<void> {
    setBusy(true)
    try {
      const baseline = baselineId || undefined
      const next = await window.ipc.invoke<GhostCompareReport>(COMMUNITY_CHANNELS.compareTo, targetId, baseline)
      setReport(next)
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string): Promise<void> {
    try {
      await window.ipc.invoke<boolean>(COMMUNITY_CHANNELS.delete, id)
      if (report?.targetId === id) setReport(null)
      await refreshList()
      showToast(tt(language, 'community.packRemoved'), 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    }
  }

  async function addSource(): Promise<void> {
    setBusy(true)
    try {
      const saved = await window.ipc.invoke<CommunitySource[]>(COMMUNITY_SOURCE_CHANNELS.add, sourceForm)
      setCommunitySources(saved)
      setSourceForm({ ...EMPTY_SOURCE_FORM })
      showToast(tt(language, 'community.sourceAdded'), 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function removeSource(id: string): Promise<void> {
    try {
      setCommunitySources(await window.ipc.invoke<CommunitySource[]>(COMMUNITY_SOURCE_CHANNELS.remove, id))
      showToast(tt(language, 'community.sourceRemoved'), 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    }
  }

  async function resetSources(): Promise<void> {
    try {
      setCommunitySources(await window.ipc.invoke<CommunitySource[]>(COMMUNITY_SOURCE_CHANNELS.reset))
      showToast(tt(language, 'community.sourcesRestored'), 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    }
  }

  const liveReady = status?.liveGhostReady ?? false

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ ...card, display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <div style={label}>{tt(language, 'community.eyebrow')}</div>
          <h3 style={{ margin: '4px 0 0' }}>{tt(language, 'community.title')}</h3>
          <p style={{ margin: '6px 0 0', opacity: 0.72, maxWidth: 720 }}>
            {tt(language, 'community.help')}
          </p>
        </div>
      </div>

      <section style={card}>
        <div style={{ ...row, justifyContent: 'space-between' }}>
          <div>
            <div style={label}>{tt(language, 'community.sourcesEyebrow')}</div>
            <h3 style={{ margin: '4px 0 0' }}>{tt(language, 'community.sourcesTitle')}</h3>
            <p style={{ margin: '6px 0 0', opacity: 0.72, maxWidth: 760 }}>
              {tt(language, 'community.sourcesHelp')}
            </p>
          </div>
          <button style={button} type="button" disabled={busy} onClick={() => void resetSources()}>
            {tt(language, 'community.restoreDefaults')}
          </button>
        </div>

        <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
          {SIMS.map((yes) => {
            const sources = communitySources.filter((source) => source.sim === yes)
            return (
              <div key={yes} style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 'var(--radius-sm)', padding: 10 }}>
                <div style={{ ...label, opacity: 0.85 }}>{SIM_LABEL[yes]}</div>
                <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                  {sources.map((source) => (
                    <div key={source.id} style={{ ...row, justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ ...row, gap: 8 }}>
                          <span style={{ ...label, opacity: 0.8 }}>{tt(language, `community.sourceKind.${source.kind}`)}</span>
                          <a href={source.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>
                            {source.name}
                          </a>
                        </div>
                        <small style={{ opacity: 0.66 }}>{source.description || source.url}</small>
                      </div>
                      <button style={button} type="button" onClick={() => void removeSource(source.id)}>
                        {tt(language, 'common.remove')}
                      </button>
                    </div>
                  ))}
                  {sources.length === 0 && <small style={{ opacity: 0.62 }}>{tt(language, 'community.noSource')}</small>}
                </div>
              </div>
            )
          })}
        </div>

        <div style={{ ...row, marginTop: 12, alignItems: 'stretch' }}>
          <select
            style={input}
            value={sourceForm.sim}
            onChange={(e) => setSourceForm((current) => ({ ...current, sim: e.currentTarget.value as CommunitySourceSim }))}
          >
            {SIMS.map((yes) => (
              <option key={yes} value={yes}>{SIM_LABEL[yes]}</option>
            ))}
          </select>
          <select
            style={input}
            value={sourceForm.kind}
            onChange={(e) => setSourceForm((current) => ({ ...current, kind: e.currentTarget.value as CommunitySourceKind }))}
          >
            {(Object.keys(SOURCE_KIND_LABEL) as CommunitySourceKind[]).map((kind) => (
              <option key={kind} value={kind}>{tt(language, `community.sourceKind.${kind}`)}</option>
            ))}
          </select>
          <input style={{ ...input, flex: 1, minWidth: 160 }} value={sourceForm.name} onChange={(e) => setSourceForm((current) => ({ ...current, name: e.currentTarget.value }))} placeholder={tt(language, 'community.sourceNamePlaceholder')} />
          <input style={{ ...input, flex: 2, minWidth: 240 }} value={sourceForm.url} onChange={(e) => setSourceForm((current) => ({ ...current, url: e.currentTarget.value }))} placeholder="https://…" />
          <input style={{ ...input, flex: 2, minWidth: 220 }} value={sourceForm.description} onChange={(e) => setSourceForm((current) => ({ ...current, description: e.currentTarget.value }))} placeholder={tt(language, 'community.sourceDescriptionPlaceholder')} />
          <button style={primaryButton} type="button" disabled={busy} onClick={() => void addSource()}>
            {tt(language, 'community.addSource')}
          </button>
        </div>
      </section>

      <ThirdPartyDashboardCatalog onError={(message) => showToast(message, 'error')} />

      <section style={card}>
        <div style={label}>{tt(language, 'community.liveCapture')}</div>
        <div style={{ ...row, justifyContent: 'space-between', marginTop: 8 }}>
          <div>
            <strong>{status?.car || status?.track ? [status?.track, status?.car].filter(Boolean).join(' · ') : tt(language, 'community.noTelemetry')}</strong>
            <div style={{ opacity: 0.72, fontSize: 12, marginTop: 2 }}>
              {tt(language, 'community.lastCapturedLap')}{' '}
              {liveReady ? (
                <span style={fasterText}>{formatLapTime(status?.liveLapTimeSec)} · {tt(language, 'community.samples', { count: status?.liveSampleCount ?? 0 })}</span>
              ) : (
                <span style={{ opacity: 0.7 }}>{tt(language, 'community.noCompleteLap')}</span>
              )}
              {status?.telemetryReady ? <span style={{ opacity: 0.6 }}> · {tt(language, 'community.telemetrySamples', { count: status.telemetrySampleCount })}</span> : null}
            </div>
          </div>
        </div>

        <div style={{ ...row, marginTop: 12 }}>
          <input style={{ ...input, flex: 1, minWidth: 180 }} value={author} onChange={(e) => setAuthor(e.target.value)} placeholder={tt(language, 'community.authorPlaceholder')} />
          <input style={{ ...input, flex: 2, minWidth: 220 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder={tt(language, 'community.notePlaceholder')} />
        </div>

        <div style={{ ...row, marginTop: 12 }}>
          <button style={primaryButton} type="button" disabled={busy || !liveReady} onClick={() => void runExport(COMMUNITY_CHANNELS.exportGhost, tt(language, 'community.kind.ghost'))}>
            {tt(language, 'community.exportMyLap')}
          </button>
          <button style={button} type="button" disabled={busy || !status?.telemetryReady} onClick={() => void runExport(COMMUNITY_CHANNELS.exportTelemetry, tt(language, 'community.kind.telemetry'))}>
            {tt(language, 'community.exportTelemetry')}
          </button>
          <button style={button} type="button" disabled={busy} onClick={() => void runExport(COMMUNITY_CHANNELS.exportSetup, tt(language, 'community.kind.setup'))}>
            {tt(language, 'community.exportSetup')}
          </button>
          <span style={{ flex: 1 }} />
          <button style={primaryButton} type="button" disabled={busy} onClick={() => void runImport()}>
            {tt(language, 'community.importSimshare')}
          </button>
        </div>
      </section>

      <section style={card}>
        <div style={{ ...row, justifyContent: 'space-between' }}>
          <div>
            <div style={label}>{tt(language, 'community.importedTitle')}</div>
            <h3 style={{ margin: '4px 0 0' }}>{tt(language, 'community.localLibraryCount', { count: imported.length })}</h3>
          </div>
          <label style={row}>
            <span style={{ fontSize: 12, opacity: 0.7 }}>{tt(language, 'community.compareUsing')}</span>
            <select style={input} value={baselineId} onChange={(e) => setBaselineId(e.target.value)}>
              <option value="">{tt(language, 'community.myLiveLap')}</option>
              {ghostImports.map((pack) => (
                <option key={pack.id} value={pack.id}>{summaryLabel(pack)} · {formatLapTime(pack.lapTimeSec)}</option>
              ))}
            </select>
          </label>
        </div>

        <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
          {imported.map((pack) => (
            <div key={pack.id} style={{ ...row, justifyContent: 'space-between', padding: 10, border: '1px solid rgba(255,255,255,0.08)', borderRadius: 'var(--radius-sm)' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ ...row, gap: 8 }}>
                  <span style={{ ...label, opacity: 0.8 }}>{tt(language, KIND_LABEL_KEY[pack.kind] ?? 'community.kind.pack')}</span>
                  <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summaryLabel(pack, language)}</strong>
                  {pack.kind === 'ghost' ? <span style={{ opacity: 0.8 }}>· {formatLapTime(pack.lapTimeSec)}</span> : null}
                </div>
                <small style={{ opacity: 0.6 }}>
                  {pack.author ? `${pack.author} · ` : ''}
                  {formatDate(pack.createdAt)}
                  {pack.note ? ` · "${pack.note}"` : ''}
                </small>
              </div>
              <div style={row}>
                {pack.kind === 'ghost' ? (
                  <button style={button} type="button" disabled={busy || (!baselineId && !liveReady)} onClick={() => void compareTo(pack.id)}>
                    {tt(language, 'community.compare')}
                  </button>
                ) : null}
                <button style={{ ...button, borderColor: 'rgba(var(--danger-rgb,196,26,26),0.4)' }} type="button" onClick={() => void remove(pack.id)}>
                  {tt(language, 'community.delete')}
                </button>
              </div>
            </div>
          ))}
          {imported.length === 0 && (
            <p style={{ opacity: 0.7, margin: 0 }}>{tt(language, 'community.noImported')}</p>
          )}
        </div>
        {!liveReady && !baselineId ? (
          <p style={{ opacity: 0.6, marginTop: 10, fontSize: 12 }}>
            {tt(language, 'community.compareHint')}
          </p>
        ) : null}
      </section>

      {report ? <ComparePanel language={language} report={report} onClose={() => setReport(null)} /> : null}
    </div>
  )
}

function ComparePanel({ language, report, onClose }: { language: ResolvedLanguage | undefined; report: GhostCompareReport; onClose: () => void }): ReactElement {
  const { result } = report
  const faster = result.totalDeltaSec < 0
  return (
    <section style={{ ...card, borderColor: faster ? 'rgba(26,138,58,0.45)' : 'rgba(var(--accent-rgb),0.4)' }}>
      <div style={{ ...row, justifyContent: 'space-between' }}>
        <div>
          <div style={label}>{tt(language, 'community.ghostComparison')}</div>
          <h3 style={{ margin: '4px 0 0' }}>
            {report.baselineLabel} <span style={{ opacity: 0.6 }}>{tt(language, 'community.vs')}</span> {report.targetLabel}
          </h3>
        </div>
        <button style={button} type="button" onClick={onClose}>{tt(language, 'common.close')}</button>
      </div>

      <div style={{ ...row, gap: 18, marginTop: 12 }}>
        <Metric title={tt(language, 'community.totalDelta')} value={formatDelta(result.totalDeltaSec)} tone={faster ? 'faster' : 'slower'} hint={faster ? tt(language, 'community.youFaster') : tt(language, 'community.youSlower')} />
        <Metric title={tt(language, 'community.timeGained')} value={`-${result.gainSec.toFixed(3)}s`} tone="faster" />
        <Metric title={tt(language, 'community.timeLost')} value={`+${result.lossSec.toFixed(3)}s`} tone="slower" />
        <Metric title={tt(language, 'community.yourLap')} value={formatLapTime(result.lapTimeASec)} tone="neutral" />
        <Metric title={tt(language, 'community.ghost')} value={formatLapTime(result.lapTimeBSec)} tone="neutral" />
      </div>

      <div style={{ marginTop: 14 }}>
        <DeltaTrace bins={result.bins} language={language} />
        <div style={{ ...row, justifyContent: 'space-between', marginTop: 6, fontSize: 11, opacity: 0.7 }}>
          <span>{tt(language, 'community.lapStart')}</span>
          <span><span style={fasterText}>■</span> {tt(language, 'community.faster')} &nbsp; <span style={slowerText}>■</span> {tt(language, 'community.slower')}</span>
          <span>{tt(language, 'community.lapEnd')}</span>
        </div>
      </div>

      <div style={{ ...row, gap: 18, marginTop: 12 }}>
        {result.bestGain ? (
          <div style={{ ...card, padding: '10px 12px', flex: 1 }}>
            <div style={{ ...label, color: 'var(--accent-success)' }}>{tt(language, 'community.bestGain')}</div>
            <div style={{ marginTop: 4 }}>
              {Math.round(result.bestGain.fromPct * 100)}%–{Math.round(result.bestGain.toPct * 100)}% of the lap ·{' '}
              <span style={fasterText}>{formatDelta(result.bestGain.deltaSec)}</span>
            </div>
          </div>
        ) : null}
        {result.worstLoss ? (
          <div style={{ ...card, padding: '10px 12px', flex: 1 }}>
            <div style={{ ...label, color: 'var(--accent-primary)' }}>{tt(language, 'community.worstLoss')}</div>
            <div style={{ marginTop: 4 }}>
              {Math.round(result.worstLoss.fromPct * 100)}%–{Math.round(result.worstLoss.toPct * 100)}% of the lap ·{' '}
              <span style={slowerText}>{formatDelta(result.worstLoss.deltaSec)}</span>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}

function Metric({ title, value, tone, hint }: { title: string; value: string; tone: 'faster' | 'slower' | 'neutral'; hint?: string }): ReactElement {
  const color = tone === 'faster' ? 'var(--accent-success)' : tone === 'slower' ? 'var(--accent-primary)' : 'var(--text-primary)'
  return (
    <div>
      <div style={label}>{title}</div>
      <div style={{ fontSize: 22, fontWeight: 600, color, marginTop: 2 }}>{value}</div>
      {hint ? <div style={{ fontSize: 11, opacity: 0.65 }}>{hint}</div> : null}
    </div>
  )
}
