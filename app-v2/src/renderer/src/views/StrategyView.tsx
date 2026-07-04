import { type CSSProperties, type ReactElement, useCallback, useEffect, useMemo, useState } from 'react'
import {
  STRATEGY_CHANNELS,
  type StrategyAction,
  type StrategyConfig,
  type StrategyNarration,
  type StrategyPlan,
  type UndercutAnalysis
} from '../../../shared/strategy'
import {
  INCIDENT_CHANNELS,
  type IncidentAnalysis,
  type IncidentClipMeta,
  type IncidentSeverity,
  type IncidentType
} from '../../../shared/incidents'
import type { AppViewProps } from '../App'

// ─── warm-chrome styling (cool/green ONLY for "good") ─────────────────────────

const WARM = 'var(--accent-primary)' // Carbon Orange — the default chrome accent
const GOOD = 'var(--accent-success)' // muted green — reserved for genuinely good states
const WARN = 'var(--accent-warning)'
const BAD = 'var(--accent-danger)'

const card: CSSProperties = {
  background: 'var(--surface-raised)',
  border: '1px solid rgba(232,105,32,0.16)',
  borderRadius: 'var(--radius-sm)',
  padding: 16
}
const label: CSSProperties = { fontSize: 11, letterSpacing: 1.1, textTransform: 'uppercase', opacity: 0.62 }
const value: CSSProperties = { fontSize: 28, fontWeight: 800, marginTop: 5, fontVariantNumeric: 'tabular-nums' }
const input: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  marginTop: 6,
  padding: '9px 10px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid rgba(232,105,32,0.22)',
  background: 'rgba(0,0,0,0.24)',
  color: '#fff'
}
const guidedEmptyState: CSSProperties = {
  ...card,
  borderStyle: 'dashed',
  color: 'var(--text-muted)',
  background: 'var(--surface-sunken)'
}

function fmt(value?: number, digits = 1): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—'
}

