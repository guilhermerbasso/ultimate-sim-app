# Changelog

## Unreleased

- Prepared the project for private GitHub publication and future community collaboration.
- Added repository documentation, contribution guidance, security policy, and Apache-2.0 licensing.
- Cleaned project identity and public metadata for community distribution.

## 2.41.0 — Visual rebuild: widgets, overlays, dashboards, UX & i18n

### Added
- **Widget‑matrix factory** (`src/renderer/src/widgets2/`): a *variable × form* system rendering 57 telemetry variables in 9 visual forms (bar, vertical bar, gauge, 7‑segment, LED, **32‑bit pixel**, ring, tile, big number) — **513 NaN‑safe SVG widget combinations**, ≥ 5 forms per variable.
- **New `Pixel32` primitive** for the retro 8/16/32‑bit pixel‑matrix readout.
- **Overlay catalogue** (`src/renderer/src/overlays2/`): **57 overlays** across 11 categories, each renderable in all **8 design families** (≥ 5 styles per overlay).
- **Dashboard catalogue** (`src/shared/dashboards2/` + `src/shared/car-families.ts`): **200 new dashboards** = 8 generic car families × 5 layouts × 5 resolutions, each with ≥ 5 distinct telemetry bindings; registered into `BUILTIN_PRESETS`.
- **Collapsible sidebar** with icon‑only rail, `Ctrl/Cmd+B` shortcut, persisted state, and per‑item tooltips.
- **App icon** wired into `electron-builder` (`build/icon.png`) and AI‑generated GT3 hero art (Azure AI Foundry `gpt-image`) for menu/README context.
- **Japanese (`ja`)** and **Chinese (`zh`, Simplified)** locales.

### Changed
- **English is now the primary/default UI language** (`DEFAULT_APP_SETTINGS.language = 'en'`); Português/Deutsch/Français/Español remain switchable, plus the two new locales.
- Sidebar collapse/expand labels moved into the i18n `ShellKey` catalogue (all 7 locales).

### Fixed
- Absent telemetry channels no longer render false *critical* states for inverted variables (fuel/wear/grip).
- Overlays can no longer overflow their declared height (fixed grid‑row layout).
- Dashboard presets now build a fresh deep clone per call, preventing shared built‑in mutation.

### Notes
- **AI Engineer, Live/AI Coach and analysis run 100% locally on the CPU (`node-llama-cpp`), offline, with no GPU and no cost.**
- Validation: `typecheck` ✓ · **2,789 unit tests** ✓ · `build` ✓ · dashboard visual‑audit (0 render errors / overflow / overlap) ✓.
