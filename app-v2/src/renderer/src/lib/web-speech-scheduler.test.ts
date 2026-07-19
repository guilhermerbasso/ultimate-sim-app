import { describe, expect, it, vi } from 'vitest'
import { WebSpeechScheduler } from './web-speech-scheduler'

type TestUtterance = SpeechSynthesisUtterance & { label: string }

function utterance(label: string): TestUtterance {
  return {
    label,
    onend: null,
    onerror: null
  } as unknown as TestUtterance
}

function harness() {
  const spoken: TestUtterance[] = []
  const cancel = vi.fn()
  const scheduler = new WebSpeechScheduler({
    speak: (item) => spoken.push(item as TestUtterance),
    cancel
  })
  const enqueue = (
    label: string,
    channel: string,
    priority: number,
    semanticKey = label,
    generation = 1
  ) => {
    const item = utterance(label)
    const result = scheduler.enqueue({
      channel,
      generation,
      semanticKey,
      priority,
      utterance: item
    })
    return { item, result }
  }
  return { scheduler, spoken, cancel, enqueue }
}

describe('WebSpeechScheduler', () => {
  it('preview cancellation removes only preview work while critical live speech owns the engine', async () => {
    const test = harness()
    const live = test.enqueue('live-critical', 'accessibility-live', 2)
    const preview = test.enqueue('preview', 'accessibility-preview', 0)

    test.scheduler.cancelChannel('accessibility-preview')

    expect(test.cancel).not.toHaveBeenCalled()
    expect(test.spoken.map((item) => item.label)).toEqual(['live-critical'])
    await expect(preview.result).resolves.toBe(false)
    live.item.onend?.(new Event('end') as SpeechSynthesisEvent)
    await expect(live.result).resolves.toBe(true)
  })

  it('critical live speech preempts and cancels active preview exactly once', async () => {
    const test = harness()
    const preview = test.enqueue('preview', 'accessibility-preview', 0)
    const critical = test.enqueue('critical', 'accessibility-live', 2)

    expect(test.cancel).toHaveBeenCalledTimes(1)
    expect(test.spoken.map((item) => item.label)).toEqual([
      'preview',
      'critical'
    ])
    await expect(preview.result).resolves.toBe(false)
    critical.item.onend?.(new Event('end') as SpeechSynthesisEvent)
    await expect(critical.result).resolves.toBe(true)
  })

  it('preview restart cancels only the active preview and starts its replacement', async () => {
    const test = harness()
    const first = test.enqueue('preview-old', 'accessibility-preview', 0)
    test.scheduler.cancelChannel('accessibility-preview')
    const replacement = test.enqueue(
      'preview-new',
      'accessibility-preview',
      0
    )

    expect(test.cancel).toHaveBeenCalledTimes(1)
    expect(test.spoken.map((item) => item.label)).toEqual([
      'preview-old',
      'preview-new'
    ])
    await expect(first.result).resolves.toBe(false)
    replacement.item.onend?.(new Event('end') as SpeechSynthesisEvent)
    await expect(replacement.result).resolves.toBe(true)
  })

  it('orders queued live work ahead of preview and dedupes semantic identity', async () => {
    const test = harness()
    const blocker = test.enqueue('blocker', 'accessibility-live', 3)
    const oldPreview = test.enqueue(
      'preview-old',
      'accessibility-preview',
      0,
      'preview-key'
    )
    const newPreview = test.enqueue(
      'preview-new',
      'accessibility-preview',
      0,
      'preview-key'
    )
    const warning = test.enqueue('live-warning', 'accessibility-live', 1)

    blocker.item.onend?.(new Event('end') as SpeechSynthesisEvent)
    warning.item.onend?.(new Event('end') as SpeechSynthesisEvent)
    newPreview.item.onend?.(new Event('end') as SpeechSynthesisEvent)

    expect(test.spoken.map((item) => item.label)).toEqual([
      'blocker',
      'live-warning',
      'preview-new'
    ])
    await expect(oldPreview.result).resolves.toBe(false)
    await expect(blocker.result).resolves.toBe(true)
    await expect(warning.result).resolves.toBe(true)
    await expect(newPreview.result).resolves.toBe(true)
    expect(test.cancel).not.toHaveBeenCalled()
  })

  it('teardown cancels current speech once and settles every queued channel', async () => {
    const test = harness()
    const current = test.enqueue('live', 'accessibility-live', 2)
    const queued = test.enqueue('preview', 'accessibility-preview', 0)

    test.scheduler.cancelAll()

    expect(test.cancel).toHaveBeenCalledTimes(1)
    await expect(current.result).resolves.toBe(false)
    await expect(queued.result).resolves.toBe(false)
  })

  it('rejects stale queued generations for the same semantic identity', async () => {
    const test = harness()
    const blocker = test.enqueue('blocker', 'accessibility-live', 2)
    const current = test.enqueue(
      'current-generation',
      'accessibility-preview',
      0,
      'same-key',
      2
    )
    const stale = test.enqueue(
      'stale-generation',
      'accessibility-preview',
      0,
      'same-key',
      1
    )

    await expect(stale.result).resolves.toBe(false)
    blocker.item.onend?.(new Event('end') as SpeechSynthesisEvent)
    current.item.onend?.(new Event('end') as SpeechSynthesisEvent)
    await expect(blocker.result).resolves.toBe(true)
    await expect(current.result).resolves.toBe(true)
    expect(test.spoken.map((item) => item.label)).toEqual([
      'blocker',
      'current-generation'
    ])
  })
})
