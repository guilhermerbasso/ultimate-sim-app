# Visual regression — dashboard / overlay captures

Perceptual diff harness for keeping the GT3 dashboards/overlays pixel-faithful.
Driven by `scripts/visual-regression.mjs` (pixelmatch + pngjs).

## Layout
- `baseline/` — the approved reference PNGs (committed).
- `current/` — freshly captured PNGs to compare (regenerated each run; git-ignored).
- `diff/` — generated diff images highlighting changed pixels (git-ignored).

## How to use
1. Capture screenshots into `current/` — one PNG per widget/state. Recommended source:
   render a preview route fed by the deterministic frames in
   `src/shared/telemetry-scenarios.ts` and screenshot it with Playwright
   (already a devDependency), naming files like `gt3-cluster__shift-light-sweep.png`.
2. Compare:
   ```bash
   node scripts/visual-regression.mjs            # or: npm run visual:diff
   ```
3. Accept intentional changes as the new baseline:
   ```bash
   node scripts/visual-regression.mjs --update   # or: npm run visual:update
   ```

You can also drop a cropped photo of a real MoTeC/Cosworth cluster into `baseline/`
and a matching render into `current/` to measure how close the render is to the
real thing.

## Thresholds
- `--threshold <0..1>` per-pixel colour sensitivity (default `0.1`).
- `--max-diff <0..1>` max fraction of differing pixels before a file fails (default `0.005`).
