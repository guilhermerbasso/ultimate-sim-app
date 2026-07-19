import { sanitizeHttpsUrl } from './external-url'

export const THIRD_PARTY_CATALOG_SCHEMA_VERSION = 1 as const
export const THIRD_PARTY_CATALOG_OPEN_CHANNEL = 'app:dash:thirdParty:open' as const

export type ThirdPartyCatalogEntryId = 'lovely-dashboard' | 'overtake-iracing'
export type ThirdPartyRightsClassification =
  | 'proprietary-restricted'
  | 'uploader-specific'
  | 'verified-permissive'
  | 'unknown'
export type ThirdPartyDistributionCapability = 'embed' | 'share' | 'reExport' | 'marketing'

export interface ThirdPartyRightsPermissions {
  embed: boolean
  share: boolean
  reExport: boolean
  marketing: boolean
}

export interface ThirdPartyRights {
  schemaVersion: typeof THIRD_PARTY_CATALOG_SCHEMA_VERSION
  classification: ThirdPartyRightsClassification
  permissions: ThirdPartyRightsPermissions
  summary: string
  sourceActionId?: string
}

export interface ThirdPartyProvenance {
  schemaVersion: typeof THIRD_PARTY_CATALOG_SCHEMA_VERSION
  publisher: string
  sourceType: 'publisher-official' | 'community-category' | 'user-supplied'
  sourceUrl?: string
}

export interface ThirdPartyCatalogAction {
  id: string
  label: string
  url: string
}

export interface ThirdPartyCatalogAcquisition {
  schemaVersion: typeof THIRD_PARTY_CATALOG_SCHEMA_VERSION
  mode: 'external-browser-only'
  bundled: false
  mirrored: false
  previewed: false
  autoDownload: false
  actions: readonly ThirdPartyCatalogAction[]
  installSteps: readonly string[]
}

export interface ThirdPartyFreshness {
  schemaVersion: typeof THIRD_PARTY_CATALOG_SCHEMA_VERSION
  checkedAt: string | null
  reviewAfter: string | null
  method: 'manual-official-review' | 'user-supplied-unverified'
  autoRefresh: false
}

export interface ThirdPartyCatalogEntry {
  schemaVersion: typeof THIRD_PARTY_CATALOG_SCHEMA_VERSION
  id: ThirdPartyCatalogEntryId
  name: string
  description: string
  rights: ThirdPartyRights
  provenance: ThirdPartyProvenance
  acquisition: ThirdPartyCatalogAcquisition
  freshness: ThirdPartyFreshness
}

export interface DashboardThirdPartyAcquisition {
  schemaVersion: typeof THIRD_PARTY_CATALOG_SCHEMA_VERSION
  mode: 'manual-local-file'
  recordedAt: number
}

export interface DashboardThirdPartyMetadata {
  schemaVersion: typeof THIRD_PARTY_CATALOG_SCHEMA_VERSION
  catalogEntryId?: ThirdPartyCatalogEntryId
  provenance: ThirdPartyProvenance
  rights: ThirdPartyRights
  acquisition: DashboardThirdPartyAcquisition
  freshness: ThirdPartyFreshness
}

export interface DashboardThirdPartyImportInput {
  catalogEntryId?: ThirdPartyCatalogEntryId | string
  sourceName?: string
  sourceUrl?: string
  rights?: unknown
}

export const THIRD_PARTY_CATALOG_ALLOWED_URLS = Object.freeze({
  lovelyLicense: 'https://lsr.gg/license',
  lovelyPlugin: 'https://lsr.gg/plugin',
  lovelyReleases: 'https://github.com/Lovely-Sim-Racing/lovely-dashboard/releases',
  overtakeIracingCategory: 'https://www.overtake.gg/downloads/categories/iracing.92/'
} as const)

