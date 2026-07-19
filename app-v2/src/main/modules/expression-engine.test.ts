import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { EXPR_CHANNELS, type ExpressionResultsBatch } from '../../shared/expr'
import type { ExpressionStudioSnapshot } from '../../shared/expression-studio'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import type { ModuleContext } from '../module-context'
import { CONFIG_SECTION_RELOAD_SIGNAL } from '../../shared/config-io'
import { register } from './expression-engine'

type Handler = (...args: unknown[]) => unknown

describe('expression engine deletion tombstones', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(process.cwd(), 'expression-engine-test-'))
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    rmSync(root, { recursive: true, force: true })
  })

  it('emits a tombstone and clears the result snapshot when an expression is deleted', async () => {
    const handlers = new Map<string, Handler>()
    const telemetryListeners: Array<(snapshot: TelemetrySnapshot | null) => void> = []
    const broadcasts: Array<{ channel: string; payload: unknown }> = []
    const quitListeners: Array<() => void> = []
    const eventListeners = new Map<string, Set<Handler>>()
    const ctx = {
      app: {
        getPath: () => root,
        once: (_event: string, listener: () => void) => quitListeners.push(listener)
      },
      ipcMain: {
        handle: (channel: string, handler: Handler) => handlers.set(channel, handler),
        on: (channel: string, handler: Handler) => {
          const set = eventListeners.get(channel) ?? new Set<Handler>()
          set.add(handler)
          eventListeners.set(channel, set)
        },
        off: (channel: string, handler: Handler) => eventListeners.get(channel)?.delete(handler)
      },
      telemetryHub: {
        on: (_event: string, listener: (snapshot: TelemetrySnapshot | null) => void) => telemetryListeners.push(listener),
        getLatest: () => null
      },
      broadcast: (channel: string, payload: unknown) => broadcasts.push({ channel, payload })
    } as unknown as ModuleContext

    const api = register(ctx)
    const getStudio = handlers.get(EXPR_CHANNELS.getStudio)
    const mutate = handlers.get(EXPR_CHANNELS.mutateStudio)
    expect(getStudio).toBeDefined()
    expect(mutate).toBeDefined()
    const initial = await getStudio?.() as ExpressionStudioSnapshot
    expect(initial.capabilities.map((item) => item.surface)).toEqual(['dashboard', 'overlay', 'oled', 'touch'])
    expect(initial.capabilities.some((item) => (
      item.surface as string
    ) === 'serial' || (item.surface as string) === 'secondScreen')).toBe(false)
    expect(initial.capabilities.find((item) => item.surface === 'oled')).toMatchObject({
      available: false,
      targets: []
    })
    expect(initial.capabilities.find((item) => item.surface === 'touch')).toMatchObject({
      available: false,
      targets: []
    })
    await mutate?.(undefined, {
      revision: initial.revision,
      expressions: [{ id: 'expr-1', name: 'Speed', expr: 'speedKmh' }],
      enabledVars: [],
      outputs: [],
      destinations: []
    })

    telemetryListeners[0]({ speedKmh: 123 } as TelemetrySnapshot)
    await vi.advanceTimersByTimeAsync(100)
    expect(api.getResultsSnapshot()['expr-1']?.value).toBe(123)

    const current = await getStudio?.() as ExpressionStudioSnapshot
    await mutate?.(undefined, {
      revision: current.revision,
      expressions: [
        { id: 'expr-1', name: 'Speed', expr: 'speedKmh' },
        { id: 'expr-never-evaluated', name: 'Never evaluated', expr: 'rpm' }
      ],
      enabledVars: [],
      outputs: [],
      destinations: []
    })
    const withUnevaluated = await getStudio?.() as ExpressionStudioSnapshot
    await mutate?.(undefined, {
      revision: withUnevaluated.revision,
      expressions: [],
      enabledVars: [],
      outputs: [],
      destinations: []
    })
    await vi.advanceTimersByTimeAsync(100)

    const resultBatches = broadcasts
      .filter((entry) => entry.channel === EXPR_CHANNELS.results)
      .map((entry) => entry.payload as ExpressionResultsBatch)
    expect(resultBatches.at(-1)?.results['expr-1']).toEqual({
      name: 'Speed',
      value: null,
      deleted: true
    })
    expect(resultBatches.at(-1)?.results['expr-never-evaluated']).toEqual({
      name: 'Never evaluated',
      value: null,
      deleted: true
    })
    expect(api.getResultsSnapshot()).toEqual({})
    quitListeners.forEach((listener) => listener())
  })

  it('rolls back an invalid imported file and throws through the reload signal', async () => {
    const handlers = new Map<string, Handler>()
    const eventListeners = new Map<string, Set<Handler>>()
    const quitListeners: Array<() => void> = []
    const ctx = {
      app: {
        getPath: () => root,
        once: (_event: string, listener: () => void) => quitListeners.push(listener)
      },
      ipcMain: {
        handle: (channel: string, handler: Handler) => handlers.set(channel, handler),
        on: (channel: string, handler: Handler) => {
          const set = eventListeners.get(channel) ?? new Set<Handler>()
          set.add(handler)
          eventListeners.set(channel, set)
        },
        off: (channel: string, handler: Handler) => eventListeners.get(channel)?.delete(handler)
      },
      telemetryHub: { on: () => undefined, getLatest: () => null },
      broadcast: () => undefined
    } as unknown as ModuleContext

    register(ctx)
    const getStudio = handlers.get(EXPR_CHANNELS.getStudio)
    const mutate = handlers.get(EXPR_CHANNELS.mutateStudio)
    const initial = await getStudio?.() as ExpressionStudioSnapshot
    await mutate?.(undefined, {
      revision: initial.revision,
      expressions: [{ id: 'expr-1', name: 'Valid', expr: 'speedKmh' }],
      enabledVars: [],
      outputs: [],
      destinations: []
    })
    const storePath = join(root, 'expressions.json')
    const previousDisk = JSON.parse(readFileSync(storePath, 'utf8'))
    writeFileSync(storePath, '{"version":3,"expressions":')

    const reload = [...(eventListeners.get(CONFIG_SECTION_RELOAD_SIGNAL) ?? [])][0]
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(() => reload?.({ source: 'config-export' }, 'expressions')).toThrow()
    warn.mockRestore()
    expect(JSON.parse(readFileSync(storePath, 'utf8'))).toEqual(previousDisk)
    expect((await getStudio?.() as ExpressionStudioSnapshot).expressions).toEqual([
      { id: 'expr-1', name: 'Valid', expr: 'speedKmh' }
    ])
    quitListeners.forEach((listener) => listener())
  })
})
