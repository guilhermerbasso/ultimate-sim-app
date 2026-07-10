import { EventEmitter } from 'node:events'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ModuleContext } from '../module-context'
import { IFLAG_DYNAMIC_CHANNELS } from '../../shared/iflag-dynamic'
import { loadIflagDynamicConfig, register } from './iflag-dynamic'

const roots: string[] = []

function makeCtx(userData: string): {
  ctx: ModuleContext
  handlers: Map<string, (...args: unknown[]) => unknown>
} {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ctx = {
    app: { getPath: () => userData },
    telemetryHub: new EventEmitter(),
    ipcMain: {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler)
      }
    },
    broadcast: () => undefined
  } as unknown as ModuleContext
  return { ctx, handlers }
}

async function makeUserData(): Promise<string> {
  const root = join(process.cwd(), '.vitest-data', `iflag-dynamic-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  roots.push(root)
  await mkdir(root, { recursive: true })
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('iflag-dynamic main persistence', () => {
  it('setConfig({ enabled: true }) writes durably and reloads as enabled', async () => {
    const userData = await makeUserData()
    const { ctx, handlers } = makeCtx(userData)
    register(ctx)

    const setConfig = handlers.get(IFLAG_DYNAMIC_CHANNELS.setConfig)
    expect(setConfig).toBeTypeOf('function')
    const saved = await setConfig!(null, { enabled: true })
    expect(saved).toMatchObject({ enabled: true })

    const configPath = join(userData, 'iflag-dynamic.json')
    await expect(loadIflagDynamicConfig(configPath)).resolves.toMatchObject({ enabled: true })

    const fresh = makeCtx(userData)
    register(fresh.ctx)
    const getConfig = fresh.handlers.get(IFLAG_DYNAMIC_CHANNELS.getConfig)
    await expect(getConfig!(null)).resolves.toMatchObject({ enabled: true })
  })
})
