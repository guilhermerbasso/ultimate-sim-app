import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { SavedSectionInfo } from '../../../shared/config-io'
import {
  SavedConfigsPanel,
  describeSaved,
  formatBytes,
  formatModified,
  runDeleteAll,
  summarizeSaved
} from './SavedConfigsPanel'

function info(partial: Partial<SavedSectionInfo> & Pick<SavedSectionInfo, 'id'>): SavedSectionInfo {
  return {
    label: partial.id,
    kind: 'file',
    exists: false,
    sizeBytes: 0,
    modifiedAt: null,
    ...partial
  }
}

describe('formatBytes', () => {
  it('renders human-readable sizes and clamps junk to 0 B', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(-5)).toBe('0 B')
    expect(formatBytes(Number.NaN)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1024)).toBe('1 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(1024 * 1024)).toBe('1 MB')
  })
})

describe('formatModified', () => {
  it('returns an em dash for missing/invalid timestamps', () => {
    expect(formatModified(null)).toBe('—')
    expect(formatModified(Number.NaN)).toBe('—')
  })

  it('formats a real epoch ms into a non-empty date string', () => {
    const out = formatModified(Date.UTC(2024, 0, 15, 12, 0, 0))
    expect(out).not.toBe('—')
    expect(out).toContain('2024')
  })
})

describe('summarizeSaved', () => {
  it('sums size and count for saved sections only', () => {
    const summary = summarizeSaved([
      info({ id: 'a', exists: true, sizeBytes: 100 }),
      info({ id: 'b', exists: false, sizeBytes: 999 }),
      info({ id: 'c', exists: true, sizeBytes: 50 })
    ])
    expect(summary).toEqual({ savedCount: 2, totalBytes: 150 })
  })
})

describe('describeSaved', () => {
  it('says "vazio" when nothing is saved', () => {
    expect(describeSaved(info({ id: 'spotter' }))).toBe('vazio')
  })

  it('combines size, item count, and date for a saved file', () => {
    const text = describeSaved(
      info({ id: 'settings', exists: true, sizeBytes: 2048, itemCount: 2, modifiedAt: Date.UTC(2024, 0, 15, 12) })
    )
    expect(text).toContain('2 KB')
    expect(text).toContain('2 entradas')
    expect(text).toContain('2024')
  })

  it('uses "arquivo(s)" wording for a dir section', () => {
    const text = describeSaved(info({ id: 'dashboards', kind: 'dir', exists: true, sizeBytes: 30, itemCount: 1 }))
    expect(text).toContain('1 arquivo')
    expect(text).not.toContain('arquivos')
  })

  it('reports an unreadable section instead of "vazio" (MINOR-2 error flag)', () => {
    expect(describeSaved(info({ id: 'settings', exists: false, error: true }))).toContain('erro ao ler')
  })
})

describe('runDeleteAll (deleteAll sequencing — MINOR-3)', () => {
  it('marks restart the instant the first delete succeeds, even if a later one throws', async () => {
    let restartMarks = 0
    const calls: string[] = []
    const result = await runDeleteAll(
      ['a', 'b', 'c'],
      async (id) => {
        calls.push(id)
        if (id === 'b') throw new Error('EACCES lock')
        return { id, removed: true }
      },
      () => {
        restartMarks += 1
      }
    )
    // Stopped at the throw, but 'a' was already removed…
    expect(calls).toEqual(['a', 'b'])
    expect(result.removed).toBe(1)
    expect(result.error).toBeInstanceOf(Error)
    // …so the restart banner is already up despite the partial failure (the bug:
    // previously setNeedsRestart ran only AFTER the loop, so it was skipped here).
    expect(restartMarks).toBe(1)
  })

  it('does not mark restart when every delete is a no-op (already empty)', async () => {
    let restartMarks = 0
    const result = await runDeleteAll(
      ['a', 'b'],
      async (id) => ({ id, removed: false }),
      () => {
        restartMarks += 1
      }
    )
    expect(result.removed).toBe(0)
    expect(result.error).toBeNull()
    expect(restartMarks).toBe(0)
  })

  it('marks restart for each successful removal when all deletes succeed', async () => {
    let restartMarks = 0
    const result = await runDeleteAll(
      ['a', 'b', 'c'],
      async (id) => ({ id, removed: id !== 'b' }),
      () => {
        restartMarks += 1
      }
    )
    expect(result.removed).toBe(2)
    expect(result.error).toBeNull()
    expect(restartMarks).toBe(2)
  })
})

describe('SavedConfigsPanel render', () => {
  it('renders the heading + userData warning without touching window.ipc on first paint', () => {
    const markup = renderToStaticMarkup(createElement(SavedConfigsPanel))
    expect(markup).toContain('Configurações salvas')
    expect(markup).toContain('userData')
    expect(markup).toContain('Carregando')
    // Defensive: the static markup must never leak a secret store label.
    expect(markup).not.toContain('credentials')
    expect(markup).not.toContain('oauth')
  })
})
