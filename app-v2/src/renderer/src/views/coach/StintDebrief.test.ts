// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SpeechLanguage } from '../../../../shared/tts-voice'
import type {
  DebriefArchiveGenerateResult,
  DebriefArchiveSummary,
  DebriefArchiveUpdatedPayload
} from '../../../../shared/stint-debrief'

const mocks = vi.hoisted(() => ({
  listDebriefArchive: vi.fn(),
  generateArchivedDebrief: vi.fn(),
  speakViaTts: vi.fn(),
  archiveSubscriber: null as ((payload: DebriefArchiveUpdatedPayload) => void) | null,
  subscribeDebriefArchive: vi.fn((callback: (payload: DebriefArchiveUpdatedPayload) => void) => {
    mocks.archiveSubscriber = callback
    return () => {
      mocks.archiveSubscriber = null
    }
  })
}))

vi.mock('../../lib/stint-debrief', () => ({
  listDebriefArchive: mocks.listDebriefArchive,
  generateArchivedDebrief: mocks.generateArchivedDebrief,
  subscribeDebriefArchive: mocks.subscribeDebriefArchive
}))

vi.mock('../../lib/tts-runtime', () => ({
  speakViaTts: mocks.speakViaTts
}))

import StintDebrief from './StintDebrief'

function summary(
  id: string,
  capturedAt: number,
  trackName: string
): DebriefArchiveSummary {
  return {
    id,
    capturedAt,
    reason: 'session-end',
    sessionInfo: {
      trackName,
      carName: 'GT3 R',
      sessionType: 'Race',
      lapsCompleted: 12,
      reason: 'session-end'
    },
    language: 'en-US',
    unitSystem: 'metric',
    captureSource: 'boundary',
    setupStatus: 'available',
    analysisStatus: 'available'
  }
}

function generated(
  session: DebriefArchiveSummary,
  language: SpeechLanguage = session.language,
  withSetup = true
): DebriefArchiveGenerateResult {
  return {
    sessionId: session.id,
    debrief: {
      generatedAt: session.capturedAt,
      text: `${session.sessionInfo.trackName} persisted debrief.`,
      bullets: [language === 'pt-BR' ? '✅ Curva 1' : '✅ Turn 1'],
      source: 'deterministic',
      language,
      reason: session.reason,
      sessionInfo: session.sessionInfo
    },
    setup: withSetup ? {
      generatedAt: session.capturedAt,
      summary: 'One change.',
      suggestions: [{
        id: `setup-${session.id}`,
        symptom: 'pressure-high',
        corner: 'all',
        confidence: 'high',
        rationale: 'Middle tread stayed hotter than both edges.',
        evidence: 'Middle 108 C; edge average 96 C.',
        primary: {
          area: 'tyres',
          direction: 'decrease',
          magnitude: 'small',
          change: 'Reduce cold pressure by one small step.'
        },
        alternatives: [{
          area: 'alignment',
          direction: 'adjust',
          magnitude: 'small',
          change: 'Recheck camber after the pressure run.'
        }],
        metrics: { middleDeltaC: 12 }
      }]
    } : null,
    captureSource: session.captureSource,
    setupStatus: withSetup ? 'available' : 'insufficient',
    analysisStatus: session.analysisStatus
  }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  mocks.archiveSubscriber = null
  mocks.listDebriefArchive.mockReset()
  mocks.generateArchivedDebrief.mockReset()
  mocks.speakViaTts.mockReset()
  mocks.subscribeDebriefArchive.mockClear()
  mocks.speakViaTts.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
})

