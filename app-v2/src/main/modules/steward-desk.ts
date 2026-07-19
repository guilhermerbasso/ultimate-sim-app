import { dialog, type IpcMainInvokeEvent, type OpenDialogOptions } from 'electron'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { ModuleContext } from '../module-context'
import {
  STEWARD_CHANNELS,
  STEWARD_EXPORT_EXTENSION,
  STEWARD_PACKAGE_MAX_BYTES,
  type StewardAppealInput,
  type StewardAppealResolutionInput,
  type StewardBookmarkAddInput,
  type StewardCaseAssignmentInput,
  type StewardCaseCreateInput,
  type StewardCaseStatusInput,
  type StewardDissentInput,
  type StewardEvidenceDetailsRequest,
  type StewardEvidenceLockInput,
  type StewardExportProfile,
  type StewardExportRequest,
  type StewardExportResult,
  type StewardImportResult,
  type StewardIncidentEvidenceLockRequest,
  type StewardRuleCitationInput,
  type StewardVerdictInput
} from '../../shared/steward-desk'
import { StewardCaseStore, serializeStewardExportBundle } from '../steward-desk/store'
import { trustedParticipantActor, trustedStewardActor } from '../steward-desk/actors'
import {
  readVerifiedIncidentClipFromUserData,
  type VerifiedIncidentClip
} from '../incidents/clip-store'
import { logger } from './logger'

const MAX_IMPORT_BYTES = STEWARD_PACKAGE_MAX_BYTES + 4 * 1024 * 1024

function authorize(ctx: ModuleContext, event: IpcMainInvokeEvent): void {
  const main = ctx.getMainWindow()
  if (!main || main.isDestroyed() || main.webContents.id !== event.sender.id) {
    throw new Error('Steward Desk IPC sender is not authorized.')
  }
}

function requiredId(value: unknown, field: 'case' | 'evidence'): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`A steward ${field} id is required.`)
  }
  return value.trim()
}

const caseId = (value: unknown): string => requiredId(value, 'case')
const evidenceId = (value: unknown): string => requiredId(value, 'evidence')

function exportProfile(value: unknown): StewardExportProfile {
  if (value === 'full-local' || value === 'anonymized') return value
  throw new Error('Unsupported steward export profile.')
}

export interface StewardDeskModuleOptions {
  readVerifiedClip?: (userDataPath: string, id: string) => VerifiedIncidentClip | null
}