const ALLOWED_CATALOG_URLS = new Set<string>(Object.values(THIRD_PARTY_CATALOG_ALLOWED_URLS))
const RIGHTS_CLASSIFICATIONS = new Set<ThirdPartyRightsClassification>([
  'proprietary-restricted',
  'uploader-specific',
  'verified-permissive',
  'unknown'
])

function isForbiddenCatalogRoute(url: URL): boolean {
  const path = url.pathname.toLowerCase()
  const segments = path.split('/').filter(Boolean)
  if (segments.some((segment) =>
    segment === 'attachment' ||
    segment === 'attachments' ||
    segment === 'login' ||
    segment === 'goto' ||
    segment === 'member' ||
    segment === 'members' ||
    segment === 'membership')) {
    return true
  }
  if (path.includes('/releases/download/')) return true
  if (/(?:^|\/)download(?:\/|$)/.test(path)) return true
  if (/\.(?:zip|rar|7z|simhubdash|exe|msi|dll)$/i.test(path)) return true
  return false
}

function sanitizeThirdPartyProvenanceUrl(value: unknown): string {
  const sanitized = sanitizeHttpsUrl(value, {
    maxLength: 500,
    allowCredentials: false,
    allowPort: false,
    allowSearch: false,
    allowHash: false
  })
  if (isForbiddenCatalogRoute(new URL(sanitized))) {
    throw new Error('Third-party resource or account links are not allowed.')
  }
  return sanitized
}

export function sanitizeThirdPartyCatalogUrl(value: unknown): string {
  const sanitized = sanitizeThirdPartyProvenanceUrl(value)
  if (!ALLOWED_CATALOG_URLS.has(sanitized)) throw new Error('Third-party catalog URL is not allowlisted.')
  return sanitized
}

const DENIED_PERMISSIONS: ThirdPartyRightsPermissions = Object.freeze({
  embed: false,
  share: false,
  reExport: false,
  marketing: false
})

export function unknownThirdPartyRights(summary = 'Rights were not verified. Embedding, sharing, re-export, and marketing use are disabled.'): ThirdPartyRights {
  return {
    schemaVersion: THIRD_PARTY_CATALOG_SCHEMA_VERSION,
    classification: 'unknown',
    permissions: { ...DENIED_PERMISSIONS },
    summary
  }
}

