# Changelog

## Unreleased

- Prepared the project for private GitHub publication and future community collaboration.
- Added repository documentation, contribution guidance, security policy, and Apache-2.0 licensing.
- Cleaned project identity and public metadata for community distribution.

## 2.54.0 — managed streaming, local integrations, and offline race preparation

### Added
- **Loopback-only MQTT certification target**, disabled by default, with authenticated publisher,
  reader, and command roles, narrow topic permissions, retained health/session state, and commands
  disabled unless explicitly enabled.
- **User-managed Streaming targets** in a dedicated Streaming area, with persistent dashboard and
  Touch Controls profiles. Edited dashboard copies remain selectable after migration and restart.
- **Mobile presentation editor** for saved dashboards and Touch Controls, with phone/tablet presets,
  orientation, safe areas, fit/fill rules, minimum touch sizing, and revision-bound profiles that do
  not modify the source layout.
- **Editor-only trigger previews** that reveal inactive trigger-only overlays and dashboard widgets
  for positioning without changing their live visibility rules.
- **Experimental local Context-Debt meter** for auditing competing cues, invalid routes, and
  unavailable devices before a race. It remains an N=0 experiment, not a validated demand or
  predictive-accuracy claim.
- **Local Setup Experiment Twin** for controlled one-variable A-B-A/B-A-B setup comparisons, with
  manual setup confirmation, matched-block evidence, uncertainty reporting, persistence recovery,
  and honest abstention instead of automatic setup application or causal claims.
- **Offline Mission Rehearsal** with branching scenarios, assigned roles, checkpoints, resumable
  runs, repeat comparisons, and scored blameless debriefs.

### Changed
- Internet streaming can start the bundled, checksum-verified Cloudflare quick tunnel automatically,
  establish the authenticated viewer session, report receiver health, and recover with bounded
  retries without changing local or LAN streaming.
- Trigger preview ownership is released on hide, reload, or renderer loss and restored after a tray
  reopen, while compositor, streaming, saved rules, and live Coach/Engineer/Alerts IPC stay isolated.
- Context-Debt audits fail closed on malformed profiles and incomplete audio/serial inventories, and
  suggestions respect per-cue route and modality limits.
- PWA receiver reconnects preserve the first pending 250 ms deadline, deduplicate overlapping
  close/online triggers and metrics, and cancel pending reconnects while offline or unmounted.
- Mission Rehearsal synthetic events are isolated from live telemetry and real session history, and
  rehearsal decisions cannot actuate live race controls.

## 2.53.1 — SerialPort startup hotfix

### Fixed
- Restored packaged-app startup on Windows by routing `serialport` through an ASAR-aware CommonJS
  `createRequire` bridge instead of Electron's failing ESM package resolution.
- Added Windows package verification that inspects the packaged main bundle and runs a packaged
  Electron resolver smoke test before release assets can be accepted.

## 2.53.0 — restart-safe dashboards, telemetry truth, and governed visual foundations

### Added
- **Dashboard storage health and recovery diagnostics** with canonical validation, legacy identity
  migration, byte-preserving quarantine for invalid files, duplicate/version resolution, and
  renderer error containment.
- **Phase 02 dashboard portfolio foundation** with exactly 50 immutable briefs across 10 families,
  deterministic processing order, controlled tags, research sources, telemetry requirements, and
  per-dashboard image-prompt constraints.
- **Dashboard differentiation gate** with canonical structural fingerprints, a hard clone-rejection
  threshold, anti-evasion checks, and pair-scoped perceptual evidence across eight governed
  telemetry states.
- **Governed telemetry registry** for 143 ordinary concepts: 142 currently visualizable, 141 using
  the existing three-variant framework, one dedicated shift-light implementation, one explicitly
  unsupported opponent-steering concept, and 45 separate trigger-only families.

### Changed
- Fuel range and fuel-to-finish calculations are litre-canonical. Startup, partial, and refuelling
  laps are excluded from consumption samples.
