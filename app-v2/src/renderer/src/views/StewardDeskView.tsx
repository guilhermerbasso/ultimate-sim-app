import { type FormEvent, type ReactElement, useCallback, useEffect, useMemo, useState } from 'react'
import type { IncidentClip, IncidentClipMeta } from '../../../shared/incidents'
import { INCIDENT_CHANNELS } from '../../../shared/incidents'
import {
  STEWARD_CHANNELS,
  type StewardActor,
  type StewardAppealResolutionKind,
  type StewardCase,
  type StewardCaseStatus,
  type StewardExportResult,
  type StewardImportResult,
  type StewardVerdictFinding
} from '../../../shared/steward-desk'
import type { AppViewProps } from '../App'
import { tt, type ResolvedLanguage } from '../i18n'
import '../styles/steward-desk.css'

const STATUS_VALUES: StewardCaseStatus[] = ['triage', 'under-review', 'decided', 'appealed', 'closed']
const FINDING_VALUES: StewardVerdictFinding[] = ['no-breach', 'breach', 'insufficient-evidence', 'procedural']
const RESOLUTION_VALUES: StewardAppealResolutionKind[] = ['upheld', 'modified', 'remanded', 'dismissed']

function slug(value: string, fallback: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return normalized || fallback
}

function stewardActor(name: string): StewardActor {
  return {
    id: `steward-${slug(name, 'local')}`,
    displayName: name.trim() || 'Local steward',
    role: 'steward'
  }
}

function participantActor(name: string): StewardActor {
  return {
    id: `participant-${slug(name, 'local')}`,
    displayName: name.trim() || 'League participant',
    role: 'participant'
  }
}

