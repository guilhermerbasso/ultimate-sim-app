import { Component, type ErrorInfo, type ReactElement, type ReactNode } from 'react'
import { BUG_REPORT_CHANNELS, type BugReportResult } from '../../../shared/bug-report'
import { logClient } from '../lib/log-client'

export interface ErrorBoundaryFallbackProps {
  error: Error
  /** Discards the caught error and re-renders the subtree. */
  retry(): void
  /** Asks the main process to save a redacted diagnostic bundle. */
  exportDiagnostics(): Promise<string>
}

interface ErrorBoundaryProps {
  children: ReactNode
  /** Names the failing area in the log entry, e.g. the active view id. */
  scope: string
  /** Changing this value clears a caught error, e.g. when the user navigates away. */
  resetKey?: string
  fallback(props: ErrorBoundaryFallbackProps): ReactElement
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * Generic recovery boundary.
 *
 * Used twice: around the active view, so one failing screen leaves the shell —
 * navigation, search and Report Bug — usable; and around the whole app as a last
 * resort, so a failure in the chrome itself still renders something actionable
 * rather than a blank window.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidUpdate(previous: ErrorBoundaryProps): void {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    logClient.error('renderer', `error boundary caught in ${this.props.scope}`, {
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack
    })
  }

  private retry = (): void => {
    this.setState({ error: null })
  }

  private exportDiagnostics = async (): Promise<string> => {
    const result = await window.ipc.invoke<BugReportResult>(BUG_REPORT_CHANNELS.report)
    if (!result?.ok) throw new Error(result?.message ?? 'Diagnostic export failed.')
    return result.bundlePath ? `Diagnostic bundle saved to ${result.bundlePath}` : 'Diagnostic bundle saved.'
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return this.props.fallback({ error, retry: this.retry, exportDiagnostics: this.exportDiagnostics })
  }
}
