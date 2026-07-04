// Perceptual visual-regression diff for dashboard/overlay captures. Pairs PNGs in
// tests/visual/baseline against tests/visual/current, writes per-image diffs to
// tests/visual/diff, and fails (exit 1) when any image drifts beyond the threshold.
// This is the "is it still pixel-faithful?" gate the GT3 research flagged as missing
// (Playwright already captures screenshots — this adds the perceptual comparison).
//
// Workflow:
//   1. Capture widget/cluster screenshots into tests/visual/current/*.png
//      (e.g. render a preview route with the telemetry-scenarios frames via Playwright,
//      or drop a reference photo to compare a render against).
//   2. node scripts/visual-regression.mjs            # compare, write diffs, report
//   3. node scripts/visual-regression.mjs --update   # accept current as the new baseline
//
// Options:
//   --threshold <0..1>   per-pixel colour sensitivity (default 0.1)
//   --max-diff <0..1>    max fraction of differing pixels allowed (default 0.005)

import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'tests', 'visual')
const BASELINE = join(dir, 'baseline')
const CURRENT = join(dir, 'current')
const DIFF = join(dir, 'diff')

for (const d of [BASELINE, CURRENT, DIFF]) mkdirSync(d, { recursive: true })

const args = process.argv.slice(2)
const update = args.includes('--update')
const threshold = numArg('--threshold', 0.1)
const maxDiff = numArg('--max-diff', 0.005)

function numArg(flag, fallback) {
  const i = args.indexOf(flag)
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback
}

const pngs = readdirSync(CURRENT).filter((f) => f.toLowerCase().endsWith('.png'))

if (update) {
  for (const f of pngs) copyFileSync(join(CURRENT, f), join(BASELINE, f))
  console.log(`Updated baseline with ${pngs.length} image(s).`)
  process.exit(0)
}

if (pngs.length === 0) {
  console.log('No PNGs in tests/visual/current — nothing to compare.')
  console.log('Capture screenshots there first (e.g. via Playwright + telemetry-scenarios).')
  process.exit(0)
}

let failures = 0
let missing = 0
console.log('\n  Visual regression\n')

for (const f of pngs) {
  const basePath = join(BASELINE, f)
  if (!existsSync(basePath)) {
    console.log(`  ?  ${f}  — no baseline (run with --update to accept)`)
    missing++
    continue
  }
  const cur = PNG.sync.read(readFileSync(join(CURRENT, f)))
  const base = PNG.sync.read(readFileSync(basePath))

  if (cur.width !== base.width || cur.height !== base.height) {
    console.log(`  ✗  ${f}  — size changed ${base.width}×${base.height} → ${cur.width}×${cur.height}`)
    failures++
    continue
  }

  const diff = new PNG({ width: cur.width, height: cur.height })
  const mismatched = pixelmatch(base.data, cur.data, diff.data, cur.width, cur.height, { threshold })
  const fraction = mismatched / (cur.width * cur.height)
  writeFileSync(join(DIFF, f), PNG.sync.write(diff))

  const pass = fraction <= maxDiff
  if (!pass) failures++
  const mark = pass ? '✓' : '✗'
  console.log(`  ${mark}  ${f}  — ${(fraction * 100).toFixed(3)}% changed (${mismatched}px)`)
}

console.log(`\n  ${pngs.length} compared · ${failures} failed · ${missing} without baseline\n`)
process.exit(failures > 0 ? 1 : 0)
