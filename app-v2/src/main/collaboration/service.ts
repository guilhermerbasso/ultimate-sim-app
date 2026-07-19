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
import {
  InMemoryCollaborationTransport,
  type InMemoryCollaborationTransportState
} from './in-memory-transport'
import {
  canonicalStringify,
  createCollaborationSigningIdentity,
  hashCanonical,
  LocalCollaborationReplica,
  type CollaborationReplicaState
} from './replica'

const WORKSPACE_FORMAT = 'ultimate-sim-local-collaboration-workspace' as const
const LOCAL_PEER_ID = 'local-owner'
const MAX_STORED_WORKSPACE_BYTES = 16 * 1024 * 1024

interface CollaborationPersistence {
  readText(path: string): Promise<string>
  ensureDirectory(path: string): Promise<void>
  writeText(path: string, value: string): Promise<void>
  replace(from: string, to: string): Promise<void>
  remove(path: string): Promise<void>
}

export interface LocalCollaborationServiceOptions {
  persistence?: Partial<CollaborationPersistence>
  maxPersistedBytes?: number
}

interface StoredWorkspaceBody {
  format: typeof WORKSPACE_FORMAT
  version: typeof COLLABORATION_VERSION
  savedAt: number
  localActor: CollaborationActor
  localPrivateKey: string
  online: boolean
  bundle: string
}

interface StoredWorkspace extends StoredWorkspaceBody {
  checksum: {
    algorithm: 'sha256'
    value: string
  }
}

