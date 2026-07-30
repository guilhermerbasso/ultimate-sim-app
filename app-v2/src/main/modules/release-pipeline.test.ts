import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import YAML from 'yaml'

import {
  normalizeVersion,
  renderChecksums,
  verifyReleaseArtifacts
} from '../../../scripts/verify-release-artifacts.mjs'

const APP_ROOT = process.cwd()
const REPO_ROOT = join(APP_ROOT, '..')
const VERSION = '9.9.9'

// Scratch roots live inside the repo (never the OS temp dir) and are removed per test.
const scratchRoots: string[] = []

function makeFixture(): string {
  mkdirSync(join(APP_ROOT, '.release-fixtures'), { recursive: true })
  const root = mkdtempSync(join(APP_ROOT, '.release-fixtures', 'case-'))
  scratchRoots.push(root)

  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: VERSION }))
  writeFileSync(
    join(root, 'package-lock.json'),
    JSON.stringify({ version: VERSION, packages: { '': { version: VERSION } } })
  )
  mkdirSync(join(root, 'dist-win'))
  return root
}

function writeAsset(root: string, name: string, body: string): void {
  writeFileSync(join(root, 'dist-win', name), body)
}

function sha512Base64(body: string): string {
  return createHash('sha512').update(Buffer.from(body)).digest('base64')
}

function writeGoodRelease(root: string, overrides: Record<string, unknown> = {}): void {
  const exe = `Ultimate-Sim-App-${VERSION}-x64.exe`
  const body = 'installer-bytes'
  writeAsset(root, exe, body)
  writeAsset(root, `${exe}.blockmap`, 'blockmap-bytes')
  writeAsset(root, `Ultimate-Sim-App-${VERSION}-x64.zip`, 'zip-bytes')
  writeAsset(
    root,
    'latest.yml',
    YAML.stringify({
      version: VERSION,
      files: [
        {
          url: exe,
          sha512: sha512Base64(body),
          size: Buffer.byteLength(body),
          isAdminRightsRequired: true
        }
      ],
      path: exe,
      sha512: sha512Base64(body),
      releaseDate: '2026-07-25T04:31:37.604Z',
      ...overrides
    })
  )
}

afterEach(() => {
  while (scratchRoots.length > 0) rmSync(scratchRoots.pop()!, { recursive: true, force: true })
  rmSync(join(APP_ROOT, '.release-fixtures'), { recursive: true, force: true })
})

describe('normalizeVersion', () => {
  it('normalises refs, tags and bare versions to plain semver', () => {
    expect(normalizeVersion('refs/tags/v2.56.0')).toBe('2.56.0')
    expect(normalizeVersion('v2.56.0')).toBe('2.56.0')
    expect(normalizeVersion('2.56.0')).toBe('2.56.0')
    expect(normalizeVersion(undefined)).toBe('')
  })
})

