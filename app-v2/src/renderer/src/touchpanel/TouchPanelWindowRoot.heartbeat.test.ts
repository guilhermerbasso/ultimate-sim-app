// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createButtonBoxPanel } from '../../../shared/touch-panel'
import type {
  StreamingTouchHealthResponse,
  StreamingTouchPanelPayload
} from '../../../shared/streaming'
import {
  clearStreamInteraction,
  fetchStreamInteractionHealth,
  fetchStreamPanel
} from './runtime'
import { TouchPanelWindowRoot } from './TouchPanelWindowRoot'

vi.mock('./runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./runtime')>()
  return {
    ...actual,
    clearStreamInteraction: vi.fn(),
    executeTouchControlAction: vi.fn(),
    fetchStreamInteractionHealth: vi.fn(),
    fetchStreamPanel: vi.fn(),
    isBrowserStreamRuntime: () => true
  }
})
vi.mock('./useTouchExpressionValues', () => ({
  useTouchExpressionValues: () => ({})
}))

const fetchPanel = vi.mocked(fetchStreamPanel)
const fetchHealth = vi.mocked(fetchStreamInteractionHealth)
const clearInteraction = vi.mocked(clearStreamInteraction)

function payload(): StreamingTouchPanelPayload {
  const panel = createButtonBoxPanel({
    id: 'pit',
    name: 'Pit controls',
    columns: 1,
    rows: 1,
    buttons: [{
      id: 'pit-button',
      label: 'PIT',
      control: {
        kind: 'momentary',
        action: { kind: 'keyboard', command: { mode: 'press', keys: ['P'] } }
      }
    }]
  })
  return {
    panel,
    interaction: {
      interactive: true,
      indicator: 'INTERACTIVE TOUCH',
      role: 'touch-controller',
      health: 'ready',
      targetId: 'pit',
      csrfToken: 'csrf-pit',
      nonce: 'nonce-pit',
      expiresAt: Date.now() + 60_000,
      leaseExpiresAt: Date.now() + 25_000,
      capabilities: [],
      activeControls: 0,
      lastFeedback: null
    }
  }
}

function health(): StreamingTouchHealthResponse {
  return {
    interactive: true,
    indicator: 'INTERACTIVE TOUCH',
    role: 'touch-controller',
    health: 'ready',
    targetId: 'pit',
    expiresAt: Date.now() + 60_000,
    leaseExpiresAt: Date.now() + 25_000,
    activeControls: 0,
    lastFeedback: null
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  fetchPanel.mockReset()
  fetchHealth.mockReset()
  clearInteraction.mockReset()
})

describe('non-profile touch receiver heartbeat', () => {
  it('uses the shared heartbeat lifecycle and stops it on unmount', async () => {
    window.history.replaceState({}, '', '/obs/pit?kind=touch&panel=pit')
    fetchPanel.mockResolvedValue(payload())
    fetchHealth.mockResolvedValue(health())
    const view = render(createElement(TouchPanelWindowRoot))

    await waitFor(() => expect(fetchHealth).toHaveBeenCalled())
    expect(fetchHealth.mock.calls[0][0]).toBe('pit')
    expect(fetchHealth).toHaveBeenCalledTimes(1)
    view.unmount()
    expect(clearInteraction).toHaveBeenCalledWith('pit')
  })
})
