import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject
} from 'node:crypto'

import {
  COLLABORATION_DOCUMENT_KINDS,
  COLLABORATION_FORMAT,
  COLLABORATION_VERSION,
  collaborationCapability,
  collaborationTitlePath,
  type CollaborationActor,
  type CollaborationCapability,
  type CollaborationChange,
  type CollaborationChangeBody,
  type CollaborationConflict,
  type CollaborationDocumentKind,
  type CollaborationDocumentSummary,
  type CollaborationDocumentView,
  type CollaborationExportBody,
  type CollaborationExportBundle,
  type CollaborationJson,
  type CollaborationOperation,
  type CollaborationPeer,
  type CollaborationQuarantineEntry,
  type CollaborationSerializedDocument
} from '../../shared/local-collaboration'

const MAX_DOCUMENTS = 500
const MAX_CHANGES_PER_DOCUMENT = 10_000
const MAX_VALUE_BYTES = 256 * 1024
const MAX_BUNDLE_BYTES = 8 * 1024 * 1024
const MAX_QUARANTINE_ENTRIES = 100
const MAX_JSON_DEPTH = 20
const MAX_JSON_NODES = 100_000
const MAX_CANONICAL_DEPTH = 64
const MAX_CANONICAL_NODES = 1_000_000
const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9._-]{1,128}$/
const DOCUMENT_KIND_SET = new Set<string>(COLLABORATION_DOCUMENT_KINDS)
const PROTOTYPE_RELATED_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

const FORBIDDEN_KEYS = new Set([
  'telemetry',
  'telemetryframe',
  'telemetryframes',
  'telemetrychunk',
  'telemetrychunks',
  'rawtelemetry',
  'secret',
  'secrets',
  'credential',
  'credentials',
  'password',
  'token',
  'tokens',
  'accesstoken',
  'refreshtoken',
  'oauth',
  'apikey',
  'streamkey',
  'webhookurl',
  'privatekey',
  'command',
  'commands',
  'devicecommand',
  'devicecontrol',
  'deviceid',
  'devicepath',
  'serialport',
  'displayid',
  'machineconfig',
  'machinesettings',
  'devicesettings',
  'samples',
  'frames',
  'chunks',
  'biometric',
  'biometrics',
  'rawvoice',
  'voiceraw'
])

const TELEMETRY_SIGNAL_KEYS = new Set([
  'speedkmh',
  'rpm',
  'gear',
  'throttle',
  'brake',
  'steer',
  'steerangledeg',
  'lapdistpct',
  'fuelliters',
  'currentlaptimesec'
])

interface DocumentState {
  id: string
  kind: CollaborationDocumentKind
  createdAt: number
  changes: Map<string, CollaborationChange>
}

interface ReplicaSnapshot {
  actors: Map<string, CollaborationActor>
  documents: Map<string, DocumentState>
}

export interface CollaborationReplicaState extends ReplicaSnapshot {
  peers: Map<string, CollaborationPeer>
  quarantineEntries: CollaborationQuarantineEntry[]
}

export interface CollaborationMergeResult {
  accepted: number
  replayed: number
}

export interface CollaborationReplicaOptions {
  privateKey: string
  now?: () => number
  documentId?: () => string
}

export interface CollaborationSigningIdentity {
  actor: CollaborationActor
  privateKey: string
}

export class CollaborationValidationError extends Error {
  constructor(
    message: string,
    readonly documentId?: string,
    readonly changeId?: string
  ) {
    super(message)
    this.name = 'CollaborationValidationError'
  }
}

export function createCollaborationSigningIdentity(
  actor: Omit<CollaborationActor, 'publicKey'>
): CollaborationSigningIdentity {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  return {
    actor: validateActor({
      ...actor,
      publicKey: exportPublicKey(publicKey)
    }),
    privateKey: exportPrivateKey(privateKey)
  }
}

export class LocalCollaborationReplica {
  private readonly localIdentity: CollaborationActor
  private readonly signingPrivateKey: KeyObject
  private readonly now: () => number
  private readonly documentId: () => string
  private actors = new Map<string, CollaborationActor>()
  private documents = new Map<string, DocumentState>()
  private readonly peers = new Map<string, CollaborationPeer>()
  private readonly quarantineEntries: CollaborationQuarantineEntry[] = []

  constructor(localActor: CollaborationActor, options: CollaborationReplicaOptions) {
    this.localIdentity = validateActor(localActor)
    this.signingPrivateKey = validateSigningPrivateKey(options.privateKey, this.localIdentity.publicKey)
    this.now = options.now ?? (() => Date.now())
    this.documentId = options.documentId ?? (() => cryptoSafeDocumentId(this.localIdentity.id, this.now()))
    this.actors.set(this.localIdentity.id, this.localIdentity)
  }

  get localActor(): CollaborationActor {
    return cloneActor(this.localIdentity)
  }

  registerPeer(peer: Omit<CollaborationPeer, 'connected' | 'mock'> & Partial<Pick<CollaborationPeer, 'connected'>>): CollaborationPeer {
    assertSafeId(peer.id, 'Peer id')
    if (this.peers.has(peer.id)) {
      throw new CollaborationValidationError(`Peer ${peer.id} is already registered.`)
    }
    const actor = validateActor(peer.actor)
    if (actor.id === this.localActor.id) {
      throw new CollaborationValidationError('A peer cannot reuse the local actor identity.')
    }
    const existingActor = this.actors.get(actor.id)
    if (existingActor && !sameActor(existingActor, actor)) {
      throw new CollaborationValidationError(`Actor identity ${actor.id} conflicts with existing authorship.`)
    }
    const actorPeer = [...this.peers.values()].find((entry) => entry.actor.id === actor.id && entry.id !== peer.id)
    if (actorPeer) {
      throw new CollaborationValidationError(`Actor ${actor.id} is already bound to peer ${actorPeer.id}.`)
    }
    const capabilities = normalizeCapabilities(peer.capabilities)
    const next: CollaborationPeer = {
      id: peer.id,
      actor,
      capabilities,
      connected: peer.connected ?? false,
      mock: true
    }
    this.actors.set(actor.id, actor)
    this.peers.set(next.id, next)
    return clonePeer(next)
  }

  setPeerConnected(peerId: string, connected: boolean): void {
    const peer = this.requirePeer(peerId)
    peer.connected = connected
  }

  listPeers(): CollaborationPeer[] {
    return [...this.peers.values()].map(clonePeer).sort((left, right) => compareText(left.id, right.id))
  }

  hasPeerCapability(peerId: string, capability: CollaborationCapability): boolean {
    return this.requirePeer(peerId).capabilities.includes(capability)
  }

