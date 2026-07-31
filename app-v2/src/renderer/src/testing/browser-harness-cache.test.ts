import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { browserHarnessCacheDir } from './browser-harness-cache'

/**
 * Structural guard for browser-harness dependency-cache isolation.
 *
 * Two Vite dev servers must never share a dependency-cache directory. When they did, every
 * harness start wiped the optimised dependencies the concurrently running harnesses were still
 * serving, and their pages died on `504 Outdated Optimize Dep` half-way through an import.
 * `browserHarnessCacheDir` is the fix; this proves nothing has drifted back off it.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

function collect(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) collect(full, acc)
    else if (/\.tsx?$/.test(entry)) acc.push(full)
  }
  return acc
}

const files = collect(SRC).map((file) => ({
  path: relative(SRC, file).split(sep).join('/'),
  source: readFileSync(file, 'utf8')
}))

/** Cache keys a file claims, either directly or through the accessibility harness. */
function keysIn(source: string): string[] {
  return [
    ...Array.from(source.matchAll(/browserHarnessCacheDir\(\s*\w+\s*,\s*'([^']+)'\s*\)/g)),
    ...Array.from(source.matchAll(/cacheKey:\s*'([^']+)'/g))
  ].map((match) => match[1])
}

const harnesses = files.filter((file) =>
  /import\s*\{[^}]*\bcreateServer\b[^}]*\}\s*from\s*'vite'/.test(file.source)
)
const browserTests = files.filter((file) => file.path.endsWith('.browser.test.ts'))

describe('browser harness dependency-cache isolation', () => {
  it('finds the harnesses and the browser-class suites', () => {
    expect(harnesses.length).toBeGreaterThanOrEqual(2)
    expect(browserTests.length).toBeGreaterThanOrEqual(6)
  })

  it('gives every Vite dev server started under src its own cacheDir', () => {
    const shared = harnesses
      .filter((file) => !/cacheDir:\s*browserHarnessCacheDir\(/.test(file.source))
      .map((file) => file.path)
    expect(
      shared,
      `${shared.length} harness(es) start a Vite dev server on the default shared cacheDir. ` +
        "Concurrent servers then delete each other's optimised dependencies mid-import:\n" +
        shared.join('\n')
    ).toEqual([])
  })

  it('names a cache key in every browser-class suite', () => {
    const unkeyed = browserTests.filter((file) => keysIn(file.source).length === 0).map((file) => file.path)
    expect(unkeyed, `browser-class suites with no harness cache key:\n${unkeyed.join('\n')}`).toEqual([])
  })

  it('never lets two test files claim the same cache key', () => {
    const owners = new Map<string, Set<string>>()
    for (const file of browserTests) {
      for (const key of keysIn(file.source)) {
        const set = owners.get(key) ?? new Set<string>()
        set.add(file.path)
        owners.set(key, set)
      }
    }
    const shared = Array.from(owners, ([key, set]) => ({ key, files: Array.from(set).sort() })).filter(
      (entry) => entry.files.length > 1
    )
    expect(
      shared,
      'These cache keys are claimed by more than one test file, so those files can run in ' +
        'parallel against one dependency cache:\n' +
        shared.map((entry) => `${entry.key}: ${entry.files.join(', ')}`).join('\n')
    ).toEqual([])
    expect(owners.size).toBeGreaterThanOrEqual(browserTests.length)
  })
})

describe('browserHarnessCacheDir', () => {
  it('puts each key in its own directory under the project node_modules', () => {
    expect(browserHarnessCacheDir('app-root', 'one')).toBe(
      join('app-root', 'node_modules', '.vite-harness', 'one')
    )
    expect(browserHarnessCacheDir('app-root', 'one')).not.toBe(browserHarnessCacheDir('app-root', 'two'))
  })

  it('rejects keys that could escape or collide', () => {
    for (const key of ['', 'Upper', 'has space', '../escape', 'trailing-', 'double--dash', 'dot.dot']) {
      expect(() => browserHarnessCacheDir('app-root', key)).toThrow(/kebab-case/)
    }
  })
})
