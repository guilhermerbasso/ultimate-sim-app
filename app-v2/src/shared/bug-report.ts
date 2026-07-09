// Shared contract for the one-click "Report bug" feature. No electron/node imports
// so it's importable by main, preload, renderer and tests.

export const BUG_REPORT_CHANNELS = {
  /** Renderer → Main: collect last-2h logs, save a bundle, open a prefilled GH issue. */
  report: 'bug:report'
} as const

export type BugReportChannel = (typeof BUG_REPORT_CHANNELS)[keyof typeof BUG_REPORT_CHANNELS]

/** GitHub repo the issue is opened against. */
export const BUG_REPORT_REPO = 'guilhermerbasso/ultimate-sim-app'

/** How much log history to gather for a report. */
export const BUG_REPORT_WINDOW_MS = 2 * 60 * 60 * 1000

export interface BugReportResult {
  ok: boolean
  /** Absolute path to the saved log bundle (for the user to attach), if written. */
  bundlePath?: string
  /** The GitHub issues/new URL that was opened. */
  issueUrl?: string
  /** Number of log lines gathered in the window. */
  lines?: number
  /** Number of error/warn lines gathered. */
  problems?: number
  message?: string
}
