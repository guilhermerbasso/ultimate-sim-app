import { writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { dialog, type IpcMainInvokeEvent } from 'electron'
import {
  STINT_PASSPORT_CHANNELS,
  type PassportChallengeInput,
  type PassportChallengeOwnerInput,
  type PassportConfig,
  type PassportDataClass,
  type PassportExportProfile,
  type PassportExportResult,
  type PassportExperimentUpdate,
  type PassportItemResolutionInput,
  type PassportPrivacySettings,
  type PassportRosterMember
} from '../../shared/stint-passport'
import type { ModuleContext } from '../module-context'
import { StintPassportService } from '../passport/service'
import { PassportPersistenceClient } from '../passport/persistence-client'

function exportProfile(value: unknown): PassportExportProfile {
  if (value === 'full-local' || value === 'pseudonymized' || value === 'race-only') return value
  throw new Error('Unknown Passport export profile.')
}
function dataClass(value: unknown): PassportDataClass {
  if (value === 'D1' || value === 'D2' || value === 'D3') return value
  throw new Error('Unknown Passport data class.')
}

interface AuthorizedRequest<T> {
  capability: string
  payload: T
}

export function authorizePassportSender(ctx: ModuleContext, event: IpcMainInvokeEvent): void {
  const main = ctx.getMainWindow()
  if (!main || main.isDestroyed() || event.sender.id !== main.webContents.id) {
    throw new Error('Passport IPC sender is not authorized.')
  }
}

function authorized<T>(
  ctx: ModuleContext,
  service: StintPassportService,
  event: IpcMainInvokeEvent,
  input: AuthorizedRequest<T>
): T {
  authorizePassportSender(ctx, event)
  service.assertCapability(input?.capability)
  return input?.payload
}

export function register(ctx: ModuleContext): void {
  const store = new PassportPersistenceClient({
    path: join(ctx.app.getPath('userData'), 'phase02', 'passport-v2.db')
  })
  const service = new StintPassportService(ctx, store)

  ctx.ipcMain.handle(STINT_PASSPORT_CHANNELS.getSnapshot, (event) => {
    authorizePassportSender(ctx, event)
    return service.snapshot()
  })
  ctx.ipcMain.handle(
    STINT_PASSPORT_CHANNELS.setRoster,
    (event, input: AuthorizedRequest<PassportRosterMember[]>) => {
      const roster = authorized(ctx, service, event, input)
      return service.setRoster(Array.isArray(roster) ? roster : [])
    }
  )
  ctx.ipcMain.handle(
    STINT_PASSPORT_CHANNELS.repairPersistence,
    (event, input: AuthorizedRequest<string>) =>
      service.repairPersistence(authorized(ctx, service, event, input))
  )
  ctx.ipcMain.handle(
    STINT_PASSPORT_CHANNELS.recordExperiment,
    (event, input: AuthorizedRequest<PassportExperimentUpdate>) =>
      service.recordExperiment(authorized(ctx, service, event, input))
  )
  ctx.ipcMain.handle(
    STINT_PASSPORT_CHANNELS.setConfig,
    (event, input: AuthorizedRequest<PassportConfig>) =>
      service.setConfig(authorized(ctx, service, event, input))
  )
  ctx.ipcMain.handle(
    STINT_PASSPORT_CHANNELS.setPrivacy,
    (event, input: AuthorizedRequest<PassportPrivacySettings>) =>
      service.setPrivacy(authorized(ctx, service, event, input))
  )
  ctx.ipcMain.handle(
    STINT_PASSPORT_CHANNELS.resolveItem,
    (event, input: AuthorizedRequest<PassportItemResolutionInput>) =>
      service.resolveItem(authorized(ctx, service, event, input))
  )
  ctx.ipcMain.handle(
    STINT_PASSPORT_CHANNELS.prepareChallenge,
    (event, input: AuthorizedRequest<PassportChallengeOwnerInput>) =>
      service.prepareChallenge(authorized(ctx, service, event, input))
  )
  ctx.ipcMain.handle(
    STINT_PASSPORT_CHANNELS.completeChallenge,
    (event, input: AuthorizedRequest<PassportChallengeInput>) =>
      service.completeChallenge(authorized(ctx, service, event, input))
  )
  ctx.ipcMain.handle(
    STINT_PASSPORT_CHANNELS.closeCurrent,
    (event, input: AuthorizedRequest<null>) => {
      authorized(ctx, service, event, input)
      return service.closeCurrent('manual')
    }
  )
  ctx.ipcMain.handle(
    STINT_PASSPORT_CHANNELS.setKillSwitch,
    (event, input: AuthorizedRequest<boolean>) =>
      service.setKillSwitch(authorized(ctx, service, event, input) === true)
  )
  ctx.ipcMain.handle(
    STINT_PASSPORT_CHANNELS.deleteByClass,
    (event, input: AuthorizedRequest<unknown>) =>
      service.deleteByClass(dataClass(authorized(ctx, service, event, input)))
  )
  ctx.ipcMain.handle(
    STINT_PASSPORT_CHANNELS.runFullAudit,
    (event, input: AuthorizedRequest<null>) => {
      authorized(ctx, service, event, input)
      return service.runFullAudit()
    }
  )
  ctx.ipcMain.handle(
    STINT_PASSPORT_CHANNELS.saveExport,
    async (event, input: AuthorizedRequest<unknown>): Promise<PassportExportResult> => {
      const profile = exportProfile(authorized(ctx, service, event, input))
      const bundle = await service.exportPackage(profile)
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
}
