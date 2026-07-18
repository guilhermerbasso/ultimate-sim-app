import { describe, expect, it, vi } from 'vitest'
import {
  ACCESSIBILITY_CUE_PROTOCOL_VERSION,
  DEFAULT_ACCESSIBILITY_CUE_STORE,
  STANDARD_CUE_PROFILE,
  createAccessibilityCueStateEnvelope,
  type AccessibilityCueStateEnvelope
} from '../../../shared/accessibility-cues'
import { CueProfileMutationQueue } from './accessibility-cue-profile-client'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function envelope(revision: number): AccessibilityCueStateEnvelope {
  return {
    ...createAccessibilityCueStateEnvelope(
      {
        ...DEFAULT_ACCESSIBILITY_CUE_STORE,
        revision
      },
      true
    ),
    revision
  }
}

describe('CueProfileMutationQueue', () => {
  it('serializes rapid saves and advances expected revisions without losing edits', async () => {
    const first = deferred<AccessibilityCueStateEnvelope>()
    const second = deferred<AccessibilityCueStateEnvelope>()
    const invoke = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    const applied: AccessibilityCueStateEnvelope[] = []
    const queue = new CueProfileMutationQueue(envelope(1), invoke, (next) => {
      applied.push(next)
    })

    const saveOne = queue.save({
      ...STANDARD_CUE_PROFILE,
      textScale: 1.1
    })
    const saveTwo = queue.save({
      ...STANDARD_CUE_PROFILE,
      textScale: 1.2,
      highContrast: true
    })

    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1))
    expect(invoke.mock.calls[0][1]).toMatchObject({
      protocolVersion: ACCESSIBILITY_CUE_PROTOCOL_VERSION,
      expectedRevision: 1,
      profile: { textScale: 1.1 }
    })

    first.resolve(envelope(2))
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2))
    expect(invoke.mock.calls[1][1]).toMatchObject({
      expectedRevision: 2,
      profile: { textScale: 1.2, highContrast: true }
    })

    second.resolve(envelope(3))
    await Promise.all([saveOne, saveTwo])
    expect(queue.current.revision).toBe(3)
    expect(applied.at(-1)?.revision).toBe(3)
    expect(applied.some((item) => item.revision === 2)).toBe(false)
  })

  it('accepts newer version broadcasts and ignores stale ones', () => {
    const applied: number[] = []
    const queue = new CueProfileMutationQueue(
      envelope(3),
      vi.fn(),
      (next) => applied.push(next.revision)
    )
    queue.acceptBroadcast(envelope(2))
    queue.acceptBroadcast({
      ...envelope(5),
      protocolVersion: 99
    } as unknown as AccessibilityCueStateEnvelope)
    queue.acceptBroadcast(envelope(4))
    expect(queue.current.revision).toBe(4)
    expect(applied).toEqual([4])
  })
})
