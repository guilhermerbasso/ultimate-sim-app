// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  RECEIVER_CAPABILITIES,
  RECEIVER_HEARTBEAT_MS,
  RECEIVER_MAX_HZ,
  RECEIVER_MAX_SERVER_MESSAGE_BYTES,
  RECEIVER_MIN_HZ,
  RECEIVER_PROTOCOL_VERSION,
  RECEIVER_SCHEMA_VERSION
} from '../../../shared/receiver-v2'

const serviceWorkerPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../public/receiver/v2/service-worker.js'
)

afterEach(() => {
  cleanup()
  sessionStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('receiver PWA recovery', () => {
  it('retries initial authorization when an offline browser comes back online', async () => {
    let online = false
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      get: () => online
    })
    window.__ULTIMATE_SIM_RECEIVER_PAIRING__ = 'a'.repeat(32)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 403
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          authenticated: false,
          passwordRequired: true,
          protocolVersion: RECEIVER_PROTOCOL_VERSION,
          schemaVersion: RECEIVER_SCHEMA_VERSION,
          capabilities: [...RECEIVER_CAPABILITIES],
          minHz: RECEIVER_MIN_HZ,
          maxHz: RECEIVER_MAX_HZ,
          maxPayloadBytes: RECEIVER_MAX_SERVER_MESSAGE_BYTES,
          heartbeatMs: RECEIVER_HEARTBEAT_MS,
          transportProfile: 'local-development',
          readOnly: true,
          commandsEnabled: false
        })
      })
    vi.stubGlobal('fetch', fetchMock)

    const { ReceiverPwaRoot } = await import('./ReceiverPwaRoot')
    render(createElement(ReceiverPwaRoot))

    expect(await screen.findByText('OFFLINE · STALE')).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()

    online = true
    window.dispatchEvent(new Event('online'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/receiver\/v2\/status$/)
    expect(String(fetchMock.mock.calls[1][0])).toMatch(/\/receiver\/v2\/$/)
    expect(String(fetchMock.mock.calls[2][0])).toMatch(/\/receiver\/v2\/status$/)
    expect(await screen.findByText('PAIRING')).toBeTruthy()
  })

  it('precaches the shell graph and deletes only obsolete receiver caches', () => {
    const source = readFileSync(serviceWorkerPath, 'utf8')

    expect(source).toContain('cacheReceiverShell')
    expect(source).toContain('htmlResources')
    expect(source).toContain('moduleDependencies')
    expect(source).toContain('cssDependencies')
    expect(source).toMatch(/key\.startsWith\(CACHE_PREFIX\)/)
    expect(source).toMatch(/cache\.match\(request\)/)
    expect(source).not.toMatch(/filter\(\(key\) => key !== CACHE_NAME\)/)
  })
})
