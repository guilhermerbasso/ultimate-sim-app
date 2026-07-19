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
import { readIncidentClipFromUserData } from './incident-recorder'
import { logger } from './logger'

const MAX_IMPORT_BYTES = STEWARD_PACKAGE_MAX_BYTES + 4 * 1024 * 1024

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
  ctx.ipcMain.handle(
    STEWARD_CHANNELS.getEvidenceDetails,
    (event, request: StewardEvidenceDetailsRequest) => {
      authorize(ctx, event)
      return store.getEvidenceDetails(caseId(request?.caseId), caseId(request?.evidenceId))
    }
  )
  ctx.ipcMain.handle(STEWARD_CHANNELS.createCase, (event, input: StewardCaseCreateInput) => {
    authorize(ctx, event)
    const owner = trustedStewardActor(input)
    if (input?.incident?.source !== 'incident-recorder') {
      return mutate(() => store.createCase({ ...input, actor: owner, assignedTo: owner }))
    }
    const clip = readIncidentClipFromUserData(ctx.app.getPath('userData'), input.incident.sourceId)
    if (!clip?.captureSession) throw new Error('Incident clip lacks a trusted capture-session identity.')
    const captureSession = clip.captureSession
    return mutate(() => store.createCase({
      ...input,
      actor: owner,
      assignedTo: owner,
      identity: {
        ...input.identity,
        sessionId: captureSession.captureSessionId,
        sim: captureSession.sim,
        sessionType: captureSession.sessionType ?? input.identity.sessionType,
        trackName: captureSession.trackName ?? input.identity.trackName,
        startedAt: captureSession.startedAt
      },
      incident: {
        ...input.incident,
        source: 'incident-recorder',
        sourceId: clip.id,
        occurredAt: clip.at,
        ...(clip.lap === undefined ? {} : { lap: clip.lap }),
        ...(clip.lapDistPct === undefined ? {} : { lapDistPct: clip.lapDistPct }),
        captureSessionId: captureSession.captureSessionId
      }
    }))
  })
  ctx.ipcMain.handle(STEWARD_CHANNELS.assignCase, (event, input: StewardCaseAssignmentInput) => {
    authorize(ctx, event)
    const owner = trustedStewardActor(input)
    return mutate(() => store.assignCase({ ...input, actor: owner, assignedTo: owner }))
  })
  ctx.ipcMain.handle(STEWARD_CHANNELS.setStatus, (event, input: StewardCaseStatusInput) => {
    authorize(ctx, event)
    return mutate(() => store.setStatus({ ...input, actor: trustedStewardActor(input) }))
  })
  ctx.ipcMain.handle(STEWARD_CHANNELS.addBookmark, (event, input: StewardBookmarkAddInput) => {
    authorize(ctx, event)
    return mutate(() => store.addBookmark({ ...input, actor: trustedStewardActor(input) }))
  })
  ctx.ipcMain.handle(STEWARD_CHANNELS.lockEvidence, (event, input: StewardEvidenceLockInput) => {
    authorize(ctx, event)
    if (input?.provenance?.sourceKind === 'incident-recorder') {
      throw new Error('Incident clips must be locked through the trusted incident evidence channel.')
    }
    return mutate(() => store.lockEvidence({ ...input, actor: trustedStewardActor(input) }))
  })
  ctx.ipcMain.handle(
    STEWARD_CHANNELS.lockIncidentEvidence,
    (event, request: StewardIncidentEvidenceLockRequest) => {
      authorize(ctx, event)
      const clip = readIncidentClipFromUserData(ctx.app.getPath('userData'), request?.incidentId)
      if (!clip?.captureSession) throw new Error('Incident clip lacks a trusted capture-session identity.')
      return mutate(() =>
        store.lockIncidentClip(caseId(request?.caseId), trustedStewardActor(request), clip))
    }
  )
  ctx.ipcMain.handle(STEWARD_CHANNELS.citeRule, (event, input: StewardRuleCitationInput) => {
    authorize(ctx, event)
    return mutate(() => store.citeRule({ ...input, actor: trustedStewardActor(input) }))
  })
  ctx.ipcMain.handle(STEWARD_CHANNELS.recordVerdict, (event, input: StewardVerdictInput) => {
    authorize(ctx, event)
    return mutate(() => store.recordVerdict({ ...input, actor: trustedStewardActor(input) }))
  })
  ctx.ipcMain.handle(STEWARD_CHANNELS.recordDissent, (event, input: StewardDissentInput) => {
    authorize(ctx, event)
    return mutate(() => store.recordDissent({ ...input, actor: trustedParticipantActor(input) }))
  })
  ctx.ipcMain.handle(STEWARD_CHANNELS.fileAppeal, (event, input: StewardAppealInput) => {
    authorize(ctx, event)
    return mutate(() => store.fileAppeal({ ...input, actor: trustedParticipantActor(input) }))
  })
  ctx.ipcMain.handle(STEWARD_CHANNELS.resolveAppeal, (event, input: StewardAppealResolutionInput) => {
    authorize(ctx, event)
    return mutate(() => store.resolveAppeal({ ...input, actor: trustedStewardActor(input) }))
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