  createDocument(input: {
    kind: CollaborationDocumentKind
    title: string
    id?: string
    createdAt?: number
  }): CollaborationDocumentView {
    const kind = validateKind(input.kind)
    const id = input.id ?? this.documentId()
    assertSafeId(id, 'Document id')
    if (this.documents.has(id)) {
      throw new CollaborationValidationError(`Document ${id} already exists.`, id)
    }
    if (this.documents.size >= MAX_DOCUMENTS) {
      throw new CollaborationValidationError(`Document limit of ${MAX_DOCUMENTS} reached.`)
    }
    const createdAt = validateTimestamp(input.createdAt ?? this.now(), 'Document createdAt')
    const state: DocumentState = { id, kind, createdAt, changes: new Map() }
    this.documents.set(id, state)
    try {
      this.applyLocalChange(id, {
        type: 'set',
        path: collaborationTitlePath(kind),
        value: validateTitle(input.title)
      }, 'Created local-primary document', createdAt)
    } catch (error) {
      this.documents.delete(id)
      throw error
    }
    return this.getDocument(id)
  }

  setValue(
    documentId: string,
    path: string,
    value: CollaborationJson,
    message?: string,
    createdAt?: number
  ): CollaborationDocumentView {
    this.applyLocalChange(documentId, { type: 'set', path, value }, message, createdAt)
    return this.getDocument(documentId)
  }

  deleteValue(
    documentId: string,
    path: string,
    message?: string,
    createdAt?: number
  ): CollaborationDocumentView {
    this.applyLocalChange(documentId, { type: 'delete', path }, message, createdAt)
    return this.getDocument(documentId)
  }

  applyLocalChange(
    documentId: string,
    operation: CollaborationOperation,
    message?: string,
    createdAt = this.now()
  ): CollaborationChange {
    const document = this.requireDocument(documentId)
    const normalizedOperation = validateOperation(document.kind, operation)
    const normalizedMessage = normalizeMessage(message)
    const sequence = nextSequence(document, this.localActor.id)
    const parents = documentHeads(document)
    const lamport = nextLamport(document.changes, parents, document.id)
    const body: CollaborationChangeBody = {
      version: COLLABORATION_VERSION,
      documentId,
      kind: document.kind,
      author: this.localActor,
      sequence,
      lamport,
      parents,
      createdAt: validateTimestamp(createdAt, 'Change createdAt'),
      operation: normalizedOperation,
      ...(normalizedMessage ? { message: normalizedMessage } : {})
    }
    const change = signChangeBody(body, this.signingPrivateKey)
    this.validateAndAddChanges(document, [change], { trustedImport: true })
    return cloneChange(change)
  }

  getDocument(documentId: string): CollaborationDocumentView {
    return materializeDocument(this.requireDocument(documentId))
  }

  listDocuments(): CollaborationDocumentSummary[] {
    return [...this.documents.values()]
      .map((document) => {
        const view = materializeDocument(document)
        return {
          id: view.id,
          kind: view.kind,
          title: view.title,
          revision: view.revision,
          changeCount: view.changeCount,
          conflictCount: view.conflicts.length,
          updatedAt: view.history[0]?.createdAt ?? view.createdAt
        }
      })
      .sort((left, right) => right.updatedAt - left.updatedAt || compareText(left.id, right.id))
  }

  getChangeIds(): Set<string> {
    return new Set(
      [...this.documents.values()].flatMap((document) => [...document.changes.keys()])
    )
  }

  getQuarantine(): CollaborationQuarantineEntry[] {
    return this.quarantineEntries.map((entry) => ({ ...entry }))
  }

  captureState(): CollaborationReplicaState {
    const snapshot = this.captureSnapshot()
    return {
      ...snapshot,
      peers: new Map([...this.peers].map(([id, peer]) => [id, clonePeer(peer)])),
      quarantineEntries: this.getQuarantine()
    }
  }

  restoreState(snapshot: CollaborationReplicaState): void {
    this.restoreSnapshot({
      actors: new Map([...snapshot.actors].map(([id, actor]) => [id, cloneActor(actor)])),
      documents: cloneDocuments(snapshot.documents)
    })
    this.peers.clear()
    for (const [id, peer] of snapshot.peers) this.peers.set(id, clonePeer(peer))
    this.quarantineEntries.splice(0, this.quarantineEntries.length, ...snapshot.quarantineEntries.map((entry) => ({ ...entry })))
  }

  exportBundle(documentIds?: readonly string[]): string {
    return serializeBundle(this.buildExportBody(documentIds))
  }

  exportBundleForPeer(peerId: string): string {
    const peer = this.requirePeer(peerId)
    const readableIds = [...this.documents.values()]
      .filter((document) => peer.capabilities.includes(collaborationCapability(document.kind, 'read')))
      .map((document) => document.id)
    return this.exportBundle(readableIds)
  }

  importBundle(serialized: string): CollaborationMergeResult {
    return this.mergeSerialized(serialized, { trustedImport: true })
  }

  mergeBundleFromPeer(peerId: string, serialized: string): CollaborationMergeResult {
    const peer = this.requirePeer(peerId)
    return this.mergeSerialized(serialized, { peer })
  }

  private buildExportBody(documentIds?: readonly string[]): CollaborationExportBody {
    const requested = documentIds ? new Set(documentIds) : null
    if (requested) {
      for (const id of requested) this.requireDocument(id)
    }
    const documents = [...this.documents.values()]
      .filter((document) => !requested || requested.has(document.id))
      .sort((left, right) => compareText(left.id, right.id))
      .map(serializeDocument)
    const authorIds = new Set(
      documents.flatMap((document) => document.changes.map((change) => change.author.id))
    )
    const actors = [...this.actors.values()]
      .filter((actor) => authorIds.has(actor.id))
      .map(cloneActor)
      .sort((left, right) => compareText(left.id, right.id))
    return {
      format: COLLABORATION_FORMAT,
      version: COLLABORATION_VERSION,
      actors,
      documents
    }
  }

  private mergeSerialized(
    serialized: string,
    source: { trustedImport: true } | { peer: CollaborationPeer }
  ): CollaborationMergeResult {
    const sourcePeerId = 'peer' in source ? source.peer.id : undefined
    let parsed: CollaborationExportBundle
    try {
      parsed = parseBundle(serialized)
    } catch (error) {
      this.quarantine(errorMessage(error), { sourcePeerId })
      throw error
    }

    const snapshot = this.captureSnapshot()
    let accepted = 0
    let replayed = 0
    try {
      const manifest = new Map<string, CollaborationActor>()
      for (const actorInput of parsed.actors) {
        const actor = validateActor(actorInput)
        if (manifest.has(actor.id)) {
          throw new CollaborationValidationError(`Actor manifest repeats ${actor.id}.`)
        }
        manifest.set(actor.id, actor)
      }
      if ('trustedImport' in source) {
        for (const actor of manifest.values()) this.bindActor(actor)
      }
      const documentIds = new Set<string>()
      for (const serializedDocument of parsed.documents) {
        if (documentIds.has(serializedDocument.id)) {
          throw new CollaborationValidationError(
            `Collaboration bundle repeats document ${serializedDocument.id}.`,
            serializedDocument.id
          )
        }
        documentIds.add(serializedDocument.id)
        const result = this.mergeDocument(serializedDocument, source, manifest)
        accepted += result.accepted
        replayed += result.replayed
      }
      return { accepted, replayed }
    } catch (error) {
      this.restoreSnapshot(snapshot)
      const validation = error instanceof CollaborationValidationError ? error : undefined
      this.quarantine(errorMessage(error), {
        sourcePeerId,
        documentId: validation?.documentId,
        changeId: validation?.changeId
      })
      throw error
    }
  }

