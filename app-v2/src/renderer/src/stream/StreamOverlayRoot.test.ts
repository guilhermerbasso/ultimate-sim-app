import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { STREAMING_EXPRESSION_EXCLUSION_MESSAGE } from '../../../shared/streaming'
import { StreamExpressionNotice, streamTelemetryTransport } from './StreamOverlayRoot'

describe('stream dashboard expression handling', () => {
  it('visibly marks expression placements and values as excluded', () => {
    const html = renderToStaticMarkup(createElement(StreamExpressionNotice))

    expect(html).toContain('role="status"')
    expect(html).toContain('data-stream-expression-content="excluded"')
    expect(html).toContain(STREAMING_EXPRESSION_EXCLUSION_MESSAGE)
  })
})

describe('stream telemetry transport', () => {
  it('uses WebSocket for public HTTPS receivers because Quick Tunnels do not support SSE', () => {
    expect(streamTelemetryTransport('https://example.trycloudflare.com/obs/default')).toBe('websocket')
  })

  it('preserves SSE for local and LAN HTTP receivers', () => {
    expect(streamTelemetryTransport('http://127.0.0.1:3210/obs/default')).toBe('sse')
    expect(streamTelemetryTransport('http://192.168.1.20:3210/obs/default')).toBe('sse')
  })
})
