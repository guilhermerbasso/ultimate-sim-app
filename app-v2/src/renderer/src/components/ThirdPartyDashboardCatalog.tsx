import { type CSSProperties, type ReactElement } from 'react'
import {
  THIRD_PARTY_CATALOG_OPEN_CHANNEL,
  listThirdPartyDashboardCatalog
} from '../../../shared/third-party-dashboard-catalog'

const panel: CSSProperties = {
  background: 'rgba(255,255,255,0.035)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 'var(--radius-sm)',
  padding: 16,
  color: 'var(--text-primary, #f6fbff)'
}

const card: CSSProperties = {
  border: '1px solid rgba(255,255,255,0.09)',
  borderRadius: 'var(--radius-sm)',
  padding: 12,
  background: 'rgba(0,0,0,0.14)'
}

const button: CSSProperties = {
  padding: '7px 11px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid rgba(var(--accent-rgb),0.5)',
  background: 'rgba(var(--accent-rgb),0.12)',
  color: 'inherit',
  cursor: 'pointer',
  fontSize: 12
}

export interface ThirdPartyDashboardCatalogProps {
  onError?: (message: string) => void
}

export async function openThirdPartyDashboardCatalogAction(entryId: string, actionId: string): Promise<void> {
  await window.ipc.invoke(THIRD_PARTY_CATALOG_OPEN_CHANNEL, entryId, actionId)
}

export function ThirdPartyDashboardCatalog({ onError }: ThirdPartyDashboardCatalogProps): ReactElement {
  const entries = listThirdPartyDashboardCatalog()

  async function openAction(entryId: string, actionId: string): Promise<void> {
    try {
      await openThirdPartyDashboardCatalogAction(entryId, actionId)
    } catch (error) {
      onError?.(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <section style={panel} aria-labelledby="third-party-dashboard-catalog-title">
      <div style={{ display: 'grid', gap: 4 }}>
        <small style={{ letterSpacing: 1, textTransform: 'uppercase', opacity: 0.65 }}>External options</small>
        <h3 id="third-party-dashboard-catalog-title" style={{ margin: 0 }}>Third-party dashboard catalog</h3>
        <p style={{ margin: '4px 0 0', maxWidth: 900, opacity: 0.74, fontSize: 13 }}>
          Links open only in your default browser. Ultimate Sim App does not host, copy, mirror, preview,
          auto-download, or verify compatibility. Review publisher and uploader rights before obtaining files.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12, marginTop: 14 }}>
        {entries.map((entry) => (
          <article key={entry.id} style={card}>
            <h4 style={{ margin: 0 }}>{entry.name}</h4>
            <p style={{ margin: '6px 0 0', opacity: 0.78, fontSize: 13 }}>{entry.description}</p>
            <p style={{ margin: '8px 0 0', fontSize: 12 }}>
              <strong>Rights:</strong> {entry.rights.summary}
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              {entry.acquisition.actions.map((action) => (
                <button
                  key={action.id}
                  style={button}
                  type="button"
                  onClick={() => void openAction(entry.id, action.id)}
                >
                  {action.label}
                </button>
              ))}
            </div>
            <details style={{ marginTop: 10 }}>
              <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>Install/acquisition steps</summary>
              <ol style={{ margin: '8px 0 0', paddingLeft: 20, display: 'grid', gap: 4, opacity: 0.78, fontSize: 12 }}>
                {entry.acquisition.installSteps.map((step) => <li key={step}>{step}</li>)}
              </ol>
            </details>
          </article>
        ))}
      </div>
    </section>
  )
}

export default ThirdPartyDashboardCatalog
