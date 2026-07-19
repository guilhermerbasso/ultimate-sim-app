import { describe, expect, it } from 'vitest'
import { DEFAULT_OBS_WEBSOCKET_PORT, resolveObsEndpoint } from './endpoint'

function connectArgs(overrides: Partial<Parameters<typeof resolveObsEndpoint>[0]> = {}): Parameters<typeof resolveObsEndpoint>[0] {
  return {
    password: 'obs-secret',
    scenes: [{ sceneName: 'Race', sourceNames: ['Overlay'] }],
    ...overrides
  }
}

describe('resolveObsEndpoint', () => {
  it('defaults OBS control to loopback and the standard WebSocket port', () => {
    expect(resolveObsEndpoint(connectArgs())).toEqual({
      endpoint: `ws://127.0.0.1:${DEFAULT_OBS_WEBSOCKET_PORT}`,
      host: '127.0.0.1',
      port: DEFAULT_OBS_WEBSOCKET_PORT,
      loopback: true,
      explicitNonLoopback: false
    })
  })

  it('preserves explicit fixed ports for loopback endpoints', () => {
    expect(resolveObsEndpoint(connectArgs({ host: 'localhost', port: 4460 }))).toEqual({
      endpoint: 'ws://localhost:4460',
      host: 'localhost',
      port: 4460,
      loopback: true,
      explicitNonLoopback: false
    })
  })

  it('rejects non-loopback OBS hosts without the explicit override', () => {
    expect(() => resolveObsEndpoint(connectArgs({ host: '192.168.0.24' })))
      .toThrow(/loopback-only/i)
  })

  it('allows non-loopback OBS hosts only when explicitly overridden', () => {
    expect(resolveObsEndpoint(connectArgs({
      host: '192.168.0.24',
      port: 4456,
      allowNonLoopback: true
    }))).toEqual({
      endpoint: 'ws://192.168.0.24:4456',
      host: '192.168.0.24',
      port: 4456,
      loopback: false,
      explicitNonLoopback: true
    })
  })
})
