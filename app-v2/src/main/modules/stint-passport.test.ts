import { describe, expect, it } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import type { ModuleContext } from '../module-context'
import { authorizePassportSender } from './stint-passport'

function context(senderId = 7): ModuleContext {
  return {
    getMainWindow: () => ({
      isDestroyed: () => false,
      webContents: { id: senderId }
    })
  } as unknown as ModuleContext
}

function event(senderId: number): IpcMainInvokeEvent {
  return {
    sender: { id: senderId }
  } as unknown as IpcMainInvokeEvent
}

describe('Stint Passport IPC sender authentication', () => {
  it('accepts only the current main-window sender', () => {
    expect(() => authorizePassportSender(context(7), event(7))).not.toThrow()
    expect(() => authorizePassportSender(context(7), event(8))).toThrow(/not authorized/i)
  })

  it('fails closed when there is no live main window', () => {
    const ctx = { getMainWindow: () => null } as unknown as ModuleContext
    expect(() => authorizePassportSender(ctx, event(7))).toThrow(/not authorized/i)
  })
})
