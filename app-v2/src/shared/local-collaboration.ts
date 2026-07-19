export const COLLABORATION_FORMAT = 'ultimate-sim-local-collaboration' as const
export const COLLABORATION_VERSION = 1 as const
export const COLLABORATION_FILE_EXTENSION = 'simcollab' as const

export const COLLABORATION_DOCUMENT_KINDS = [
  'dashboard',
  'race-notes',
  'cue-profile',
  'accessibility-profile'
] as const

export type CollaborationDocumentKind = (typeof COLLABORATION_DOCUMENT_KINDS)[number]
export type CollaborationAccess = 'read' | 'write'
export type CollaborationCapability =
  | `${CollaborationDocumentKind}:${CollaborationAccess}`
  | 'document:export'
  | 'document:import'
  | 'peer:manage'

export type CollaborationJson =
  | null
  | boolean
  | number
  | string
  | CollaborationJson[]
  | { [key: string]: CollaborationJson }

export interface CollaborationActor {
  id: string
  displayName: string
  deviceId: string
  publicKey: string
}

export interface CollaborationPeer {
  id: string
  actor: CollaborationActor
  capabilities: CollaborationCapability[]
  connected: boolean
  mock: true
}

export type CollaborationOperation =
  | { type: 'set'; path: string; value: CollaborationJson }
  | { type: 'delete'; path: string }

export interface CollaborationChangeBody {
  version: typeof COLLABORATION_VERSION
  documentId: string
  kind: CollaborationDocumentKind
  author: CollaborationActor
  sequence: number
  lamport: number
  parents: string[]
  createdAt: number
  operation: CollaborationOperation
  message?: string
}

export interface CollaborationChange extends CollaborationChangeBody {
  id: string
  hash: string
  signature: string
}

export interface CollaborationSerializedDocument {
  version: typeof COLLABORATION_VERSION
  id: string
  kind: CollaborationDocumentKind
  createdAt: number
  changes: CollaborationChange[]
}

export interface CollaborationExportBody {
  format: typeof COLLABORATION_FORMAT
  version: typeof COLLABORATION_VERSION
  actors: CollaborationActor[]
  documents: CollaborationSerializedDocument[]
}

export interface CollaborationExportBundle extends CollaborationExportBody {
  checksum: {
    algorithm: 'sha256'
    value: string
  }
}

export interface CollaborationHistoryEntry {
  changeId: string
  author: CollaborationActor
  operation: CollaborationOperation
  createdAt: number
  lamport: number
  message?: string
}

export interface CollaborationConflictCandidate {
  changeId: string
  author: CollaborationActor
  operation: CollaborationOperation
  selected: boolean
}

export interface CollaborationConflict {
  path: string
  winnerChangeId: string
  candidates: CollaborationConflictCandidate[]
}

export interface CollaborationDocumentView {
  id: string
  kind: CollaborationDocumentKind
  title: string
  createdAt: number
  revision: string
  heads: string[]
  data: Record<string, CollaborationJson>
  changeCount: number
  tombstoneCount: number
  conflicts: CollaborationConflict[]
  history: CollaborationHistoryEntry[]
}

export interface CollaborationDocumentSummary {
  id: string
  kind: CollaborationDocumentKind
  title: string
  revision: string
  changeCount: number
  conflictCount: number
  updatedAt: number
}

export interface CollaborationQuarantineEntry {
  receivedAt: number
  sourcePeerId?: string
  documentId?: string
  changeId?: string
  reason: string
}

export interface CollaborationStatus {
  authority: 'local-primary'
  transport: 'in-memory-mock-only'
  networkEnabled: false
  online: boolean
  localActor: CollaborationActor
  documentCount: number
  peerCount: number
  pendingChangeCount: number
  quarantineCount: number
  lastSavedAt: number | null
  lastError?: string
}

export interface CollaborationWorkspaceState {
  status: CollaborationStatus
  documents: CollaborationDocumentSummary[]
  peers: CollaborationPeer[]
  quarantine: CollaborationQuarantineEntry[]
}

export interface CollaborationCreateInput {
  kind: CollaborationDocumentKind
  title: string
}

export interface CollaborationSetInput {
  documentId: string
  path: string
  value: CollaborationJson
  message?: string
}

export interface CollaborationDeleteInput {
  documentId: string
  path: string
  message?: string
}

export interface CollaborationMockPeerInput {
  displayName: string
  access: 'viewer' | 'editor'
}

export interface CollaborationMockEditInput {
  peerId: string
  documentId: string
  operation: CollaborationOperation
  message?: string
}

export interface CollaborationFileResult {
  canceled: boolean
  filePath?: string
  documentCount?: number
}

export const COLLABORATION_CHANNELS = {
  state: 'collaboration:state',
  getDocument: 'collaboration:getDocument',
  create: 'collaboration:create',
  set: 'collaboration:set',
  delete: 'collaboration:delete',
  setOnline: 'collaboration:setOnline',
  addMockPeer: 'collaboration:addMockPeer',
  mockEdit: 'collaboration:mockEdit',
  sync: 'collaboration:sync',
  exportFile: 'collaboration:exportFile',
  importFile: 'collaboration:importFile',
  changed: 'collaboration:changed'
} as const

export function collaborationCapability(
  kind: CollaborationDocumentKind,
  access: CollaborationAccess
): CollaborationCapability {
  return `${kind}:${access}`
}

export function collaborationTitlePath(kind: CollaborationDocumentKind): '/name' | '/title' {
  return kind === 'dashboard' || kind === 'cue-profile' || kind === 'accessibility-profile'
    ? '/name'
    : '/title'
}
