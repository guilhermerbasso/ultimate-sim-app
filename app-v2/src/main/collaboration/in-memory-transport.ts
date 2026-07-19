import type { CollaborationMergeResult } from './replica'
import { LocalCollaborationReplica } from './replica'

interface TransportNode {
  replica: LocalCollaborationReplica
  online: boolean
}

export interface InMemoryCollaborationTransportState {
  nodes: Array<{ peerId: string; replica: LocalCollaborationReplica; online: boolean }>
}

export interface CollaborationSyncResult extends CollaborationMergeResult {
  attempts: number
}

export class InMemoryCollaborationTransport {
  private readonly nodes = new Map<string, TransportNode>()

  attach(peerId: string, replica: LocalCollaborationReplica, online = true): void {
    if (this.nodes.has(peerId)) throw new Error(`Transport node ${peerId} already exists.`)
    this.nodes.set(peerId, { replica, online })
  }

  setOnline(peerId: string, online: boolean): void {
    this.requireNode(peerId).online = online
    for (const [otherId, other] of this.nodes) {
      if (otherId === peerId) continue
      if (hasPeer(other.replica, peerId)) other.replica.setPeerConnected(peerId, online && other.online)
      if (hasPeer(this.requireNode(peerId).replica, otherId)) {
        this.requireNode(peerId).replica.setPeerConnected(otherId, online && other.online)
      }
    }
  }

  isOnline(peerId: string): boolean {
    return this.requireNode(peerId).online
  }

  synchronize(sourcePeerId: string, targetPeerId: string): CollaborationMergeResult {
    const source = this.requireNode(sourcePeerId)
    const target = this.requireNode(targetPeerId)
    if (!source.online || !target.online) return { accepted: 0, replayed: 0 }
    if (!hasPeer(source.replica, targetPeerId) || !hasPeer(target.replica, sourcePeerId)) {
      return { accepted: 0, replayed: 0 }
    }
    const bundle = source.replica.exportBundleForPeer(targetPeerId)
    return target.replica.mergeBundleFromPeer(sourcePeerId, bundle)
  }

  synchronizeAll(): CollaborationSyncResult {
    let accepted = 0
    let replayed = 0
    let attempts = 0
    const ids = [...this.nodes.keys()].sort(compareText)
    const maxRounds = Math.max(1, ids.length)
    for (let round = 0; round < maxRounds; round += 1) {
      let roundAccepted = 0
      for (const source of ids) {
        for (const target of ids) {
          if (source === target) continue
          attempts += 1
          const result = this.synchronize(source, target)
          accepted += result.accepted
          replayed += result.replayed
          roundAccepted += result.accepted
        }
      }
      if (roundAccepted === 0) break
    }
    return { accepted, replayed, attempts }
  }

  pendingChangeCount(peerId: string): number {
    const local = this.requireNode(peerId).replica.getChangeIds()
    const pending = new Set<string>()
    for (const [otherId, node] of this.nodes) {
      if (otherId === peerId) continue
      const other = node.replica.getChangeIds()
      for (const changeId of other) {
        if (!local.has(changeId)) pending.add(changeId)
      }
      for (const changeId of local) {
        if (!other.has(changeId)) pending.add(changeId)
      }
    }
    return pending.size
  }

  captureState(): InMemoryCollaborationTransportState {
    return {
      nodes: [...this.nodes].map(([peerId, node]) => ({
        peerId,
        replica: node.replica,
        online: node.online
      }))
    }
  }

  restoreState(state: InMemoryCollaborationTransportState): void {
    this.nodes.clear()
    for (const node of state.nodes) {
      this.nodes.set(node.peerId, { replica: node.replica, online: node.online })
    }
  }

  private requireNode(peerId: string): TransportNode {
    const node = this.nodes.get(peerId)
    if (!node) throw new Error(`Unknown transport node ${peerId}.`)
    return node
  }
}

function hasPeer(replica: LocalCollaborationReplica, peerId: string): boolean {
  return replica.listPeers().some((peer) => peer.id === peerId)
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
