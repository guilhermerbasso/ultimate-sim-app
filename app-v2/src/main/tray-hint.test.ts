import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import {
  TRAY_HINT_FLAG_FILENAME,
  claimFirstTrayHint,
  trayHintFlagPath,
  type TrayHintFsHooks
} from './tray-hint'

describe('trayHintFlagPath', () => {
  it('places the flag file inside the given userData directory', () => {
    expect(trayHintFlagPath(join('data', 'userData'))).toBe(join('data', 'userData', TRAY_HINT_FLAG_FILENAME))
  })
})

describe('claimFirstTrayHint', () => {
  it('returns true once, then false after the flag is persisted', () => {
    const store = new Set<string>()
    const hooks: TrayHintFsHooks = {
      exists: (path) => store.has(path),
      write: (path) => void store.add(path)
    }
    const path = trayHintFlagPath('/userData')

    expect(claimFirstTrayHint(path, hooks)).toBe(true)
    expect(claimFirstTrayHint(path, hooks)).toBe(false)
    expect(claimFirstTrayHint(path, hooks)).toBe(false)
  })

  it('persists the flag exactly once (the claiming call writes it)', () => {
    const writes: string[] = []
    const store = new Set<string>()
    const hooks: TrayHintFsHooks = {
      exists: (path) => store.has(path),
      write: (path) => {
        writes.push(path)
        store.add(path)
      }
    }
    const path = trayHintFlagPath('/userData')

    claimFirstTrayHint(path, hooks)
    claimFirstTrayHint(path, hooks)

    expect(writes).toEqual([path])
  })

  it('still shows once (returns true) when the flag cannot be persisted', () => {
    const hooks: TrayHintFsHooks = {
      exists: () => false,
      write: () => {
        throw new Error('read-only disk')
      }
    }
    expect(claimFirstTrayHint(trayHintFlagPath('/x'), hooks)).toBe(true)
  })

  it('treats an unreadable flag as not-yet-shown and tries to claim it', () => {
    let written = false
    const hooks: TrayHintFsHooks = {
      exists: () => {
        throw new Error('permission denied')
      },
      write: () => {
        written = true
      }
    }
    expect(claimFirstTrayHint(trayHintFlagPath('/x'), hooks)).toBe(true)
    expect(written).toBe(true)
  })
})
