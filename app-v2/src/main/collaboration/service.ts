import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import {
  COLLABORATION_DOCUMENT_KINDS,
  COLLABORATION_VERSION,
  collaborationCapability,
  type CollaborationActor,
  type CollaborationCapability,
  type CollaborationCreateInput,
  type CollaborationDeleteInput,
  type CollaborationDocumentKind,
  type CollaborationDocumentView,
  type CollaborationMockEditInput,
  type CollaborationMockPeerInput,
  type CollaborationPeer,
  type CollaborationSetInput,
  type CollaborationStatus,
  type CollaborationWorkspaceState
} from '../../shared/local-collaboration'
import { InMemoryCollaborationTransport } from './in-memory-transport'
import {
  canonicalStringify,
  hashCanonical,
  LocalCollaborationReplica
} from './replica'

const WORKSPACE_FORMAT = 'ultimate-sim-local-collaboration-workspace' as const
const LOCAL_PEER_ID = 'local-owner'
const DEFAULT_MOCK_PEER_ID = 'mock-crew-editor'

interface StoredWorkspaceBody {
  format: typeof WORKSPACE_FORMAT
  version: typeof COLLABORATION_VERSION
  savedAt: number
  localActor: CollaborationActor
  online: boolean
  bundle: string
}

interface StoredWorkspace extends StoredWorkspaceBody {
  checksum: {
    algorithm: 'sha256'
    value: string
  }
}

export class LocalCollaborationService {
  private readonly replica: LocalCollaborationReplica
  private readonly transport = new InMemoryCollaborationTransport()
  private readonly mockReplicas = new Map<string, LocalCollaborationReplica>()
  private mutationQueue: Promise<void> = Promise.resolve()
  private online: boolean
  private lastSavedAt: number | null
  private lastError?: string

  private constructor(
    private readonly filePath: string,
    localActor: CollaborationActor,
    online: boolean,
    lastSavedAt: number | null,
    lastError?: string
  ) {
    this.replica = new LocalCollaborationReplica(localActor, {
      documentId: () => `doc-${randomUUID()}`
    })
    this.online = online
    this.lastSavedAt = lastSavedAt
    this.lastError = lastError
    this.transport.attach(LOCAL_PEER_ID, this.replica, online)
  }

  static async open(filePath: string): Promise<LocalCollaborationService> {
    let stored: StoredWorkspace | null = null
    let loadError: string | undefined
    try {
      stored = parseStoredWorkspace(await readFile(filePath, 'utf8'))
    } catch (error) {
      if (!isMissingFileError(error)) loadError = errorMessage(error)
    }

    const actor = stored?.localActor ?? {
      id: `actor-${randomUUID()}`,
      displayName: 'Local owner',
      deviceId: `device-${randomUUID()}`
    }
    const service = new LocalCollaborationService(
      filePath,
      actor,
      stored?.online ?? true,
      stored?.savedAt ?? null,
      loadError
    )
    if (stored) {
      try {
        service.replica.importBundle(stored.bundle)
      } catch (error) {
        service.lastError = `Local collaboration store was ignored: ${errorMessage(error)}`
      }
    }
    service.addMockPeerInternal(
      {
        id: DEFAULT_MOCK_PEER_ID,
        actor: {
          id: 'actor-mock-crew-editor',
          displayName: 'Crew mock',
          deviceId: 'memory-crew-editor'
        },
        capabilities: capabilitiesForAccess('editor')
      },
      true
    )
    if (service.online) service.transport.synchronizeAll()
    if (!stored) {
      await service.persist()
      if (loadError) service.lastError = `Recovered corrupt local collaboration workspace: ${loadError}`
    }
    return service
  }

  async getWorkspaceState(): Promise<CollaborationWorkspaceState> {
    await this.mutationQueue
    return {
      status: this.status(),
      documents: this.replica.listDocuments(),
      peers: this.replica.listPeers(),
      quarantine: this.replica.getQuarantine()
    }
  }

  async getDocument(documentId: string): Promise<CollaborationDocumentView> {
    await this.mutationQueue
    return this.replica.getDocument(documentId)
  }

  create(input: CollaborationCreateInput): Promise<CollaborationDocumentView> {
    return this.mutate(async () => {
      const document = this.replica.createDocument({
        kind: input.kind,
        title: input.title,
        createdAt: Date.now()
      })
      this.syncIfOnline()
      await this.persist()
      return this.replica.getDocument(document.id)
    })
  }

  set(input: CollaborationSetInput): Promise<CollaborationDocumentView> {
    return this.mutate(async () => {
      this.replica.setValue(input.documentId, input.path, input.value, input.message)
      this.syncIfOnline()
      await this.persist()
      return this.replica.getDocument(input.documentId)
    })
  }