interface ServiceRuntimeSnapshot {
  replica: CollaborationReplicaState
  mockReplicas: Map<string, { replica: LocalCollaborationReplica; state: CollaborationReplicaState }>
  transport: InMemoryCollaborationTransportState
  online: boolean
  lastSavedAt: number | null
  lastError?: string
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
    private readonly localPrivateKey: string,
    online: boolean,
    lastSavedAt: number | null,
    private readonly persistence: CollaborationPersistence,
    private readonly maxPersistedBytes: number,
    lastError?: string
  ) {
    this.replica = new LocalCollaborationReplica(localActor, {
      privateKey: localPrivateKey,
      documentId: () => `doc-${randomUUID()}`
    })
    this.online = online
    this.lastSavedAt = lastSavedAt
    this.lastError = lastError
    this.transport.attach(LOCAL_PEER_ID, this.replica, online)
  }

  static async open(
    filePath: string,
    options: LocalCollaborationServiceOptions = {}
  ): Promise<LocalCollaborationService> {
    const persistence = collaborationPersistence(options.persistence)
    const maxPersistedBytes = normalizePersistedLimit(options.maxPersistedBytes)
    let stored: StoredWorkspace | null = null
    let loadError: string | undefined
    try {
      stored = parseStoredWorkspace(await persistence.readText(filePath), maxPersistedBytes)
    } catch (error) {
      if (!isMissingFileError(error)) loadError = errorMessage(error)
    }

    let identity = stored
      ? { actor: stored.localActor, privateKey: stored.localPrivateKey }
      : createCollaborationSigningIdentity({
          id: `actor-${randomUUID()}`,
          displayName: 'Local owner',
          deviceId: `device-${randomUUID()}`
        })
    let service: LocalCollaborationService
    try {
      service = new LocalCollaborationService(
        filePath,
        identity.actor,
        identity.privateKey,
        stored?.online ?? true,
        stored?.savedAt ?? null,
        persistence,
        maxPersistedBytes,
        loadError
      )
    } catch (error) {
      if (!stored) throw error
      loadError = errorMessage(error)
      stored = null
      identity = createCollaborationSigningIdentity({
        id: `actor-${randomUUID()}`,
        displayName: 'Local owner',
        deviceId: `device-${randomUUID()}`
      })
      service = new LocalCollaborationService(
        filePath,
        identity.actor,
        identity.privateKey,
        true,
        null,
        persistence,
        maxPersistedBytes,
        loadError
      )
    }
    if (stored) {
      try {
        service.replica.importBundle(stored.bundle)
      } catch (error) {
        service.lastError = `Local collaboration store was ignored: ${errorMessage(error)}`
      }
    }
    const defaultMockSuffix = randomUUID()
    const defaultMockIdentity = createCollaborationSigningIdentity({
      id: `actor-mock-crew-editor-${defaultMockSuffix}`,
      displayName: 'Crew mock',
      deviceId: `memory-crew-editor-${defaultMockSuffix}`
    })
    service.addMockPeerInternal({
      id: `mock-crew-editor-${defaultMockSuffix}`,
      actor: defaultMockIdentity.actor,
      privateKey: defaultMockIdentity.privateKey,
      capabilities: capabilitiesForAccess('editor')
    }, true)
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
    let documentId = ''
    return this.mutateDurably(() => {
      const document = this.replica.createDocument({
        kind: input.kind,
        title: input.title,
        createdAt: Date.now()
      })
      documentId = document.id
      this.syncIfOnline()
    }, () => this.replica.getDocument(documentId))
  }

  set(input: CollaborationSetInput): Promise<CollaborationDocumentView> {
    return this.mutateDurably(() => {
      this.replica.setValue(input.documentId, input.path, input.value, input.message)
      this.syncIfOnline()
    }, () => this.replica.getDocument(input.documentId))
  }

  delete(input: CollaborationDeleteInput): Promise<CollaborationDocumentView> {
    return this.mutateDurably(() => {
      this.replica.deleteValue(input.documentId, input.path, input.message)
      this.syncIfOnline()
    }, () => this.replica.getDocument(input.documentId))
  }

  setOnline(online: boolean): Promise<CollaborationWorkspaceState> {
    return this.mutateDurably(() => {
      this.online = Boolean(online)
      this.transport.setOnline(LOCAL_PEER_ID, this.online)
      this.syncIfOnline()
    }, () => this.workspaceStateNow())
  }

  addMockPeer(input: CollaborationMockPeerInput): Promise<CollaborationWorkspaceState> {
    return this.mutateDurably(() => {
      const suffix = randomUUID()
      const identity = createCollaborationSigningIdentity({
        id: `actor-mock-${suffix}`,
        displayName: normalizePeerName(input.displayName),
        deviceId: `memory-${suffix}`
      })
      this.addMockPeerInternal({
        id: `mock-${suffix}`,
        actor: identity.actor,
        privateKey: identity.privateKey,
        capabilities: capabilitiesForAccess(input.access)
      }, true)
      this.syncIfOnline()
    }, () => this.workspaceStateNow())
  }

  mockEdit(input: CollaborationMockEditInput): Promise<CollaborationWorkspaceState> {
    return this.mutateDurably(() => {
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
    }, () => this.workspaceStateNow())
  }

  sync(): Promise<CollaborationWorkspaceState> {
    return this.mutateDurably(() => {
      if (!this.online) throw new Error('Local collaboration is offline.')
      this.transport.synchronizeAll()
    }, () => this.workspaceStateNow())
  }

  async exportBundle(): Promise<string> {
    await this.mutationQueue
    return this.replica.exportBundle()
  }

  importBundle(serialized: string): Promise<CollaborationWorkspaceState> {
    return this.mutateDurably(() => {
      this.replica.importBundle(serialized)
      this.syncIfOnline()
    }, () => this.workspaceStateNow())
  }

  flush(): Promise<void> {
    return this.mutate(async () => this.persist())
  }

  private addMockPeerInternal(
    peer: Omit<CollaborationPeer, 'connected' | 'mock'> & { privateKey: string },
    mockOnline: boolean
  ): void {
    const existingPeers = this.replica.listPeers()
    const { privateKey, ...descriptor } = peer
    this.replica.registerPeer({ ...descriptor, connected: this.online && mockOnline })
    const mock = new LocalCollaborationReplica(peer.actor, {
      privateKey,
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
    const temporaryPath = `${this.filePath}.${randomUUID()}.next`
    try {
      const savedAt = Date.now()
      const body: StoredWorkspaceBody = {
        format: WORKSPACE_FORMAT,
        version: COLLABORATION_VERSION,
        savedAt,
        localActor: { ...this.replica.localActor },
        localPrivateKey: this.localPrivateKey,
        online: this.online,
        bundle: this.replica.exportBundle()
      }
      const stored: StoredWorkspace = {
        ...body,
        checksum: { algorithm: 'sha256', value: hashCanonical(body) }
      }
      const serialized = `${canonicalStringify(stored)}\n`
      assertPersistedSize(serialized, this.maxPersistedBytes)
      await this.persistence.ensureDirectory(dirname(this.filePath))
      await this.persistence.writeText(temporaryPath, serialized)
      await this.persistence.replace(temporaryPath, this.filePath)
      this.lastSavedAt = savedAt
      this.lastError = undefined
    } catch (error) {
      await this.persistence.remove(temporaryPath).catch(() => {})
      this.lastError = `Local collaboration save failed: ${errorMessage(error)}`
      throw error
    }
  }

  private mutateDurably<T>(
    operation: () => void | Promise<void>,
    result: () => T
  ): Promise<T> {
    return this.mutate(async () => {
      const snapshot = this.captureRuntimeState()
      try {
        await operation()
        await this.persist()
      } catch (error) {
        const failureError = this.lastError
        this.restoreRuntimeState(snapshot)
        if (failureError !== snapshot.lastError) this.lastError = failureError
        throw error
      }
      return result()
    })
  }

  private captureRuntimeState(): ServiceRuntimeSnapshot {
    return {
      replica: this.replica.captureState(),
      mockReplicas: new Map(
        [...this.mockReplicas].map(([id, replica]) => [
          id,
          { replica, state: replica.captureState() }
        ])
      ),
      transport: this.transport.captureState(),
      online: this.online,
      lastSavedAt: this.lastSavedAt,
      lastError: this.lastError
    }
  }

  private restoreRuntimeState(snapshot: ServiceRuntimeSnapshot): void {
    this.replica.restoreState(snapshot.replica)
    this.mockReplicas.clear()
    for (const [id, item] of snapshot.mockReplicas) {
      item.replica.restoreState(item.state)
      this.mockReplicas.set(id, item.replica)
    }
    this.transport.restoreState(snapshot.transport)
    this.online = snapshot.online
    this.lastSavedAt = snapshot.lastSavedAt
    this.lastError = snapshot.lastError
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation)
    this.mutationQueue = result.then(() => undefined, () => undefined)
    return result
  }
}