export const THIRD_PARTY_DASHBOARD_CATALOG: readonly ThirdPartyCatalogEntry[] = Object.freeze([
  {
    schemaVersion: THIRD_PARTY_CATALOG_SCHEMA_VERSION,
    id: 'lovely-dashboard',
    name: 'Lovely Dashboard',
    description: 'A third-party SimHub dashboard ecosystem. Review the publisher terms and use its official installation flow outside this app.',
    rights: {
      schemaVersion: THIRD_PARTY_CATALOG_SCHEMA_VERSION,
      classification: 'proprietary-restricted',
      permissions: { ...DENIED_PERMISSIONS },
      summary: 'Proprietary personal/non-commercial terms restrict redistribution, derivatives, and marketing use.',
      sourceActionId: 'license'
    },
    provenance: {
      schemaVersion: THIRD_PARTY_CATALOG_SCHEMA_VERSION,
      publisher: 'Lovely Sim Racing',
      sourceType: 'publisher-official',
      sourceUrl: THIRD_PARTY_CATALOG_ALLOWED_URLS.lovelyLicense
    },
    acquisition: {
      schemaVersion: THIRD_PARTY_CATALOG_SCHEMA_VERSION,
      mode: 'external-browser-only',
      bundled: false,
      mirrored: false,
      previewed: false,
      autoDownload: false,
      actions: [
        { id: 'license', label: 'Open official license', url: THIRD_PARTY_CATALOG_ALLOWED_URLS.lovelyLicense },
        { id: 'plugin', label: 'Open official plugin/install page', url: THIRD_PARTY_CATALOG_ALLOWED_URLS.lovelyPlugin },
        { id: 'releases', label: 'Open official GitHub releases', url: THIRD_PARTY_CATALOG_ALLOWED_URLS.lovelyReleases }
      ],
      installSteps: [
        'Install SimHub from its official source.',
        'Open the official Lovely plugin/install page, install the plugin, then restart SimHub and enable the plugin.',
        'In SimHub, open Lovely Plugin > Dashboard Manager and follow the publisher instructions to install or update dashboards.',
        'Review the official license before use.'
      ]
    },
    freshness: {
      schemaVersion: THIRD_PARTY_CATALOG_SCHEMA_VERSION,
      checkedAt: '2026-07-17',
      reviewAfter: '2026-10-17',
      method: 'manual-official-review',
      autoRefresh: false
    }
  },
  {
    schemaVersion: THIRD_PARTY_CATALOG_SCHEMA_VERSION,
    id: 'overtake-iracing',
    name: 'OverTake iRacing category',
    description: 'A community category root. Rights and availability are uploader-specific; login or an anti-bot challenge may appear only after opening the external browser.',
    rights: {
      schemaVersion: THIRD_PARTY_CATALOG_SCHEMA_VERSION,
      classification: 'uploader-specific',
      permissions: { ...DENIED_PERMISSIONS },
      summary: 'The category does not grant reuse rights. Treat each unverified upload as restricted.',
      sourceActionId: 'category'
    },
    provenance: {
      schemaVersion: THIRD_PARTY_CATALOG_SCHEMA_VERSION,
      publisher: 'OverTake',
      sourceType: 'community-category',
      sourceUrl: THIRD_PARTY_CATALOG_ALLOWED_URLS.overtakeIracingCategory
    },
    acquisition: {
      schemaVersion: THIRD_PARTY_CATALOG_SCHEMA_VERSION,
      mode: 'external-browser-only',
      bundled: false,
      mirrored: false,
      previewed: false,
      autoDownload: false,
      actions: [
        { id: 'category', label: 'Open OverTake iRacing category', url: THIRD_PARTY_CATALOG_ALLOWED_URLS.overtakeIracingCategory }
      ],
      installSteps: [
        'Review the uploader terms on the external site before obtaining any file.',
        'Complete any login or challenge in your browser; this app does not automate it.',
        'Use the generic local import only for a file you obtained lawfully, and record its source when known.'
      ]
    },
    freshness: {
      schemaVersion: THIRD_PARTY_CATALOG_SCHEMA_VERSION,
      checkedAt: '2026-07-17',
      reviewAfter: '2026-10-17',
      method: 'manual-official-review',
      autoRefresh: false
    }
  }
])

for (const entry of THIRD_PARTY_DASHBOARD_CATALOG) {
  for (const action of entry.acquisition.actions) sanitizeThirdPartyCatalogUrl(action.url)
}

export function listThirdPartyDashboardCatalog(): readonly ThirdPartyCatalogEntry[] {
  return THIRD_PARTY_DASHBOARD_CATALOG
}

export function resolveThirdPartyCatalogActionUrl(entryId: unknown, actionId: unknown): string {
  if (typeof entryId !== 'string' || typeof actionId !== 'string') {
    throw new Error('Third-party catalog action is invalid.')
  }
  const entry = THIRD_PARTY_DASHBOARD_CATALOG.find((candidate) => candidate.id === entryId)
  const action = entry?.acquisition.actions.find((candidate) => candidate.id === actionId)
  if (!entry || !action) throw new Error('Third-party catalog action is not allowlisted.')
  return sanitizeThirdPartyCatalogUrl(action.url)
}

function plainDataRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  try {
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
      ? value as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function ownDataValue(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key)
  if (!descriptor) return undefined
  if (!('value' in descriptor)) throw new Error(`${key} must be a plain data property.`)
  return descriptor.value
}

function safeText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, maxLength) : ''
}

function safePermission(record: Record<string, unknown> | null, key: keyof ThirdPartyRightsPermissions): boolean {
  if (!record) return false
  try {
    return ownDataValue(record, key) === true
  } catch {
    return false
  }
}