- Engine map and throttle map remain distinct, iRacing garage cold pressure is not exposed as live
  tyre pressure, and Shift Point uses native shift state or RPM/max-RPM while honoring disabled
  policies and simulator coverage.
- Alert configuration updates are serialized, and configured trigger behavior is shared
  consistently by alerts, overlays, dashboards, and widgets.
- Persisted dashboard restoration separates newest-wins configuration hydration from
  emission-ordered telemetry reconnect handling and uses monotonic revisions that tolerate
  future-dated files or clock rollback.

### Fixed
- Saved dashboard windows, including `overlaywidget` compositions, no longer reopen as black
  windows after an app restart.
- Dashboard replacement and queued open/close/delete/save operations are atomic and race-safe
  across load failures and renderer crashes.

### In development
- The separate Phase 02 production program targets **50 newly produced dashboards and 16,600
  individually evidenced visual artifacts**. Version 2.53.0 ships the portfolio, registry, and
  quality gates, not those generated images or dashboard outputs.

## 2.52.0 — semantic controls, expression destinations, secure streaming, and synchronized speech

### Added
- **Touch Controls schema v2** with momentary, latching toggle, two-position rocker, guarded
  two-step, rotary, selector, status-LED, and value-tile controls. Controls support
  expression-driven active/pressed/disabled/warning/value states and accessible interaction.
- **Expression Studio visualization destinations** for placing expressions or mapped iRacing
  variables on a selected dashboard or custom overlay as a value, bar, gauge, or status.
- **Trigger-only overlay lifecycle** with rising/falling edges, pulses, TTL windows, preview
  isolation, DRS state normalization, and replay/session/connection reset boundaries.
- **Streaming resource graph verification** for packaged HTML, JavaScript, CSS, dynamic imports,
  preloads, and nested assets.

### Changed
- Streaming viewer sessions are HttpOnly, authentication attempts are throttled, token bootstrap
  cannot evict authenticated viewers, public Internet mode requires active HTTPS, and browser
  Touch Controls fail closed.
- Expression imports are transaction-safe and revision-checked; legacy route state, deletion
  tombstones, unsaved drafts, and newest duplicate output values are preserved.
- Touch holds and latches are owned per pointer and renderer generation, with cleanup on unmount,
  close, reload, navigation, renderer loss, live semantic edits, disabled-state transitions, and
  app teardown.
- Newly released overlays, widgets, and dashboards sort ahead of older catalog entries.

### Fixed
- Spotter, Live Coach, deterministic/proactive Engineer, voice previews, and Stint Debrief now
  compose spoken text and language atomically. Language changes cancel current speech, queues,
  recognition, and stale Engineer generations.
- Steady green is treated as normal running and no longer activates race-control alert overlays.
- Nineteen release-blocking widget layouts no longer clip, overlap, or overflow in the validated
  telemetry states.

## 2.47.0 — per-car themed telemetry widgets, car-fidelity images, more i18n

### Added
- **`themedDerived` widgets (72)** — the 12 combined-channel derived widgets (slip angle,
  steering lock, rotation rates, attitude, fuel laps-left, sun position, GPS heading,
  race-control flags, shift point, engine telltale, spotter, session id) rendered in each
  of the 6 car families' signature palettes (Ferrari, Porsche, Mercedes-AMG, McLaren,
  Corvette, Lamborghini). Brings the 16 newly-surfaced telemetries into the themed set.
- **`themedChannels` widgets (102)** — 17 core scalar channels (speed, rpm, gear, throttle,
  brake, clutch, steering, water/oil temp, fuel, delta, position, lap, track/air temp) × 6 cars.
  Both sets are generated from single-source, palette-parametrized, NaN-safe renderers.
- **6 per-car themed dashboards** — one 1024×600 dashboard per car composing its themed
  rev-lights signature with its themed channel + derived widgets (`dashboards-hifi-themed-cars2.ts`).
