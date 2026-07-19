import { type CSSProperties, type ReactElement } from 'react'
import {
  RELAY_CAPABILITY_STATUS_MATRIX,
  RELAY_FOUNDATION_STATUS,
  type RelayUiCapabilityStatus
} from '../../../shared/relay/ui'

const STATUS_LABELS: Record<RelayUiCapabilityStatus, string> = {
  'available-local': 'Local',
  'mock-verified': 'Mock verified',
  gated: 'Gated',
  blocked: 'Blocked',
  'not-configured': 'Not configured'
}

const STATUS_COLORS: Record<RelayUiCapabilityStatus, string> = {
  'available-local': '#5dd39e',
  'mock-verified': '#7dd3fc',
  gated: '#fbbf24',
  blocked: '#fb7185',
  'not-configured': '#94a3b8'
}

const tableCell: CSSProperties = {
  borderBottom: '1px solid var(--border-subtle)',
  padding: '10px 8px',
  textAlign: 'left',
  verticalAlign: 'top'
}

function StatusBadge({ status }: { status: RelayUiCapabilityStatus }): ReactElement {
  return (
    <span
      data-status={status}
      style={{
        display: 'inline-flex',
        border: `1px solid ${STATUS_COLORS[status]}66`,
        borderRadius: 999,
        color: STATUS_COLORS[status],
        fontSize: 11,
        fontWeight: 700,
        padding: '2px 8px',
        whiteSpace: 'nowrap'
      }}
    >
      {STATUS_LABELS[status]}
    </span>
  )
}

export function RelayCapabilityStatusMatrix(): ReactElement {
  return (
    <section className="panel-card" aria-labelledby="relay-foundation-title" style={{ display: 'grid', gap: 12 }}>
      <div>
        <span className="field-label" style={{ margin: 0 }}>Optional relay foundation</span>
        <h3 id="relay-foundation-title" style={{ margin: '5px 0 0' }}>Capability and status matrix</h3>
        <p style={{ margin: '6px 0 0', color: 'var(--muted)', fontSize: 13, maxWidth: 900 }}>
          Foundation only: local-first contracts and deterministic mocks. No live relay, hosting, endpoint,
          credential, production cryptography, or network request is configured.
        </p>
      </div>

      <div
        role="status"
        style={{
          border: '1px solid rgba(125, 211, 252, 0.28)',
          borderRadius: 'var(--radius-sm)',
          background: 'rgba(125, 211, 252, 0.07)',
          padding: 10,
          fontSize: 12
        }}
      >
        Mode: <strong>{RELAY_FOUNDATION_STATUS.mode}</strong> · provider contract:{' '}
        <code>{RELAY_FOUNDATION_STATUS.providerContract}</code> · live network: <strong>disabled</strong>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: 760, borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              <th scope="col" style={tableCell}>Capability</th>
              <th scope="col" style={tableCell}>Local</th>
              <th scope="col" style={tableCell}>Self-hosted</th>
              <th scope="col" style={tableCell}>Managed</th>
              <th scope="col" style={tableCell}>Boundary</th>
            </tr>
          </thead>
          <tbody>
            {RELAY_CAPABILITY_STATUS_MATRIX.map((row) => (
              <tr key={row.id}>
                <th scope="row" style={tableCell}>{row.capability}</th>
                <td style={tableCell}><StatusBadge status={row.local} /></td>
                <td style={tableCell}><StatusBadge status={row.selfHosted} /></td>
                <td style={tableCell}><StatusBadge status={row.managed} /></td>
                <td style={{ ...tableCell, color: 'var(--muted)', minWidth: 280 }}>{row.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ margin: 0, color: 'var(--muted)', fontSize: 12 }}>
        Revocation rotates future epochs and excludes revoked members; it cannot erase history already delivered
        to an authorized device.
      </p>
    </section>
  )
}

export default RelayCapabilityStatusMatrix
