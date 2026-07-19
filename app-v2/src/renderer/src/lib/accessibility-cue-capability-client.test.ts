import { describe, expect, it, vi } from 'vitest'
import type { CueCapabilityLeaseAck } from '../../../shared/accessibility-cues'
import { CueCapabilityLeasePublisher } from './accessibility-cue-capability-client'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function ack(generation: number): CueCapabilityLeaseAck {
  return { accepted: true, generation, expiresAt: 10_000 }
}

describe('CueCapabilityLeasePublisher', () => {
  it('drops a stale asynchronous detector response after a newer generation wins', async () => {
    const first = deferred<boolean>()
    const second = deferred<boolean>()
    const invoke = vi.fn(async (_channel, request) => ack(request.generation))
    const publisher = new CueCapabilityLeasePublisher(
      'audio',
      invoke,
      'document-lease-a'
    )

    const stale = publisher.refresh(() => first.promise)
    const current = publisher.refresh(() => second.promise)
    second.resolve(false)
    await current
    first.resolve(true)
    await stale

    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke.mock.calls[0][1]).toMatchObject({
      modality: 'audio',
      generation: 2,
      available: false
    })
  })

  it('publishes an unavailable generation when disposed', async () => {
    const invoke = vi.fn(async (_channel, request) => ack(request.generation))
    const publisher = new CueCapabilityLeasePublisher(
      'haptic',
      invoke,
      'document-lease-b'
    )
    await publisher.refresh(() => true)

    publisher.dispose()
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2))

    expect(invoke.mock.calls[1][1]).toMatchObject({
      modality: 'haptic',
      generation: 2,
      available: false
    })
  })
})
