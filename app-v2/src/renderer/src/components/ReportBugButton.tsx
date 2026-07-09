import { type ReactElement, useState } from 'react'
import { BUG_REPORT_CHANNELS, type BugReportResult } from '../../../shared/bug-report'
import { tt, type ResolvedLanguage } from '../i18n'

type ToastTone = 'success' | 'error' | 'info'

/**
 * Persistent "Report bug" button (sits beside Support in the app chrome). Asks the
 * main process to collect the last 2h of (already secret-redacted) logs, save a
 * bundle, and open a prefilled GitHub issue + the logs folder to attach it.
 */
export function ReportBugButton({
  language,
  showToast
}: {
  language?: ResolvedLanguage
  showToast: (message: string, tone?: ToastTone) => void
}): ReactElement {
  const [busy, setBusy] = useState(false)

  const onClick = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.ipc.invoke<BugReportResult>(BUG_REPORT_CHANNELS.report)
      if (result?.ok) showToast(tt(language, 'chrome.reportBugDone'), 'info')
      else showToast(result?.message ?? tt(language, 'chrome.reportBugFailed'), 'error')
    } catch (error) {
      showToast(error instanceof Error ? error.message : tt(language, 'chrome.reportBugFailed'), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      aria-label={tt(language, 'chrome.reportBugAria')}
      className="report-bug-button"
      disabled={busy}
      onClick={() => void onClick()}
      title={tt(language, 'chrome.reportBugTitle')}
      type="button"
    >
      {tt(language, 'chrome.reportBug')}
    </button>
  )
}
