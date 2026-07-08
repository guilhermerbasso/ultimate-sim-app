import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  SIDEBAR_COLLAPSED_STORAGE_KEY,
  isEditableTarget,
  readSidebarCollapsed,
  writeSidebarCollapsed
} from './App'

// App.tsx runs in the renderer; the collapse-persistence helpers only touch
// window.localStorage at call time, so a small in-memory stub is enough to
// exercise the read-on-init / write-on-change contract in the node test env
// (mirrors how favorites/recents persist).
function installLocalStorage(): Map<string, string> {
  const store = new Map<string, string>()
  ;(globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string): string | null => (store.has(key) ? (store.get(key) as string) : null),
      setItem: (key: string, value: string): void => {
        store.set(key, String(value))
      },
      removeItem: (key: string): void => {
        store.delete(key)
      },
      clear: (): void => {
        store.clear()
      }
    }
  }
  return store
}

describe('sidebar collapse persistence', () => {
  let store: Map<string, string>

  beforeEach(() => {
    store = installLocalStorage()
  })

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window
  })

  it('uses the documented storage key', () => {
    expect(SIDEBAR_COLLAPSED_STORAGE_KEY).toBe('usa:sidebar-collapsed')
  })

  it('defaults to expanded (false) when nothing is stored', () => {
    expect(readSidebarCollapsed()).toBe(false)
  })

  it('round-trips the collapsed flag through localStorage', () => {
    writeSidebarCollapsed(true)
    expect(store.get(SIDEBAR_COLLAPSED_STORAGE_KEY)).toBe('true')
    expect(readSidebarCollapsed()).toBe(true)

    writeSidebarCollapsed(false)
    expect(store.get(SIDEBAR_COLLAPSED_STORAGE_KEY)).toBe('false')
    expect(readSidebarCollapsed()).toBe(false)
  })

  it('treats any non-"true" value as expanded', () => {
    store.set(SIDEBAR_COLLAPSED_STORAGE_KEY, 'garbage')
    expect(readSidebarCollapsed()).toBe(false)
  })

  it('never throws when localStorage is unavailable', () => {
    ;(globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: (): string | null => {
          throw new Error('blocked')
        },
        setItem: (): void => {
          throw new Error('blocked')
        }
      }
    }
    expect(readSidebarCollapsed()).toBe(false)
    expect(() => writeSidebarCollapsed(true)).not.toThrow()
  })
})

describe('global shortcut target guard', () => {
  it('treats form fields as editable targets', () => {
    expect(isEditableTarget({ tagName: 'INPUT' } as EventTarget)).toBe(true)
    expect(isEditableTarget({ tagName: 'textarea' } as EventTarget)).toBe(true)
    expect(isEditableTarget({ tagName: 'select' } as EventTarget)).toBe(true)
  })

  it('treats contentEditable elements as editable targets', () => {
    expect(isEditableTarget({ isContentEditable: true } as EventTarget)).toBe(true)
    expect(isEditableTarget({ closest: () => ({}) } as EventTarget)).toBe(true)
  })

  it('ignores non-editable targets', () => {
    expect(isEditableTarget(null)).toBe(false)
    expect(isEditableTarget({ tagName: 'div', isContentEditable: false, closest: () => null } as EventTarget)).toBe(false)
    expect(isEditableTarget({} as EventTarget)).toBe(false)
  })
})
