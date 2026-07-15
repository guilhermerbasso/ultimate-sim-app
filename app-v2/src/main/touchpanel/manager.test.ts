import { EventEmitter } from 'node:events'
import { join, resolve, sep } from 'node:path'
import type { BrowserWindow } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { bindTouchActionWindowLifecycle, panelFileName } from './manager'

// Security regression: panel ids are UNTRUSTED (user-edited / imported JSON). A
// crafted id must never let a save/delete escape the panels directory.

const STORE_DIR = resolve('home', 'user', '.config', 'app', 'touch-panels')

function pathFor(id: string): string {
  return resolve(join(STORE_DIR, `${panelFileName(id)}.json`))
}

describe('panelFileName — path-traversal hardening', () => {
  it('strips path separators and `..` traversal tokens', () => {
    for (const id of ['../../etc/passwd', '..\\..\\win', '/abs/evil', 'a/../../b', '....//x']) {
      const name = panelFileName(id)
      expect(name).not.toContain('/')
      expect(name).not.toContain('\\')
      expect(name).not.toContain('..')
    }
  })

  it('keeps a resolved save/delete path INSIDE the panels directory', () => {
    const malicious = [
      '../../etc/passwd',
      '../../../root/.ssh/authorized_keys',
      '..\\..\\Windows\\System32\\evil',
      '/absolute/escape',
      'a/../../b',
      '..',
      '.',
      ''
    ]
    for (const id of malicious) {
      const p = pathFor(id)
      expect(p.startsWith(STORE_DIR + sep), `escaped for id=${JSON.stringify(id)} → ${p}`).toBe(true)
      // The file lives directly in the store dir — no nested segment introduced.
      expect(p.slice(STORE_DIR.length + 1)).not.toContain(sep)
    }
  })

  it('preserves legitimate ids (whitelist chars + real dots)', () => {
    expect(panelFileName('panel-abc123')).toBe('panel-abc123')
    expect(panelFileName('my.panel_v2')).toBe('my.panel_v2')
  })

  it('never returns an empty name', () => {
    expect(panelFileName('')).toBe('_')
    expect(panelFileName('..')).not.toBe('')
  })
})
describe('Touch BrowserWindow action lifecycle', () => {
  it('releases its webContents owner on reload/navigation, process loss, destruction, and close', () => {
    const win = new EventEmitter() as EventEmitter & { webContents: EventEmitter & { id: number } }
    win.webContents = new EventEmitter() as EventEmitter & { id: number }
    win.webContents.id = 77
    const release = vi.fn().mockResolvedValue(undefined)
    bindTouchActionWindowLifecycle(win as unknown as BrowserWindow, release)

    win.webContents.emit('did-start-navigation', {}, 'file://subframe', false, false)
    expect(release).not.toHaveBeenCalled()
    win.webContents.emit('did-start-navigation', {}, 'file://touchpanel', false, true)
    win.webContents.emit('render-process-gone')
    win.webContents.emit('destroyed')
    win.emit('close')
    win.emit('closed')

    expect(release).toHaveBeenCalledTimes(5)
    expect(release.mock.calls.every(([id]) => id === 77)).toBe(true)
  })
})