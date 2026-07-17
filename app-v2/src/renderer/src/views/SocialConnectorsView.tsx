import type { CSSProperties, ReactElement } from 'react'
import {
  SOCIAL_CONNECTOR_CONTRACT_VERSION,
  SOCIAL_CONNECTOR_MANIFESTS,
  MOCK_SOCIAL_CONNECTOR_STATUSES,
  buildMockCapabilityMatrix,
  type SocialCapabilityMatrixRowV1,
  type SocialProvider
} from '../../../shared/social-connectors'
import type { AppViewProps } from '../App'

const providerOrder: readonly SocialProvider[] = ['twitch', 'youtube', 'discord']
const providerLabel: Readonly<Record<SocialProvider, string>> = {
  twitch: 'Twitch',
  youtube: 'YouTube',
  discord: 'Discord'
}

const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 'var(--space-4)'
}

const guardrailStyle: CSSProperties = {
  padding: 'var(--space-4)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--surface-base)'
}

const tableWrapStyle: CSSProperties = {
  overflowX: 'auto',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)'
}

const tableStyle: CSSProperties = {
  width: '100%',
  minWidth: 980,
  borderCollapse: 'collapse',
  fontSize: 12
}

const headCellStyle: CSSProperties = {
  padding: '10px 12px',
  textAlign: 'left',
  color: 'var(--text-muted)',
  background: 'var(--surface-base)',
  borderBottom: '1px solid var(--border-default)',
  fontFamily: "'Barlow Condensed', sans-serif",
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase'
}

const cellStyle: CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid var(--border-subtle)',
  color: 'var(--text-secondary)',
  verticalAlign: 'top'
}

function stateTone(value: string): CSSProperties {
  const positive = ['granted', 'eligible', 'available', 'approved', 'not-required', 'current']
  const negative = ['revoked', 'missing', 'ineligible', 'exhausted', 'rejected', 'stale']
  if (positive.includes(value)) {
    return {
      color: 'var(--accent-success)',
      borderColor: 'color-mix(in srgb, var(--accent-success) 42%, transparent)'
    }
  }
  if (negative.includes(value)) {
    return {
      color: 'var(--accent-danger)',
      borderColor: 'color-mix(in srgb, var(--accent-danger) 42%, transparent)'
    }
  }
  return { color: 'var(--accent-warning)', borderColor: 'var(--border-strong)' }
}

function StatePill({ value, prefix }: { value: string; prefix?: string }): ReactElement {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        minHeight: 22,
        padding: '1px 8px',
        border: '1px solid',
        borderRadius: 'var(--radius-pill)',
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 10,
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
        ...stateTone(value)
      }}
    >
      {prefix ? `${prefix} ` : ''}
      {value.replaceAll('-', ' ')}
    </span>
  )
}

export function rowsForProvider(
  rows: readonly SocialCapabilityMatrixRowV1[],
  provider: SocialProvider
): readonly SocialCapabilityMatrixRowV1[] {
  return rows.filter((row) => row.provider === provider)
}

