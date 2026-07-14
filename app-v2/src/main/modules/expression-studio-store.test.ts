import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ExpressionStudioStore } from './expression-studio-store'
import type { ExpressionStudioPayload } from '../../shared/expression-studio'

function mutation(revision: number, name = 'Expression') {
  return {
    revision,
    expressions: [{ id: 'expr-1', name, expr: 'speedKmh' }],
    enabledVars: ['Speed'],
    outputs: [],
    destinations: []
  }
}

describe('ExpressionStudioStore atomic persistence and CAS', () => {
  let root: string
  let path: string

  beforeEach(() => {
    root = mkdtempSync(join(process.cwd(), 'expression-studio-store-test-'))
    path = join(root, 'expressions.json')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('atomically migrates v2 on load and persists only the v3 shape', async () => {
    writeFileSync(path, JSON.stringify({
      version: 2,
      expressions: [{
        id: 'keep-id',
        name: 'Keep formula',
        expr: ' rpm > 7000 ',
        targets: [{ kind: 'overlay', name: 'legacy' }]
      }],
      enabledVars: ['Speed']
    }))

    const store = new ExpressionStudioStore(path, { now: () => '2026-07-14T00:00:00.000Z' })
    const loaded = await store.load()
    const disk = JSON.parse(readFileSync(path, 'utf8')) as ExpressionStudioPayload

    expect(loaded.expressions).toEqual([{ id: 'keep-id', name: 'Keep formula', expr: ' rpm > 7000 ' }])
    expect(loaded.destinations).toEqual([])
    expect(loaded.outputs).toHaveLength(1)
    expect(disk).toEqual(loaded)
    expect(disk.version).toBe(3)
  })

  it('leaves the legacy file intact when the atomic migration write fails', async () => {
    const legacy = JSON.stringify({
      version: 2,
      expressions: [{ id: 'keep-id', name: 'Keep', expr: 'rpm' }],
      enabledVars: []
    })
    writeFileSync(path, legacy)
    const store = new ExpressionStudioStore(path, {
      writeAtomic: async () => {
        throw new Error('migration write failed')
      }
    })

    await expect(store.load()).rejects.toThrow('migration write failed')
    expect(readFileSync(path, 'utf8')).toBe(legacy)
  })

  it('checks the revision and increments it once per successful full mutation', async () => {
    const store = new ExpressionStudioStore(path)
    await store.load()
    const first = await store.mutate(mutation(0, 'First'))
    expect(first.revision).toBe(1)
    expect(first.expressions[0].name).toBe('First')

    await expect(store.mutate(mutation(0, 'Stale'))).rejects.toThrow('EXPRESSION_REVISION_CONFLICT')
    expect(store.snapshot()).toEqual(first)
  })

  it('keeps memory and disk unchanged when the atomic write fails', async () => {
    const bootstrap = new ExpressionStudioStore(path)
    const original = await bootstrap.load()
    const originalDisk = readFileSync(path, 'utf8')
    const failing = new ExpressionStudioStore(path, {
      writeAtomic: async () => {
        throw new Error('disk unavailable')
      }
    })
    await failing.load()

    await expect(failing.mutate(mutation(0, 'Must not commit'))).rejects.toThrow('disk unavailable')
    expect(failing.snapshot()).toEqual(original)
    expect(readFileSync(path, 'utf8')).toBe(originalDisk)
  })

  it('hot-applies imports with outputs and destinations disabled by default', async () => {
    const store = new ExpressionStudioStore(path, { now: () => '2026-07-14T00:00:00.000Z' })
    await store.load()
    writeFileSync(path, JSON.stringify({
      version: 3,
      revision: 99,
      expressions: [{ id: 'expr-1', name: 'Imported', expr: 'speedKmh' }],
      enabledVars: ['Speed'],
      outputs: [{
        id: 'switch',
        name: 'Switch',
        enabled: true,
        source: { kind: 'expression', exprId: 'expr-1' },
        target: { kind: 'dashboard', dashboardId: 'missing', dashboardName: 'Missing' },
        updatedAt: '2026-07-01T00:00:00.000Z'
      }],
      destinations: [{
        id: 'dest',
        source: { expressionId: 'expr-1' },
        surface: 'dashboard',
        targetId: 'missing',
        presentation: 'value',
        geometry: { x: 0, y: 0, width: 100, height: 50 },
        format: {},
        enabled: true
      }],
      updatedAt: '2026-07-01T00:00:00.000Z'
    }))

    const imported = await store.reloadImported()
    expect(imported.revision).toBe(1)
    expect(imported.outputs[0].enabled).toBe(false)
    expect(imported.destinations[0]).toMatchObject({ targetId: 'missing', enabled: false })
  })
})
