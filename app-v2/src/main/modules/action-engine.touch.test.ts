import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { ModuleContext } from '../module-context'
import type { TouchSemanticActionRequest } from '../../shared/touch-panel'
import {
  TouchActionOwnerRegistry,
  createTouchSemanticActionHandler,
  type TouchActionEmulation
} from './action-engine'

function setup() {
  const execute = vi.fn().mockReturnValue({ ok: true, supported: true })
  const ctx = { iracingControl: { execute } } as unknown as ModuleContext
  const emulation: TouchActionEmulation = {
    pressKey: vi.fn().mockResolvedValue({ ok: true, message: 'pressed' }),
    beginKeyboardHold: vi.fn().mockResolvedValue({ ok: true, message: 'held' }),
    endKeyboardHold: vi.fn().mockResolvedValue({ ok: true, message: 'released' }),
    toggleTouchKeyboard: vi.fn().mockResolvedValue({ ok: true, message: 'toggled' }),
    setTouchKeyboardToggle: vi.fn().mockResolvedValue({ ok: true, message: 'toggled' }),
    releaseTouchKeyboardOwner: vi.fn().mockResolvedValue(undefined)
  }
  return { execute, emulation, handler: createTouchSemanticActionHandler(ctx, emulation) }
}

function request(partial: Partial<TouchSemanticActionRequest>): TouchSemanticActionRequest {
  return {
    action: { kind: 'keyboard', command: { mode: 'press', keys: ['P'] } },
    phase: 'trigger',
    token: 'control:main',
    zone: 'main',
    ...partial
  }
}

describe('validated main-process Touch action boundary', () => {
  it('maps semantic iRacing commands to the raw IRacingControl payload', async () => {
    const { execute, handler } = setup()
    const result = await handler(request({
      action: { kind: 'iracing', command: { group: 'pit', name: 'pit:addFuel', fuelLiters: 12 } }
    }))

    expect(result.ok).toBe(true)
    expect(execute).toHaveBeenCalledWith({ type: 'pit:fuel', payload: { liters: 12 } })
  })

  it('rejects incompatible or forged iRacing payloads before execution', async () => {
    const { execute, handler } = setup()
    const result = await handler({
      action: { kind: 'iracing', command: { group: 'camera', name: 'pit:clearAll' } },
      phase: 'trigger',
      token: 'pit:main',
      zone: 'main'
    })

    expect(result).toEqual({ ok: false, message: 'Invalid semantic Touch action request.' })
    expect(execute).not.toHaveBeenCalled()
  })

  it('rejects raw gamepad and non-semantic payloads', async () => {
    const { handler, emulation } = setup()
    await expect(handler({
      action: { kind: 'gamepad', command: { button: 1 } },
      phase: 'trigger',
      token: 'bad:main',
      zone: 'main'
    })).resolves.toEqual({ ok: false, message: 'Invalid semantic Touch action request.' })
    expect(emulation.pressKey).not.toHaveBeenCalled()
  })

  it('routes hold begin/end and strips repeat-only execution fields', async () => {
    const { handler, emulation } = setup()
    const holdAction = { kind: 'keyboard' as const, command: { mode: 'hold' as const, keys: ['V'] } }
    await handler(request({ action: holdAction, phase: 'begin', token: 'radio:main' }), 'webcontents-7-generation-0')
    await handler(request({ action: holdAction, phase: 'end', token: 'radio:main' }), 'webcontents-7-generation-0')
    expect(emulation.beginKeyboardHold).toHaveBeenCalledWith('webcontents-7-generation-0:radio:main', holdAction.command)
    expect(emulation.endKeyboardHold).toHaveBeenCalledWith('webcontents-7-generation-0:radio:main')

    await handler(request({
      action: {
        kind: 'keyboard',
        command: { mode: 'repeat', keys: ['PageUp'], repeatMs: 80, repeatCount: 9 }
      }
    }))
    expect(emulation.pressKey).toHaveBeenLastCalledWith({ mode: 'press', keys: ['PageUp'] })
  })

  it('owner-scopes momentary keyboard toggle actions too', async () => {
    const { handler, emulation } = setup()
    const action = { kind: 'keyboard' as const, command: { mode: 'toggle' as const, keys: ['H'] } }
    await handler(request({ action, token: 'lights:main', zone: 'main' }), 'webcontents-7-generation-0')
    expect(emulation.toggleTouchKeyboard).toHaveBeenCalledWith(
      'webcontents-7-generation-0:lights:main',
      action.command
    )
  })
  it('uses stable latching token state for ON, OFF, and teardown', async () => {
    const { handler, emulation } = setup()
    const action = { kind: 'keyboard' as const, command: { mode: 'toggle' as const, keys: ['H'] } }
    await handler(request({ action, token: 'lights:latching', zone: 'on' }), 'webcontents-7-generation-0')
    await handler(request({ action, token: 'lights:latching', zone: 'off' }), 'webcontents-7-generation-0')
    await handler(request({ action, phase: 'cancel', token: 'lights:latching', zone: 'teardown' }), 'webcontents-7-generation-0')

    expect(emulation.setTouchKeyboardToggle).toHaveBeenNthCalledWith(1, 'webcontents-7-generation-0:lights:latching', action.command, true)
    expect(emulation.setTouchKeyboardToggle).toHaveBeenNthCalledWith(2, 'webcontents-7-generation-0:lights:latching', action.command, false)
    expect(emulation.setTouchKeyboardToggle).toHaveBeenNthCalledWith(3, 'webcontents-7-generation-0:lights:latching', action.command, false)
  })
})
describe('TouchActionOwnerRegistry', () => {
  it('advances generations before release and isolates other webContents', async () => {
    const releaseTouchKeyboardOwner = vi.fn().mockResolvedValue(undefined)
    const registry = new TouchActionOwnerRegistry({ releaseTouchKeyboardOwner })

    expect(registry.currentOwnerKey(10)).toBe('webcontents-10-generation-0')
    expect(registry.currentOwnerKey(20)).toBe('webcontents-20-generation-0')
    const release = registry.release(10)
    expect(registry.currentOwnerKey(10)).toBe('webcontents-10-generation-1')
    expect(registry.currentOwnerKey(20)).toBe('webcontents-20-generation-0')
    await release
    expect(releaseTouchKeyboardOwner).toHaveBeenCalledWith('webcontents-10-generation-0')
  })

  it('releases on main-frame navigation, renderer loss, and destruction', async () => {
    const releaseTouchKeyboardOwner = vi.fn().mockResolvedValue(undefined)
    const registry = new TouchActionOwnerRegistry({ releaseTouchKeyboardOwner })
    const sender = new EventEmitter() as EventEmitter & { id: number }
    sender.id = 42
    registry.track(sender as unknown as WebContents)

    sender.emit('did-start-navigation', {}, 'file://touchpanel', false, false)
    expect(releaseTouchKeyboardOwner).not.toHaveBeenCalled()
    sender.emit('did-start-navigation', {}, 'file://touchpanel', false, true)
    sender.emit('render-process-gone')
    sender.emit('destroyed')
    await vi.waitFor(() => expect(releaseTouchKeyboardOwner).toHaveBeenCalledTimes(3))
    expect(releaseTouchKeyboardOwner.mock.calls.map(([owner]) => owner)).toEqual([
      'webcontents-42-generation-0',
      'webcontents-42-generation-1',
      'webcontents-42-generation-2'
    ])
  })
})