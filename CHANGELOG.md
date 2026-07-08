# Changelog

## Unreleased

- Prepared the project for private GitHub publication and future community collaboration.
- Added repository documentation, contribution guidance, security policy, and Apache-2.0 licensing.
- Cleaned project identity and public metadata for community distribution.

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
