import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { OUTPUTS_CHANNELS, type OutputRoute } from '../../shared/outputs'
import type { ModuleContext } from '../module-context'
import { register } from './output-router'

describe('output router Expression Studio route ownership', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(process.cwd(), 'output-router-expression-test-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('quarantines old renderer-synced expr:* routes and never resurrects them after v3 deletion', async () => {
    const legacy: OutputRoute = {
      id: 'expr:expr-1:overlay',
      name: 'Legacy',
      enabled: true,
      source: { kind: 'expression', exprId: 'expr-1' },
      target: { kind: 'overlay', name: 'legacy' },
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
    const manual: OutputRoute = {
      id: 'manual',
      name: 'Manual',
      enabled: true,
      source: { kind: 'literal', value: 1 },
      target: { kind: 'dashboardVar', name: 'manual' },
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
    const manualExpression: OutputRoute = {
      id: 'manual-expression',
      name: 'Manual expression',
      enabled: true,
      source: { kind: 'expression', exprId: 'expr-1' },
      target: { kind: 'dashboardVar', name: 'manual-expression' },
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
    writeFileSync(join(root, 'output-routes.json'), JSON.stringify({
      version: 1,
      routes: [legacy, manual, manualExpression],
      updatedAt: '2026-01-01T00:00:00.000Z'
    }))

    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const quit: Array<() => void> = []
    const ctx = {
      app: {
        getPath: () => root,
        once: (_event: string, listener: () => void) => quit.push(listener)
      },
      ipcMain: {
        handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler)
      },
      telemetryHub: { on: () => undefined },
      broadcast: () => undefined
    } as unknown as ModuleContext
    const api = register(ctx)
    const getRoutes = handlers.get(OUTPUTS_CHANNELS.getRoutes)
    expect((await getRoutes?.()) as OutputRoute[]).toEqual([manual, manualExpression])

    api.setExpressionRoutes([legacy], ['expr-1'])
    expect(api.getRoutes().map((route) => route.id)).toEqual([
      'manual',
      'manual-expression',
      'expr:expr-1:overlay'
    ])

    api.setExpressionRoutes([], [])
    expect(api.getRoutes().map((route) => route.id)).toEqual(['manual'])
    quit.forEach((listener) => listener())
  })
})