export function normalizeThirdPartyRights(input: unknown): ThirdPartyRights {
  const record = plainDataRecord(input)
  if (!record) return unknownThirdPartyRights()
  try {
    const rawClassification = ownDataValue(record, 'classification')
    const classification = typeof rawClassification === 'string' && RIGHTS_CLASSIFICATIONS.has(rawClassification as ThirdPartyRightsClassification)
      ? rawClassification as ThirdPartyRightsClassification
      : 'unknown'
    const permissions = plainDataRecord(ownDataValue(record, 'permissions'))
    const allowExplicitPermissions = classification === 'verified-permissive'
    return {
      schemaVersion: THIRD_PARTY_CATALOG_SCHEMA_VERSION,
      classification,
      permissions: allowExplicitPermissions
        ? {
            embed: safePermission(permissions, 'embed'),
            share: safePermission(permissions, 'share'),
            reExport: safePermission(permissions, 'reExport'),
            marketing: safePermission(permissions, 'marketing')
          }
        : { ...DENIED_PERMISSIONS },
      summary: safeText(ownDataValue(record, 'summary'), 280) || (
        classification === 'unknown'
          ? 'Rights were not verified. Embedding, sharing, re-export, and marketing use are disabled.'
          : 'Recorded rights are fail-closed unless each permission is explicitly verified.'
      ),
      ...(safeText(ownDataValue(record, 'sourceActionId'), 80)
        ? { sourceActionId: safeText(ownDataValue(record, 'sourceActionId'), 80) }
        : {})
    }
  } catch {
    return unknownThirdPartyRights()
  }
}

function cloneRights(rights: ThirdPartyRights): ThirdPartyRights {
  return { ...rights, permissions: { ...rights.permissions } }
}

function cloneProvenance(provenance: ThirdPartyProvenance): ThirdPartyProvenance {
  return { ...provenance }
}

function cloneFreshness(freshness: ThirdPartyFreshness): ThirdPartyFreshness {
  return { ...freshness }
}

export function normalizeThirdPartyImportMetadata(
  input: unknown,
  recordedAt = Date.now()
): DashboardThirdPartyMetadata | undefined {
  if (input === undefined || input === null) return undefined
  if (!Number.isSafeInteger(recordedAt) || recordedAt < 0) throw new Error('Third-party import timestamp is invalid.')
  const record = plainDataRecord(input)
  if (!record) throw new Error('Third-party import metadata must be plain data.')

  const rawCatalogEntryId = ownDataValue(record, 'catalogEntryId')
  const catalogEntryId = safeText(rawCatalogEntryId, 80)
  const catalogEntry = catalogEntryId
    ? THIRD_PARTY_DASHBOARD_CATALOG.find((candidate) => candidate.id === catalogEntryId)
    : undefined
  if (catalogEntryId && !catalogEntry) throw new Error('Third-party catalog entry is not allowlisted.')

  if (catalogEntry) {
    return {
      schemaVersion: THIRD_PARTY_CATALOG_SCHEMA_VERSION,
      catalogEntryId: catalogEntry.id,
      provenance: cloneProvenance(catalogEntry.provenance),
      rights: cloneRights(catalogEntry.rights),
      acquisition: {
        schemaVersion: THIRD_PARTY_CATALOG_SCHEMA_VERSION,
        mode: 'manual-local-file',
        recordedAt
      },
      freshness: cloneFreshness(catalogEntry.freshness)
    }
  }

  const sourceName = safeText(ownDataValue(record, 'sourceName'), 120) || 'Unspecified third-party source'
  const rawSourceUrl = safeText(ownDataValue(record, 'sourceUrl'), 500)
  const sourceUrl = rawSourceUrl
    ? sanitizeThirdPartyProvenanceUrl(rawSourceUrl)
    : undefined

  return {
    schemaVersion: THIRD_PARTY_CATALOG_SCHEMA_VERSION,
    provenance: {
      schemaVersion: THIRD_PARTY_CATALOG_SCHEMA_VERSION,
      publisher: sourceName,
      sourceType: 'user-supplied',
      ...(sourceUrl ? { sourceUrl } : {})
    },
    rights: normalizeThirdPartyRights(ownDataValue(record, 'rights')),
    acquisition: {
      schemaVersion: THIRD_PARTY_CATALOG_SCHEMA_VERSION,
      mode: 'manual-local-file',
      recordedAt
    },
    freshness: {
      schemaVersion: THIRD_PARTY_CATALOG_SCHEMA_VERSION,
      checkedAt: null,
      reviewAfter: null,
      method: 'user-supplied-unverified',
      autoRefresh: false
    }
  }
}

