// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStreamPresentationProfile } from '../../../shared/stream-presentation'
import { createButtonBoxPanel } from '../../../shared/touch-panel'
import type {
  StreamingTouchHealthResponse,
  StreamingTouchPanelPayload
} from '../../../shared/streaming'
import {
  activateStreamInteraction,
  fetchStreamInteractionHealth,
  fetchStreamPanel,
  StreamInteractionRequestError
} from '../touchpanel/runtime'
import { StreamOverlayRoot } from './StreamOverlayRoot'

vi.mock('../dashboard/DashboardRoot', () => ({ DashboardCanvas: () => null }))
vi.mock('../overlay/widgets/CompactHudWidget', () => ({ CompactHudWidget: () => null, COMPACT_HUD_STREAM_SAFE: true }))
vi.mock('../overlay/widgets/DeltaLapWidget', () => ({ DeltaLapWidget: () => null }))
vi.mock('../overlay/widgets/FuelWidget', () => ({ FuelWidget: () => null }))
vi.mock('../overlay/widgets/GearSpeedWidget', () => ({ GearSpeedWidget: () => null }))
vi.mock('../overlay/widgets/GT3ClusterWidget', () => ({ GT3ClusterWidget: () => null, GT3_CLUSTER_STREAM_SAFE: true }))
vi.mock('../overlay/widgets/RelativeWidget', () => ({ RelativeWidget: () => null }))
vi.mock('../touchpanel/TouchPanelWindowRoot', () => ({ TouchPanelWindowRoot: () => null }))
vi.mock('../stream-presentation/StreamPresentationRenderer', () => ({
  StreamPresentationRenderer: (props: {
    profile: { id: string }
    touchPanel?: { id: string } | null
    interactiveTouch?: boolean
  }) => createElement('div', {
    'data-testid': 'profile-touch-renderer',
    'data-profile': props.profile.id,
    'data-panel': props.touchPanel?.id ?? '',
    'data-interactive': String(Boolean(props.interactiveTouch))
  })
}))
vi.mock('../touchpanel/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../touchpanel/runtime')>()
  return {
    ...actual,
    activateStreamInteraction: vi.fn(),
    clearStreamInteraction: vi.fn(),
    executeTouchControlAction: vi.fn(),
    fetchStreamInteractionHealth: vi.fn(),
    fetchStreamPanel: vi.fn()
  }
})

const fetchPanel = vi.mocked(fetchStreamPanel)
const fetchHealth = vi.mocked(fetchStreamInteractionHealth)
const activateInteraction = vi.mocked(activateStreamInteraction)

class FakeEventSource {
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  addEventListener(): void {}
  close(): void {}
}

function response(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  }
}

function profile(panelId: string, profileId: string) {
  return createStreamPresentationProfile({
    kind: 'touch',
    id: panelId,
    name: `${panelId} controls`,
    revision: `touch:${panelId}:1`,
    itemCount: 1,
    hidden: false
  }, {
    id: profileId,
    presetId: 'android-phone',
    now: 10
  })
}

