import { describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({ showOpenDialog: vi.fn(), showSaveDialog: vi.fn() }))
vi.mock('electron', () => ({ dialog: electronMocks, shell: {}, app: {} }))
vi.mock('./logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { join } from 'node:path'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { register } from './config-export'
import {
  CONFIG_IO_CHANNELS,
  CONFIG_SECTION_RELOAD_SIGNAL,
  type ConfigImportResult,
  type ConfigSectionReloadCallback
} from '../../shared/config-io'
import { RGB_MATRIX_PROFILE_VERSION, defaultRgbMatrixProfile } from '../../shared/rgb-matrix'
import type { ModuleContext } from '../module-context'

// SYNTHETIC EVIDENCE, NOT A REAL CAPTURE: the reload signal is driven directly rather
// than by a running iFlag/RGB-matrix module, which is exactly the condition being
// tested — the module NOT being there.

type TestIpcHandler = (...args: unknown[]) => unknown

const RGB_PAYLOAD = {
  version: RGB_MATRIX_PROFILE_VERSION,
  profiles: { 'seed-device:seed-matrix': defaultRgbMatrixProfile() },
  updatedAt: '2026-01-01T00:00:00.000Z'
}

/**
 * @param reload  How the (possibly absent) iFlag module responds to the reload signal.
 *                `null` models the module not being registered at all.
 */
function harness(reload: null | ((done: ConfigSectionReloadCallback) => void)) {
  const userData = mkdtempSync(join(tmpdir(), 'iflag-warning-'))
  const handlers = new Map<string, TestIpcHandler>()
  const broadcast = vi.fn()
  const emit = vi.fn((channel: string, ..._args: unknown[]) => {
    if (channel !== CONFIG_SECTION_RELOAD_SIGNAL) return true
    if (!reload) return false // no listener registered — the module is not running
    const done = _args[2] as ConfigSectionReloadCallback | undefined
    if (done) reload(done)
    return true
  })
  register({
    app: { getPath: () => userData },
    ipcMain: {
      handle: (channel: string, handler: TestIpcHandler) => handlers.set(channel, handler),
      emit
    },
    getMainWindow: () => null,
    broadcast
  } as unknown as ModuleContext)

  const importFile = join(userData, 'iflag-export.json')
  writeFileSync(
    importFile,
    JSON.stringify({ app: 'ultimate-sim-app', version: 1, sectionId: 'rgb-matrix', data: RGB_PAYLOAD }),
    'utf8'
  )
  electronMocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [importFile] })

  return {
    broadcast,
    userData,
    async importIFlag(): Promise<ConfigImportResult> {
      const handler = handlers.get(CONFIG_IO_CHANNELS.importSection)
      if (!handler) throw new Error('importSection handler was not registered')
      return (await handler(undefined, 'rgb-matrix')) as ConfigImportResult
    },
    cleanup() {
      rmSync(userData, { recursive: true, force: true })
    }
  }
}

describe('§24-19 — a live-apply problem after a successful persist is a WARNING, not an error', () => {
  it('does not fail the import when the iFlag module is not running', async () => {
    const h = harness(null)
    try {
      const result = await h.importIFlag()

      expect(result.canceled).toBe(false)
      expect(result.summary?.applied).toEqual(['rgb-matrix'])
      expect(result.summary?.warnings?.[0]).toMatchObject({ sectionId: 'rgb-matrix', code: 'module-not-running' })
      // The UI must still be told the import happened — the data IS on disk.
      expect(h.broadcast).toHaveBeenCalledWith(CONFIG_IO_CHANNELS.imported, expect.objectContaining({ applied: ['rgb-matrix'] }))
    } finally {
      h.cleanup()
    }
  })

  it('warns rather than failing when imported profiles match no local RGB matrix target', async () => {
    const h = harness((done) => done(null, { sectionId: 'rgb-matrix', itemCount: 3, hotAppliedCount: 1, unmatchedItemCount: 2 }))
    try {
      const result = await h.importIFlag()

      expect(result.summary?.applied).toEqual(['rgb-matrix'])
      expect(result.summary?.warnings?.[0]).toMatchObject({ code: 'unmatched-targets' })
      expect(result.summary?.details?.['rgb-matrix']).toMatchObject({ unmatchedItemCount: 2, hotAppliedCount: 1 })
      expect(h.broadcast).toHaveBeenCalledWith(CONFIG_IO_CHANNELS.imported, expect.anything())
    } finally {
      h.cleanup()
    }
  })

  it('warns rather than failing when there is no local target at all', async () => {
    const h = harness((done) => done(null, { sectionId: 'rgb-matrix', itemCount: 2, hotAppliedCount: 0, unmatchedItemCount: 0 }))
    try {
      const result = await h.importIFlag()

      expect(result.summary?.applied).toEqual(['rgb-matrix'])
      expect(result.summary?.warnings?.[0]).toMatchObject({ code: 'no-local-target' })
    } finally {
      h.cleanup()
    }
  })

  it('warns rather than failing when the module reports a reload error', async () => {
    const h = harness((done) => done('the matrix controller is offline'))
    try {
      const result = await h.importIFlag()

      expect(result.summary?.applied).toEqual(['rgb-matrix'])
      expect(result.summary?.warnings?.[0]).toMatchObject({ code: 'reload-failed' })
      expect(result.summary?.warnings?.[0].message).toContain('offline')
    } finally {
      h.cleanup()
    }
  })

  it('reports NO warning when the module applies everything cleanly', async () => {
    const h = harness((done) => done(null, { sectionId: 'rgb-matrix', itemCount: 1, hotAppliedCount: 1, unmatchedItemCount: 0 }))
    try {
      const result = await h.importIFlag()

      expect(result.summary?.applied).toEqual(['rgb-matrix'])
      expect(result.summary?.warnings).toBeUndefined()
    } finally {
      h.cleanup()
    }
  })
})
