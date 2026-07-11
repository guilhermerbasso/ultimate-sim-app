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
import { tt, type ResolvedLanguage } from '../i18n'
import { formatMeasurement, measurementUnit } from '../../../shared/units'
import { useUnitSystem } from '../lib/units'

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

function fmtClock(ts: number | undefined, language: ResolvedLanguage | undefined): string {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return '—'
  const seconds = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (seconds <= 1) return tt(language, 'common.now')
  if (seconds < 60) return tt(language, 'strategy.ago.seconds', { seconds })
  return tt(language, 'strategy.ago.minutes', { minutes: Math.round(seconds / 60) })
}

const ACTION_META: Record<StrategyAction, { key: string; color: string }> = {
  'box-now': { key: 'strategy.boxNow', color: BAD },
  'box-soon': { key: 'strategy.preparePit', color: WARN },
  'short-fill': { key: 'strategy.shortFill', color: WARN },
  extend: { key: 'strategy.stayOut', color: GOOD },
  hold: { key: 'strategy.waiting', color: WARM },
  unknown: { key: 'strategy.noData', color: 'var(--text-muted)' }
}

const UNDERCUT_LABEL: Record<UndercutAnalysis['recommendation'], string> = {
  undercut: 'strategy.undercut',
  overcut: 'strategy.overcut',
  defend: 'strategy.defend',
  'track-position': 'strategy.keepPosition',
  none: '—'
}

const INCIDENT_KEY: Record<IncidentType, string> = {
  spin: 'strategy.spin',
  'off-track': 'strategy.offTrack',
  contact: 'strategy.contact',
  lockup: 'strategy.lockup'
}