function panelPayload(panelId: string): StreamingTouchPanelPayload {
  const panel = createButtonBoxPanel({
    id: panelId,
    name: `${panelId} controls`,
    columns: 1,
    rows: 1,
    buttons: [{
      id: `${panelId}-button`,
      label: 'ACTION',
      control: {
        kind: 'momentary',
        action: { kind: 'keyboard', command: { mode: 'press', keys: ['A'] } }
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
      targetId: panelId,
      csrfToken: `csrf-${panelId}`,
      nonce: `nonce-${panelId}`,
      expiresAt: Date.now() + 60_000,
      leaseExpiresAt: Date.now() + 25_000,
      capabilities: [],
      activeControls: 0,
      lastFeedback: null
    }
  }
}

function health(panelId: string): StreamingTouchHealthResponse {
  return {
    interactive: true,
    indicator: 'INTERACTIVE TOUCH',
    role: 'touch-controller',
    health: 'ready',
    targetId: panelId,
    expiresAt: Date.now() + 60_000,
    leaseExpiresAt: Date.now() + 25_000,
    activeControls: 0,
    lastFeedback: null
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function setTouchUrl(panelId: string, profileId: string): void {
  window.history.replaceState(
    {},
    '',
    `/obs/${panelId}?kind=touch&panel=${panelId}&profile=${profileId}&token=secret`
  )
}

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource)
  fetchPanel.mockReset()
  fetchHealth.mockReset()
  activateInteraction.mockReset()
  fetchHealth.mockImplementation(async (panelId) => health(panelId))
  setTouchUrl('pit', 'profile-pit')
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('profile touch receiver authentication', () => {
  it('waits for successful authentication before fetching and rendering the profile panel', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), window.location.href)
      if (url.pathname.endsWith('/ping')) return response(200, { passwordRequired: true })
      if (url.pathname.endsWith('/auth/session') && init?.method === 'POST') return response(200, { authenticated: true })
      if (url.pathname.includes('/api/presentation/')) return response(200, profile('pit', 'profile-pit'))
      throw new Error(`Unexpected fetch ${url.pathname}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    fetchPanel.mockResolvedValue(panelPayload('pit'))
    render(createElement(StreamOverlayRoot))

    await screen.findByText('Password required')
    expect(fetchPanel).not.toHaveBeenCalled()
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/api/presentation/'))).toBe(false)
    fireEvent.change(screen.getByPlaceholderText('Enter password'), { target: { value: 'correct' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Connect' }).closest('form')!)

    const rendered = await screen.findByTestId('profile-touch-renderer')
    expect(rendered.getAttribute('data-panel')).toBe('pit')
    expect(rendered.getAttribute('data-interactive')).toBe('true')
    expect(fetchPanel).toHaveBeenCalledTimes(1)
    expect(fetchPanel).toHaveBeenCalledWith('pit', { activate: false })
    expect(activateInteraction).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(fetchHealth).toHaveBeenCalledWith('pit'))
  })

  it('does not fetch profile resources after failed authentication', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), window.location.href)
      if (url.pathname.endsWith('/ping')) return response(200, { passwordRequired: true })
      if (url.pathname.endsWith('/auth/session') && init?.method === 'POST') return response(403, {})
      throw new Error(`Unexpected fetch ${url.pathname}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(createElement(StreamOverlayRoot))
    await screen.findByText('Password required')
    fireEvent.change(screen.getByPlaceholderText('Enter password'), { target: { value: 'wrong' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Connect' }).closest('form')!)

    await screen.findByText('Incorrect password.')
    expect(fetchPanel).not.toHaveBeenCalled()
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/api/presentation/'))).toBe(false)
  })

  it('ignores stale target responses and activates only the newest target generation', async () => {
    const oldProfile = deferred<unknown>()
    const oldPanel = deferred<StreamingTouchPanelPayload>()
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), window.location.href)
      if (url.pathname.endsWith('/ping')) return response(200, { passwordRequired: false })
      if (url.pathname.endsWith('/api/presentation/profile-pit')) {
        return response(200, await oldProfile.promise)
      }
      if (url.pathname.endsWith('/api/presentation/profile-strategy')) {
        return response(200, profile('strategy', 'profile-strategy'))
      }
      throw new Error(`Unexpected fetch ${url.pathname}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    fetchPanel.mockImplementation((panelId) =>
      panelId === 'pit' ? oldPanel.promise : Promise.resolve(panelPayload('strategy'))
    )
    render(createElement(StreamOverlayRoot))
    await waitFor(() => expect(fetchPanel).toHaveBeenCalledWith('pit', { activate: false }))

    setTouchUrl('strategy', 'profile-strategy')
    window.dispatchEvent(new PopStateEvent('popstate'))
    const rendered = await screen.findByTestId('profile-touch-renderer')
    expect(rendered.getAttribute('data-panel')).toBe('strategy')
    oldProfile.resolve(profile('pit', 'profile-pit'))
    oldPanel.resolve(panelPayload('pit'))
    await Promise.resolve()
    expect(screen.getByTestId('profile-touch-renderer').getAttribute('data-panel')).toBe('strategy')
    expect(activateInteraction).toHaveBeenCalledTimes(1)
    expect(activateInteraction).toHaveBeenCalledWith(expect.objectContaining({ targetId: 'strategy' }))
  })

  it('clears a stale authorization error and retries once after reauthentication', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), window.location.href)
      if (url.pathname.endsWith('/ping')) return response(200, { passwordRequired: false })
      if (url.pathname.endsWith('/auth/session') && init?.method === 'POST') return response(200, { authenticated: true })
      if (url.pathname.includes('/api/presentation/')) return response(200, profile('pit', 'profile-pit'))
      throw new Error(`Unexpected fetch ${url.pathname}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    fetchPanel
      .mockRejectedValueOnce(new StreamInteractionRequestError('Panel load failed (HTTP 403).', 403))
      .mockResolvedValueOnce(panelPayload('pit'))
    render(createElement(StreamOverlayRoot))

    await screen.findByText('Password required')
    expect(screen.getByText(/HTTP 403/)).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('Enter password'), { target: { value: 'correct' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Connect' }).closest('form')!)
    await screen.findByTestId('profile-touch-renderer')
    expect(screen.queryByText(/HTTP 403/)).toBeNull()
    expect(fetchPanel).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.filter(([input]) =>
      String(input).includes('/api/presentation/')
    )).toHaveLength(2)
  })
})
