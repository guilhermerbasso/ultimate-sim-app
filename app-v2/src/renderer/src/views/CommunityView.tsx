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

const KIND_LABEL: Record<string, string> = { ghost: 'Ghost lap', telemetry: 'Telemetria', setup: 'Setup' }

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

function summaryLabel(summary: SharePackSummary): string {
  const bits = [summary.track, summary.car].filter(Boolean)
  return bits.join(' · ') || summary.author || KIND_LABEL[summary.kind] || 'Pack'
}

// Cumulative delta ribbon. Bars BELOW the centre line + green = you are faster
// than the ghost here; bars ABOVE + warm orange = you are slower. Everything else
// stays warm chrome on purpose.
function DeltaTrace({ bins }: { bins: GhostCompareBin[] }): ReactElement {
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
    return <div style={{ opacity: 0.6, padding: 12 }}>Sem dados de comparação.</div>
  }

  const width = 100 / points.length
  return (
    <svg
      viewBox="0 0 100 40"
      preserveAspectRatio="none"
      role="img"
      aria-label="Delta acumulado por distância da volta"
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

export default function CommunityView({ showToast }: AppViewProps): ReactElement {
  const [status, setStatus] = useState<CommunityStatus | null>(null)
  const [imported, setImported] = useState<SharePackSummary[]>([])
  const [note, setNote] = useState('')
  const [author, setAuthor] = useState('')
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<GhostCompareReport | null>(null)
  const [baselineId, setBaselineId] = useState('')

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

  useEffect(() => {
    void refreshStatus()
    void refreshList()
    const offChanged = window.ipc.subscribe(COMMUNITY_CHANNELS.changed, () => {
      void refreshList()
      void refreshStatus()
    })
    const timer = window.setInterval(() => void refreshStatus(), 2000)
    return () => {
      offChanged()
      window.clearInterval(timer)
    }
  }, [refreshList, refreshStatus])

  const ghostImports = useMemo(() => imported.filter((pack) => pack.kind === 'ghost'), [imported])

  async function runExport(channel: string, kind: string): Promise<void> {
    setBusy(true)
    try {
      const result = await window.ipc.invoke<CommunityExportResult>(channel, exportOpts())
      if (result.canceled) return
      showToast(`${kind} exportado para arquivo .simshare.`, 'success')
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
      showToast(`Importado: ${result.summary ? summaryLabel(result.summary) : 'pack'}.`, 'success')
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
      showToast('Pack removido.', 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    }
  }

  const liveReady = status?.liveGhostReady ?? false

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ ...card, display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <div style={label}>Comunidade · local-first</div>
          <h3 style={{ margin: '4px 0 0' }}>Compartilhar voltas, telemetria e setups</h3>
          <p style={{ margin: '6px 0 0', opacity: 0.72, maxWidth: 720 }}>
            Tudo aqui é <strong>compartilhamento por arquivo</strong> (<code>.simshare</code>) — 100% local, sem conta e sem
            servidor. Exporte um ghost, sua telemetria ou um setup e envie o arquivo para um amigo; importe os arquivos que
            receber e compare onde você ganha ou perde. Uma rede ao vivo é um próximo passo planejado.
          </p>
        </div>
      </div>

      <section style={card}>
        <div style={label}>Captura ao vivo</div>
        <div style={{ ...row, justifyContent: 'space-between', marginTop: 8 }}>
          <div>
            <strong>{status?.car || status?.track ? [status?.track, status?.car].filter(Boolean).join(' · ') : 'Sem telemetria no momento'}</strong>
            <div style={{ opacity: 0.72, fontSize: 12, marginTop: 2 }}>
              Última volta capturada:{' '}
              {liveReady ? (
                <span style={fasterText}>{formatLapTime(status?.liveLapTimeSec)} · {status?.liveSampleCount} amostras</span>
              ) : (
                <span style={{ opacity: 0.7 }}>nenhuma volta completa ainda</span>
              )}
              {status?.telemetryReady ? <span style={{ opacity: 0.6 }}> · telemetria: {status.telemetrySampleCount} amostras</span> : null}
            </div>
          </div>
        </div>

        <div style={{ ...row, marginTop: 12 }}>
          <input style={{ ...input, flex: 1, minWidth: 180 }} value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Seu nome (opcional)" />
          <input style={{ ...input, flex: 2, minWidth: 220 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nota para o arquivo (opcional)" />
        </div>

        <div style={{ ...row, marginTop: 12 }}>
          <button style={primaryButton} type="button" disabled={busy || !liveReady} onClick={() => void runExport(COMMUNITY_CHANNELS.exportGhost, 'Ghost')}>
            Exportar minha volta (ghost)
          </button>
          <button style={button} type="button" disabled={busy || !status?.telemetryReady} onClick={() => void runExport(COMMUNITY_CHANNELS.exportTelemetry, 'Telemetria')}>
            Exportar telemetria
          </button>
          <button style={button} type="button" disabled={busy} onClick={() => void runExport(COMMUNITY_CHANNELS.exportSetup, 'Setup')}>
            Exportar setup (.sto)
          </button>
          <span style={{ flex: 1 }} />
          <button style={primaryButton} type="button" disabled={busy} onClick={() => void runImport()}>
            Importar .simshare
          </button>
        </div>
      </section>

      <section style={card}>
        <div style={{ ...row, justifyContent: 'space-between' }}>
          <div>
            <div style={label}>Importados</div>
            <h3 style={{ margin: '4px 0 0' }}>{imported.length} pack(s) na biblioteca local</h3>
          </div>
          <label style={row}>
            <span style={{ fontSize: 12, opacity: 0.7 }}>comparar usando</span>
            <select style={input} value={baselineId} onChange={(e) => setBaselineId(e.target.value)}>
              <option value="">Minha volta (ao vivo)</option>
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
                  <span style={{ ...label, opacity: 0.8 }}>{KIND_LABEL[pack.kind] ?? pack.kind}</span>
                  <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summaryLabel(pack)}</strong>
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
                    Comparar
                  </button>
                ) : null}
                <button style={{ ...button, borderColor: 'rgba(var(--danger-rgb,196,26,26),0.4)' }} type="button" onClick={() => void remove(pack.id)}>
                  Excluir
                </button>
              </div>
            </div>
          ))}
          {imported.length === 0 && (
            <p style={{ opacity: 0.7, margin: 0 }}>Nenhum arquivo importado ainda. Use “Importar .simshare” para adicionar ghosts, telemetria ou setups recebidos.</p>
          )}
        </div>
        {!liveReady && !baselineId ? (
          <p style={{ opacity: 0.6, marginTop: 10, fontSize: 12 }}>
            Dica: para “Comparar” você precisa de uma volta sua capturada ao vivo, ou escolha um ghost importado como base no seletor acima.
          </p>
        ) : null}
      </section>

      {report ? <ComparePanel report={report} onClose={() => setReport(null)} /> : null}
    </div>
  )
}