  private mergeDocument(
    serialized: CollaborationSerializedDocument,
    source: { trustedImport: true } | { peer: CollaborationPeer },
    manifest: Map<string, CollaborationActor>
  ): CollaborationMergeResult {
    validateSerializedDocumentHeader(serialized)
    let document = this.documents.get(serialized.id)
    if (document && document.kind !== serialized.kind) {
      throw new CollaborationValidationError(
        `Document ${serialized.id} changed kind from ${document.kind} to ${serialized.kind}.`,
        serialized.id
      )
    }
    if (document && document.createdAt !== serialized.createdAt) {
      throw new CollaborationValidationError(
        `Document ${serialized.id} changed its creation metadata.`,
        serialized.id
      )
    }
    if (!document) {
      if (this.documents.size >= MAX_DOCUMENTS) {
        throw new CollaborationValidationError(`Document limit of ${MAX_DOCUMENTS} reached.`)
      }
      document = {
        id: serialized.id,
        kind: serialized.kind,
        createdAt: serialized.createdAt,
        changes: new Map()
      }
      this.documents.set(document.id, document)
    }

    const newChanges = serialized.changes.filter((change) => {
      const existing = document?.changes.get(change.id)
      if (!existing) return true
      if (canonicalStringify(existing) !== canonicalStringify(change)) {
        throw new CollaborationValidationError(
          `Change ${change.id} replayed with different bytes.`,
          serialized.id,
          change.id
        )
      }
      return false
    })
    if ('peer' in source && newChanges.length > 0) {
      const capability = collaborationCapability(serialized.kind, 'write')
      if (!source.peer.capabilities.includes(capability)) {
        throw new CollaborationValidationError(
          `Peer ${source.peer.id} lacks ${capability}.`,
          serialized.id
        )
      }
    }

    for (const change of newChanges) {
      const manifestActor = manifest.get(change.author.id)
      if (!manifestActor || !sameActor(manifestActor, change.author)) {
        throw new CollaborationValidationError(
          `Change ${change.id} author is missing or conflicts with the actor manifest.`,
          serialized.id,
          change.id
        )
      }
      const knownActor = this.actors.get(change.author.id)
      if (knownActor && !sameActor(knownActor, change.author)) {
        throw new CollaborationValidationError(
          `Change ${change.id} conflicts with known author ${change.author.id}.`,
          serialized.id,
          change.id
        )
      }
      if (!knownActor && 'peer' in source && !sameActor(source.peer.actor, change.author)) {
        throw new CollaborationValidationError(
          `Peer ${source.peer.id} cannot introduce author ${change.author.id}.`,
          serialized.id,
          change.id
        )
      }
      this.bindActor(change.author)
    }

    this.validateAndAddChanges(document, newChanges, source)
    return {
      accepted: newChanges.length,
      replayed: serialized.changes.length - newChanges.length
    }
  }

  private validateAndAddChanges(
    document: DocumentState,
    changes: CollaborationChange[],
    source: { trustedImport: true } | { peer: CollaborationPeer }
  ): void {
    if (document.changes.size + changes.length > MAX_CHANGES_PER_DOCUMENT) {
      throw new CollaborationValidationError(
        `Document ${document.id} exceeds ${MAX_CHANGES_PER_DOCUMENT} changes.`,
        document.id
      )
    }

    const combined = new Map(document.changes)
    const counters = new Map<string, string>()
    for (const current of combined.values()) counters.set(counterKey(current), current.id)

    for (const rawChange of changes) {
      const change = validateChange(rawChange, document)
      if ('peer' in source) {
        const known = this.actors.get(change.author.id)
        if (!known || !sameActor(known, change.author)) {
          throw new CollaborationValidationError(
            `Unknown author ${change.author.id}.`,
            document.id,
            change.id
          )
        }
      }
      const existingByCounter = counters.get(counterKey(change))
      if (existingByCounter && existingByCounter !== change.id) {
        throw new CollaborationValidationError(
          `Author ${change.author.id} sequence ${change.sequence} was reused.`,
          document.id,
          change.id
        )
      }
      if (combined.has(change.id)) {
        throw new CollaborationValidationError(`Duplicate change ${change.id}.`, document.id, change.id)
      }
      combined.set(change.id, change)
      counters.set(counterKey(change), change.id)
    }

    for (const change of changes) {
      for (const parentId of change.parents) {
        const parent = combined.get(parentId)
        if (!parent) {
          throw new CollaborationValidationError(
            `Change ${change.id} references missing parent ${parentId}.`,
            document.id,
            change.id
          )
        }
        if (parent.documentId !== document.id) {
          throw new CollaborationValidationError(
            `Change ${change.id} has invalid causal ordering.`,
            document.id,
            change.id
          )
        }
      }
      const expectedLamport = nextLamport(combined, change.parents, document.id, change.id)
      if (change.lamport !== expectedLamport) {
        throw new CollaborationValidationError(
          `Change ${change.id} Lamport clock must be exactly ${expectedLamport}.`,
          document.id,
          change.id
        )
      }
    }
    assertCollaborationCausalGraphAcyclic(combined, document.id)

    for (const change of changes) document.changes.set(change.id, cloneChange(change))
  }

  private bindActor(actorInput: CollaborationActor): void {
    const actor = validateActor(actorInput)
    const current = this.actors.get(actor.id)
    if (current && !sameActor(current, actor)) {
      throw new CollaborationValidationError(`Actor identity ${actor.id} conflicts with existing authorship.`)
    }
    this.actors.set(actor.id, actor)
  }

  private requireDocument(id: string): DocumentState {
    const document = this.documents.get(id)
    if (!document) throw new CollaborationValidationError(`Unknown document ${id}.`, id)
    return document
  }

  private requirePeer(id: string): CollaborationPeer {
    const peer = this.peers.get(id)
    if (!peer) throw new CollaborationValidationError(`Unknown peer ${id}.`)
    return peer
  }

  private captureSnapshot(): ReplicaSnapshot {
    return {
      actors: new Map([...this.actors].map(([id, actor]) => [id, cloneActor(actor)])),
      documents: cloneDocuments(this.documents)
    }
  }

  private restoreSnapshot(snapshot: ReplicaSnapshot): void {
    this.actors = snapshot.actors
    this.documents = snapshot.documents
  }