- **Photorealistic per-car reference images** — six GT3 reference images generated via
  Azure AI Foundry gpt-image with prompt-QA (Ferrari 296 GT3, Porsche 911 GT3 R,
  Mercedes-AMG GT3, McLaren 720S GT3, Corvette Z06 GT3.R, Lamborghini Huracán GT3),
  branding-safe, each visually QA'd. Stored under `concepts/refs/`.
- **Localization** — continued the view-by-view `tt()` rollout across all 7 languages.
  Views migrated: OLED, RaceProfiles, TouchControls, Spotter3D, Haptics, HapticsZonal,
  Biometrics, Revlights, Sounds, VoiceSettings, Setups, Pinout, Devices, Community,
  Strategy, FuelStrategy, TireStrategy, Expressions.

## 2.46.0 — auto-update fix, complete telemetry coverage, diagnostics dashboards

### Fixed
- **Auto-update 404** — the installer `artifactName` no longer derives from the
  space-containing product name. It is pinned to
  `Ultimate-Sim-App-${version}-${arch}.${ext}`, so `latest.yml`, the uploaded GitHub
  asset name and the `electron-updater` download URL all agree. Previously GitHub
  rewrote the spaces to dots on upload (`Ultimate.Sim.App-…`) and the updater 404'd.

### Added
- **`irDerived` widgets (12)** — clean, NaN-safe widgets that combine already-surfaced
  iRacing channels into derived information (slip angle, steering-lock %, 3-axis
  rotation rates, attitude horizon, fuel laps-left, sun position, GPS+heading, decoded
  race-control flags, shift point, engine telltale, raw spotter, session id). Every
  widget-able snapshot field now has a widget (**telemetry gap = 0**; 119 → 131 widgets).
- **5 diagnostics/dynamics dashboards** — 1024×600 compositions of the derived widgets
  (Chassis Dynamics, Engineer Diagnostics, Endurance Strategy, Environment & Race
  Control, Navigation & Spotter), registered in `BUILTIN_PRESETS`.
- **Localization** — 5 more views migrated to the `tt()` system across all 7 languages
  (About, Profiles, Input Monitor, ESP32 Wi-Fi, Semantic Search; 146 new keys).

## 2.44.0 — v5: real-dash car themes, more iRacing widgets, Windows .exe pipeline fixed

### Added
- **Real-dashboard car themes** — reference-matched dashboards, full-dash overlays and single-info widgets for a fleet of endurance/GT3/Cup cars (Le Mans/WEC prototype, Ferrari 488 Challenge & 296 GT3, Aston Martin Vantage & Vantage GT3, Mercedes-AMG One & GT Track Series, Porsche 911 GT3 Cup, Mustang GTD, Corvette Z06 GT3.R, Lamborghini Huracán GT3, McLaren 720S).
- **More iRacing widgets & overlays** — additional telemetry channels and visual styles, each built from a validated gpt-image reference and visually QA'd until clean.
- **Consolidated, English README** — full feature catalog with in-app screenshots.

