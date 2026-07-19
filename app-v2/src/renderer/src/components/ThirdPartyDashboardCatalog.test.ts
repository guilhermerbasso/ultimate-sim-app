import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { THIRD_PARTY_CATALOG_OPEN_CHANNEL } from '../../../shared/third-party-dashboard-catalog'
import {
  ThirdPartyDashboardCatalog,
  openThirdPartyDashboardCatalogAction
} from './ThirdPartyDashboardCatalog'

const invoke = vi.fn().mockResolvedValue({ opened: true })
const fetchMock = vi.fn()

describe('ThirdPartyDashboardCatalog', () => {
  beforeEach(() => {
    invoke.mockClear()
    fetchMock.mockClear()
    vi.stubGlobal('window', {
      ipc: { invoke, subscribe: vi.fn(() => () => {}) }
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders plain text, disclaimer, and install steps without network or IPC before click', () => {
    const markup = renderToStaticMarkup(createElement(ThirdPartyDashboardCatalog))
    expect(markup).toContain('Third-party dashboard catalog')
    expect(markup).toContain('does not host, copy, mirror, preview')
    expect(markup).toContain('Install SimHub from its official source.')
    expect(invoke).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(markup).not.toContain('<img')
    expect(markup).not.toMatch(/background-image|url\(/i)
  })

  it('requests the allowlisted external-browser action only after a user action', async () => {
    await openThirdPartyDashboardCatalogAction('lovely-dashboard', 'license')
    expect(invoke).toHaveBeenCalledWith(
      THIRD_PARTY_CATALOG_OPEN_CHANNEL,
      'lovely-dashboard',
      'license'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