export default function SocialConnectorsView(_props: AppViewProps): ReactElement {
  const rows = buildMockCapabilityMatrix()

  return (
    <section className="view-grid" aria-label="Social connector mock conformance status">
      <article className="panel-card">
        <div className="panel-heading-row">
          <div>
            <span className="panel-label">Wave E · F2-05 foundation</span>
            <h3>Social connector capability matrix</h3>
          </div>
          <StatePill value="mock-conformance" />
        </div>
        <p>
          Deterministic contract fixtures only. No credentials, OAuth tokens, network transport,
          provider side effects, or platform certification claims are present.
        </p>
        <div style={gridStyle}>
          <div style={guardrailStyle}>
            <span className="panel-label">Contract</span>
            <strong style={{ display: 'block', marginTop: 6 }}>
              social.connector.v{SOCIAL_CONNECTOR_CONTRACT_VERSION}
            </strong>
            <p style={{ marginBottom: 0 }}>Versioned connector, capability, policy and receipt surfaces.</p>
          </div>
          <div style={guardrailStyle}>
            <span className="panel-label">Egress</span>
            <strong style={{ display: 'block', marginTop: 6 }}>Fail closed</strong>
            <p style={{ marginBottom: 0 }}>Current destination policy, scope, entitlement, quota and review are rechecked.</p>
          </div>
          <div style={guardrailStyle}>
            <span className="panel-label">Twitch destination</span>
            <strong style={{ display: 'block', marginTop: 6 }}>Merged chat output blocked</strong>
            <p style={{ marginBottom: 0 }}>Only Twitch-labelled chat may target the Twitch fixture destination.</p>
          </div>
          <div style={guardrailStyle}>
            <span className="panel-label">Inbound fixtures</span>
            <strong style={{ display: 'block', marginTop: 6 }}>Signature + replay gate</strong>
            <p style={{ marginBottom: 0 }}>Fixture signatures, delivery replay windows and event deduplication are enforced.</p>
          </div>
          <div style={guardrailStyle}>
            <span className="panel-label">Actions</span>
            <strong style={{ display: 'block', marginTop: 6 }}>Approval + operator override</strong>
            <p style={{ marginBottom: 0 }}>One-shot approvals, deadlines, idempotency and the operator kill switch protect simulated actions.</p>
          </div>
          <div style={guardrailStyle}>
            <span className="panel-label">Audit</span>
            <strong style={{ display: 'block', marginTop: 6 }}>No-secret receipts</strong>
            <p style={{ marginBottom: 0 }}>Receipts contain hashes, decisions and mock references, never payload credentials.</p>
          </div>
        </div>
      </article>

      {providerOrder.map((provider) => {
        const manifest = SOCIAL_CONNECTOR_MANIFESTS.find((entry) => entry.provider === provider)
        const status = MOCK_SOCIAL_CONNECTOR_STATUSES.find((entry) => entry.provider === provider)
        const providerRows = rowsForProvider(rows, provider)
        if (!manifest || !status) return null

        return (
          <article className="panel-card" key={provider}>
            <div className="panel-heading-row">
              <div>
                <span className="panel-label">{manifest.connectorId}</span>
                <h3>{providerLabel[provider]}</h3>
              </div>
              <StatePill value={status.lifecycle} prefix="fixture" />
            </div>
            <div style={{ ...gridStyle, marginBottom: 'var(--space-5)' }}>
              <dl className="status-list" style={{ margin: 0 }}>
                <div><dt>Transport</dt><dd>none</dd></div>
                <div><dt>Network</dt><dd>disabled</dd></div>
                <div><dt>Credentials</dt><dd>forbidden</dd></div>
              </dl>
              <dl className="status-list" style={{ margin: 0 }}>
                <div><dt>Policy</dt><dd>{status.policyState}</dd></div>
                <div><dt>Quota</dt><dd>{status.quota.remaining}/{status.quota.limit}</dd></div>
                <div><dt>Capabilities</dt><dd>{providerRows.length}</dd></div>
              </dl>
            </div>

            <div style={tableWrapStyle}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={headCellStyle}>Capability</th>
                    <th style={headCellStyle}>Direction</th>
                    <th style={headCellStyle}>Scope</th>
                    <th style={headCellStyle}>Entitlement</th>
                    <th style={headCellStyle}>Quota</th>
                    <th style={headCellStyle}>Review</th>
                    <th style={headCellStyle}>Consent</th>
                    <th style={headCellStyle}>Approval</th>
                    <th style={headCellStyle}>Policy</th>
                  </tr>
                </thead>
                <tbody>
                  {providerRows.map((row) => (
                    <tr key={row.capabilityId}>
                      <td style={{ ...cellStyle, color: 'var(--text-primary)' }}>
                        <strong>{row.label}</strong>
                        <span
                          style={{
                            display: 'block',
                            marginTop: 3,
                            fontFamily: "'IBM Plex Mono', monospace",
                            color: 'var(--text-muted)'
                          }}
                        >
                          {row.capabilityId}
                        </span>
                      </td>
                      <td style={cellStyle}>{row.direction}</td>
                      <td style={cellStyle}><StatePill value={row.scopeState} /></td>
                      <td style={cellStyle}><StatePill value={row.entitlementState} /></td>
                      <td style={cellStyle}><StatePill value={row.quotaState} /></td>
                      <td style={cellStyle}><StatePill value={row.reviewState} prefix="fixture" /></td>
                      <td style={cellStyle}><StatePill value={row.consentState} /></td>
                      <td style={cellStyle}><StatePill value={row.approval} /></td>
                      <td style={cellStyle}><StatePill value={row.policyState} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        )
      })}

      <article className="panel-card">
        <span className="panel-label">Unsupported/live features</span>
        <h3>Unavailable by design</h3>
        <p style={{ marginBottom: 0 }}>
          Any capability outside this matrix, live OAuth flow, credential capture, socket, HTTP
          request, scraping, media upload, or unreviewed destination fails closed.
        </p>
      </article>
    </section>
  )
}
