import { type CSSProperties, type ChangeEvent, type ReactElement, useCallback, useEffect, useMemo, useState } from 'react'
import {
  STORY_ENGINE_CHANNELS,
  storyPreview,
  type StoryCard,
  type StoryDestination,
  type StoryEngineState,
  type StoryExportResult,
  type StoryRaceTimeline
} from '../../../shared/story-engine'
import type { AppViewProps } from '../App'
import { tt } from '../i18n'

const panel: CSSProperties = {
  background: 'var(--surface-raised)',
  border: '1px solid rgba(232,105,32,0.18)',
  borderRadius: 'var(--radius-sm)',
  padding: 16
}

const inset: CSSProperties = {
  background: 'var(--surface-sunken)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 'var(--radius-sm)',
  padding: 12
}

const label: CSSProperties = {
  fontSize: 11,
  letterSpacing: 1,
  textTransform: 'uppercase',
  color: 'var(--text-muted)'
}

const input: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '9px 10px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid rgba(255,255,255,0.14)',
  background: 'rgba(0,0,0,0.24)',
  color: 'var(--text-primary)'
}

const button: CSSProperties = {
  padding: '8px 12px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid rgba(255,255,255,0.14)',
  background: 'transparent',
  color: 'var(--text-primary)',
  cursor: 'pointer',
  fontWeight: 700
}

const primaryButton: CSSProperties = {
  ...button,
  borderColor: 'rgba(var(--accent-rgb),0.6)',
  background: 'rgba(var(--accent-rgb),0.18)'
}

const dangerButton: CSSProperties = {
  ...button,
  borderColor: 'rgba(255,85,85,0.45)',
  color: 'var(--accent-danger)'
}

const row: CSSProperties = {
  display: 'flex',
  gap: 10,
  alignItems: 'center',
  flexWrap: 'wrap'
}

