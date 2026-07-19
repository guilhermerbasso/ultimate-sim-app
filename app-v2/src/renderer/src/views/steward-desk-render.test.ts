// @vitest-environment jsdom

import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { INCIDENT_CHANNELS } from '../../../shared/incidents'
import {
  STEWARD_CHANNELS,
  type StewardCase,
  type StewardEvidenceDetails
} from '../../../shared/steward-desk'
import StewardDeskView from './StewardDeskView'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function fixture(caseId: string, title: string, appealed = false): StewardCase {
  const steward = { id: 'steward-1', displayName: 'Steward One', role: 'steward' as const }
  return {
    schemaVersion: 1,
    caseId,
    title,
    createdAt: 1_000,
    createdBy: steward,
    identity: {
      leagueId: 'league',
      leagueName: 'League',
      eventId: 'event',
      eventName: 'Round One',
      sessionId: `session-${caseId}`,
      sim: 'iRacing',
      sessionType: 'Race',
      trackName: 'Spa'
    },
    primaryIncidentFingerprint: 'a'.repeat(64),
    status: appealed ? 'appealed' : 'under-review',
    assignedTo: steward,
    bookmarks: [{
      bookmarkId: 'bookmark-1',
      source: 'replay',
      sourceId: 'replay-1',
      label: 'Turn one contact',
      occurredAt: 900,
      sessionTimeSec: 90,
      lap: 1,
      replayFrame: 42,
      windowBeforeSec: 5,
      windowAfterSec: 5,
      notes: 'Read-only bookmark notes',
      createdAt: 1_000,
      createdBy: steward
    }],
    evidence: [{
      evidenceId: 'evidence-1',
      summary: 'Evidence summary',
      mediaType: 'application/json',
      contentHash: 'b'.repeat(64),
      byteLength: 20,
      provenance: {
        sourceKind: 'replay',
        sourceRef: 'replay-1',
        producer: 'Recorder',
        producerVersion: '1',
        capturedAt: 900,
        sessionRef: `session-${caseId}`,
        captureRange: '85-95',
        transform: 'none',
        notes: 'Evidence provenance notes'
      },
      lockedAt: 1_000,
      lockedBy: steward,
      state: 'available'
    }],
    rules: [{
      citationId: 'rule-1',
      rulesetId: 'sporting-code',
      version: '2026.1',
      section: '4.2',
      title: 'Overlap',
      text: 'Rule text',
      source: 'rules.pdf',
      contentHash: 'c'.repeat(64),
      citedAt: 1_000,
      citedBy: steward
    }],
    verdicts: [{
      verdictId: 'verdict-1',
      finding: 'breach',
      decisionText: 'Human decision',
      actionText: 'Manual action',
      ruleCitationIds: ['rule-1'],
      evidenceIds: ['evidence-1'],
      decidedAt: 1_000,
      decidedBy: steward
    }],
    dissents: [{
      dissentId: 'dissent-1',
      verdictId: 'verdict-1',
      statement: 'Dissent statement',
      grounds: 'Dissent grounds',
      submittedAt: 1_100,
      submittedBy: { id: 'participant-1', displayName: 'Participant', role: 'participant' }
    }],
    appeals: appealed ? [{
      appealId: 'appeal-1',
      verdictId: 'verdict-1',
      grounds: 'Appeal grounds',
      requestedRemedy: 'Review again',
      filedAt: 1_200,
      filedBy: { id: 'participant-1', displayName: 'Participant', role: 'participant' },
      status: 'open',
      resolutions: []
    }] : [],
    history: [{
      eventId: 'event-1',
      sequence: 1,
      type: 'case-created',
      occurredAt: 1_000,
      actor: steward,
      eventHash: 'd'.repeat(64)
    }],
    integrity: {
      state: 'unanchored',
      verified: false,
      chainValid: true,
      evidenceValid: true,
      checkedEvents: 1,
      headHash: 'd'.repeat(64),
      checkedAt: 1_500,
      message: 'Local append-only hash chain verified. No external anchor exists; state remains unanchored.',
      failures: []
    }
  }
}

