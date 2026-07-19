import { afterEach, describe, expect, it, vi } from 'vitest'
import { TOUCH_ACTION_IPC_CHANNEL } from '../../../shared/touch-panel'
import type { StreamingTouchPanelPayload } from '../../../shared/streaming'
import type { TouchControlActionEvent } from './ButtonBoxRenderer'
import {
  activateStreamInteraction,
  clearStreamInteraction,
  executeTouchControlAction,
  fetchStreamInteractionHealth,
  fetchStreamPanel
} from './runtime'

function stubBrowserRuntime(href: string): ReturnType<typeof vi.fn> {
  vi.stubGlobal('window', { location: { href } })
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function touchEvent(
  phase: TouchControlActionEvent['phase'],
  action: TouchControlActionEvent['action'] = { kind: 'keyboard', command: { mode: 'press', keys: ['P'] } }
): TouchControlActionEvent {
  return {
    button: { id: 'radio' } as TouchControlActionEvent['button'],
    index: 0,
    zone: 'primary',
    action,
    phase,
    token: 'hold-token'
  }
}

function streamPayload(): StreamingTouchPanelPayload {
  return {
    panel: {
      schemaVersion: 2,
      id: 'panel one',
      name: 'Panel',
      columns: 1,
      rows: 1,
      gap: 0,
      background: '#000000',
      buttons: []
    },
    interaction: {
      interactive: true,
      indicator: 'INTERACTIVE TOUCH',
      role: 'touch-controller',
      health: 'ready',
      targetId: 'panel one',
      csrfToken: 'csrf-token',
      nonce: 'nonce-one',
      expiresAt: Date.now() + 60_000,
      leaseExpiresAt: Date.now() + 25_000,
      capabilities: [{
        id: 'capability-one',
        controlId: 'radio',
        zone: 'primary',
        phases: ['trigger', 'begin', 'end', 'cancel']
      }],
      activeControls: 0,
      lastFeedback: null
    }
  }
}

afterEach(() => {
  clearStreamInteraction()
  vi.unstubAllGlobals()
})

describe('touch panel browser streaming runtime', () => {
  it('uses the prefixed stream endpoint and same-origin session cookie without forwarding the query token', async () => {
    const fetchMock = stubBrowserRuntime('https://stream.example/race/obs/touch?token=secret')
    const payload = streamPayload()
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => payload
    })

    await expect(fetchStreamPanel('panel one')).resolves.toEqual(payload)

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://stream.example/race/api/touch/panel/panel%20one')
    expect(String(url)).not.toContain('secret')
    expect(init).toEqual({ cache: 'no-store', credentials: 'same-origin' })
  })

  it('posts only an opaque capability, CSRF token, phase, target, and one-time nonce', async () => {
    const fetchMock = stubBrowserRuntime('https://stream.example/race/obs/touch?token=secret')
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => streamPayload()
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          message: 'sent',
          health: 'ready',
          nextNonce: 'nonce-two',
          leaseExpiresAt: Date.now() + 25_000,
          activeControls: 1
        })
      })

    await fetchStreamPanel('panel one')
    await expect(executeTouchControlAction(touchEvent('begin'))).resolves.toEqual({ ok: true, message: 'sent' })

    const [url, init] = fetchMock.mock.calls[1]
    expect(String(url)).toBe('https://stream.example/race/api/touch/action/panel%20one')
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      'X-Stream-CSRF': 'csrf-token'
    })
    expect(JSON.parse(init.body)).toEqual({
      targetId: 'panel one',
      capabilityId: 'capability-one',
      phase: 'begin',
      nonce: 'nonce-one'
    })
    expect(init.body).not.toContain('keyboard')
    expect(init.body).not.toContain('keys')
  })

  it('fails closed locally when a control has no issued capability', async () => {
    const fetchMock = stubBrowserRuntime('https://stream.example/race/obs/touch?token=secret')
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => streamPayload()
    })
    await fetchStreamPanel('panel one')
    const event = touchEvent('trigger')
    event.button = { id: 'forbidden-control' } as TouchControlActionEvent['button']

    await expect(executeTouchControlAction(event)).resolves.toEqual({
      ok: false,
      message: 'This Touch control is not allowed for remote interaction.'
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not activate a stale profile fetch until its generation explicitly wins', async () => {
    const fetchMock = stubBrowserRuntime('https://stream.example/race/obs/touch?token=secret')
    const payload = streamPayload()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => payload
    })

    await fetchStreamPanel('panel one', { activate: false })
    await expect(executeTouchControlAction(touchEvent('begin'))).rejects.toThrow(/session is unavailable/i)
    activateStreamInteraction(payload.interaction)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        message: 'sent',
        health: 'ready',
        nextNonce: 'nonce-two',
        leaseExpiresAt: Date.now() + 25_000,
        activeControls: 1
      })
    })
    await expect(executeTouchControlAction(touchEvent('begin'))).resolves.toMatchObject({ ok: true })
  })

  it('heartbeats the receiver lease with the issued CSRF token', async () => {
    const fetchMock = stubBrowserRuntime('https://stream.example/race/obs/touch?token=secret')
    const payload = streamPayload()
    const health = {
      interactive: true,
      indicator: 'INTERACTIVE TOUCH' as const,
      role: 'touch-controller' as const,
      health: 'ready' as const,
      targetId: 'panel one',
      expiresAt: Date.now() + 60_000,
      leaseExpiresAt: Date.now() + 25_000,
      activeControls: 0,
      lastFeedback: null
    }
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => payload })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => health })

    await fetchStreamPanel('panel one')
    await expect(fetchStreamInteractionHealth('panel one')).resolves.toEqual(health)

    const [url, init] = fetchMock.mock.calls[1]
    expect(String(url)).toBe('https://stream.example/race/api/touch/health/panel%20one')
    expect(init).toEqual({
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'X-Stream-CSRF': 'csrf-token' }
    })
  })

  it('still queues cleanup with the stale nonce after a lost begin response', async () => {
    const fetchMock = stubBrowserRuntime('https://stream.example/race/obs/touch?token=secret')
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => streamPayload() })
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          message: 'released',
          health: 'ready',
          nextNonce: 'server-current-nonce',
          leaseExpiresAt: Date.now() + 25_000,
          activeControls: 0
        })
      })

    await fetchStreamPanel('panel one')
    const begin = executeTouchControlAction(touchEvent('begin'))
    const end = executeTouchControlAction(touchEvent('end'))

    await expect(begin).rejects.toThrow(/response lost/i)
    await expect(end).resolves.toEqual({ ok: true, message: 'released' })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).nonce).toBe('nonce-one')
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).nonce).toBe('nonce-one')
  })
})

describe('touch panel Electron runtime', () => {
  it('invokes only the dedicated semantic Touch action channel', async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true, message: 'sent' })
    vi.stubGlobal('window', { ipc: { invoke } })
    const event = touchEvent('trigger', {
      kind: 'iracing',
      command: { group: 'pit', name: 'pit:addFuel', fuelLiters: 10 }
    })

    await expect(executeTouchControlAction(event)).resolves.toEqual({ ok: true, message: 'sent' })
    expect(invoke).toHaveBeenCalledWith(TOUCH_ACTION_IPC_CHANNEL, {
      action: event.action,
      phase: 'trigger',
      token: 'hold-token',
      zone: 'primary'
    })
    expect(invoke).not.toHaveBeenCalledWith('iracing:command', expect.anything())
    expect(invoke).not.toHaveBeenCalledWith('actions:testEmulation', expect.anything())
  })
})