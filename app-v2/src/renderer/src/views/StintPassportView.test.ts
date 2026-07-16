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
        consumerErrors: 0
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
    }
  }
}

function installIpc(snapshot: PassportSnapshot, invokeError?: Error): void {
  Object.defineProperty(window, 'ipc', {
    configurable: true,
    value: {
      invoke: vi.fn(async () => {
        if (invokeError) throw invokeError
        return snapshot
      }),
      subscribe: vi.fn(() => () => undefined)
    }
  })
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
    installIpc(emptySnapshot())
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
