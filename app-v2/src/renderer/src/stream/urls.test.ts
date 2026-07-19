import { describe, expect, it } from 'vitest'
import { streamBaseUrlFrom } from './urls'

describe('stream browser URL routing', () => {
  it('preserves a manual public path prefix while removing the /obs target segment', () => {
    const base = streamBaseUrlFrom('https://stream.example.test/public/overlay/obs/race?token=secret&dash=race')
    expect(base.toString()).toBe('https://stream.example.test/public/overlay/')
    expect(new URL('assets/stream.js', base).pathname).toBe('/public/overlay/assets/stream.js')
    expect(new URL('api/dashboard/race', base).pathname).toBe('/public/overlay/api/dashboard/race')
    expect(new URL('ping', base).search).toBe('')
    expect(new URL('sse', base).search).toBe('')
  })

  it('uses the origin root for local and tunnel URLs without a prefix', () => {
    expect(streamBaseUrlFrom('http://127.0.0.1:3210/obs/default?token=secret').toString()).toBe('http://127.0.0.1:3210/')
    expect(streamBaseUrlFrom('https://example.trycloudflare.com/obs/default?token=secret').toString()).toBe('https://example.trycloudflare.com/')
  })
})
