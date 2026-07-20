import {
  type CSSProperties,
  type ReactElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState
} from 'react'
import {
  generateArchivedDebrief,
  listDebriefArchive,
  subscribeDebriefArchive
} from '../../lib/stint-debrief'
import { speakViaTts } from '../../lib/tts-runtime'
import {
  type DebriefArchiveGenerateResult,
  type DebriefArchiveSummary,
  type DebriefReason
} from '../../../../shared/stint-debrief'
import type { SetupSuggestion } from '../../../../shared/setup-advisor'
import { tt, type ResolvedLanguage } from '../../i18n'

type PanelStatus = 'loading-list' | 'empty' | 'loading-session' | 'ready' | 'deleted' | 'error'

const wrap: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 14 }
const selectorRow: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 10,
  alignItems: 'flex-end'
}
const selectorField: CSSProperties = {
  display: 'flex',
  flex: '1 1 360px',
  minWidth: 0,
  flexDirection: 'column',
  gap: 6
}
const controls: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  alignItems: 'center'
}
const primaryButton: CSSProperties = {
  padding: '8px 14px',
  background: 'var(--accent-primary)',
  border: '1px solid transparent',
  borderRadius: 8,
  color: 'var(--text-on-accent)',
  fontFamily: '"Rajdhani", sans-serif',
  fontWeight: 700,
  fontSize: 13,
  cursor: 'pointer'
}
const ghostButton: CSSProperties = {
  padding: '8px 14px',
  background: 'var(--surface-sunken)',
  border: '1px solid var(--border-strong)',
  borderRadius: 8,
  color: 'var(--text-primary)',
  fontFamily: '"Rajdhani", sans-serif',
  fontWeight: 700,
  fontSize: 13,
  cursor: 'pointer'
}
const selectStyle: CSSProperties = {
  width: '100%',
  minHeight: 40,
  padding: '8px 34px 8px 10px',
  background: 'var(--surface-overlay)',
  border: '1px solid var(--border-strong)',
  borderRadius: 8,
  color: 'var(--text-primary)',
  colorScheme: 'dark',
  fontFamily: '"Barlow Condensed", sans-serif',
  fontSize: 14,
  fontWeight: 600
}
const optionStyle: CSSProperties = {
  background: 'var(--surface-overlay)',
  color: 'var(--text-primary)'
}
const toggle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 7,
  color: 'var(--text-secondary)',
  fontSize: 13
}
const card: CSSProperties = {
  background: 'var(--surface-sunken)',
  border: '1px solid var(--border-default)',
  borderRadius: 10,
  padding: '12px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: 10
}
const setupGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))',
  gap: 10
}
const bodyText: CSSProperties = {
  color: 'var(--text-secondary)',
  fontSize: 13,
  lineHeight: 1.55,
  margin: 0
}
const mutedText: CSSProperties = {
  color: 'var(--text-muted)',
  fontSize: 12,
  lineHeight: 1.5,
  margin: 0
}
const labelText: CSSProperties = {
  color: 'var(--text-primary)',
  fontFamily: '"Rajdhani", sans-serif',
  fontSize: 13,
  fontWeight: 700
}
const bulletList: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 6
}
const eyebrow: CSSProperties = {
  color: 'var(--text-muted)',
  fontSize: 11,
  letterSpacing: 0.4,
  textTransform: 'uppercase',
  fontFamily: '"Rajdhani", sans-serif'
}
const sectionTitle: CSSProperties = {
  color: 'var(--text-primary)',
  fontFamily: '"Rajdhani", sans-serif',
  fontSize: 16,
  fontWeight: 700,
  margin: 0
}
const chip: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  border: '1px solid var(--border-strong)',
  borderRadius: 999,
  color: 'var(--text-secondary)',
  fontSize: 11,
  fontWeight: 700,
  padding: '2px 8px'
}

function bulletColor(text: string): string {
  if (text.startsWith('✅')) return 'var(--accent-success)'
  if (text.startsWith('⚠')) return 'var(--accent-warning)'
  return 'var(--text-secondary)'
}

