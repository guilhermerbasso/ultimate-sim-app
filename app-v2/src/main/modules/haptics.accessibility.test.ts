import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModuleContext } from '../module-context'

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(async () => undefined),
  readFile: vi.fn(async () =>
    JSON.stringify({
      enabled: true,
      muted: false,
      arduino: {
        enabled: true,
        deviceId: 'companion'
      }
    })
  ),
  writeFile: vi.fn(async () => undefined)
}))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

describe('accessibility haptic zero-intensity safety', () => {
  it('never schedules hardware actuation for zero intensity', async () => {
    const handlers = new Map<string, (...args: any[]) => any>()
    const device = {
      id: 'companion',
      kind: 'arduino',
      isOpen: () => true,
      sendRaw: vi.fn(async () => undefined)
    }
    const ctx = {
      app: { getPath: () => 'C:\\haptics-accessibility-test' },
      broadcast: vi.fn(),
      ipcMain: {
        handle: (channel: string, handler: (...args: any[]) => any) =>
          handlers.set(channel, handler)
      },
      serialHub: {
        getDevice: (id: string) => (id === device.id ? device : null),
        getPrimaryId: () => 'simx'
      },
      telemetryHub: { on: vi.fn() }
    } as unknown as ModuleContext
    const module = await import('./haptics')
    module.register(ctx)
    await vi.waitFor(() =>
      expect(module.isAccessibilityHapticsEnabled()).toBe(true)
    )

    expect(
      module.dispatchAccessibilityCueHaptic(ctx, 'single', 0)
    ).toBe(false)
    await new Promise<void>((resolve) => setTimeout(resolve, 10))
    expect(device.sendRaw).not.toHaveBeenCalled()

    expect(
      module.dispatchAccessibilityCueHaptic(ctx, 'single', 0.5)
    ).toBe(true)
    await vi.waitFor(() => expect(device.sendRaw).toHaveBeenCalledTimes(1))
  })
})
