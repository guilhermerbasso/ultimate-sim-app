import { dialog, type OpenDialogOptions } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  COLLABORATION_CHANNELS,
  COLLABORATION_FILE_EXTENSION,
  type CollaborationCreateInput,
  type CollaborationDeleteInput,
  type CollaborationFileResult,
  type CollaborationMockEditInput,
  type CollaborationMockPeerInput,
  type CollaborationSetInput,
  type CollaborationActor,
  type CollaborationWorkspaceState
} from '../../shared/local-collaboration'
import { LocalCollaborationService } from '../collaboration/service'
import type { ModuleContext } from '../module-context'

const STORE_FILE = 'local-collaboration-v1.json'
const MAX_IMPORT_BYTES = 8 * 1024 * 1024

export interface LocalCollaborationModuleOptions {
  openService?: (filePath: string) => Promise<LocalCollaborationService>
}

export function register(ctx: ModuleContext, options: LocalCollaborationModuleOptions = {}): void {
  let initializationError: string | undefined
  const openService = options.openService ?? ((filePath: string) => LocalCollaborationService.open(filePath))
  const servicePromise = Promise.resolve()
    .then(() => openService(join(ctx.app.getPath('userData'), STORE_FILE)))
    .catch((error: unknown) => {
      initializationError = error instanceof Error ? error.message : String(error)
      return null
    })
  const requireService = async (): Promise<LocalCollaborationService> => {
    const service = await servicePromise
    if (!service) {
      throw new Error(`Local collaboration is unavailable: ${initializationError ?? 'initialization failed'}`)
    }
    return service
  }
  const changed = (state: CollaborationWorkspaceState): CollaborationWorkspaceState => {
    ctx.broadcast(COLLABORATION_CHANNELS.changed, state)
    return state
  }

  ctx.ipcMain.handle(COLLABORATION_CHANNELS.state, async () => {
    const service = await servicePromise
    return service
      ? service.getWorkspaceState()
      : unavailableWorkspaceState(initializationError)
  })
  ctx.ipcMain.handle(COLLABORATION_CHANNELS.getDocument, async (_event, documentId: string) => {
    return (await requireService()).getDocument(documentId)
  })
  ctx.ipcMain.handle(COLLABORATION_CHANNELS.create, async (_event, input: CollaborationCreateInput) => {
    const service = await requireService()
    const document = await service.create(input)
    changed(await service.getWorkspaceState())
    return document
  })
  ctx.ipcMain.handle(COLLABORATION_CHANNELS.set, async (_event, input: CollaborationSetInput) => {
    const service = await requireService()
    const document = await service.set(input)
    changed(await service.getWorkspaceState())
    return document
  })
  ctx.ipcMain.handle(COLLABORATION_CHANNELS.delete, async (_event, input: CollaborationDeleteInput) => {
    const service = await requireService()
    const document = await service.delete(input)
    changed(await service.getWorkspaceState())
    return document
  })
  ctx.ipcMain.handle(COLLABORATION_CHANNELS.setOnline, async (_event, online: boolean) => {
    return changed(await (await requireService()).setOnline(Boolean(online)))
  })
  ctx.ipcMain.handle(COLLABORATION_CHANNELS.addMockPeer, async (_event, input: CollaborationMockPeerInput) => {
    return changed(await (await requireService()).addMockPeer(input))
  })
  ctx.ipcMain.handle(COLLABORATION_CHANNELS.mockEdit, async (_event, input: CollaborationMockEditInput) => {
    return changed(await (await requireService()).mockEdit(input))
  })
  ctx.ipcMain.handle(COLLABORATION_CHANNELS.sync, async () => {
    return changed(await (await requireService()).sync())
  })
  ctx.ipcMain.handle(COLLABORATION_CHANNELS.exportFile, async (): Promise<CollaborationFileResult> => {
    const owner = ctx.getMainWindow()
    const options = {
      title: 'Export collaboration documents',
      defaultPath: `ultimate-sim-collaboration.${COLLABORATION_FILE_EXTENSION}`,
      filters: [
        { name: 'Ultimate Sim collaboration', extensions: [COLLABORATION_FILE_EXTENSION] },
        { name: 'JSON', extensions: ['json'] }
      ]
    }
    const result = owner
      ? await dialog.showSaveDialog(owner, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { canceled: true }
    const service = await requireService()
    const bundle = await service.exportBundle()
    await writeFile(result.filePath, bundle, 'utf8')
    return {
      canceled: false,
      filePath: result.filePath,
      documentCount: (await service.getWorkspaceState()).documents.length
    }
  })
  ctx.ipcMain.handle(COLLABORATION_CHANNELS.importFile, async (): Promise<CollaborationFileResult> => {
    const owner = ctx.getMainWindow()
    const options: OpenDialogOptions = {
      title: 'Import collaboration documents',
      properties: ['openFile'],
      filters: [
        { name: 'Ultimate Sim collaboration', extensions: [COLLABORATION_FILE_EXTENSION, 'json'] }
      ]
    }
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options)
    const filePath = result.filePaths[0]
    if (result.canceled || !filePath) return { canceled: true }
    const payload = await readFile(filePath)
    if (payload.byteLength > MAX_IMPORT_BYTES) {
      throw new Error(`Collaboration import exceeds ${MAX_IMPORT_BYTES} bytes.`)
    }
    const service = await requireService()
    try {
      const state = await service.importBundle(payload.toString('utf8'))
      changed(state)
      return { canceled: false, filePath, documentCount: state.documents.length }
    } catch (error) {
      changed(await service.getWorkspaceState())
      throw error
    }
  })

  ctx.registerGracefulTeardown(async () => {
    const service = await servicePromise
    if (service) await service.flush()
  }, 'persistence')
}

const UNAVAILABLE_ACTOR: CollaborationActor = {
  id: 'collaboration-unavailable',
  displayName: 'Local owner',
  deviceId: 'collaboration-unavailable',
  publicKey: 'unavailable'
}

function unavailableWorkspaceState(error: string | undefined): CollaborationWorkspaceState {
  return {
    status: {
      authority: 'local-primary',
      transport: 'in-memory-mock-only',
      networkEnabled: false,
      online: false,
      localActor: UNAVAILABLE_ACTOR,
      documentCount: 0,
      peerCount: 0,
      pendingChangeCount: 0,
      quarantineCount: 0,
      lastSavedAt: null,
      lastError: `Local collaboration is unavailable: ${error ?? 'initialization failed'}`
    },
    documents: [],
    peers: [],
    quarantine: []
  }
}