function localeForLanguage(language: ResolvedLanguage): string {
  return {
    'pt-BR': 'pt-BR',
    en: 'en-US',
    es: 'es-ES',
    fr: 'fr-FR',
    de: 'de-DE',
    zh: 'zh-CN',
    ja: 'ja-JP'
  }[language]
}

function reasonLabel(language: ResolvedLanguage, reason: DebriefReason): string {
  return tt(language, `debrief.history.reason.${reason}`)
}

function sessionLabel(language: ResolvedLanguage, summary: DebriefArchiveSummary): string {
  const locale = localeForLanguage(language)
  const date = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(summary.capturedAt))
  const info = summary.sessionInfo
  const lapCount = Number.isFinite(info.lapsCompleted)
    ? Math.max(0, Math.round(info.lapsCompleted as number))
    : null
  return [
    date,
    info.trackName || tt(language, 'debrief.history.unknownTrack'),
    info.carName || tt(language, 'debrief.history.unknownCar'),
    info.sessionType || tt(language, 'debrief.history.unknownSessionType'),
    lapCount !== null
      ? tt(language, lapCount === 1 ? 'debrief.history.lap' : 'debrief.history.laps', {
          count: lapCount
        })
      : tt(language, 'debrief.history.lapsUnknown'),
    reasonLabel(language, summary.reason)
  ].join(' · ')
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isDeletedError(error: unknown): boolean {
  return errorText(error).toLowerCase().includes('not found or was deleted')
}

function confidenceLabel(language: ResolvedLanguage, confidence: SetupSuggestion['confidence']): string {
  return tt(language, `debrief.history.confidence.${confidence}`)
}

