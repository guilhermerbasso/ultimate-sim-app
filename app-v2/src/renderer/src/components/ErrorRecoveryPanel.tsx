import { type ReactElement, useState } from 'react'
import type { ErrorBoundaryFallbackProps } from './ErrorBoundary'

type ExportState = { status: 'idle' | 'busy' } | { status: 'done' | 'failed'; message: string }

/**
 * Recovery panel shown when a screen or the whole shell fails to render.
 *
 * It always offers the two things the audit asked for: a way back without
 * restarting, and a diagnostic export the user can attach to a report.
 */
export function ErrorRecoveryPanel({
  error,
  retry,
  exportDiagnostics,
  title,
  detail,
  variant
}: ErrorBoundaryFallbackProps & {
  title: string
  detail: string
  variant: 'view' | 'app'
}): ReactElement {
  const [exportState, setExportState] = useState<ExportState>({ status: 'idle' })

  const runExport = async (): Promise<void> => {
    setExportState({ status: 'busy' })
    try {
      setExportState({ status: 'done', message: await exportDiagnostics() })
    } catch (cause) {
      setExportState({
        status: 'failed',
        message: cause instanceof Error ? cause.message : 'Diagnostic export failed.'
      })
    }
  }

  return (
    <div className={`error-recovery error-recovery--${variant}`} role="alert">
      <div className="error-recovery-card">
        <h2 className="error-recovery-title">{title}</h2>
        <p className="error-recovery-detail">{detail}</p>
        <p className="error-recovery-message">{error.message}</p>
        <div className="error-recovery-actions">
          <button className="error-recovery-button" type="button" onClick={retry}>
            Try again
          </button>
          <button
            className="error-recovery-button"
            type="button"
            onClick={() => void runExport()}
            disabled={exportState.status === 'busy'}
            aria-busy={exportState.status === 'busy' || undefined}
          >
            Export diagnostics
          </button>
          {variant === 'app' && (
            <button className="error-recovery-button" type="button" onClick={() => window.location.reload()}>
              Reload app
            </button>
          )}
        </div>
        {exportState.status === 'busy' && <p className="error-recovery-note">Collecting diagnostics…</p>}
        {(exportState.status === 'done' || exportState.status === 'failed') && (
          <p className="error-recovery-note" role="status">
            {exportState.message}
          </p>
        )}
      </div>
    </div>
  )
}