### Changed
- **CI on Node 24** — `actions/checkout@v5`, `actions/setup-node@v5`, `node-version: 24` across `ci.yml`, `build-windows-installer.yml` and `codeql.yml` (PR #15).
- **Automated Copilot QA on pull requests** — review → auto-fix loop → auto-merge (PR #12).

### Fixed
- **Windows installer release build** — `dist:win` now runs `electron-builder --win --publish never`, so tag builds no longer fail on electron-builder's implicit GitHub publishing (missing `GH_TOKEN`). The `.exe`/`.zip`/`latest.yml` are attached to the GitHub Release by the workflow, so every `v*` tag ships a working installer again.

## 2.43.0 — Clean v4: title‑less widgets, trigger overlays, 3D nav map, themed cars

### Added
- **Trigger‑only spotter overlays** (`src/renderer/src/hifi/widgets/alerts/`) — 7 condition‑gated overlays (car‑left, car‑right, radar‑on‑proximity, shift‑LED flash, pit‑limiter, flag, low‑fuel) driven by a pure, tested `evaluateOverlayTrigger(trigger, snapshot)`; the compositor paints them only while their condition fires.
- **Hide + "Hidden" feature** — multi‑select hide/restore for overlays, dashboards, touch dashes and the widget catalog, persisted; hidden overlays are skipped by the compositor.
- **Interactive 3D nav map** (`TrackMapNav3DWidget`, Three.js / @react‑three/fiber) — Waze‑style follow‑cam, track‑up rotation, zoom, drag‑rotate/pan and recenter, with a 2D SVG fallback for SSR / no‑WebGL.
- **12 per‑car themed widgets** (`src/renderer/src/hifi/widgets/themed/`) — 6 shift‑light signatures + 6 cluster signatures for Ferrari / Porsche / Mercedes‑AMG / McLaren / Corvette / Lamborghini.
- **Generic rev‑lights variants** — gradient bar, dense LED strip, LED bar with blue over‑rev, and a centered Mustang‑style cluster.
- **New touch button styles** — rocker + LED‑ring — plus per‑car themed touch button‑boxes; presets are now tag‑filterable.

### Changed
- **Clean visual language everywhere** — widgets/overlays render transparent, title‑less and borderless (values are self‑explanatory), with a dark text‑outline for legibility and centralized conditional (gain/lose) coloring; still fully editable in color/size/font/position.
- **All 58 hi‑fi dashboards recreated** — race / endurance / coach / family rebuilt to the clean premise with a rev‑lights strip corner‑to‑corner across the top, authored at 1024×600 and adaptive; each category gains per‑car themed dashboards. 268/268 presets render with **0 build/render errors**.
- **Deep i18n to American English** — every screen, description, widget/overlay/dashboard and the AI engineer / coach / spotter voice translated; switching language changes everything.

### Fixed
- Settings now **persist immediately** (default telemetry/sim and all settings stick across restarts).
- The **AI Coach map grows/shrinks with the zoom level** instead of always taking the whole screen.
- Broadcast hero no longer has an empty middle; endurance delta no longer overflows; gap ahead/behind uses green = gaining / red = losing (no title/arrow); tyre‑temp °C no longer overlaps the value; gear is no longer clipped.

## 2.42.0 — Per‑telemetry hi‑fi widgets, +50 composition dashboards, tag filtering, adaptive AI

### Added
- **71 per‑telemetry hi‑fi widgets** (`src/renderer/src/hifi/widgets/`) — one clean, NaN‑safe SVG module per channel (throttle/brake/clutch/steering/inputs, speed/rpm/gear/rev‑lights, delta/lap/position/time, gap ahead/behind/relative/standings/radar, fuel/fuel‑laps/fuel‑delta, tyre temp/pressure/wear/detail + per corner, brake temps/bias, oil/water/oil‑press, TC/ABS/engine‑map/ERS, flag/pit‑limiter/incidents/weather/wetness/grip/track‑map/G‑force/session/clock, and **AI coach/engineer** cues). Each is usable **both** as a floating overlay **and** a dashboard widget, built from a `gpt‑image` reference and visual‑QA’d until clean.
- **+50 hi‑fi 1024×600 composition dashboards** (`src/shared/dashboards-hifi-*.ts`) across four themes — **race** (sprint/quali/wet/fuel‑save/start/safety‑car…), **endurance** (stint/fuel‑strategy/tyre‑life/traffic/multiclass…), **AI coach/engineer**, and **style/broadcast/minimal/radar** — composed from the hi‑fi widgets and spread into `BUILTIN_PRESETS`.
- **AI‑powered widgets & dashboards** — live Coach tip/findings, Engineer radio, proactive alert, strategy call and AI‑confidence tiles, plus dedicated AI‑coach dashboards. The AI is **100% local, CPU‑only, free**.
- **Adaptive Dashboard — local AI live selection** (`src/renderer/src/lib/adaptive-widget-ai.ts`): with the toggle on, a local heuristic AI picks the most relevant widgets for the current race moment (fuel/tyre/gap/delta/pit/weather salience + moment weighting + coach/engineer signals), with category diversity.
- **Rich tags + multi‑select tag filter** (`src/renderer/src/components/TagFilter.tsx`) on the **Overlays**, **Dashboards** and **Touch Controls** screens — chips + search + live count + clear; every overlay/dashboard is tagged (sim IR/ACC/AC/AMS2/LMU, category, and style tags) and filterable by several tags at once.
- **Hi‑fi Touch Controls** — 6 new photoreal pit/cockpit/strategy/comms/wheel/endurance panels plus new `selector`/`rgb` button materials.

### Changed
- **Hi‑fi widgets never clip or overflow** — `HifiWidgetHost` renders each widget in its intrinsic design size and letterboxes (`preserveAspectRatio="xMidYMid meet"`) into any dashboard/overlay box, so text never spills or is cut at any size or aspect ratio.

### Fixed
- `npm run typecheck` restored to green after the widget‑catalog → hi‑fi‑registry integration (node tsconfig now parses the JSX pulled in via `main → widget‑catalog`).
- Adaptive selection guards a non‑finite `maxSlots`; tag filtering trims tags consistently; `strategyCall` tiles surface a real strategy‑related engineer message (never fabricated).

### Notes
- **AI Engineer, Live/AI Coach and analysis run 100% locally on the CPU, offline, with no GPU and no cost.**
- Validation: `npm run typecheck` (node + web) ✓ · **2,854 unit tests** ✓ · dashboard/widget visual‑audit (**0 render errors / overflow / overlap**) ✓.

## 2.41.0 — Race‑car fidelity rebuild: hi‑fi dashboards, streaming, auto‑update, i18n

### Added
- **Hi‑fi 1024×600 dashboards** (`src/renderer/src/hifi/`): photorealistic **GT3 DDU cockpit**, **MoTeC‑style engineer analysis**, **endurance/IMSA stint**, **broadcast**, and **minimal** clusters — each built from a `gpt‑image` reference and matched pixel‑by‑pixel, driven by **live telemetry**, pure NaN‑safe SVG, **adaptive** (viewBox 1024×600 → any screen). Wired into `BUILTIN_PRESETS` via the `overlaywidget` embed path.
- **Stream to phone/tablet**: a LAN server with **QR code + session token + optional password**, a responsive web dashboard, and Touch Controls streaming (extends `src/main/modules/streaming.ts`).
- **Auto‑update**: `electron-updater` from GitHub Releases (automatic) plus a manual **Check for updates** button in About; `publish` config in `electron-builder.yml`.
- **Chinese (`zh`, Simplified)** and **Japanese (`ja`)** locales; a scalable `tt()` i18n catalog.
- **Collapsible sidebar** (icon‑only rail, `Ctrl/Cmd+B`, persisted); **new app icon** wired into `electron-builder`.

### Changed
- **English is now the primary/default UI language**; deep i18n migrated many screens (telemetry, fuel, tyres, strategy, settings, alerts, devices, community, controls, coach, engineer, …) and the AI Engineer prompt + TTS voice follow the app language.
- **Overlays**: activating an overlay no longer scrolls the page; presentation options consolidated to **5 structurally‑distinct forms** (minimal, broadcast, analog, heatmap, neon) instead of colour‑only presets.

### Fixed
- **Settings** now apply and persist immediately (default telemetry source, etc.).
- **AI Coach** map area grows/shrinks with the zoom level (no longer always full‑screen).
- **Community** ships curated, editable HTTPS telemetry/setup sources per simulator.

### Removed
- The earlier generic *variable×form* build (`widgets2/`, `overlays2/`, `dashboards2/`, `car-families.ts`) — replaced by the hi‑fi, image‑driven dashboards.

### Notes
- **AI Engineer, Live/AI Coach and analysis run 100% locally on the CPU (`node-llama-cpp`), offline, with no GPU and no cost.**
- Validation: `typecheck` ✓ · **2,798 unit tests** ✓ · dashboard visual‑audit (**0 render errors / overflow / overlap**) ✓.