function rightsValidationError(value: unknown): string | null {
  const record = plainDataRecord(value)
  if (!record) return 'rights must be a plain object.'
  try {
    if (ownDataValue(record, 'schemaVersion') !== THIRD_PARTY_CATALOG_SCHEMA_VERSION) return 'rights schemaVersion is unsupported.'
    const classification = ownDataValue(record, 'classification')
    if (typeof classification !== 'string' || !RIGHTS_CLASSIFICATIONS.has(classification as ThirdPartyRightsClassification)) {
      return 'rights classification is invalid.'
    }
    const permissions = plainDataRecord(ownDataValue(record, 'permissions'))
    if (!permissions) return 'rights permissions are missing.'
    for (const key of ['embed', 'share', 'reExport', 'marketing'] as const) {
      if (typeof ownDataValue(permissions, key) !== 'boolean') return `rights permissions.${key} must be a boolean.`
    }
    if (classification !== 'verified-permissive' &&
      (ownDataValue(permissions, 'embed') === true ||
        ownDataValue(permissions, 'share') === true ||
        ownDataValue(permissions, 'reExport') === true ||
        ownDataValue(permissions, 'marketing') === true)) {
      return `rights classification ${classification} cannot grant distribution permissions.`
    }
    if (!safeText(ownDataValue(record, 'summary'), 280)) return 'rights summary is required.'
    return null
  } catch (error) {
    return error instanceof Error ? error.message : 'rights metadata is unreadable.'
  }
}