  private quarantine(
    reason: string,
    details: Pick<CollaborationQuarantineEntry, 'sourcePeerId' | 'documentId' | 'changeId'> = {}
  ): void {
    this.quarantineEntries.unshift({
      receivedAt: this.now(),
      reason,
      ...details
    })
    this.quarantineEntries.splice(MAX_QUARANTINE_ENTRIES)
  }
}

function parseBundle(serialized: string): CollaborationExportBundle {
  if (typeof serialized !== 'string' || Buffer.byteLength(serialized, 'utf8') > MAX_BUNDLE_BYTES) {
    throw new CollaborationValidationError(`Collaboration bundle exceeds ${MAX_BUNDLE_BYTES} bytes.`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(serialized) as unknown
  } catch {
    throw new CollaborationValidationError('Collaboration bundle is not valid JSON.')
  }
  if (!isRecord(parsed) || parsed.format !== COLLABORATION_FORMAT || parsed.version !== COLLABORATION_VERSION) {
    throw new CollaborationValidationError('Unsupported collaboration bundle format or version.')
  }
  if (!Array.isArray(parsed.actors) || !Array.isArray(parsed.documents) || !isRecord(parsed.checksum)) {
    throw new CollaborationValidationError('Collaboration bundle is missing actors, documents, or checksum.')
  }
  if (parsed.checksum.algorithm !== 'sha256' || typeof parsed.checksum.value !== 'string') {
    throw new CollaborationValidationError('Collaboration bundle checksum is invalid.')
  }
  const body: CollaborationExportBody = {
    format: COLLABORATION_FORMAT,
    version: COLLABORATION_VERSION,
    actors: parsed.actors as CollaborationActor[],
    documents: parsed.documents as CollaborationSerializedDocument[]
  }
  const expected = hashCanonical(body)
  if (expected !== parsed.checksum.value) {
    throw new CollaborationValidationError('Collaboration bundle checksum mismatch.')
  }
  const normalized: CollaborationExportBundle = {
    ...body,
    checksum: { algorithm: 'sha256', value: expected }
  }
  assertSerializedSize(canonicalStringify(normalized), MAX_BUNDLE_BYTES, 'Collaboration bundle')
  return normalized
}

function serializeBundle(body: CollaborationExportBody): string {
  const bundle: CollaborationExportBundle = {
    ...body,
    checksum: { algorithm: 'sha256', value: hashCanonical(body) }
  }
  const serialized = canonicalStringify(bundle)
  assertSerializedSize(serialized, MAX_BUNDLE_BYTES, 'Collaboration bundle')
  return serialized
}

function serializeDocument(document: DocumentState): CollaborationSerializedDocument {
  return {
    version: COLLABORATION_VERSION,
    id: document.id,
    kind: document.kind,
    createdAt: document.createdAt,
    changes: [...document.changes.values()].map(cloneChange).sort(compareChanges)
  }
}

function validateSerializedDocumentHeader(document: CollaborationSerializedDocument): void {
  if (!isRecord(document) || document.version !== COLLABORATION_VERSION) {
    throw new CollaborationValidationError('Unsupported collaboration document version.')
  }
  assertSafeId(document.id, 'Document id')
  validateKind(document.kind)
  validateTimestamp(document.createdAt, 'Document createdAt')
  if (!Array.isArray(document.changes) || document.changes.length === 0) {
    throw new CollaborationValidationError(`Document ${document.id} has no changes.`, document.id)
  }
  if (document.changes.length > MAX_CHANGES_PER_DOCUMENT) {
    throw new CollaborationValidationError(`Document ${document.id} has too many changes.`, document.id)
  }
}

function validateChange(input: CollaborationChange, document: DocumentState): CollaborationChange {
  if (!isRecord(input) || input.version !== COLLABORATION_VERSION) {
    throw new CollaborationValidationError('Unsupported collaboration change version.', document.id)
  }
  if (input.documentId !== document.id || input.kind !== document.kind) {
    throw new CollaborationValidationError('Change document identity does not match its container.', document.id)
  }
  const author = validateActor(input.author)
  if (!Number.isSafeInteger(input.sequence) || input.sequence <= 0) {
    throw new CollaborationValidationError('Change sequence must be a positive safe integer.', document.id)
  }
  if (!Number.isSafeInteger(input.lamport) || input.lamport <= 0) {
    throw new CollaborationValidationError('Change Lamport clock must be a positive safe integer.', document.id)
  }
  if (!Array.isArray(input.parents) || new Set(input.parents).size !== input.parents.length) {
    throw new CollaborationValidationError('Change parents must be a unique array.', document.id)
  }
  for (const parent of input.parents) assertSafeChangeId(parent)
  validateTimestamp(input.createdAt, 'Change createdAt')
  const operation = validateOperation(document.kind, input.operation)
  const message = normalizeMessage(input.message)
  const body: CollaborationChangeBody = {
    version: COLLABORATION_VERSION,
    documentId: document.id,
    kind: document.kind,
    author,
    sequence: input.sequence,
    lamport: input.lamport,
    parents: [...input.parents].sort(compareText),
    createdAt: input.createdAt,
    operation,
    ...(message ? { message } : {})
  }
  const hash = hashCanonical(body)
  const expectedId = changeId(author.id, input.sequence, hash)
  if (input.hash !== hash || input.id !== expectedId) {
    throw new CollaborationValidationError('Change hash or id mismatch.', document.id, input.id)
  }
  const signature = validateSignature(input.signature)
  if (!verifyChangeSignature(hash, signature, author.publicKey)) {
    throw new CollaborationValidationError(
      `Change ${input.id} signature does not authenticate author ${author.id}.`,
      document.id,
      input.id
    )
  }
  return { ...body, id: expectedId, hash, signature }
}

function validateOperation(
  kind: CollaborationDocumentKind,
  input: CollaborationOperation
): CollaborationOperation {
  if (!isRecord(input) || (input.type !== 'set' && input.type !== 'delete') || typeof input.path !== 'string') {
    throw new CollaborationValidationError('Invalid collaboration operation.')
  }
  const path = validateAllowedPath(kind, input.path)
  if (input.type === 'delete') return { type: 'delete', path }
  if (!('value' in input)) throw new CollaborationValidationError('Set operation is missing a value.')
  validateJsonValue(input.value)
  validateValueForPath(kind, path, input.value)
  return { type: 'set', path, value: cloneJson(input.value) }
}

function validateAllowedPath(kind: CollaborationDocumentKind, path: string): string {
  const segments = parsePath(path)
  const exact = `/${segments.join('/')}`
  const itemPath = segments.length === 2 && SAFE_PATH_SEGMENT.test(segments[1])

  if (kind === 'dashboard') {
    if (['/name', '/description', '/author', '/width', '/height', '/background', '/scaleMode'].includes(exact)) return exact
    if (itemPath && ['elements', 'adaptive'].includes(segments[0])) return exact
  }
  if (kind === 'race-notes') {
    if (['/title', '/summary'].includes(exact)) return exact
    if (itemPath && ['entries', 'annotations', 'tags'].includes(segments[0])) return exact
  }
  if (kind === 'cue-profile') {
    if (['/name', '/language'].includes(exact)) return exact
    if (itemPath && ['cues', 'defaults'].includes(segments[0])) return exact
  }
  if (kind === 'accessibility-profile') {
    if (exact === '/name') return exact
    if (itemPath && ['preferences', 'cues'].includes(segments[0])) return exact
  }
  throw new CollaborationValidationError(`Path ${path} is not allowed for ${kind}.`)
}

function validateValueForPath(
  kind: CollaborationDocumentKind,
  path: string,
  value: CollaborationJson
): void {
  const segments = parsePath(path)
  const root = segments[0]
  const itemId = segments[1]
  if (path === '/name' || path === '/title') {
    validateTitle(value)
    return
  }
  if (path === '/description' || path === '/summary' || path === '/author' || path === '/language' || path === '/background') {
    assertString(value, path, path === '/summary' || path === '/description' ? 4_000 : 160)
    return
  }
  if (path === '/width' || path === '/height') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 64 || value > 16_384) {
      throw new CollaborationValidationError(`${path} must be a finite number between 64 and 16384.`)
    }
    return
  }
  if (path === '/scaleMode') {
    if (value !== 'fit' && value !== 'fill' && value !== 'stretch') {
      throw new CollaborationValidationError('/scaleMode must be fit, fill, or stretch.')
    }
    return
  }
  if (kind === 'dashboard' && root === 'elements') {
    validateDashboardElement(value, itemId)
    return
  }
  if (kind === 'race-notes' && (root === 'entries' || root === 'annotations')) {
    validateNoteEntry(value, itemId)
    return
  }
  if (root === 'tags') {
    assertString(value, path, 80)
    return
  }
  if ((kind === 'cue-profile' || kind === 'accessibility-profile') && root === 'cues') {
    validateCue(value, itemId)
  }
}

