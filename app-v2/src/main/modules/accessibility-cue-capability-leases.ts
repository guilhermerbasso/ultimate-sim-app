import {
  ACCESSIBILITY_CUE_CAPABILITY_TTL_MS,
  type CueCapabilityLeaseAck,
  type CueCapabilityLeaseModality,
  type SetCueCapabilityLeaseRequest
} from '../../shared/accessibility-cues'

type SenderListener = (...args: any[]) => void

export interface CapabilityLeaseSender {
  id: number
  on(event: string, listener: SenderListener): unknown
  once(event: string, listener: SenderListener): unknown
  off(event: string, listener: SenderListener): unknown
}

interface CapabilityLease {
  generation: number
  available: boolean
  expiresAt: number
}

interface TrackedSender {
  sender: CapabilityLeaseSender
  onNavigation: SenderListener
  onGone: SenderListener
  onDestroyed: SenderListener
}

function leaseKey(
  senderId: number,
  modality: CueCapabilityLeaseModality
): string {
  return `${senderId}:${modality}`
}

export class AccessibilityCueCapabilityLeaseRegistry {
  private readonly leases = new Map<
    number,
    Map<CueCapabilityLeaseModality, CapabilityLease>
  >()
  private readonly generations = new Map<string, number>()
  private readonly leaseIds = new Map<number, string>()
  private readonly revokedLeaseIds = new Map<number, Set<string>>()
  private readonly tracked = new Map<number, TrackedSender>()

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxTtlMs = ACCESSIBILITY_CUE_CAPABILITY_TTL_MS
  ) {}

  update(
    sender: CapabilityLeaseSender,
    request: SetCueCapabilityLeaseRequest
  ): CueCapabilityLeaseAck {
    this.pruneExpired()
    this.track(sender)
    const senderId = sender.id
    if (this.revokedLeaseIds.get(senderId)?.has(request.leaseId)) {
      return {
        accepted: false,
        generation: 0,
        expiresAt: 0
      }
    }
    let activeLeaseId = this.leaseIds.get(senderId)
    if (activeLeaseId && activeLeaseId !== request.leaseId) {
      const senderHasLiveLease = [
        ...(this.leases.get(senderId)?.values() ?? [])
      ].some((lease) => lease.available && lease.expiresAt > this.now())
      if (senderHasLiveLease) {
        return {
          accepted: false,
          generation: this.generations.get(
            leaseKey(senderId, request.modality)
          ) ?? 0,
          expiresAt: 0
        }
      }
      this.revokeSender(senderId)
      activeLeaseId = undefined
    }
    if (!activeLeaseId) this.leaseIds.set(senderId, request.leaseId)

    const key = leaseKey(senderId, request.modality)
    const latestGeneration = this.generations.get(key) ?? 0
    if (request.generation <= latestGeneration) {
      const current = this.leases.get(senderId)?.get(request.modality)
      return {
        accepted: false,
        generation: latestGeneration,
        expiresAt: current?.expiresAt ?? 0
      }
    }

    const ttlMs = Math.max(250, Math.min(this.maxTtlMs, request.ttlMs))
    const expiresAt = this.now() + ttlMs
    this.generations.set(key, request.generation)
    const senderLeases = this.leases.get(senderId) ?? new Map()
    senderLeases.set(request.modality, {
      generation: request.generation,
      available: request.available,
      expiresAt
    })
    this.leases.set(senderId, senderLeases)
    return {
      accepted: true,
      generation: request.generation,
      expiresAt
    }
  }

  available(modality: CueCapabilityLeaseModality): boolean {
    this.pruneExpired()
    for (const senderLeases of this.leases.values()) {
      const lease = senderLeases.get(modality)
      if (lease?.available && lease.expiresAt > this.now()) return true
    }
    return false
  }

  revokeSender(senderId: number, rememberLeaseId = false): void {
    const leaseId = this.leaseIds.get(senderId)
    if (rememberLeaseId && leaseId) {
      const revoked = this.revokedLeaseIds.get(senderId) ?? new Set<string>()
      revoked.add(leaseId)
      while (revoked.size > 4) {
        const oldest = revoked.values().next().value
        if (!oldest) break
        revoked.delete(oldest)
      }
      this.revokedLeaseIds.set(senderId, revoked)
    }
    this.leases.delete(senderId)
    this.leaseIds.delete(senderId)
    this.generations.delete(leaseKey(senderId, 'audio'))
    this.generations.delete(leaseKey(senderId, 'haptic'))
  }

  dispose(): void {
    for (const tracked of this.tracked.values()) {
      tracked.sender.off('did-start-navigation', tracked.onNavigation)
      tracked.sender.off('render-process-gone', tracked.onGone)
      tracked.sender.off('destroyed', tracked.onDestroyed)
    }
    this.tracked.clear()
    this.leases.clear()
    this.leaseIds.clear()
    this.revokedLeaseIds.clear()
    this.generations.clear()
  }

  private pruneExpired(): void {
    const now = this.now()
    for (const [senderId, senderLeases] of this.leases) {
      for (const [modality, lease] of senderLeases) {
        if (lease.expiresAt <= now) senderLeases.delete(modality)
      }
      if (senderLeases.size === 0) this.leases.delete(senderId)
    }
  }

  private track(sender: CapabilityLeaseSender): void {
    if (this.tracked.has(sender.id)) return
    const senderId = sender.id
    const onNavigation: SenderListener = (
      _event,
      _url,
      _isInPlace,
      isMainFrame
    ) => {
      if (isMainFrame !== false) this.revokeSender(senderId, true)
    }
    const onGone: SenderListener = () => this.revokeSender(senderId, true)
    const onDestroyed: SenderListener = () => {
      this.revokeSender(senderId)
      this.revokedLeaseIds.delete(senderId)
      this.tracked.delete(senderId)
    }
    this.tracked.set(senderId, {
      sender,
      onNavigation,
      onGone,
      onDestroyed
    })
    sender.on('did-start-navigation', onNavigation)
    sender.on('render-process-gone', onGone)
    sender.once('destroyed', onDestroyed)
  }
}
