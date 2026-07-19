import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RelayCapabilityStatusMatrix } from './RelayCapabilityStatusMatrix'

describe('RelayCapabilityStatusMatrix', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the foundation boundaries without IPC, credentials, or network activity', () => {
    const fetchMock = vi.fn()
    const invoke = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('window', { ipc: { invoke, subscribe: vi.fn(() => () => {}) } })

    const markup = renderToStaticMarkup(createElement(RelayCapabilityStatusMatrix))

    expect(markup).toContain('Capability and status matrix')
    expect(markup).toContain('No live relay, hosting, endpoint')
    expect(markup).toContain('D4 secrets / D5 sensitive media')
    expect(markup).toContain('Provider replacement')
    expect(markup).toContain('data-status="blocked"')
    expect(markup).toContain('live network: <strong>disabled</strong>')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalled()
  })
})