function numeric(value: string): number | undefined {
  if (!value.trim()) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function localeFor(language?: ResolvedLanguage): string {
  if (language === 'pt-BR') return 'pt-BR'
  if (language === 'zh') return 'zh-CN'
  return language ?? 'en'
}

function formatDate(value: number | undefined, language?: ResolvedLanguage): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  return new Date(value).toLocaleString(localeFor(language))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function Field({
  label,
  children,
  hint
}: {
  label: string
  children: ReactElement
  hint?: string
}): ReactElement {
  return (
    <label className="steward-field">
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  )
}

function CaseStatusBadge({
  status,
  language
}: {
  status: StewardCaseStatus
  language?: ResolvedLanguage
}): ReactElement {
  return <span className={`steward-badge status-${status}`}>{tt(language, `steward.status.${status}`)}</span>
}

export default function StewardDeskView({ showToast, language }: AppViewProps): ReactElement {
  const [cases, setCases] = useState<StewardCase[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [incidentClips, setIncidentClips] = useState<IncidentClipMeta[]>([])
  const [busy, setBusy] = useState(false)
  const [stewardName, setStewardName] = useState('Local steward')
  const [participantName, setParticipantName] = useState('League participant')
  const [selectedRuleIds, setSelectedRuleIds] = useState<string[]>([])
  const [selectedEvidenceIds, setSelectedEvidenceIds] = useState<string[]>([])
  const [create, setCreate] = useState({
    title: '',
    leagueId: '',
    leagueName: '',
    eventId: '',
    eventName: '',
    sessionId: '',
    sim: 'iRacing',
    sessionType: 'Race',
    trackName: '',
    incidentId: '',
    incidentLabel: '',
    lap: '',
    sessionTimeSec: '',
    replayFrame: ''
  })
  const [bookmark, setBookmark] = useState({ sourceId: '', label: '', lap: '', sessionTimeSec: '', replayFrame: '' })
  const [manualEvidence, setManualEvidence] = useState({ summary: '', sourceRef: '', content: '' })
  const [rule, setRule] = useState({
    rulesetId: '',
    version: '',
    section: '',
    title: '',
    text: '',
    source: ''
  })
  const [verdict, setVerdict] = useState({
    finding: 'insufficient-evidence' as StewardVerdictFinding,
    decisionText: '',
    actionText: ''
  })
  const [dissent, setDissent] = useState({ verdictId: '', statement: '', grounds: '' })
  const [appeal, setAppeal] = useState({ verdictId: '', grounds: '', requestedRemedy: '' })
  const [resolution, setResolution] = useState({
    appealId: '',
    resolution: 'upheld' as StewardAppealResolutionKind,
    reasoning: ''
  })

  const selected = useMemo(
    () => cases.find((entry) => entry.caseId === selectedId) ?? null,
    [cases, selectedId]
  )
  const selectedClip = useMemo(
    () => incidentClips.find((entry) => entry.id === create.incidentId),
    [create.incidentId, incidentClips]
  )
  const healthy = selected?.integrity.state === 'unanchored'
  const openAppeals = selected?.appeals.filter((entry) => entry.status === 'open') ?? []

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [nextCases, nextIncidents] = await Promise.all([
        window.ipc.invoke<StewardCase[]>(STEWARD_CHANNELS.listCases),
        window.ipc.invoke<IncidentClipMeta[]>(INCIDENT_CHANNELS.list)
      ])
      setCases(nextCases)
      setIncidentClips(nextIncidents)
      setSelectedId((current) => {
        if (current && nextCases.some((entry) => entry.caseId === current)) return current
        return nextCases[0]?.caseId ?? ''
      })
    } catch (error) {
      showToast(errorMessage(error), 'error')
    }
  }, [showToast])

  useEffect(() => {
    void refresh()
    return window.ipc.subscribe(STEWARD_CHANNELS.changed, () => void refresh())
  }, [refresh])

  useEffect(() => {
    if (!selected) {
      setSelectedRuleIds([])
      setSelectedEvidenceIds([])
      return
    }
    setSelectedRuleIds(selected.rules.at(-1) ? [selected.rules.at(-1)!.citationId] : [])
    setSelectedEvidenceIds(selected.evidence.filter((entry) => entry.state === 'available').map((entry) => entry.evidenceId))
    const latestVerdict = selected.verdicts.at(-1)?.verdictId ?? ''
    setDissent((current) => ({ ...current, verdictId: latestVerdict }))
    setAppeal((current) => ({ ...current, verdictId: latestVerdict }))
    setResolution((current) => ({ ...current, appealId: openAppeals[0]?.appealId ?? '' }))
  }, [selectedId, selected?.history.length])

  const upsert = useCallback((next: StewardCase): void => {
    setCases((current) => [next, ...current.filter((entry) => entry.caseId !== next.caseId)])
    setSelectedId(next.caseId)
  }, [])

  async function mutate<T extends StewardCase>(
    channel: string,
    input: unknown,
    successKey: string
  ): Promise<T | null> {
    setBusy(true)
    try {
      const next = await window.ipc.invoke<T>(channel, input)
      upsert(next)
      showToast(tt(language, successKey), 'success')
      return next
    } catch (error) {
      showToast(errorMessage(error), 'error')
      return null
    } finally {
      setBusy(false)
    }
  }

  async function createCase(event: FormEvent): Promise<void> {
    event.preventDefault()
    const incident = selectedClip
      ? {
          source: 'incident-recorder' as const,
          sourceId: selectedClip.id,
          label: create.incidentLabel.trim() || `${selectedClip.type} · ${selectedClip.id}`,
          occurredAt: selectedClip.at,
          lap: selectedClip.lap,
          lapDistPct: selectedClip.lapDistPct,
          windowBeforeSec: 4,
          windowAfterSec: 3
        }
      : {
          source: 'manual' as const,
          sourceId: create.incidentId.trim() || `manual-${Date.now()}`,
          label: create.incidentLabel,
          ...(numeric(create.lap) === undefined ? {} : { lap: numeric(create.lap) }),
          ...(numeric(create.sessionTimeSec) === undefined
            ? {}
            : { sessionTimeSec: numeric(create.sessionTimeSec) }),
          ...(numeric(create.replayFrame) === undefined ? {} : { replayFrame: numeric(create.replayFrame) }),
          windowBeforeSec: 5,
          windowAfterSec: 5
        }
    const next = await mutate<StewardCase>(
      STEWARD_CHANNELS.createCase,
      {
        title: create.title,
        actor: stewardActor(stewardName),
        assignedTo: stewardActor(stewardName),
        identity: {
          leagueId: create.leagueId,
          leagueName: create.leagueName,
          eventId: create.eventId,
          eventName: create.eventName,
          sessionId: create.sessionId,
          sim: create.sim,
          sessionType: create.sessionType,
          trackName: create.trackName
        },
        incident
      },
      'steward.toast.created'
    )
    if (next) {
      setCreate((current) => ({
        ...current,
        title: '',
        incidentId: '',
        incidentLabel: '',
        lap: '',
        sessionTimeSec: '',
        replayFrame: ''
      }))
    }
  }

  async function addBookmark(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!selected) return
    const next = await mutate<StewardCase>(
      STEWARD_CHANNELS.addBookmark,
      {
        caseId: selected.caseId,
        actor: stewardActor(stewardName),
        bookmark: {
          source: 'replay',
          sourceId: bookmark.sourceId,
          label: bookmark.label,
          ...(numeric(bookmark.lap) === undefined ? {} : { lap: numeric(bookmark.lap) }),
          ...(numeric(bookmark.sessionTimeSec) === undefined
            ? {}
            : { sessionTimeSec: numeric(bookmark.sessionTimeSec) }),
          ...(numeric(bookmark.replayFrame) === undefined ? {} : { replayFrame: numeric(bookmark.replayFrame) }),
          windowBeforeSec: 5,
          windowAfterSec: 5
        }
      },
      'steward.toast.bookmark'
    )
    if (next) setBookmark({ sourceId: '', label: '', lap: '', sessionTimeSec: '', replayFrame: '' })
  }

  async function lockSelectedIncident(): Promise<void> {
    if (!selected || !create.incidentId) return
    setBusy(true)
    try {
      const clip = await window.ipc.invoke<IncidentClip | null>(INCIDENT_CHANNELS.get, create.incidentId)
      if (!clip) throw new Error(tt(language, 'steward.error.incidentMissing'))
      const next = await window.ipc.invoke<StewardCase>(STEWARD_CHANNELS.lockEvidence, {
        caseId: selected.caseId,
        actor: stewardActor(stewardName),
        summary: `${clip.type} · ${clip.id}`,
        mediaType: 'application/vnd.ultimate-sim.incident+json',
        content: clip,
        provenance: {
          sourceKind: 'incident-recorder',
          sourceRef: clip.id,
          producer: 'Ultimate Sim App incident recorder',
          producerVersion: '1',
          capturedAt: clip.createdAt,
          sessionRef: selected.identity.sessionId,
          captureRange: `${clip.window[0]?.t ?? clip.at}-${clip.window.at(-1)?.t ?? clip.at}`,
          transform: 'incident-recorder.v1'
        }
      })
      upsert(next)
      showToast(tt(language, 'steward.toast.evidence'), 'success')
    } catch (error) {
      showToast(errorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function lockManualEvidence(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!selected) return
    const next = await mutate<StewardCase>(
      STEWARD_CHANNELS.lockEvidence,
      {
        caseId: selected.caseId,
        actor: stewardActor(stewardName),
        summary: manualEvidence.summary,
        mediaType: 'text/plain',
        content: { note: manualEvidence.content },
        provenance: {
          sourceKind: 'document',
          sourceRef: manualEvidence.sourceRef,
          producer: stewardName,
          producerVersion: 'human-attestation',
          capturedAt: Date.now(),
          sessionRef: selected.identity.sessionId,
          transform: 'none'
        }
      },
      'steward.toast.evidence'
    )
    if (next) setManualEvidence({ summary: '', sourceRef: '', content: '' })
  }

  async function citeRule(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!selected) return
    const next = await mutate<StewardCase>(
      STEWARD_CHANNELS.citeRule,
      {
        caseId: selected.caseId,
        actor: stewardActor(stewardName),
        ...rule
      },
      'steward.toast.rule'
    )
    if (next) setRule({ rulesetId: '', version: '', section: '', title: '', text: '', source: '' })
  }

  async function recordVerdict(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!selected) return
    const next = await mutate<StewardCase>(
      STEWARD_CHANNELS.recordVerdict,
      {
        caseId: selected.caseId,
        actor: stewardActor(stewardName),
        ...verdict,
        ruleCitationIds: selectedRuleIds,
        evidenceIds: selectedEvidenceIds,
        supersedesVerdictId: selected.verdicts.at(-1)?.verdictId
      },
      'steward.toast.verdict'
    )
    if (next) setVerdict({ finding: 'insufficient-evidence', decisionText: '', actionText: '' })
  }

  async function recordDissent(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!selected) return
    const next = await mutate<StewardCase>(
      STEWARD_CHANNELS.recordDissent,
      {
        caseId: selected.caseId,
        actor: participantActor(participantName),
        ...dissent
      },
      'steward.toast.dissent'
    )
    if (next) setDissent((current) => ({ verdictId: current.verdictId, statement: '', grounds: '' }))
  }

  async function fileAppeal(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!selected) return
    const next = await mutate<StewardCase>(
      STEWARD_CHANNELS.fileAppeal,
      {
        caseId: selected.caseId,
        actor: participantActor(participantName),
        ...appeal
      },
      'steward.toast.appeal'
    )
    if (next) setAppeal((current) => ({ verdictId: current.verdictId, grounds: '', requestedRemedy: '' }))
  }

  async function resolveAppeal(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!selected) return
    const next = await mutate<StewardCase>(
      STEWARD_CHANNELS.resolveAppeal,
      {
        caseId: selected.caseId,
        actor: stewardActor(stewardName),
        ...resolution
      },
      'steward.toast.resolution'
    )
    if (next) setResolution((current) => ({ ...current, reasoning: '' }))
  }

  async function exportCase(profile: 'full-local' | 'anonymized'): Promise<void> {
    if (!selected) return
    setBusy(true)
    try {
      const result = await window.ipc.invoke<StewardExportResult>(STEWARD_CHANNELS.exportCase, {
        caseId: selected.caseId,
        profile
      })
      if (!result.canceled) showToast(tt(language, 'steward.toast.exported'), 'success')
    } catch (error) {
      showToast(errorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function importCase(): Promise<void> {
    setBusy(true)
    try {
      const result = await window.ipc.invoke<StewardImportResult>(STEWARD_CHANNELS.importCase)
      if (result.importedCase) {
        upsert(result.importedCase)
        showToast(tt(language, 'steward.toast.imported'), 'success')
      }
    } catch (error) {
      showToast(errorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  function toggleReference(id: string, selectedValues: string[], update: (ids: string[]) => void): void {
    update(selectedValues.includes(id)
      ? selectedValues.filter((value) => value !== id)
      : [...selectedValues, id])
  }

  return (
    <section className="steward-desk" aria-labelledby="steward-desk-title">
      <div className="steward-owner-banner" role="note" id="steward-human-owner">
        <strong id="steward-desk-title">{tt(language, 'steward.owner.title')}</strong>
        <span>{tt(language, 'steward.owner.body')}</span>
      </div>

      <div className="steward-toolbar" aria-label={tt(language, 'steward.toolbarAria')}>
        <Field label={tt(language, 'steward.stewardName')}>
          <input value={stewardName} onChange={(event) => setStewardName(event.target.value)} />
        </Field>
        <Field label={tt(language, 'steward.participantName')}>
          <input value={participantName} onChange={(event) => setParticipantName(event.target.value)} />
        </Field>
        <button type="button" onClick={() => void refresh()} disabled={busy}>
          {tt(language, 'steward.refresh')}
        </button>
        <button type="button" onClick={() => void importCase()} disabled={busy}>
          {tt(language, 'steward.import')}
        </button>
      </div>

      <div className="steward-layout">
        <aside className="steward-queue" aria-label={tt(language, 'steward.queueAria')}>
          <div className="steward-section-heading">
            <div>
              <span className="section-eyebrow">{tt(language, 'steward.localFirst')}</span>
              <h3>{tt(language, 'steward.queue')}</h3>
            </div>
            <span className="steward-count">{cases.length}</span>
          </div>
          {cases.length === 0 ? (
            <p className="steward-empty">{tt(language, 'steward.empty')}</p>
          ) : (
            <div className="steward-case-list">
              {cases.map((entry) => (
                <button
                  type="button"
                  className={`steward-case-row ${entry.caseId === selectedId ? 'is-selected' : ''}`}
                  key={entry.caseId}
                  onClick={() => setSelectedId(entry.caseId)}
                  aria-current={entry.caseId === selectedId ? 'page' : undefined}
                >
                  <span>
                    <strong>{entry.title}</strong>
                    <small>{entry.identity.eventName} · {entry.identity.trackName}</small>
                  </span>
                  <CaseStatusBadge status={entry.status} language={language} />
                </button>
              ))}
            </div>
          )}

          <details className="steward-details" open={cases.length === 0}>
            <summary>{tt(language, 'steward.create.title')}</summary>
            <form className="steward-form" onSubmit={(event) => void createCase(event)}>
              <Field label={tt(language, 'steward.field.caseTitle')}>
                <input required value={create.title} onChange={(event) => setCreate({ ...create, title: event.target.value })} />
              </Field>
              <div className="steward-grid two">
                <Field label={tt(language, 'steward.field.leagueId')}>
                  <input required value={create.leagueId} onChange={(event) => setCreate({ ...create, leagueId: event.target.value })} />
                </Field>
                <Field label={tt(language, 'steward.field.leagueName')}>
                  <input required value={create.leagueName} onChange={(event) => setCreate({ ...create, leagueName: event.target.value })} />
                </Field>
                <Field label={tt(language, 'steward.field.eventId')}>
                  <input required value={create.eventId} onChange={(event) => setCreate({ ...create, eventId: event.target.value })} />
                </Field>
                <Field label={tt(language, 'steward.field.eventName')}>
                  <input required value={create.eventName} onChange={(event) => setCreate({ ...create, eventName: event.target.value })} />
                </Field>
                <Field label={tt(language, 'steward.field.sessionId')}>
                  <input required value={create.sessionId} onChange={(event) => setCreate({ ...create, sessionId: event.target.value })} />
                </Field>
                <Field label={tt(language, 'steward.field.track')}>
                  <input required value={create.trackName} onChange={(event) => setCreate({ ...create, trackName: event.target.value })} />
                </Field>
                <Field label={tt(language, 'steward.field.sim')}>
                  <input required value={create.sim} onChange={(event) => setCreate({ ...create, sim: event.target.value })} />
                </Field>
                <Field label={tt(language, 'steward.field.sessionType')}>
                  <input required value={create.sessionType} onChange={(event) => setCreate({ ...create, sessionType: event.target.value })} />
                </Field>
              </div>
              <Field label={tt(language, 'steward.field.incidentClip')} hint={tt(language, 'steward.field.incidentClipHint')}>
                <select value={create.incidentId} onChange={(event) => setCreate({ ...create, incidentId: event.target.value })}>
                  <option value="">{tt(language, 'steward.incident.manual')}</option>
                  {incidentClips.map((clip) => (
                    <option key={clip.id} value={clip.id}>
                      {clip.type} · {clip.lap === undefined ? '—' : `L${clip.lap}`} · {formatDate(clip.createdAt, language)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={tt(language, 'steward.field.incidentLabel')}>
                <input required value={create.incidentLabel} onChange={(event) => setCreate({ ...create, incidentLabel: event.target.value })} />
              </Field>
              {!selectedClip ? (
                <div className="steward-grid two">
                  <Field label={tt(language, 'steward.field.lap')}>
                    <input type="number" min="0" value={create.lap} onChange={(event) => setCreate({ ...create, lap: event.target.value })} />
                  </Field>
                  <Field label={tt(language, 'steward.field.sessionTime')}>
                    <input type="number" min="0" step="0.1" value={create.sessionTimeSec} onChange={(event) => setCreate({ ...create, sessionTimeSec: event.target.value })} />
                  </Field>
                  <Field label={tt(language, 'steward.field.replayFrame')}>
                    <input type="number" min="0" value={create.replayFrame} onChange={(event) => setCreate({ ...create, replayFrame: event.target.value })} />
                  </Field>
                </div>
              ) : null}
              <button className="steward-primary" type="submit" disabled={busy}>
                {tt(language, 'steward.create.submit')}
              </button>
            </form>
          </details>
        </aside>

        <section className="steward-case-panel" aria-label={tt(language, 'steward.caseAria')}>
          {!selected ? (
            <div className="steward-empty-state" role="status">
              <strong>{tt(language, 'steward.selectCase')}</strong>
              <p>{tt(language, 'steward.selectCaseHelp')}</p>
            </div>
          ) : (
            <>
              <div
                className={`steward-integrity integrity-${selected.integrity.state}`}
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                <div>
                  <strong>{tt(language, `steward.integrity.${selected.integrity.state}`)}</strong>
                  <span>{selected.integrity.message}</span>
                </div>
                <code>{selected.integrity.headHash?.slice(0, 12) ?? '—'}</code>
              </div>

              <header className="steward-case-header">
                <div>
                  <span className="section-eyebrow">{selected.caseId}</span>
                  <h3>{selected.title}</h3>
                  <p>
                    {selected.identity.leagueName} · {selected.identity.eventName} · {selected.identity.sessionType}
                    {' · '}{selected.identity.trackName}
                    {' · '}{tt(language, 'steward.assignedTo')}: {selected.assignedTo?.displayName ?? '—'}
                  </p>
                </div>
                <CaseStatusBadge status={selected.status} language={language} />
              </header>

              <div className="steward-actions" aria-describedby="steward-human-owner">
                <label>
                  <span>{tt(language, 'steward.statusLabel')}</span>
                  <select
                    value={selected.status}
                    disabled={!healthy || busy}
                    onChange={(event) => void mutate<StewardCase>(
                      STEWARD_CHANNELS.setStatus,
                      {
                        caseId: selected.caseId,
                        actor: stewardActor(stewardName),
                        status: event.target.value
                      },
                      'steward.toast.status'
                    )}
                  >
                    {STATUS_VALUES.map((status) => (
                      <option key={status} value={status}>{tt(language, `steward.status.${status}`)}</option>
                    ))}
                  </select>
                </label>
                <button type="button" disabled={!healthy || busy} onClick={() => void exportCase('anonymized')}>
                  {tt(language, 'steward.exportAnonymized')}
                </button>
                <button
                  type="button"
                  disabled={!healthy || busy}
                  onClick={() => void mutate<StewardCase>(
                    STEWARD_CHANNELS.assignCase,
                    {
                      caseId: selected.caseId,
                      actor: stewardActor(stewardName),
                      assignedTo: stewardActor(stewardName)
                    },
                    'steward.toast.assigned'
                  )}
                >
                  {tt(language, 'steward.assignCurrent')}
                </button>
                <button type="button" disabled={!healthy || busy} onClick={() => void exportCase('full-local')}>
                  {tt(language, 'steward.exportLocal')}
                </button>
              </div>

              <div className="steward-summary-grid">
                <article>
                  <span>{tt(language, 'steward.summary.bookmarks')}</span>
                  <strong>{selected.bookmarks.length}</strong>
                </article>
                <article>
                  <span>{tt(language, 'steward.summary.evidence')}</span>
                  <strong>{selected.evidence.length}</strong>
                </article>
                <article>
                  <span>{tt(language, 'steward.summary.rules')}</span>
                  <strong>{selected.rules.length}</strong>
                </article>
                <article>
                  <span>{tt(language, 'steward.summary.appeals')}</span>
                  <strong>{selected.appeals.length}</strong>
                </article>
              </div>

              <details className="steward-details" open>
                <summary>{tt(language, 'steward.bookmarks.title')}</summary>
                <div className="steward-list">
                  {selected.bookmarks.map((entry) => (
                    <article key={entry.bookmarkId}>
                      <div>
                        <strong>{entry.label}</strong>
                        <p>{entry.source} · {entry.sourceId}</p>
                      </div>
                      <span>{entry.lap === undefined ? '—' : `L${entry.lap}`}</span>
                    </article>
                  ))}
                </div>
                <form className="steward-form inline" onSubmit={(event) => void addBookmark(event)}>
                  <Field label={tt(language, 'steward.field.sourceRef')}>
                    <input required disabled={!healthy} value={bookmark.sourceId} onChange={(event) => setBookmark({ ...bookmark, sourceId: event.target.value })} />
                  </Field>
                  <Field label={tt(language, 'steward.field.incidentLabel')}>
                    <input required disabled={!healthy} value={bookmark.label} onChange={(event) => setBookmark({ ...bookmark, label: event.target.value })} />
                  </Field>
                  <Field label={tt(language, 'steward.field.lap')}>
                    <input type="number" min="0" disabled={!healthy} value={bookmark.lap} onChange={(event) => setBookmark({ ...bookmark, lap: event.target.value })} />
                  </Field>
                  <Field label={tt(language, 'steward.field.sessionTime')}>
                    <input type="number" min="0" step="0.1" disabled={!healthy} value={bookmark.sessionTimeSec} onChange={(event) => setBookmark({ ...bookmark, sessionTimeSec: event.target.value })} />
                  </Field>
                  <Field label={tt(language, 'steward.field.replayFrame')}>
                    <input type="number" min="0" disabled={!healthy} value={bookmark.replayFrame} onChange={(event) => setBookmark({ ...bookmark, replayFrame: event.target.value })} />
                  </Field>
                  <button type="submit" disabled={!healthy || busy}>{tt(language, 'steward.bookmarks.add')}</button>
                </form>
              </details>

              <details className="steward-details" open>
                <summary>{tt(language, 'steward.evidence.title')}</summary>
                <p className="steward-help">{tt(language, 'steward.evidence.help')}</p>
                <div className="steward-list">
                  {selected.evidence.map((entry) => (
                    <article key={entry.evidenceId}>
                      <div>
                        <strong>{entry.summary}</strong>
                        <p>{entry.provenance.producer} · {entry.provenance.sourceRef}</p>
                        <code>{entry.contentHash.slice(0, 16)}</code>
                      </div>
                      <span className={`steward-badge evidence-${entry.state}`}>
                        {tt(language, `steward.evidence.${entry.state}`)}
                      </span>
                    </article>
                  ))}
                </div>
                <div className="steward-evidence-actions">
                  <Field label={tt(language, 'steward.field.incidentClip')}>
                    <select value={create.incidentId} onChange={(event) => setCreate({ ...create, incidentId: event.target.value })}>
                      <option value="">{tt(language, 'steward.incident.choose')}</option>
                      {incidentClips.map((clip) => <option key={clip.id} value={clip.id}>{clip.type} · {clip.id}</option>)}
                    </select>
                  </Field>
                  <button type="button" disabled={!healthy || busy || !create.incidentId} onClick={() => void lockSelectedIncident()}>
                    {tt(language, 'steward.evidence.lockIncident')}
                  </button>
                </div>
                <form className="steward-form" onSubmit={(event) => void lockManualEvidence(event)}>
                  <div className="steward-grid two">
                    <Field label={tt(language, 'steward.field.evidenceSummary')}>
                      <input required disabled={!healthy} value={manualEvidence.summary} onChange={(event) => setManualEvidence({ ...manualEvidence, summary: event.target.value })} />
                    </Field>
                    <Field label={tt(language, 'steward.field.sourceRef')}>
                      <input required disabled={!healthy} value={manualEvidence.sourceRef} onChange={(event) => setManualEvidence({ ...manualEvidence, sourceRef: event.target.value })} />
                    </Field>
                  </div>
                  <Field label={tt(language, 'steward.field.evidenceContent')}>
                    <textarea required disabled={!healthy} rows={4} value={manualEvidence.content} onChange={(event) => setManualEvidence({ ...manualEvidence, content: event.target.value })} />
                  </Field>
                  <button type="submit" disabled={!healthy || busy}>{tt(language, 'steward.evidence.lockManual')}</button>
                </form>
              </details>

              <details className="steward-details" open>
                <summary>{tt(language, 'steward.rules.title')}</summary>
                <div className="steward-list">
                  {selected.rules.map((entry) => (
                    <article key={entry.citationId}>
                      <div>
                        <strong>{entry.rulesetId} {entry.version} · {entry.section}</strong>
                        <p>{entry.title}</p>
                        <code>{entry.contentHash.slice(0, 16)}</code>
                      </div>
                      <span>{formatDate(entry.citedAt, language)}</span>
                    </article>
                  ))}
                </div>
                <form className="steward-form" onSubmit={(event) => void citeRule(event)}>
                  <div className="steward-grid three">
                    <Field label={tt(language, 'steward.field.ruleset')}>
                      <input required disabled={!healthy} value={rule.rulesetId} onChange={(event) => setRule({ ...rule, rulesetId: event.target.value })} />
                    </Field>
                    <Field label={tt(language, 'steward.field.ruleVersion')}>
                      <input required disabled={!healthy} value={rule.version} onChange={(event) => setRule({ ...rule, version: event.target.value })} />
                    </Field>
                    <Field label={tt(language, 'steward.field.ruleSection')}>
                      <input required disabled={!healthy} value={rule.section} onChange={(event) => setRule({ ...rule, section: event.target.value })} />
                    </Field>
                  </div>
                  <Field label={tt(language, 'steward.field.ruleTitle')}>
                    <input required disabled={!healthy} value={rule.title} onChange={(event) => setRule({ ...rule, title: event.target.value })} />
                  </Field>
                  <Field label={tt(language, 'steward.field.ruleText')}>
                    <textarea required disabled={!healthy} rows={4} value={rule.text} onChange={(event) => setRule({ ...rule, text: event.target.value })} />
                  </Field>
                  <Field label={tt(language, 'steward.field.ruleSource')}>
                    <input required disabled={!healthy} value={rule.source} onChange={(event) => setRule({ ...rule, source: event.target.value })} />
                  </Field>
                  <button type="submit" disabled={!healthy || busy}>{tt(language, 'steward.rules.cite')}</button>
                </form>
              </details>

              <details className="steward-details" open>
                <summary>{tt(language, 'steward.verdict.title')}</summary>
                <p className="steward-help">{tt(language, 'steward.verdict.help')}</p>
                <div className="steward-list">
                  {selected.verdicts.map((entry) => (
                    <article key={entry.verdictId}>
                      <div>
                        <strong>{tt(language, `steward.finding.${entry.finding}`)}</strong>
                        <p>{entry.decisionText}</p>
                        {entry.actionText ? <small>{entry.actionText}</small> : null}
                      </div>
                      <span>{entry.decidedBy.displayName}</span>
                    </article>
                  ))}
                </div>
                <form className="steward-form" onSubmit={(event) => void recordVerdict(event)}>
                  <Field label={tt(language, 'steward.field.finding')}>
                    <select disabled={!healthy} value={verdict.finding} onChange={(event) => setVerdict({ ...verdict, finding: event.target.value as StewardVerdictFinding })}>
                      {FINDING_VALUES.map((finding) => <option key={finding} value={finding}>{tt(language, `steward.finding.${finding}`)}</option>)}
                    </select>
                  </Field>
                  <fieldset className="steward-reference-set">
                    <legend>{tt(language, 'steward.verdict.ruleRefs')}</legend>
                    {selected.rules.map((entry) => (
                      <label key={entry.citationId}>
                        <input
                          type="checkbox"
                          checked={selectedRuleIds.includes(entry.citationId)}
                          onChange={() => toggleReference(entry.citationId, selectedRuleIds, setSelectedRuleIds)}
                          disabled={!healthy}
                        />
                        <span>{entry.rulesetId} {entry.version} · {entry.section}</span>
                      </label>
                    ))}
                  </fieldset>
                  <fieldset className="steward-reference-set">
                    <legend>{tt(language, 'steward.verdict.evidenceRefs')}</legend>
                    {selected.evidence.map((entry) => (
                      <label key={entry.evidenceId}>
                        <input
                          type="checkbox"
                          checked={selectedEvidenceIds.includes(entry.evidenceId)}
                          onChange={() => toggleReference(entry.evidenceId, selectedEvidenceIds, setSelectedEvidenceIds)}
                          disabled={!healthy || entry.state !== 'available'}
                        />
                        <span>{entry.summary}</span>
                      </label>
                    ))}
                  </fieldset>
                  <Field label={tt(language, 'steward.field.decision')}>
                    <textarea required disabled={!healthy} rows={4} value={verdict.decisionText} onChange={(event) => setVerdict({ ...verdict, decisionText: event.target.value })} />
                  </Field>
                  <Field label={tt(language, 'steward.field.manualAction')} hint={tt(language, 'steward.field.manualActionHint')}>
                    <textarea disabled={!healthy} rows={2} value={verdict.actionText} onChange={(event) => setVerdict({ ...verdict, actionText: event.target.value })} />
                  </Field>
                  <button className="steward-primary" type="submit" disabled={!healthy || busy}>
                    {tt(language, 'steward.verdict.record')}
                  </button>
                </form>
              </details>

              <details className="steward-details">
                <summary>{tt(language, 'steward.governance.title')}</summary>
                <div className="steward-governance-grid">
                  <form className="steward-form" onSubmit={(event) => void recordDissent(event)}>
                    <h4>{tt(language, 'steward.dissent.title')}</h4>
                    <Field label={tt(language, 'steward.field.verdict')}>
                      <select required disabled={!healthy} value={dissent.verdictId} onChange={(event) => setDissent({ ...dissent, verdictId: event.target.value })}>
                        <option value="">{tt(language, 'steward.verdict.choose')}</option>
                        {selected.verdicts.map((entry) => <option key={entry.verdictId} value={entry.verdictId}>{entry.verdictId}</option>)}
                      </select>
                    </Field>
                    <Field label={tt(language, 'steward.field.statement')}>
                      <textarea required disabled={!healthy} rows={3} value={dissent.statement} onChange={(event) => setDissent({ ...dissent, statement: event.target.value })} />
                    </Field>
                    <Field label={tt(language, 'steward.field.grounds')}>
                      <textarea required disabled={!healthy} rows={3} value={dissent.grounds} onChange={(event) => setDissent({ ...dissent, grounds: event.target.value })} />
                    </Field>
                    <button type="submit" disabled={!healthy || busy}>{tt(language, 'steward.dissent.record')}</button>
                  </form>
                  <form className="steward-form" onSubmit={(event) => void fileAppeal(event)}>
                    <h4>{tt(language, 'steward.appeal.title')}</h4>
                    <Field label={tt(language, 'steward.field.verdict')}>
                      <select required disabled={!healthy} value={appeal.verdictId} onChange={(event) => setAppeal({ ...appeal, verdictId: event.target.value })}>
                        <option value="">{tt(language, 'steward.verdict.choose')}</option>
                        {selected.verdicts.map((entry) => <option key={entry.verdictId} value={entry.verdictId}>{entry.verdictId}</option>)}
                      </select>
                    </Field>
                    <Field label={tt(language, 'steward.field.grounds')}>
                      <textarea required disabled={!healthy} rows={3} value={appeal.grounds} onChange={(event) => setAppeal({ ...appeal, grounds: event.target.value })} />
                    </Field>
                    <Field label={tt(language, 'steward.field.remedy')}>
                      <textarea required disabled={!healthy} rows={3} value={appeal.requestedRemedy} onChange={(event) => setAppeal({ ...appeal, requestedRemedy: event.target.value })} />
                    </Field>
                    <button type="submit" disabled={!healthy || busy}>{tt(language, 'steward.appeal.file')}</button>
                  </form>
                  <form className="steward-form" onSubmit={(event) => void resolveAppeal(event)}>
                    <h4>{tt(language, 'steward.resolution.title')}</h4>
                    <Field label={tt(language, 'steward.field.appeal')}>
                      <select required disabled={!healthy} value={resolution.appealId} onChange={(event) => setResolution({ ...resolution, appealId: event.target.value })}>
                        <option value="">{tt(language, 'steward.appeal.choose')}</option>
                        {openAppeals.map((entry) => <option key={entry.appealId} value={entry.appealId}>{entry.appealId}</option>)}
                      </select>
                    </Field>
                    <Field label={tt(language, 'steward.field.resolution')}>
                      <select disabled={!healthy} value={resolution.resolution} onChange={(event) => setResolution({ ...resolution, resolution: event.target.value as StewardAppealResolutionKind })}>
                        {RESOLUTION_VALUES.map((value) => <option key={value} value={value}>{tt(language, `steward.resolution.${value}`)}</option>)}
                      </select>
                    </Field>
                    <Field label={tt(language, 'steward.field.reasoning')} hint={tt(language, 'steward.resolution.help')}>
                      <textarea required disabled={!healthy} rows={4} value={resolution.reasoning} onChange={(event) => setResolution({ ...resolution, reasoning: event.target.value })} />
                    </Field>
                    <button type="submit" disabled={!healthy || busy || openAppeals.length === 0}>{tt(language, 'steward.resolution.record')}</button>
                  </form>
                </div>
                <div className="steward-list governance-history">
                  {selected.dissents.map((entry) => (
                    <article key={entry.dissentId}>
                      <div><strong>{tt(language, 'steward.dissent.title')}</strong><p>{entry.statement}</p></div>
                      <span>{entry.submittedBy.displayName}</span>
                    </article>
                  ))}
                  {selected.appeals.map((entry) => (
                    <article key={entry.appealId}>
                      <div>
                        <strong>{tt(language, 'steward.appeal.title')} · {entry.status}</strong>
                        <p>{entry.grounds}</p>
                        {entry.resolutions.map((item) => <small key={item.resolutionId}>{item.resolution}: {item.reasoning}</small>)}
                      </div>
                      <span>{entry.filedBy.displayName}</span>
                    </article>
                  ))}
                </div>
              </details>

              <details className="steward-details">
                <summary>{tt(language, 'steward.audit.title')}</summary>
                <ol className="steward-timeline" aria-label={tt(language, 'steward.audit.aria')}>
                  {selected.history.map((entry) => (
                    <li key={entry.eventId}>
                      <span>{entry.sequence}</span>
                      <div>
                        <strong>{tt(language, `steward.event.${entry.type}`)}</strong>
                        <small>{entry.actor.displayName} · {formatDate(entry.occurredAt, language)}</small>
                      </div>
                      <code>{entry.eventHash.slice(0, 12)}</code>
                    </li>
                  ))}
                </ol>
              </details>
            </>
          )}
        </section>
      </div>
    </section>
  )
}