const SEVERITY_META: Record<IncidentSeverity, { key: string; color: string }> = {
  minor: { key: 'strategy.minor', color: 'var(--text-muted)' },
  moderate: { key: 'strategy.moderate', color: WARN },
  major: { key: 'strategy.major', color: BAD }
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

function GuidedEmptyState({ language }: { language?: ResolvedLanguage }): ReactElement {
  return (
    <section style={guidedEmptyState}>
      <div style={label}>{tt(language, 'fuel.empty.title')}</div>
      <p style={{ margin: '6px 0 0', lineHeight: 1.45 }}>
        {tt(language, 'strategy.empty.body')}
      </p>
    </section>
  )
}

function toNumber(text: string): number | undefined {
  const parsed = Number(text)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

export default function StrategyView({ language }: AppViewProps): ReactElement {
  const unitSystem = useUnitSystem()
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
        lang: language ?? 'en',
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
        const result = await window.ipc.invoke<IncidentAnalysis>(INCIDENT_CHANNELS.analyze, { id, lang: language ?? 'en', useLlm: useAi })
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
          <div style={label}>{tt(language, 'strategy.pitLossSeconds')}</div>
          <input style={input} type="number" min="0" step="1" value={pitLoss} onChange={(event) => setPitLoss(event.target.value)} />
        </div>
        <div>
          <div style={label}>{tt(language, 'strategy.fuelMargin')}</div>
          <input style={input} type="number" min="0" step="0.5" value={fuelMargin} onChange={(event) => setFuelMargin(event.target.value)} />
        </div>
        <div>
          <div style={label}>{tt(language, 'strategy.tyreLimit')}</div>
          <input style={input} type="number" min="5" max="90" step="5" value={tyreThreshold} onChange={(event) => setTyreThreshold(event.target.value)} />
        </div>
        <div>
          <div style={label}>{tt(language, 'fuel.targetLaps')}</div>
          <input style={input} type="number" min="1" placeholder={tt(language, 'strategy.auto')} value={targetLaps} onChange={(event) => setTargetLaps(event.target.value)} />
        </div>
        <div>
          <div style={label}>{tt(language, 'strategy.time')}</div>
          <input style={input} type="number" min="1" placeholder={tt(language, 'strategy.auto')} value={raceMinutes} onChange={(event) => setRaceMinutes(event.target.value)} />
        </div>
        <div style={{ fontSize: 13, opacity: 0.78 }}>{connected ? tt(language, 'strategy.liveTelemetry') : tt(language, 'strategy.noTelemetryStatus')}</div>
      </div>

      {!connected || !available ? (
        <GuidedEmptyState language={language} />
      ) : (
        <>
          {/* ── Headline recommendation ── */}
          <section style={{ ...card, borderColor: actionMeta.color, borderWidth: 1, borderLeft: `4px solid ${actionMeta.color}` }}>
            <div style={label}>{tt(language, 'strategy.recommendation')}</div>
            <h2 style={{ margin: '6px 0 4px', color: actionMeta.color }}>{tt(language, actionMeta.key)}</h2>
            <p style={{ margin: 0, lineHeight: 1.5, opacity: 0.92 }}>{plan?.headline}</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12, alignItems: 'center' }}>
              <button onClick={() => void narrate()} disabled={busyId === 'narrate'}>
                {busyId === 'narrate' ? tt(language, 'strategy.narrating') : tt(language, 'strategy.narrateRadio')}
              </button>
              <label style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center', opacity: 0.85 }}>
                <input type="checkbox" checked={useAi} onChange={(event) => void toggleUseAi(event.target.checked)} />
                {tt(language, 'strategy.useLocalAi')}
              </label>
              {narration && (
                <span style={{ fontSize: 13, opacity: 0.85 }}>
                  “{narration.text}” <small style={{ opacity: 0.6 }}>({narration.source === 'llm' ? tt(language, 'strategy.ai') : tt(language, 'strategy.deterministic')})</small>
                </span>
              )}
            </div>
          </section>

          {/* ── Fuel + tyres metrics ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            <Metric title={tt(language, 'fuel.fuel')} main={formatMeasurement(fuel?.fuelLiters, 'fuel-volume-l', unitSystem, { decimals: 1 }).display} unit={measurementUnit('fuel-volume-l', unitSystem)} />
            <Metric title={tt(language, 'fuel.lapsInTank')} main={fmt(fuel?.lapsOfFuel, 1)} unit={tt(language, 'fuel.lapUnit')} />
            <Metric
              title={tt(language, 'strategy.fuelMarginMetric')}
              main={fmtSigned(fuel?.marginLaps, 1)}
              unit={tt(language, 'fuel.lapUnit')}
              color={fuelGood ? GOOD : (fuel?.marginLaps ?? 0) < 0 ? BAD : WARN}
            />
            <Metric
              title={tt(language, 'strategy.tyreToLimit')}
              main={fmt(tyres?.lapsToThreshold, 1)}
              unit={tt(language, 'fuel.lapUnit')}
              color={(tyres?.lapsToThreshold ?? 99) <= 2 ? BAD : (tyres?.lapsToThreshold ?? 99) <= 5 ? WARN : '#fff'}
            />
          </div>

          {/* ── Pit window + undercut ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
            <section style={card}>
              <div style={label}>{tt(language, 'strategy.pitWindow')}</div>
              <h3 style={{ margin: '6px 0 12px', color: pitWindow?.open ? GOOD : '#fff' }}>
                {pitWindow?.open ? tt(language, 'strategy.open') : tt(language, 'strategy.closed')}
              </h3>
              <div style={{ display: 'grid', gap: 8, fontVariantNumeric: 'tabular-nums' }}>
                <div>{tt(language, 'strategy.optimalLap')} <strong>{pitWindow?.optimalLap ?? '—'}</strong></div>
                <div>{tt(language, 'strategy.earliest')} <strong>{pitWindow?.earliestLap ?? '—'}</strong></div>
                <div>{tt(language, 'strategy.latest')} <strong>{pitWindow?.latestLap ?? '—'}</strong></div>
                <div>
                  {tt(language, 'strategy.limitedBy')} <strong style={{ color: pitWindow?.limitedBy === 'fuel' ? WARN : pitWindow?.limitedBy === 'tyres' ? WARM : 'inherit' }}>
                    {pitWindow?.limitedBy === 'fuel' ? tt(language, 'fuel.fuel') : pitWindow?.limitedBy === 'tyres' ? tt(language, 'tire.byCorner') : pitWindow?.limitedBy === 'none' ? tt(language, 'strategy.nothing') : '—'}
                  </strong>
                </div>
                <div>{tt(language, 'fuel.fuelToFinish')} <strong>{formatMeasurement(fuel?.fuelToFinishLiters, 'fuel-volume-l', unitSystem, { decimals: 1, includeUnit: true }).display}</strong></div>
                {fuel?.canFinish === false && (
                  <div>{tt(language, 'strategy.shortFill')} <strong style={{ color: WARN }}>{formatMeasurement(fuel?.shortFillLiters, 'fuel-volume-l', unitSystem, { decimals: 1, includeUnit: true }).display}</strong></div>
                )}
                {(fuel?.savePerLapLiters ?? 0) > 0 && (
                  <div>{tt(language, 'strategy.saveToExtend')} <strong style={{ color: WARN }}>{formatMeasurement(fuel?.savePerLapLiters, 'fuel-per-lap-l', unitSystem, { decimals: 2, includeUnit: true }).display}</strong></div>
                )}
              </div>
            </section>

            <section style={card}>
              <div style={label}>Undercut / Overcut</div>
              <h3 style={{ margin: '6px 0 12px', color: undercutGood ? GOOD : '#fff' }}>
                {undercut?.available ? tt(language, UNDERCUT_LABEL[undercut.recommendation]) : '—'}
              </h3>
              {undercut?.available ? (
                <div style={{ display: 'grid', gap: 8, fontVariantNumeric: 'tabular-nums' }}>
                  <div>{tt(language, 'strategy.rival')} <strong>{undercut.rivalName ?? '—'}</strong></div>
                  <div>
                    {tt(language, 'strategy.gap')}: <strong style={{ color: (undercut.gapSec ?? 0) >= 0 ? '#fff' : WARM }}>{fmtSigned(undercut.gapSec, 1)} s</strong>
                    <small style={{ opacity: 0.6 }}> {(undercut.gapSec ?? 0) >= 0 ? tt(language, 'strategy.ahead') : tt(language, 'strategy.behind')}</small>
                  </div>
                  <div>{tt(language, 'strategy.pitLoss')}: <strong>{fmt(undercut.pitLossSec, 0)} s</strong></div>
                  <div>{tt(language, 'strategy.freshTyreGain')} <strong>{fmt(undercut.freshTyreGainSec, 1)} s</strong></div>
                  <div>
                    {tt(language, 'strategy.netGapAfterUndercut')} <strong style={{ color: (undercut.netGapAfterUndercutSec ?? 1) <= 0 ? GOOD : '#fff' }}>
                      {fmtSigned(undercut.netGapAfterUndercutSec, 1)} s
                    </strong>
                  </div>
                  <p style={{ margin: '4px 0 0', lineHeight: 1.45, opacity: 0.82, fontSize: 13 }}>{undercut.summary}</p>
                </div>
              ) : (
                <p style={{ margin: 0, color: 'var(--text-muted)', lineHeight: 1.45 }}>{tt(language, 'strategy.noRivalGap')}</p>
              )}
            </section>
          </div>

          {plan?.notes && plan.notes.length > 0 && (
            <section style={{ ...card, background: 'var(--surface-sunken)' }}>
              <div style={label}>{tt(language, 'strategy.notes')}</div>
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
            <div style={label}>{tt(language, 'strategy.incidentClips')}</div>
            <h3 style={{ margin: '6px 0 0' }}>{tt(language, 'strategy.incidentAnalysis', { count: clips.length })}</h3>
          </div>
          {clips.length > 0 && (
            <button onClick={() => void clearClips()} style={{ color: BAD }}>{tt(language, 'strategy.clearAll')}</button>
          )}
        </div>

        {clips.length === 0 ? (
          <p style={{ margin: '12px 0 0', color: 'var(--text-muted)', lineHeight: 1.45 }}>
            {tt(language, 'strategy.noIncidents')}
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
                      <strong style={{ fontSize: 15 }}>{tt(language, INCIDENT_KEY[clip.type])}</strong>
                      <span style={{ color: severity.color, fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 }}>{tt(language, severity.key)}</span>
                      <span style={{ opacity: 0.7, fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
                        {clip.lap ? tt(language, 'strategy.lap', { lap: clip.lap }) : tt(language, 'strategy.lapUnknown')}
                        {typeof clip.lapDistPct === 'number' ? ` · ${Math.round(clip.lapDistPct * 100)}%` : ''}
                        {' · '}
                        {clip.sampleCount} {tt(language, 'strategy.samples')}
                      </span>
                      <span style={{ opacity: 0.5, fontSize: 12 }}>{fmtClock(clip.createdAt, language)}</span>
                    </div>
                    <button onClick={() => void analyze(clip.id)} disabled={busyId === clip.id}>
                      {busyId === clip.id ? tt(language, 'strategy.analyzing') : tt(language, 'strategy.analyze')}
                    </button>
                  </div>
                  <p style={{ margin: '8px 0 0', lineHeight: 1.45, opacity: 0.9, fontSize: 13 }}>{clip.summary}</p>
                  {analysis && (
                    <p style={{ margin: '8px 0 0', lineHeight: 1.5, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                      {analysis.text} <small style={{ opacity: 0.55 }}>({analysis.source === 'llm' ? tt(language, 'strategy.localAi') : tt(language, 'strategy.deterministic')})</small>
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
