// @vitest-environment jsdom

import { createElement } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { INCIDENT_CHANNELS } from '../../../shared/incidents'
import { STEWARD_CHANNELS } from '../../../shared/steward-desk'
import StewardDeskView from './StewardDeskView'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('StewardDeskView', () => {
  it('renders the human-owner guardrail and labeled local case queue', async () => {
    Object.defineProperty(window, 'ipc', {
      configurable: true,
      value: {
        invoke: vi.fn(async (channel: string) => {
          if (channel === STEWARD_CHANNELS.listCases || channel === INCIDENT_CHANNELS.list) return []
          throw new Error(`Unexpected channel ${channel}`)
        }),
        subscribe: vi.fn(() => () => undefined)
      }
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

    expect(screen.getByRole('note').textContent).toContain('never issues automatic penalties')
    expect(screen.getByRole('complementary', { name: 'Local steward case queue' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Create case' })).toBeTruthy()
    await waitFor(() => expect(screen.getByText('No local cases yet.')).toBeTruthy())
  })
})
