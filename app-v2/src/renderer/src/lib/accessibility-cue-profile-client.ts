import {
  ACCESSIBILITY_CUE_CHANNELS,
  ACCESSIBILITY_CUE_PROTOCOL_VERSION,
  type AccessibilityCueStateEnvelope,
  type CueProfile,
  type SaveCueProfileRequest,
  type SelectCueProfileRequest
} from '../../../shared/accessibility-cues'

export type CueProfileInvoke = (
  channel: string,
  request?: unknown
) => Promise<AccessibilityCueStateEnvelope>

export class CueProfileMutationQueue {
  private tail: Promise<void> = Promise.resolve()
  private envelope: AccessibilityCueStateEnvelope
  private pending = 0

  constructor(
    initialEnvelope: AccessibilityCueStateEnvelope,
    private readonly invoke: CueProfileInvoke,
    private readonly onEnvelope: (envelope: AccessibilityCueStateEnvelope) => void
  ) {
    this.envelope = initialEnvelope
  }

  get current(): AccessibilityCueStateEnvelope {
    return this.envelope
  }

  acceptBroadcast(envelope: AccessibilityCueStateEnvelope): void {
    if (envelope.protocolVersion !== ACCESSIBILITY_CUE_PROTOCOL_VERSION) return
    if (envelope.revision < this.envelope.revision) return
    this.envelope = envelope
    if (this.pending === 0) this.onEnvelope(envelope)
  }

  save(profile: CueProfile): Promise<void> {
    return this.enqueue(async () => {
      const request: SaveCueProfileRequest = {
        protocolVersion: ACCESSIBILITY_CUE_PROTOCOL_VERSION,
        expectedRevision: this.envelope.revision,
        profile
      }
      return this.invoke(ACCESSIBILITY_CUE_CHANNELS.saveProfile, request)
    })
  }

  select(profileId: string): Promise<void> {
    return this.enqueue(async () => {
      const request: SelectCueProfileRequest = {
        protocolVersion: ACCESSIBILITY_CUE_PROTOCOL_VERSION,
        expectedRevision: this.envelope.revision,
        profileId
      }
      return this.invoke(ACCESSIBILITY_CUE_CHANNELS.setActiveProfile, request)
    })
  }

  reset(profileId: string): Promise<void> {
    return this.enqueue(async () => {
      const request: SelectCueProfileRequest = {
        protocolVersion: ACCESSIBILITY_CUE_PROTOCOL_VERSION,
        expectedRevision: this.envelope.revision,
        profileId
      }
      return this.invoke(ACCESSIBILITY_CUE_CHANNELS.resetProfile, request)
    })
  }

  private enqueue(
    mutation: () => Promise<AccessibilityCueStateEnvelope>
  ): Promise<void> {
    this.pending += 1
    const operation = this.tail.then(async () => {
      const envelope = await mutation()
      this.envelope = envelope
    })
    this.tail = operation.catch(() => undefined)
    return operation.finally(() => {
      this.pending = Math.max(0, this.pending - 1)
      if (this.pending === 0) this.onEnvelope(this.envelope)
    })
  }
}
