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
  vi.useRealTimers()
  vi.resetModules()
  vi.clearAllMocks()
})

describe('accessibility haptic zero-intensity safety', () => {
  it('requires nonzero master/profile gain and a live renderer or actuator', async () => {
    const { DEFAULT_HAPTICS_CONFIG } = await import('../../shared/haptics')
    const { canDeliverAccessibilityHaptic } = await import('./haptics')
    const enabled = {
      ...DEFAULT_HAPTICS_CONFIG,
      enabled: true,
      muted: false,
      masterGain: 0.8
    }

    expect(
      canDeliverAccessibilityHaptic(
        { ...enabled, masterGain: 0 },
        0.8,
        true,
        true
      )
    ).toBe(false)
    expect(
      canDeliverAccessibilityHaptic(enabled, 0, true, true)
    ).toBe(false)
    expect(
      canDeliverAccessibilityHaptic(enabled, 0.8, false, false)
    ).toBe(false)
    expect(
      canDeliverAccessibilityHaptic(enabled, 0.8, true, false)
    ).toBe(true)
    expect(
      canDeliverAccessibilityHaptic(enabled, 0.8, false, true)
    ).toBe(true)
  })

  it('never schedules hardware actuation for zero intensity', async () => {
    const handlers = new Map<string, (...args: any[]) => any>()
    const device = {
      id: 'companion',
      kind: 'arduino',
      isOpen: () => true,
      sendRaw: vi.fn(async () => undefined)
    }
    const ctx = {
      app: {
        getPath: () => 'C:\\haptics-accessibility-test',
        once: vi.fn()
      },
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

  it('preempts pending warning pulses when a critical haptic arrives', async () => {
    const device = {
      id: 'companion',
      kind: 'arduino',
      isOpen: () => true,
      sendRaw: vi.fn(async () => undefined)
    }
    const ctx = {
      app: {
        getPath: () => 'C:\\haptics-preemption-test',
        once: vi.fn()
      },
      broadcast: vi.fn(),
      ipcMain: { handle: vi.fn() },
      serialHub: {
        getDevice: () => device,
        getPrimaryId: () => 'simx'
      },
      telemetryHub: { on: vi.fn() }
    } as unknown as ModuleContext
    const module = await import('./haptics')
    module.register(ctx)
    await vi.waitFor(() =>
      expect(module.isAccessibilityHapticsEnabled()).toBe(true)
    )
    vi.useFakeTimers()

    module.dispatchAccessibilityCueHaptic(ctx, 'triple', 0.5, 1)
    module.dispatchAccessibilityCueHaptic(ctx, 'single', 0.9, 2)
    await vi.runAllTimersAsync()

    expect(device.sendRaw).toHaveBeenCalledTimes(1)
  })
})
