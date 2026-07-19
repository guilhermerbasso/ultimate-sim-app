import { type FormEvent, type ReactElement, useCallback, useEffect, useMemo, useState } from 'react'
import type { IncidentClipMeta } from '../../../shared/incidents'
import { INCIDENT_CHANNELS } from '../../../shared/incidents'
import {
  STEWARD_CHANNELS,
  type StewardAppealResolutionKind,
  type StewardCase,
  type StewardCaseStatus,
  type StewardEvidenceDetails,
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

function latestTrustedVerdictId(value: StewardCase | null | undefined): string {
  return value?.verdicts.filter((entry) =>
    entry.authority === undefined || entry.authority === 'local-trusted').at(-1)?.verdictId ?? ''
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

function ReadOnlyDetails({
  language,
  verified,
  children
}: {
  language?: ResolvedLanguage
  verified: boolean
  children: ReactElement | ReactElement[]
}): ReactElement {
  return (
    <details className="steward-readonly-details">
      <summary>
        {tt(language, verified ? 'steward.details.verified' : 'steward.details.quarantined')}
      </summary>
      <div className="steward-detail-body" role="group" aria-label={tt(language, 'steward.details.aria')}>
        {children}
      </div>
    </details>
  )
}

function DetailList({
  rows
}: {
  rows: Array<[string, string | number | undefined]>
}): ReactElement {
  return (
    <dl className="steward-detail-list">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value === undefined || value === '' ? '—' : String(value)}</dd>
        </div>
      ))}
    </dl>
  )
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
  const [referencesDirty, setReferencesDirty] = useState(false)
  const [evidenceDetails, setEvidenceDetails] = useState<Record<string, StewardEvidenceDetails>>({})
  const [evidenceLoadingId, setEvidenceLoadingId] = useState('')
  const [evidenceIncidentId, setEvidenceIncidentId] = useState('')
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
    actionText: '',
    manualReviewConfirmed: false
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
  const openAppeals = selected?.appeals.filter((entry) =>
    (entry.authority === undefined || entry.authority === 'local-trusted') &&
    entry.status === 'open') ?? []
  const statusLockedByAppeal = openAppeals.length > 0
  const caseDraftDirty = useMemo(
    () =>
      referencesDirty ||
      Object.values(bookmark).some(Boolean) ||
      Object.values(manualEvidence).some(Boolean) ||
      Object.values(rule).some(Boolean) ||
      Boolean(verdict.decisionText || verdict.actionText || verdict.manualReviewConfirmed) ||
      Boolean(dissent.statement || dissent.grounds) ||
      Boolean(appeal.grounds || appeal.requestedRemedy) ||
      Boolean(resolution.reasoning) ||
      Boolean(evidenceIncidentId) ||
      verdict.finding !== 'insufficient-evidence' ||
      dissent.verdictId !== latestTrustedVerdictId(selected) ||
      appeal.verdictId !== latestTrustedVerdictId(selected) ||
      resolution.appealId !== (openAppeals[0]?.appealId ?? '') ||
      resolution.resolution !== 'upheld',
    [
      appeal,
      bookmark,
      dissent,
      evidenceIncidentId,
      manualEvidence,
      openAppeals,
      referencesDirty,
      resolution,
      rule,
      selected,
      verdict
    ]
  )

  function resetCaseDrafts(caseValue: StewardCase | null): void {
    const latestVerdict = latestTrustedVerdictId(caseValue)
    const firstOpenAppeal = caseValue?.appeals.find((entry) =>
      (entry.authority === undefined || entry.authority === 'local-trusted') &&
      entry.status === 'open')?.appealId ?? ''
    setBookmark({ sourceId: '', label: '', lap: '', sessionTimeSec: '', replayFrame: '' })
    setManualEvidence({ summary: '', sourceRef: '', content: '' })
    setRule({ rulesetId: '', version: '', section: '', title: '', text: '', source: '' })
    setVerdict({
      finding: 'insufficient-evidence',
      decisionText: '',
      actionText: '',
      manualReviewConfirmed: false
    })
    setDissent({ verdictId: latestVerdict, statement: '', grounds: '' })
    setAppeal({ verdictId: latestVerdict, grounds: '', requestedRemedy: '' })
    setResolution({ appealId: firstOpenAppeal, resolution: 'upheld', reasoning: '' })
    setSelectedRuleIds(caseValue?.rules.at(-1) ? [caseValue.rules.at(-1)!.citationId] : [])
    setSelectedEvidenceIds(
      caseValue?.evidence.filter((entry) => entry.state === 'available').map((entry) => entry.evidenceId) ?? []
    )
    setReferencesDirty(false)
    setEvidenceDetails({})
    setEvidenceLoadingId('')
    setEvidenceIncidentId('')
  }

  function confirmDraftDiscard(): boolean {
    if (!caseDraftDirty) return true
    return window.confirm(tt(language, 'steward.drafts.confirmDiscard'))
  }

  function selectCase(nextId: string): void {
    if (nextId === selectedId) return
    if (!confirmDraftDiscard()) return
    const next = cases.find((entry) => entry.caseId === nextId) ?? null
    resetCaseDrafts(next)
    setSelectedId(nextId)
  }

  function clearDraftsWithConfirmation(): void {
    if (!caseDraftDirty) return
    if (!confirmDraftDiscard()) return
    resetCaseDrafts(selected)
  }

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
    setReferencesDirty(false)
    const latestVerdict = latestTrustedVerdictId(selected)
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
    if (selected && !confirmDraftDiscard()) return
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
        actorLabel: stewardName,
        identity: {
          leagueId: create.leagueId,
          leagueName: create.leagueName,
          eventId: create.eventId,
          eventName: create.eventName,
          sessionId: selectedClip?.captureSession?.captureSessionId ?? create.sessionId,
          sim: selectedClip?.captureSession?.sim ?? create.sim,
          sessionType: selectedClip?.captureSession?.sessionType ?? create.sessionType,
          trackName: selectedClip?.captureSession?.trackName ?? create.trackName
        },
        incident
      },
      'steward.toast.created'
    )
    if (next) {
      resetCaseDrafts(next)
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
        actorLabel: stewardName,
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
    if (!selected || !evidenceIncidentId) return
    setBusy(true)
    try {
      const next = await window.ipc.invoke<StewardCase>(STEWARD_CHANNELS.lockIncidentEvidence, {
        caseId: selected.caseId,
        incidentId: evidenceIncidentId,
        actorLabel: stewardName
      })
      upsert(next)
      setEvidenceIncidentId('')
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
        actorLabel: stewardName,
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
        actorLabel: stewardName,
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
        actorLabel: stewardName,
        ...verdict,
        ruleCitationIds: selectedRuleIds,
        evidenceIds: selectedEvidenceIds,
        supersedesVerdictId: selected.verdicts.at(-1)?.verdictId
      },
      'steward.toast.verdict'
    )
    if (next) {
      setVerdict({
        finding: 'insufficient-evidence',
        decisionText: '',
        actionText: '',
        manualReviewConfirmed: false
      })
    }
  }

  async function recordDissent(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!selected) return
    const next = await mutate<StewardCase>(
      STEWARD_CHANNELS.recordDissent,
      {
        caseId: selected.caseId,
        actorLabel: participantName,
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
        actorLabel: participantName,
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
        actorLabel: stewardName,
        ...resolution
      },
      'steward.toast.resolution'
    )
    if (next) {
      setResolution({
        appealId: next.appeals.find((entry) => entry.status === 'open')?.appealId ?? '',
        resolution: 'upheld',
        reasoning: ''
      })
    }
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

  async function loadEvidenceDetails(evidenceId: string): Promise<void> {
    if (!selected || evidenceDetails[evidenceId]) return
    setEvidenceLoadingId(evidenceId)
    try {
      const details = await window.ipc.invoke<StewardEvidenceDetails>(
        STEWARD_CHANNELS.getEvidenceDetails,
        { caseId: selected.caseId, evidenceId }
      )
      setEvidenceDetails((current) => ({ ...current, [evidenceId]: details }))
    } catch (error) {
      showToast(errorMessage(error), 'error')
    } finally {
      setEvidenceLoadingId('')
    }
  }

  async function importCase(): Promise<void> {
    if (selected && !confirmDraftDiscard()) return
    setBusy(true)
    try {
      const result = await window.ipc.invoke<StewardImportResult>(STEWARD_CHANNELS.importCase)
      if (result.importedCase) {
        resetCaseDrafts(result.importedCase)
        upsert(result.importedCase)
        showToast(
          tt(
            language,
            result.deduplicated
              ? 'steward.toast.importDeduplicated'
              : result.retried
                ? 'steward.toast.importRetried'
                : 'steward.toast.imported'
          ),
          'success'
        )
      }
    } catch (error) {
      showToast(errorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  function toggleReference(id: string, selectedValues: string[], update: (ids: string[]) => void): void {
    setReferencesDirty(true)
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
                  onClick={() => selectCase(entry.caseId)}
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
                  <input
                    required
                    readOnly={Boolean(selectedClip?.captureSession)}
                    value={selectedClip?.captureSession?.captureSessionId ?? create.sessionId}
                    onChange={(event) => setCreate({ ...create, sessionId: event.target.value })}
                  />
                </Field>
                <Field label={tt(language, 'steward.field.track')}>
                  <input
                    required
                    readOnly={Boolean(selectedClip?.captureSession?.trackName)}
                    value={selectedClip?.captureSession?.trackName ?? create.trackName}
                    onChange={(event) => setCreate({ ...create, trackName: event.target.value })}
                  />
                </Field>
                <Field label={tt(language, 'steward.field.sim')}>
                  <input
                    required
                    readOnly={Boolean(selectedClip?.captureSession)}
                    value={selectedClip?.captureSession?.sim ?? create.sim}
                    onChange={(event) => setCreate({ ...create, sim: event.target.value })}
                  />
                </Field>
                <Field label={tt(language, 'steward.field.sessionType')}>
                  <input
                    required
                    readOnly={Boolean(selectedClip?.captureSession?.sessionType)}
                    value={selectedClip?.captureSession?.sessionType ?? create.sessionType}
                    onChange={(event) => setCreate({ ...create, sessionType: event.target.value })}
                  />
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

              {selected.manualReviewMigration?.pendingVerdictIds.length ? (
                <div className="steward-owner-banner" role="status">
                  <strong>{tt(language, 'steward.review.required')}</strong>
                  <span>{tt(language, 'steward.review.legacyBanner')}</span>
                </div>
              ) : null}

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
                    disabled={!healthy || busy || statusLockedByAppeal}
                    aria-describedby={statusLockedByAppeal ? 'steward-status-derived' : undefined}
                    onChange={(event) => void mutate<StewardCase>(
                      STEWARD_CHANNELS.setStatus,
                      {
                        caseId: selected.caseId,
                        actorLabel: stewardName,
                        status: event.target.value
                      },
                      'steward.toast.status'
                    )}
                  >
                    {STATUS_VALUES.map((status) => (
                      <option key={status} value={status}>{tt(language, `steward.status.${status}`)}</option>
                    ))}
                  </select>
                  {statusLockedByAppeal ? (
                    <small id="steward-status-derived">{tt(language, 'steward.status.appealDerived')}</small>
                  ) : null}
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
                      actorLabel: stewardName
                    },
                    'steward.toast.assigned'
                  )}
                >
                  {tt(language, 'steward.assignCurrent')}
                </button>
                <button type="button" disabled={!healthy || busy} onClick={() => void exportCase('full-local')}>
                  {tt(language, 'steward.exportLocal')}
                </button>
                <button
                  type="button"
                  disabled={!caseDraftDirty || busy}
                  onClick={clearDraftsWithConfirmation}
                >
                  {tt(language, 'steward.drafts.clear')}
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
                        <ReadOnlyDetails language={language} verified={healthy}>
                          <DetailList rows={[
                            [tt(language, 'steward.details.id'), entry.bookmarkId],
                            [tt(language, 'steward.details.source'), entry.source],
                            [tt(language, 'steward.details.sourceRef'), entry.sourceId],
                            [tt(language, 'steward.details.label'), entry.label],
                            [tt(language, 'steward.details.occurredAt'), formatDate(entry.occurredAt, language)],
                            [tt(language, 'steward.details.sessionTime'), entry.sessionTimeSec],
                            [tt(language, 'steward.details.lap'), entry.lap],
                            [tt(language, 'steward.details.lapDistance'), entry.lapDistPct],
                            [tt(language, 'steward.details.replayFrame'), entry.replayFrame],
                            [tt(language, 'steward.details.windowBefore'), entry.windowBeforeSec],
                            [tt(language, 'steward.details.windowAfter'), entry.windowAfterSec],
                            [tt(language, 'steward.details.notes'), entry.notes],
                            [tt(language, 'steward.details.createdAt'), formatDate(entry.createdAt, language)],
                            [tt(language, 'steward.details.createdBy'), `${entry.createdBy.displayName} · ${entry.createdBy.id} · ${entry.createdBy.role}`]
                          ]} />
                        </ReadOnlyDetails>
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
                        <ReadOnlyDetails language={language} verified={healthy}>
                          <>
                            <DetailList rows={[
                              [tt(language, 'steward.details.id'), entry.evidenceId],
                              [tt(language, 'steward.details.summary'), entry.summary],
                              [tt(language, 'steward.details.mediaType'), entry.mediaType],
                              [tt(language, 'steward.details.contentHash'), entry.contentHash],
                              [tt(language, 'steward.details.byteLength'), entry.byteLength],
                              [tt(language, 'steward.details.state'), entry.state],
                              [tt(language, 'steward.details.sourceKind'), entry.provenance.sourceKind],
                              [tt(language, 'steward.details.sourceRef'), entry.provenance.sourceRef],
                              [tt(language, 'steward.details.producer'), entry.provenance.producer],
                              [tt(language, 'steward.details.producerVersion'), entry.provenance.producerVersion],
                              [tt(language, 'steward.details.capturedAt'), formatDate(entry.provenance.capturedAt, language)],
                              [tt(language, 'steward.details.sessionRef'), entry.provenance.sessionRef],
                              [tt(language, 'steward.details.captureRange'), entry.provenance.captureRange],
                              [tt(language, 'steward.details.transform'), entry.provenance.transform],
                              [tt(language, 'steward.details.trust'), entry.provenance.trust ?? 'manual-unverified'],
                              [tt(language, 'steward.details.notes'), entry.provenance.notes],
                              [tt(language, 'steward.details.lockedAt'), formatDate(entry.lockedAt, language)],
                              [tt(language, 'steward.details.lockedBy'), `${entry.lockedBy.displayName} · ${entry.lockedBy.id} · ${entry.lockedBy.role}`]
                            ]} />
                            <button
                              type="button"
                              disabled={!healthy || evidenceLoadingId === entry.evidenceId}
                              aria-expanded={Boolean(evidenceDetails[entry.evidenceId])}
                              onClick={() => void loadEvidenceDetails(entry.evidenceId)}
                            >
                              {evidenceDetails[entry.evidenceId]
                                ? tt(language, 'steward.details.contentVerified')
                                : evidenceLoadingId === entry.evidenceId
                                  ? tt(language, 'steward.details.loading')
                                  : tt(language, 'steward.details.loadContent')}
                            </button>
                            {evidenceDetails[entry.evidenceId] ? (
                              <>
                                <p className="steward-verified-note">
                                  {tt(language, 'steward.details.hashVerified')} · {formatDate(evidenceDetails[entry.evidenceId].verifiedAt, language)}
                                </p>
                                <pre className="steward-evidence-content">
                                  {JSON.stringify(evidenceDetails[entry.evidenceId].content, null, 2)}
                                </pre>
                              </>
                            ) : null}
                          </>
                        </ReadOnlyDetails>
                      </div>
                      <span className={`steward-badge evidence-${entry.state}`}>
                        {tt(language, `steward.evidence.${entry.state}`)}
                      </span>
                    </article>
                  ))}
                </div>
                <div className="steward-evidence-actions">
                  <Field label={tt(language, 'steward.field.incidentClip')}>
                    <select value={evidenceIncidentId} onChange={(event) => setEvidenceIncidentId(event.target.value)}>
                      <option value="">{tt(language, 'steward.incident.choose')}</option>
                      {incidentClips.map((clip) => <option key={clip.id} value={clip.id}>{clip.type} · {clip.id}</option>)}
                    </select>
                  </Field>
                  <button type="button" disabled={!healthy || busy || !evidenceIncidentId} onClick={() => void lockSelectedIncident()}>
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
                        <ReadOnlyDetails language={language} verified={healthy}>
                          <DetailList rows={[
                            [tt(language, 'steward.details.id'), entry.citationId],
                            [tt(language, 'steward.details.ruleset'), entry.rulesetId],
                            [tt(language, 'steward.details.version'), entry.version],
                            [tt(language, 'steward.details.section'), entry.section],
                            [tt(language, 'steward.details.title'), entry.title],
                            [tt(language, 'steward.details.text'), entry.text],
                            [tt(language, 'steward.details.source'), entry.source],
                            [tt(language, 'steward.details.contentHash'), entry.contentHash],
                            [tt(language, 'steward.details.citedAt'), formatDate(entry.citedAt, language)],
                            [tt(language, 'steward.details.citedBy'), `${entry.citedBy.displayName} · ${entry.citedBy.id} · ${entry.citedBy.role}`]
                          ]} />
                        </ReadOnlyDetails>
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
                        <ReadOnlyDetails language={language} verified={healthy}>
                          <DetailList rows={[
                            [tt(language, 'steward.details.id'), entry.verdictId],
                            [tt(language, 'steward.details.finding'), entry.finding],
                            [tt(language, 'steward.details.decision'), entry.decisionText],
                            [tt(language, 'steward.details.manualAction'), entry.actionText],
                            [tt(language, 'steward.details.ruleRefs'), entry.ruleCitationIds.join(', ')],
                            [tt(language, 'steward.details.evidenceRefs'), entry.evidenceIds.join(', ')],
                            [tt(language, 'steward.details.supersedes'), entry.supersedesVerdictId],
                            [tt(language, 'steward.details.authority'), entry.authority ?? 'local-trusted'],
                            [
                              tt(language, 'steward.details.reviewStatus'),
                              tt(
                                language,
                                entry.manualReviewConfirmed
                                  ? 'steward.review.confirmed'
                                  : 'steward.review.required'
                              )
                            ],
                            [tt(language, 'steward.details.decidedAt'), formatDate(entry.decidedAt, language)],
                            [tt(language, 'steward.details.decidedBy'), `${entry.decidedBy.displayName} · ${entry.decidedBy.id} · ${entry.decidedBy.role}${entry.decidedBy.claimedRole ? ` · claimed ${entry.decidedBy.claimedRole}` : ''}`]
                          ]} />
                        </ReadOnlyDetails>
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
                  <label className="steward-check">
                    <input
                      type="checkbox"
                      checked={verdict.manualReviewConfirmed}
                      onChange={(event) => setVerdict({
                        ...verdict,
                        manualReviewConfirmed: event.target.checked
                      })}
                    />
                    {tt(language, 'steward.verdict.manualReview')}
                  </label>
                  <button
                    className="steward-primary"
                    type="submit"
                    disabled={!healthy || busy || !verdict.manualReviewConfirmed}
                  >
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
                      <div>
                        <strong>{tt(language, 'steward.dissent.title')}</strong>
                        <p>{entry.statement}</p>
                        <ReadOnlyDetails language={language} verified={healthy}>
                          <DetailList rows={[
                            [tt(language, 'steward.details.id'), entry.dissentId],
                            [tt(language, 'steward.details.verdictId'), entry.verdictId],
                            [tt(language, 'steward.details.statement'), entry.statement],
                            [tt(language, 'steward.details.grounds'), entry.grounds],
                            [tt(language, 'steward.details.submittedAt'), formatDate(entry.submittedAt, language)],
                            [tt(language, 'steward.details.submittedBy'), `${entry.submittedBy.displayName} · ${entry.submittedBy.id} · ${entry.submittedBy.role}`]
                          ]} />
                        </ReadOnlyDetails>
                      </div>
                      <span>{entry.submittedBy.displayName}</span>
                    </article>
                  ))}
                  {selected.appeals.map((entry) => (
                    <article key={entry.appealId}>
                      <div>
                        <strong>{tt(language, 'steward.appeal.title')} · {entry.status}</strong>
                        <p>{entry.grounds}</p>
                        {entry.resolutions.map((item) => <small key={item.resolutionId}>{item.resolution}: {item.reasoning}</small>)}
                        <ReadOnlyDetails language={language} verified={healthy}>
                          <>
                            <DetailList rows={[
                              [tt(language, 'steward.details.id'), entry.appealId],
                              [tt(language, 'steward.details.verdictId'), entry.verdictId],
                              [tt(language, 'steward.details.grounds'), entry.grounds],
                              [tt(language, 'steward.details.remedy'), entry.requestedRemedy],
                              [tt(language, 'steward.details.authority'), entry.authority ?? 'local-trusted'],
                              [tt(language, 'steward.details.filedAt'), formatDate(entry.filedAt, language)],
                              [tt(language, 'steward.details.filedBy'), `${entry.filedBy.displayName} · ${entry.filedBy.id} · ${entry.filedBy.role}${entry.filedBy.claimedRole ? ` · claimed ${entry.filedBy.claimedRole}` : ''}`],
                              [tt(language, 'steward.details.status'), entry.status]
                            ]} />
                            {entry.resolutions.map((item) => (
                              <div className="steward-resolution-detail" key={item.resolutionId}>
                                <strong>{tt(language, 'steward.details.resolution')}</strong>
                                <DetailList rows={[
                                  [tt(language, 'steward.details.id'), item.resolutionId],
                                  [tt(language, 'steward.details.resolution'), item.resolution],
                                  [tt(language, 'steward.details.reasoning'), item.reasoning],
                                  [tt(language, 'steward.details.authority'), item.authority ?? 'local-trusted'],
                                  [tt(language, 'steward.details.resolvedAt'), formatDate(item.resolvedAt, language)],
                                  [tt(language, 'steward.details.resolvedBy'), `${item.resolvedBy.displayName} · ${item.resolvedBy.id} · ${item.resolvedBy.role}${item.resolvedBy.claimedRole ? ` · claimed ${item.resolvedBy.claimedRole}` : ''}`]
                                ]} />
                              </div>
                            ))}
                          </>
                        </ReadOnlyDetails>
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
