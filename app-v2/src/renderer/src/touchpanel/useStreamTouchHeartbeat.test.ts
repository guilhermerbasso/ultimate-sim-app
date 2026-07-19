// @vitest-environment jsdom
import { createElement } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  StreamingTouchHealthResponse,
  StreamingTouchInteractionSession
} from '../../../shared/streaming'
import {
  STREAM_TOUCH_HEARTBEAT_MS,
  STREAM_TOUCH_HEARTBEAT_TIMEOUT_MS,
  useStreamTouchHeartbeat
} from './useStreamTouchHeartbeat'
import {
  fetchStreamInteractionHealth,
  StreamInteractionRequestError
} from './runtime'

vi.mock('./runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./runtime')>()
  return {
    ...actual,
    fetchStreamInteractionHealth: vi.fn()
  }
})

const fetchHealth = vi.mocked(fetchStreamInteractionHealth)

function interaction(panelId: string): StreamingTouchInteractionSession {
  return {
    interactive: true,
    indicator: 'INTERACTIVE TOUCH',
    role: 'touch-controller',
    health: 'ready',
    targetId: panelId,
    csrfToken: `csrf-${panelId}`,
    nonce: 'nonce-value',
    expiresAt: Date.now() + 60_000,
    leaseExpiresAt: Date.now() + 25_000,
    capabilities: [],
    activeControls: 0,
    lastFeedback: null
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

function Harness({
  enabled,
  panelId,
  session,
  onHealth,
  onFailure,
  onAuthLoss
}: {
  enabled: boolean
  panelId: string | null
  session: StreamingTouchInteractionSession | null
  onHealth?: (health: StreamingTouchHealthResponse) => void
  onFailure: (error: unknown) => void
  onAuthLoss: () => void
}) {
  useStreamTouchHeartbeat({
    enabled,
    panelId,
    interaction: session,
    onHealth: onHealth ?? (() => undefined),
    onFailure,
    onAuthLoss
  })
  return null
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

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  fetchHealth.mockReset()
})

describe('stream touch heartbeat lifecycle', () => {
  it('keeps a lease alive beyond 25 seconds with one heartbeat loop and no telemetry transport', async () => {
    vi.useFakeTimers()
    fetchHealth.mockResolvedValue(health('pit'))
    const failure = vi.fn()
    const authLoss = vi.fn()
    const session = interaction('pit')
    const view = render(createElement(Harness, {
      enabled: true,
      panelId: 'pit',
      session,
      onFailure: failure,
      onAuthLoss: authLoss
    }))
    await act(async () => { await Promise.resolve() })
    expect(fetchHealth).toHaveBeenCalledTimes(1)

    view.rerender(createElement(Harness, {
      enabled: true,
      panelId: 'pit',
      session: { ...session, health: 'degraded' },
      onFailure: failure,
      onAuthLoss: authLoss
    }))
    await act(async () => { await vi.advanceTimersByTimeAsync(STREAM_TOUCH_HEARTBEAT_MS * 3) })
    expect(fetchHealth).toHaveBeenCalledTimes(4)
    expect(failure).not.toHaveBeenCalled()
  })

  it('stops on auth loss, unmount, and target changes without duplicate timers', async () => {
    vi.useFakeTimers()
    fetchHealth.mockResolvedValue(health('pit'))
    const authLoss = vi.fn()
    const view = render(createElement(Harness, {
      enabled: true,
      panelId: 'pit',
      session: interaction('pit'),
      onFailure: vi.fn(),
      onAuthLoss: authLoss
    }))
    await act(async () => { await Promise.resolve() })
    view.rerender(createElement(Harness, {
      enabled: true,
      panelId: 'strategy',
      session: interaction('strategy'),
      onFailure: vi.fn(),
      onAuthLoss: authLoss
    }))
    await act(async () => { await Promise.resolve() })
    expect(fetchHealth.mock.calls.map(([panelId]) => panelId)).toEqual(['pit', 'strategy'])

    view.rerender(createElement(Harness, {
      enabled: false,
      panelId: 'strategy',
      session: interaction('strategy'),
      onFailure: vi.fn(),
      onAuthLoss: authLoss
    }))
    await act(async () => { await vi.advanceTimersByTimeAsync(STREAM_TOUCH_HEARTBEAT_MS * 2) })
    expect(fetchHealth).toHaveBeenCalledTimes(2)
    view.unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(STREAM_TOUCH_HEARTBEAT_MS * 2) })
    expect(fetchHealth).toHaveBeenCalledTimes(2)
  })

  it('recovers after a transient failure and stops after an authenticated-session rejection', async () => {
    vi.useFakeTimers()
    const failure = vi.fn()
    const authLoss = vi.fn()
    fetchHealth
      .mockRejectedValueOnce(new Error('offline transport'))
      .mockResolvedValueOnce(health('pit'))
      .mockRejectedValueOnce(new StreamInteractionRequestError('Forbidden', 403))
    render(createElement(Harness, {
      enabled: true,
      panelId: 'pit',
      session: interaction('pit'),
      onFailure: failure,
      onAuthLoss: authLoss
    }))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(failure).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(STREAM_TOUCH_HEARTBEAT_MS) })
    expect(fetchHealth).toHaveBeenCalledTimes(2)
    await act(async () => { await vi.advanceTimersByTimeAsync(STREAM_TOUCH_HEARTBEAT_MS) })
    expect(authLoss).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(STREAM_TOUCH_HEARTBEAT_MS * 2) })
    expect(fetchHealth).toHaveBeenCalledTimes(3)
  })

  it('fences an offline hung request and restores health only from the fresh online request', async () => {
    vi.useFakeTimers()
    let online = true
    vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online)
    const stale = deferred<StreamingTouchHealthResponse>()
    const fresh = deferred<StreamingTouchHealthResponse>()
    fetchHealth
      .mockImplementationOnce(() => stale.promise)
      .mockImplementationOnce(() => fresh.promise)
    const failure = vi.fn()
    const onHealth = vi.fn()
    const view = render(createElement(Harness, {
      enabled: true,
      panelId: 'pit',
      session: interaction('pit'),
      onHealth,
      onFailure: failure,
      onAuthLoss: vi.fn()
    }))
    await act(async () => { await Promise.resolve() })
    expect(fetchHealth).toHaveBeenCalledTimes(1)

    online = false
    window.dispatchEvent(new Event('offline'))
    expect(fetchHealth.mock.calls[0][1]?.signal?.aborted).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(STREAM_TOUCH_HEARTBEAT_MS * 3) })
    expect(fetchHealth).toHaveBeenCalledTimes(1)
    expect(failure).toHaveBeenCalledTimes(1)

    online = true
    window.dispatchEvent(new Event('online'))
    await act(async () => { await Promise.resolve() })
    expect(fetchHealth).toHaveBeenCalledTimes(2)
    fresh.resolve(health('pit'))
    await act(async () => { await Promise.resolve() })
    expect(onHealth).toHaveBeenCalledTimes(1)
    stale.resolve(health('pit'))
    await act(async () => { await Promise.resolve() })
    expect(onHealth).toHaveBeenCalledTimes(1)
    view.unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(STREAM_TOUCH_HEARTBEAT_MS * 2) })
    expect(fetchHealth).toHaveBeenCalledTimes(2)
  })

  it('ignores stale target, disabled-auth, and unmount completions', async () => {
    vi.useFakeTimers()
    const pit = deferred<StreamingTouchHealthResponse>()
    const strategy = deferred<StreamingTouchHealthResponse>()
    const disabled = deferred<StreamingTouchHealthResponse>()
    const unmounted = deferred<StreamingTouchHealthResponse>()
    fetchHealth
      .mockImplementationOnce(() => pit.promise)
      .mockImplementationOnce(() => strategy.promise)
      .mockImplementationOnce(() => disabled.promise)
      .mockImplementationOnce(() => unmounted.promise)
    const onHealth = vi.fn()
    const view = render(createElement(Harness, {
      enabled: true,
      panelId: 'pit',
      session: interaction('pit'),
      onHealth,
      onFailure: vi.fn(),
      onAuthLoss: vi.fn()
    }))
    await act(async () => { await Promise.resolve() })
    view.rerender(createElement(Harness, {
      enabled: true,
      panelId: 'strategy',
      session: interaction('strategy'),
      onHealth,
      onFailure: vi.fn(),
      onAuthLoss: vi.fn()
    }))
    await act(async () => { await Promise.resolve() })
    expect(fetchHealth.mock.calls[0][1]?.signal?.aborted).toBe(true)
    pit.resolve(health('pit'))
    strategy.resolve(health('strategy'))
    await act(async () => { await Promise.resolve() })
    expect(onHealth).toHaveBeenCalledTimes(1)
    expect(onHealth).toHaveBeenCalledWith(expect.objectContaining({ targetId: 'strategy' }))

    await act(async () => { await vi.advanceTimersByTimeAsync(STREAM_TOUCH_HEARTBEAT_MS) })
    expect(fetchHealth).toHaveBeenCalledTimes(3)
    view.rerender(createElement(Harness, {
      enabled: false,
      panelId: 'strategy',
      session: interaction('strategy'),
      onHealth,
      onFailure: vi.fn(),
      onAuthLoss: vi.fn()
    }))
    expect(fetchHealth.mock.calls[2][1]?.signal?.aborted).toBe(true)
    disabled.resolve(health('strategy'))
    await act(async () => { await Promise.resolve() })
    expect(onHealth).toHaveBeenCalledTimes(1)

    view.rerender(createElement(Harness, {
      enabled: true,
      panelId: 'garage',
      session: interaction('garage'),
      onHealth,
      onFailure: vi.fn(),
      onAuthLoss: vi.fn()
    }))
    await act(async () => { await Promise.resolve() })
    expect(fetchHealth).toHaveBeenCalledTimes(4)
    view.unmount()
    expect(fetchHealth.mock.calls[3][1]?.signal?.aborted).toBe(true)
    unmounted.resolve(health('garage'))
    await act(async () => { await Promise.resolve() })
    expect(onHealth).toHaveBeenCalledTimes(1)
  })

  it('times out a hung request and permits the next governed heartbeat', async () => {
    vi.useFakeTimers()
    const stale = deferred<StreamingTouchHealthResponse>()
    fetchHealth
      .mockImplementationOnce(() => stale.promise)
      .mockResolvedValueOnce(health('pit'))
    const onHealth = vi.fn()
    const failure = vi.fn()
    render(createElement(Harness, {
      enabled: true,
      panelId: 'pit',
      session: interaction('pit'),
      onHealth,
      onFailure: failure,
      onAuthLoss: vi.fn()
    }))
    await act(async () => { await Promise.resolve() })
    await act(async () => { await vi.advanceTimersByTimeAsync(STREAM_TOUCH_HEARTBEAT_TIMEOUT_MS) })
    expect(fetchHealth.mock.calls[0][1]?.signal?.aborted).toBe(true)
    expect(failure).toHaveBeenCalledTimes(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STREAM_TOUCH_HEARTBEAT_MS - STREAM_TOUCH_HEARTBEAT_TIMEOUT_MS)
    })
    expect(fetchHealth).toHaveBeenCalledTimes(2)
    expect(onHealth).toHaveBeenCalledTimes(1)
    stale.resolve(health('pit'))
    await act(async () => { await Promise.resolve() })
    expect(onHealth).toHaveBeenCalledTimes(1)
  })
})