const DESTINATIONS: readonly StoryDestination[] = ['local', 'lan', 'internet']

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function formatSessionTime(ms: number): string {
  const seconds = Math.max(0, ms) / 1_000
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${(seconds - minutes * 60).toFixed(1).padStart(4, '0')}`
}

function formatDate(ms: number | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '—'
  return new Date(ms).toLocaleString()
}

function destinationLabel(language: AppViewProps['language'], destination: StoryDestination): string {
  return tt(language, `story.destination.${destination}`)
}

function statusColor(status: StoryCard['status']): string {
  if (status === 'approved') return 'var(--accent-success)'
  if (status === 'rejected') return 'var(--accent-danger)'
  if (status === 'exported') return 'var(--accent-info, #6aa9ff)'
  return 'var(--accent-primary)'
}

function PreviewCard({
  card,
  destination,
  language,
  selected,
  onSelect
}: {
  card: StoryCard
  destination: StoryDestination
  language: AppViewProps['language']
  selected: boolean
  onSelect(): void
}): ReactElement {
  const preview = storyPreview(card, destination)
  if (!preview) return <></>
  const blocked = preview.status === 'blocked'
  return (
    <label
      style={{
        ...inset,
        display: 'block',
        cursor: 'pointer',
        borderColor: selected ? 'rgba(var(--accent-rgb),0.65)' : blocked ? 'rgba(255,85,85,0.28)' : 'rgba(255,255,255,0.08)',
        opacity: blocked ? 0.72 : 1
      }}
    >
      <div style={{ ...row, justifyContent: 'space-between' }}>
        <span style={{ fontWeight: 800 }}>
          <input
            checked={selected}
            disabled={blocked}
            name={`story-destination-${card.id}`}
            onChange={onSelect}
            type="radio"
          />{' '}
          {destinationLabel(language, destination)}
        </span>
        <span style={{ ...label, color: blocked ? 'var(--accent-danger)' : preview.status === 'redacted' ? 'var(--accent-warning)' : 'var(--accent-success)' }}>
          {tt(language, `story.preview.${preview.status}`)}
        </span>
      </div>
      <strong style={{ display: 'block', marginTop: 10 }}>{preview.title}</strong>
      <p style={{ margin: '6px 0 0', color: 'var(--text-secondary)', lineHeight: 1.45 }}>{preview.body}</p>
      {preview.reasons.length > 0 && (
        <div style={{ marginTop: 8, color: 'var(--accent-danger)', fontSize: 12 }}>
          {preview.reasons.join(' · ')}
        </div>
      )}
      <div style={{ marginTop: 8, color: 'var(--text-muted)', fontSize: 11 }}>
        {tt(language, 'story.previewOnly')}
      </div>
    </label>
  )
}

export default function StoryEngineView({ language, showToast }: AppViewProps): ReactElement {
  const [state, setState] = useState<StoryEngineState | null>(null)
  const [reviewer, setReviewer] = useState('')
  const [reviewed, setReviewed] = useState<Record<string, string>>({})
  const [destinations, setDestinations] = useState<Record<string, StoryDestination>>({})
  const [exportDestination, setExportDestination] = useState<StoryDestination>('local')
  const [timelineJson, setTimelineJson] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setState(await window.ipc.invoke<StoryEngineState>(STORY_ENGINE_CHANNELS.state))
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    }
  }, [showToast])

  useEffect(() => {
    void refresh()
    return window.ipc.subscribe<StoryEngineState>(STORY_ENGINE_CHANNELS.changed, setState)
  }, [refresh])

  const cards = state?.cards ?? []
  const approvedForExport = useMemo(
    () => cards.filter((card) =>
      card.status === 'approved' &&
      card.approval?.destination === exportDestination &&
      card.approval.consumedAt === undefined
    ),
    [cards, exportDestination]
  )

  const selectedDestination = useCallback((card: StoryCard): StoryDestination => (
    destinations[card.id] ?? card.approval?.destination ?? 'local'
  ), [destinations])

  const reviewToken = useCallback((card: StoryCard, destination: StoryDestination): string => (
    `${card.revision}:${destination}:${reviewer.trim()}`
  ), [reviewer])

  const toggleReviewed = useCallback((card: StoryCard, destination: StoryDestination, checked: boolean): void => {
    setReviewed((current) => {
      const next = { ...current }
      if (checked) next[card.id] = reviewToken(card, destination)
      else delete next[card.id]
      return next
    })
  }, [reviewToken])

  const decide = useCallback(async (card: StoryCard, decision: 'approved' | 'rejected'): Promise<void> => {
    const destination = selectedDestination(card)
    setBusy(`${decision}:${card.id}`)
    try {
      const next = await window.ipc.invoke<StoryEngineState>(STORY_ENGINE_CHANNELS.decide, {
        cardId: card.id,
        revision: card.revision,
        decision,
        reviewer,
        destination: decision === 'approved' ? destination : undefined,
        humanConfirmed: reviewed[card.id] === reviewToken(card, destination)
      })
      setState(next)
      toggleReviewed(card, destination, false)
      showToast(tt(language, decision === 'approved' ? 'story.approved' : 'story.rejected'), 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      setBusy(null)
    }
  }, [language, reviewToken, reviewed, reviewer, selectedDestination, showToast, toggleReviewed])

  const exportCards = useCallback(async (format: 'json' | 'markdown'): Promise<void> => {
    setBusy(`export:${format}`)
    try {
      const result = await window.ipc.invoke<StoryExportResult>(STORY_ENGINE_CHANNELS.exportApproved, {
        destination: exportDestination,
        format,
        cardIds: approvedForExport.map((card) => card.id)
      })
      showToast(tt(language, 'story.exported', { path: result.path }), 'success')
      await refresh()
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      setBusy(null)
    }
  }, [approvedForExport, exportDestination, language, refresh, showToast])

  const importTimeline = useCallback(async (): Promise<void> => {
    setBusy('generate')
    try {
      const timeline = JSON.parse(timelineJson) as StoryRaceTimeline
      const next = await window.ipc.invoke<StoryEngineState>(STORY_ENGINE_CHANNELS.generate, timeline)
      setState(next)
      showToast(tt(language, 'story.generated', { count: next.lastGeneration?.candidateCount ?? 0 }), 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      setBusy(null)
    }
  }, [language, showToast, timelineJson])

  const loadTimelineFile = useCallback(async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      setTimelineJson(await file.text())
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      event.target.value = ''
    }
  }, [showToast])

  const resetQueue = useCallback(async (): Promise<void> => {
    if (!window.confirm(tt(language, 'story.resetConfirm'))) return
    setBusy('reset')
    try {
      setState(await window.ipc.invoke<StoryEngineState>(STORY_ENGINE_CHANNELS.reset))
      setReviewed({})
      showToast(tt(language, 'story.resetDone'), 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      setBusy(null)
    }
  }, [language, showToast])

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <section
        style={{
          ...panel,
          borderColor: 'rgba(232,105,32,0.45)',
          background: 'linear-gradient(135deg, rgba(232,105,32,0.12), var(--surface-raised))'
        }}
      >
        <div style={label}>{tt(language, 'story.guardrail')}</div>
        <h3 style={{ margin: '6px 0 4px' }}>{tt(language, 'story.localOnlyTitle')}</h3>
        <p style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          {tt(language, 'story.localOnlyBody')}
        </p>
      </section>

      <section style={{ ...panel, display: 'grid', gap: 12 }}>
        <div style={{ ...row, justifyContent: 'space-between' }}>
          <div>
            <div style={label}>{tt(language, 'story.review')}</div>
            <strong>{tt(language, 'story.reviewer')}</strong>
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
            {tt(language, 'story.queueSummary', { cards: cards.length, issues: state?.issues.length ?? 0 })}
          </div>
        </div>
        <input
          aria-label={tt(language, 'story.reviewer')}
          onChange={(event) => setReviewer(event.target.value)}
          placeholder={tt(language, 'story.reviewerPlaceholder')}
          style={input}
          value={reviewer}
        />
        {state?.lastGeneration && (
          <div style={{ ...inset, ...row, justifyContent: 'space-between' }}>
            <span>
              <strong>{state.lastGeneration.sessionRef}</strong>
              <span style={{ marginLeft: 8, color: 'var(--text-muted)' }}>
                {formatDate(state.lastGeneration.generatedAt)}
              </span>
            </span>
            <span style={label}>
              {tt(language, 'story.lastGeneration', {
                cards: state.lastGeneration.candidateCount,
                issues: state.lastGeneration.issueCount
              })}
            </span>
          </div>
        )}
      </section>

      <section style={{ ...panel, display: 'grid', gap: 12 }}>
        <div>
          <div style={label}>{tt(language, 'story.importEyebrow')}</div>
          <h3 style={{ margin: '5px 0' }}>{tt(language, 'story.importTitle')}</h3>
          <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{tt(language, 'story.importBody')}</p>
        </div>
        <div style={row}>
          <label style={{ ...button, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {tt(language, 'story.chooseFile')}
            <input accept=".json,application/json" onChange={(event) => void loadTimelineFile(event)} style={{ display: 'none' }} type="file" />
          </label>
          <button
            disabled={busy !== null || timelineJson.trim().length === 0}
            onClick={() => void importTimeline()}
            style={primaryButton}
            type="button"
          >
            {tt(language, 'story.generate')}
          </button>
        </div>
        <textarea
          aria-label={tt(language, 'story.timelineJson')}
          onChange={(event) => setTimelineJson(event.target.value)}
          placeholder={tt(language, 'story.timelinePlaceholder')}
          rows={7}
          style={{ ...input, resize: 'vertical', fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: 12 }}
          value={timelineJson}
        />
      </section>

      {state?.issues && state.issues.length > 0 && (
        <section style={{ ...panel, borderColor: 'rgba(255,170,70,0.32)' }}>
          <div style={label}>{tt(language, 'story.abstentions')}</div>
          <ul style={{ margin: '8px 0 0', paddingLeft: 20, color: 'var(--text-secondary)' }}>
            {state.issues.map((issue, index) => (
              <li key={`${issue.code}-${index}`} style={{ marginBottom: 6 }}>
                <strong>{issue.code}</strong> — {issue.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      {cards.length === 0 ? (
        <section style={{ ...panel, borderStyle: 'dashed', color: 'var(--text-muted)' }}>
          <strong>{tt(language, 'story.emptyTitle')}</strong>
          <p style={{ margin: '6px 0 0' }}>{tt(language, 'story.emptyBody')}</p>
        </section>
      ) : cards.map((card) => {
        const destination = selectedDestination(card)
        const preview = storyPreview(card, destination)
        const blocked = preview?.status === 'blocked'
        const reviewedCurrentPreview = reviewed[card.id] === reviewToken(card, destination)
        return (
          <article key={card.id} style={{ ...panel, display: 'grid', gap: 14 }}>
            <div style={{ ...row, justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={label}>
                  {card.sessionRef} · {formatSessionTime(card.observedInterval.startSessionTimeMs)}
                  {card.lap !== undefined ? ` · ${tt(language, 'story.lap', { lap: card.lap })}` : ''}
                </div>
                <h3 style={{ margin: '6px 0 4px' }}>{card.title}</h3>
                <p style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{card.body}</p>
              </div>
              <span style={{ ...label, color: statusColor(card.status), fontWeight: 900 }}>
                {tt(language, `story.status.${card.status}`)}
              </span>
            </div>

            <div style={{ ...row, fontSize: 12 }}>
              <span style={inset}>
                {tt(language, 'story.confidence')}: <strong>{formatPercent(card.confidence.score)} · {card.confidence.level}</strong>
              </span>
              <span style={inset}>
                {tt(language, 'story.rank')}: <strong>{formatPercent(card.rank)}</strong>
              </span>
              <span style={inset}>
                {tt(language, 'story.rights')}: <strong>{card.policy.rightsState}/{card.policy.rightsScope}</strong>
              </span>
              <span style={inset}>
                {tt(language, 'story.consent')}: <strong>{card.policy.consentState}</strong>
              </span>
              <span style={inset}>
                {tt(language, 'story.redactions')}: <strong>{card.redactions.length}</strong>
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
              {DESTINATIONS.map((option) => (
                <PreviewCard
                  card={card}
                  destination={option}
                  key={option}
                  language={language}
                  onSelect={() => {
                    setDestinations((current) => ({ ...current, [card.id]: option }))
                    toggleReviewed(card, destination, false)
                  }}
                  selected={destination === option}
                />
              ))}
            </div>

            <details style={inset}>
              <summary style={{ cursor: 'pointer', fontWeight: 800 }}>
                {tt(language, 'story.provenance', { count: card.provenance.length })}
              </summary>
              <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
                {card.provenance.map((item) => (
                  <div key={item.id} style={{ fontSize: 12, color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>
                    <strong>{item.id}</strong> · {item.source} · SHA-256 {item.contentHash}
                    <br />
                    {tt(language, 'story.timelineOffset', {
                      time: formatSessionTime(item.normalizedSessionTimeMs),
                      offset: Math.round(item.clockOffsetMs)
                    })}
                    <br />
                    {item.origin.producer}@{item.origin.version} · {item.transformLineage.join(' → ')}
                  </div>
                ))}
              </div>
            </details>

            <label style={{ ...inset, display: 'flex', gap: 9, alignItems: 'flex-start' }}>
              <input
                checked={reviewedCurrentPreview}
                onChange={(event) => toggleReviewed(card, destination, event.target.checked)}
                type="checkbox"
              />
              <span>
                <strong>{tt(language, 'story.humanReviewTitle')}</strong>
                <span style={{ display: 'block', color: 'var(--text-muted)', marginTop: 3 }}>
                  {tt(language, 'story.humanReviewBody')}
                </span>
              </span>
            </label>

            <div style={row}>
              <button
                disabled={busy !== null || !reviewedCurrentPreview || reviewer.trim().length === 0 || blocked}
                onClick={() => void decide(card, 'approved')}
                style={primaryButton}
                type="button"
              >
                {tt(language, 'story.approveFor', { destination: destinationLabel(language, destination) })}
              </button>
              <button
                disabled={busy !== null || !reviewedCurrentPreview || reviewer.trim().length === 0}
                onClick={() => void decide(card, 'rejected')}
                style={dangerButton}
                type="button"
              >
                {tt(language, 'story.reject')}
              </button>
              {card.approval && (
                <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                  {tt(language, 'story.approvalReceipt', {
                    id: card.approval.id,
                    expires: formatDate(card.approval.expiresAt)
                  })}
                </span>
              )}
            </div>
          </article>
        )
      })}

      <section style={{ ...panel, display: 'grid', gap: 12 }}>
        <div>
          <div style={label}>{tt(language, 'story.offlineExportEyebrow')}</div>
          <h3 style={{ margin: '5px 0' }}>{tt(language, 'story.offlineExportTitle')}</h3>
          <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{tt(language, 'story.offlineExportBody')}</p>
        </div>
        <div style={row}>
          <select
            aria-label={tt(language, 'story.exportDestination')}
            onChange={(event) => setExportDestination(event.target.value as StoryDestination)}
            style={{ ...input, width: 'auto', minWidth: 220 }}
            value={exportDestination}
          >
            {DESTINATIONS.map((destination) => (
              <option key={destination} value={destination}>{destinationLabel(language, destination)}</option>
            ))}
          </select>
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
            {tt(language, 'story.approvedCount', { count: approvedForExport.length })}
          </span>
          <button
            disabled={busy !== null || approvedForExport.length === 0}
            onClick={() => void exportCards('json')}
            style={primaryButton}
            type="button"
          >
            {tt(language, 'story.exportJson')}
          </button>
          <button
            disabled={busy !== null || approvedForExport.length === 0}
            onClick={() => void exportCards('markdown')}
            style={button}
            type="button"
          >
            {tt(language, 'story.exportMarkdown')}
          </button>
        </div>
      </section>

      <div style={{ ...row, justifyContent: 'flex-end' }}>
        <button disabled={busy !== null} onClick={() => void resetQueue()} style={dangerButton} type="button">
          {tt(language, 'story.reset')}
        </button>
      </div>
    </div>
  )
}