describe('StintDebrief historical selector', () => {
  it('defaults to the newest session and exposes a labelled native keyboard control', async () => {
    const newest = summary('debrief_2222222222222222', 2_000, 'Newest Track')
    const older = summary('debrief_1111111111111111', 1_000, 'Older Track')
    const oneLap = summary('debrief_0000000000000000', 500, 'One Lap Track')
    older.sessionInfo.lapsCompleted = undefined
    oneLap.sessionInfo.lapsCompleted = 1
    mocks.listDebriefArchive.mockResolvedValue([newest, older, oneLap])
    mocks.generateArchivedDebrief.mockImplementation(async (id: string) =>
      generated(id === newest.id ? newest : older))

    render(React.createElement(StintDebrief, { language: 'en' }))
    const select = await screen.findByRole('combobox', {
      name: 'Completed stint or session'
    })
    await screen.findByText('Newest Track persisted debrief.')
    expect(select.tagName).toBe('SELECT')
    expect(select).toHaveProperty('value', newest.id)
    expect(select.getAttribute('aria-describedby')).toBeTruthy()
    expect((select as HTMLSelectElement).style.color).toBe('var(--text-primary)')
    expect(screen.getByRole('option', { name: /Newest Track.*GT3 R.*12 laps.*Session end/ }))
      .toBeTruthy()
    expect(screen.getByRole('option', { name: /Older Track.*GT3 R.*Laps unknown.*Session end/ }))
      .toBeTruthy()
    expect(screen.getByRole('option', { name: /One Lap Track.*GT3 R.*1 lap.*Session end/ }))
      .toBeTruthy()

    fireEvent.keyDown(select, { key: 'ArrowDown' })
    fireEvent.change(select, { target: { value: older.id } })
    await screen.findByText('Older Track persisted debrief.')
    expect(mocks.generateArchivedDebrief).toHaveBeenLastCalledWith(older.id, false)
  })

  it('refreshes on a durable capture and follows the newest session only when already latest', async () => {
    const first = summary('debrief_1111111111111111', 1_000, 'First Track')
    const next = summary('debrief_2222222222222222', 2_000, 'Next Track')
    mocks.listDebriefArchive
      .mockResolvedValueOnce([first])
      .mockResolvedValueOnce([next, first])
    mocks.generateArchivedDebrief.mockImplementation(async (id: string) =>
      generated(id === next.id ? next : first))

    render(React.createElement(StintDebrief, { language: 'en' }))
    await screen.findByText('First Track persisted debrief.')
    mocks.archiveSubscriber?.({ latest: next, count: 2 })

    await screen.findByText('Next Track persisted debrief.')
    expect(screen.getByRole('combobox')).toHaveProperty('value', next.id)
    expect(mocks.listDebriefArchive).toHaveBeenCalledTimes(2)
  })

  it('fences a slow old response so it cannot overwrite the newer selection', async () => {
    const slow = summary('debrief_2222222222222222', 2_000, 'Slow Track')
    const fast = summary('debrief_1111111111111111', 1_000, 'Fast Track')
    const slowResponse = deferred<DebriefArchiveGenerateResult>()
    mocks.listDebriefArchive.mockResolvedValue([slow, fast])
    mocks.generateArchivedDebrief.mockImplementation((id: string) =>
      id === slow.id ? slowResponse.promise : Promise.resolve(generated(fast)))

    render(React.createElement(StintDebrief, { language: 'en' }))
    const select = await screen.findByRole('combobox')
    fireEvent.change(select, { target: { value: fast.id } })
    await screen.findByText('Fast Track persisted debrief.')

    slowResponse.resolve(generated(slow))
    await Promise.resolve()
    expect(screen.queryByText('Slow Track persisted debrief.')).toBeNull()
    expect(screen.getByText('Fast Track persisted debrief.')).toBeTruthy()
  })
})

