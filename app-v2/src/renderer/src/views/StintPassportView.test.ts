// @vitest-environment jsdom
import { createElement } from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppViewProps } from '../App'
import { tt, translateView } from '../i18n'
import { navSections } from '../navigation/navModel'
import { viewRegistry } from './registry'
import StintPassportView, { PassportStatusPanel } from './StintPassportView'
import {
  DEFAULT_PASSPORT_CONFIG,
  DEFAULT_PASSPORT_PRIVACY,
  STINT_PASSPORT_CONTRACT_VERSION,
  type PassportSnapshot
} from '../../../shared/stint-passport'

function emptySnapshot(): PassportSnapshot {
  return {
    contractVersion: STINT_PASSPORT_CONTRACT_VERSION,
    current: null,
    history: [],
    roster: [],
    config: DEFAULT_PASSPORT_CONFIG,
    privacy: DEFAULT_PASSPORT_PRIVACY,
    runtime: {
      telemetryContext: 'disconnected',
      queue: {
        budgets: {
          maxItems: 8,
          maxBytes: 256 * 1024,
          maxAgeMs: 2_000,
          maxDrainBatch: 4
        },
        enabled: true,
        killSwitch: false,
        queuedItems: 0,
        queuedBytes: 0,
        accepted: 0,
        delivered: 0,
        dropped: 0,
        overflowCount: 0,
        consumerErrors: 0,
        gapPending: false
      },
      overflowBlocked: false,
      cleanFramesSinceOverflow: 0
    },
    integrity: {
      state: 'unanchored',
      verified: false,
      scope: 'bounded',
      checkedEvents: 0,
      lastCheckedAt: 0
    },
    persistence: {
      state: 'ready',
      queued: 0,
      queuedBytes: 0,
      inFlight: false,
      failures: 0,
      restarts: 0
    },
    mutationCapability: 'test-capability',
    experiment: {
      handoffAttempts: 0,
      handoffDefects: 0,
      falseBlocks: 0,
      bypasses: 0,
      completedChallenges: 0,
      totalOverheadMs: 0,
      manualBaselineDefects: 0,
      manualBaselineSwaps: 0
    }
  }
}

function installIpc(snapshot: PassportSnapshot, invokeError?: Error): ReturnType<typeof vi.fn> {
  const invoke = vi.fn(async (channel: string, input?: unknown) => {
    if (invokeError) throw invokeError
    if (channel === 'stintPassport:setPrivacy') {
      return (input as { payload: unknown }).payload
    }
    return snapshot
  })
  Object.defineProperty(window, 'ipc', {
    configurable: true,
    value: {
      invoke,
      subscribe: vi.fn(() => () => undefined)
    }
  })
  return invoke
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Stint Passport navigation and i18n', () => {
  it('is reachable through normal Strategy navigation and translated view metadata', () => {
    expect(navSections.find((section) => section.title === 'Strategy')?.viewIds).toContain('stint-passport')
    const view = viewRegistry.find((candidate) => candidate.id === 'stint-passport')
    expect(view).toBeDefined()
    expect(translateView(view!, 'pt-BR').label).toBe('Passaporte de Stint')
    expect(tt('en', 'passport.item.final-acknowledgement')).toBe('Final challenge acknowledgement')
    expect(tt('pt-BR', 'passport.status.verified')).toBe('Verificado')
  })
})