  delete(input: CollaborationDeleteInput): Promise<CollaborationDocumentView> {
    return this.mutate(async () => {
      this.replica.deleteValue(input.documentId, input.path, input.message)
      this.syncIfOnline()
      await this.persist()
      return this.replica.getDocument(input.documentId)
    })
  }

  setOnline(online: boolean): Promise<CollaborationWorkspaceState> {
    return this.mutate(async () => {
      this.online = Boolean(online)
      this.transport.setOnline(LOCAL_PEER_ID, this.online)
      this.syncIfOnline()
      await this.persist()
      return this.workspaceStateNow()
    })
  }

  addMockPeer(input: CollaborationMockPeerInput): Promise<CollaborationWorkspaceState> {
    return this.mutate(async () => {
      const suffix = randomUUID()
      this.addMockPeerInternal({
        id: `mock-${suffix}`,
        actor: {
          id: `actor-mock-${suffix}`,
          displayName: normalizePeerName(input.displayName),
          deviceId: `memory-${suffix}`
        },
        capabilities: capabilitiesForAccess(input.access)
      }, true)
      this.syncIfOnline()
      await this.persist()
      return this.workspaceStateNow()
    })
  }

  mockEdit(input: CollaborationMockEditInput): Promise<CollaborationWorkspaceState> {
    return this.mutate(async () => {
      const mock = this.mockReplicas.get(input.peerId)
      if (!mock) throw new Error(`Unknown mock peer ${input.peerId}.`)
      const document = this.replica.getDocument(input.documentId)
      const writeCapability = collaborationCapability(document.kind, 'write')
      if (!this.replica.hasPeerCapability(input.peerId, writeCapability)) {
        throw new Error(`Peer ${input.peerId} lacks ${writeCapability}.`)
      }
      if (!mock.getChangeIds().size && this.online) this.transport.synchronize(LOCAL_PEER_ID, input.peerId)
      if (input.operation.type === 'delete') {
        mock.deleteValue(input.documentId, input.operation.path, input.message)
      } else {
        mock.setValue(input.documentId, input.operation.path, input.operation.value, input.message)
      }
      this.syncIfOnline()
      await this.persist()
      return this.workspaceStateNow()
    })
  }

  sync(): Promise<CollaborationWorkspaceState> {
    return this.mutate(async () => {
      if (!this.online) throw new Error('Local collaboration is offline.')
      this.transport.synchronizeAll()
      await this.persist()
      return this.workspaceStateNow()
    })
  }

  async exportBundle(): Promise<string> {
    await this.mutationQueue
    return this.replica.exportBundle()
  }

  importBundle(serialized: string): Promise<CollaborationWorkspaceState> {
    return this.mutate(async () => {
      this.replica.importBundle(serialized)
      this.syncIfOnline()
      await this.persist()
      return this.workspaceStateNow()
    })
  }

  flush(): Promise<void> {
    return this.mutate(async () => this.persist())
  }

  private addMockPeerInternal(
    peer: Omit<CollaborationPeer, 'connected' | 'mock'>,
    mockOnline: boolean
  ): void {
    const existingPeers = this.replica.listPeers()
    this.replica.registerPeer({ ...peer, connected: this.online && mockOnline })
    const mock = new LocalCollaborationReplica(peer.actor, {
      documentId: () => `mock-doc-${randomUUID()}`
    })
    mock.registerPeer({
      id: LOCAL_PEER_ID,
      actor: this.replica.localActor,
      capabilities: ownerCapabilities(),
      connected: this.online && mockOnline
    })
    mock.importBundle(this.replica.exportBundleForPeer(peer.id))
    for (const existingPeer of existingPeers) {
      const existingReplica = this.mockReplicas.get(existingPeer.id)
      if (!existingReplica) continue
      existingReplica.registerPeer({
        id: peer.id,
        actor: peer.actor,
        capabilities: peer.capabilities,
        connected: this.online && mockOnline
      })
      mock.registerPeer({
        id: existingPeer.id,
        actor: existingPeer.actor,
        capabilities: existingPeer.capabilities,
        connected: this.online && existingPeer.connected
      })
    }
    this.mockReplicas.set(peer.id, mock)
    this.transport.attach(peer.id, mock, mockOnline)
    this.transport.setOnline(peer.id, mockOnline)
  }

  private syncIfOnline(): void {
    if (this.online) this.transport.synchronizeAll()
  }