describe('StintDebrief historical output', () => {
  it('renders exact setup guidance, measured evidence, alternatives, and manual safety', async () => {
    const session = summary('debrief_1111111111111111', 1_000, 'Setup Track')
    mocks.listDebriefArchive.mockResolvedValue([session])
    mocks.generateArchivedDebrief.mockResolvedValue(generated(session))

    render(React.createElement(StintDebrief, { language: 'en' }))
    await screen.findByText('Reduce cold pressure by one small step.')
    expect(screen.getByText(/Middle tread stayed hotter/)).toBeTruthy()
    expect(screen.getByText(/Middle 108 C; edge average 96 C/)).toBeTruthy()
    expect(screen.getByText('Recheck camber after the pressure run.')).toBeTruthy()
    expect(screen.getByText(/No setup is applied automatically/)).toBeTruthy()
    expect(screen.getByText(/one variable at a time/)).toBeTruthy()
    expect(screen.getByText(/Setup Experiment Twin/)).toBeTruthy()
  })

  it('states that setup evidence is insufficient instead of guessing', async () => {
    const session = summary('debrief_1111111111111111', 1_000, 'No Evidence Track')
    session.setupStatus = 'insufficient'
    session.analysisStatus = 'insufficient'
    mocks.listDebriefArchive.mockResolvedValue([session])
    mocks.generateArchivedDebrief.mockResolvedValue(generated(session, 'en-US', false))

    render(React.createElement(StintDebrief, { language: 'en' }))
    await screen.findByText('Insufficient setup evidence')
    expect(screen.getByText(/clean laps with tyre temperatures, pressures, wear and handling telemetry/))
      .toBeTruthy()
    expect(screen.getByText(/Speed, throttle and brake traces alone are not enough/)).toBeTruthy()
    expect(screen.queryByText(/Reduce cold pressure/)).toBeNull()
  })

  it('shows explicit empty, archive error, and deleted-session states', async () => {
    mocks.listDebriefArchive.mockResolvedValueOnce([])
    const { unmount } = render(React.createElement(StintDebrief, { language: 'en' }))
    await screen.findByText('No completed stint or session analysis has been captured yet.')
    expect((screen.getByRole('combobox') as HTMLSelectElement).disabled).toBe(true)
    unmount()

    mocks.listDebriefArchive.mockRejectedValueOnce(new Error('corrupt local archive'))
    const second = render(React.createElement(StintDebrief, { language: 'en' }))
    await screen.findByRole('alert')
    expect(screen.getByText(/No data was guessed/)).toBeTruthy()
    second.unmount()

    const session = summary('debrief_1111111111111111', 1_000, 'Deleted Track')
    mocks.listDebriefArchive.mockResolvedValueOnce([session])
    mocks.generateArchivedDebrief.mockRejectedValueOnce(
      new Error('Historical debrief session was not found or was deleted.')
    )
    render(React.createElement(StintDebrief, { language: 'en' }))
    await screen.findByText('Session unavailable')
    expect(screen.getByText(/deleted or left the bounded local history/)).toBeTruthy()
  })

  it.each<SpeechLanguage>(['pt-BR', 'en-US'])(
    'uses persisted %s language for on-demand TTS only',
    async (speechLanguage) => {
      const session = summary('debrief_1111111111111111', 1_000, 'Voice Track')
      session.language = speechLanguage
      const payload = generated(session, speechLanguage)
      mocks.listDebriefArchive.mockResolvedValue([session])
      mocks.generateArchivedDebrief.mockResolvedValue(payload)

      render(React.createElement(StintDebrief, {
        language: speechLanguage === 'pt-BR' ? 'pt-BR' : 'en'
      }))
      await screen.findByText(payload.debrief.text)
      expect(mocks.speakViaTts).not.toHaveBeenCalled()
      fireEvent.click(screen.getByRole('button', {
        name: speechLanguage === 'pt-BR' ? 'Ouvir' : 'Listen'
      }))

      await waitFor(() => {
        expect(mocks.speakViaTts).toHaveBeenCalledWith(
          `${payload.debrief.text}. ${payload.debrief.bullets[0]}`,
          { lang: speechLanguage, source: 'coach' }
        )
      })
    }
  )

  it('requests optional phrasing only for the selected persisted ID', async () => {
    const session = summary('debrief_1111111111111111', 1_000, 'AI Track')
    mocks.listDebriefArchive.mockResolvedValue([session])
    mocks.generateArchivedDebrief.mockResolvedValue(generated(session))

    render(React.createElement(StintDebrief, { language: 'en' }))
    await screen.findByText('AI Track persisted debrief.')
    fireEvent.click(screen.getByRole('checkbox', { name: /Phrase paragraph/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Generate debrief' }))
    await waitFor(() => {
      expect(mocks.generateArchivedDebrief).toHaveBeenLastCalledWith(session.id, true)
    })
  })
})
