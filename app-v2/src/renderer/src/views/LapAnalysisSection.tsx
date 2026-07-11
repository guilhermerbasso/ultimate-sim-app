import {
  type CSSProperties,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState
} from 'react'
import type { AppViewProps } from '../App'
import type {
  AnalysisLap,
  AnalysisLapDelta,
  AnalysisLapRef,
  AnalysisLapSample,
  AnalysisProfile,
  AnalysisResult,
  CoachingInsight,
  IbtFileInfo,
  IbtFileSummary,
  IbtLapSummary,
  LossPointInfo,
  RecordingConfig,
  RecordingLapSummary,
  RecordingSessionSummary,
  RecordingStatus,
  ReferenceLapSummary,
  TrackOption
} from '../../../shared/recording'
import { DEFAULT_RECORDING_CONFIG, RECORDING_CHANNELS } from '../../../shared/recording'
import {
  COACH_CHANNELS,
  DEFAULT_COACH_CONFIG,
  type CoachConfig,
  type CoachStatus,
  type CoachTip,
  type CoachTipsPayload
} from '../../../shared/coach'
import { convertMeasurement, formatMeasurement, measurementUnit, type UnitSystem } from '../../../shared/units'
import { useUnitSystem } from '../lib/units'

// ─────────────────────────────────────────────────────────────────────────────
// Screen "Telemetry analysis":
// 1. Escolhe fonte: gravações do app (JSONL) OU `.ibt` do iRacing.
// 2. Escolhe pista (derivada das gravações + .ibt indexados).
// 3. Marca até 8 laps e roda um perfil de análise:
//    • Comparar com minha melhor (default)
//    • Optimal lap (composição de melhores sectores)
//    • Onde perco tempo (mapa de regiões de perda)
// 4. Resultado mostra: sumário, gráficos sobrepostos (speed/throttle/brake),
//    gráfico de delta cumulativo vs a melhor e lista de loss points com dicas.
//
// Charts puros em SVG (sem libs externas) para encaixar nos guidelines da app.
// ─────────────────────────────────────────────────────────────────────────────

const SOURCE_RECORDING = 'recording' as const
const SOURCE_IBT = 'ibt' as const
type SourceKind = typeof SOURCE_RECORDING | typeof SOURCE_IBT
type AnalysisTab = 'analysis' | 'coach'

type MetricKey = 'speedKmh' | 'throttle' | 'brake'

interface LapCandidate {
  ref: AnalysisLapRef
  trackKey: string
  trackLabel: string
  carName?: string
  durationSec?: number
  lapNumber?: number
  source: SourceKind
  sourceLabel: string
  badge: string
  detail: string
  fileDate: number
}

const MAX_LAPS = 8

const card: CSSProperties = {
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 'var(--radius-sm)',
  background: 'rgba(255,255,255,0.045)',
  padding: 16,
  
}

const button: CSSProperties = {
  border: '1px solid rgba(255,255,255,0.14)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--accent-primary)',
  color: 'white',
  padding: '10px 14px',
  fontWeight: 700,
  cursor: 'pointer'
}

const ghostButton: CSSProperties = {
  ...button,
  background: 'rgba(255,255,255,0.08)'
}

const dangerButton: CSSProperties = {
  ...button,
  background: '#A4262C'
}

const subtleButton: CSSProperties = {
  border: '1px solid rgba(255,255,255,0.16)',
  borderRadius: 'var(--radius-sm)',
  background: 'rgba(255,255,255,0.05)',
  color: 'white',
  padding: '6px 10px',
  fontWeight: 600,
  cursor: 'pointer',
  fontSize: 12
}

const tabButton: CSSProperties = {
  ...subtleButton,
  padding: '8px 12px',
  fontSize: 13
}

const inputStyle: CSSProperties = {
  width: '100%',
  border: '1px solid rgba(255,255,255,0.14)',
  borderRadius: 'var(--radius-sm)',
  background: 'rgba(0,0,0,0.22)',
  color: 'white',
  padding: '10px 12px'
}

const selectStyle: CSSProperties = { ...inputStyle }
const muted: CSSProperties = { opacity: 0.72, fontSize: 13 }
const TRACK_ANY = '__any__'

const PROFILE_LABELS: Record<AnalysisProfile, { label: string; description: string }> = {
  compareBest: {
    label: 'Compare with my best',
    description: 'Overlays laps against your best and shows cumulative delta.'
  },
  optimal: {
    label: 'Optimal lap',
    description: 'Sums the best sector time across all laps.'
  },
  lossMap: {
    label: 'Where I lose time',
    description: 'Identifies track regions where each lap loses time, with tips.'
  }
}

type MetricConfig = { label: string; unit: string; min?: number; max?: number; toValue: (s: AnalysisLapSample) => number }

const metricConfig: Record<Exclude<MetricKey, 'speedKmh'>, MetricConfig> = {
  throttle: { label: 'Throttle', unit: '%', min: 0, max: 100, toValue: (s) => s.throttle * 100 },
  brake: { label: 'Brake', unit: '%', min: 0, max: 100, toValue: (s) => s.brake * 100 }
}

function configForMetric(metric: MetricKey, unitSystem: UnitSystem): MetricConfig {
  if (metric === 'speedKmh') {
    return {
      label: 'Speed',
      unit: measurementUnit('speed-kmh', unitSystem),
      toValue: (sample) => convertMeasurement(sample.speedKmh, 'speed-kmh', unitSystem) ?? Number.NaN
    }
  }
  return metricConfig[metric]
}

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return window.ipc.invoke<T>(channel, ...args)
}

function fmtTime(seconds?: number): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return '—'
  const min = Math.floor(seconds / 60)
  const sec = seconds - min * 60
  return `${min}:${sec.toFixed(3).padStart(6, '0')}`
}

function fmtDelta(seconds?: number): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return '—'
  const sign = seconds > 0 ? '+' : seconds < 0 ? '−' : ''
  return `${sign}${Math.abs(seconds).toFixed(3)}s`
}

function fmtLoss(seconds?: number): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return '—'
  if (seconds < 1) return `${Math.round(seconds * 1000)} ms`
  return `${seconds.toFixed(2)}s`
}

function fmtDate(timestamp: number | undefined): string {
  if (timestamp === undefined || !Number.isFinite(timestamp)) return '—'
  return new Date(timestamp).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

function fmtNumber(value: number | undefined, digits = 1): string {
  return value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(digits)
}

function fmtBytes(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  const mb = value / (1024 * 1024)
  if (mb >= 1) return `${mb.toFixed(1)} MB`
  return `${Math.round(value / 1024)} KB`
}

function toDateString(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10)
}