function SetupSuggestionCard({
  suggestion,
  language
}: {
  suggestion: SetupSuggestion
  language: ResolvedLanguage
}): ReactElement {
  return (
    <article style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <strong style={{ color: 'var(--text-primary)', fontFamily: '"Rajdhani", sans-serif' }}>
          {suggestion.primary.change}
        </strong>
        <span style={chip}>
          {tt(language, 'debrief.history.confidence', {
            confidence: confidenceLabel(language, suggestion.confidence)
          })}
        </span>
      </div>
      <p style={bodyText}>
        <strong>{tt(language, 'debrief.history.rationale')}</strong> {suggestion.rationale}
      </p>
      <p style={mutedText}>
        <strong>{tt(language, 'debrief.history.evidence')}</strong> {suggestion.evidence}
      </p>
      {suggestion.alternatives.length > 0 ? (
        <div>
          <span style={labelText}>{tt(language, 'debrief.history.alternatives')}</span>
          <ul style={{ ...bulletList, marginTop: 5 }}>
            {suggestion.alternatives.map((alternative, index) => (
              <li key={`${suggestion.id}:alternative:${index}`} style={mutedText}>
                {alternative.change}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  )
}

export default function StintDebrief({
  language = 'en'
}: {
  language?: ResolvedLanguage
}): ReactElement {
  const selectId = useId()
  const helpId = useId()
  const [sessions, setSessions] = useState<DebriefArchiveSummary[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [result, setResult] = useState<DebriefArchiveGenerateResult | null>(null)
  const [status, setStatus] = useState<PanelStatus>('loading-list')
  const [speaking, setSpeaking] = useState(false)
  const [useLlm, setUseLlm] = useState(false)
  const aliveRef = useRef(true)
  const selectedIdRef = useRef('')
  const sessionsRef = useRef<DebriefArchiveSummary[]>([])
  const listGenerationRef = useRef(0)
  const requestGenerationRef = useRef(0)

  const loadSelected = useCallback(async (
    sessionId: string,
    phraseWithLlm: boolean,
    clearPrevious: boolean
  ): Promise<void> => {
    const requestGeneration = ++requestGenerationRef.current
    if (clearPrevious) setResult(null)
    setStatus('loading-session')
    try {
      const next = await generateArchivedDebrief(sessionId, phraseWithLlm)
      if (
        !aliveRef.current ||
        requestGeneration !== requestGenerationRef.current ||
        selectedIdRef.current !== sessionId
      ) {
        return
      }
      setResult(next)
      setStatus('ready')
    } catch (error) {
      if (
        !aliveRef.current ||
        requestGeneration !== requestGenerationRef.current ||
        selectedIdRef.current !== sessionId
      ) {
        return
      }
      setResult(null)
      setStatus(isDeletedError(error) ? 'deleted' : 'error')
    }
  }, [])

  const refresh = useCallback(async (followLatest: boolean): Promise<void> => {
    const generation = ++listGenerationRef.current
    if (sessionsRef.current.length === 0) setStatus('loading-list')
    try {
      const next = await listDebriefArchive()
      if (!aliveRef.current || generation !== listGenerationRef.current) return
      const previous = sessionsRef.current
      sessionsRef.current = next
      setSessions(next)
      if (next.length === 0) {
        ++requestGenerationRef.current
        selectedIdRef.current = ''
        setSelectedId('')
        setResult(null)
        setStatus('empty')
        return
      }

      const current = selectedIdRef.current
      const wasFollowingLatest = current.length === 0 || current === previous[0]?.id
      if (current && !next.some((session) => session.id === current)) {
        ++requestGenerationRef.current
        setResult(null)
        setStatus('deleted')
        return
      }
      const target = followLatest && wasFollowingLatest ? next[0].id : current || next[0].id
      selectedIdRef.current = target
      setSelectedId(target)
      await loadSelected(target, false, target !== current)
    } catch {
      if (!aliveRef.current || generation !== listGenerationRef.current) return
      ++requestGenerationRef.current
      setResult(null)
      setStatus('error')
    }
  }, [loadSelected])

  useEffect(() => {
    aliveRef.current = true
    void refresh(false)
    const unsubscribe = subscribeDebriefArchive(() => {
      void refresh(true)
    })
    return () => {
      aliveRef.current = false
      ++listGenerationRef.current
      ++requestGenerationRef.current
      unsubscribe()
    }
  }, [refresh])

  const selectSession = useCallback((sessionId: string) => {
    selectedIdRef.current = sessionId
    setSelectedId(sessionId)
    void loadSelected(sessionId, false, true)
  }, [loadSelected])

  const speak = useCallback(async () => {
    if (!result) return
    const lines = [result.debrief.text, ...result.debrief.bullets]
      .filter((line) => line && line.trim().length > 0)
    setSpeaking(true)
    try {
      await speakViaTts(lines.join('. '), {
        lang: result.debrief.language,
        source: 'coach'
      })
    } finally {
      if (aliveRef.current) setSpeaking(false)
    }
  }, [result])

  const selectedMissing = selectedId.length > 0 &&
    !sessions.some((session) => session.id === selectedId)
  const setupSuggestions = result?.setup?.suggestions ?? []
  const busy = status === 'loading-list' || status === 'loading-session'

  return (
    <div style={wrap} aria-busy={busy}>
      <div style={selectorRow}>
        <div style={selectorField}>
          <label htmlFor={selectId} style={labelText}>
            {tt(language, 'debrief.history.selectorLabel')}
          </label>
          <select
            id={selectId}
            value={selectedId}
            style={selectStyle}
            aria-describedby={helpId}
            disabled={sessions.length === 0}
            onChange={(event) => selectSession(event.target.value)}
          >
            {selectedMissing ? (
              <option value={selectedId} disabled style={optionStyle}>
                {tt(language, 'debrief.history.deletedOption')}
              </option>
            ) : null}
            {sessions.map((session) => (
              <option key={session.id} value={session.id} style={optionStyle}>
                {sessionLabel(language, session)}
              </option>
            ))}
          </select>
          <p id={helpId} style={mutedText}>
            {tt(language, 'debrief.history.selectorHelp')}
          </p>
        </div>
        <div style={controls}>
          <button
            type="button"
            style={primaryButton}
            disabled={!selectedId || selectedMissing || busy}
            onClick={() => void loadSelected(selectedId, useLlm, false)}
          >
            {status === 'loading-session'
              ? tt(language, 'debrief.history.generating')
              : tt(language, 'debrief.history.generate')}
          </button>
          <button
            type="button"
            style={ghostButton}
            disabled={!result || speaking || busy}
            onClick={() => void speak()}
          >
            {speaking
              ? tt(language, 'debrief.history.speaking')
              : tt(language, 'debrief.history.listen')}
          </button>
          <label style={toggle}>
            <input
              type="checkbox"
              checked={useLlm}
              onChange={(event) => setUseLlm(event.target.checked)}
            />
            {tt(language, 'debrief.history.phraseWithAi')}
          </label>
        </div>
      </div>

      <div role="status" aria-live="polite" aria-atomic="true">
        {status === 'loading-list' ? (
          <p style={mutedText}>{tt(language, 'debrief.history.loadingArchive')}</p>
        ) : null}
        {status === 'loading-session' ? (
          <p style={mutedText}>{tt(language, 'debrief.history.loadingSession')}</p>
        ) : null}
        {status === 'empty' ? (
          <p style={mutedText}>{tt(language, 'debrief.history.empty')}</p>
        ) : null}
        {status === 'deleted' ? (
          <div style={card}>
            <strong style={{ color: 'var(--accent-warning)' }}>
              {tt(language, 'debrief.history.deletedTitle')}
            </strong>
            <p style={mutedText}>{tt(language, 'debrief.history.deletedBody')}</p>
          </div>
        ) : null}
      </div>

      {status === 'error' ? (
        <div role="alert" style={card}>
          <strong style={{ color: 'var(--accent-danger)' }}>
            {tt(language, 'debrief.history.errorTitle')}
          </strong>
          <p style={mutedText}>{tt(language, 'debrief.history.errorBody')}</p>
          <button type="button" style={ghostButton} onClick={() => void refresh(false)}>
            {tt(language, 'debrief.history.retry')}
          </button>
        </div>
      ) : null}

      {result ? (
        <>
          <section style={card} aria-labelledby={`${selectId}-debrief-title`}>
            <span style={eyebrow}>
              {reasonLabel(language, result.debrief.reason)} ·{' '}
              {result.debrief.source === 'llm'
                ? tt(language, 'debrief.history.sourceLlm')
                : tt(language, 'debrief.history.sourceDeterministic')}
            </span>
            <h3 id={`${selectId}-debrief-title`} style={sectionTitle}>
              {tt(language, 'debrief.history.debriefTitle')}
            </h3>
            {result.captureSource === 'legacy-last-debrief' ? (
              <p style={mutedText}>{tt(language, 'debrief.history.migratedNotice')}</p>
            ) : null}
            {result.analysisStatus !== 'available' ? (
              <p style={mutedText}>{tt(language, 'debrief.history.analysisInsufficient')}</p>
            ) : null}
            <p style={bodyText}>{result.debrief.text}</p>
            {result.debrief.bullets.length > 0 ? (
              <ul style={bulletList}>
                {result.debrief.bullets.map((bullet, index) => (
                  <li
                    key={`${result.sessionId}:bullet:${index}`}
                    style={{ ...bodyText, color: bulletColor(bullet) }}
                  >
                    {bullet}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <section style={card} aria-labelledby={`${selectId}-setup-title`}>
            <h3 id={`${selectId}-setup-title`} style={sectionTitle}>
              {tt(language, 'debrief.history.setupTitle')}
            </h3>
            <p style={mutedText}>{tt(language, 'debrief.history.setupSafety')}</p>
            {result.setupStatus === 'available' && setupSuggestions.length > 0 ? (
              <div style={setupGrid}>
                {setupSuggestions.map((suggestion) => (
                  <SetupSuggestionCard
                    key={suggestion.id}
                    suggestion={suggestion}
                    language={language}
                  />
                ))}
              </div>
            ) : (
              <div style={{ ...card, background: 'var(--surface-raised)' }}>
                <strong style={{ color: 'var(--text-primary)' }}>
                  {tt(language, 'debrief.history.setupInsufficientTitle')}
                </strong>
                <p style={mutedText}>
                  {result.setupStatus === 'legacy'
                    ? tt(language, 'debrief.history.setupLegacy')
                    : tt(language, 'debrief.history.setupInsufficientBody')}
                </p>
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  )
}
