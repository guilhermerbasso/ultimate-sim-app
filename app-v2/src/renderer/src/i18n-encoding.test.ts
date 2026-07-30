import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Byte-level encoding guard.
 *
 * A lossy ASCII transcode once destroyed every non-ASCII character in large parts
 * of the translation catalogs: `Löschen` became `L?schen`, `8×8` became `8?8`,
 * `SIM-X · 115200` became `SIM-X ? 115200`, and whole CJK strings collapsed to
 * `???`. Those defects are invisible in review and only surface to the user.
 *
 * This test fails if any mis-decoded byte sequence reappears anywhere in `src`.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', 'build', 'release', '.git'])

function collect(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) collect(full, acc)
    else if (/\.(tsx?|jsx?|json|css|html)$/.test(entry.name)) acc.push(full)
  }
  return acc
}

/** Literal single- and double-quoted strings. Neither form spans a line break. */
const STRING_LITERAL = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g

/** UTF-8 re-decoded as Latin-1/CP1252, plus the Unicode replacement character. */
const MOJIBAKE = /\u00C3[\u0080-\u00BF]|\u00E2\u0080[\u0080-\u00BF]|\u00CE[\u0080-\u00BF]|\uFFFD/

/**
 * A `?` is legitimate in a URL query string, as a SQL bound-parameter placeholder,
 * inside a formula ternary, and as the bare serial protocol command emitted into
 * generated Arduino sketches. Everything else below is a lost character.
 */
const URL_QUERY = /^[^\s]*:\/\/|^\/[\w/-]*\?[\w-]+=/
const SQL_PLACEHOLDER = /\b(?:select|insert|update|delete|values|where|set|from)\b/i
const EXPRESSION_TERNARY = /\?[^:?]*:/

const LOST = [
  // `8?8` / `0?1`: a destroyed multiplication sign or en dash.
  ['lost-symbol-between-digits', /\d\?\d/u],
  // `word ? word`: a destroyed arrow, middle dot or em dash.
  ['lost-symbol-between-words', /[\p{L}\p{N}] \? [\p{L}\p{N}]/u],
  // `?C` / `?F`: a destroyed degree sign.
  ['lost-degree-sign', /(?:^|\d|\s)\?[CF](?![\p{L}\p{N}])/u],
  // `L?schen`: a destroyed diacritic inside a word.
  ['lost-diacritic', /\p{L}\?\p{L}/u],
  // `???`: a destroyed CJK run.
  ['lost-characters', /\?{2,}/u]
] as const

type Finding = { file: string; line: number; kind: string; text: string }

const FILES = collect(SRC)
const boms: string[] = []
const mojibake: string[] = []
const lost: Finding[] = []

for (const file of FILES) {
  const buf = readFileSync(file)
  const relPath = relative(SRC, file).split(sep).join('/')

  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) boms.push(relPath)

  const text = buf.toString('utf8')
  // Cheap whole-file gates keep this scan off the hot path for unaffected files.
  const hasHighBytes = /[\u00C2\u00C3\u00CE\u00E2\uFFFD]/.test(text)
  const hasQuestion = text.includes('?')
  if (!hasHighBytes && !hasQuestion) continue

  let lineStarts: number[] | null = null
  const lineOf = (index: number): number => {
    if (!lineStarts) {
      const starts = [0]
      for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1)
      lineStarts = starts
    }
    let lo = 0
    let hi = lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (lineStarts[mid] <= index) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }

  if (hasHighBytes && MOJIBAKE.test(text)) {
    let offset = 0
    for (const line of text.split('\n')) {
      if (MOJIBAKE.test(line)) mojibake.push(`${relPath}:${lineOf(offset)} ${line.trim().slice(0, 120)}`)
      offset += line.length + 1
    }
  }

  if (!hasQuestion) continue

  STRING_LITERAL.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = STRING_LITERAL.exec(text))) {
    const raw = match[1] ?? match[2] ?? ''
    if (!raw.includes('?')) continue
    const value = raw.replace(/\$\{[^}]*\}/g, '\u0000')
    if (value === '?') continue
    if (URL_QUERY.test(value)) continue
    if (EXPRESSION_TERNARY.test(value)) continue
    if (SQL_PLACEHOLDER.test(value)) continue
    for (const [kind, re] of LOST) {
      if (re.test(value)) lost.push({ file: relPath, line: lineOf(match.index), kind, text: value.slice(0, 120) })
    }
  }
}

describe('source encoding integrity', () => {
  it('scans a meaningful number of source files', () => {
    expect(FILES.length).toBeGreaterThan(500)
  })

  it('has no UTF-8 byte-order marks', () => {
    expect(boms, `BOM must be stripped from:\n${boms.join('\n')}`).toEqual([])
  })

  it('has no mojibake or replacement characters', () => {
    expect(mojibake, `Mis-decoded UTF-8 found:\n${mojibake.join('\n')}`).toEqual([])
  })

  it('has no question marks standing in for lost characters', () => {
    const bad = lost.map((f) => `${f.file}:${f.line} [${f.kind}] ${f.text}`)
    expect(
      bad,
      `${bad.length} string(s) contain '?' where a real character belongs:\n${bad.join('\n')}`
    ).toEqual([])
  })
})
