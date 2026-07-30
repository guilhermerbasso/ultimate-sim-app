// Release artifact gate for the Windows installer.
//
// A published release is only trustworthy when the tag, package.json, the lockfile,
// `latest.yml` and the artifacts on disk all describe the SAME build. Release v2.50.0
// shipped `latest.yml` pointing at 2.49.0 assets, v2.40.0 shipped without `latest.yml`
// and v2.43.0 shipped without assets at all — every one of those is a silent updater
// break, so this script FAILS CLOSED: any inconsistency is an error, never a warning.
//
// Checks
//   1. Tag (when given), package.json and package-lock.json declare the same version.
//   2. The four required assets exist: latest.yml, .exe, .exe.blockmap, .zip.
//   3. No artifact from a DIFFERENT version is present in the output directory.
//   4. latest.yml version/path match the build, and every `files[]` entry resolves to a
//      real asset whose size and sha512 match byte-for-byte.
//   5. The NSIS installer entry keeps `isAdminRightsRequired: true` (per-machine update).
//   6. A SHA256SUMS.txt is emitted with an independent SHA-256 per uploaded asset.
//
// Usage:
//   node scripts/verify-release-artifacts.mjs [--dist dist-win] [--tag refs/tags/v2.56.0]
//                                             [--no-write-checksums]

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ARTIFACT_PREFIX = 'Ultimate-Sim-App-'
const ARTIFACT_VERSION_RE = /^Ultimate-Sim-App-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)-x64\.(exe|exe\.blockmap|zip)$/

/**
 * Turn a git ref, tag or bare version into a plain semver string.
 * `refs/tags/v2.56.0`, `v2.56.0` and `2.56.0` all normalise to `2.56.0`.
 */
