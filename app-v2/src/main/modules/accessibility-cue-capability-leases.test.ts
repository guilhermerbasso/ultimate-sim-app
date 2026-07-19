import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import {
  ACCESSIBILITY_CUE_PROTOCOL_VERSION,
  type CueCapabilityLeaseModality,
  type SetCueCapabilityLeaseRequest
} from '../../shared/accessibility-cues'
import {
  AccessibilityCueCapabilityLeaseRegistry,
  type CapabilityLeaseSender
} from './accessibility-cue-capability-leases'

class FakeSender extends EventEmitter implements CapabilityLeaseSender {
  constructor(readonly id: number) {
    super()
  }
}

function request(
  modality: CueCapabilityLeaseModality,
  generation: number,
  available = true,
  leaseId = 'document-a'
): SetCueCapabilityLeaseRequest {
  return {
    protocolVersion: ACCESSIBILITY_CUE_PROTOCOL_VERSION,
    leaseId,
    modality,
    generation,
    available,
    ttlMs: 1_000
  }
}

describe('AccessibilityCueCapabilityLeaseRegistry', () => {
  it('rejects stale generations without overwriting a newer live lease', () => {
    let now = 100
    const registry = new AccessibilityCueCapabilityLeaseRegistry(() => now)
    const sender = new FakeSender(7)

    expect(registry.update(sender, request('audio', 2))).toMatchObject({
      accepted: true,
      generation: 2
    })
    expect(
      registry.update(sender, request('audio', 1, false))
    ).toMatchObject({
      accepted: false,
      generation: 2
    })
    expect(registry.available('audio')).toBe(true)

    now = 1_101
    expect(registry.available('audio')).toBe(false)
  })

  it.each(['did-start-navigation', 'render-process-gone', 'destroyed'] as const)(
    'revokes sender leases on %s',
    (event) => {
      const registry = new AccessibilityCueCapabilityLeaseRegistry(() => 0)
      const sender = new FakeSender(9)
      registry.update(sender, request('haptic', 1))

      if (event === 'did-start-navigation') {
        sender.emit(event, {}, 'app://next', false, true)
      } else {
        sender.emit(event)
      }

      expect(registry.available('haptic')).toBe(false)
    }
  )

  it('rejects a different document lease until navigation revokes the old document', () => {
    const registry = new AccessibilityCueCapabilityLeaseRegistry(() => 0)
    const sender = new FakeSender(11)
    registry.update(sender, request('audio', 4, true, 'document-a'))

    expect(
      registry.update(sender, request('audio', 5, true, 'document-b'))
    ).toMatchObject({ accepted: false, generation: 4 })
    sender.emit('did-start-navigation', {}, 'app://new', false, true)
    expect(
      registry.update(sender, request('audio', 6, true, 'document-a'))
    ).toMatchObject({ accepted: false })
    expect(
      registry.update(sender, request('audio', 1, true, 'document-b'))
    ).toMatchObject({ accepted: true, generation: 1 })
  })
})
