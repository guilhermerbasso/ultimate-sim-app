import { Component, type ErrorInfo, type ReactNode } from 'react'

interface DashboardErrorBoundaryProps {
  children: ReactNode
}

interface DashboardErrorBoundaryState {
  error: Error | null
}

export class DashboardErrorBoundary extends Component<
  DashboardErrorBoundaryProps,
  DashboardErrorBoundaryState
> {
  state: DashboardErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): DashboardErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[dashboard] renderer error boundary', error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div
        role="alert"
        style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          boxSizing: 'border-box',
          padding: 32,
          background: '#090b0f',
          color: '#f6fbff',
          fontFamily: 'Segoe UI, sans-serif'
        }}
      >
        <div style={{ maxWidth: 720, padding: 24, border: '1px solid #ff5468', borderRadius: 12, background: '#171015' }}>
          <h1 style={{ margin: '0 0 12px', fontSize: 24 }}>Dashboard renderer failed</h1>
          <p style={{ color: '#ffb5bf', overflowWrap: 'anywhere' }}>{this.state.error.message}</p>
          <p style={{ color: '#9aa6b2' }}>
            The dashboard was stopped instead of leaving a black window. Reload it after repairing or replacing the saved dashboard.
          </p>
          <button type="button" onClick={() => window.location.reload()}>
            Reload dashboard
          </button>
        </div>
      </div>
    )
  }
}