  private status(): CollaborationStatus {
    return {
      authority: 'local-primary',
      transport: 'in-memory-mock-only',
      networkEnabled: false,
      online: this.online,
      localActor: { ...this.replica.localActor },
      documentCount: this.replica.listDocuments().length,
      peerCount: this.replica.listPeers().length,
      pendingChangeCount: this.transport.pendingChangeCount(LOCAL_PEER_ID),
      quarantineCount: this.replica.getQuarantine().length,
      lastSavedAt: this.lastSavedAt,
      ...(this.lastError ? { lastError: this.lastError } : {})
    }
  }

  private workspaceStateNow(): CollaborationWorkspaceState {
    return {
      status: this.status(),
      documents: this.replica.listDocuments(),
      peers: this.replica.listPeers(),
      quarantine: this.replica.getQuarantine()
    }
  }

  private async persist(): Promise<void> {
    const savedAt = Date.now()
    const body: StoredWorkspaceBody = {
      format: WORKSPACE_FORMAT,
      version: COLLABORATION_VERSION,
      savedAt,
      localActor: { ...this.replica.localActor },
      online: this.online,
      bundle: this.replica.exportBundle()
    }
    const stored: StoredWorkspace = {
      ...body,
      checksum: { algorithm: 'sha256', value: hashCanonical(body) }
    }
    const temporaryPath = `${this.filePath}.${randomUUID()}.next`
    try {
      await mkdir(dirname(this.filePath), { recursive: true })
      await writeFile(temporaryPath, `${canonicalStringify(stored)}\n`, 'utf8')
      await rename(temporaryPath, this.filePath)
      this.lastSavedAt = savedAt
      this.lastError = undefined
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => {})
      this.lastError = `Local collaboration save failed: ${errorMessage(error)}`
      throw error
    }
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation)
    this.mutationQueue = result.then(() => undefined, () => undefined)
    return result
  }
}

function parseStoredWorkspace(serialized: string): StoredWorkspace {
  const parsed = JSON.parse(serialized) as unknown
  if (!isRecord(parsed) || parsed.format !== WORKSPACE_FORMAT || parsed.version !== COLLABORATION_VERSION) {
    throw new Error('Unsupported local collaboration workspace.')
  }
  if (
    typeof parsed.savedAt !== 'number' ||
    !Number.isSafeInteger(parsed.savedAt) ||
    !isRecord(parsed.localActor) ||
    !validStoredActor(parsed.localActor) ||
    typeof parsed.online !== 'boolean' ||
    typeof parsed.bundle !== 'string' ||
    !isRecord(parsed.checksum) ||
    parsed.checksum.algorithm !== 'sha256' ||
    typeof parsed.checksum.value !== 'string'
  ) {
    throw new Error('Malformed local collaboration workspace.')
  }
  const body: StoredWorkspaceBody = {
    format: WORKSPACE_FORMAT,
    version: COLLABORATION_VERSION,
    savedAt: parsed.savedAt,
    localActor: parsed.localActor as unknown as CollaborationActor,
    online: parsed.online,
    bundle: parsed.bundle
  }
  if (hashCanonical(body) !== parsed.checksum.value) {
    throw new Error('Local collaboration workspace checksum mismatch.')
  }
  return { ...body, checksum: { algorithm: 'sha256', value: parsed.checksum.value } }
}

function validStoredActor(value: Record<string, unknown>): boolean {
  return (
    typeof value.id === 'string' &&
    /^[A-Za-z0-9._-]{1,128}$/.test(value.id) &&
    typeof value.displayName === 'string' &&
    value.displayName.trim().length > 0 &&
    value.displayName.length <= 80 &&
    typeof value.deviceId === 'string' &&
    /^[A-Za-z0-9._-]{1,128}$/.test(value.deviceId)
  )
}

function capabilitiesForAccess(access: 'viewer' | 'editor'): CollaborationCapability[] {
  const capabilities = COLLABORATION_DOCUMENT_KINDS.map((kind) => collaborationCapability(kind, 'read'))
  if (access === 'editor') {
    capabilities.push(...COLLABORATION_DOCUMENT_KINDS.map((kind) => collaborationCapability(kind, 'write')))
  }
  return capabilities
}

function ownerCapabilities(): CollaborationCapability[] {
  return [
    ...COLLABORATION_DOCUMENT_KINDS.flatMap((kind) => [
      collaborationCapability(kind, 'read'),
      collaborationCapability(kind, 'write')
    ]),
    'document:export',
    'document:import',
    'peer:manage'
  ]
}

function normalizePeerName(value: string): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized || normalized.length > 80) throw new Error('Peer name must be 1-80 characters.')
  return normalized
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