function renderDesk(cases: StewardCase[], invokeExtra?: (channel: string, args: unknown[]) => unknown): ReturnType<typeof vi.fn> {
  const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
    if (channel === STEWARD_CHANNELS.listCases) return cases
    if (channel === INCIDENT_CHANNELS.list) return []
    if (invokeExtra) return invokeExtra(channel, args)
    throw new Error(`Unexpected channel ${channel}`)
  })
  Object.defineProperty(window, 'ipc', {
    configurable: true,
    value: { invoke, subscribe: vi.fn(() => () => undefined) }
  })
  render(createElement(StewardDeskView, {
    connectedDevice: null,
    mapping: null,
    config: null,
    setConnectedDevice: vi.fn(),
    refreshDeviceState: vi.fn(async () => undefined),
    showToast: vi.fn(),
    language: 'en'
  }))
  return invoke
}

describe('StewardDeskView', () => {
  it('renders the human-owner guardrail and labeled local case queue', async () => {
    renderDesk([])

    expect(screen.getByRole('note').textContent).toContain('never issues automatic penalties')
    expect(screen.getByRole('complementary', { name: 'Local steward case queue' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Create case' })).toBeTruthy()
    await waitFor(() => expect(screen.getByText('No local cases yet.')).toBeTruthy())
  })

  it('confirms and clears case-scoped drafts before switching cases', async () => {
    const first = fixture('case-a', 'Case A')
    const second = fixture('case-b', 'Case B')
    renderDesk([first, second])
    await screen.findByRole('heading', { name: 'Case A' })

    fireEvent.change(screen.getByLabelText('Rule title'), { target: { value: 'Unsaved rule draft' } })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name: /Case B/ }))
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('heading', { name: 'Case A' })).toBeTruthy()

    confirm.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: /Case B/ }))
    expect(screen.getByRole('heading', { name: 'Case B' })).toBeTruthy()
    expect((screen.getByLabelText('Rule title') as HTMLInputElement).value).toBe('')

    fireEvent.change(screen.getByLabelText('Rule title'), { target: { value: 'Case B draft' } })
    confirm.mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name: 'Clear case drafts' }))
    expect((screen.getByLabelText('Rule title') as HTMLInputElement).value).toBe('Case B draft')
    confirm.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'Clear case drafts' }))
    expect((screen.getByLabelText('Rule title') as HTMLInputElement).value).toBe('')
  })

  it('locks case status while an appeal is open', async () => {
    renderDesk([fixture('case-appeal', 'Appealed case', true)])
    await screen.findByRole('heading', { name: 'Appealed case' })
    expect((document.querySelector('.steward-actions select') as HTMLSelectElement).disabled).toBe(true)
    expect(screen.getByText('Status is derived and locked while an appeal remains open.')).toBeTruthy()
  })

  it('loads evidence content through the verified read-only IPC boundary', async () => {
    const current = fixture('case-details', 'Details case')
    const details: StewardEvidenceDetails = {
      caseId: current.caseId,
      evidence: current.evidence[0],
      content: { sample: 'verified evidence content' },
      contentHashVerified: true,
      chainState: 'unanchored',
      verifiedAt: 2_000
    }
    const invoke = renderDesk([current], (channel) => {
      if (channel === STEWARD_CHANNELS.getEvidenceDetails) return details
      throw new Error(`Unexpected channel ${channel}`)
    })
    await screen.findByRole('heading', { name: 'Details case' })
    const evidenceArticle = screen.getAllByText('Evidence summary')[0].closest('article')
    expect(evidenceArticle).toBeTruthy()
    fireEvent.click(within(evidenceArticle as HTMLElement).getByText('Verified read-only details'))
    fireEvent.click(within(evidenceArticle as HTMLElement).getByRole('button', { name: 'Load and verify evidence content' }))
    await waitFor(() => expect(within(evidenceArticle as HTMLElement).getByText(/verified evidence content/)).toBeTruthy())
    expect(invoke).toHaveBeenCalledWith(
      STEWARD_CHANNELS.getEvidenceDetails,
      { caseId: current.caseId, evidenceId: 'evidence-1' }
    )
  })

  it('requires explicit manual provenance review before enabling an authoritative verdict', async () => {
    renderDesk([fixture('case-review', 'Manual review case')])
    await screen.findByRole('heading', { name: 'Manual review case' })
    const submit = screen.getByRole('button', { name: 'Record human verdict' }) as HTMLButtonElement
    const confirmation = screen.getByRole('checkbox', {
      name: /manually reviewed the selected evidence/i
    })

    expect(submit.disabled).toBe(true)
    fireEvent.click(confirmation)
    expect(submit.disabled).toBe(false)
  })
})
