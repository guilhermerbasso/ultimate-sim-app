// Regression guard for audit P0-13 / §24-13: "invalidate expression output on
// error / when stale".
//
// Before the fix, the engine's evaluation loop was:
//
//   try { value = evaluateExpression(formula, scope) } catch { continue }
//
// `continue` left the LAST GOOD value in `this.results`, so the output-router
// resolver (`modules/index.ts`: `getResultsSnapshot()[exprId]?.value`) kept
// handing it out on every tick after the failure. A serial device, a second
// screen and a dashboard variable therefore went on displaying and driving a
// value that no longer existed, with no indication whatsoever — exactly the
// audit's acceptance criterion: "output físico/alerta nunca mantém valor
// inválido sem indicação".
//
// This test wires the engine to the router the same way `modules/index.ts` does,
// drives a REAL telemetry tick that evaluates successfully, then a REAL tick that
// makes the same expression throw (`1000 / rpm` with rpm = 0 → "Division by
// zero" — an engine stall or a car sitting in the pits), and asserts the value is
// no longer presented as valid anywhere downstream.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EXPR_CHANNELS } from '../../shared/expr'
import type { ExpressionStudioSnapshot } from '../../shared/expression-studio'
import { OUTPUTS_CHANNELS, type OutputRoute, type OutputSecondScreenUpdate } from '../../shared/outputs'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import type { ModuleContext } from '../module-context'
import { register as registerExpressionEngine } from './expression-engine'
import { register as registerOutputRouter } from './output-router'

type Handler = (...args: unknown[]) => unknown

const EXPR_ID = 'expr-fuel-per-lap'
const ROUTE_ID = 'route-second-screen'
const SERIAL_ROUTE_ID = 'route-serial'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(process.cwd(), 'expr-invalidation-test-'))
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  rmSync(root, { recursive: true, force: true })
})

interface Harness {
  readonly tick: (snapshot: TelemetrySnapshot) => Promise<void>
  readonly resultFor: (exprId: string) => { value: unknown; error?: true } | undefined
  readonly secondScreenWrites: () => OutputSecondScreenUpdate[]
  readonly serialWrites: string[]
  readonly batchedUpdates: () => Array<{ routeId: string; value: string; invalid?: true }>
}

