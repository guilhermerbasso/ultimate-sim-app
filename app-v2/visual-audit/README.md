# visual-audit — overlay & dashboard screenshot harness

Phase B infrastructure (todo `vis-harness`). Renders the **real** overlay widgets
and dashboard presets with realistic mock telemetry and captures full-page PNGs
so a visual-design QA can review them, per style preset, without launching
Electron or a sim.

## Run

```bash
# from app-v2/
node visual-audit/shoot.mjs                          # default: 8 representative presets + dashboards
node visual-audit/shoot.mjs neon glass terminal      # custom overlay style-preset list

# deterministic dashboard structure report / candidate gate
node visual-audit/dashboard-differentiation-report.mjs --out dashboard-structure.json
node visual-audit/dashboard-differentiation-report.mjs --candidates id-one,id-two --perceptual evidence.json
```

Output lands in `visual-audit/shots/` (git-ignored):

- `overlays-<preset>.png` — a grid of **all 68 overlay widgets** rendered under the
  given style preset (e.g. `overlays-terminal.png`).
- `dashboards.png` — a representative spread of dashboard presets rendered with the
  real dashboard renderer.

The script boots a Vite dev server, drives headless Chromium (Playwright), waits
for a readiness sentinel, disables animations + honours `prefers-reduced-motion`
for deterministic frames, then screenshots full-page at a fixed 1600px width.

> First run may take longer if Chromium needs installing:
> `npx playwright install chromium` (the script attempts this automatically on a
> launch failure).

## RaceCon RC-01 dev capture

```bash
node visual-audit/racecon-rc01-capture.mjs --mode validate --out C:/Temp/racecon-rc01-capture
```

The output target is an absolute **non-existing** directory outside every Git worktree. The harness captures fuel mode at 800x480 and 1024x600, tyre-summary mode at 393x759 and 412x867, and the explicit compact-landscape mode at 759x393 and 867x412. State is bound into each filename and manifest descriptor. It records each staged file's byte length and SHA-256, revalidates every staged file, publishes the already-identified staging directory with Windows' atomic no-replace `Directory.Move`, and immediately revalidates every published file. On mismatch it atomically removes the owned identity from the requested path into an unpredictable quarantine; recursive deletion is intentionally deferred because Node has no handle-bound directory-tree delete primitive. It fails closed on platforms without the no-replace publication primitive. Final mode additionally requires a clean, unchanged Git HEAD before and after publication.

Responsive control/fuel geometry can be exercised independently with the existing Playwright runner:

```bash
npm exec playwright -- test visual-audit/tests/racecon-rc01-responsive.spec.ts --workers=1
```

## RaceCon RC-02 dev capture

```bash
node visual-audit/racecon-rc02-capture.mjs --mode validate --out C:/Temp/racecon-rc02-capture
```

The output target is an absolute **non-existing** directory outside every Git worktree. The harness captures the RC-02 `racecon_rc02_dash` preset at 800x480 (native), 1024x600 (app), 393x759 and 412x867 (compact phone), and 759x393 and 867x412 (compact landscape); the layout and compact modifiers are bound into each manifest descriptor and re-derived from the measured content box, so a modifier that disagrees with the box the widget measured fails closed. It also fails closed on a LED count other than nine, a sector-chip count other than three, a missing spine track or datum, a datum that is not at the exact vertical centre of its track, a `data-widget` other than `raceconRc02Dash`, and any buffer state other than `accepted`. Every generic safety primitive — argument parsing, private staging, exclusive writes with byte-length and SHA-256 receipts, the Windows atomic no-replace publication, quarantine cleanup and the Git-state gate — is imported and re-exported from `racecon-rc01-capture-lib.mjs` rather than forked, so the two harnesses cannot drift apart on the properties that protect the reviewer's disk. Final mode additionally requires a clean, unchanged Git HEAD before and after publication.

The capture entry drives a deterministic, connected, live-only telemetry fixture (no mock or replay marker) one scripted frame per committed render, so the widget-measured sector splits cannot change with React render coalescing.

Responsive geometry can be exercised independently with the existing Playwright runner:

```bash
npm exec playwright -- test visual-audit/tests/racecon-rc02-responsive.spec.ts --workers=1
```

The metric fixture and the PNG pixel audit are covered by `node --test`:

```bash
node --test visual-audit/racecon-rc02-capture.test.mjs
```

## RaceCon RC-03 … RC-08 dev capture

RC-01 and RC-02 were the only two RaceCon artifacts with a capture harness; RC-03 … RC-08 shipped
without one and therefore had no render QA against their approved reference images. Each now has
the same four files, driven through one shared harness:

```bash
npm run racecon:capture:rc05 -- --mode validate --out C:/Temp/racecon-rc05-capture
npm run racecon:capture:test
npm run racecon:responsive
```

