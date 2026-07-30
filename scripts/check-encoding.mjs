#!/usr/bin/env node
/**
 * Repository-wide byte scan for encoding damage in tracked text files.
 *
 * Why this exists
 * ---------------
 * Windows PowerShell 5.1 writes a UTF-8 byte-order mark for `Set-Content -Encoding UTF8`,
 * `Out-File -Encoding utf8` and `Add-Content -Encoding UTF8`. Worse, its `Get-Content`
 * decodes a UTF-8 file using the active ANSI code page (Windows-1252 here), so the common
 * `Get-Content file | Set-Content file -Encoding UTF8` round-trip both prepends EF BB BF
 * and re-encodes every non-ASCII character into mojibake in a single step:
 *
 *   before  6D C3B3 64 ...            "m" U+00F3 "d"      (modulos, correctly encoded)
 *   after   EFBBBF 6D C383 C2B3 64    BOM + U+00C3 U+00B3 (mojibake)
 *
 * That exact byte pattern has reached `main` more than once. `i18n-encoding.test.ts`
 * detects it, but only under `app-v2/src` and only for a handful of extensions. This scan
 * covers every tracked text file in the repository and runs in CI, so a corrupted file
 * cannot be merged regardless of which shell or tool produced it.
 *
 * Usage
 * -----
 *   node scripts/check-encoding.mjs            scan every tracked file
 *   node scripts/check-encoding.mjs --staged   scan only staged additions/modifications
 *   node scripts/check-encoding.mjs --fix      strip UTF-8 BOMs in place, then re-scan
 *   node scripts/check-encoding.mjs --commits <range>   also report commit messages
 *   node scripts/check-encoding.mjs --message <file>    check one commit-message file
 *
 * This file is deliberately ASCII-only: every byte pattern it looks for is written as a
 * `\u....` escape so the scanner can never flag itself.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const args = process.argv.slice(2)
const FIX = args.includes('--fix')
const STAGED = args.includes('--staged')
const commitsIndex = args.indexOf('--commits')
const COMMIT_RANGE = commitsIndex === -1 ? null : args[commitsIndex + 1] || null
const messageIndex = args.indexOf('--message')
const MESSAGE_FILE = messageIndex === -1 ? null : args[messageIndex + 1] || null

/** Extensions declared `binary` in .gitattributes plus the usual opaque formats. */
const BINARY_EXTENSIONS = new Set([
  '7z', 'asar', 'avif', 'bin', 'blockmap', 'bmp', 'br', 'class', 'db', 'deb', 'dll', 'dmg',
  'dylib', 'eot', 'exe', 'gif', 'gz', 'ico', 'jar', 'jpeg', 'jpg', 'mp3', 'mp4', 'msi',
  'node', 'onnx', 'otf', 'p12', 'pdf', 'pfx', 'png', 'pyd', 'rpm', 'so', 'sqlite', 'stl',
  'tar', 'tif', 'tiff', 'ttc', 'ttf', 'wasm', 'wav', 'webm', 'webp', 'woff', 'woff2',
  'xlsx', 'zip', 'zst'
])

/**
 * UTF-8 bytes re-decoded as Windows-1252 and written back out as UTF-8. Mirrors the
 * detector in app-v2/src/renderer/src/i18n-encoding.test.ts so both agree on what
 * counts as damage.
 */
const MOJIBAKE = /\u00C3[\u0080-\u00BF]|\u00E2\u0080[\u0080-\u00BF]|\u00CE[\u0080-\u00BF]|\uFFFD/

const BOMS = [
  { name: 'UTF-8 BOM (EF BB BF)', bytes: [0xef, 0xbb, 0xbf], strippable: true },
  { name: 'UTF-32LE BOM (FF FE 00 00)', bytes: [0xff, 0xfe, 0x00, 0x00], strippable: false },
  { name: 'UTF-32BE BOM (00 00 FE FF)', bytes: [0x00, 0x00, 0xfe, 0xff], strippable: false },
  { name: 'UTF-16LE BOM (FF FE)', bytes: [0xff, 0xfe], strippable: false },
  { name: 'UTF-16BE BOM (FE FF)', bytes: [0xfe, 0xff], strippable: false }
]

function git(...gitArgs) {
  return execFileSync('git', gitArgs, { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 })
}

// `git ls-files` reports paths relative to the repository root, so run from there and the
// script works from any working directory (npm script, git hook, CI step).
const ORIGINAL_CWD = process.cwd()
process.chdir(git('rev-parse', '--show-toplevel').toString('utf8').trim())

/**
 * Commit-message mode, used by the `commit-msg` hook. A BOM here is the fingerprint of a
 * shell that writes UTF-8 with a BOM; the same shell will corrupt tracked files next.
 */
