import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Every modal dialog carries an accessible name.
 *
 * `dialog-tab-order.browser.test.ts` walks ten of the eleven dialogs with real
 * Tab keys and asserts every stop inside them is named. It cannot reach the
 * eleventh — the adaptive frame editor only exists after a dashboard with
 * adaptive rules has been loaded, a moment selected and "edit frame" pressed,
 * and that chain could not be driven from the harness. That dialog was the one
 * with a `role="dialog"` and no name at all, so the gap and the defect were the
 * same dialog.
 *
 * This is a SOURCE check, not an accessibility-tree measurement: it reads the
 * opening tag of every `role="dialog"` container and requires `aria-label` or
 * `aria-labelledby`. It is deliberately cheap so it covers the dialogs the
 * browser walk cannot reach, and so a new modal cannot ship anonymous.
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
  named: boolean
}

const sites: DialogSite[] = []
for (const file of collect(RENDERER)) {
  const source = readFileSync(file, 'utf8')
  if (!source.includes('role="dialog"')) continue
  const lines = source.split('\n')
  lines.forEach((text, index) => {
    if (!text.includes('role="dialog"')) return
    // Container attributes are often spread over several lines, so look at the
    // whole opening tag rather than just the line carrying the role.
    const openingTag = lines.slice(Math.max(0, index - 8), index + 9).join('\n')
    const named = /aria-label(ledby)?=/.test(openingTag)
    sites.push({ file: relative(RENDERER, file).split(sep).join('/'), line: index + 1, named })
  })
}

describe('dialog accessible-name coverage', () => {
  it('finds the modal dialogs', () => {
    expect(sites.length).toBeGreaterThanOrEqual(11)
  })

  it('gives every role="dialog" container an accessible name', () => {
    const anonymous = sites.filter((site) => !site.named).map((site) => `${site.file}:${site.line}`)
    expect(
      anonymous,
      `${anonymous.length} dialog(s) are announced as an unnamed "dialog":\n${anonymous.join('\n')}`
    ).toEqual([])
  })
})
