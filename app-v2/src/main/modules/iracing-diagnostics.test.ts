import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMain } from 'electron'
import type { ModuleContext } from '../module-context'
import { parseLogLine } from '../../shared/logger'

// Capture what gets appended to the iracing-diagnostics.log file.
const appended: { path: string; data: string }[] = []

vi.mock('node:fs/promises', () => ({
  appendFile: vi.fn(async (path: string, data: string) => {
    appended.push({ path, data })
  }),
  mkdir: vi.fn(async () => undefined)
}))

// Isolated provider stub so the probe doesn't touch the native pipeline.
const fakeDiag = {
  provider: { kind: 'iracing', open: true },
  mmf: { mapped: true, bytes: 1024 }
}
vi.mock('../iracing/provider', () => ({
  IRacingProvider: class {
    start = vi.fn()
    stop = vi.fn()
    diagnose = vi.fn(() => fakeDiag)
  }
}))

import { register } from './iracing-diagnostics'

function makeCtx(): { ctx: ModuleContext; getHandler: () => (...args: unknown[]) => unknown } {
  let handler: (...args: unknown[]) => unknown = () => undefined
  const ipcMain = {
    handle: (_channel: string, fn: (...args: unknown[]) => unknown) => {
      handler = fn
    }
  } as unknown as IpcMain
  const ctx = {
    app: { getPath: (_name: string) => '/userData' },
    ipcMain,
    telemetryHub: { status: () => ({ connected: false }) }
  } as unknown as ModuleContext
  return { ctx, getHandler: () => handler }
}

beforeEach(() => {
  appended.length = 0
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('iracing-diagnostics appendLog', () => {
  it('writes a JSON-lines entry that parses with the expected keys', async () => {
    const { ctx, getHandler } = makeCtx()
    register(ctx)

    const report = (await getHandler()()) as { timestamp: number }
    expect(typeof report.timestamp).toBe('number')

    expect(appended).toHaveLength(1)
    const { path, data } = appended[0]
    expect(path).toContain('iracing-diagnostics.log')
    expect(data.endsWith('\n')).toBe(true)

    // Each line must be valid JSON-lines matching the shared {ts,level,area,message,detail} shape.
    const entry = parseLogLine(data)
    expect(entry).not.toBeNull()
    expect(entry?.level).toBe('info')
    expect(entry?.area).toBe('iracing-diagnostics')
    expect(entry?.message).toBe('probe')
    expect(typeof entry?.ts).toBe('string')

    // The full report is preserved under `detail` (no information lost).
    const parsed = JSON.parse(data.trim()) as { detail: typeof report }
    expect(parsed.detail).toMatchObject(report)
  })
})