describe('verifyReleaseArtifacts', () => {
  it('accepts a consistent four-asset release and emits one SHA-256 per asset', () => {
    const root = makeFixture()
    writeGoodRelease(root)

    const result = verifyReleaseArtifacts({ appRoot: root, tag: `refs/tags/v${VERSION}` })

    expect(result.errors).toEqual([])
    expect(result.assets.map((asset) => asset.name).sort()).toEqual(
      [
        'latest.yml',
        `Ultimate-Sim-App-${VERSION}-x64.exe`,
        `Ultimate-Sim-App-${VERSION}-x64.exe.blockmap`,
        `Ultimate-Sim-App-${VERSION}-x64.zip`
      ].sort()
    )
    for (const asset of result.assets) expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(new Set(result.assets.map((asset) => asset.sha256)).size).toBe(4)
    expect(renderChecksums(result.assets)).toContain(`  Ultimate-Sim-App-${VERSION}-x64.exe\n`)
  })

  it('rejects a tag that does not match the package version', () => {
    const root = makeFixture()
    writeGoodRelease(root)

    const result = verifyReleaseArtifacts({ appRoot: root, tag: 'refs/tags/v1.2.3' })

    expect(result.errors).toContain(`tag 1.2.3 != package.json version ${VERSION}`)
  })

  it('rejects the v2.50.0 failure mode: latest.yml pointing at another version', () => {
    const root = makeFixture()
    writeGoodRelease(root, { version: '2.49.0', path: 'Ultimate-Sim-App-2.49.0-x64.exe' })

    const result = verifyReleaseArtifacts({ appRoot: root })

    expect(result.errors).toContain(`latest.yml version 2.49.0 != build version ${VERSION}`)
    expect(
      result.errors.some((error) => error.startsWith('latest.yml path Ultimate-Sim-App-2.49.0-x64.exe'))
    ).toBe(true)
  })

  it('rejects artifacts left over from a different version', () => {
    const root = makeFixture()
    writeGoodRelease(root)
    writeAsset(root, 'Ultimate-Sim-App-2.49.0-x64.exe', 'stale')

    const result = verifyReleaseArtifacts({ appRoot: root })

    expect(result.errors).toContain(
      `foreign-version artifact in dist-win: Ultimate-Sim-App-2.49.0-x64.exe (build is ${VERSION})`
    )
  })

  it('rejects a missing asset instead of publishing a partial release', () => {
    const root = makeFixture()
    writeGoodRelease(root)
    rmSync(join(root, 'dist-win', `Ultimate-Sim-App-${VERSION}-x64.zip`))

    const result = verifyReleaseArtifacts({ appRoot: root })

    expect(result.errors).toContain(
      `missing or empty required asset: Ultimate-Sim-App-${VERSION}-x64.zip`
    )
    expect(result.assets).toEqual([])
  })

  it('rejects a sha512 or size in latest.yml that does not match the bytes on disk', () => {
    const root = makeFixture()
    writeGoodRelease(root)
    const exe = `Ultimate-Sim-App-${VERSION}-x64.exe`
    const latest = YAML.parse(readFileSync(join(root, 'dist-win', 'latest.yml'), 'utf8'))
    latest.files[0].sha512 = sha512Base64('tampered')
    latest.files[0].size = 1
    writeAsset(root, 'latest.yml', YAML.stringify(latest))

    const result = verifyReleaseArtifacts({ appRoot: root })

    expect(result.errors).toContain(`latest.yml sha512 for ${exe} does not match the file on disk`)
    expect(result.errors.some((error) => error.startsWith(`latest.yml size for ${exe}`))).toBe(true)
  })

  it('requires the installer entry to keep isAdminRightsRequired for per-machine updates', () => {
    const root = makeFixture()
    writeGoodRelease(root)
    const latest = YAML.parse(readFileSync(join(root, 'dist-win', 'latest.yml'), 'utf8'))
    delete latest.files[0].isAdminRightsRequired
    writeAsset(root, 'latest.yml', YAML.stringify(latest))

    const result = verifyReleaseArtifacts({ appRoot: root })

    expect(
      result.errors.some((error) => error.includes('must set isAdminRightsRequired: true'))
    ).toBe(true)
  })
})

describe('release workflow gates', () => {
  const workflow = YAML.parse(
    readFileSync(join(REPO_ROOT, '.github', 'workflows', 'build-windows-installer.yml'), 'utf8')
  )
  const raw = readFileSync(
    join(REPO_ROOT, '.github', 'workflows', 'build-windows-installer.yml'),
    'utf8'
  )
  const steps = workflow.jobs['build-win'].steps as { name?: string; uses?: string; run?: string; with?: Record<string, unknown> }[]

  it('runs typecheck and tests before packaging', () => {
    const names = steps.map((step) => step.name ?? step.uses ?? '')
    const typecheck = names.findIndex((name) => /typecheck/i.test(name))
    const tests = names.findIndex((name) => /^Test/i.test(name))
    const pack = names.findIndex((name) => /NSIS installer/i.test(name))

    expect(typecheck).toBeGreaterThanOrEqual(0)
    expect(tests).toBeGreaterThanOrEqual(0)
    expect(typecheck).toBeLessThan(pack)
    expect(tests).toBeLessThan(pack)
  })

  it('verifies release artifacts and checksums before any upload', () => {
    const verify = steps.findIndex((step) => /Verify release artifacts/i.test(step.name ?? ''))
    const release = steps.findIndex((step) =>
      String(step.uses ?? '').startsWith('softprops/action-gh-release')
    )

    expect(verify).toBeGreaterThanOrEqual(0)
    expect(release).toBeGreaterThan(verify)
  })

  it('never auto-publishes: the release is created as a draft with fail-closed uploads', () => {
    const release = steps.find((step) => String(step.uses ?? '').startsWith('softprops/action-gh-release'))

    expect(release?.with?.draft).toBe(true)
    expect(release?.with?.fail_on_unmatched_files).toBe(true)
    expect(String(release?.with?.files ?? '')).toContain('SHA256SUMS.txt')
  })

  it('pins every external action to a 40-character commit SHA', () => {
    const uses = steps.map((step) => step.uses).filter(Boolean) as string[]

    expect(uses.length).toBeGreaterThan(0)
    for (const action of uses) {
      expect(action).toMatch(/^[^@\s/]+\/[^@\s]*@[0-9a-f]{40}$/)
    }
  })

  it('fails closed when a signing certificate is configured but the signature is invalid', () => {
    expect(raw).toContain('WINDOWS_SIGNING_PFX_BASE64')
    expect(raw).toContain('Get-AuthenticodeSignature')
    expect(raw).toContain('REQUIRE_SIGNED_INSTALLER')
  })
})