describe('Stint Passport accessible empty, error, and no-current controls', () => {
  it('announces empty and error states without fabricating a current stint', () => {
    const { rerender } = render(createElement(PassportStatusPanel, {
      loading: false,
      error: null,
      snapshot: emptySnapshot(),
      language: 'en'
    }))
    expect(screen.getByTestId('passport-empty').textContent).toContain('No current live stint passport')
    expect(screen.queryByText('Driver A')).toBeNull()

    rerender(createElement(PassportStatusPanel, {
      loading: false,
      error: 'Database locked',
      snapshot: null,
      language: 'en'
    }))
    expect(screen.getByRole('alert').textContent).toContain('Database locked')
  })

  it('surfaces bounded queue consumer errors', () => {
    const snapshot = emptySnapshot()
    snapshot.runtime.queue.consumerErrors = 1
    snapshot.runtime.queue.lastError = 'consumer failed'
    render(createElement(PassportStatusPanel, {
      loading: false,
      error: null,
      snapshot,
      language: 'en'
    }))
    expect(screen.getByRole('alert').textContent).toContain('consumer failed')
  })

  it('keeps privacy, retention, deletion, export, and audit controls available without a current passport', async () => {
    const invoke = installIpc(emptySnapshot())
    render(createElement(StintPassportView, {
      language: 'en',
      showToast: vi.fn()
    } as unknown as AppViewProps))

    await waitFor(() => expect(screen.getByRole('tab', { name: 'Privacy & export' })).not.toBeNull())
    fireEvent.click(screen.getByRole('tab', { name: 'Privacy & export' }))
    expect(screen.getByLabelText(/Explicitly persist D3/i)).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Export pseudonymized' })).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Delete\/redact D3 data' })).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Run full integrity audit' })).not.toBeNull()
    fireEvent.click(screen.getByLabelText(/Explicitly persist D3/i))
    fireEvent.click(screen.getByRole('button', { name: 'Save privacy controls' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith(
      'stintPassport:setPrivacy',
      expect.objectContaining({
        capability: 'test-capability',
        payload: expect.objectContaining({ identityPersistenceOptIn: true })
      })
    ))
  })

  it('supports keyboard arrow navigation between tabs', async () => {
    installIpc(emptySnapshot())
    render(createElement(StintPassportView, {
      language: 'en',
      showToast: vi.fn()
    } as unknown as AppViewProps))
    const current = await screen.findByRole('tab', { name: 'Current' })
    current.focus()
    fireEvent.keyDown(current, { key: 'ArrowRight' })
    const history = screen.getByRole('tab', { name: 'History' })
    expect(history.getAttribute('aria-selected')).toBe('true')
    await waitFor(() => expect(document.activeElement).toBe(history))
  })

  it('contains only Passport workflow actions', () => {
    const source = readFileSync(join(
      process.cwd(),
      'src',
      'renderer',
      'src',
      'views',
      'StintPassportView.tsx'
    ), 'utf8')
    for (const forbidden of [
      `Decision ${'Flight'} Recorder`,
      `${'record'}Decision`,
      `${'decision'} timeline`
    ]) {
      expect(source.toLowerCase()).not.toContain(forbidden.toLowerCase())
    }
  })
})

function liveSnapshot(): PassportSnapshot {
  const snapshot = emptySnapshot()
  snapshot.runtime.telemetryContext = 'live'
  snapshot.integrity.state = 'anchored'
  snapshot.integrity.verified = true
  snapshot.roster = [{
    memberId: 'driver-1',
    displayName: 'Driver One',
    roles: ['driver'],
    active: true
  }]
  snapshot.current = {
    contractVersion: STINT_PASSPORT_CONTRACT_VERSION,
    identity: {
      stintId: 'stint-live-1',
      sessionRef: 'session-1',
      trackRef: 'track-1',
      trackLabel: 'Spa',
      carRef: 'car-1',
      carLabel: 'GT3',
      driverRef: 'driver-1',
      driverLabel: 'Driver One',
      startedAt: 1_700_000_000_000
    },
    lifecycle: 'ready',
    telemetryContext: 'live',
    items: [],
    coverage: 1,
    applicableItems: 12,
    coveredItems: 12,
    interrupted: false,
    persisted: true,
    revision: 4,
    durability: 'durable'
  }
  return snapshot
}

