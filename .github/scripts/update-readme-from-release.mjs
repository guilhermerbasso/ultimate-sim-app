#!/usr/bin/env node
// Updates README.md when a GitHub Release is published.
//
// It (1) bumps the app version in the title and the "What is included in <version>"
// heading, and (2) prepends a plain-language entry to the "What's new" section
// (between the WHATS_NEW markers), deduped by version and capped to the most recent
// releases. Release notes are already written for users, so the highlights read
// well for non-technical readers.
//
// Driven by env vars the workflow sets from the release event:
//   RELEASE_TAG   e.g. "v2.50.0"
//   RELEASE_NAME  e.g. "Ultimate Sim App v2.50.0 — Intent- & Racecraft-Aware AI Coach"
//   RELEASE_BODY  the markdown release notes
//   RELEASE_URL   the release html_url
//
// Usage (locally, for testing):
//   RELEASE_TAG=v2.50.0 RELEASE_NAME="…" RELEASE_BODY="$(cat notes.md)" \
//   RELEASE_URL="https://…" node .github/scripts/update-readme-from-release.mjs

import { readFileSync, writeFileSync } from 'node:fs'

const README = 'README.md'
const START = '<!-- WHATS_NEW:START -->'
const END = '<!-- WHATS_NEW:END -->'
const MAX_ENTRIES = 8
const MAX_HIGHLIGHTS = 6

const tag = (process.env.RELEASE_TAG || '').trim()
const name = (process.env.RELEASE_NAME || '').trim()
const body = (process.env.RELEASE_BODY || '').replace(/\r\n/g, '\n')
const url = (process.env.RELEASE_URL || '').trim()

if (!tag) {
  console.error('RELEASE_TAG is required')
  process.exit(1)
}
const version = tag.replace(/^v/i, '')
if (!/^\d+\.\d+\.\d+/.test(version)) {
  console.error(`Unexpected version derived from tag "${tag}"`)
  process.exit(1)
}

/** One short, human-friendly headline for the release. */
function headline() {
  const fromName = name.split(/\s[—–-]\s/).slice(1).join(' — ').trim()
  if (fromName) return fromName
  const firstLine = body
    .split('\n')
    .map((s) => s.trim())
    .find((s) => s && !s.startsWith('#') && !s.startsWith('<!--'))
  return firstLine ? firstLine.replace(/\*\*/g, '').slice(0, 90) : `Release ${version}`
}

/** The most user-facing bullets from the notes (skips CI/boilerplate lines). */
function highlights() {
  const stop = /^##?\s*(what'?s changed|full changelog)/i
  const skip = /full test suite|typecheck clean|under the hood/i
  const seen = new Set()
  const out = []
  for (const raw of body.split('\n')) {
    if (stop.test(raw.trim())) break
    const m = raw.match(/^\s*[-*]\s+(.+)$/)
    if (!m) continue
    const text = m[1].trim()
    if (!text || skip.test(text) || seen.has(text)) continue
    seen.add(text)
    out.push(`- ${text}`)
    if (out.length >= MAX_HIGHLIGHTS) break
  }
  return out
}

function buildEntry() {
  const lines = [`### ${version} — ${headline()}`, '']
  const hl = highlights()
  if (hl.length) lines.push(...hl, '')
  if (url) lines.push(`See the [${tag} release notes](${url}) for the full list.`)
  return lines.join('\n').trim()
}

let md = readFileSync(README, 'utf8')

// 1) Version bumps.
md = md.replace(/\*\*Ultimate Sim App \d+\.\d+\.\d+\*\*/g, `**Ultimate Sim App ${version}**`)
md = md.replace(/## What is included in \d+\.\d+\.\d+/g, `## What is included in ${version}`)

// 2) "What's new": prepend this release (deduped by version), cap the list.
const startIdx = md.indexOf(START)
const endIdx = md.indexOf(END)
if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
  console.error('WHATS_NEW markers not found in README.md')
  process.exit(1)
}
const inner = md.slice(startIdx + START.length, endIdx)
const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const sameVersion = new RegExp(`^### ${escapedVersion}(\\D|$)`)
const existing = inner
  .split(/\n(?=### )/)
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((entry) => !sameVersion.test(entry))
const entries = [buildEntry(), ...existing].slice(0, MAX_ENTRIES)

const before = md.slice(0, startIdx + START.length)
const after = md.slice(endIdx)
md = `${before}\n\n${entries.join('\n\n')}\n\n${after}`

writeFileSync(README, md, 'utf8')
console.log(`README updated for ${tag} (${entries.length} entries in What's new).`)