function trackKeyOf(name: string | undefined): string {
  if (!name) return '__unknown__'
  return name.toLowerCase().replace(/\s+/g, ' ').trim()
}

function trackLabelOf(name: string | undefined): string {
  return name?.trim() || 'Unknown track'
}

function lapKey(ref: AnalysisLapRef): string {
  return ref.source === 'recording'
    ? `rec:${ref.sessionId}:${ref.lapIndex}`
    : `ibt:${ref.path}:${ref.lapIndex}`
}

function pointsFor(samples: AnalysisLapSample[], config: MetricConfig, min: number, max: number, width: number, height: number): string {
  const span = max - min || 1
  return samples
    .map((sample) => {
      const value = config.toValue(sample)
      if (value === null || value === undefined || !Number.isFinite(value)) return null
      const x = Math.max(0, Math.min(1, sample.lapDistPct)) * width
      const y = height - ((value - min) / span) * height
      return `${x.toFixed(1)},${Math.max(0, Math.min(height, y)).toFixed(1)}`
    })
    .filter((p): p is string => Boolean(p))
    .join(' ')
}

function MetricChart({ metric, laps }: { metric: MetricKey; laps: AnalysisLap[] }): ReactElement {
  const unitSystem = useUnitSystem()
  const width = 920
  const height = 160
  const padding = { top: 18, right: 18, bottom: 28, left: 56 }
  const innerWidth = width - padding.left - padding.right
  const innerHeight = height - padding.top - padding.bottom
  const config = configForMetric(metric, unitSystem)
  const allValues = laps.flatMap((lap) => lap.samples.map((s) => config.toValue(s)).filter((v) => Number.isFinite(v)))
  const rawMin = allValues.length ? Math.min(...allValues) : 0
  const rawMax = allValues.length ? Math.max(...allValues) : 1
  const min = config.min ?? Math.max(0, rawMin - Math.max(1, Math.abs(rawMax - rawMin) * 0.08))
  const max = config.max ?? rawMax + Math.max(1, Math.abs(rawMax - rawMin) * 0.08)

  return (
    <div style={{ ...card, padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
        <strong>{config.label}</strong>
        <span style={muted}>{fmtNumber(min)} – {fmtNumber(max)} {config.unit}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label={`${config.label} by lap distance`}>
        <g transform={`translate(${padding.left} ${padding.top})`}>
          {[0, 0.25, 0.5, 0.75, 1].map((tick) => (
            <g key={tick}>
              <line x1={tick * innerWidth} y1={0} x2={tick * innerWidth} y2={innerHeight} stroke="rgba(255,255,255,0.08)" />
              <text x={tick * innerWidth} y={innerHeight + 22} fill="rgba(255,255,255,0.58)" fontSize="11" textAnchor="middle">
                {Math.round(tick * 100)}%
              </text>
            </g>
          ))}
          {[0, 0.5, 1].map((tick) => (
            <line key={tick} x1={0} y1={tick * innerHeight} x2={innerWidth} y2={tick * innerHeight} stroke="rgba(255,255,255,0.08)" />
          ))}
          {laps.map((lap) => {
            const points = pointsFor(lap.samples, config, min, max, innerWidth, innerHeight)
            if (!points) return null
            const stroke = lap.isBest ? '#FFFFFF' : lap.color
            const strokeWidth = lap.isBest ? 2.8 : 2.0
            return (
              <polyline
                key={lap.id}
                points={points}
                fill="none"
                stroke={stroke}
                strokeWidth={strokeWidth}
                strokeOpacity={lap.isBest ? 1 : 0.9}
              />
            )
          })}
        </g>
        <text x="8" y="25" fill="rgba(255,255,255,0.58)" fontSize="11">{fmtNumber(max)}</text>
        <text x="8" y={height - padding.bottom - 2} fill="rgba(255,255,255,0.58)" fontSize="11">{fmtNumber(min)}</text>
      </svg>
    </div>
  )
}

function DeltaChart({ deltas, laps }: { deltas: AnalysisLapDelta[]; laps: AnalysisLap[] }): ReactElement {
  const width = 920
  const height = 160
  const padding = { top: 18, right: 18, bottom: 28, left: 56 }
  const innerWidth = width - padding.left - padding.right
  const innerHeight = height - padding.top - padding.bottom
  const allValues = deltas.flatMap((d) => d.bins.map((b) => b.deltaSec).filter((v) => Number.isFinite(v)))
  const maxAbs = allValues.length ? Math.max(...allValues.map(Math.abs), 0.25) : 0.5
  const min = -maxAbs
  const max = maxAbs

  const yZero = padding.top + innerHeight - ((0 - min) / (max - min)) * innerHeight

  return (
    <div style={{ ...card, padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
        <strong>Cumulative delta vs best</strong>
        <span style={muted}>+{maxAbs.toFixed(2)}s above | −{maxAbs.toFixed(2)}s below</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label="Cumulative delta by distance">
        <line x1={padding.left} x2={width - padding.right} y1={yZero} y2={yZero} stroke="rgba(255,255,255,0.32)" strokeDasharray="3 3" />
        <g transform={`translate(${padding.left} ${padding.top})`}>
          {[0, 0.25, 0.5, 0.75, 1].map((tick) => (
            <g key={tick}>
              <line x1={tick * innerWidth} y1={0} x2={tick * innerWidth} y2={innerHeight} stroke="rgba(255,255,255,0.08)" />
              <text x={tick * innerWidth} y={innerHeight + 22} fill="rgba(255,255,255,0.58)" fontSize="11" textAnchor="middle">
                {Math.round(tick * 100)}%
              </text>
            </g>
          ))}
          {deltas.map((delta) => {
            const lap = laps.find((l) => l.id === delta.lapId)
            if (!lap || lap.isBest) return null
            const points = delta.bins
              .map((bin) => {
                const x = bin.distancePct * innerWidth
                const y = innerHeight - ((bin.deltaSec - min) / (max - min)) * innerHeight
                return `${x.toFixed(1)},${Math.max(0, Math.min(innerHeight, y)).toFixed(1)}`
              })
              .join(' ')
            return <polyline key={delta.lapId} points={points} fill="none" stroke={lap.color} strokeWidth="2.4" strokeOpacity="0.95" />
          })}
        </g>
        <text x="8" y={padding.top + 12} fill="rgba(255,255,255,0.58)" fontSize="11">+{maxAbs.toFixed(2)}s</text>
        <text x="8" y={height - padding.bottom + 2} fill="rgba(255,255,255,0.58)" fontSize="11">−{maxAbs.toFixed(2)}s</text>
      </svg>
    </div>
  )
}

function LapBadge({ lap }: { lap: AnalysisLap }): ReactElement {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 8px',
        borderRadius: 'var(--radius-sm)',
        border: `1px solid ${lap.color}66`,
        background: `${lap.color}22`,
        color: 'white',
        fontSize: 12,
        fontWeight: 600
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: 'var(--radius-sm)', background: lap.color }} />
      {lap.label}
      {lap.isBest ? ' · best' : ''}
      {lap.durationSec !== undefined ? ` · ${fmtTime(lap.durationSec)}` : ''}
    </span>
  )
}

function LossPointList({ losses, laps }: { losses: AnalysisResult['losses']; laps: AnalysisLap[] }): ReactElement {
  const unitSystem = useUnitSystem()
  const speedUnit = measurementUnit('speed-kmh', unitSystem)
  if (losses.length === 0) {
    return <div style={card}>No losses calculated (only the best lap selected?).</div>
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {losses.map((lapLoss) => {
        const lap = laps.find((l) => l.id === lapLoss.lapId)
        if (!lap) return null
        return (
          <div key={lap.id} style={{ ...card, borderColor: `${lap.color}66` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <LapBadge lap={lap} />
              <span style={muted}>Total lost: <strong style={{ color: 'var(--accent-warning)' }}>{fmtDelta(lapLoss.totalLossSec)}</strong></span>
            </div>
            {lapLoss.points.length === 0 ? (
              <p style={{ ...muted, margin: 0 }}>{lapLoss.summary.join(' ')}</p>
            ) : (
              <ol style={{ paddingLeft: 18, margin: 0, display: 'grid', gap: 8 }}>
                {lapLoss.points.map((point: LossPointInfo, idx) => (
                  <li key={`${point.fromPct.toFixed(3)}-${idx}`} style={{ display: 'grid', gap: 4 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span>
                        <strong>{(point.fromPct * 100).toFixed(1)}% → {(point.toPct * 100).toFixed(1)}%</strong>
                      </span>
                      <span style={{ color: 'var(--accent-warning)', fontWeight: 700 }}>{fmtDelta(point.lossSec)}</span>
                    </div>
                    <div style={{ ...muted, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                      <span>Peak speed {formatMeasurement(point.primaryMaxSpeedKmh, 'speed-kmh', unitSystem, { decimals: 0 }).display} {speedUnit} (best {formatMeasurement(point.bestMaxSpeedKmh, 'speed-kmh', unitSystem, { decimals: 0 }).display})</span>
                      <span>Min speed {formatMeasurement(point.primaryMinSpeedKmh, 'speed-kmh', unitSystem, { decimals: 0 }).display} {speedUnit} (best {formatMeasurement(point.bestMinSpeedKmh, 'speed-kmh', unitSystem, { decimals: 0 }).display})</span>
                      <span>Avg throttle {Math.round(point.primaryAvgThrottle * 100)}% (best {Math.round(point.bestAvgThrottle * 100)}%)</span>
                      <span>Peak brake {Math.round(point.primaryMaxBrake * 100)}% (best {Math.round(point.bestMaxBrake * 100)}%)</span>
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {point.tips.map((tip, i) => (
                        <li key={i}>{tip}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )
      })}
    </div>
  )
}

function buildRecordingCandidates(sessions: RecordingSessionSummary[], unitSystem: UnitSystem): LapCandidate[] {
  const out: LapCandidate[] = []
  for (const session of sessions) {
    const trackName = (session as RecordingSessionSummary & { trackName?: string }).trackName
    const carName = (session as RecordingSessionSummary & { carName?: string }).carName
    const trackLabel = trackLabelOf(trackName)
    const trackKey = trackKeyOf(trackName)
    for (const lap of session.laps) {
      out.push({
        ref: { source: 'recording', sessionId: session.id, lapIndex: lap.lapIndex, trackKey },
        trackKey,
        trackLabel,
        carName,
        durationSec: lap.durationSec,
        lapNumber: lap.lapNumber ?? lap.lapIndex + 1,
        source: SOURCE_RECORDING,
        sourceLabel: `Recording · ${fmtDate(session.startedAt)}`,
        badge: lap.complete ? 'completa' : 'parcial',
        detail: describeRecordingLap(session, lap, unitSystem),
        fileDate: session.startedAt
      })
    }
  }
  return out
}

function describeRecordingLap(session: RecordingSessionSummary, lap: RecordingLapSummary, unitSystem: UnitSystem): string {
  const parts: string[] = []
  parts.push(`Session ${session.source}`)
  if (typeof lap.minSpeedKmh === 'number') parts.push(`min ${formatMeasurement(lap.minSpeedKmh, 'speed-kmh', unitSystem, { decimals: 0, includeUnit: true }).display}`)
  if (typeof lap.maxSpeedKmh === 'number') parts.push(`max ${formatMeasurement(lap.maxSpeedKmh, 'speed-kmh', unitSystem, { decimals: 0, includeUnit: true }).display}`)
  if (typeof lap.bestDeltaToBestSec === 'number') parts.push(`δ ${fmtDelta(lap.bestDeltaToBestSec)}`)
  return parts.join(' · ')
}

function buildIbtCandidates(files: IbtFileSummary[]): LapCandidate[] {
  const out: LapCandidate[] = []
  for (const file of files) {
    const trackKey = trackKeyOf(file.trackName)
    const trackLabel = trackLabelOf(file.trackName)
    for (const lap of file.laps) {
      out.push({
        ref: { source: 'ibt', path: file.path, lapIndex: lap.lapIndex, trackKey },
        trackKey,
        trackLabel,
        carName: file.carName,
        durationSec: lap.durationSec,
        lapNumber: lap.lapNumber ?? lap.lapIndex + 1,
        source: SOURCE_IBT,
        sourceLabel: `iRacing · ${file.fileName}`,
        badge: lap.complete ? 'completa' : 'parcial',
        detail: describeIbtLap(file, lap),
        fileDate: file.modifiedAt
      })
    }
  }
  return out
}

function describeIbtLap(file: IbtFileSummary, lap: IbtLapSummary): string {
  const parts: string[] = []
  if (file.sessionType) parts.push(file.sessionType)
  if (typeof lap.startedAtSec === 'number') parts.push(`t=${lap.startedAtSec.toFixed(0)}s`)
  if (file.carName) parts.push(file.carName)
  return parts.join(' · ')
}

// Telemetry analysis — absorbed into AI Coach (the single ANALYSIS hub).
// Self-contained section: offline lap analysis (recordings + .ibt) and the
// deterministic Live Coach. Rendered by CoachView; no longer a standalone view.
export function LapAnalysisSection({ showToast }: Pick<AppViewProps, 'showToast'>): ReactElement {
  const unitSystem = useUnitSystem()
  const [activeTab, setActiveTab] = useState<AnalysisTab>('analysis')
  const [status, setStatus] = useState<RecordingStatus | null>(null)
  const [recordingConfig, setRecordingConfig] = useState<RecordingConfig>(DEFAULT_RECORDING_CONFIG)
  const [sessions, setSessions] = useState<RecordingSessionSummary[]>([])
  const [tracks, setTracks] = useState<TrackOption[]>([])
  const [ibtFolder, setIbtFolder] = useState<string>('')
  const [ibtFolderDefault, setIbtFolderDefault] = useState<string>('')
  const [ibtFiles, setIbtFiles] = useState<IbtFileInfo[]>([])
  const [ibtSummaries, setIbtSummaries] = useState<Record<string, IbtFileSummary>>({})
  const [sourceKind, setSourceKind] = useState<SourceKind>(SOURCE_RECORDING)
  const [trackKey, setTrackKey] = useState<string>(TRACK_ANY)
  const [profile, setProfile] = useState<AnalysisProfile>('compareBest')
  const [selectedLaps, setSelectedLaps] = useState<AnalysisLapRef[]>([])
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [references, setReferences] = useState<ReferenceLapSummary[]>([])
  const [selectedReferenceId, setSelectedReferenceId] = useState<string>('')
  const [csvPath, setCsvPath] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [scanningIbt, setScanningIbt] = useState(false)
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc')
  const [filterFrom, setFilterFrom] = useState<string>('')
  const [filterTo, setFilterTo] = useState<string>('')
  const [coachStatus, setCoachStatus] = useState<CoachStatus | null>(null)
  const [coachTips, setCoachTips] = useState<CoachTip[]>([])
  const [coachBusy, setCoachBusy] = useState(false)
  const [coachConfig, setCoachConfig] = useState<CoachConfig>(DEFAULT_COACH_CONFIG)

  const loadSessions = useCallback(async () => {
    const next = await invoke<RecordingSessionSummary[]>('recording:listSessions')
    setSessions(next)
  }, [])

  const loadReferences = useCallback(async () => {
    const next = await invoke<ReferenceLapSummary[]>('recording:references:list')
    setReferences(next)
    setSelectedReferenceId((current) => current && next.some((ref) => ref.id === current) ? current : '')
  }, [])

  const loadTracks = useCallback(async () => {
    try {
      const next = await invoke<TrackOption[]>('recording:listTracks', ibtFolder || undefined)
      setTracks(next)
    } catch {
      // best-effort: se a pasta .ibt for inválida, mantém pistas existentes
    }
  }, [ibtFolder])

  const refresh = useCallback(async () => {
    const [nextStatus] = await Promise.all([
      invoke<RecordingStatus>('recording:status'),
      loadSessions(),
      loadTracks(),
      loadReferences()
    ])
    setStatus(nextStatus)
  }, [loadReferences, loadSessions, loadTracks])

  const applyCoachPayload = useCallback((payload: CoachTipsPayload) => {
    setCoachStatus(payload.status)
    setCoachTips(payload.tips)
  }, [])

  const refreshCoach = useCallback(async () => {
    const payload = await invoke<CoachTipsPayload>(COACH_CHANNELS.tips)
    applyCoachPayload(payload)
  }, [applyCoachPayload])

  useEffect(() => {
    void (async () => {
      try {
        const def = await invoke<string>('recording:defaultIbtFolder')
        setIbtFolderDefault(def)
        setIbtFolder((current) => current || def)
      } catch {
        // ignora — pasta default só serve de hint
      }
    })()
  }, [])

  useEffect(() => {
    void refresh().catch((error: unknown) =>
      showToast(error instanceof Error ? error.message : String(error), 'error')
    )
    return window.ipc.subscribe<RecordingStatus>('recording:statusChanged', (next) => {
      setStatus(next)
      void loadSessions()
    })
  }, [loadSessions, refresh, showToast])

  useEffect(() => {
    void window.ipc
      .invoke<RecordingConfig>(RECORDING_CHANNELS.getConfig)
      .then(setRecordingConfig)
      .catch(() => undefined)
    return window.ipc.subscribe<RecordingConfig>(RECORDING_CHANNELS.configEvent, setRecordingConfig)
  }, [])

  useEffect(() => {
    if (activeTab !== 'coach') return undefined
    void refreshCoach().catch((error: unknown) => {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    })
    return window.ipc.subscribe<CoachTipsPayload>(COACH_CHANNELS.updated, applyCoachPayload)
  }, [activeTab, applyCoachPayload, refreshCoach, showToast])

  // Persisted coach config (enabled / speakTopTip). Load once + follow broadcasts so
  // the Iniciar/Parar button and the speak checkbox reflect the auto-started state.
  useEffect(() => {
    void window.ipc
      .invoke<CoachConfig>(COACH_CHANNELS.getConfig)
      .then(setCoachConfig)
      .catch(() => undefined)
    return window.ipc.subscribe<CoachConfig>(COACH_CHANNELS.configEvent, setCoachConfig)
  }, [])

  const scanIbt = useCallback(async (folderArg?: string) => {
    if (sourceKind !== SOURCE_IBT) return
    const folder = folderArg ?? ibtFolder
    setScanningIbt(true)
    try {
      const list = await invoke<IbtFileInfo[]>('recording:listIbt', folder || undefined)
      setIbtFiles(list)
      const summaries: Record<string, IbtFileSummary> = {}
      for (const file of list) {
        try {
          const summary = await invoke<IbtFileSummary>('recording:loadIbt', file.path)
          summaries[file.path] = summary
        } catch (error) {
          showToast(`Failed to read ${file.fileName}: ${error instanceof Error ? error.message : String(error)}`, 'error')
        }
      }
      setIbtSummaries(summaries)
      await loadTracks()
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setScanningIbt(false)
    }
  }, [ibtFolder, loadTracks, showToast, sourceKind])

  useEffect(() => {
    if (sourceKind !== SOURCE_IBT) return
    void scanIbt()
  }, [sourceKind, scanIbt])

  const candidates = useMemo<LapCandidate[]>(() => {
    if (sourceKind === SOURCE_RECORDING) return buildRecordingCandidates(sessions, unitSystem)
    return buildIbtCandidates(Object.values(ibtSummaries))
  }, [sourceKind, sessions, ibtSummaries, unitSystem])

  const trackOptions = useMemo<TrackOption[]>(() => {
    const fromSource = sourceKind === SOURCE_RECORDING ? 'recording' : 'ibt'
    return tracks.filter((t) => t.sources.includes(fromSource))
  }, [tracks, sourceKind])

  const filteredCandidates = useMemo<LapCandidate[]>(() => {
    let list = trackKey === TRACK_ANY ? candidates : candidates.filter((c) => c.trackKey === trackKey)
    if (filterFrom) list = list.filter((c) => toDateString(c.fileDate) >= filterFrom)
    if (filterTo) list = list.filter((c) => toDateString(c.fileDate) <= filterTo)
    return [...list].sort((a, b) => sortDir === 'desc' ? b.fileDate - a.fileDate : a.fileDate - b.fileDate)
  }, [candidates, trackKey, filterFrom, filterTo, sortDir])

  const selectedKeys = useMemo(() => new Set(selectedLaps.map(lapKey)), [selectedLaps])

  const toggleLap = useCallback(
    (ref: AnalysisLapRef) => {
      setSelectedLaps((current) => {
        const key = lapKey(ref)
        if (current.some((r) => lapKey(r) === key)) {
          return current.filter((r) => lapKey(r) !== key)
        }
        if (current.length >= MAX_LAPS) {
          showToast(`Maximum of ${MAX_LAPS} laps per analysis.`, 'info')
          return current
        }
        return [...current, ref]
      })
    },
    [showToast]
  )

  const clearSelection = useCallback(() => setSelectedLaps([]), [])

  const saveReferenceFromLap = useCallback(async (ref: AnalysisLapRef) => {
    setBusy(true)
    try {
      const saved = await invoke<ReferenceLapSummary>('recording:references:saveFromLap', { ref })
      await loadReferences()
      setSelectedReferenceId(saved.id)
      showToast('Reference saved.', 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }, [loadReferences, showToast])

  const deleteReference = useCallback(async (id: string) => {
    setBusy(true)
    try {
      const next = await invoke<ReferenceLapSummary[]>('recording:references:delete', id)
      setReferences(next)
      setSelectedReferenceId((current) => current === id ? '' : current)
      showToast('Reference removed.', 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }, [showToast])

  const importCsvReference = useCallback(async () => {
    if (!csvPath.trim()) {
      showToast('Enter the CSV path.', 'info')
      return
    }
    setBusy(true)
    try {
      const imported = await invoke<{ summary: ReferenceLapSummary; samples: AnalysisLapSample[] }>('recording:importCsv', csvPath.trim())
      await loadReferences()
      setSelectedReferenceId(imported.summary.id)
      showToast('CSV imported as reference.', 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }, [csvPath, loadReferences, showToast])

  const startRecording = useCallback(async () => {
    setBusy(true)
    try {
      const next = await invoke<RecordingStatus>('recording:start', { sampleRateHz: 15 })
      setStatus(next)
      showToast('Recording started.', 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }, [showToast])

  const toggleAutoRecord = useCallback(async (next: boolean) => {
    setRecordingConfig((current) => ({ ...current, autoRecord: next }))
    try {
      const saved = await invoke<RecordingConfig>(RECORDING_CHANNELS.setConfig, { autoRecord: next })
      setRecordingConfig(saved)
      showToast(next ? 'Automatic recording enabled.' : 'Automatic recording disabled.', 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    }
  }, [showToast])

  const openRecordingsFolder = useCallback(async () => {
    try {
      const result = await invoke<string>(RECORDING_CHANNELS.openFolder)
      if (result) showToast(`Could not open folder: ${result}`, 'error')
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    }
  }, [showToast])

  const stopRecording = useCallback(async () => {
    setBusy(true)
    try {
      const next = await invoke<RecordingStatus>('recording:stop')
      setStatus(next)
      await loadSessions()
      showToast('Recording finished.', 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }, [loadSessions, showToast])

  const setCoachConfigPatch = useCallback(
    async (patch: { enabled?: boolean; speakTopTip?: boolean }, success?: string) => {
      setCoachBusy(true)
      try {
        const saved = await invoke<CoachConfig>(COACH_CHANNELS.setConfig, patch)
        setCoachConfig(saved)
        if (success) showToast(success, 'success')
      } catch (error) {
        showToast(error instanceof Error ? error.message : String(error), 'error')
      } finally {
        setCoachBusy(false)
      }
    },
    [showToast]
  )

  // "Iniciar/Parar" now toggles the persisted `enabled` flag: the engine auto-starts
  // on live telemetry when enabled (no click needed on a fresh install) and the
  // button disables it to make "Parar" stick.
  const enableCoach = useCallback(
    () => setCoachConfigPatch({ enabled: true }, 'Live Coach enabled (starts automatically with telemetry).'),
    [setCoachConfigPatch]
  )

  const disableCoach = useCallback(
    () => setCoachConfigPatch({ enabled: false }, 'Live Coach desativado.'),
    [setCoachConfigPatch]
  )

  const setCoachSpeak = useCallback(
    (speakTopTip: boolean) => void setCoachConfigPatch({ speakTopTip }),
    [setCoachConfigPatch]
  )

  const runAnalysis = useCallback(async () => {
    if (selectedLaps.length === 0) {
      showToast('Select at least one lap.', 'info')
      return
    }
    setAnalyzing(true)
    try {
      const effectiveKey = trackKey === TRACK_ANY ? undefined : trackKey
      const channel = selectedReferenceId ? 'recording:insights' : 'recording:analyze'
      const next = await invoke<AnalysisResult>(channel, {
        profile: selectedReferenceId ? 'lossMap' : profile,
        laps: selectedLaps,
        trackKey: effectiveKey,
        referenceId: selectedReferenceId || undefined,
        withInsights: Boolean(selectedReferenceId)
      })
      setResult(next)
      showToast(`Analysis complete: ${next.laps.length} lap(s).`, 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setAnalyzing(false)
    }
  }, [profile, selectedLaps, selectedReferenceId, showToast, trackKey])

  const bestLap = useMemo(() => result?.laps.find((l) => l.id === result?.bestLapId) ?? null, [result])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ ...card, display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16 }}>
        <div>
          <h3 style={{ margin: '0 0 6px' }}>Telemetry analysis</h3>
          <p style={{ ...muted, margin: 0 }}>
            Combines app recordings with iRacing <code>.ibt</code> files. Choose the source, track
            and laps, then run an analysis profile to see where you can gain time.
          </p>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ ...muted, color: status?.recording ? 'var(--accent-primary)' : undefined }}>
            {status?.recording ? `REC · ${status.activeSession?.sampleCount ?? 0} samples` : 'Ready to record'}
          </span>
          <label
            style={{ ...muted, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
            title="Starts recording automatically when telemetry connects."
          >
            <input
              type="checkbox"
              checked={recordingConfig.autoRecord}
              onChange={(event) => void toggleAutoRecord(event.target.checked)}
            />
            Auto-gravar
          </label>
          {status?.recording ? (
            <button disabled={busy} onClick={() => void stopRecording()} style={dangerButton} type="button">Stop recording</button>
          ) : (
            <button disabled={busy} onClick={() => void startRecording()} style={button} type="button">Start recording</button>
          )}
          <button onClick={() => void openRecordingsFolder()} style={ghostButton} type="button" title="Opens the folder where recordings are saved.">
            Open recordings folder
          </button>
          <button disabled={busy} onClick={() => void refresh()} style={ghostButton} type="button">Refresh</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          style={{
            ...tabButton,
            background: activeTab === 'analysis' ? 'var(--accent-primary)' : tabButton.background
          }}
          onClick={() => setActiveTab('analysis')}
        >
          Offline analysis
        </button>
        <button
          type="button"
          style={{
            ...tabButton,
            background: activeTab === 'coach' ? 'var(--accent-primary)' : tabButton.background
          }}
          onClick={() => setActiveTab('coach')}
        >
          Live Coach
        </button>
      </div>

      {activeTab === 'coach' ? (
        <LiveCoachPanel
          status={coachStatus}
          tips={coachTips}
          busy={coachBusy}
          enabled={coachConfig.enabled}
          speakTopTip={coachConfig.speakTopTip}
          onSpeakTopTipChange={setCoachSpeak}
          onEnable={() => void enableCoach()}
          onDisable={() => void disableCoach()}
          onRefresh={() => void refreshCoach()}
        />
      ) : (
        <>
      <div style={{ ...card, display: 'grid', gap: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={muted}>Source</span>
            <select value={sourceKind} onChange={(e) => setSourceKind(e.target.value as SourceKind)} style={selectStyle}>
              <option value={SOURCE_RECORDING}>App recordings</option>
              <option value={SOURCE_IBT}>iRacing .ibt</option>
            </select>
          </label>

          <label style={{ display: 'grid', gap: 6 }}>
            <span style={muted}>Track</span>
            <select value={trackKey} onChange={(e) => setTrackKey(e.target.value)} style={selectStyle}>
              <option value={TRACK_ANY}>All tracks</option>
              {trackOptions.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label} ({t.lapCount} laps)
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: 'grid', gap: 6 }}>
            <span style={muted}>Analysis profile</span>
            <select value={profile} onChange={(e) => setProfile(e.target.value as AnalysisProfile)} style={selectStyle}>
              {(Object.keys(PROFILE_LABELS) as AnalysisProfile[]).map((p) => (
                <option key={p} value={p}>{PROFILE_LABELS[p].label}</option>
              ))}
            </select>
          </label>

          <div style={{ display: 'grid', gap: 6 }}>
            <span style={muted}>Laps selecionadas</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <strong style={{ fontSize: 18 }}>{selectedLaps.length} / {MAX_LAPS}</strong>
              <button type="button" style={subtleButton} disabled={selectedLaps.length === 0} onClick={clearSelection}>Limpar</button>
            </div>
          </div>
        </div>

        <div style={{ ...muted, marginTop: -6 }}>{PROFILE_LABELS[profile].description}</div>

        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr 1fr', gap: 10, alignItems: 'end' }}>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={muted}>Ordenar por data</span>
            <select value={sortDir} onChange={(e) => setSortDir(e.target.value as 'desc' | 'asc')} style={{ ...selectStyle, width: 'auto' }}>
              <option value="desc">Data ↓ (mais recente)</option>
              <option value="asc">Data ↑ (mais antiga)</option>
            </select>
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={muted}>From</span>
            <input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} style={{ ...inputStyle, colorScheme: 'dark' }} />
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={muted}>Up to</span>
            <input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} style={{ ...inputStyle, colorScheme: 'dark' }} />
          </label>
        </div>

        {sourceKind === SOURCE_IBT && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 10, alignItems: 'end' }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={muted}>iRacing .ibt folder (default: {ibtFolderDefault || 'Documents/iRacing/telemetry'})</span>
              <input
                value={ibtFolder}
                onChange={(e) => setIbtFolder(e.target.value)}
                placeholder={ibtFolderDefault || 'C:/Users/.../Documents/iRacing/telemetry'}
                style={inputStyle}
              />
            </label>
            <button type="button" style={ghostButton} onClick={() => void scanIbt()} disabled={scanningIbt}>
              {scanningIbt ? 'Lendo…' : 'Reescanear'}
            </button>
            <button type="button" style={subtleButton} onClick={() => { setIbtFolder(ibtFolderDefault); void scanIbt(ibtFolderDefault) }} disabled={!ibtFolderDefault}>
              Default folder
            </button>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={muted}>
            {filteredCandidates.length} lap(s) available — click to include in the analysis.
          </span>
          <button
            type="button"
            style={{ ...button, opacity: selectedLaps.length === 0 || analyzing ? 0.5 : 1 }}
            disabled={selectedLaps.length === 0 || analyzing}
            onClick={() => void runAnalysis()}
          >
            {analyzing ? 'Analyzing…' : `Run analysis (${selectedLaps.length})`}
          </button>
        </div>

        <ReferencesPanel
          references={references}
          selectedReferenceId={selectedReferenceId}
          csvPath={csvPath}
          busy={busy}
          onSelect={setSelectedReferenceId}
          onDelete={(id) => void deleteReference(id)}
          onCsvPathChange={setCsvPath}
          onImportCsv={() => void importCsvReference()}
        />

        <LapPool candidates={filteredCandidates} selected={selectedKeys} onToggle={toggleLap} onSaveReference={(ref) => void saveReferenceFromLap(ref)} />
      </div>

      {sourceKind === SOURCE_IBT && (
        <IbtIndexSummary files={ibtFiles} summaries={ibtSummaries} />
      )}

      {result ? (
        <AnalysisResultView result={result} bestLap={bestLap} />
      ) : (
        <div style={card}>Select laps and click <strong>Run analysis</strong> to see charts, delta, and loss points.</div>
      )}
        </>
      )}
    </div>
  )
}

function LiveCoachPanel({
  status,
  tips,
  busy,
  enabled,
  speakTopTip,
  onSpeakTopTipChange,
  onEnable,
  onDisable,
  onRefresh
}: {
  status: CoachStatus | null
  tips: CoachTip[]
  busy: boolean
  enabled: boolean
  speakTopTip: boolean
  onSpeakTopTipChange: (enabled: boolean) => void
  onEnable: () => void
  onDisable: () => void
  onRefresh: () => void
}): ReactElement {
  const running = status?.running === true
  // Status text reflects BOTH the persisted toggle and the live engine: running with
  // sample count when active; "armed, waiting for telemetry" when enabled but idle;
  // "off" when the user disabled it.
  const statusLabel = running
    ? `ON · ${status?.sampleCount ?? 0} samples`
    : enabled
      ? 'Active · waiting for telemetry'
      : 'Off'
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ ...card, display: 'grid', gridTemplateColumns: '1.2fr auto', gap: 16, alignItems: 'center' }}>
        <div>
          <h3 style={{ margin: '0 0 6px' }}>Live Coach</h3>
          <p style={{ ...muted, margin: 0 }}>
            Deterministic/offline coach: uses delta to best, inputs, and live telemetry to prioritize tips by estimated loss.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ ...muted, color: running ? 'var(--accent-primary)' : undefined }}>
            {statusLabel}
          </span>
          {enabled ? (
            <button type="button" style={dangerButton} disabled={busy} onClick={onDisable}>Stop</button>
          ) : (
            <button type="button" style={button} disabled={busy} onClick={onEnable}>Start</button>
          )}
          <button type="button" style={ghostButton} disabled={busy} onClick={onRefresh}>Refresh</button>
        </div>
      </div>

      <div style={{ ...card, display: 'grid', gap: 10 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={speakTopTip}
            onChange={(event) => onSpeakTopTipChange(event.target.checked)}
          />
          <span>Falar top tip via Voice Spotter</span>
        </label>
        <div style={muted}>
          On by default: Live Coach starts automatically with telemetry and speaks the tip
          with the highest priority (respecting severity and speech interval) in the selected voice.
        </div>
      </div>

      <CoachTipsList tips={tips} running={running} />
    </div>
  )
}

function CoachTipsList({ tips, running }: { tips: CoachTip[]; running: boolean }): ReactElement {
  if (!running) {
    return <div style={card}>Connect telemetry (on track, out of the pits) so Live Coach can start prioritizing tips automatically.</div>
  }
  if (tips.length === 0) {
    return <div style={card}>Waiting for enough data to detect loss patterns.</div>
  }
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {tips.map((tip, index) => {
        const color = coachSeverityColor(tip.severity)
        return (
          <div
            key={tip.id}
            style={{
              ...card,
              borderColor: `${color}99`,
              background: tip.severity === 'good' ? 'rgba(16,124,16,0.12)' : 'rgba(255,185,0,0.08)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
              <strong>
                #{index + 1} {tip.sector ? `· Sector ${tip.sector}` : '· Geral'}
              </strong>
              <span style={{ color, fontWeight: 800 }}>
                {coachSeverityLabel(tip.severity)} · {fmtLoss(tip.estTimeLossSec)}
              </span>
            </div>
            <p style={{ margin: '0 0 6px' }}>{tip.message}</p>
            {tip.evidence ? <div style={muted}>{tip.evidence}</div> : null}
          </div>
        )
      })}
    </div>
  )
}

function coachSeverityLabel(severity: CoachTip['severity']): string {
  switch (severity) {
    case 'high': return 'High'
    case 'med': return 'Medium'
    case 'low': return 'Low'
    case 'good': return 'Bom'
  }
}

function coachSeverityColor(severity: CoachTip['severity']): string {
  switch (severity) {
    case 'high': return 'var(--accent-danger)'
    case 'med': return 'var(--accent-warning)'
    case 'low': return '#F7630C'
    case 'good': return '#107C10'
  }
}

function LapPool({
  candidates,
  selected,
  onToggle,
  onSaveReference
}: {
  candidates: LapCandidate[]
  selected: Set<string>
  onToggle: (ref: AnalysisLapRef) => void
  onSaveReference: (ref: AnalysisLapRef) => void
}): ReactElement {
  if (candidates.length === 0) {
    return <div style={{ ...card, padding: 12, color: 'rgba(255,255,255,0.7)' }}>No laps found for the selected source/track.</div>
  }
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: 8,
        maxHeight: 320,
        overflowY: 'auto',
        padding: 4
      }}
    >
      {candidates.map((c) => {
        const key = lapKey(c.ref)
        const isSelected = selected.has(key)
        return (
          <div
            key={key}
            style={{
              border: `1px solid ${isSelected ? 'var(--accent-primary)' : 'rgba(255,255,255,0.12)'}`,
              borderRadius: 'var(--radius-sm)',
              background: isSelected ? 'rgba(var(--accent-rgb),0.12)' : 'rgba(255,255,255,0.04)',
              padding: 10,
              color: 'white',
              display: 'grid',
              gap: 8
            }}
          >
            <button type="button" onClick={() => onToggle(c.ref)} style={{ all: 'unset', cursor: 'pointer', display: 'grid', gap: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <strong>{c.trackLabel} · Lap {c.lapNumber}</strong>
                <span style={{ ...muted, color: c.badge === 'completa' ? 'var(--accent-primary)' : 'var(--accent-warning)' }}>{c.badge}</span>
              </div>
              <div style={muted}>{c.sourceLabel} · {fmtTime(c.durationSec)}</div>
              {c.detail ? <div style={muted}>{c.detail}</div> : null}
            </button>
            {isSelected ? (
              <button type="button" style={subtleButton} onClick={() => onSaveReference(c.ref)}>Set as reference</button>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function ReferencesPanel({
  references,
  selectedReferenceId,
  csvPath,
  busy,
  onSelect,
  onDelete,
  onCsvPathChange,
  onImportCsv
}: {
  references: ReferenceLapSummary[]
  selectedReferenceId: string
  csvPath: string
  busy: boolean
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onCsvPathChange: (path: string) => void
  onImportCsv: () => void
}): ReactElement {
  const selected = references.find((ref) => ref.id === selectedReferenceId)
  const hasSelectedReference = Boolean(selected?.label.trim() && Number.isFinite(selected?.createdAt))
  return (
    <div style={{ ...card, display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div>
          <strong>References</strong>
          <div style={muted}>Use your best recorded lap, an imported .ibt lap, or your own CSV.</div>
        </div>
        <span style={muted}>{references.length} salva(s)</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'end' }}>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={muted}>Reference for overlay/coaching</span>
          <select value={selectedReferenceId} onChange={(event) => onSelect(event.target.value)} style={selectStyle}>
            <option value="">No saved reference (compare with selected best)</option>
            {references.map((ref) => (
              <option key={ref.id} value={ref.id}>
                {ref.label} · {ref.source.toUpperCase()} · {fmtTime(ref.durationSec)}
              </option>
            ))}
          </select>
        </label>
        <button type="button" style={dangerButton} disabled={!selectedReferenceId || busy} onClick={() => selectedReferenceId && onDelete(selectedReferenceId)}>
          Delete
        </button>
      </div>
      {hasSelectedReference && selected ? (
        <div style={muted}>
          Selecionada: <strong>{selected.label}</strong> · {Number.isFinite(selected.sampleCount) ? selected.sampleCount : '—'} amostras · criada em {fmtDate(selected.createdAt)}
        </div>
      ) : null}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'end' }}>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={muted}>Import CSV as reference</span>
          <input value={csvPath} onChange={(event) => onCsvPathChange(event.target.value)} placeholder="/path/lap.csv" style={inputStyle} />
        </label>
        <button type="button" style={ghostButton} disabled={busy} onClick={onImportCsv}>Import CSV</button>
      </div>
    </div>
  )
}

function IbtIndexSummary({
  files,
  summaries
}: {
  files: IbtFileInfo[]
  summaries: Record<string, IbtFileSummary>
}): ReactElement {
  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <strong>Indexed .ibt files</strong>
        <span style={muted}>{files.length} file(s)</span>
      </div>
      {files.length === 0 ? (
        <p style={{ ...muted, margin: 0 }}>
          No files found in the folder. On Windows with iRacing, the default folder is usually
          <code> Documents/iRacing/telemetry </code>. On other systems, point to a folder with copied .ibt files.
        </p>
      ) : (
        <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
          {files.slice(0, 12).map((file) => {
            const summary = summaries[file.path]
            return (
              <li key={file.path} style={{ fontVariantNumeric: 'tabular-nums' }}>
                <code>{file.fileName}</code> · {fmtBytes(file.sizeBytes)} · {fmtDate(file.modifiedAt)}
                {summary ? (
                  <span style={{ ...muted, marginLeft: 8 }}>
                    {trackLabelOf(summary.trackName)} · {summary.carName ?? 'unknown car'} · {summary.laps.length} laps · {Math.round((summary.durationSec ?? 0) / 60)}min
                  </span>
                ) : null}
              </li>
            )
          })}
          {files.length > 12 ? <li style={muted}>… and {files.length - 12} more.</li> : null}
        </ul>
      )}
    </div>
  )
}

function AnalysisResultView({
  result,
  bestLap
}: {
  result: AnalysisResult
  bestLap: AnalysisLap | null
}): ReactElement {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={card}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
          <div>
            <strong style={{ fontSize: 16 }}>{result.trackLabel ?? 'Unknown track'}</strong>
            <div style={muted}>{PROFILE_LABELS[result.profile].label} · {result.laps.length} lap(s)</div>
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div style={muted}>Best lap</div>
              <strong>{bestLap ? fmtTime(bestLap.durationSec) : '—'}</strong>
            </div>
            {result.optimal ? (
              <>
                <div>
                  <div style={muted}>Optimal lap</div>
                  <strong>{fmtTime(result.optimal.totalSec)}</strong>
                </div>
                <div>
                  <div style={muted}>Possible gain</div>
                  <strong style={{ color: 'var(--accent-primary)' }}>{fmtDelta(-result.optimal.gainSec)}</strong>
                </div>
              </>
            ) : null}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {result.laps.map((lap) => <LapBadge key={lap.id} lap={lap} />)}
        </div>
        {result.notes.length > 0 ? (
          <ul style={{ ...muted, paddingLeft: 18, marginTop: 12, marginBottom: 0 }}>
            {result.notes.map((note, i) => <li key={i}>{note}</li>)}
          </ul>
        ) : null}
      </div>

      <div style={{ display: 'grid', gap: 12 }}>
        <MetricChart metric="speedKmh" laps={result.laps} />
        <MetricChart metric="throttle" laps={result.laps} />
        <MetricChart metric="brake" laps={result.laps} />
        {result.deltas.length > 0 ? <DeltaChart deltas={result.deltas} laps={result.laps} /> : null}
      </div>

      {result.optimal && result.profile === 'optimal' ? (
        <OptimalSectorsView result={result} />
      ) : null}

      {result.insights ? <InsightsPanel insights={result.insights.insights} summary={result.insights.summary} /> : null}

      <LossPointList losses={result.losses} laps={result.laps} />
    </div>
  )
}

function InsightsPanel({ insights, summary }: { insights: CoachingInsight[]; summary: string[] }): ReactElement {
  const severityLabel: Record<CoachingInsight['severity'], string> = { high: 'High', med: 'Medium', low: 'Low' }
  const severityColor: Record<CoachingInsight['severity'], string> = { high: 'var(--accent-danger)', med: 'var(--accent-warning)', low: 'var(--accent-primary)' }
  return (
    <div style={card}>
      <strong>Insights / Coaching</strong>
      <ul style={{ ...muted, paddingLeft: 18, marginTop: 8 }}>
        {summary.map((line, index) => <li key={index}>{line}</li>)}
      </ul>
      {insights.length === 0 ? (
        <p style={{ ...muted, marginBottom: 0 }}>No actionable insight above the threshold.</p>
      ) : (
        <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
          {insights.map((insight) => (
            <div key={insight.id} style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 'var(--radius-sm)', padding: 10, background: 'rgba(0,0,0,0.18)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                <strong>{insight.title}</strong>
                <span style={{ color: severityColor[insight.severity], fontWeight: 800 }}>
                  {severityLabel[insight.severity]} · {fmtDelta(insight.lossSec)}
                </span>
              </div>
              <div style={muted}>Sector {insight.sector ?? '—'} · {(insight.atPct * 100).toFixed(1)}%</div>
              <p style={{ margin: '6px 0 0' }}>{insight.detail}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function OptimalSectorsView({ result }: { result: AnalysisResult }): ReactElement | null {
  if (!result.optimal) return null
  return (
    <div style={card}>
      <strong>Optimal Lap composition</strong>
      <div style={{ ...muted, marginBottom: 12 }}>Best time in each sector across the selected laps.</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
        {result.optimal.sectors.map((sector, idx) => {
          const lap = result.laps.find((l) => l.id === sector.bestLapId)
          return (
            <div
              key={idx}
              style={{
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 'var(--radius-sm)',
                padding: 8,
                background: 'rgba(0,0,0,0.18)',
                display: 'grid',
                gap: 4
              }}
            >
              <div style={muted}>Sector {idx + 1} · {(sector.fromPct * 100).toFixed(0)}–{(sector.toPct * 100).toFixed(0)}%</div>
              <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{sector.bestSec.toFixed(3)}s</strong>
              <span style={{ ...muted, color: lap?.color }}>{lap?.label ?? sector.bestLapId}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default LapAnalysisSection
