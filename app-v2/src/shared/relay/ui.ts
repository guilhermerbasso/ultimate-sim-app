export type RelayUiCapabilityStatus =
  | 'available-local'
  | 'mock-verified'
  | 'gated'
  | 'blocked'
  | 'not-configured'

export interface RelayCapabilityMatrixRow {
  id: string
  capability: string
  local: RelayUiCapabilityStatus
  selfHosted: RelayUiCapabilityStatus
  managed: RelayUiCapabilityStatus
  detail: string
}

export const RELAY_FOUNDATION_STATUS = {
  mode: 'foundation-only',
  localPrimary: true,
  liveRelayConfigured: false,
  networkEnabled: false,
  credentialsConfigured: false,
  productionCryptoImplemented: false,
  providerContract: RELAY_PROVIDER_CONTRACT
} as const

export const RELAY_CAPABILITY_STATUS_MATRIX: readonly RelayCapabilityMatrixRow[] = Object.freeze([
  {
    id: 'local-primary',
    capability: 'Local primary document copy',
    local: 'available-local',
    selfHosted: 'available-local',
    managed: 'available-local',
    detail: 'Local editing and recovery never depend on relay availability.'
  },
  {
    id: 'allowlisted-e2ee',
    capability: 'Allowlisted ciphertext envelopes',
    local: 'mock-verified',
    selfHosted: 'not-configured',
    managed: 'not-configured',
    detail: 'Strict contracts, sender signatures, epochs, replay counters, and gateway admission receipts are modeled.'
  },
  {
    id: 'identity-capability',
    capability: 'Identity and capability envelopes',
    local: 'mock-verified',
    selfHosted: 'not-configured',
    managed: 'not-configured',
    detail: 'Device identity, grant expiry, membership epoch, data class, consent, and rights are revalidated.'
  },
  {
    id: 'offline-queue',
    capability: 'Bounded offline queue',
    local: 'mock-verified',
    selfHosted: 'mock-verified',
    managed: 'mock-verified',
    detail: 'Local changes continue while ciphertext waits within item/byte quotas.'
  },
  {
    id: 'key-lifecycle',
    capability: 'Key rotation and revocation',
    local: 'mock-verified',
    selfHosted: 'not-configured',
    managed: 'not-configured',
    detail: 'Rotation certificates advance key/membership epochs and exclude revoked members.'
  },
  {
    id: 'health-resync',
    capability: 'Health, quarantine, and resync plan',
    local: 'mock-verified',
    selfHosted: 'not-configured',
    managed: 'not-configured',
    detail: 'Split brain blocks automatic sync; local functions remain available.'
  },
  {
    id: 'ops-manifests',
    capability: 'Backup / upgrade / rollback',
    local: 'mock-verified',
    selfHosted: 'not-configured',
    managed: 'not-configured',
    detail: 'Provider-neutral ciphertext manifests are deterministic and exclude plaintext/private keys.'
  },
  {
    id: 'provider-migration',
    capability: 'Provider replacement',
    local: 'mock-verified',
    selfHosted: 'not-configured',
    managed: 'not-configured',
    detail: 'Migration preserves admission receipts and verifies record count/digest without changing the source.'
  },
  {
    id: 'd3',
    capability: 'D3 identity/team content',
    local: 'gated',
    selfHosted: 'gated',
    managed: 'gated',
    detail: 'Only allowlisted document types with explicit current consent and retention policy.'
  },
  {
    id: 'd4-d5',
    capability: 'D4 secrets / D5 sensitive media',
    local: 'blocked',
    selfHosted: 'blocked',
    managed: 'blocked',
    detail: 'Never accepted by relay document/event contracts in this foundation.'
  },
  {
    id: 'live-relay',
    capability: 'Live hosting, endpoints, or credentials',
    local: 'blocked',
    selfHosted: 'not-configured',
    managed: 'not-configured',
    detail: 'No server, socket, DNS, port, credential, or external network path exists in this slice.'
  }
])
import { RELAY_PROVIDER_CONTRACT } from './contracts'