async function buildHarness(): Promise<Harness> {
  const expressionRoute: OutputRoute = {
    id: ROUTE_ID,
    name: 'Fuel per lap',
    enabled: true,
    source: { kind: 'expression', exprId: EXPR_ID },
    target: { kind: 'secondScreen', slot: 'fuelPerLap' },
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
  const serialRoute: OutputRoute = {
    id: SERIAL_ROUTE_ID,
    name: 'Fuel per lap (SIM-X)',
    enabled: true,
    source: { kind: 'expression', exprId: EXPR_ID },
    target: { kind: 'serial', template: 'FUEL:${value}\n' },
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
  writeFileSync(
    join(root, 'output-routes.json'),
    JSON.stringify({ version: 1, routes: [expressionRoute, serialRoute], updatedAt: '2026-01-01T00:00:00.000Z' })
  )

  const handlers = new Map<string, Handler>()
  const telemetryListeners: Array<(snapshot: TelemetrySnapshot | null) => void> = []
  const broadcasts: Array<{ channel: string; payload: unknown }> = []
  const serialWrites: string[] = []
  const eventListeners = new Map<string, Set<Handler>>()

  const ctx = {
    app: {
      getPath: () => root,
      once: () => undefined
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
      on: (_event: string, listener: (snapshot: TelemetrySnapshot | null) => void) =>
        telemetryListeners.push(listener),
      getLatest: () => null
    },
    serialHub: {
      getPrimary: () => ({
        isOpen: () => true,
        sendRaw: (payload: string) => {
          serialWrites.push(payload)
          return Promise.resolve()
        }
      }),
      getDevice: () => undefined
    },
    broadcast: (channel: string, payload: unknown) => broadcasts.push({ channel, payload })
  } as unknown as ModuleContext

  // Same wiring order and same resolver as src/main/modules/index.ts.
  const exprApi = registerExpressionEngine(ctx)
  const routerApi = registerOutputRouter(ctx)
  routerApi.setExpressionResolver((exprId) => exprApi.getResultsSnapshot()[exprId]?.value ?? undefined)

  await handlers.get(OUTPUTS_CHANNELS.getRoutes)?.()

  const getStudio = handlers.get(EXPR_CHANNELS.getStudio)
  const mutate = handlers.get(EXPR_CHANNELS.mutateStudio)
  const initial = (await getStudio?.()) as ExpressionStudioSnapshot
  await mutate?.(undefined, {
    revision: initial.revision,
    // Throws ExpressionError("Division by zero") the moment rpm reaches 0.
    expressions: [{ id: EXPR_ID, name: 'Fuel per lap', expr: '1000 / rpm' }],
    enabledVars: [],
    outputs: [],
    destinations: []
  })

  return {
    tick: async (snapshot) => {
      for (const listener of telemetryListeners) listener(snapshot)
      await vi.advanceTimersByTimeAsync(150)
    },
    resultFor: (exprId) => exprApi.getResultsSnapshot()[exprId],
    secondScreenWrites: () =>
      broadcasts
        .filter((entry) => entry.channel === OUTPUTS_CHANNELS.secondScreen)
        .map((entry) => entry.payload as OutputSecondScreenUpdate),
    serialWrites,
    batchedUpdates: () =>
      broadcasts
        .filter((entry) => entry.channel === OUTPUTS_CHANNELS.value)
        .flatMap(
          (entry) => (entry.payload as { updates: Array<{ routeId: string; value: string; invalid?: true }> }).updates
        )
  }
}

describe('expression output invalidation (audit P0-13 / §24-13)', () => {
  it('does not keep the last good value in the engine snapshot after an evaluation error', async () => {
    const harness = await buildHarness()

    await harness.tick({ rpm: 5000 } as TelemetrySnapshot)
    expect(harness.resultFor(EXPR_ID)?.value).toBe(0.2)

    await harness.tick({ rpm: 0 } as TelemetrySnapshot)

    expect(harness.resultFor(EXPR_ID)).toMatchObject({ value: null, error: true })
    expect(harness.resultFor(EXPR_ID)?.value).not.toBe(0.2)
  })

  it('stops resolving a failed expression for the output router instead of latching it', async () => {
    const harness = await buildHarness()

    await harness.tick({ rpm: 5000 } as TelemetrySnapshot)
    await harness.tick({ rpm: 0 } as TelemetrySnapshot)

    const secondScreen = harness.secondScreenWrites()
    expect(secondScreen.length).toBeGreaterThanOrEqual(2)
    // The physical slot must be CLEARED, not left holding the last good reading.
    expect(secondScreen.at(-1)).toMatchObject({ slot: 'fuelPerLap', value: '', raw: null })
    expect(secondScreen.at(-1)?.value).not.toBe('0.2')
  })

  it('clears the serial output instead of leaving the previous value on the device', async () => {
    const harness = await buildHarness()

    await harness.tick({ rpm: 5000 } as TelemetrySnapshot)
    expect(harness.serialWrites).toEqual(['FUEL:0.2\n'])

    await harness.tick({ rpm: 0 } as TelemetrySnapshot)

    expect(harness.serialWrites).toEqual(['FUEL:0.2\n', 'FUEL:\n'])
  })

  it('broadcasts exactly one invalidation, not one per failing tick', async () => {
    const harness = await buildHarness()

    await harness.tick({ rpm: 5000 } as TelemetrySnapshot)
    await harness.tick({ rpm: 0 } as TelemetrySnapshot)
    await harness.tick({ rpm: 0 } as TelemetrySnapshot)
    await harness.tick({ rpm: 0 } as TelemetrySnapshot)

    const invalidations = harness.batchedUpdates().filter((update) => update.invalid === true)
    expect(invalidations.map((update) => update.routeId).sort()).toEqual([ROUTE_ID, SERIAL_ROUTE_ID])
  })

  it('recovers cleanly once the expression evaluates again', async () => {
    const harness = await buildHarness()

    await harness.tick({ rpm: 5000 } as TelemetrySnapshot)
    await harness.tick({ rpm: 0 } as TelemetrySnapshot)
    await harness.tick({ rpm: 2500 } as TelemetrySnapshot)

    expect(harness.resultFor(EXPR_ID)).toMatchObject({ value: 0.4 })
    expect(harness.resultFor(EXPR_ID)?.error).toBeUndefined()
    expect(harness.secondScreenWrites().at(-1)).toMatchObject({ slot: 'fuelPerLap', value: '0.4' })
  })
})