function renderPassport(
  snapshot: PassportSnapshot,
  invoke: ReturnType<typeof vi.fn>,
  showToast = vi.fn(),
  subscribe: (channel: string, callback: () => void) => () => void =
    vi.fn((_channel: string, _callback: () => void) => () => undefined)
): void {
  Object.defineProperty(window, 'ipc', {
    configurable: true,
    value: { invoke, subscribe }
  })
  render(createElement(StintPassportView, {
    language: 'en',
    showToast
  } as unknown as AppViewProps))
}

describe('Stint Passport truth-state matrix', () => {
  it.each([
    ['degraded', 'degraded'],
    ['open circuit', 'open-circuit'],
    ['quarantined', 'quarantined']
  ] as const)('[spec-gap] announces %s persistence without durable Ready truth', async (_name, state) => {
    const snapshot = liveSnapshot()
    snapshot.persistence.state = state
    snapshot.persistence.lastError = `${state} persistence`
    renderPassport(snapshot, vi.fn(async () => snapshot))

    expect((await screen.findByRole('alert')).textContent).toContain(`${state} persistence`)
    expect(screen.queryByText(/^Ready$/i)).toBeNull()
  })

  it.each([
    ['queue consumer failure', (snapshot: PassportSnapshot) => {
      snapshot.runtime.queue.consumerErrors = 1
      snapshot.runtime.queue.lastError = 'queue consumer failed'
    }],
    ['overflow', (snapshot: PassportSnapshot) => {
      snapshot.runtime.overflowBlocked = true
    }],
    ['kill switch', (snapshot: PassportSnapshot) => {
      snapshot.runtime.queue.killSwitch = true
      snapshot.persistence.state = 'killed'
    }]
  ])('[spec-gap] announces %s without durable Ready truth', async (_name, arrange) => {
    const snapshot = liveSnapshot()
    arrange(snapshot)
    renderPassport(snapshot, vi.fn(async () => snapshot))

    await waitFor(() => {
      expect(screen.queryByRole('alert') ?? screen.queryByRole('status')).not.toBeNull()
    })
    expect(screen.queryByText(/^Ready$/i)).toBeNull()
  })

  it.each([
    ['starting persistence', (snapshot: PassportSnapshot) => {
      snapshot.persistence.state = 'starting'
    }],
    ['killed persistence', (snapshot: PassportSnapshot) => {
      snapshot.persistence.state = 'killed'
    }],
    ['unavailable integrity', (snapshot: PassportSnapshot) => {
      snapshot.integrity.state = 'unavailable'
      snapshot.integrity.verified = false
    }],
    ['unanchored integrity', (snapshot: PassportSnapshot) => {
      snapshot.integrity.state = 'unanchored'
      snapshot.integrity.verified = false
    }]
  ])('[spec-gap] gives %s explicit non-success messaging', async (_name, arrange) => {
    const snapshot = liveSnapshot()
    arrange(snapshot)
    renderPassport(snapshot, vi.fn(async () => snapshot))

    const message = await waitFor(() => {
      const candidate = screen.queryByRole('alert') ?? screen.queryByRole('status')
      expect(candidate).not.toBeNull()
      return candidate as HTMLElement
    })
    expect(message.textContent?.trim().length).toBeGreaterThan(0)
    expect(screen.queryByText(/^Ready$/i)).toBeNull()
  })

  it.each(['failed', 'quarantined'] as const)(
    'maps a ready lifecycle with %s durability back to awaiting checklist',
    async (durability) => {
      const snapshot = liveSnapshot()
      snapshot.current!.durability = durability
      renderPassport(snapshot, vi.fn(async () => snapshot))

      expect(await screen.findByText(/Awaiting checklist/i)).not.toBeNull()
      expect(screen.queryByText(/^Ready$/i)).toBeNull()
      expect(screen.getByText(new RegExp(`Durability: ${durability}`, 'i'))).not.toBeNull()
    }
  )

  it.each([
    ['insufficient coverage', (snapshot: PassportSnapshot) => {
      snapshot.current!.coverage = 0.75
      snapshot.current!.coveredItems = 9
    }],
    ['overflow', (snapshot: PassportSnapshot) => {
      snapshot.runtime.overflowBlocked = true
    }],
    ['kill switch', (snapshot: PassportSnapshot) => {
      snapshot.runtime.queue.killSwitch = true
    }],
    ['pending durability', (snapshot: PassportSnapshot) => {
      snapshot.current!.durability = 'pending'
    }],
    ['failed durability', (snapshot: PassportSnapshot) => {
      snapshot.current!.durability = 'failed'
    }],
    ['quarantined durability', (snapshot: PassportSnapshot) => {
      snapshot.current!.durability = 'quarantined'
    }],
    ['unavailable integrity', (snapshot: PassportSnapshot) => {
      snapshot.integrity.state = 'unavailable'
      snapshot.integrity.verified = false
    }],
    ['unanchored integrity', (snapshot: PassportSnapshot) => {
      snapshot.integrity.state = 'unanchored'
      snapshot.integrity.verified = false
    }],
    ['non-live telemetry', (snapshot: PassportSnapshot) => {
      snapshot.runtime.telemetryContext = 'disconnected'
    }]
  ])('[spec-gap] disables challenge preparation for %s', async (_name, arrange) => {
    const snapshot = liveSnapshot()
    arrange(snapshot)
    renderPassport(snapshot, vi.fn(async () => snapshot))

    expect((await screen.findByRole('button', { name: 'Prepare bound challenge' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('Stint Passport mutation, destructive, and replay boundaries', () => {
  it('coalesces duplicate challenge clicks while the first mutation is busy', async () => {
    const snapshot = liveSnapshot()
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'stintPassport:prepareChallenge') return pending
      return snapshot
    })
    renderPassport(snapshot, invoke)
    fireEvent.change(await screen.findByLabelText('Driver or team-manager owner'), {
      target: { value: 'driver-1::driver' }
    })
    const prepare = screen.getByRole('button', { name: 'Prepare bound challenge' }) as HTMLButtonElement

    fireEvent.click(prepare)
    await waitFor(() => expect(prepare.disabled).toBe(true))
    fireEvent.click(prepare)

    expect(invoke.mock.calls.filter(([channel]) =>
      channel === 'stintPassport:prepareChallenge'
    )).toHaveLength(1)
    release()
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('stintPassport:getSnapshot'))
  })

  it('[spec-gap] invalidates stale controls and capability after refresh failure', async () => {
    const snapshot = liveSnapshot()
    let updated: (() => void) | undefined
    let refreshCount = 0
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'stintPassport:getSnapshot') {
        refreshCount += 1
        if (refreshCount > 1) throw new Error('refresh disconnected')
      }
      return snapshot
    })
    const subscribe = vi.fn((_channel: string, callback: () => void) => {
      updated = callback
      return () => undefined
    })
    renderPassport(snapshot, invoke, vi.fn(), subscribe)
    const prepare = await screen.findByRole('button', { name: 'Prepare bound challenge' }) as HTMLButtonElement

    updated?.()
    expect((await screen.findByRole('alert')).textContent).toContain('refresh disconnected')
    expect(prepare.disabled).toBe(true)
    fireEvent.click(prepare)
    expect(invoke.mock.calls.filter(([channel]) =>
      channel === 'stintPassport:prepareChallenge'
    )).toHaveLength(0)
  })

  it('[spec-gap] reports close-current persistence rejection without leaving success-shaped UI', async () => {
    const snapshot = liveSnapshot()
    const showToast = vi.fn()
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'stintPassport:closeCurrent') throw new Error('close persistence failed')
      return snapshot
    })
    renderPassport(snapshot, invoke, showToast)

    fireEvent.click(await screen.findByRole('button', { name: 'Close current stint' }))

    expect((await screen.findByRole('alert')).textContent).toContain('close persistence failed')
    expect(showToast).toHaveBeenCalledWith('close persistence failed', 'error')
    expect(screen.getByText('Driver One')).not.toBeNull()
    expect(invoke.mock.calls.filter(([channel]) =>
      channel === 'stintPassport:getSnapshot'
    )).toHaveLength(1)
  })

  it('reports export rejection only as an error and never exposes success hash data', async () => {
    const snapshot = emptySnapshot()
    const showToast = vi.fn()
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'stintPassport:saveExport') throw new Error('disk full')
      return snapshot
    })
    renderPassport(snapshot, invoke, showToast)
    fireEvent.click(await screen.findByRole('tab', { name: 'Privacy & export' }))
    fireEvent.click(screen.getByRole('button', { name: 'Export pseudonymized' }))

    expect((await screen.findByRole('alert')).textContent).toContain('disk full')
    expect(showToast).toHaveBeenCalledWith('disk full', 'error')
    expect(showToast.mock.calls.some(([, tone]) => tone === 'success')).toBe(false)
    expect(screen.queryByText(/SHA-256:/i)).toBeNull()
  })

  it('treats canceled export as non-success without a toast or package hash', async () => {
    const snapshot = emptySnapshot()
    const showToast = vi.fn()
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'stintPassport:saveExport') return { ok: false, canceled: true }
      return snapshot
    })
    renderPassport(snapshot, invoke, showToast)
    fireEvent.click(await screen.findByRole('tab', { name: 'Privacy & export' }))
    fireEvent.click(screen.getByRole('button', { name: 'Export race-only' }))

    await waitFor(() => expect(invoke).toHaveBeenCalledWith(
      'stintPassport:saveExport',
      { capability: 'test-capability', payload: 'race-only' }
    ))
    expect(showToast).not.toHaveBeenCalled()
    expect(screen.queryByText(/SHA-256:/i)).toBeNull()
  })

  it.each(['D1', 'D2', 'D3'] as const)(
    '[spec-gap] requires explicit confirmation before destructive %s deletion',
    async (dataClass) => {
      const snapshot = emptySnapshot()
      const invoke = vi.fn(async (_channel: string) => snapshot)
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
      renderPassport(snapshot, invoke)
      fireEvent.click(await screen.findByRole('tab', { name: 'Privacy & export' }))
      fireEvent.click(screen.getByRole('button', { name: `Delete/redact ${dataClass} data` }))

      expect(confirm).toHaveBeenCalled()
      expect(invoke.mock.calls.some(([channel]) =>
        channel === 'stintPassport:deleteByClass'
      )).toBe(false)
    }
  )

  it('keeps failed audit visibly failed without success toast or hash', async () => {
    const snapshot = liveSnapshot()
    const showToast = vi.fn()
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'stintPassport:runFullAudit') throw new Error('audit failed closed')
      return snapshot
    })
    renderPassport(snapshot, invoke, showToast)
    fireEvent.click(await screen.findByRole('tab', { name: 'Privacy & export' }))
    fireEvent.click(screen.getByRole('button', { name: 'Run full integrity audit' }))

    expect((await screen.findByRole('alert')).textContent).toContain('audit failed closed')
    expect(showToast).toHaveBeenCalledWith('audit failed closed', 'error')
    expect(showToast.mock.calls.some(([, tone]) => tone === 'success')).toBe(false)
    expect(screen.queryByText(/^Ready$/i)).toBeNull()
    expect(screen.queryByText(/SHA-256:/i)).toBeNull()
  })

  it('[spec-gap] requires explicit confirmation before persistence repair', async () => {
    const snapshot = emptySnapshot()
    snapshot.integrity.state = 'corrupt'
    snapshot.integrity.repairToken = 'repair-secret'
    const invoke = vi.fn(async (_channel: string) => snapshot)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderPassport(snapshot, invoke)
    fireEvent.click(await screen.findByRole('tab', { name: 'Privacy & export' }))
    expect(screen.queryByText('repair-secret')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Reveal repair token' }))
    expect(screen.getByLabelText('Revealed repair acknowledgement token').textContent)
      .toBe('repair-secret')
    fireEvent.change(screen.getByLabelText(/Retype the repair token/i), {
      target: { value: 'repair-secret' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Quarantine corrupt database and reset' }))

    expect(confirm).toHaveBeenCalled()
    expect(invoke.mock.calls.some(([channel]) =>
      channel === 'stintPassport:repairPersistence'
    )).toBe(false)
  })

  it('[blocker-B12-f] lets a player reveal, copy, retype, and complete repair without developer tools', async () => {
    const corrupt = emptySnapshot()
    corrupt.integrity.state = 'corrupt'
    corrupt.integrity.repairToken = 'repair-player-token'
    const repaired = emptySnapshot()
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText }
    })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    let repairCommitted = false
    const invoke = vi.fn(async (channel: string, input?: unknown) => {
    if (channel === 'stintPassport:repairPersistence') {
      expect(input).toEqual({
        capability: 'test-capability',
        payload: 'repair-player-token'
      })
      repairCommitted = true
      return { quarantinedPath: 'passport.db.quarantine-1.json' }
    }
    return repairCommitted ? repaired : corrupt
    })
    renderPassport(corrupt, invoke)
    fireEvent.click(await screen.findByRole('tab', { name: 'Privacy & export' }))

    const reveal = screen.getByRole('button', { name: 'Reveal repair token' })
    expect(reveal.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('repair-player-token')).toBeNull()
    fireEvent.click(reveal)
    expect(reveal.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByLabelText('Revealed repair acknowledgement token').textContent)
    .toBe('repair-player-token')
    fireEvent.click(screen.getByRole('button', { name: 'Copy repair token' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('repair-player-token'))
    expect(screen.getByText('Copied.')).not.toBeNull()

    const confirmation = screen.getByLabelText(/Retype the repair token/i)
    fireEvent.change(confirmation, { target: { value: 'repair-player-token' } })
    const repair = screen.getByRole('button', {
    name: 'Quarantine corrupt database and reset'
    }) as HTMLButtonElement
    expect(repair.disabled).toBe(false)
    fireEvent.click(repair)

    await waitFor(() => expect(invoke).toHaveBeenCalledWith(
    'stintPassport:repairPersistence',
    { capability: 'test-capability', payload: 'repair-player-token' }
    ))
    await waitFor(() => expect(screen.queryByText('repair-player-token')).toBeNull())
    expect(screen.queryByLabelText(/Retype the repair token/i)).toBeNull()
  })

  it('[blocker-B12-f] visibly blocks a mistyped repair token', async () => {
    const snapshot = emptySnapshot()
    snapshot.integrity.state = 'corrupt'
    snapshot.integrity.repairToken = 'repair-expected-token'
    const invoke = vi.fn(async (_channel: string) => snapshot)
    renderPassport(snapshot, invoke)
    fireEvent.click(await screen.findByRole('tab', { name: 'Privacy & export' }))
    fireEvent.change(screen.getByLabelText(/Retype the repair token/i), {
      target: { value: 'repair-wrong-token' }
    })

    expect(screen.getByText(/does not match/i).getAttribute('role')).toBe('alert')
    const repair = screen.getByRole('button', {
      name: 'Quarantine corrupt database and reset'
    }) as HTMLButtonElement
    expect(repair.disabled).toBe(true)
    fireEvent.click(repair)
    expect(invoke.mock.calls.some(([channel]) =>
      channel === 'stintPassport:repairPersistence'
    )).toBe(false)
  })

  it('[blocker-B12-f] hides and clears repair disclosure when the snapshot token changes', async () => {
    let snapshot = emptySnapshot()
    snapshot.integrity.state = 'corrupt'
    snapshot.integrity.repairToken = 'repair-old-token'
    let updated: (() => void) | undefined
    const subscribe = vi.fn((_channel: string, callback: () => void) => {
    updated = callback
    return () => undefined
    })
    renderPassport(snapshot, vi.fn(async () => snapshot), vi.fn(), subscribe)
    fireEvent.click(await screen.findByRole('tab', { name: 'Privacy & export' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reveal repair token' }))
    fireEvent.change(screen.getByLabelText(/Retype the repair token/i), {
    target: { value: 'repair-old-token' }
    })
    expect(screen.getByText('repair-old-token')).not.toBeNull()

    snapshot = {
    ...snapshot,
    integrity: {
      ...snapshot.integrity,
      repairToken: 'repair-new-token'
    }
    }
    updated?.()

    await waitFor(() => expect(
    screen.getByRole('button', { name: 'Reveal repair token' }).getAttribute('aria-expanded')
    ).toBe('false'))
    expect(screen.queryByText('repair-old-token')).toBeNull()
    expect(screen.queryByText('repair-new-token')).toBeNull()
    expect((screen.getByLabelText(/Retype the repair token/i) as HTMLInputElement).value).toBe('')
  })

  it('keeps replay history inspectable without current or challenge mutation controls', async () => {
    const snapshot = liveSnapshot()
    const historical = {
      ...snapshot.current!,
      identity: {
        ...snapshot.current!.identity,
        stintId: 'stint-replay-history',
        driverLabel: 'Replay Driver'
      },
      lifecycle: 'closed' as const,
      telemetryContext: 'replay' as const
    }
    snapshot.current = null
    snapshot.history = [historical]
    snapshot.runtime.telemetryContext = 'replay'
    renderPassport(snapshot, vi.fn(async () => snapshot))

    expect(await screen.findByText(/Replay is read-only/i)).not.toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'History' }))
    fireEvent.click(screen.getByRole('button', { name: /Replay Driver/i }))
    expect(screen.getAllByText('Replay Driver')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Prepare bound challenge' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Complete challenge' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Close current stint' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Apply resolution' })).toBeNull()
  })

  it('imports authenticated replay packages and reports the replay-only result', async () => {
    const snapshot = emptySnapshot()
    const showToast = vi.fn()
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'stintPassport:importPackage') {
        return {
          ok: true,
          canceled: false,
          importedPassports: 2,
          packageHash: 'a'.repeat(64)
        }
      }
      return snapshot
    })
    renderPassport(snapshot, invoke, showToast)
    fireEvent.click(await screen.findByRole('tab', { name: 'Privacy & export' }))
    fireEvent.click(screen.getByRole('button', { name: 'Import signed replay' }))

    await waitFor(() => expect(invoke).toHaveBeenCalledWith(
      'stintPassport:importPackage',
      { capability: 'test-capability', payload: null }
    ))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(
      'Imported 2 authenticated replay passport(s).',
      'success'
    ))
  })
})

describe('Stint Passport repair failure truth', () => {
  it('keeps rejected repair visibly failed without success toast, hash, or Ready text', async () => {
    const snapshot = emptySnapshot()
    snapshot.integrity.state = 'corrupt'
    snapshot.integrity.repairToken = 'repair-secret'
    const showToast = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'stintPassport:repairPersistence') {
        throw new Error('repair failed closed')
      }
      return snapshot
    })
    renderPassport(snapshot, invoke, showToast)
    fireEvent.click(await screen.findByRole('tab', { name: 'Privacy & export' }))
    fireEvent.change(screen.getByLabelText(/Retype the repair token/i), {
      target: { value: 'repair-secret' }
    })
    fireEvent.click(screen.getByRole('button', {
      name: 'Quarantine corrupt database and reset'
    }))

    expect((await screen.findByText('repair failed closed')).closest('[role="alert"]')).not.toBeNull()
    expect(showToast).toHaveBeenCalledWith('repair failed closed', 'error')
    expect(showToast.mock.calls.some(([, tone]) => tone === 'success')).toBe(false)
    expect(screen.queryByText(/^Ready$/i)).toBeNull()
    expect(screen.queryByText(/SHA-256:/i)).toBeNull()
  })
})
