import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  GracefulQuitController,
  GracefulTeardownRegistry,
  TeardownTimeoutError,
  runOrderedGracefulTeardown
} from './module-context'

function never(): Promise<void> {
  return new Promise<void>(() => undefined)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

afterEach(() => {
  vi.useRealTimers()
})

describe('graceful before-quit lifecycle', () => {
  it('never allows forced quit before multi-device hardware watchdogs fully settle', async () => {
    vi.useFakeTimers()
    const registry = new GracefulTeardownRegistry()
    const events: string[] = []
    const errors = vi.fn()
    const quit = vi.fn(() => events.push('quit'))
    const firstEvent = { preventDefault: vi.fn() }
    const secondEvent = { preventDefault: vi.fn() }

    registry.register(() => {
      events.push('producers-quiesced')
    }, 'quiesce')
    registry.register(async () => {
      events.push('persistence-started')
      await never()
    }, 'persistence')

    const controller = new GracefulQuitController({
      teardown: () =>
        runOrderedGracefulTeardown({
          registry,
          quiesceTimeoutMs: 750,
          outputOff: [
            {
              stage: 'iflag-rgb-off',
              timeoutMs: 750,
              task: async () => {
                events.push('rgb-device-1-off')
                await delay(300)
                events.push('rgb-device-2-off')
                await delay(300)
                events.push('rgb-all-drained')
              }
            },
            {
              stage: 'revlights-off',
              timeoutMs: 750,
              task: async () => {
                events.push('revlights-started')
                await never()
              }
            }
          ],
          drain: [
            {
              stage: 'serial-drain',
              timeoutMs: 750,
              task: async () => {
                events.push('serial-started')
                await never()
              }
            },
            {
              stage: 'telemetry-dispose',
              timeoutMs: 750,
              task: () => {
                events.push('telemetry-disposed')
              }
            }
          ],
          persistenceTimeoutMs: 2_500,
          onError: errors
        }),
      quit
    })

    controller.handleBeforeQuit(firstEvent)
    controller.handleBeforeQuit(secondEvent)
    await vi.advanceTimersByTimeAsync(600)
    expect(events).toContain('rgb-all-drained')
    expect(events).not.toContain('serial-started')
    expect(quit).not.toHaveBeenCalled()
    expect(firstEvent.preventDefault).toHaveBeenCalledOnce()
    expect(secondEvent.preventDefault).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(899)
    expect(events).toContain('serial-started')
    expect(events).not.toContain('persistence-started')
    expect(quit).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(events).toContain('telemetry-disposed')
    expect(events).toContain('persistence-started')
    expect(quit).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(2_499)
    expect(quit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(quit).toHaveBeenCalledOnce()
    expect(events.at(-1)).toBe('quit')

    const finalEvent = { preventDefault: vi.fn() }
    controller.handleBeforeQuit(finalEvent)
    expect(finalEvent.preventDefault).not.toHaveBeenCalled()
    expect(errors.mock.calls.map(([stage]) => stage)).toEqual([
      'revlights-off',
      'serial-drain',
      'persistence'
    ])
    for (const [, error] of errors.mock.calls) expect(error).toBeInstanceOf(TeardownTimeoutError)
  })

  it('bounds a never-settling quiesce phase and still completes later teardown stages', async () => {
    vi.useFakeTimers()
    const registry = new GracefulTeardownRegistry()
    const events: string[] = []
    const errors = vi.fn()
    const quit = vi.fn(() => events.push('quit'))
    const firstEvent = { preventDefault: vi.fn() }
    const repeatedEvent = { preventDefault: vi.fn() }

    registry.register(async () => {
      events.push('quiesce-started')
      await never()
    }, 'quiesce')
    registry.register(() => {
      events.push('persisted')
    }, 'persistence')

    const controller = new GracefulQuitController({
      teardown: () =>
        runOrderedGracefulTeardown({
          registry,
          quiesceTimeoutMs: 500,
          outputOff: [{
            stage: 'hardware-off',
            timeoutMs: 100,
            task: () => {
              events.push('hardware-off')
            }
          }],
          drain: [{
            stage: 'serial-drain',
            timeoutMs: 100,
            task: () => {
              events.push('serial-drained')
            }
          }],
          persistenceTimeoutMs: 100,
          onError: errors
        }),
      quit
    })

    controller.handleBeforeQuit(firstEvent)
    controller.handleBeforeQuit(repeatedEvent)
    await vi.advanceTimersByTimeAsync(499)
    expect(events).toEqual(['quiesce-started'])
    expect(quit).not.toHaveBeenCalled()
    expect(firstEvent.preventDefault).toHaveBeenCalledOnce()
    expect(repeatedEvent.preventDefault).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(1)
    expect(events).toEqual([
      'quiesce-started',
      'hardware-off',
      'serial-drained',
      'persisted',
      'quit'
    ])
    expect(errors).toHaveBeenCalledOnce()
    expect(errors).toHaveBeenCalledWith('quiesce', expect.any(TeardownTimeoutError))
    expect(quit).toHaveBeenCalledOnce()

    const finalEvent = { preventDefault: vi.fn() }
    controller.handleBeforeQuit(finalEvent)
    expect(finalEvent.preventDefault).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('allows a legitimate slow RGB shutdown but still bounds a stuck RGB operation', async () => {
    vi.useFakeTimers()
    const registry = new GracefulTeardownRegistry()
    const events: string[] = []
    const errors = vi.fn()
    registry.register(() => {
      events.push('persisted')
    }, 'persistence')

    const completed = runOrderedGracefulTeardown({
      registry,
      quiesceTimeoutMs: 100,
      outputOff: [{
        stage: 'iflag-rgb-off',
        timeoutMs: 2_000,
        task: async () => {
          events.push('rgb-started')
          await delay(1_200)
          events.push('rgb-complete')
        }
      }],
      drain: [{
        stage: 'serial-drain',
        timeoutMs: 100,
        task: () => {
          events.push('serial-drained')
        }
      }],
      persistenceTimeoutMs: 100,
      onError: errors
    })

    await vi.advanceTimersByTimeAsync(1_000)
    expect(events).toEqual(['rgb-started'])
    expect(errors).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(200)
    await completed
    expect(events).toEqual(['rgb-started', 'rgb-complete', 'serial-drained', 'persisted'])
    expect(errors).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)

    const stuckRegistry = new GracefulTeardownRegistry()
    const stuckEvents: string[] = []
    const stuckErrors = vi.fn()
    stuckRegistry.register(() => {
      stuckEvents.push('persisted')
    }, 'persistence')
    const stuck = runOrderedGracefulTeardown({
      registry: stuckRegistry,
      quiesceTimeoutMs: 100,
      outputOff: [{
        stage: 'iflag-rgb-off',
        timeoutMs: 2_000,
        task: async () => {
          stuckEvents.push('rgb-started')
          await never()
        }
      }],
      drain: [{
        stage: 'serial-drain',
        timeoutMs: 100,
        task: () => {
          stuckEvents.push('serial-drained')
        }
      }],
      persistenceTimeoutMs: 100,
      onError: stuckErrors
    })

    await vi.advanceTimersByTimeAsync(1_999)
    expect(stuckEvents).toEqual(['rgb-started'])
    expect(stuckErrors).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    await stuck
    expect(stuckEvents).toEqual(['rgb-started', 'serial-drained', 'persisted'])
    expect(stuckErrors).toHaveBeenCalledOnce()
    expect(stuckErrors).toHaveBeenCalledWith('iflag-rgb-off', expect.any(TeardownTimeoutError))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reports phase errors and continues through later hardware and persistence work', async () => {
    const registry = new GracefulTeardownRegistry()
    const events: string[] = []
    const errors = vi.fn()
    registry.register(() => {
      throw new Error('quiesce failed')
    }, 'quiesce')
    registry.register(() => {
      events.push('persisted')
    }, 'persistence')

    await runOrderedGracefulTeardown({
      registry,
      quiesceTimeoutMs: 100,
      outputOff: [{
        stage: 'hardware-off',
        timeoutMs: 100,
        task: () => {
          events.push('hardware-off')
        }
      }],
      drain: [],
      persistenceTimeoutMs: 100,
      onError: errors
    })

    expect(events).toEqual(['hardware-off', 'persisted'])
    expect(errors).toHaveBeenCalledWith('quiesce', expect.objectContaining({ message: 'quiesce failed' }))
  })
})
