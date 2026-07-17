import { dialog, type IpcMainInvokeEvent, type OpenDialogOptions } from 'electron'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { ModuleContext } from '../module-context'
import {
  STEWARD_CHANNELS,
  STEWARD_EXPORT_EXTENSION,
  type StewardAppealInput,
  type StewardAppealResolutionInput,
  type StewardBookmarkAddInput,
  type StewardCaseAssignmentInput,
  type StewardCaseCreateInput,
  type StewardCaseStatusInput,
  type StewardDissentInput,
  type StewardEvidenceLockInput,
  type StewardExportProfile,
  type StewardExportRequest,
  type StewardExportResult,
  type StewardImportResult,
  type StewardRuleCitationInput,
  type StewardVerdictInput
} from '../../shared/steward-desk'
import { StewardCaseStore, serializeStewardExportBundle } from '../steward-desk/store'
import { logger } from './logger'

const MAX_IMPORT_BYTES = 16 * 1024 * 1024

function authorize(ctx: ModuleContext, event: IpcMainInvokeEvent): void {
  const main = ctx.getMainWindow()
  if (!main || main.isDestroyed() || main.webContents.id !== event.sender.id) {
    throw new Error('Steward Desk IPC sender is not authorized.')
  }
}

function caseId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('A steward case id is required.')
  return value
}

function exportProfile(value: unknown): StewardExportProfile {
  if (value === 'full-local' || value === 'anonymized') return value
  throw new Error('Unsupported steward export profile.')
}

export function register(ctx: ModuleContext): void {
  const store = new StewardCaseStore({
    rootDir: join(ctx.app.getPath('userData'), 'steward-desk')
  })
  const changed = (caseIdValue?: string): void => {
    ctx.broadcast(STEWARD_CHANNELS.changed, {
      caseId: caseIdValue,
      updatedAt: Date.now()
    })
  }
  const mutate = <T extends { caseId: string }>(operation: () => T): T => {
    const result = operation()
    changed(result.caseId)
    return result
  }

  ctx.ipcMain.handle(STEWARD_CHANNELS.listCases, (event) => {
    authorize(ctx, event)
    return store.listCases()
  })
  ctx.ipcMain.handle(STEWARD_CHANNELS.getCase, (event, value: unknown) => {
    authorize(ctx, event)
    return store.getCase(caseId(value))
  })
  ctx.ipcMain.handle(STEWARD_CHANNELS.createCase, (event, input: StewardCaseCreateInput) => {
    authorize(ctx, event)
    return mutate(() => store.createCase(input))
  })
  ctx.ipcMain.handle(STEWARD_CHANNELS.assignCase, (event, input: StewardCaseAssignmentInput) => {
    authorize(ctx, event)
    return mutate(() => store.assignCase(input))
  })
  ctx.ipcMain.handle(STEWARD_CHANNELS.setStatus, (event, input: StewardCaseStatusInput) => {
    authorize(ctx, event)
    return mutate(() => store.setStatus(input))
  })
  ctx.ipcMain.handle(STEWARD_CHANNELS.addBookmark, (event, input: StewardBookmarkAddInput) => {
    authorize(ctx, event)
    return mutate(() => store.addBookmark(input))
  })
  ctx.ipcMain.handle(STEWARD_CHANNELS.lockEvidence, (event, input: StewardEvidenceLockInput) => {
    authorize(ctx, event)
    return mutate(() => store.lockEvidence(input))
  })
  ctx.ipcMain.handle(STEWARD_CHANNELS.citeRule, (event, input: StewardRuleCitationInput) => {
    authorize(ctx, event)
    return mutate(() => store.citeRule(input))
  })
  ctx.ipcMain.handle(STEWARD_CHANNELS.recordVerdict, (event, input: StewardVerdictInput) => {
    authorize(ctx, event)
    return mutate(() => store.recordVerdict(input))
  })
  ctx.ipcMain.handle(STEWARD_CHANNELS.recordDissent, (event, input: StewardDissentInput) => {
    authorize(ctx, event)
    return mutate(() => store.recordDissent(input))
  })
  ctx.ipcMain.handle(STEWARD_CHANNELS.fileAppeal, (event, input: StewardAppealInput) => {
    authorize(ctx, event)
    return mutate(() => store.fileAppeal(input))
  })
  ctx.ipcMain.handle(STEWARD_CHANNELS.resolveAppeal, (event, input: StewardAppealResolutionInput) => {
    authorize(ctx, event)
    return mutate(() => store.resolveAppeal(input))
  })
  ctx.ipcMain.handle(
    STEWARD_CHANNELS.exportCase,
    async (event, request: StewardExportRequest): Promise<StewardExportResult> => {
      authorize(ctx, event)
      const profile = exportProfile(request?.profile)
      const bundle = store.exportCase(caseId(request?.caseId), profile)
      const options = {
        title: profile === 'anonymized' ? 'Export anonymized steward case' : 'Export local steward case',
        defaultPath: `steward-case-${profile}.${STEWARD_EXPORT_EXTENSION}`,
        filters: [{ name: 'Steward case package', extensions: [STEWARD_EXPORT_EXTENSION] }]
      }
      const main = ctx.getMainWindow()
      const result = main
        ? await dialog.showSaveDialog(main, options)
        : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return { ok: false, canceled: true }
      await writeFile(result.filePath, serializeStewardExportBundle(bundle), 'utf8')
      return {
        ok: true,
        canceled: false,
        fileName: basename(result.filePath),
        packageHash: bundle.packageHash,
        profile
      }
    }
  )
  ctx.ipcMain.handle(STEWARD_CHANNELS.importCase, async (event): Promise<StewardImportResult> => {
    authorize(ctx, event)
    const main = ctx.getMainWindow()
    const options: OpenDialogOptions = {
      title: 'Import steward case',
      properties: ['openFile'],
      filters: [{ name: 'Steward case package', extensions: [STEWARD_EXPORT_EXTENSION] }]
    }
    const result = main
      ? await dialog.showOpenDialog(main, options)
      : await dialog.showOpenDialog(options)
    const filePath = result.filePaths[0]
    if (result.canceled || !filePath) return { ok: false, canceled: true }
    const fileStat = await stat(filePath)
    if (!fileStat.isFile() || fileStat.size > MAX_IMPORT_BYTES) {
      throw new Error('Steward package is not a supported file or exceeds 16 MiB.')
    }
    const importedCase = store.importCase(await readFile(filePath, 'utf8'))
    changed(importedCase.caseId)
    return { ok: true, canceled: false, importedCase }
  })

  logger.info('steward', 'local Steward Desk registered', {
    integrity: 'unanchored',
    automaticPenalties: false
  })
}
