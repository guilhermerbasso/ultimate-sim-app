import { describe, expect, it } from 'vitest'
import type { Dashboard } from '../../../shared/dashboards'
import type { TelemetrySnapshot } from '../../../shared/telemetry'
import { subscribeWithHydration } from './hydration'

function deferred<T>(): {
  promise: Promise<T>
  resolve(value: T): void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('subscribeWithHydration', () => {
  it('keeps a restored dashboard update when the initial IPC lookup resolves late with null', async () => {
    const initial = deferred<Dashboard | null>()
    const applied: Array<Dashboard | null> = []
    let emit!: (value: Dashboard | null) => void
    const dashboard = {
      id: 'restored-dashboard',
      name: 'Restored dashboard',
      width: 1024,
      height: 600,
      bg: '#000',
      elements: []
    } satisfies Dashboard

    subscribeWithHydration({
      subscribe: (listener) => {
        emit = listener
        return () => {}
      },
      hydrate: () => initial.promise,
      apply: (value) => applied.push(value)
    })

    emit(dashboard)
    initial.resolve(null)
    await initial.promise
    await Promise.resolve()

    expect(applied).toEqual([dashboard])
  })

  it('does not let a stale telemetry seed overwrite a newer live snapshot', async () => {
    const initial = deferred<TelemetrySnapshot | null>()
    const applied: Array<TelemetrySnapshot | null> = []
    let emit!: (value: TelemetrySnapshot | null) => void
    const live = {
      sim: 'mock',
      connected: true,
      timestamp: 2
    } as TelemetrySnapshot
    const stale = {
      sim: 'mock',
      connected: false,
      timestamp: 1
    } as TelemetrySnapshot

    subscribeWithHydration({
      subscribe: (listener) => {
        emit = listener
        return () => {}
      },
      hydrate: () => initial.promise,
      apply: (value) => applied.push(value)
    })

    emit(live)
    initial.resolve(stale)
    await initial.promise
    await Promise.resolve()

    expect(applied).toEqual([live])
  })
})
