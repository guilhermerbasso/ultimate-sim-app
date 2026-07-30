// Regression guard for audit §24-12: "a failed/incomplete setup download must
// not delete the previous file".
//
// Before the fix, `downloadSto` piped straight into `createWriteStream(targetPath)`
// and `installSetup` used `copyFile(source, targetPath)`. Both open the destination
// with O_TRUNC, so an existing .sto was destroyed the moment the transfer started;
// the error handler then unlinked the truncated remains. A dropped connection while
// re-installing an existing setup permanently lost the driver's on-disk setup.
//
// These tests inject a REAL mid-write failure (a stream that errors after emitting
// part of the body, an oversized body that trips the size cap, and a copy source
// that does not exist) and assert the previous file survives BYTE-IDENTICAL.
import { mkdtempSync, rmSync } from 'node:fs'
import { copyFile, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { writeDownloadedSto, writeSetupFileAtomically } from './setups'

const PREVIOUS_SETUP = '[DriveInfo]\nSpringRate=550\nTirePressureLF=138\n'

let dir: string
let targetPath: string

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'usa-setups-atomic-'))
  targetPath = join(dir, 'monza-quali.sto')
  await writeFile(targetPath, PREVIOUS_SETUP, 'utf8')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** A body that emits `head` and then fails, exactly like a dropped connection. */
function truncatedBody(head: string): Readable {
  let sent = false
  return new Readable({
    read(): void {
      if (sent) {
        this.destroy(new Error('socket hang up'))
        return
      }
      sent = true
      this.push(Buffer.from(head, 'utf8'))
    }
  })
}

describe('setup install is transactional (audit §24-12)', () => {
  it('keeps the previous .sto byte-identical when the download fails mid-stream', async () => {
    await expect(writeDownloadedSto(truncatedBody('[DriveInfo]\nSpringRa'), targetPath)).rejects.toThrow(
      /socket hang up/
    )

    expect(await readFile(targetPath, 'utf8')).toBe(PREVIOUS_SETUP)
  })

  it('keeps the previous .sto byte-identical when the body exceeds the size cap', async () => {
    // 50 MiB + 1 byte trips sizeCapStream mid-pipeline, after bytes were written.
    const oversized = Readable.from(
      (function* chunks(): Generator<Buffer> {
        const chunk = Buffer.alloc(1024 * 1024, 0x41)
        for (let i = 0; i < 51; i += 1) yield chunk
      })()
    )

    await expect(writeDownloadedSto(oversized, targetPath)).rejects.toThrow(/too large/i)

    expect(await readFile(targetPath, 'utf8')).toBe(PREVIOUS_SETUP)
  })

  it('keeps the previous .sto byte-identical when a local copy source disappears', async () => {
    const missingSource = join(dir, 'does-not-exist.sto')

    await expect(
      writeSetupFileAtomically(targetPath, (stagingPath) => copyFile(missingSource, stagingPath))
    ).rejects.toMatchObject({ code: 'ENOENT' })

    expect(await readFile(targetPath, 'utf8')).toBe(PREVIOUS_SETUP)
  })

  it('leaves no staging residue behind after a failed write', async () => {
    await expect(writeDownloadedSto(truncatedBody('partial'), targetPath)).rejects.toThrow()

    expect(await readdir(dir)).toEqual(['monza-quali.sto'])
  })

  it('replaces the previous .sto only after the whole body arrived', async () => {
    const nextSetup = '[DriveInfo]\nSpringRate=620\nTirePressureLF=142\n'

    await writeDownloadedSto(Readable.from([Buffer.from(nextSetup, 'utf8')]), targetPath)

    expect(await readFile(targetPath, 'utf8')).toBe(nextSetup)
    expect(await readdir(dir)).toEqual(['monza-quali.sto'])
  })

  it('creates the setup when no previous file exists', async () => {
    const fresh = join(dir, 'spa-race.sto')

    await writeDownloadedSto(Readable.from([Buffer.from(PREVIOUS_SETUP, 'utf8')]), fresh)

    expect(await readFile(fresh, 'utf8')).toBe(PREVIOUS_SETUP)
  })
})