function fmtSigned(value?: number, digits = 1): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`
}

function fmtClock(ts?: number): string {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return '—'
  const seconds = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (seconds <= 1) return 'agora'
  if (seconds < 60) return `${seconds}s atrás`
  return `${Math.round(seconds / 60)}min atrás`
}

const ACTION_META: Record<StrategyAction, { text: string; color: string }> = {
  'box-now': { text: 'BOX AGORA', color: BAD },
  'box-soon': { text: 'Preparar pit', color: WARN },
  'short-fill': { text: 'Splash & dash', color: WARN },
  extend: { text: 'Seguir na pista', color: GOOD },
  hold: { text: 'Aguardando', color: WARM },
  unknown: { text: 'Sem dados', color: 'var(--text-muted)' }
}

const UNDERCUT_LABEL: Record<UndercutAnalysis['recommendation'], string> = {
  undercut: 'Undercut',
  overcut: 'Overcut',
  defend: 'Defender',
  'track-position': 'Manter posição',
  none: '—'
}

const INCIDENT_LABEL: Record<IncidentType, string> = {
  spin: 'Rodada',
  'off-track': 'Saída de pista',
  contact: 'Contato',
  lockup: 'Travada de freio'
}

const SEVERITY_META: Record<IncidentSeverity, { text: string; color: string }> = {
  minor: { text: 'leve', color: 'var(--text-muted)' },
  moderate: { text: 'moderado', color: WARN },
  major: { text: 'grave', color: BAD }
}

function Metric({ title, main, unit, color }: { title: string; main: string; unit?: string; color?: string }): ReactElement {
  return (
    <div style={card}>
      <div style={label}>{title}</div>
      <div style={{ ...value, color: color ?? '#fff' }}>
        {main} {unit && <small style={{ fontSize: 13, opacity: 0.66 }}>{unit}</small>}
      </div>
    </div>
  )
}

function GuidedEmptyState(): ReactElement {
  return (
    <section style={guidedEmptyState}>
      <div style={label}>Aguardando telemetria</div>
      <p style={{ margin: '6px 0 0', lineHeight: 1.45 }}>
        Conecte ao iRacing ou escolha Demo (mock) na aba Telemetria para ver o plano de estratégia.
      </p>
    </section>
  )
}

function toNumber(text: string): number | undefined {
  const parsed = Number(text)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

export default function StrategyView(_props: AppViewProps): ReactElement {
  const [plan, setPlan] = useState<StrategyPlan | null>(null)
  const [clips, setClips] = useState<IncidentClipMeta[]>([])
  const [analyses, setAnalyses] = useState<Record<string, IncidentAnalysis>>({})
  const [narration, setNarration] = useState<StrategyNarration | null>(null)
  const [useAi, setUseAi] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [pitLoss, setPitLoss] = useState('25')
  const [fuelMargin, setFuelMargin] = useState('0.5')
  const [tyreThreshold, setTyreThreshold] = useState('30')
  const [targetLaps, setTargetLaps] = useState('')
  const [raceMinutes, setRaceMinutes] = useState('')

  const settings = useMemo<Partial<StrategyConfig>>(
    () => ({
      pitLossSec: toNumber(pitLoss) ?? 25,
      fuelMarginLaps: Number.isFinite(Number(fuelMargin)) ? Math.max(0, Number(fuelMargin)) : 0.5,
      tyreLifeThresholdPct: (toNumber(tyreThreshold) ?? 30) / 100,
      targetLaps: toNumber(targetLaps),
      raceTimeMinutes: toNumber(raceMinutes)
    }),
    [pitLoss, fuelMargin, tyreThreshold, targetLaps, raceMinutes]
  )

  const refreshPlan = useCallback(async (): Promise<void> => {
    try {
      const next = await window.ipc.invoke<StrategyPlan>(STRATEGY_CHANNELS.getPlan, settings)
      setPlan(next)
    } catch {
      // transient — the live broadcast keeps the plan fresh
    }
  }, [settings])

  const refreshClips = useCallback(async (): Promise<void> => {
    try {
      const list = await window.ipc.invoke<IncidentClipMeta[]>(INCIDENT_CHANNELS.list)
      setClips(Array.isArray(list) ? list : [])
    } catch {
      setClips([])
    }
  }, [])

  useEffect(() => {
    void refreshPlan()
    const timer = window.setInterval(() => void refreshPlan(), 2000)
    return () => window.clearInterval(timer)
  }, [refreshPlan])

  useEffect(() => {
    const unsubscribe = window.ipc.subscribe<StrategyPlan>(STRATEGY_CHANNELS.update, setPlan)
    return unsubscribe
  }, [])

  useEffect(() => {
    void refreshClips()
    const unsubscribe = window.ipc.subscribe<IncidentClipMeta>(INCIDENT_CHANNELS.added, () => void refreshClips())
    return unsubscribe
  }, [refreshClips])

  useEffect(() => {
    void window.ipc
      .invoke<StrategyConfig>(STRATEGY_CHANNELS.getConfig)
      .then((cfg) => setUseAi(cfg.useLocalAi))
      .catch(() => undefined)
    const unsubscribe = window.ipc.subscribe<StrategyConfig>(STRATEGY_CHANNELS.configEvent, (cfg) =>
      setUseAi(cfg.useLocalAi)
    )
    return unsubscribe
  }, [])

  const toggleUseAi = useCallback(async (next: boolean): Promise<void> => {
    setUseAi(next)
    try {
      const saved = await window.ipc.invoke<StrategyConfig>(STRATEGY_CHANNELS.setConfig, { useLocalAi: next })
      setUseAi(saved.useLocalAi)
    } catch {
      // keep the optimistic local value; the live config broadcast will reconcile
    }
  }, [])

  const narrate = useCallback(async (): Promise<void> => {
    setBusyId('narrate')
    try {
      const result = await window.ipc.invoke<StrategyNarration>(STRATEGY_CHANNELS.narrate, {
        lang: 'pt',
        useLlm: useAi,
        settings
      })
      setNarration(result)
    } catch {
      setNarration(null)
    } finally {
      setBusyId(null)
    }
  }, [settings, useAi])

  const analyze = useCallback(
    async (id: string): Promise<void> => {
      setBusyId(id)
      try {
        const result = await window.ipc.invoke<IncidentAnalysis>(INCIDENT_CHANNELS.analyze, { id, lang: 'pt', useLlm: useAi })
        setAnalyses((prev) => ({ ...prev, [id]: result }))
      } finally {
        setBusyId(null)
      }
    },
    [useAi]
  )

  const clearClips = useCallback(async (): Promise<void> => {
    try {
      await window.ipc.invoke<number>(INCIDENT_CHANNELS.clear)
      setClips([])
      setAnalyses({})
    } catch {
      // ignore
    }
  }, [])

  const connected = plan?.connected === true
  const available = plan?.available === true
  const action = plan?.action ?? 'unknown'
  const actionMeta = ACTION_META[action]
  const fuel = plan?.fuel
  const tyres = plan?.tyres
  const pitWindow = plan?.pitWindow
  const undercut = plan?.undercut

  const fuelGood = (fuel?.marginLaps ?? -1) >= 0 && fuel?.canFinish === true
  const undercutGood = undercut?.available === true && (undercut.recommendation === 'undercut' || undercut.recommendation === 'defend')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── Strategy settings ── */}
      <div style={{ ...card, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, alignItems: 'end' }}>
        <div>
          <div style={label}>Pit loss (s)</div>
          <input style={input} type="number" min="0" step="1" value={pitLoss} onChange={(event) => setPitLoss(event.target.value)} />
        </div>
        <div>
          <div style={label}>Margem (voltas)</div>
          <input style={input} type="number" min="0" step="0.5" value={fuelMargin} onChange={(event) => setFuelMargin(event.target.value)} />
        </div>
        <div>
          <div style={label}>Limite pneu (% vida)</div>
          <input style={input} type="number" min="5" max="90" step="5" value={tyreThreshold} onChange={(event) => setTyreThreshold(event.target.value)} />
        </div>
        <div>
          <div style={label}>Voltas-alvo</div>
          <input style={input} type="number" min="1" placeholder="Auto" value={targetLaps} onChange={(event) => setTargetLaps(event.target.value)} />
        </div>
        <div>
          <div style={label}>Tempo (min)</div>
          <input style={input} type="number" min="1" placeholder="Auto" value={raceMinutes} onChange={(event) => setRaceMinutes(event.target.value)} />
        </div>
        <div style={{ fontSize: 13, opacity: 0.78 }}>{connected ? '● telemetria ao vivo' : '○ sem telemetria'}</div>
      </div>

      {!connected || !available ? (
        <GuidedEmptyState />
      ) : (
        <>
          {/* ── Headline recommendation ── */}
          <section style={{ ...card, borderColor: actionMeta.color, borderWidth: 1, borderLeft: `4px solid ${actionMeta.color}` }}>
            <div style={label}>Recomendação</div>
            <h2 style={{ margin: '6px 0 4px', color: actionMeta.color }}>{actionMeta.text}</h2>
            <p style={{ margin: 0, lineHeight: 1.5, opacity: 0.92 }}>{plan?.headline}</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12, alignItems: 'center' }}>
              <button onClick={() => void narrate()} disabled={busyId === 'narrate'}>
                {busyId === 'narrate' ? 'Narrando…' : '📻 Narrar no rádio'}
              </button>
              <label style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center', opacity: 0.85 }}>
                <input type="checkbox" checked={useAi} onChange={(event) => void toggleUseAi(event.target.checked)} />
                usar IA local (se baixada)
              </label>
              {narration && (
                <span style={{ fontSize: 13, opacity: 0.85 }}>
                  “{narration.text}” <small style={{ opacity: 0.6 }}>({narration.source === 'llm' ? 'IA' : 'determinístico'})</small>
                </span>
              )}
            </div>
          </section>

          {/* ── Fuel + tyres metrics ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            <Metric title="Combustível" main={fmt(fuel?.fuelLiters, 1)} unit="L" />
            <Metric title="Voltas no tanque" main={fmt(fuel?.lapsOfFuel, 1)} unit="voltas" />
            <Metric
              title="Margem combustível"
              main={fmtSigned(fuel?.marginLaps, 1)}
              unit="voltas"
              color={fuelGood ? GOOD : (fuel?.marginLaps ?? 0) < 0 ? BAD : WARN}
            />
            <Metric
              title="Pneu até o limite"
              main={fmt(tyres?.lapsToThreshold, 1)}
              unit="voltas"
              color={(tyres?.lapsToThreshold ?? 99) <= 2 ? BAD : (tyres?.lapsToThreshold ?? 99) <= 5 ? WARN : '#fff'}
            />
          </div>

          {/* ── Pit window + undercut ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
            <section style={card}>
              <div style={label}>Janela de pit</div>
              <h3 style={{ margin: '6px 0 12px', color: pitWindow?.open ? GOOD : '#fff' }}>
                {pitWindow?.open ? 'ABERTA' : 'Fechada'}
              </h3>
              <div style={{ display: 'grid', gap: 8, fontVariantNumeric: 'tabular-nums' }}>
                <div>Volta ótima: <strong>{pitWindow?.optimalLap ?? '—'}</strong></div>
                <div>Mais cedo: <strong>{pitWindow?.earliestLap ?? '—'}</strong></div>
                <div>Mais tarde: <strong>{pitWindow?.latestLap ?? '—'}</strong></div>
                <div>
                  Limitado por: <strong style={{ color: pitWindow?.limitedBy === 'fuel' ? WARN : pitWindow?.limitedBy === 'tyres' ? WARM : 'inherit' }}>
                    {pitWindow?.limitedBy === 'fuel' ? 'combustível' : pitWindow?.limitedBy === 'tyres' ? 'pneus' : pitWindow?.limitedBy === 'none' ? 'nada' : '—'}
                  </strong>
                </div>
                <div>Combustível p/ terminar: <strong>{fmt(fuel?.fuelToFinishLiters, 1)} L</strong></div>
                {fuel?.canFinish === false && (
                  <div>Splash mínimo: <strong style={{ color: WARN }}>{fmt(fuel?.shortFillLiters, 1)} L</strong></div>
                )}
                {(fuel?.savePerLapLiters ?? 0) > 0 && (
                  <div>Economia p/ esticar: <strong style={{ color: WARN }}>{fmt(fuel?.savePerLapLiters, 2)} L/volta</strong></div>
                )}
              </div>
            </section>

            <section style={card}>
              <div style={label}>Undercut / Overcut</div>
              <h3 style={{ margin: '6px 0 12px', color: undercutGood ? GOOD : '#fff' }}>
                {undercut?.available ? UNDERCUT_LABEL[undercut.recommendation] : '—'}
              </h3>
              {undercut?.available ? (
                <div style={{ display: 'grid', gap: 8, fontVariantNumeric: 'tabular-nums' }}>
                  <div>Rival: <strong>{undercut.rivalName ?? '—'}</strong></div>
                  <div>
                    Gap: <strong style={{ color: (undercut.gapSec ?? 0) >= 0 ? '#fff' : WARM }}>{fmtSigned(undercut.gapSec, 1)} s</strong>
                    <small style={{ opacity: 0.6 }}> {(undercut.gapSec ?? 0) >= 0 ? '(à frente)' : '(atrás)'}</small>
                  </div>
                  <div>Pit loss: <strong>{fmt(undercut.pitLossSec, 0)} s</strong></div>
                  <div>Ganho pneu novo: <strong>{fmt(undercut.freshTyreGainSec, 1)} s</strong></div>
                  <div>
                    Gap pós-undercut: <strong style={{ color: (undercut.netGapAfterUndercutSec ?? 1) <= 0 ? GOOD : '#fff' }}>
                      {fmtSigned(undercut.netGapAfterUndercutSec, 1)} s
                    </strong>
                  </div>
                  <p style={{ margin: '4px 0 0', lineHeight: 1.45, opacity: 0.82, fontSize: 13 }}>{undercut.summary}</p>
                </div>
              ) : (
                <p style={{ margin: 0, color: 'var(--text-muted)', lineHeight: 1.45 }}>Sem gap de rival para calcular undercut.</p>
              )}
            </section>
          </div>

          {plan?.notes && plan.notes.length > 0 && (
            <section style={{ ...card, background: 'var(--surface-sunken)' }}>
              <div style={label}>Notas</div>
              <ul style={{ margin: '8px 0 0', paddingLeft: 18, lineHeight: 1.5, opacity: 0.8 }}>
                {plan.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {/* ── Incident clips ── */}
      <section style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div style={label}>Incidentes · clipes de telemetria</div>
            <h3 style={{ margin: '6px 0 0' }}>Análise de incidentes ({clips.length})</h3>
          </div>
          {clips.length > 0 && (
            <button onClick={() => void clearClips()} style={{ color: BAD }}>Limpar tudo</button>
          )}
        </div>

        {clips.length === 0 ? (
          <p style={{ margin: '12px 0 0', color: 'var(--text-muted)', lineHeight: 1.45 }}>
            Nenhum incidente gravado ainda. Rodadas, saídas de pista, contatos e travadas de freio aparecem aqui automaticamente.
          </p>
        ) : (
          <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
            {clips.map((clip) => {
              const severity = SEVERITY_META[clip.severity]
              const analysis = analyses[clip.id]
              return (
                <div key={clip.id} style={{ ...card, background: 'var(--surface-sunken)', borderLeft: `4px solid ${severity.color}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 15 }}>{INCIDENT_LABEL[clip.type]}</strong>
                      <span style={{ color: severity.color, fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 }}>{severity.text}</span>
                      <span style={{ opacity: 0.7, fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
                        {clip.lap ? `volta ${clip.lap}` : 'volta ?'}
                        {typeof clip.lapDistPct === 'number' ? ` · ${Math.round(clip.lapDistPct * 100)}%` : ''}
                        {' · '}
                        {clip.sampleCount} amostras
                      </span>
                      <span style={{ opacity: 0.5, fontSize: 12 }}>{fmtClock(clip.createdAt)}</span>
                    </div>
                    <button onClick={() => void analyze(clip.id)} disabled={busyId === clip.id}>
                      {busyId === clip.id ? 'Analisando…' : '🔍 Analisar'}
                    </button>
                  </div>
                  <p style={{ margin: '8px 0 0', lineHeight: 1.45, opacity: 0.9, fontSize: 13 }}>{clip.summary}</p>
                  {analysis && (
                    <p style={{ margin: '8px 0 0', lineHeight: 1.5, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                      {analysis.text} <small style={{ opacity: 0.55 }}>({analysis.source === 'llm' ? 'IA local' : 'determinístico'})</small>
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
