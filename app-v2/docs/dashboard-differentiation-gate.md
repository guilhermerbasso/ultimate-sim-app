# Dashboard differentiation gate

Release B uses deterministic structural fingerprints before screenshot metrics are
considered. Fingerprints normalize geometry to the canvas and ignore dashboard/element
IDs, names, timestamps, and source reorderings that do not change effective paint order.

## Structural gate

The weighted score is:

- semantic widget-set Jaccard: 30%
- symmetric rectangle IoU: 25%
- same-widget placement: 30%
- topology signature similarity: 15%

A candidate pair fails when any condition is true:

1. canonical fingerprints are exactly equal;
2. weighted similarity is `>= 0.75`;
3. Jaccard is `>= 0.80`, geometry IoU is `>= 0.85`, and same-widget
   placement is `>= 0.50` together;
4. area-weighted, one-to-one same-widget containment is `>= 0.75`.

Individual threshold crossings are emitted as warnings. Existing-baseline findings
are reported separately and never fail candidate work unless a supplied candidate is
one side of the rejected pair.

Canonical fingerprints retain effective paint order for overlapping elements: lower
`zIndex` paints first, and equal-z overlaps retain stable source order. Case-sensitive
widget and binding identifiers, including surrounding whitespace, are preserved;
only human-facing literal labels are case-normalized. Type-specific semantic fields
are included only when that renderer consumes them. Provably inert elements, such as
transparent unbordered rectangles, are excluded from visual geometry and fingerprints.

## Perceptual evidence

The screenshot layer supplies real metrics; the shared module does not synthesize
SSIM or pHash values. Evidence must contain exactly these eight states:
`idle`, `drive`, `redline`, `brake`, `yellow`, `blue`, `pit`, and `extreme`.

A state is perceptually similar only when all are true: SSIM `>= 0.92`, pHash
distance `<= 8`, pixel mismatch `<= 10%`, and palette similarity `>= 0.97`.
Four or more similar states reject the pair. Missing, duplicate, unknown, or invalid
state evidence cannot pass.

## Report modes

From `app-v2/`:

```powershell
# Baseline report: legacy findings are informational.
node visual-audit\dashboard-differentiation-report.mjs --out dashboard-structure.json

# Candidate gate: compare candidates with baseline and with each other.
node visual-audit\dashboard-differentiation-report.mjs `
  --candidates release_b_one,release_b_two `
  --perceptual release-b-perceptual.json `
  --out dashboard-structure.json
```

Without `--out`, JSON is written to stdout. Exit code `1` means a candidate pair was
rejected; exit code `2` means invalid arguments, a missing candidate, or a malformed
preset. Baseline duplicate findings alone keep exit code `0`.

Candidate mode requires pair-scoped perceptual evidence for every candidate comparison.
Missing, incomplete, invalid, or perceptually rejected pairs keep the combined gate
from passing. Baseline mode remains structural-only and informational. The abbreviated
schema example below shows one state; real entries require all eight.

```json
{
  "schemaVersion": 1,
  "pairs": [{
    "leftId": "release_b_one",
    "rightId": "existing_dashboard",
    "states": [{
      "state": "idle",
      "ssim": 0.81,
      "pHashDistance": 18,
      "pixelMismatchRatio": 0.22,
      "paletteSimilarity": 0.84
    }]
  }]
}
```

Each pair must contain all eight required states listed above. Pair order is
insignificant, but duplicate or unexpected pair entries are rejected as malformed.
