import { join } from 'node:path'

/**
 * Per-harness Vite dependency-cache directories.
 *
 * Vite's dependency optimizer treats `<cacheDir>/deps` as a directory it owns outright. On
 * startup it compares the cached metadata hash against its own resolved config and, when they
 * differ, deletes the directory; when it re-optimises it renames the old directory away and
 * swaps a freshly bundled one in. Both operations are destructive and neither coordinates with
 * any other process.
 *
 * Every browser-class harness in this repository boots its own `createServer({ root: appRoot })`,
 * each with a different `optimizeDeps.include`, and Vitest runs those files in parallel. Left on
 * the default `cacheDir` they all resolve to the single `app-v2/node_modules/.vite`, so each
 * server start invalidates the optimised dependencies the already-running servers are still
 * serving. A page that is mid-import then receives `504 Outdated Optimize Dep` for
 * `/node_modules/.vite/deps/<dep>.js?v=<hash>`, which Chromium reports against the entry of the
 * dynamic import that pulled it in:
 *
 *   TypeError: Failed to fetch dynamically imported module: .../preset-gallery.tsx
 *
 * That is a hard failure with no timing component, so no timeout can be raised to avoid it and
 * no wait can be lengthened to survive it. The shared directory is the whole defect.
 *
 * Giving each harness its own directory removes the shared resource: no server can invalidate
 * another's optimised dependencies, and the directories persist between runs so the optimiser
 * work is cached rather than repeated.
 *
 * `key` must be unique per test file. Vitest never runs two tests from the same file
 * concurrently, so one directory per file has exactly one live owner at any moment.
 */
export function browserHarnessCacheDir(appRoot: string, key: string): string {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(key)) {
    throw new Error(`Browser harness cache key must be lowercase kebab-case, got ${JSON.stringify(key)}`)
  }
  return join(appRoot, 'node_modules', '.vite-harness', key)
}
