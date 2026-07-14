import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TouchControlActionEvent } from './ButtonBoxRenderer'
import { executeTouchControlAction, fetchStreamPanel } from './runtime'

function stubBrowserRuntime(href: string): ReturnType<typeof vi.fn> {
  vi.stubGlobal('window', { location: { href } })
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function touchEvent(phase: TouchControlActionEvent['phase']): TouchControlActionEvent {
  return {
    button: {} as TouchControlActionEvent['button'],
    index: 0,
    zone: 'primary',
    action: { kind: 'none' },
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

  it('sends discrete actions through the authenticated endpoint and rejects browser holds', async () => {
    const fetchMock = stubBrowserRuntime('https://stream.example/race/obs/touch?token=secret')
    fetchMock.mockResolvedValue({ ok: true, status: 200 })

    await expect(executeTouchControlAction(touchEvent('trigger'))).resolves.toEqual({
      ok: true,
      message: 'Action sent.'
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://stream.example/race/api/touch/action')
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ kind: 'none' })
    })

    await expect(executeTouchControlAction(touchEvent('begin'))).rejects.toThrow(
      'Press-and-hold is unavailable in browser streaming mode.'
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
