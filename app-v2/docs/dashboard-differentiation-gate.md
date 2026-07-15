# Dashboard differentiation gate

Release B uses deterministic structural fingerprints before screenshot metrics are
considered. Fingerprints normalize geometry to the canvas, sort elements, and ignore
dashboard/element IDs, names, timestamps, and source array order.

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
   placement is `>= 0.50` together.

Individual threshold crossings are emitted as warnings. Existing-baseline findings
are reported separately and never fail candidate work unless a supplied candidate is
one side of the rejected pair.

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
  --out dashboard-structure.json
```

Without `--out`, JSON is written to stdout. Exit code `1` means a candidate pair was
rejected; exit code `2` means invalid arguments, a missing candidate, or a malformed
preset. Baseline duplicate findings alone keep exit code `0`.
