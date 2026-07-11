# Copilot instructions — Ultimate Sim App (app-v2)

Canonical standards for AI-assisted work on this repo. Keep this file as the single source of
truth; do not duplicate these rules into other docs. Related docs: `docs/RELEASING.md`,
`docs/coach-intent-research.md`, `app-v2/docs/telemetry-inventory.md`,
`app-v2/visual-audit/DESIGN-FAMILIES.md`.

## Project
Windows sim-racing companion (iRacing-focused): telemetry widgets, GT3-style dashboards,
transparent overlays, streaming, DIY hardware, and **local-first AI** (Coach/Engineer). Stack:
Electron + React + TypeScript (`electron-vite`), Electron hardened (`contextIsolation: true`,
`nodeIntegration: false`). App lives in `app-v2/`.

## Model policy (mandatory)
- **All code work uses GPT‑5.6 Sol at `reasoning_effort: max`** — architecture, implementation,
  refactor, debugging, review, tests, typecheck, build, technical QA. No silent downgrade; if
  GPT‑5.6 Sol Max is unavailable, record the blocker before touching code.
- Non-code tasks (image generation, visual research) may use a more suitable model.

## Telemetry (source of truth)
- The **local iRacing SDK** is primary: `irsdk_defines.h` (enums/flags) etc. Never invent
  variables, units, or opponent data the SDK does not expose. Web research only complements.
- Opponents expose gaps/relatives/radar/`CarLeftRight` only — **no opponent throttle/brake/steering**.
- Normalized snapshot: `src/shared/telemetry.ts`; SDK map: `src/shared/iracing-vars.ts`;
  provider: `src/main/iracing/provider.ts`. Renderers must be **NaN-safe** (absent telemetry →
  empty/placeholder, never fake values).

## Widgets — visual standards
- For each semantically usable telemetry, provide **exactly 3 variants**: `competition` (racing
  gauge), `futuristic` (plausible motorsport instrument, not generic sci-fi), `ddu` (inspired by
  Bosch Motorsport DDU — **inspired only**, no proprietary layout/brand/logo copy).
- **Truly transparent** background. **No boxes/borders/lines** unless strictly needed for reading.
- **Self-explanatory, no redundant title** (e.g. `P4`, not "Position" + "4"). Use motorsport
  shapes/icons/color codes for context.
- **Editable** per the existing infra: color, size, font, position, and conditional colors where
  applicable.
- Widgets are pure SVG/SSR-safe and, where possible, **generated from a single parametrized
  NaN-safe renderer** (see `themedChannels`). New variants register through
  `src/renderer/src/hifi/widgets/registry.ts` and appear in `widget-catalog-data.ts`.
- Previews must render the **real component** (via `resolveWidgetComponent(widgetId)`) on every
  surface: preset gallery, dashboard editor, Create Overlay list, and `visual-audit` — never a
  placeholder glyph.

### Rev / RPM lights (shared rule)
- Transparent background; **no title and no RPM value** (self-explanatory).
- **Width and height independent** (no forced aspect ratio). Growing X widens/spaces the LEDs to
  fill the full width; shrinking Y changes height only, preserving configured width.
- **Shift point:** all LEDs turn strong blue and **strobe uniformly**, via ONE shared logic reused
  by every rev-light widget and overlay. Validate in editor, overlay, and preview.

## Dashboards
- Authored on a fixed canvas (1024×600 default), absolute-positioned elements; runtime scales via
  `DashboardRoot` `scaleMode`. Non-1024×600 targets **stretch/shrink** (`scaleMode: 'stretch'`) to
  fill the display/kiosk/stream — do not delete off-size dashboards.
- **Dense by default:** minimal empty space, minimal borders/dividers, clear reading hierarchy for
  in-race legibility. Fill dead space with useful info (incident count, time left, map, fuel,
  TC/ABS, vitals, delta) rather than leaving gaps.
- New dashboards get a stable **priority/order** field so they can sort to the top of the gallery
  (not a fragile UI hack).
- **Author each dashboard individually** — a distinct, hand-designed composition (own purpose,
  widget set, layout, hierarchy from the differentiation matrix). Shared low-level placement helpers
  are fine, but **no high-level factory that mass-produces near-identical dashboards**.
- Every dashboard: renders a real preview everywhere, opens without error, receives real telemetry,
  and has complete tags with working filters.

## Tagging
Controlled, normalized vocabulary (reuse `src/shared/tags.ts` + `src/shared/widget-taxonomy.ts`;
extend only when needed) — no duplicates/spam. Apply when relevant: source (iRacing), type
(widget/dashboard), telemetry + category, unit, style, purpose, session, track condition,
orientation/layout, alert level, discipline/car class, focus (tyres/fuel/pace/delta/strategy/
traffic). Add tests for combined-filter correctness.

## AI reference-image pipeline
- Use **Azure AI Foundry `gpt-image-*`** (Motorsport Studio) for reference images. Prompts in
  **American English**, precise about data/style/hierarchy/states/proportion/transparency/legibility.
- **Independent double QA:** (1) validate the prompt (APPROVED/REJECTED + corrected version), (2)
  validate the generated image vs the prompt (semantics/style/legibility/transparency/no deformed
  text). Re-generate on render defects; revise the prompt on conceptual errors; after 3 failures do
  root-cause and change strategy. Never approve a wrong image silently.
- Images are **reference only** — the final widget/dashboard is built with real components and live
  telemetry; the image is **not** a static background. **SVG is a temporary wireframe only, never a
  final reference/deliverable.** If image quota/API is blocked, continue independent fronts, mark
  artifacts blocked, and never substitute a low-fidelity SVG for a final image.
- **Generate every artifact individually** — each widget variant and each dashboard gets its OWN
  reference image + QA. **Never batch, clone, or ship anchor-only** coverage as if complete, even if
  the per-artifact pipeline is far slower. Honor coverage counts honestly.

## AI Coach / Engineer
- Deterministic, local-first, explainable — **no cloud LLM, no black-box ML**; the local LLM only
  *verbalizes* decisions the shared core made. Shared analysis lives in `src/shared/coach.ts` +
  `driver-intent-*.ts` + `coach-intent-gate.ts`; both Live Coach and Engineer consume it.
- Racecraft advice ("pass the car ahead", "pull away from the car behind", quali-start summary)
  must use real evidence, be honest about missing opponent controls (fall back to own history/best
  lap/timing/gap/trends), differentiate overtake vs defend vs general improvement, and stay short
  and prioritized in critical sections. If comparable history is insufficient, say so — don't
  present a generic conclusion as personalized.

## Validation (run before declaring done)
```bash
cd app-v2
npm run typecheck        # tsc -p tsconfig.node.json && tsc -p tsconfig.json
npx vitest run
node visual-audit/shoot-dashboards.mjs   # renders every dashboard; fails on render errors
node visual-audit/lint-overflow.mjs      # flags overflow/clipping
```
Run the smallest targeted tests first, then the full suite. Fix every regression you introduce.

## Delivery
Work on a feature branch. **Never commit or merge to `main` directly.** Open a PR, run the GitHub
Copilot code-review flow, and leave the PR unmerged for the maintainer. No destructive Git; preserve
existing user changes.
