import { type CSSProperties, type ReactElement, useCallback, useEffect, useState } from 'react'
import type { AppViewProps } from '../App'
import { LapAnalysisSection } from './LapAnalysisSection'
import {
  COACH_CHANNELS,
  DEFAULT_COACH_CONFIG,
  type CoachConfig,
  type CoachExplainResult,
  type CoachFinding,
  type CoachReport,
  type CoachReportPayload,
  type CoachSectorSummary,
  type CoachSeverity
} from '../../../shared/coach'
import type { SetupReport, SetupSuggestion } from '../../../shared/setup-advisor'
import StintDebrief from './coach/StintDebrief'
import { TrackCoachingHeatmap } from '../components/TrackCoachingHeatmap'
import { useTrackMapData } from '../lib/track-map'
import { useTelemetrySelector } from '../lib/telemetry'
import { tt } from '../i18n'
import { formatMeasurement, type UnitSystem } from '../../../shared/units'
import { useUnitSystem } from '../lib/units'
import { localizeSetupSuggestion } from '../lib/setup-guidance'

// AI Coach + Setup Engineer (F2). Renders the DETERMINISTIC per-lap report from
// the `coach:` module: ranked findings (worst-first by estimated time loss),
// a sector strip (green only when a sector is at/above benchmark), and the setup
// advisor's concrete suggestions. The local LLM is optional — the explain button
// IA" button calls `coach:explain`, which falls back to deterministic phrasing
// whenever the model is off or slow. Warm chrome throughout; cool/green is
// reserved strictly for "good".

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return window.ipc.invoke<T>(channel, ...args)
}

function fmtTime(seconds?: number): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds - m * 60
  return m > 0 ? `${m}:${s.toFixed(3).padStart(6, '0')}` : s.toFixed(3)
}