`racecon-capture-shared.mjs` owns everything that is genuinely identical across the family: the six
governed viewports, the breakpoint contract (all eight widgets export the same
`RCnn_NATIVE_WIDTH_PX` … `RCnn_LANDSCAPE_MAX_HEIGHT_PX` constants and the same
`rcNNLayoutForContentBox` / `rcNNCompactModeForContentBox` pair), the in-page geometry helpers, the
shared metric contract, the pixel and hue primitives, and the whole capture lifecycle. It re-exports
RC-01's disk-safety primitives unchanged rather than forking them, exactly as RC-02 already did.
Each `racecon-rcNN-capture-lib.mjs` keeps only what that artifact's own zones, channels, alert
families and documented packet omissions make different.

Every harness captures the six governed viewports in at least two states — a silent frame and the
artifact's own alert scenario — and asserts, per frame:

- zone overlap, zone escape and out-of-frame, measured with `getBoundingClientRect` in a real
  browser. `white-space: nowrap` defeats `overflow: hidden`, so an element can escape its box while
  `scrollWidth === clientWidth` and a full green jsdom suite says nothing; only the measured
  rectangles disagree.
- the governed type-scale hierarchy at every breakpoint, as a strict order. **A tie is a failure**,
  not a pass — two readouts at the same size carry no hierarchy.
- alert colour confirmed by **hue family**, never by a channel ratio. A ratio test such as
  `g,b < 0.62r` is not a red test: it also accepts amber, and it once reported 8,578 "red" pixels on
  a frame whose hue-confirmed red count was zero. The silent frame must carry zero pixels of the
  alert hue family; the alert frame must carry them and every one of them must fall inside the
  element that owns the alert. Hue also survives the `filter: brightness()` some of these
  dashboards apply, because scaling every channel by the same factor leaves the hue angle unchanged.
- the **documented packet omissions** as the contract. Where a packet demanded something no
  telemetry channel can feed, the widget publishes an honest empty state (`--`, `UNAVAILABLE`, zero
  rows, or no element at all). The harness asserts that empty state and asserts the element stays
  absent; it never reports a documented omission as a missing-element failure.

Measured render defects in the shipped widgets are **recorded, not suppressed**: each artifact's
`knownDefects`, `zoneOverflowDefects` and `containmentDefects` ledgers carry the measured budget and
a note, the capture prints every one it observes, and a defect that grows, spreads to another
breakpoint or appears on another element still fails closed.

## What gets rendered

- **Overlays** — every id in `WIDGET_COMPONENTS`
  (`src/renderer/src/overlay/widgets/index.ts`) is mounted inside the exact same
  shell DOM + CSS variables that `OverlayRoot` applies (`.overlay-shell` with
  `--overlay-bg/-accent/-border/-radius/-font/-content-opacity`), importing the
  real `overlay-runtime.css` + `overlayWidgetsR16.css`. Pass any of the 34
  `OVERLAY_STYLE_PRESETS` ids as a CLI arg to re-shoot under that preset.
- **Dashboards** — a curated, representative subset of `BUILTIN_PRESETS` is built
  and rendered with the real `renderDashboardElement` from `DashboardRoot`
  (same primitives, GT3/extra widgets and binding resolution as production),
  scaled to fit. Override the set with `?presets=id1,id2` on the dashboard
  gallery URL.

## Files

| file | purpose |
| --- | --- |
| `mock-telemetry.ts` | Realistic mid-race `TelemetrySnapshot` factory (`createMockSnapshot`) + flag variants (incl. `flagsYellowGreen`). Imports the real type from `src/shared/telemetry`. |
| `overlay-gallery.html` / `.tsx` | Vite entry: grid of every overlay widget for `?preset=<id>`, in the real overlay shell. |
| `dashboard-gallery.html` / `.tsx` | Vite entry: representative dashboard presets via the real renderer. |
| `harness-stubs.ts` | No-op (channel-aware) `window.ipc` / `window.api` so widgets mount standalone. Imported **first** by each entry. |
| `ErrorBoundary.tsx` | Isolates a widget that throws so the rest of the grid still renders; records failures on `window.__vaFailures`. |
| `gallery.css` | Gallery chrome only (page bg, grid, labels) — never touches widget styling. |
| `vite.config.ts` | React plugin + `@renderer`/`@shared` aliases + `fs.allow` for the app source. |
| `shoot.mjs` | Playwright capture driver. |
| `dashboard-differentiation-report.mjs` | Baseline structural report and strict candidate gate. |
| `tsconfig.json` | Optional standalone typecheck of the harness (`npx tsc --noEmit -p visual-audit/tsconfig.json`). |

Thresholds, eight-state perceptual evidence, and baseline/candidate behavior are
documented in [`../docs/dashboard-differentiation-gate.md`](../docs/dashboard-differentiation-gate.md).

## Notes

- These files live **outside** `src/`, so they are excluded from the app's
  `npm run typecheck` and cannot weaken it. The harness is independently
  type-clean via its own `tsconfig.json`.
- A widget that fails to render is replaced by a compact error card (its id is
  logged + collected) rather than blanking the whole gallery — the `shoot.mjs`
  summary lists any failures per preset.