function ComparePanel({ report, onClose }: { report: GhostCompareReport; onClose: () => void }): ReactElement {
  const { result } = report
  const faster = result.totalDeltaSec < 0
  return (
    <section style={{ ...card, borderColor: faster ? 'rgba(26,138,58,0.45)' : 'rgba(var(--accent-rgb),0.4)' }}>
      <div style={{ ...row, justifyContent: 'space-between' }}>
        <div>
          <div style={label}>Comparação de ghost</div>
          <h3 style={{ margin: '4px 0 0' }}>
            {report.baselineLabel} <span style={{ opacity: 0.6 }}>vs</span> {report.targetLabel}
          </h3>
        </div>
        <button style={button} type="button" onClick={onClose}>Fechar</button>
      </div>

      <div style={{ ...row, gap: 18, marginTop: 12 }}>
        <Metric title="Delta total" value={formatDelta(result.totalDeltaSec)} tone={faster ? 'faster' : 'slower'} hint={faster ? 'você está mais rápido' : 'você está mais lento'} />
        <Metric title="Tempo ganho" value={`-${result.gainSec.toFixed(3)}s`} tone="faster" />
        <Metric title="Tempo perdido" value={`+${result.lossSec.toFixed(3)}s`} tone="slower" />
        <Metric title="Sua volta" value={formatLapTime(result.lapTimeASec)} tone="neutral" />
        <Metric title="Ghost" value={formatLapTime(result.lapTimeBSec)} tone="neutral" />
      </div>

      <div style={{ marginTop: 14 }}>
        <DeltaTrace bins={result.bins} />
        <div style={{ ...row, justifyContent: 'space-between', marginTop: 6, fontSize: 11, opacity: 0.7 }}>
          <span>início da volta</span>
          <span><span style={fasterText}>■</span> mais rápido &nbsp; <span style={slowerText}>■</span> mais lento</span>
          <span>fim da volta</span>
        </div>
      </div>

      <div style={{ ...row, gap: 18, marginTop: 12 }}>
        {result.bestGain ? (
          <div style={{ ...card, padding: '10px 12px', flex: 1 }}>
            <div style={{ ...label, color: 'var(--accent-success)' }}>Onde você mais ganha</div>
            <div style={{ marginTop: 4 }}>
              {Math.round(result.bestGain.fromPct * 100)}%–{Math.round(result.bestGain.toPct * 100)}% da volta ·{' '}
              <span style={fasterText}>{formatDelta(result.bestGain.deltaSec)}</span>
            </div>
          </div>
        ) : null}
        {result.worstLoss ? (
          <div style={{ ...card, padding: '10px 12px', flex: 1 }}>
            <div style={{ ...label, color: 'var(--accent-primary)' }}>Onde você mais perde</div>
            <div style={{ marginTop: 4 }}>
              {Math.round(result.worstLoss.fromPct * 100)}%–{Math.round(result.worstLoss.toPct * 100)}% da volta ·{' '}
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
