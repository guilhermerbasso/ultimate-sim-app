import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { formatLogLine } from '../../shared/logger'
import type { IRacingDiagnostics } from '../../shared/telemetry'
import { IRacingProvider } from '../iracing/provider'
import type { ModuleContext } from '../module-context'

// One-shot iRacing bridge diagnostics. Uses an isolated provider so the probe reflects
// the real native pipeline regardless of the currently selected source, and appends each
// run to a log file so the packaged app can be diagnosed without devtools.
export function register(ctx: ModuleContext): void {
  ctx.ipcMain.handle('telemetry:iracingDiagnostics', async (): Promise<IRacingDiagnostics> => {
    const provider = new IRacingProvider()
    let report: IRacingDiagnostics
    try {
      provider.start()
      report = { timestamp: Date.now(), hub: ctx.telemetryHub.status(), ...provider.diagnose() }
    } finally {
      provider.stop()
    }
    await appendLog(ctx, report)
    return report
  })
}

async function appendLog(ctx: ModuleContext, report: IRacingDiagnostics): Promise<void> {
  try {
    const dir = join(ctx.app.getPath('userData'), 'logs')
    await mkdir(dir, { recursive: true })
    // JSON-lines, matching the rest of the app's diagnostic logs ({ts,level,area,message,detail}).
    const line = formatLogLine({
      ts: new Date(report.timestamp).toISOString(),
      level: 'info',
      area: 'iracing-diagnostics',
      message: 'probe',
      detail: report
    })
    await appendFile(join(dir, 'iracing-diagnostics.log'), line, 'utf8')
  } catch {
    // best-effort logging
  }
}
