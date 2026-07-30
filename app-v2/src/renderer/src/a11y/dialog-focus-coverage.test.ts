import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Structural coverage for `useFocusTrap`.
 *
 * The browser test proves the trap behaves correctly. This proves every dialog
 * actually uses it, so a new modal cannot quietly ship without focus management
 * the way ten of the eleven existing ones did.
 */

const RENDERER = join(dirname(fileURLToPath(import.meta.url)), '..')

function collect(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) collect(full, acc)
    else if (/\.tsx$/.test(entry) && !/\.test\.tsx?$/.test(entry)) acc.push(full)
  }
  return acc
}

interface DialogSite {
  file: string
  line: number
  wired: boolean
}

const sites: DialogSite[] = []
for (const file of collect(RENDERER)) {
  const source = readFileSync(file, 'utf8')
  if (!source.includes('role="dialog"')) continue
  const usesTrap = source.includes('useFocusTrap')
  const lines = source.split('\n')
  lines.forEach((text, index) => {
    if (!text.includes('role="dialog"')) return
    // Container attributes are often spread over several lines, so look at the
    // whole opening tag rather than just the line carrying the role.
    const openingTag = lines.slice(Math.max(0, index - 8), index + 9).join('\n')
    const wired =
      usesTrap &&
      /ref=\{\w*[Ff]ocusTrap\.containerRef\}/.test(openingTag) &&
      /onKeyDown=\{(\w*[Ff]ocusTrap\.onKeyDown|handleKeyDown)\}/.test(openingTag)
    sites.push({ file: relative(RENDERER, file).split(sep).join('/'), line: index + 1, wired })
  })
}

describe('dialog focus-trap coverage', () => {
  it('finds the modal dialogs', () => {
    expect(sites.length).toBeGreaterThanOrEqual(11)
  })

  it('wires every role="dialog" container to useFocusTrap', () => {
    const unwired = sites.filter((site) => !site.wired).map((site) => `${site.file}:${site.line}`)
    expect(
      unwired,
      `${unwired.length} dialog(s) have no initial focus, Tab trap or focus restore:\n${unwired.join('\n')}`
    ).toEqual([])
  })
})