export function dashboardThirdPartyMetadataValidationError(value: unknown): string | null {
  const record = plainDataRecord(value)
  if (!record) return 'thirdParty must be a plain object.'
  try {
    if (ownDataValue(record, 'schemaVersion') !== THIRD_PARTY_CATALOG_SCHEMA_VERSION) return 'thirdParty schemaVersion is unsupported.'
    const catalogEntryId = ownDataValue(record, 'catalogEntryId')
    if (catalogEntryId !== undefined &&
      (typeof catalogEntryId !== 'string' || !THIRD_PARTY_DASHBOARD_CATALOG.some((entry) => entry.id === catalogEntryId))) {
      return 'thirdParty catalogEntryId is not allowlisted.'
    }

    const provenance = plainDataRecord(ownDataValue(record, 'provenance'))
    if (!provenance) return 'thirdParty provenance is missing.'
    if (ownDataValue(provenance, 'schemaVersion') !== THIRD_PARTY_CATALOG_SCHEMA_VERSION) return 'provenance schemaVersion is unsupported.'
    if (!safeText(ownDataValue(provenance, 'publisher'), 120)) return 'provenance publisher is required.'
    const sourceType = ownDataValue(provenance, 'sourceType')
    if (sourceType !== 'publisher-official' && sourceType !== 'community-category' && sourceType !== 'user-supplied') {
      return 'provenance sourceType is invalid.'
    }
    const sourceUrl = ownDataValue(provenance, 'sourceUrl')
    if (sourceUrl !== undefined) {
      sanitizeThirdPartyProvenanceUrl(sourceUrl)
    }

    const rightsError = rightsValidationError(ownDataValue(record, 'rights'))
    if (rightsError) return rightsError

    const acquisition = plainDataRecord(ownDataValue(record, 'acquisition'))
    if (!acquisition) return 'thirdParty acquisition is missing.'
    if (ownDataValue(acquisition, 'schemaVersion') !== THIRD_PARTY_CATALOG_SCHEMA_VERSION) return 'acquisition schemaVersion is unsupported.'
    if (ownDataValue(acquisition, 'mode') !== 'manual-local-file') return 'acquisition mode is invalid.'
    const recordedAt = ownDataValue(acquisition, 'recordedAt')
    if (!Number.isSafeInteger(recordedAt) || (recordedAt as number) < 0) return 'acquisition recordedAt is invalid.'

    const freshness = plainDataRecord(ownDataValue(record, 'freshness'))
    if (!freshness) return 'thirdParty freshness is missing.'
    if (ownDataValue(freshness, 'schemaVersion') !== THIRD_PARTY_CATALOG_SCHEMA_VERSION) return 'freshness schemaVersion is unsupported.'
    for (const key of ['checkedAt', 'reviewAfter'] as const) {
      const date = ownDataValue(freshness, key)
      if (date !== null && (typeof date !== 'string' || Number.isNaN(Date.parse(date)))) return `freshness ${key} is invalid.`
    }
    const method = ownDataValue(freshness, 'method')
    if (method !== 'manual-official-review' && method !== 'user-supplied-unverified') return 'freshness method is invalid.'
    if (ownDataValue(freshness, 'autoRefresh') !== false) return 'freshness autoRefresh must remain disabled.'

    if (typeof catalogEntryId === 'string') {
      const catalogEntry = THIRD_PARTY_DASHBOARD_CATALOG.find((entry) => entry.id === catalogEntryId)!
      const rights = plainDataRecord(ownDataValue(record, 'rights'))!
      const permissions = plainDataRecord(ownDataValue(rights, 'permissions'))!
      if (ownDataValue(rights, 'classification') !== catalogEntry.rights.classification) {
        return 'catalog rights classification does not match the allowlisted entry.'
      }
      for (const key of ['embed', 'share', 'reExport', 'marketing'] as const) {
        if (ownDataValue(permissions, key) !== catalogEntry.rights.permissions[key]) {
          return `catalog rights permissions.${key} does not match the allowlisted entry.`
        }
      }
      if (ownDataValue(provenance, 'publisher') !== catalogEntry.provenance.publisher ||
        ownDataValue(provenance, 'sourceType') !== catalogEntry.provenance.sourceType ||
        ownDataValue(provenance, 'sourceUrl') !== catalogEntry.provenance.sourceUrl) {
        return 'catalog provenance does not match the allowlisted entry.'
      }
    }
    return null
  } catch (error) {
    return error instanceof Error ? error.message : 'thirdParty metadata is unreadable.'
  }
}

export function thirdPartyDistributionRestrictionReason(
  metadata: unknown,
  capability: ThirdPartyDistributionCapability
): string | null {
  if (metadata === undefined || metadata === null) return null
  const validationError = dashboardThirdPartyMetadataValidationError(metadata)
  if (validationError) return `Third-party rights are missing or invalid: ${validationError}`
  const record = plainDataRecord(metadata)!
  const rights = plainDataRecord(ownDataValue(record, 'rights'))!
  const permissions = plainDataRecord(ownDataValue(rights, 'permissions'))!
  if (ownDataValue(permissions, capability) === true) return null
  const classification = String(ownDataValue(rights, 'classification'))
  return `Recorded third-party rights (${classification}) do not allow ${capability === 'reExport' ? 're-export' : capability}.`
}

export function dashboardDistributionRestrictionReason(
  dashboard: unknown,
  capability: ThirdPartyDistributionCapability
): string | null {
  const record = plainDataRecord(dashboard)
  if (!record) return null
  try {
    return thirdPartyDistributionRestrictionReason(ownDataValue(record, 'thirdParty'), capability)
  } catch (error) {
    return `Third-party rights are missing or invalid: ${error instanceof Error ? error.message : 'unreadable metadata.'}`
  }
}