function parseStoredWorkspace(serialized: string, maxPersistedBytes: number): StoredWorkspace {
  assertPersistedSize(serialized, maxPersistedBytes)
  const parsed = JSON.parse(serialized) as unknown
  if (!isRecord(parsed) || parsed.format !== WORKSPACE_FORMAT || parsed.version !== COLLABORATION_VERSION) {
    throw new Error('Unsupported local collaboration workspace.')
  }
  if (
    typeof parsed.savedAt !== 'number' ||
    !Number.isSafeInteger(parsed.savedAt) ||
    !isRecord(parsed.localActor) ||
    !validStoredActor(parsed.localActor) ||
    typeof parsed.localPrivateKey !== 'string' ||
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
    localPrivateKey: parsed.localPrivateKey,
    online: parsed.online,
    bundle: parsed.bundle
  }
  if (hashCanonical(body) !== parsed.checksum.value) {
    throw new Error('Local collaboration workspace checksum mismatch.')
  }
  const normalized: StoredWorkspace = {
    ...body,
    checksum: { algorithm: 'sha256', value: parsed.checksum.value }
  }
  assertPersistedSize(`${canonicalStringify(normalized)}\n`, maxPersistedBytes)
  return normalized
}

function validStoredActor(value: Record<string, unknown>): boolean {
  return (
    typeof value.id === 'string' &&
    /^[A-Za-z0-9._-]{1,128}$/.test(value.id) &&
    typeof value.displayName === 'string' &&
    value.displayName.trim().length > 0 &&
    value.displayName.length <= 80 &&
    typeof value.deviceId === 'string' &&
    /^[A-Za-z0-9._-]{1,128}$/.test(value.deviceId) &&
    typeof value.publicKey === 'string' &&
    value.publicKey.length > 0 &&
    value.publicKey.length <= 512
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

function collaborationPersistence(overrides: Partial<CollaborationPersistence> = {}): CollaborationPersistence {
  return {
    readText: overrides.readText ?? ((path) => readFile(path, 'utf8')),
    ensureDirectory: overrides.ensureDirectory ?? (async (path) => {
      await mkdir(path, { recursive: true })
    }),
    writeText: overrides.writeText ?? (async (path, value) => {
      await writeFile(path, value, 'utf8')
    }),
    replace: overrides.replace ?? ((from, to) => rename(from, to)),
    remove: overrides.remove ?? (async (path) => {
      await rm(path, { force: true })
    })
  }
}

function normalizePersistedLimit(value: number | undefined): number {
  if (value === undefined) return MAX_STORED_WORKSPACE_BYTES
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Persisted collaboration size limit must be positive.')
  return value
}

function assertPersistedSize(serialized: string, maximum: number): void {
  if (Buffer.byteLength(serialized, 'utf8') > maximum) {
    throw new Error(`Local collaboration workspace exceeds ${maximum} bytes after serialization.`)
  }
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
