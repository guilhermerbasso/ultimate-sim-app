import { describe, expect, it } from 'vitest'
import type { Dashboard } from '../../../shared/dashboards'
import type { TelemetrySnapshot } from '../../../shared/telemetry'
import { subscribeWithRevisionedHydration, subscribeWithTelemetryHydration } from './hydration'

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

describe('subscribeWithRevisionedHydration', () => {
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

    subscribeWithRevisionedHydration({
      subscribe: (listener) => {
        emit = listener
        return () => {}
      },
      hydrate: () => initial.promise,
      revision: (value) => value?.updatedAt ?? Number.NEGATIVE_INFINITY,
      apply: (value) => applied.push(value)
    })

    emit(dashboard)
    initial.resolve(null)
    await initial.promise
    await Promise.resolve()

    expect(applied).toEqual([dashboard])
  })

  it('lets a newer hydrated save replace an older startup event', async () => {
    const initial = deferred<Dashboard | null>()
    const applied: Array<Dashboard | null> = []
    let emit!: (value: Dashboard | null) => void
    const stale = {
      id: 'restored-dashboard',
      name: 'Before save',
      width: 1024,
      height: 600,
      bg: '#000',
      elements: [],
      updatedAt: 1
    } satisfies Dashboard
    const current = { ...stale, name: 'After save', updatedAt: 2 } satisfies Dashboard

    subscribeWithRevisionedHydration({
      subscribe: (listener) => {
        emit = listener
        return () => {}
      },
      hydrate: () => initial.promise,
      revision: (value) => value?.updatedAt ?? Number.NEGATIVE_INFINITY,
      apply: (value) => applied.push(value)
    })

    emit(stale)
    initial.resolve(current)
    await initial.promise
    await Promise.resolve()

    expect(applied).toEqual([stale, current])
  })

  it('ignores an older dashboard broadcast after a newer one', async () => {
    const initial = deferred<Dashboard | null>()
    const applied: Array<Dashboard | null> = []
    let emit!: (value: Dashboard | null) => void
    const newer = {
      id: 'restored-dashboard',
      name: 'Newer',
      width: 1024,
      height: 600,
      bg: '#000',
      elements: [],
      updatedAt: 3
    } satisfies Dashboard
    const older = { ...newer, name: 'Older', updatedAt: 2 } satisfies Dashboard

    subscribeWithRevisionedHydration({
      subscribe: (listener) => {
        emit = listener
        return () => {}
      },
      hydrate: () => initial.promise,
      revision: (value) => value?.updatedAt ?? Number.NEGATIVE_INFINITY,
      apply: (value) => applied.push(value)
    })

    emit(newer)
    emit(older)
    initial.resolve(older)
    await initial.promise
    await Promise.resolve()

    expect(applied).toEqual([newer])
  })
})

describe('subscribeWithTelemetryHydration', () => {
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

    subscribeWithTelemetryHydration({
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

  it('accepts a live snapshot-to-null disconnect and rejects a late hydrated snapshot', async () => {
    const initial = deferred<TelemetrySnapshot | null>()
    const applied: Array<TelemetrySnapshot | null> = []
    let emit!: (value: TelemetrySnapshot | null) => void
    const live = { sim: 'mock', connected: true, timestamp: 2 } as TelemetrySnapshot
    const hydrated = { sim: 'mock', connected: true, timestamp: 3 } as TelemetrySnapshot

    subscribeWithTelemetryHydration({
      subscribe: (listener) => {
        emit = listener
        return () => {}
      },
      hydrate: () => initial.promise,
      apply: (value) => applied.push(value)
    })

    emit(live)
    emit(null)
    initial.resolve(hydrated)
    await initial.promise
    await Promise.resolve()

    expect(applied).toEqual([live, null])
  })

  it('accepts a live null-to-snapshot reconnect in emission order', async () => {
    const initial = deferred<TelemetrySnapshot | null>()
    const applied: Array<TelemetrySnapshot | null> = []
    let emit!: (value: TelemetrySnapshot | null) => void
    const live = { sim: 'mock', connected: true, timestamp: 4 } as TelemetrySnapshot
    const stale = { sim: 'mock', connected: true, timestamp: 3 } as TelemetrySnapshot

    subscribeWithTelemetryHydration({
      subscribe: (listener) => {
        emit = listener
        return () => {}
      },
      hydrate: () => initial.promise,
      apply: (value) => applied.push(value)
    })

    emit(null)
    emit(live)
    initial.resolve(stale)
    await initial.promise
    await Promise.resolve()

    expect(applied).toEqual([null, live])
  })
})
