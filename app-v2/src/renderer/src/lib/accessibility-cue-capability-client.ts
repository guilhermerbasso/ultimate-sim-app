import {
  ACCESSIBILITY_CUE_CAPABILITY_TTL_MS,
  ACCESSIBILITY_CUE_CHANNELS,
  ACCESSIBILITY_CUE_PROTOCOL_VERSION,
  type CueCapabilityLeaseAck,
  type CueCapabilityLeaseModality,
  type SetCueCapabilityLeaseRequest
} from '../../../shared/accessibility-cues'

export type CueCapabilityLeaseInvoke = (
  channel: string,
  request: SetCueCapabilityLeaseRequest
) => Promise<CueCapabilityLeaseAck>

function createLeaseId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    // Fall through to a process-local identifier.
  }
  return `cue-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export const ACCESSIBILITY_CUE_RENDERER_LEASE_ID = createLeaseId()

const leaseGenerations: Record<CueCapabilityLeaseModality, number> = {
  audio: 0,
  haptic: 0
}

function nextLeaseGeneration(
  modality: CueCapabilityLeaseModality
): number {
  leaseGenerations[modality] += 1
  return leaseGenerations[modality]
}

export class CueCapabilityLeasePublisher {
  private requestSequence = 0
  private disposed = false

  constructor(
    private readonly modality: CueCapabilityLeaseModality,
    private readonly invoke: CueCapabilityLeaseInvoke,
    private readonly leaseId = ACCESSIBILITY_CUE_RENDERER_LEASE_ID,
    private readonly ttlMs = ACCESSIBILITY_CUE_CAPABILITY_TTL_MS
  ) {}

  async refresh(
    detect: () => boolean | Promise<boolean>
  ): Promise<boolean> {
    if (this.disposed) return false
    const requestSequence = ++this.requestSequence
    const generation = nextLeaseGeneration(this.modality)
    let available = false
    try {
      available = await detect()
    } catch {
      available = false
    }
    if (
      this.disposed ||
      requestSequence !== this.requestSequence
    ) {
      return false
    }
    const ack = await this.publish(generation, available).catch(() => null)
    return Boolean(ack?.accepted)
  }

  revoke(): void {
    if (this.disposed) return
    this.requestSequence += 1
    const generation = nextLeaseGeneration(this.modality)
    void this.publish(generation, false).catch(() => undefined)
  }

  dispose(): void {
    if (this.disposed) return
    this.requestSequence += 1
    const generation = nextLeaseGeneration(this.modality)
    this.disposed = true
    void this.publish(generation, false).catch(() => undefined)
  }

  private publish(
    generation: number,
    available: boolean
  ): Promise<CueCapabilityLeaseAck> {
    return this.invoke(ACCESSIBILITY_CUE_CHANNELS.setCapabilityLease, {
      protocolVersion: ACCESSIBILITY_CUE_PROTOCOL_VERSION,
      leaseId: this.leaseId,
      modality: this.modality,
      generation,
      available,
      ttlMs: this.ttlMs
    })
  }
}