function fmtDelta(seconds?: number): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return '—'
  return `${seconds >= 0 ? '+' : ''}${seconds.toFixed(2)}s`
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`
}

const SEVERITY_COLOR: Record<CoachSeverity, string> = {
  high: 'var(--accent-danger)',
  med: 'var(--accent-warning)',
  low: 'var(--text-muted)',
  good: 'var(--accent-success)'
}

const SEVERITY_LABEL: Record<CoachSeverity, string> = {
  high: 'High',
  med: 'Medium',
  low: 'Low',
  good: 'Good'
}

const PHASE_LABEL: Record<string, string> = { entry: 'Entry', mid: 'Mid', exit: 'Exit' }

const page: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 18 }

const panel: CSSProperties = {
  background: 'var(--surface-raised)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-6)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-4)'
}

const eyebrow: CSSProperties = {
  color: 'var(--text-muted)',
  fontFamily: '"Barlow Condensed", sans-serif',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.12em',
  textTransform: 'uppercase'
}

const title: CSSProperties = {
  color: 'var(--text-primary)',
  fontFamily: '"Rajdhani", sans-serif',
  fontSize: 20,
  fontWeight: 700,
  margin: 0
}

const sectionTitle: CSSProperties = { ...title, fontSize: 15 }

const chipRow: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8 }

const chip: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  background: 'var(--surface-sunken)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-secondary)',
  fontFamily: '"Barlow Condensed", sans-serif',
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: '0.04em',
  padding: '4px 10px',
  textTransform: 'uppercase'
}

const cardBase: CSSProperties = {
  background: 'var(--surface-sunken)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)',
  padding: 'var(--space-4)',
  display: 'flex',
  flexDirection: 'column',
  gap: 6
}

const primaryButton: CSSProperties = {
  alignSelf: 'flex-start',
  background: 'var(--accent-primary)',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-on-accent)',
  cursor: 'pointer',
  fontFamily: '"Barlow Condensed", sans-serif',
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.06em',
  padding: '6px 12px',
  textTransform: 'uppercase'
}

const mutedText: CSSProperties = { color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.5 }
const bodyText: CSSProperties = { color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.5 }

const tabButton: CSSProperties = {
  background: 'var(--surface-sunken)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  fontFamily: '"Barlow Condensed", sans-serif',
  fontSize: 13,
  fontWeight: 700,
  letterSpacing: '0.06em',
  padding: '8px 14px',
  textTransform: 'uppercase'
}

type CoachTab = 'report' | 'analysis'

// Mount points (SEAMS) reserved for other agents. The integrator replaces the
// placeholder bodies below with the real components — do not implement them here.
function TrackHeatMapSeam({ report, language }: { report: CoachReport | null; language: AppViewProps['language'] }): ReactElement {
  const { data } = useTrackMapData()
  const playerPct = useTelemetrySelector((s) => (typeof s?.lapDistPct === 'number' ? s.lapDistPct : undefined))
  return (
    <section style={panel}>
      <h2 style={sectionTitle}>{tt(language, 'coach.trackMap')}</h2>
      <TrackCoachingHeatmap mode="interactive" data={data} report={report} playerPct={playerPct} />
    </section>
  )
}

function StintDebriefSeam({ language }: { language: AppViewProps['language'] }): ReactElement {
  return (
    <section style={panel}>
      <h2 style={sectionTitle}>{tt(language, 'coach.stintDebrief')}</h2>
      <StintDebrief language={language} />
    </section>
  )
}

interface ExplainState {
  loading: boolean
  text?: string
  source?: CoachExplainResult['source']
}

export default function CoachView({ showToast, language }: AppViewProps): ReactElement {
  const unitSystem = useUnitSystem()
  const [tab, setTab] = useState<CoachTab>('report')
  const [report, setReport] = useState<CoachReport | null>(null)
  const [setup, setSetup] = useState<SetupReport | null>(null)
  const [useLlm, setUseLlm] = useState(DEFAULT_COACH_CONFIG.phraseWithAi)
  const [explains, setExplains] = useState<Record<string, ExplainState>>({})

  // The AI phrasing toggle is PERSISTED in the coach config (not local-only state, which
  // reset on navigation). Load it on mount, follow config broadcasts (cross-window),
  // and write through setConfig on toggle so it survives leaving the page.
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const cfg = await invoke<CoachConfig>(COACH_CHANNELS.getConfig)
        if (active && cfg) setUseLlm(cfg.phraseWithAi)
      } catch {
        // module may not be ready yet — the config broadcast will fill it in
      }
    })()
    const unsub = window.ipc.subscribe<CoachConfig>(COACH_CHANNELS.configEvent, (cfg) => {
      if (cfg) setUseLlm(cfg.phraseWithAi)
    })
    return () => {
      active = false
      unsub()
    }
  }, [])

  const togglePhraseWithAi = useCallback(async (next: boolean) => {
    setUseLlm(next) // optimistic; reconciled from the saved config below
    try {
      const saved = await invoke<CoachConfig>(COACH_CHANNELS.setConfig, { phraseWithAi: next })
      if (saved) setUseLlm(saved.phraseWithAi)
    } catch {
      // keep the optimistic value; a later config broadcast will reconcile
    }
  }, [])

  const applyPayload = useCallback((payload: CoachReportPayload | null) => {
    if (!payload) return
    setReport(payload.report)
    setSetup(payload.setup)
  }, [])

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const payload = await invoke<CoachReportPayload>(COACH_CHANNELS.getReport)
        if (active) applyPayload(payload)
      } catch {
        // module may not be ready yet — the subscription will fill it in
      }
    })()
    const unsub = window.ipc.subscribe<CoachReportPayload>(COACH_CHANNELS.report, (payload) => {
      applyPayload(payload)
      setExplains({}) // a new lap invalidates prior explanations
    })
    return () => {
      active = false
      unsub()
    }
  }, [applyPayload])

  const explain = useCallback(
    async (finding: CoachFinding) => {
      setExplains((prev) => ({ ...prev, [finding.id]: { loading: true, text: prev[finding.id]?.text, source: prev[finding.id]?.source } }))
      try {
        const result = await invoke<CoachExplainResult>(COACH_CHANNELS.explain, { findingId: finding.id, useLlm })
        setExplains((prev) => ({ ...prev, [finding.id]: { loading: false, text: result.text, source: result.source } }))
      } catch {
        setExplains((prev) => ({ ...prev, [finding.id]: { loading: false } }))
        showToast(tt(language, 'coach.explainFailed'), 'error')
      }
    },
    [useLlm, showToast]
  )

  const issues = (report?.findings ?? []).filter((f) => f.severity !== 'good')
  const goods = (report?.findings ?? []).filter((f) => f.severity === 'good')

  return (
    <div style={page}>
      <section style={panel}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={eyebrow}>{tt(language, 'coach.eyebrow')}</div>
            <h1 style={title}>{tt(language, 'coach.title')}</h1>
          </div>
          <label style={{ ...chip, cursor: 'pointer', textTransform: 'none' }}>
            <input type="checkbox" checked={useLlm} onChange={(e) => void togglePhraseWithAi(e.target.checked)} />
            {tt(language, 'coach.phraseWithAi')}
          </label>
        </div>
        <div style={chipRow}>
          <button
            type="button"
            style={{ ...tabButton, ...(tab === 'report' ? { background: 'var(--accent-primary)', color: 'var(--text-on-accent)', borderColor: 'var(--accent-primary)' } : {}) }}
            onClick={() => setTab('report')}
          >
            {tt(language, 'coach.summarySetup')}
          </button>
          <button
            type="button"
            style={{ ...tabButton, ...(tab === 'analysis' ? { background: 'var(--accent-primary)', color: 'var(--text-on-accent)', borderColor: 'var(--accent-primary)' } : {}) }}
            onClick={() => setTab('analysis')}
          >
            {tt(language, 'coach.analysisLive')}
          </button>
        </div>
      </section>

      {tab === 'analysis' ? (
        <LapAnalysisSection showToast={showToast} />
      ) : (
        <>
          <section style={panel}>
            <p style={bodyText}>{report?.summary ?? tt(language, 'coach.waitingFirstLap')}</p>
            {report && (
              <div style={chipRow}>
                {report.lapNumber !== undefined && <span style={chip}>{tt(language, 'coach.lap', { lap: report.lapNumber })}</span>}
                <span style={chip}>{tt(language, 'coach.time', { time: fmtTime(report.lapTimeSec) })}</span>
                <span style={{ ...chip, color: deltaColor(report.deltaToBestSec) }}>{tt(language, 'coach.bestDelta', { delta: fmtDelta(report.deltaToBestSec) })}</span>
                {report.consistency && (
                  <span style={chip}>
                    {tt(language, 'coach.consistency', { rating: report.consistency.rating })} · σ {report.consistency.stdevSec.toFixed(2)}s
                  </span>
                )}
                <span style={chip}>{tt(language, 'coach.samples', { count: report.sampleCount })}</span>
              </div>
            )}
          </section>

          <TrackHeatMapSeam report={report} language={language} />

          {report && (
            <section style={panel}>
              <h2 style={sectionTitle}>{tt(language, 'coach.sectors')}</h2>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${report.sectors.length}, minmax(140px, 1fr))`, gap: 12 }}>
                {report.sectors.map((s) => (
                  <SectorCard key={s.sector} sector={s} language={language} />
                ))}
              </div>
            </section>
          )}

          <section style={panel}>
            <h2 style={sectionTitle}>
              {tt(language, 'coach.improvementPoints')} {issues.length > 0 && <span style={mutedText}>{tt(language, 'coach.byTimeLoss')}</span>}
            </h2>
            {issues.length === 0 && <p style={mutedText}>{tt(language, 'coach.noRelevantLosses')}</p>}
            {issues.map((f) => (
              <FindingCard key={f.id} finding={f} explain={explains[f.id]} onExplain={() => explain(f)} language={language} />
            ))}
            {goods.length > 0 && (
              <div style={chipRow}>
                {goods.map((g) => (
                  <span key={g.id} style={{ ...chip, color: 'var(--accent-success)', borderColor: 'var(--accent-success)' }}>
                    ✓ {g.title}
                  </span>
                ))}
              </div>
            )}
          </section>

          <StintDebriefSeam language={language} />

          <section style={panel}>
            <h2 style={sectionTitle}>{tt(language, 'coach.setupSuggestions')}</h2>
            <p style={mutedText}>{tt(language, 'coach.setupRecommendationsAfterLap')}</p>
            {(setup?.suggestions ?? []).map((s) => (
              <SetupCard
                key={s.id}
                suggestion={s}
                language={language}
                unitSystem={unitSystem}
              />
            ))}
          </section>
        </>
      )}
    </div>
  )
}

