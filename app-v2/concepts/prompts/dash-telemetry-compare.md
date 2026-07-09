# Dashboard reference — Broadcast dual-driver Telemetry Comparison

**Asset:** `cmpDash` (hi-fi group `compare/`) + `hifi_compare_telemetry` preset + 8 single-info widgets.
**Reference image:** `concepts/refs/ref-dash-telemetry-compare.png` (gpt-image-2, 1536×896, high).
**Requested by:** user — "quero mais um dash, igual esse [F1 telemetry comparison] com criação dos widgets/overlays em seguida."

## Flow followed
validate American-English prompt → gpt-image → image-QA (PASS: faithful, clean, no real logos,
no overlaps) → build → visual-QA-until-clean (2 fixes applied: standalone driver/ref blocks were
clipped at 150px → raised to 190px; full-dash rotated "DELTA" label collided with "FASTER" →
widened the trace left margin 70→96 and moved side-labels to x=20).

## What the reference depicts (American English)
A modern F1/WEC television telemetry-comparison graphic on a near-black background, three bands:
- **Top:** two mirrored driver panels flanking a central speed-zone track map. Each panel = a solid
  position block, driver SURNAME, a sub line, `LAP TIME m:ss.mmm`, and a large SIGNED gap. Below,
  three thin bars: `FULL THROTTLE / HEAVY BRAKING / CORNERING` with right-aligned percentages
  (player = red, reference = amber). Center = a single continuous track outline color-graded by
  speed zone (red=low, orange=medium, amber=high) with corner numbers 1..11 and a
  `LOW / MEDIUM / HIGH SPEED` caption.
- **Middle:** a full-width SPEED-vs-distance chart, two overlaid driver traces (red + amber) with a
  soft fill, corner tick markers, a `320 / 50 km/h` axis and a rotated `SPEED` label.
- **Bottom:** a full-width DELTA trace with `FASTER` / `SLOWER` axis, corner ticks, and a rotated
  `DELTA` label.

## Honesty model (build)
Every NUMERIC readout is REAL live telemetry → em-dash when absent (never fake data):
- Player: `driverName`, `position`, `currentLapTimeSec`→`lastLapTimeSec`, `deltaToBestSec`
  (green faster / red slower), `throttle`, `brake`, cornering proxy from `|latAccelG|`.
- Reference (right): the car ahead `relatives.ahead` (name/position/gapSec/lastLapTimeSec) when
  present, else the **session-best ghost** (`bestLapTimeSec`, `-deltaToBestSec`).
- Live cursor + car dot placed from `lapDistPct`; live speed dot height from `speedKmh`.
The lap SILHOUETTES (speed profile, delta profile) and the track outline are ILLUSTRATIVE context
(the same category as the app's static track-map fallback) drawn dim behind the live values.

## Widgets produced (category `compare`, tags: compare/broadcast/analysis/telemetry/ir)
`cmpDash` (1024×600 full dash) · `cmpDriverBlock` · `cmpRefBlock` · `cmpLapTime` · `cmpGap` ·
`cmpStyleBars` · `cmpZoneMap` · `cmpSpeedTrace` · `cmpDeltaTrace`. All also usable as overlays via
the hifi-overlays bridge; editable in color/size/font/position + conditional color per the app model.
