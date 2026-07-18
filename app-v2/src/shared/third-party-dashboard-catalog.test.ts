import { describe, expect, it, vi } from 'vitest'
import {
  THIRD_PARTY_CATALOG_ALLOWED_URLS,
  THIRD_PARTY_CATALOG_SCHEMA_VERSION,
  THIRD_PARTY_DASHBOARD_CATALOG,
  dashboardDistributionRestrictionReason,
  listThirdPartyDashboardCatalog,
  normalizeThirdPartyImportMetadata,
  normalizeThirdPartyRights,
  resolveThirdPartyCatalogActionUrl,
  sanitizeThirdPartyCatalogUrl,
  thirdPartyDistributionRestrictionReason
} from './third-party-dashboard-catalog'

describe('third-party dashboard catalog policy', () => {
  it('uses versioned rights, provenance, acquisition, and freshness records', () => {
    expect(THIRD_PARTY_DASHBOARD_CATALOG.map((entry) => entry.id)).toEqual([
      'lovely-dashboard',
      'overtake-iracing'
    ])
    for (const entry of THIRD_PARTY_DASHBOARD_CATALOG) {
      expect(entry.schemaVersion).toBe(THIRD_PARTY_CATALOG_SCHEMA_VERSION)
      expect(entry.rights.schemaVersion).toBe(THIRD_PARTY_CATALOG_SCHEMA_VERSION)
      expect(entry.provenance.schemaVersion).toBe(THIRD_PARTY_CATALOG_SCHEMA_VERSION)
      expect(entry.acquisition.schemaVersion).toBe(THIRD_PARTY_CATALOG_SCHEMA_VERSION)
      expect(entry.freshness.schemaVersion).toBe(THIRD_PARTY_CATALOG_SCHEMA_VERSION)
      expect(entry.acquisition).toMatchObject({
        mode: 'external-browser-only',
        bundled: false,
        mirrored: false,
        previewed: false,
        autoDownload: false
      })
      expect(entry.freshness.autoRefresh).toBe(false)
    }
  })

  it('allows only the four approved official/category routes', () => {
    const urls = THIRD_PARTY_DASHBOARD_CATALOG.flatMap((entry) =>
      entry.acquisition.actions.map((action) => action.url)
    )
    expect(urls).toEqual(Object.values(THIRD_PARTY_CATALOG_ALLOWED_URLS))
    for (const url of urls) expect(sanitizeThirdPartyCatalogUrl(url)).toBe(url)
    expect(resolveThirdPartyCatalogActionUrl('lovely-dashboard', 'license'))
      .toBe(THIRD_PARTY_CATALOG_ALLOWED_URLS.lovelyLicense)
    expect(resolveThirdPartyCatalogActionUrl('overtake-iracing', 'category'))
      .toBe(THIRD_PARTY_CATALOG_ALLOWED_URLS.overtakeIracingCategory)
  })

  it.each([
    'https://www.overtake.gg/attachments/dashboard.zip',
    'https://www.overtake.gg/login/',
    'https://www.overtake.gg/goto/post?id=1',
    'https://www.overtake.gg/members/uploader.1/',
    'https://lsr.gg/membership',
    'https://github.com/Lovely-Sim-Racing/lovely-dashboard/releases/download/v1/dashboard.simhubdash',
    'https://www.overtake.gg/download/dashboard.simhubdash'
  ])('rejects forbidden attachment/login/goto/download/member link %s', (url) => {
    expect(() => sanitizeThirdPartyCatalogUrl(url)).toThrow()
  })

  it('lists static data without fetch, navigation, or other network work', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    try {
      expect(listThirdPartyDashboardCatalog()).toBe(THIRD_PARTY_DASHBOARD_CATALOG)
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('contains no remote image, logo, screenshot, preview URL, or compatibility claim', () => {
    const serialized = JSON.stringify(THIRD_PARTY_DASHBOARD_CATALOG)
    expect(serialized).not.toMatch(/https:[^"]+\.(?:png|jpe?g|gif|webp|svg)/i)
    expect(serialized).not.toMatch(/logoUrl|imageUrl|screenshotUrl|previewUrl/i)
    expect(serialized).not.toMatch(/\bcompatible\b/i)
  })
})

describe('third-party import rights', () => {
  it('defaults missing and unknown rights to no embed/share/re-export/marketing', () => {
    for (const rights of [
      normalizeThirdPartyRights(undefined),
      normalizeThirdPartyRights({}),
      normalizeThirdPartyRights({
        classification: 'unknown',
        permissions: { embed: true, share: true, reExport: true, marketing: true }
      })
    ]) {
      expect(rights.classification).toBe('unknown')
      expect(rights.permissions).toEqual({
        embed: false,
        share: false,
        reExport: false,
        marketing: false
      })
    }
  })

  it('records catalog provenance and blocks restrictive re-export and sharing', () => {
    const metadata = normalizeThirdPartyImportMetadata({ catalogEntryId: 'lovely-dashboard' }, 123)
    expect(metadata).toMatchObject({
      schemaVersion: 1,
      catalogEntryId: 'lovely-dashboard',
      acquisition: { mode: 'manual-local-file', recordedAt: 123 },
      rights: { classification: 'proprietary-restricted' }
    })
    expect(thirdPartyDistributionRestrictionReason(metadata, 'reExport')).toMatch(/do not allow re-export/)
    expect(thirdPartyDistributionRestrictionReason(metadata, 'share')).toMatch(/do not allow share/)
  })

  it('keeps a source-neutral local import untagged and distributable by this policy', () => {
    expect(normalizeThirdPartyImportMetadata(undefined, 123)).toBeUndefined()
    expect(dashboardDistributionRestrictionReason({ id: 'local' }, 'reExport')).toBeNull()
  })

  it('fails closed when a persisted third-party record is missing rights', () => {
    const incomplete = {
      schemaVersion: 1,
      provenance: {
        schemaVersion: 1,
        publisher: 'Unknown',
        sourceType: 'user-supplied'
      },
      acquisition: { schemaVersion: 1, mode: 'manual-local-file', recordedAt: 1 },
      freshness: {
        schemaVersion: 1,
        checkedAt: null,
        reviewAfter: null,
        method: 'user-supplied-unverified',
        autoRefresh: false
      }
    }
    expect(thirdPartyDistributionRestrictionReason(incomplete, 'share')).toMatch(/rights are missing or invalid/i)
  })

  it('does not execute accessors or expression strings while normalizing metadata', () => {
    let getterRan = false
    const accessorInput = Object.create(null) as Record<string, unknown>
    Object.defineProperty(accessorInput, 'catalogEntryId', {
      enumerable: true,
      get() {
        getterRan = true
        return 'lovely-dashboard'
      }
    })
    expect(() => normalizeThirdPartyImportMetadata(accessorInput, 1)).toThrow(/plain data property/)
    expect(getterRan).toBe(false)

    ;(globalThis as { __thirdPartyExpressionRan?: boolean }).__thirdPartyExpressionRan = false
    const expression = 'globalThis.__thirdPartyExpressionRan = true'
    const metadata = normalizeThirdPartyImportMetadata({ sourceName: expression }, 2)
    expect(metadata?.provenance.publisher).toBe(expression)
    expect((globalThis as { __thirdPartyExpressionRan?: boolean }).__thirdPartyExpressionRan).toBe(false)
    delete (globalThis as { __thirdPartyExpressionRan?: boolean }).__thirdPartyExpressionRan
  })

  it('rejects direct resource and account URLs in optional provenance metadata', () => {
    expect(() => normalizeThirdPartyImportMetadata({
      sourceName: 'Unknown',
      sourceUrl: 'https://example.test/attachments/dashboard.zip'
    }, 1)).toThrow(/resource or account links/)
    expect(() => normalizeThirdPartyImportMetadata({
      sourceName: 'Unknown',
      sourceUrl: 'https://example.test/login?next=dashboard'
    }, 1)).toThrow()
  })
})
