import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { App } from 'electron'
import {
  ensureAvrdude,
  resetAvrdudeFetchCacheForTests,
  resolveBundledAvrdudePath,
  resolveUserAvrdudePath,
  type AvrdudeFetchFs
} from './avrdude-fetch'

const APP_ROOT = join('C:', 'app')
const USER_DATA = join('C:', 'user-data')
const VALID_EXE_SIZE = 200_000

function fakeApp(isPackaged = false): App {
  return {
    isPackaged,
    getAppPath: () => APP_ROOT,
    getPath: (name: string) => {
      if (name !== 'userData') throw new Error(`unexpected path: ${name}`)
      return USER_DATA
    }
  } as unknown as App
}

function makeFs(initial: Record<string, number> = {}): { fs: AvrdudeFetchFs; sizes: Map<string, number> } {
  const sizes = new Map<string, number>(Object.entries(initial))
  const fs: AvrdudeFetchFs = {
    exists: (path) => sizes.has(path),
    size: (path) => sizes.get(path) ?? null,
    mkdir: async () => {},
    remove: async (path) => {
      sizes.delete(path)
    },
    rename: async (from, to) => {
      const size = sizes.get(from)
      if (size == null) throw new Error(`missing ${from}`)
      sizes.delete(from)
      sizes.set(to, size)
    }
  }
  return { fs, sizes }
}

beforeEach(() => {
  resetAvrdudeFetchCacheForTests()
})

describe('avrdude path resolution', () => {
  it('resolves the bundled dev and user-data fallback paths', () => {
    const app = fakeApp(false)
    expect(resolveBundledAvrdudePath(app)).toBe(
      join(APP_ROOT, 'resources', 'tools', 'avrdude', 'win', 'bin', 'avrdude.exe')
    )
    expect(resolveUserAvrdudePath(app)).toBe(join(USER_DATA, 'tools', 'avrdude', 'bin', 'avrdude.exe'))
  })
})

describe('ensureAvrdude', () => {
  it('returns the bundled executable without downloading when it is present', async () => {
    const app = fakeApp()
    const bundled = resolveBundledAvrdudePath(app)
    const { fs } = makeFs({ [bundled]: VALID_EXE_SIZE })
    let installs = 0

    await expect(
      ensureAvrdude(app, {
        fs,
        installAvrdude: async () => {
          installs++
        }
      })
    ).resolves.toBe(bundled)
    expect(installs).toBe(0)
  })

  it('downloads to userData and returns the fallback executable when bundled avrdude is missing', async () => {
    const app = fakeApp()
    const fallback = resolveUserAvrdudePath(app)
    const { fs, sizes } = makeFs()
    const installedTargets: string[] = []

    await expect(
      ensureAvrdude(app, {
        fs,
        installAvrdude: async (target) => {
          installedTargets.push(target.exePath)
          sizes.set(target.partPath, VALID_EXE_SIZE)
          await fs.rename(target.partPath, target.exePath)
        }
      })
    ).resolves.toBe(fallback)

    expect(installedTargets).toEqual([fallback])
    expect(sizes.get(fallback)).toBe(VALID_EXE_SIZE)
  })
})