function validateDashboardElement(value: CollaborationJson, id: string): void {
  if (!isJsonObject(value)) throw new CollaborationValidationError('Dashboard element must be an object.')
  const allowed = new Set(['id', 'type', 'x', 'y', 'w', 'h', 'binding', 'style', 'name', 'visible', 'sourceType', 'widgetId', 'hifiModuleId'])
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new CollaborationValidationError(`Dashboard element field ${key} is not allowed.`)
  }
  if (value.id !== id || typeof value.type !== 'string' || !isJsonObject(value.style)) {
    throw new CollaborationValidationError('Dashboard element id, type, or style is invalid.')
  }
  for (const key of ['x', 'y', 'w', 'h'] as const) {
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key])) {
      throw new CollaborationValidationError(`Dashboard element ${key} must be finite.`)
    }
  }
  if ((value.w as number) <= 0 || (value.h as number) <= 0) {
    throw new CollaborationValidationError('Dashboard element width and height must be positive.')
  }
  for (const key of ['binding', 'name', 'sourceType', 'widgetId', 'hifiModuleId'] as const) {
    if (value[key] !== undefined && typeof value[key] !== 'string') {
      throw new CollaborationValidationError(`Dashboard element ${key} must be a string.`)
    }
  }
  if (value.visible !== undefined && typeof value.visible !== 'boolean') {
    throw new CollaborationValidationError('Dashboard element visible must be a boolean.')
  }
}

function validateNoteEntry(value: CollaborationJson, id: string): void {
  if (!isJsonObject(value) || value.id !== id || typeof value.text !== 'string' || !value.text.trim()) {
    throw new CollaborationValidationError('Race note entry must have matching id and non-empty text.')
  }
  const allowed = new Set(['id', 'text', 'heading', 'tags', 'eventRef', 'resolved', 'createdAt', 'updatedAt'])
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new CollaborationValidationError(`Race note field ${key} is not allowed.`)
  }
  if (value.text.length > 20_000) throw new CollaborationValidationError('Race note text is too large.')
  if (value.heading !== undefined && typeof value.heading !== 'string') {
    throw new CollaborationValidationError('Race note heading must be a string.')
  }
  if (value.tags !== undefined && (!Array.isArray(value.tags) || value.tags.some((tag) => typeof tag !== 'string'))) {
    throw new CollaborationValidationError('Race note tags must be a string array.')
  }
  if (value.eventRef !== undefined && typeof value.eventRef !== 'string') {
    throw new CollaborationValidationError('Race note eventRef must be a string.')
  }
  if (value.resolved !== undefined && typeof value.resolved !== 'boolean') {
    throw new CollaborationValidationError('Race note resolved must be a boolean.')
  }
  for (const key of ['createdAt', 'updatedAt'] as const) {
    if (value[key] !== undefined && (!Number.isSafeInteger(value[key]) || (value[key] as number) < 0)) {
      throw new CollaborationValidationError(`Race note ${key} must be a non-negative safe integer.`)
    }
  }
}

function validateCue(value: CollaborationJson, id: string): void {
  if (!isJsonObject(value) || value.id !== id || typeof value.label !== 'string' || !value.label.trim()) {
    throw new CollaborationValidationError('Cue must have matching id and non-empty label.')
  }
  const allowed = new Set(['id', 'label', 'description', 'trigger', 'channels', 'priority', 'enabled', 'durationMs'])
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new CollaborationValidationError(`Cue field ${key} is not allowed.`)
  }
  if (value.description !== undefined && typeof value.description !== 'string') {
    throw new CollaborationValidationError('Cue description must be a string.')
  }
  if (value.channels !== undefined) {
    const allowedChannels = new Set(['visual', 'audio', 'haptic', 'caption'])
    if (
      !Array.isArray(value.channels) ||
      value.channels.some((channel) => typeof channel !== 'string' || !allowedChannels.has(channel))
    ) {
      throw new CollaborationValidationError('Cue channels must use visual, audio, haptic, or caption.')
    }
  }
  if (value.priority !== undefined && (!Number.isSafeInteger(value.priority) || (value.priority as number) < 0)) {
    throw new CollaborationValidationError('Cue priority must be a non-negative safe integer.')
  }
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') {
    throw new CollaborationValidationError('Cue enabled must be a boolean.')
  }
  if (value.durationMs !== undefined && (!Number.isSafeInteger(value.durationMs) || (value.durationMs as number) < 0)) {
    throw new CollaborationValidationError('Cue durationMs must be a non-negative safe integer.')
  }
}

function validateJsonValue(value: unknown): asserts value is CollaborationJson {
  inspectJson(value)
  const serialized = canonicalStringify(value)
  if (Buffer.byteLength(serialized, 'utf8') > MAX_VALUE_BYTES) {
    throw new CollaborationValidationError(`Collaboration value exceeds ${MAX_VALUE_BYTES} bytes.`)
  }
}

