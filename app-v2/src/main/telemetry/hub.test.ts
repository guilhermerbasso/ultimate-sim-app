import { describe, it, expect, vi } from 'vitest'
import { dispatchIsolated } from './hub'

describe('dispatchIsolated (telemetry snapshot listener isolation)', () => {
  it('keeps calling later listeners after an earlier one throws', () => {
    // Regression: a throwing telemetry subscriber (e.g. a coaching/predictions module
    // registered BEFORE rev-lights/iFlag) must not starve the LED outputs. Node's
    // EventEmitter.emit() would stop at the throw — dispatchIsolated must not.
    const calls: number[] = []
    const onError = vi.fn()
    const listeners: Array<(arg: number) => void> = [
      () => calls.push(1),
      () => {
        throw new Error('bad subscriber')
      },
      () => calls.push(3) // <- the "rev-lights / iFlag" listener, registered last
    ]

    dispatchIsolated(listeners, 42, onError)

    expect(calls).toEqual([1, 3])
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('passes the argument to every listener and reports each error', () => {
    const seen: number[] = []
    const onError = vi.fn()
    dispatchIsolated(
      [
        (n: number) => seen.push(n),
        () => {
          throw new Error('a')
        },
        () => {
          throw new Error('b')
        },
        (n: number) => seen.push(n * 2)
      ],
      10,
      onError
    )
    expect(seen).toEqual([10, 20])
    expect(onError).toHaveBeenCalledTimes(2)
  })

  it('is a no-op for an empty listener list', () => {
    const onError = vi.fn()
    expect(() => dispatchIsolated([], null, onError)).not.toThrow()
    expect(onError).not.toHaveBeenCalled()
  })
})