function deltaColor(delta?: number): string {
  if (delta === undefined || !Number.isFinite(delta)) return 'var(--text-secondary)'
  return delta <= 0 ? 'var(--accent-success)' : 'var(--text-secondary)'
}

function SectorCard({ sector, language }: { sector: CoachSectorSummary; language: AppViewProps['language'] }): ReactElement {
  const unitSystem = useUnitSystem()
  const good = sector.benchmark
  return (
    <div
      style={{
        ...cardBase,
        borderColor: good ? 'var(--accent-success)' : 'var(--border-default)',
        boxShadow: good ? '0 0 0 1px var(--accent-success) inset' : 'none'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong style={{ color: 'var(--text-primary)', fontFamily: '"Rajdhani", sans-serif', fontSize: 15 }}>{tt(language, 'coach.sector', { sector: sector.sector })}</strong>
        <span style={{ ...chip, padding: '2px 8px', color: good ? 'var(--accent-success)' : deltaColor(sector.timeLossSec) }}>
          {good ? tt(language, 'coach.onPace') : `+${sector.timeLossSec.toFixed(2)}s`}
        </span>
      </div>
      <span style={mutedText}>Min speed {formatMeasurement(sector.minSpeedKmh, 'speed-kmh', unitSystem, { decimals: 0, includeUnit: true }).display}</span>
      <span style={mutedText}>
        {tt(language, 'coach.inputsSummary', { brake: pct(sector.brakePct), coast: pct(sector.coastPct), throttle: pct(sector.throttlePct) })}
      </span>
      {(sector.absSec > 0.3 || sector.tcSec > 0.3) && (
        <span style={mutedText}>
          {sector.absSec > 0.3 ? `ABS ${sector.absSec.toFixed(1)}s ` : ''}
          {sector.tcSec > 0.3 ? `TC ${sector.tcSec.toFixed(1)}s` : ''}
        </span>
      )}
    </div>
  )
}

function FindingCard({
  finding,
  explain,
  onExplain,
  language
}: {
  finding: CoachFinding
  explain?: ExplainState
  onExplain: () => void
  language: AppViewProps['language']
}): ReactElement {
  const color = SEVERITY_COLOR[finding.severity]
  return (
    <div style={{ ...cardBase, borderLeft: `3px solid ${color}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <strong style={{ color: 'var(--text-primary)', fontFamily: '"Rajdhani", sans-serif', fontSize: 15 }}>{finding.title}</strong>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {finding.phase && <span style={{ ...chip, padding: '2px 8px' }}>{PHASE_LABEL[finding.phase] ?? finding.phase}</span>}
          <span style={{ ...chip, padding: '2px 8px', color, borderColor: color }}>{SEVERITY_LABEL[finding.severity]}</span>
          {finding.estTimeLossSec > 0 && <span style={{ ...chip, padding: '2px 8px' }}>~{finding.estTimeLossSec.toFixed(2)}s</span>}
        </div>
      </div>
      <span style={bodyText}>{finding.detail}</span>
      <span style={mutedText}>{finding.evidence}</span>
      {explain?.text && (
        <div style={{ ...cardBase, background: 'var(--surface-raised)', gap: 4 }}>
          <span style={{ ...eyebrow, color: explain.source === 'llm' ? 'var(--accent-primary)' : 'var(--text-muted)' }}>
            {explain.source === 'llm' ? 'Local AI' : 'Deterministic'}
          </span>
          <span style={bodyText}>{explain.text}</span>
        </div>
      )}
      <button style={{ ...primaryButton, opacity: explain?.loading ? 0.6 : 1 }} onClick={onExplain} disabled={explain?.loading}>
        {explain?.loading ? tt(language, 'coach.explaining') : tt(language, 'coach.explain')}
      </button>
    </div>
  )
}

function SetupCard({
  suggestion,
  language,
  unitSystem
}: {
  suggestion: SetupSuggestion
  language: AppViewProps['language']
  unitSystem: UnitSystem
}): ReactElement {
  const localized = localizeSetupSuggestion(suggestion, language ?? 'en', unitSystem)
  if (!localized) {
    return (
      <div style={cardBase}>
        <span style={mutedText}>
          {tt(language, 'debrief.history.setup.structuredInsufficient')}
        </span>
      </div>
    )
  }
  return (
    <div style={cardBase}>
      <span style={eyebrow}>{localized.symptom}</span>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <strong style={{ color: 'var(--text-primary)', fontFamily: '"Rajdhani", sans-serif', fontSize: 15 }}>
            {localized.primary.change}
          </strong>
          <span style={mutedText}>{localized.primary.details}</span>
        </div>
        <span style={{ ...chip, padding: '2px 8px' }}>
          {tt(language, 'debrief.history.confidence', {
            confidence: tt(language, `debrief.history.confidence.${suggestion.confidence}`)
          })}
        </span>
      </div>
      <span style={bodyText}>{localized.rationale}</span>
      <span style={mutedText}>{localized.evidence}</span>
      {localized.alternatives.length > 0 && (
        <span style={mutedText}>
          {tt(language, 'coach.alternatives', {
            alternatives: localized.alternatives.map((alternative) => alternative.change).join(' · ')
          })}
        </span>
      )}
    </div>
  )
}