function inspectJson(root: unknown): void {
  type Task =
    | { type: 'value'; value: unknown; depth: number }
    | { type: 'leave'; value: object }
  const tasks: Task[] = [{ type: 'value', value: root, depth: 0 }]
  const active = new Set<object>()
  let inspected = 0

  while (tasks.length > 0) {
    const task = tasks.pop()!
    if (task.type === 'leave') {
      active.delete(task.value)
      continue
    }
    inspected += 1
    if (inspected > MAX_JSON_NODES) {
      throw new CollaborationValidationError('Collaboration value is too complex.')
    }
    if (task.depth > MAX_JSON_DEPTH) {
      throw new CollaborationValidationError('Collaboration value nesting is too deep.')
    }
    const value = task.value
    if (value === null || typeof value === 'string' || typeof value === 'boolean') continue
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new CollaborationValidationError('Collaboration numbers must be finite.')
      continue
    }
    if (Array.isArray(value)) {
      if (value.length > 1_000) throw new CollaborationValidationError('Collaboration arrays are too large.')
      if (active.has(value)) throw new CollaborationValidationError('Collaboration values cannot contain cycles.')
      active.add(value)
      tasks.push({ type: 'leave', value })
      for (let index = value.length - 1; index >= 0; index -= 1) {
        tasks.push({ type: 'value', value: value[index], depth: task.depth + 1 })
      }
      continue
    }
    if (!isRecord(value)) throw new CollaborationValidationError('Collaboration values must be JSON-safe.')
    if (active.has(value)) throw new CollaborationValidationError('Collaboration values cannot contain cycles.')
    const keys = Object.keys(value)
    if (keys.length > 200) throw new CollaborationValidationError('Collaboration objects have too many fields.')
    let telemetrySignals = 0
    for (const key of keys) {
      const normalized = normalizeKey(key)
      if (PROTOTYPE_RELATED_KEYS.has(key) || FORBIDDEN_KEYS.has(normalized)) {
        throw new CollaborationValidationError(`Field ${key} is not allowed in collaboration documents.`)
      }
      if (TELEMETRY_SIGNAL_KEYS.has(normalized)) telemetrySignals += 1
    }
    if (telemetrySignals >= 3) {
      throw new CollaborationValidationError('Telemetry-shaped records are not allowed in collaboration documents.')
    }
    active.add(value)
    tasks.push({ type: 'leave', value })
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      tasks.push({ type: 'value', value: value[keys[index]], depth: task.depth + 1 })
    }
  }
}

function materializeDocument(document: DocumentState): CollaborationDocumentView {
  const byPath = new Map<string, CollaborationChange[]>()
  for (const change of document.changes.values()) {
    const values = byPath.get(change.operation.path) ?? []
    values.push(change)
    byPath.set(change.operation.path, values)
  }
  const data: Record<string, CollaborationJson> = {}
  const conflicts: CollaborationConflict[] = []
  let tombstoneCount = 0
  const winners = [...byPath.entries()].map(([path, candidates]) => {
    const frontier = candidates.filter((candidate) =>
      !candidates.some((other) => candidate.id !== other.id && isAncestor(document, candidate.id, other.id))
    )
    const winner = [...frontier].sort(compareChanges).at(-1)!
    const distinct = new Set(frontier.map((candidate) => canonicalStringify(candidate.operation)))
    if (frontier.length > 1 && distinct.size > 1) {
      conflicts.push({
        path,
        winnerChangeId: winner.id,
        candidates: [...frontier]
          .sort(compareChanges)
          .map((candidate) => ({
            changeId: candidate.id,
            author: cloneActor(candidate.author),
            operation: cloneOperation(candidate.operation),
            selected: candidate.id === winner.id
          }))
      })
    }
    return winner
  })
  winners.sort((left, right) => {
    const depth = parsePath(left.operation.path).length - parsePath(right.operation.path).length
    return depth || compareText(left.operation.path, right.operation.path)
  })
  for (const winner of winners) {
    if (winner.operation.type === 'delete') {
      tombstoneCount += 1
      deleteAtPath(data, winner.operation.path)
    } else {
      setAtPath(data, winner.operation.path, winner.operation.value)
    }
  }
  const titlePath = collaborationTitlePath(document.kind)
  const title = valueAtPath(data, titlePath)
  return {
    id: document.id,
    kind: document.kind,
    title: typeof title === 'string' && title ? title : `Untitled ${document.kind}`,
    createdAt: document.createdAt,
    revision: hashCanonical([...document.changes.keys()].sort(compareText)),
    heads: documentHeads(document),
    data,
    changeCount: document.changes.size,
    tombstoneCount,
    conflicts: conflicts.sort((left, right) => compareText(left.path, right.path)),
    history: [...document.changes.values()]
      .sort((left, right) => compareChanges(right, left))
      .map((change) => ({
        changeId: change.id,
        author: cloneActor(change.author),
        operation: cloneOperation(change.operation),
        createdAt: change.createdAt,
        lamport: change.lamport,
        ...(change.message ? { message: change.message } : {})
      }))
  }
}

function documentHeads(document: DocumentState): string[] {
  const parentIds = new Set([...document.changes.values()].flatMap((change) => change.parents))
  return [...document.changes.keys()].filter((id) => !parentIds.has(id)).sort(compareText)
}

function isAncestor(document: DocumentState, ancestorId: string, descendantId: string): boolean {
  const pending = [...(document.changes.get(descendantId)?.parents ?? [])]
  const visited = new Set<string>()
  while (pending.length > 0) {
    const id = pending.pop()!
    if (id === ancestorId) return true
    if (visited.has(id)) continue
    visited.add(id)
    pending.push(...(document.changes.get(id)?.parents ?? []))
  }
  return false
}

export function assertCollaborationCausalGraphAcyclic(
  changes: ReadonlyMap<string, Pick<CollaborationChange, 'parents'>>,
  documentId: string
): void {
  const visiting = new Set<string>()
  const visited = new Set<string>()
  for (const startId of changes.keys()) {
    if (visited.has(startId)) continue
    const stack: Array<{ id: string; parents: readonly string[]; index: number }> = [{
      id: startId,
      parents: changes.get(startId)?.parents ?? [],
      index: 0
    }]
    visiting.add(startId)
    while (stack.length > 0) {
      const frame = stack.at(-1)!
      if (frame.index >= frame.parents.length) {
        visiting.delete(frame.id)
        visited.add(frame.id)
        stack.pop()
        continue
      }
      const parentId = frame.parents[frame.index]
      frame.index += 1
      if (visiting.has(parentId)) {
        throw new CollaborationValidationError(
          `Document ${documentId} contains a causal cycle.`,
          documentId,
          parentId
        )
      }
      if (visited.has(parentId)) continue
      visiting.add(parentId)
      stack.push({
        id: parentId,
        parents: changes.get(parentId)?.parents ?? [],
        index: 0
      })
    }
  }
}

