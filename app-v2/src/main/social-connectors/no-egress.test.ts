import { readdirSync, readFileSync } from 'node:fs'
import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

interface EgressPattern {
  readonly label: string
  readonly pattern: RegExp
}

const APP_ROOT = new URL('../../../', import.meta.url)
const SOURCE_ROOTS = [
  new URL('./', import.meta.url),
  new URL('../../shared/social-connectors/', import.meta.url)
] as const
const EXTRA_SOURCE_FILES = [
  new URL('../../renderer/src/views/SocialConnectorsView.tsx', import.meta.url)
] as const
const LIVE_EGRESS_PATTERNS: readonly EgressPattern[] = [
  {
    label: 'Node network module',
    pattern:
      /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"](?:node:)?(?:http|https|http2|net|tls|dgram|dns(?:\/promises)?)['"]/
  },
  {
    label: 'network client package',
    pattern: /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"](?:axios|got|undici|ws)['"]/
  },
  { label: 'fetch', pattern: /\bfetch\s*\(/ },
  { label: 'WebSocket', pattern: /\b(?:new\s+)?WebSocket\s*\(/ },
  { label: 'EventSource', pattern: /\b(?:new\s+)?EventSource\s*\(/ },
  { label: 'XMLHttpRequest', pattern: /\b(?:new\s+)?XMLHttpRequest\s*\(/ },
  { label: 'Electron network request', pattern: /\b(?:net|electronNet)\.(?:fetch|request)\s*\(/ }
]

function collectProductionSources(directory: URL): URL[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryUrl = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directory)
    if (entry.isDirectory()) return collectProductionSources(entryUrl)
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return []
    return [entryUrl]
  })
}

describe('social connector no-live-egress boundary', () => {
  it('contains no live network client path in production connector sources', () => {
    const violations: string[] = []
    const files = [
      ...SOURCE_ROOTS.flatMap((directory) => collectProductionSources(directory)),
      ...EXTRA_SOURCE_FILES
    ]

    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      const path = relative(fileURLToPath(APP_ROOT), fileURLToPath(file))
      for (const { label, pattern } of LIVE_EGRESS_PATTERNS) {
        if (pattern.test(source)) violations.push(`${path}: ${label}`)
      }
    }

    expect(violations).toEqual([])
  })
})
