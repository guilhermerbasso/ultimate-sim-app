import { describe, expect, it } from 'vitest'
import { CueModalityDeliveryQueue } from './accessibility-cue-arbiter'

describe('CueModalityDeliveryQueue', () => {
  it('delivers every later modality cue in FIFO order without dropping it', async () => {
    const delivered: string[] = []
    const queue = new CueModalityDeliveryQueue<string>(async (item) => {
      delivered.push(item)
      await Promise.resolve()
    })
    queue.enqueue('critical-haptic')
    queue.enqueue('later-flag-haptic')
    queue.enqueue('later-caption-independent-job')
    await queue.whenIdle()
    expect(delivered).toEqual([
      'critical-haptic',
      'later-flag-haptic',
      'later-caption-independent-job'
    ])
  })
})
