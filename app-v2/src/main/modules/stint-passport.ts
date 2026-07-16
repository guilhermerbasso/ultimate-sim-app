import { writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { dialog } from 'electron'
import {
  STINT_PASSPORT_CHANNELS,
  type PassportChallengeInput,
  type PassportConfig,
  type PassportDataClass,
  type PassportExportProfile,
  type PassportExportResult,
  type PassportItemResolutionInput,
  type PassportPrivacySettings,
  type PassportRosterMember
} from '../../shared/stint-passport'
import type { ModuleContext } from '../module-context'
import { StintPassportService } from '../passport/service'
import { PassportStore } from '../passport/store'

function exportProfile(value: unknown): PassportExportProfile {
  if (value === 'full-local' || value === 'pseudonymized' || value === 'race-only') return value
  throw new Error('Unknown Passport export profile.')
}
function dataClass(value: unknown): PassportDataClass {
  if (value === 'D1' || value === 'D2' || value === 'D3') return value
  throw new Error('Unknown Passport data class.')
}

export function register(ctx: ModuleContext): void {
  const store = new PassportStore({
    path: join(ctx.app.getPath('userData'), 'phase02', 'passport.db')
  })
  const service = new StintPassportService(ctx, store)

  ctx.ipcMain.handle(STINT_PASSPORT_CHANNELS.getSnapshot, () => service.snapshot())
  ctx.ipcMain.handle(
    STINT_PASSPORT_CHANNELS.setRoster,
    (_event, roster?: PassportRosterMember[]) => service.setRoster(Array.isArray(roster) ? roster : [])
  )
  ctx.ipcMain.handle(
    STINT_PASSPORT_CHANNELS.setConfig,
    (_event, config: PassportConfig) => service.setConfig(config)
  )
  ctx.ipcMain.handle(
    STINT_PASSPORT_CHANNELS.setPrivacy,
    (_event, privacy: PassportPrivacySettings) => service.setPrivacy(privacy)
  )
  ctx.ipcMain.handle(
    STINT_PASSPORT_CHANNELS.resolveItem,
    (_event, input: PassportItemResolutionInput) => service.resolveItem(input)
  )
  ctx.ipcMain.handle(
    STINT_PASSPORT_CHANNELS.completeChallenge,
    (_event, input: PassportChallengeInput) => service.completeChallenge(input)
  )
  ctx.ipcMain.handle(
    STINT_PASSPORT_CHANNELS.closeCurrent,
    () => service.closeCurrent('manual')
  )
  ctx.ipcMain.handle(
    STINT_PASSPORT_CHANNELS.setKillSwitch,
    (_event, enabled?: unknown) => service.setKillSwitch(enabled === true)
  )
  ctx.ipcMain.handle(
    STINT_PASSPORT_CHANNELS.deleteByClass,
    (_event, value: unknown) => service.deleteByClass(dataClass(value))
  )
  ctx.ipcMain.handle(
    STINT_PASSPORT_CHANNELS.runFullAudit,
    () => service.runFullAudit()
  )
  ctx.ipcMain.handle(
    STINT_PASSPORT_CHANNELS.saveExport,
    async (_event, value: unknown): Promise<PassportExportResult> => {
      const profile = exportProfile(value)
      const bundle = service.exportPackage(profile)
      const owner = ctx.getMainWindow()
      const options = {
        title: 'Export Endurance Stint Passport',
        defaultPath: `stint-passport-${profile}.json`,
        filters: [{ name: 'Passport JSON', extensions: ['json'] }]
      }
      const result = owner
        ? await dialog.showSaveDialog(owner, options)
        : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return { ok: false, canceled: true }
      await writeFile(result.filePath, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8')
      return {
        ok: true,
        canceled: false,
        fileName: basename(result.filePath),
        packageHash: bundle.packageHash
      }
    }
  )

  ctx.registerGracefulTeardown(() => service.dispose(), 'quiesce')
  ctx.registerGracefulTeardown(() => store.close(), 'persistence')
}
