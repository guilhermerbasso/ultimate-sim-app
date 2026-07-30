// Regression guard for audit §24-19 (import-transaction side): "a missing iFlag
// must be a warning on full import, not a global error raised after a successful
// persist".
//
// Before the fix, `emitReload` ran AFTER `engine.importSection` had already
// written the section to disk and then THREW when the imported iFlag profiles
// could not be hot-applied:
//
//   if (result.unmatchedItemCount > 0) throw new Error('Imported N iFlag profile(s), but ...')
//   if (result.itemCount > 0 && result.hotAppliedCount === 0) throw new Error(...)
//
// The renderer's `catch` turned that into a red failure message, so a user whose
// data WAS persisted (and would apply on the next launch) was told the import had
// failed. The same held for the two rejection paths inside `reloadRgbMatrix`
// (module not running, confirmation timeout).
//
// These tests drive the real `config:importSection` IPC handler with a stubbed
// dialog and a stubbed reload signal, and assert the result is a resolved summary
// carrying warnings — never a rejection.
import { mkdtempSync, rmSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CONFIG_BUNDLE_APP_ID,
  CONFIG_BUNDLE_VERSION,
  CONFIG_IO_CHANNELS,
  type ConfigImportResult,
  type ConfigSectionReloadCallback
} from '../../shared/config-io'
import { RGB_MATRIX_PROFILE_VERSION, defaultRgbMatrixProfile } from '../../shared/rgb-matrix'
import type { ModuleContext } from '../module-context'

const dialogState = vi.hoisted(() => ({ filePath: '' }))

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: async () => ({ canceled: false, filePaths: [dialogState.filePath] }),
    showSaveDialog: async () => ({ canceled: true, filePath: undefined })
  }
}))

const { register } = await import('./config-export')

type Handler = (...args: unknown[]) => unknown

let root: string

interface ReloadOutcome {
  itemCount: number
  hotAppliedCount: number
  unmatchedItemCount: number
}

function buildCtx(
  handlers: Map<string, Handler>,
  reload: ReloadOutcome | 'no-module' | 'reject'
): ModuleContext {
  return {
    app: { getPath: () => root, once: () => undefined },
    ipcMain: {
      handle: (channel: string, handler: Handler) => handlers.set(channel, handler),
      on: () => undefined,
      off: () => undefined,
      emit: (_signal: string, _event: unknown, sectionId: string, finish?: ConfigSectionReloadCallback) => {
        if (sectionId !== 'rgb-matrix') return true
        if (reload === 'no-module') return false
        if (reload === 'reject') {
          finish?.('The iFlag module exploded while applying the profiles.')
          return true
        }
        finish?.(null, { sectionId: 'rgb-matrix', ...reload })
        return true
      }
    },
    broadcast: () => undefined,
    getMainWindow: () => null
  } as unknown as ModuleContext
}

async function writeIflagBundle(): Promise<string> {
  const filePath = join(root, 'iflag-profiles.json')
  await writeFile(
    filePath,
    JSON.stringify({
      app: CONFIG_BUNDLE_APP_ID,
      version: CONFIG_BUNDLE_VERSION,
      sectionId: 'rgb-matrix',
      exportedAt: '2026-01-01T00:00:00.000Z',
      data: {
        version: RGB_MATRIX_PROFILE_VERSION,
        profiles: { 'seed-device:seed-matrix': defaultRgbMatrixProfile() },
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    }),
    'utf8'
  )
  return filePath
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'usa-iflag-import-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

async function runImport(reload: ReloadOutcome | 'no-module' | 'reject'): Promise<ConfigImportResult> {
  dialogState.filePath = await writeIflagBundle()
  const handlers = new Map<string, Handler>()
  register(buildCtx(handlers, reload))
  const handler = handlers.get(CONFIG_IO_CHANNELS.importSection)
  if (!handler) throw new Error('importSection handler was not registered')
  return (await handler({}, 'rgb-matrix')) as ConfigImportResult
}

describe('iFlag import reports hot-apply problems as warnings (audit §24-19)', () => {
  it('resolves with a warning when no local RGB matrix target could apply the profiles', async () => {
    const result = await runImport({ itemCount: 1, hotAppliedCount: 0, unmatchedItemCount: 0 })

    expect(result.canceled).toBe(false)
    expect(result.summary?.applied).toContain('rgb-matrix')
    expect(result.summary?.warnings?.join(' ')).toMatch(/no local RGB matrix target/i)
  })

  it('resolves with a warning when some imported profiles are unmatched', async () => {
    const result = await runImport({ itemCount: 3, hotAppliedCount: 1, unmatchedItemCount: 2 })

    expect(result.canceled).toBe(false)
    expect(result.summary?.applied).toContain('rgb-matrix')
    expect(result.summary?.warnings?.join(' ')).toMatch(/could not be matched/i)
    expect(result.summary?.details?.['rgb-matrix']).toMatchObject({ unmatchedItemCount: 2 })
  })

  it('resolves with a warning when the iFlag module is not running at all', async () => {
    const result = await runImport('no-module')

    expect(result.canceled).toBe(false)
    expect(result.summary?.applied).toContain('rgb-matrix')
    expect(result.summary?.warnings?.join(' ')).toMatch(/not running/i)
  })

  it('resolves with a warning when the iFlag module reports a failure', async () => {
    const result = await runImport('reject')

    expect(result.canceled).toBe(false)
    expect(result.summary?.applied).toContain('rgb-matrix')
    expect(result.summary?.warnings?.join(' ')).toMatch(/exploded/i)
  })

  it('reports no warnings when every profile was hot-applied', async () => {
    const result = await runImport({ itemCount: 1, hotAppliedCount: 1, unmatchedItemCount: 0 })

    expect(result.canceled).toBe(false)
    expect(result.summary?.warnings ?? []).toEqual([])
  })
})