if (MESSAGE_FILE) {
  const raw = readFileSync(resolve(ORIGINAL_CWD, MESSAGE_FILE))
  const problems = []
  if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
    problems.push('the commit message file starts with a UTF-8 BOM (EF BB BF)')
  }
  if (MOJIBAKE.test(raw.toString('utf8'))) {
    problems.push('the commit message contains mis-decoded UTF-8 (mojibake)')
  }
  if (problems.length) {
    console.error(`Rejected commit message:\n  ${problems.join('\n  ')}`)
    console.error(
      '\n  The tool that wrote this message mis-encodes UTF-8 and will corrupt source files\n' +
        '  the same way. On Windows PowerShell 5.1 never use `Set-Content -Encoding UTF8`,\n' +
        '  `Out-File -Encoding utf8` or `Add-Content -Encoding UTF8`; use\n' +
        '  [IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding $false)).\n'
    )
    process.exit(1)
  }
  console.log('Commit message encoding clean.')
  process.exit(0)
}

function listFiles() {
  const out = STAGED
    ? git('diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z')
    : git('ls-files', '-z')
  return out
    .toString('utf8')
    .split('\0')
    .filter((name) => name.length > 0)
}

function extensionOf(path) {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase()
}

/** Git's own heuristic: a NUL byte near the start means "not text". */
function looksBinary(buf) {
  const limit = Math.min(buf.length, 8000)
  for (let i = 0; i < limit; i += 1) if (buf[i] === 0) return true
  return false
}

function matchBom(buf) {
  for (const bom of BOMS) {
    if (buf.length < bom.bytes.length) continue
    if (bom.bytes.every((byte, index) => buf[index] === byte)) return bom
  }
  return null
}

const strictDecoder = new TextDecoder('utf-8', { fatal: true })

const files = listFiles()
const bomFindings = []
const invalidFindings = []
const mojibakeFindings = []
const fixed = []

for (const path of files) {
  let buf
  try {
    buf = readFileSync(path)
  } catch (error) {
    if (error && error.code === 'ENOENT') continue // deleted or unmerged
    throw error
  }
  if (buf.length === 0) continue
  if (BINARY_EXTENSIONS.has(extensionOf(path))) continue

  const bom = matchBom(buf)
  // A UTF-16/UTF-32 file is full of NUL bytes, so it must be reported before the
  // "looks binary" heuristic gets a chance to skip it.
  if (bom && !bom.strippable) {
    bomFindings.push(`${path}: starts with a ${bom.name}`)
    continue
  }
  if (looksBinary(buf)) continue

  if (bom) {
    if (FIX) {
      writeFileSync(path, buf.subarray(bom.bytes.length))
      fixed.push(path)
      buf = buf.subarray(bom.bytes.length)
    } else {
      bomFindings.push(`${path}: starts with a ${bom.name}`)
      continue
    }
  }

  let text
  try {
    text = strictDecoder.decode(buf)
  } catch {
    invalidFindings.push(`${path}: is not valid UTF-8 (likely written with a legacy code page)`)
    continue
  }

  if (!MOJIBAKE.test(text)) continue
  let lineNumber = 0
  for (const line of text.split('\n')) {
    lineNumber += 1
    if (MOJIBAKE.test(line)) {
      mojibakeFindings.push(`${path}:${lineNumber} ${line.trim().slice(0, 120)}`)
    }
  }
}

const commitFindings = []
if (COMMIT_RANGE) {
  const raw = git('log', '--format=%H%x00%B%x00%x00', COMMIT_RANGE).toString('utf8')
  for (const record of raw.split('\0\0')) {
    const [sha, body] = record.replace(/^\n+/, '').split('\0')
    if (!sha || body === undefined) continue
    if (body.charCodeAt(0) === 0xfeff) {
      commitFindings.push(`${sha.slice(0, 12)}: commit message starts with a UTF-8 BOM`)
    } else if (MOJIBAKE.test(body)) {
      commitFindings.push(`${sha.slice(0, 12)}: commit message contains mojibake`)
    }
  }
}

if (fixed.length) {
  console.log(`Stripped a UTF-8 BOM from ${fixed.length} file(s):\n  ${fixed.join('\n  ')}`)
}

const sections = [
  ['UTF-8 or UTF-16 byte-order marks', bomFindings],
  ['Files that are not valid UTF-8', invalidFindings],
  ['Mis-decoded UTF-8 (mojibake)', mojibakeFindings]
]

let failed = false
for (const [title, findings] of sections) {
  if (!findings.length) continue
  failed = true
  console.error(`\n${title}:\n  ${findings.join('\n  ')}`)
}

if (commitFindings.length) {
  console.error(
    `\nCommit messages with encoding damage (warning only):\n  ${commitFindings.join('\n  ')}`
  )
  console.error(
    '\n  A BOM in a commit message means the message file was written by a tool that also\n' +
      '  corrupts source files. Fix the tool before it damages tracked content.'
  )
}

if (failed) {
  console.error(
    '\nEvery tracked text file must be UTF-8 without a byte-order mark.\n' +
      '  PowerShell 5.1:  [IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding $false))\n' +
      '  PowerShell 7+:   Set-Content -Encoding utf8NoBOM   (never plain -Encoding utf8 on 5.1)\n' +
      '  Node:            readFileSync(path, \'utf8\') / writeFileSync(path, text, \'utf8\')\n' +
      '  git:             node scripts/check-encoding.mjs --fix   strips UTF-8 BOMs in place\n'
  )
  process.exit(1)
}

console.log(
  `Encoding scan clean: ${files.length} tracked path(s) checked, no BOMs, no invalid UTF-8, no mojibake.`
)
