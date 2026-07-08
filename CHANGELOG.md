# Changelog

## Unreleased

- Prepared the project for private GitHub publication and future community collaboration.
- Added repository documentation, contribution guidance, security policy, and Apache-2.0 licensing.
- Cleaned project identity and public metadata for community distribution.

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
