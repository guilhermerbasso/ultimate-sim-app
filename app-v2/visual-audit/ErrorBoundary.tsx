import { Component, type ErrorInfo, type ReactNode } from 'react'

// Per-widget error isolation. A widget that throws during render is replaced by
// a compact error card so the rest of the gallery still renders, and its id is
// pushed onto `window.__vaFailures` (and logged) for the Playwright shoot script
// and the QA reviewer to collect.

declare global {
  interface Window {
    __vaFailures?: Array<{ id: string; message: string }>
  }
}

function recordFailure(id: string, message: string): void {
  if (typeof window === 'undefined') return
  if (!window.__vaFailures) window.__vaFailures = []
  window.__vaFailures.push({ id, message })
}

interface Props {
  id: string
  children: ReactNode
}

interface State {
  error: Error | null
}

export class WidgetErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    recordFailure(this.props.id, error.message)
    // eslint-disable-next-line no-console
    console.error(`[visual-audit] widget "${this.props.id}" failed:`, error.message, info.componentStack)
  }

  render(): ReactNode {
    const { error } = this.state
    if (error) {
      return (
        <div className="va-error" data-va-failed={this.props.id}>
          <strong>render error</strong>
          <div>{error.message}</div>
        </div>
      )
    }
    return this.props.children
  }
}
