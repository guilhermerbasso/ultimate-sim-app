import { afterEach, describe, expect, it, vi } from 'vitest'
import { TOUCH_ACTION_IPC_CHANNEL } from '../../../shared/touch-panel'
import type { TouchControlActionEvent } from './ButtonBoxRenderer'
import { executeTouchControlAction, fetchStreamPanel } from './runtime'

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
    button: {} as TouchControlActionEvent['button'],
    index: 0,
    zone: 'primary',
    action,
    phase,
    token: 'hold-token'
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('touch panel browser streaming runtime', () => {
  it('uses the prefixed stream endpoint and same-origin session cookie without forwarding the query token', async () => {
    const fetchMock = stubBrowserRuntime('https://stream.example/race/obs/touch?token=secret')
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'panel one' })
    })

    await expect(fetchStreamPanel('panel one')).resolves.toEqual({ id: 'panel one' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://stream.example/race/api/touch/panel/panel%20one')
    expect(String(url)).not.toContain('secret')
    expect(init).toEqual({ credentials: 'same-origin' })
  })

  it('fails every browser action closed without POSTing to the intentional 405 endpoint', async () => {
    const fetchMock = stubBrowserRuntime('https://stream.example/race/obs/touch?token=secret')

    await expect(executeTouchControlAction(touchEvent('trigger'))).rejects.toThrow(
      'Touch controls are read-only in browser streaming mode.'
    )
    await expect(executeTouchControlAction(touchEvent('begin'))).rejects.toThrow(
      'Touch controls are read-only in browser streaming mode.'
    )
    expect(fetchMock).not.toHaveBeenCalled()
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