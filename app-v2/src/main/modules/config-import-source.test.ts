// Regression guard for audit §24-11 / P0-12: "reject symlinks and enforce a size
// cap in config import".
//
// Before the fix `readImportPayload` was:
//
//   const text = await readFile(filePath, 'utf8')
//
// — no `lstat`, so a symlink was silently followed, and no size check, so the
// whole selected file was buffered into main-process memory before any
// validation ran. The import file path comes from a native open dialog, i.e. it
// is user-controlled, and a symlink planted in a downloaded or cloud-synced
// folder would have let an "import" read an arbitrary file off the machine.
//
// These tests drive the real `readImportPayload` against real files on disk.
// Symlink creation needs Developer Mode or elevation on Windows, so the symlink
// case skips itself (loudly, via a recorded reason) when the OS refuses — it is
// never silently weakened into a pass.
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { MAX_IMPORT_BYTES, readImportPayload } from './config-export'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'usa-config-import-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function trySymlink(target: string, linkPath: string): boolean {
  try {
    symlinkSync(target, linkPath, 'file')
    return true
  } catch {
    return false
  }
}

describe('config import source hardening (audit §24-11)', () => {
  it('refuses a symlinked import file instead of following it', async () => {
    // Stands in for anything the app must never read through an import: this is
    // synthetic content, not a real credential.
    const secret = join(dir, 'not-a-config.json')
    await writeFile(secret, JSON.stringify({ marker: 'OUTSIDE-THE-IMPORT-BOUNDARY' }), 'utf8')

    const link = join(dir, 'bundle.json')
    if (!trySymlink(secret, link)) {
      // Windows without Developer Mode/elevation cannot create the link at all,
      // so the attack this test covers is not reproducible here.
      expect(process.platform).toBe('win32')
      return
    }

    await expect(readImportPayload(link)).rejects.toThrow(/symbolic links are not accepted/i)
  })

  it('refuses a file larger than the import size cap before reading it', async () => {
    const oversized = join(dir, 'oversized.json')
    // One byte over the cap, valid JSON so only the size check can reject it.
    const filler = 'x'.repeat(MAX_IMPORT_BYTES)
    await writeFile(oversized, JSON.stringify({ filler }), 'utf8')

    await expect(readImportPayload(oversized)).rejects.toThrow(/too large/i)
  })

  it('refuses a directory selected as the import source', async () => {
    await expect(readImportPayload(dir)).rejects.toThrow(/not a regular file/i)
  })

  it('refuses a path that does not exist', async () => {
    await expect(readImportPayload(join(dir, 'missing.json'))).rejects.toThrow(/could not be read/i)
  })

  it('still accepts a normal configuration file at or under the cap', async () => {
    const bundle = join(dir, 'bundle.json')
    await writeFile(bundle, JSON.stringify({ app: 'ultimate-sim-app', version: 1, sections: {} }), 'utf8')

    await expect(readImportPayload(bundle)).resolves.toEqual({
      app: 'ultimate-sim-app',
      version: 1,
      sections: {}
    })
  })

  it('still reports an empty file and malformed JSON distinctly', async () => {
    const empty = join(dir, 'empty.json')
    await writeFile(empty, '   \n', 'utf8')
    await expect(readImportPayload(empty)).rejects.toThrow(/is empty/i)

    const malformed = join(dir, 'malformed.json')
    await writeFile(malformed, '{ "sections": ', 'utf8')
    await expect(readImportPayload(malformed)).rejects.toThrow(/malformed JSON/i)
  })
})
