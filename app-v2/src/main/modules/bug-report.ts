// One-click "Report bug" backend. Collects the last 2h of the app's own
// (already secret-redacted) diagnostic logs, saves a bundle for the user to
// attach, and opens a prefilled GitHub issue. It NEVER runs anything on the user's
// machine and reads only this app's log files.
import { shell } from 'electron'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { arch, platform, release } from 'node:os'
import type { ModuleContext } from '../module-context'
import { logger } from './logger'
import {
  BUG_REPORT_CHANNELS,
  BUG_REPORT_REPO,
  BUG_REPORT_WINDOW_MS,
  type BugReportResult
} from '../../shared/bug-report'
import { appLogFileStartMs, isAppLogFileName, parseLogLine, type LogEntry } from '../../shared/logger'

const HOUR_MS = 60 * 60 * 1000
const MAX_ISSUE_BODY = 3000 // keep the issues/new URL comfortably under limits
const MAX_PROBLEM_LINES = 25

async function gatherRecentEntries(dir: string, nowMs: number): Promise<LogEntry[]> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const cutoff = nowMs - BUG_REPORT_WINDOW_MS
  // A file covers [start, start+1h); include any file whose window overlaps [cutoff, now].
  const relevant = names
    .filter((name) => isAppLogFileName(name))
    .filter((name) => {
      const start = appLogFileStartMs(name)
      return start !== null && start + HOUR_MS > cutoff
    })
    .sort()
  const out: LogEntry[] = []
  for (const name of relevant) {
    let text: string
    try {
      text = await readFile(join(dir, name), 'utf8')
    } catch {
      continue
    }
    for (const line of text.split('\n')) {
      const entry = parseLogLine(line)
      if (!entry) continue
      const ts = Date.parse(entry.ts)
      if (Number.isFinite(ts) && ts >= cutoff) out.push(entry)
    }
  }
  out.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
  return out
}

function summarize(entries: LogEntry[], version: string): { body: string; problems: number } {
  const counts: Record<string, number> = { debug: 0, info: 0, warn: 0, error: 0 }
  for (const entry of entries) counts[entry.level] = (counts[entry.level] ?? 0) + 1
  const problemEntries = entries.filter((entry) => entry.level === 'error' || entry.level === 'warn')
  const recentProblems = problemEntries.slice(-MAX_PROBLEM_LINES)
  const problemText = recentProblems
    .map((entry) => `- \`${entry.ts}\` **${entry.level.toUpperCase()}** [${entry.area}] ${entry.message}`)
    .join('\n')
  const body = [
    '### Describe the bug',
    '<!-- What happened? What did you expect? Steps to reproduce? -->',
    '',
    '### Environment',
    `- App version: ${version}`,
    `- OS: ${platform()} ${release()} (${arch()})`,
    `- Report time: ${new Date().toISOString()}`,
    '',
    '### Diagnostics (auto-collected — last 2h)',
    `Lines: ${entries.length} · errors: ${counts.error} · warnings: ${counts.warn}`,
    '',
    recentProblems.length ? `Recent problems:\n\n${problemText}` : '_No errors or warnings in the last 2h._',
    '',
    '> A full 2-hour log bundle was saved locally and the logs folder was opened — please **attach the `bug-report-*.log` file** to this issue. Logs are automatically secret-redacted.'
  ].join('\n')
  return { body: body.slice(0, MAX_ISSUE_BODY), problems: problemEntries.length }
}

export function register(ctx: ModuleContext): void {
  const dir = join(ctx.app.getPath('userData'), 'logs')

  ctx.ipcMain.handle(BUG_REPORT_CHANNELS.report, async (): Promise<BugReportResult> => {
    const nowMs = Date.now()
    const version = ctx.app.getVersion()
    try {
      const entries = await gatherRecentEntries(dir, nowMs)
      const { body, problems } = summarize(entries, version)

      // Save the full 2h bundle for the user to attach.
      let bundlePath: string | undefined
      try {
        await mkdir(dir, { recursive: true })
        const stamp = new Date(nowMs).toISOString().replace(/[:.]/g, '-')
        bundlePath = join(dir, `bug-report-${stamp}.log`)
        const header = `# Ultimate Sim App bug report — v${version} · ${platform()} ${release()} ${arch()}\n# window: last 2h · ${entries.length} lines\n`
        await writeFile(bundlePath, header + entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n', 'utf8')
      } catch {
        bundlePath = undefined
      }

      const title = `[Bug] v${version}: `
      const issueUrl = `https://github.com/${BUG_REPORT_REPO}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`

      logger.info('app', 'bug report opened', { lines: entries.length, problems, bundlePath })
      await shell.openExternal(issueUrl)
      try {
        await shell.openPath(dir)
      } catch {
        // best effort — the issue URL still opens
      }

      return { ok: true, bundlePath, issueUrl, lines: entries.length, problems }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.warn('app', 'bug report failed', { message })
      return { ok: false, message }
    }
  })
}