function compareChanges(left: CollaborationChange, right: CollaborationChange): number {
  return (
    left.lamport - right.lamport ||
    compareText(left.author.id, right.author.id) ||
    left.sequence - right.sequence ||
    compareText(left.id, right.id)
  )
}

function nextSequence(document: DocumentState, actorId: string): number {
  let maximum = 0
  for (const change of document.changes.values()) {
    if (change.author.id === actorId && change.sequence > maximum) maximum = change.sequence
  }
  if (maximum >= Number.MAX_SAFE_INTEGER) {
    throw new CollaborationValidationError(
      `Author ${actorId} sequence cannot advance beyond ${Number.MAX_SAFE_INTEGER}.`,
      document.id
    )
  }
  return maximum + 1
}

function nextLamport(
  changes: ReadonlyMap<string, CollaborationChange>,
  parents: readonly string[],
  documentId: string,
  changeIdValue?: string
): number {
  let maximum = 0
  for (const parentId of parents) {
    const parent = changes.get(parentId)
    if (!parent) {
      throw new CollaborationValidationError(
        `Change ${changeIdValue ?? '(local)'} references missing parent ${parentId}.`,
        documentId,
        changeIdValue
      )
    }
    if (parent.lamport > maximum) maximum = parent.lamport
  }
  if (maximum >= Number.MAX_SAFE_INTEGER) {
    throw new CollaborationValidationError(
      `Change ${changeIdValue ?? '(local)'} Lamport clock cannot advance beyond ${Number.MAX_SAFE_INTEGER}.`,
      documentId,
      changeIdValue
    )
  }
  return maximum + 1
}

function counterKey(change: Pick<CollaborationChange, 'author' | 'sequence'>): string {
  return `${change.author.id}:${change.sequence}`
}

function changeId(actorId: string, sequence: number, hash: string): string {
  return `${actorId}:${sequence}:${hash.slice(0, 16)}`
}

function signChangeBody(body: CollaborationChangeBody, privateKey: KeyObject): CollaborationChange {
  const hash = hashCanonical(body)
  return {
    ...body,
    id: changeId(body.author.id, body.sequence, hash),
    hash,
    signature: sign(null, Buffer.from(hash, 'hex'), privateKey).toString('base64')
  }
}

function verifyChangeSignature(hash: string, signature: string, publicKey: string): boolean {
  return verify(
    null,
    Buffer.from(hash, 'hex'),
    parsePublicKey(publicKey),
    Buffer.from(signature, 'base64')
  )
}

function assertSafeChangeId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length > 180 || !/^[A-Za-z0-9._:-]+$/.test(value)) {
    throw new CollaborationValidationError('Invalid change id.')
  }
}

function validateActor(input: CollaborationActor): CollaborationActor {
  if (!isRecord(input)) throw new CollaborationValidationError('Invalid collaboration actor.')
  assertSafeId(input.id, 'Actor id')
  assertSafeId(input.deviceId, 'Actor device id')
  if (typeof input.displayName !== 'string' || !input.displayName.trim() || input.displayName.length > 80) {
    throw new CollaborationValidationError('Actor display name must be 1-80 characters.')
  }
  return {
    id: input.id,
    displayName: input.displayName.trim(),
    deviceId: input.deviceId,
    publicKey: validatePublicKey(input.publicKey)
  }
}

function validatePublicKey(value: unknown): string {
  if (typeof value !== 'string') {
    throw new CollaborationValidationError('Actor public key must be an Ed25519 SPKI key.')
  }
  parsePublicKey(value)
  return value
}

function parsePublicKey(value: string): KeyObject {
  const bytes = decodeCanonicalBase64(value, 'Actor public key', 256)
  try {
    const key = createPublicKey({ key: bytes, format: 'der', type: 'spki' })
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('not Ed25519')
    return key
  } catch {
    throw new CollaborationValidationError('Actor public key must be an Ed25519 SPKI key.')
  }
}

function validateSigningPrivateKey(value: unknown, expectedPublicKey: string): KeyObject {
  if (typeof value !== 'string') {
    throw new CollaborationValidationError('A matching Ed25519 private key is required for local authorship.')
  }
  const bytes = decodeCanonicalBase64(value, 'Actor private key', 512)
  try {
    const key = createPrivateKey({ key: bytes, format: 'der', type: 'pkcs8' })
    if (key.asymmetricKeyType !== 'ed25519' || exportPublicKey(createPublicKey(key)) !== expectedPublicKey) {
      throw new Error('key mismatch')
    }
    return key
  } catch {
    throw new CollaborationValidationError('A matching Ed25519 private key is required for local authorship.')
  }
}

function validateSignature(value: unknown): string {
  if (typeof value !== 'string') {
    throw new CollaborationValidationError('Change signature must be canonical base64.')
  }
  const bytes = decodeCanonicalBase64(value, 'Change signature', 128)
  if (bytes.length !== 64) throw new CollaborationValidationError('Change signature must be a 64-byte Ed25519 signature.')
  return value
}

function decodeCanonicalBase64(value: string, label: string, maxBytes: number): Buffer {
  if (!value || value.length > maxBytes * 2 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new CollaborationValidationError(`${label} must be canonical base64.`)
  }
  const bytes = Buffer.from(value, 'base64')
  if (bytes.length === 0 || bytes.length > maxBytes || bytes.toString('base64') !== value) {
    throw new CollaborationValidationError(`${label} must be canonical base64.`)
  }
  return bytes
}

function exportPublicKey(key: KeyObject): string {
  return (key.export({ format: 'der', type: 'spki' }) as Buffer).toString('base64')
}

function exportPrivateKey(key: KeyObject): string {
  return (key.export({ format: 'der', type: 'pkcs8' }) as Buffer).toString('base64')
}

function validateKind(value: unknown): CollaborationDocumentKind {
  if (typeof value !== 'string' || !DOCUMENT_KIND_SET.has(value)) {
    throw new CollaborationValidationError(`Unsupported collaboration document kind ${String(value)}.`)
  }
  return value as CollaborationDocumentKind
}

function validateTimestamp(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CollaborationValidationError(`${label} must be a non-negative safe integer.`)
  }
  return value
}

function validateTitle(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 120) {
    throw new CollaborationValidationError('Document title must be 1-120 characters.')
  }
  return value.trim()
}

function assertString(value: unknown, label: string, maxLength: number): asserts value is string {
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new CollaborationValidationError(`${label} must be a string up to ${maxLength} characters.`)
  }
}

function assertSafeId(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    throw new CollaborationValidationError(`${label} must use 1-128 safe characters.`)
  }
}

function parsePath(path: string): string[] {
  if (!path.startsWith('/') || path.length > 300) {
    throw new CollaborationValidationError('Collaboration path must be an absolute JSON pointer.')
  }
  const segments = path.slice(1).split('/')
  if (segments.some((segment) =>
    !segment ||
    segment.includes('~') ||
    !SAFE_PATH_SEGMENT.test(segment) ||
    PROTOTYPE_RELATED_KEYS.has(segment)
  )) {
    throw new CollaborationValidationError(`Unsafe collaboration path ${path}.`)
  }
  return segments
}

