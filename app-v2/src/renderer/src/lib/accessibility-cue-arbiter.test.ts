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

  it('preempts an active warning and drops queued warnings for a critical cue', async () => {
    const delivered: string[] = []
    const preempted: string[] = []
    const queue = new CueModalityDeliveryQueue<string>(
      async (item, signal) => {
        delivered.push(item)
        if (item.startsWith('warning')) {
          await new Promise<void>((resolve) => {
            signal.addEventListener('abort', () => resolve(), { once: true })
          })
        }
      },
      { onPreempt: (item) => preempted.push(item) }
    )

    queue.enqueue('warning-active', { key: 'warning-active', priority: 1 })
    queue.enqueue('warning-queued-1', { key: 'warning-1', priority: 1 })
    queue.enqueue('warning-queued-2', { key: 'warning-2', priority: 1 })
    queue.enqueue('critical', { key: 'critical', priority: 2 })
    await queue.whenIdle()

    expect(preempted).toEqual(['warning-active'])
    expect(delivered).toEqual(['warning-active', 'critical'])
  })

  it('replaces pending work by semantic key and bounds retained history', async () => {
    let release = (): void => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const delivered: string[] = []
    const queue = new CueModalityDeliveryQueue<string>(
      async (item) => {
        delivered.push(item)
        if (item === 'blocker') await gate
      },
      { maxPending: 3 }
    )

    queue.enqueue('blocker')
    queue.enqueue('old-same-key', { key: 'same', priority: 1 })
    queue.enqueue('new-same-key', { key: 'same', priority: 1 })
    for (let index = 0; index < 5; index += 1) {
      queue.enqueue(`warning-${index}`, {
        key: `warning-${index}`,
        priority: 1
      })
    }
    release()
    await queue.whenIdle()

    expect(delivered).toEqual([
      'blocker',
      'warning-2',
      'warning-3',
      'warning-4'
    ])
    expect(delivered).not.toContain('old-same-key')
    expect(delivered).not.toContain('new-same-key')
  })

  it('delivers only the newest pending cue for one semantic key', async () => {
    let release = (): void => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const delivered: string[] = []
    const queue = new CueModalityDeliveryQueue<string>(async (item) => {
      delivered.push(item)
      if (item === 'blocker') await gate
    })

    queue.enqueue('blocker')
    queue.enqueue('old', { key: 'same', priority: 1 })
    queue.enqueue('new', { key: 'same', priority: 1 })
    release()
    await queue.whenIdle()

    expect(delivered).toEqual(['blocker', 'new'])
  })
})
