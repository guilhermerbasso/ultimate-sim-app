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
| `tsconfig.json` | Optional standalone typecheck of the harness (`npx tsc --noEmit -p visual-audit/tsconfig.json`). |

## Notes

- These files live **outside** `src/`, so they are excluded from the app's
  `npm run typecheck` and cannot weaken it. The harness is independently
  type-clean via its own `tsconfig.json`.
- A widget that fails to render is replaced by a compact error card (its id is
  logged + collected) rather than blanking the whole gallery — the `shoot.mjs`
  summary lists any failures per preset.