function normalizeCapabilities(capabilities: readonly CollaborationCapability[]): CollaborationCapability[] {
  if (!Array.isArray(capabilities)) throw new CollaborationValidationError('Peer capabilities must be an array.')
  const allowed = new Set<CollaborationCapability>([
    ...COLLABORATION_DOCUMENT_KINDS.flatMap((kind) => [
      collaborationCapability(kind, 'read'),
      collaborationCapability(kind, 'write')
    ]),
    'document:export',
    'document:import',
    'peer:manage'
  ])
  const unique = [...new Set(capabilities)]
  for (const capability of unique) {
    if (!allowed.has(capability)) throw new CollaborationValidationError(`Unknown capability ${capability}.`)
  }
  return unique.sort(compareText)
}

function setAtPath(target: Record<string, CollaborationJson>, path: string, value: CollaborationJson): void {
  const segments = parsePath(path)
  let cursor: Record<string, CollaborationJson> = target
  for (const segment of segments.slice(0, -1)) {
    const current = cursor[segment]
    if (!isRecord(current)) cursor[segment] = {}
    cursor = cursor[segment] as Record<string, CollaborationJson>
  }
  cursor[segments.at(-1)!] = cloneJson(value)
}

function deleteAtPath(target: Record<string, CollaborationJson>, path: string): void {
  const segments = parsePath(path)
  let cursor: Record<string, CollaborationJson> = target
  for (const segment of segments.slice(0, -1)) {
    const next = cursor[segment]
    if (!isRecord(next)) return
    cursor = next as Record<string, CollaborationJson>
  }
  delete cursor[segments.at(-1)!]
}

function valueAtPath(target: Record<string, CollaborationJson>, path: string): CollaborationJson | undefined {
  let cursor: CollaborationJson | undefined = target
  for (const segment of parsePath(path)) {
    if (!isJsonObject(cursor)) return undefined
    cursor = cursor[segment] as CollaborationJson | undefined
  }
  return cursor
}

function sameActor(left: CollaborationActor, right: CollaborationActor): boolean {
  return left.id === right.id &&
    left.displayName === right.displayName &&
    left.deviceId === right.deviceId &&
    left.publicKey === right.publicKey
}

function cloneActor(actor: CollaborationActor): CollaborationActor {
  return { ...actor }
}

function clonePeer(peer: CollaborationPeer): CollaborationPeer {
  return { ...peer, actor: cloneActor(peer.actor), capabilities: [...peer.capabilities] }
}

function cloneOperation(operation: CollaborationOperation): CollaborationOperation {
  return operation.type === 'delete'
    ? { ...operation }
    : { ...operation, value: cloneJson(operation.value) }
}

function cloneChange(change: CollaborationChange): CollaborationChange {
  return {
    ...change,
    author: cloneActor(change.author),
    parents: [...change.parents],
    operation: cloneOperation(change.operation)
  }
}

function cloneDocuments(documents: ReadonlyMap<string, DocumentState>): Map<string, DocumentState> {
  return new Map(
    [...documents].map(([id, document]) => [
      id,
      {
        id: document.id,
        kind: document.kind,
        createdAt: document.createdAt,
        changes: new Map(
          [...document.changes].map(([changeIdValue, change]) => [changeIdValue, cloneChange(change)])
        )
      }
    ])
  )
}

function cloneJson<T extends CollaborationJson>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isJsonObject(value: CollaborationJson | undefined): value is { [key: string]: CollaborationJson } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function normalizeMessage(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || value.length > 240) {
    throw new CollaborationValidationError('Change message must be at most 240 characters.')
  }
  return value.trim() || undefined
}

function cryptoSafeDocumentId(actorId: string, timestamp: number): string {
  return `doc-${hashCanonical([actorId, timestamp, process.hrtime.bigint().toString()]).slice(0, 24)}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function hashCanonical(value: unknown): string {
  return createHash('sha256').update(canonicalStringify(value)).digest('hex')
}

export function canonicalStringify(root: unknown): string {
  type Task =
    | { type: 'value'; value: unknown; depth: number }
    | { type: 'raw'; value: string }
    | { type: 'leave'; value: object }
  const tasks: Task[] = [{ type: 'value', value: root, depth: 0 }]
  const chunks: string[] = []
  const active = new Set<object>()
  let visited = 0

  while (tasks.length > 0) {
    const task = tasks.pop()!
    if (task.type === 'raw') {
      chunks.push(task.value)
      continue
    }
    if (task.type === 'leave') {
      active.delete(task.value)
      continue
    }
    visited += 1
    if (visited > MAX_CANONICAL_NODES) {
      throw new CollaborationValidationError('Canonical JSON value is too complex.')
    }
    if (task.depth > MAX_CANONICAL_DEPTH) {
      throw new CollaborationValidationError('Canonical JSON nesting is too deep.')
    }
    const value = task.value
    if (value === null) {
      chunks.push('null')
      continue
    }
    if (typeof value === 'string' || typeof value === 'boolean') {
      chunks.push(JSON.stringify(value))
      continue
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new CollaborationValidationError('Canonical JSON rejects non-finite numbers.')
      chunks.push(JSON.stringify(value))
      continue
    }
    if (Array.isArray(value)) {
      if (active.has(value)) throw new CollaborationValidationError('Canonical JSON rejects cyclic values.')
      active.add(value)
      tasks.push({ type: 'leave', value })
      tasks.push({ type: 'raw', value: ']' })
      for (let index = value.length - 1; index >= 0; index -= 1) {
        tasks.push({ type: 'value', value: value[index], depth: task.depth + 1 })
        if (index > 0) tasks.push({ type: 'raw', value: ',' })
      }
      tasks.push({ type: 'raw', value: '[' })
      continue
    }
    if (!isRecord(value)) throw new CollaborationValidationError('Canonical JSON accepts JSON-safe values only.')
    if (active.has(value)) throw new CollaborationValidationError('Canonical JSON rejects cyclic values.')
    active.add(value)
    const keys = Object.keys(value).sort(compareText)
    tasks.push({ type: 'leave', value })
    tasks.push({ type: 'raw', value: '}' })
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index]
      tasks.push({ type: 'value', value: value[key], depth: task.depth + 1 })
      tasks.push({ type: 'raw', value: ':' })
      tasks.push({ type: 'raw', value: JSON.stringify(key) })
      if (index > 0) tasks.push({ type: 'raw', value: ',' })
    }
    tasks.push({ type: 'raw', value: '{' })
  }
  return chunks.join('')
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function assertSerializedSize(serialized: string, maximum: number, label: string): void {
  if (Buffer.byteLength(serialized, 'utf8') > maximum) {
    throw new CollaborationValidationError(`${label} exceeds ${maximum} bytes after canonical serialization.`)
  }
}