export function register(ctx: ModuleContext, options: StewardDeskModuleOptions = {}): void {
  const readVerifiedClip = options.readVerifiedClip ?? readVerifiedIncidentClipFromUserData
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
  ctx.ipcMain.handle(
    STEWARD_CHANNELS.getEvidenceDetails,
    (event, request: StewardEvidenceDetailsRequest) => {
      authorize(ctx, event)
      return store.getEvidenceDetails(caseId(request?.caseId), evidenceId(request?.evidenceId))
    }
  )
  ctx.ipcMain.handle(STEWARD_CHANNELS.createCase, (event, input: StewardCaseCreateInput) => {
    authorize(ctx, event)
    const owner = trustedStewardActor()
    if (input?.incident?.source !== 'incident-recorder') {
      return mutate(() => store.createCase({ ...input, actor: owner, assignedTo: owner }))
    }
    const clip = readVerifiedClip(
      ctx.app.getPath('userData'),
      input.incident.sourceId
    )
    if (!clip) throw new Error('Verified incident clip was not found.')
    return mutate(() => store.createCaseFromIncidentClip({
      ...input,
      actor: owner,
      assignedTo: owner
    }, clip))
  })
  ctx.ipcMain.handle(STEWARD_CHANNELS.assignCase, (event, input: StewardCaseAssignmentInput) => {
    authorize(ctx, event)
    const owner = trustedStewardActor()
    return mutate(() => store.assignCase({ ...input, actor: owner, assignedTo: owner }))
  })
  ctx.ipcMain.handle(STEWARD_CHANNELS.setStatus, (event, input: StewardCaseStatusInput) => {
    authorize(ctx, event)
    return mutate(() => store.setStatus({ ...input, actor: trustedStewardActor() }))
  })
  ctx.ipcMain.handle(STEWARD_CHANNELS.addBookmark, (event, input: StewardBookmarkAddInput) => {
    authorize(ctx, event)
    if (input?.bookmark?.source === 'incident-recorder') {
      throw new Error('Incident-recorder bookmarks must be derived from a verified persisted clip.')
    }
    return mutate(() => store.addBookmark({ ...input, actor: trustedStewardActor() }))
  })
  ctx.ipcMain.handle(STEWARD_CHANNELS.lockEvidence, (event, input: StewardEvidenceLockInput) => {
    authorize(ctx, event)
    if (input?.provenance?.sourceKind === 'incident-recorder') {
      throw new Error('Incident clips must be locked through the trusted incident evidence channel.')
    }
    return mutate(() => store.lockEvidence({ ...input, actor: trustedStewardActor() }))
  })
  ctx.ipcMain.handle(
    STEWARD_CHANNELS.lockIncidentEvidence,
    (event, request: StewardIncidentEvidenceLockRequest) => {
      authorize(ctx, event)
      const clip = readVerifiedClip(ctx.app.getPath('userData'), request?.incidentId)
      if (!clip) throw new Error('Verified incident clip was not found.')
      return mutate(() =>
        store.lockIncidentClip(caseId(request?.caseId), trustedStewardActor(), clip))
    }
  )
  ctx.ipcMain.handle(STEWARD_CHANNELS.citeRule, (event, input: StewardRuleCitationInput) => {
    authorize(ctx, event)
    return mutate(() => store.citeRule({ ...input, actor: trustedStewardActor() }))
  })
  ctx.ipcMain.handle(STEWARD_CHANNELS.recordVerdict, async (event, input: StewardVerdictInput) => {
    authorize(ctx, event)
    if (input?.manualReviewConfirmed !== true) {
      throw new Error('Manual evidence provenance review was not confirmed.')
    }
    const confirmation = {
      type: 'warning' as const,
      title: 'Confirm manual evidence review',
      message: 'Confirm that you manually reviewed the selected evidence and its trust limits.',
      detail: 'Local-user sealing detects corruption and renderer tampering, but it does not authenticate app origin or another process under the same Windows user.',
      buttons: ['Confirm manual review', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    }
    const main = ctx.getMainWindow()
    const result = main
      ? await dialog.showMessageBox(main, confirmation)
      : await dialog.showMessageBox(confirmation)
    if (result.response !== 0) throw new Error('Manual evidence provenance review was not confirmed.')
    return mutate(() => store.recordVerdict({ ...input, actor: trustedStewardActor() }))
  })
  ctx.ipcMain.handle(STEWARD_CHANNELS.recordDissent, (event, input: StewardDissentInput) => {
    authorize(ctx, event)
    return mutate(() => store.recordDissent({ ...input, actor: trustedParticipantActor() }))
  })
  ctx.ipcMain.handle(STEWARD_CHANNELS.fileAppeal, (event, input: StewardAppealInput) => {
    authorize(ctx, event)
    return mutate(() => store.fileAppeal({ ...input, actor: trustedParticipantActor() }))
  })
  ctx.ipcMain.handle(STEWARD_CHANNELS.resolveAppeal, (event, input: StewardAppealResolutionInput) => {
    authorize(ctx, event)
    return mutate(() => store.resolveAppeal({ ...input, actor: trustedStewardActor() }))
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
      throw new Error('Steward package is not a supported file or exceeds the 20 MiB framing limit.')
    }
    const outcome = store.importCaseWithResult(await readFile(filePath, 'utf8'))
    changed(outcome.caseValue.caseId)
    return {
      ok: true,
      canceled: false,
      importedCase: outcome.caseValue,
      deduplicated: outcome.deduplicated,
      retried: outcome.retried
    }
  })

  logger.info('steward', 'local Steward Desk registered', {
    integrity: 'unanchored',
    automaticPenalties: false
  })
}