export function normalizeVersion(value) {
  if (typeof value !== 'string') return ''
  return value
    .trim()
    .replace(/^refs\/tags\//, '')
    .replace(/^v/i, '')
    .trim()
}

function sha256Hex(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function sha512Base64(file) {
  return createHash('sha512').update(readFileSync(file)).digest('base64')
}

function requiredAssetNames(version) {
  return [
    'latest.yml',
    `${ARTIFACT_PREFIX}${version}-x64.exe`,
    `${ARTIFACT_PREFIX}${version}-x64.exe.blockmap`,
    `${ARTIFACT_PREFIX}${version}-x64.zip`
  ]
}

/**
 * @returns {{ errors: string[], notes: string[], version: string, assets: {name: string, size: number, sha256: string}[] }}
 */
export function verifyReleaseArtifacts({ appRoot = APP_ROOT, distDir = 'dist-win', tag = '' } = {}) {
  const errors = []
  const notes = []
  const dist = resolve(appRoot, distDir)

  const packageJson = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8'))
  const version = String(packageJson.version ?? '')
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    errors.push(`package.json version is not a plain semver: ${JSON.stringify(version)}`)
    return { errors, notes, version, assets: [] }
  }

  const lockPath = join(appRoot, 'package-lock.json')
  if (existsSync(lockPath)) {
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
    if (lock.version !== version) {
      errors.push(`package-lock.json version ${lock.version} != package.json version ${version}`)
    }
    const rootEntry = lock.packages?.['']?.version
    if (rootEntry !== version) {
      errors.push(`package-lock.json packages[""].version ${rootEntry} != package.json version ${version}`)
    }
  } else {
    errors.push('package-lock.json is missing — the build is not reproducible')
  }

  const normalizedTag = normalizeVersion(tag)
  if (normalizedTag) {
    if (normalizedTag !== version) {
      errors.push(`tag ${normalizedTag} != package.json version ${version}`)
    } else {
      notes.push(`tag, package.json and package-lock.json all declare ${version}`)
    }
  } else {
    notes.push('no tag supplied — skipping tag/version equality check')
  }

  if (!existsSync(dist)) {
    errors.push(`output directory not found: ${dist}`)
    return { errors, notes, version, assets: [] }
  }

  const required = requiredAssetNames(version)
  const present = new Set(readdirSync(dist))

  for (const name of required) {
    const file = join(dist, name)
    if (!present.has(name) || !statSync(file).isFile() || statSync(file).size === 0) {
      errors.push(`missing or empty required asset: ${name}`)
    }
  }

  for (const name of present) {
    if (!name.startsWith(ARTIFACT_PREFIX)) continue
    const match = ARTIFACT_VERSION_RE.exec(name)
    if (!match) {
      errors.push(`unrecognised artifact name in ${distDir}: ${name}`)
      continue
    }
    if (match[1] !== version) {
      errors.push(`foreign-version artifact in ${distDir}: ${name} (build is ${version})`)
    }
  }

  const latestPath = join(dist, 'latest.yml')
  if (present.has('latest.yml')) {
    let latest
    try {
      latest = YAML.parse(readFileSync(latestPath, 'utf8'))
    } catch (error) {
      errors.push(`latest.yml is not valid YAML: ${error.message}`)
    }

    if (latest && typeof latest === 'object') {
      if (String(latest.version) !== version) {
        errors.push(`latest.yml version ${latest.version} != build version ${version}`)
      }

      const installer = `${ARTIFACT_PREFIX}${version}-x64.exe`
      if (String(latest.path) !== installer) {
        errors.push(`latest.yml path ${latest.path} != ${installer}`)
      }

      const files = Array.isArray(latest.files) ? latest.files : []
      if (files.length === 0) {
        errors.push('latest.yml declares no files — electron-updater cannot resolve an asset')
      }

      for (const entry of files) {
        const url = String(entry?.url ?? '')
        if (!required.includes(url)) {
          errors.push(`latest.yml references an asset that is not part of this release: ${url}`)
          continue
        }
        const file = join(dist, url)
        if (!present.has(url)) {
          errors.push(`latest.yml references a missing asset: ${url}`)
          continue
        }
        const actualSize = statSync(file).size
        if (Number(entry.size) !== actualSize) {
          errors.push(`latest.yml size for ${url} is ${entry.size}, file is ${actualSize}`)
        }
        const actualSha512 = sha512Base64(file)
        if (String(entry.sha512) !== actualSha512) {
          errors.push(`latest.yml sha512 for ${url} does not match the file on disk`)
        }
        if (url.endsWith('.exe')) {
          if (entry.isAdminRightsRequired !== true) {
            errors.push(`latest.yml entry for ${url} must set isAdminRightsRequired: true (per-machine install)`)
          }
          if (String(latest.sha512) !== actualSha512) {
            errors.push('latest.yml top-level sha512 does not match the installer on disk')
          }
        }
      }
    }
  }

  const assets = []
  if (errors.length === 0) {
    for (const name of required) {
      const file = join(dist, name)
      assets.push({ name, size: statSync(file).size, sha256: sha256Hex(file) })
    }
  }

  return { errors, notes, version, assets }
}

export function renderChecksums(assets) {
  return `${assets.map((asset) => `${asset.sha256}  ${asset.name}`).join('\n')}\n`
}

function main(argv) {
  let distDir = 'dist-win'
  let tag = process.env.GITHUB_REF_NAME ?? ''
  let writeChecksums = true

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--dist') {
      distDir = argv[++index] ?? distDir
    } else if (arg === '--tag') {
      tag = argv[++index] ?? ''
    } else if (arg === '--no-write-checksums') {
      writeChecksums = false
    } else {
      console.error(`usage: verify-release-artifacts.mjs [--dist <dir>] [--tag <ref>] [--no-write-checksums]`)
      return 2
    }
  }

  // Only a v* tag pins the version; a manual dispatch legitimately has no tag.
  if (!/^(refs\/tags\/)?v?\d/.test(tag)) tag = ''

  const { errors, notes, version, assets } = verifyReleaseArtifacts({ distDir, tag })

  for (const note of notes) console.log(`[verify-release-artifacts] ${note}`)

  if (errors.length > 0) {
    console.error('[verify-release-artifacts] FAILED — refusing to publish an inconsistent release:')
    for (const error of errors) console.error(`[verify-release-artifacts]   - ${error}`)
    return 1
  }

  const checksums = renderChecksums(assets)
  if (writeChecksums) {
    writeFileSync(resolve(APP_ROOT, distDir, 'SHA256SUMS.txt'), checksums)
  }

  console.log(`[verify-release-artifacts] OK — ${version}: ${assets.length} assets verified`)
  process.stdout.write(checksums)
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exit(main(process.argv.slice(2)))
}
