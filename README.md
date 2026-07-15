<div align="center">

<img src="app-v2/concepts/rebuild/app-icon.png" alt="Ultimate Sim App icon" width="128" height="128" />

# Ultimate Sim App

**Ultimate Sim App** is a Windows sim-racing companion for iRacing-focused telemetry, GT3-style dashboards, transparent overlays, strategy tools, DIY hardware, and local AI coaching.

Independent community project maintained by Guilherme Basso · Electron + React + TypeScript · Apache-2.0

Latest published release: **Ultimate Sim App 2.50.0** · [Windows x64 downloads](https://github.com/guilhermerbasso/ultimate-sim-app/releases/latest)

Development builds use the version in [`app-v2/package.json`](app-v2/package.json) and may be ahead of the latest published release.

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-support-yellow?style=for-the-badge&logo=buymeacoffee)](https://buymeacoffee.com/bettercalllbasso)

<img src="app-v2/concepts/rebuild/hero-woking-gt3.png" alt="GT3 hero" width="960" />

</div>

---

## Current feature set

Ultimate Sim App combines live race telemetry, dashboard composition, transparent overlays, phone streaming, hardware control, and local AI into one desktop app. It is designed for Windows racing rigs, second monitors, cockpit tablets/phones, and DIY Arduino/ESP32 devices.

## What's new

<!-- WHATS_NEW:START -->
### 2.52.0 (draft) — semantic controls, expression destinations, secure streaming, and language-correct speech

- **Touch Controls schema v2** adds momentary, latching toggle, rocker, guarded two-step, rotary, selector, status LED, and value-tile controls with expression-driven states and accessible interaction.
- **Expression Studio destinations** can place custom expressions or mapped iRacing variables on a selected dashboard or custom overlay with value, bar, gauge, or status presentations.
- **Streaming hardening** adds prefix-safe resource discovery, HttpOnly viewer sessions, authentication throttling, capacity isolation, explicit HTTPS requirements for Internet mode, and fail-closed browser controls.
- **Trigger-only race overlays** now use temporal rising/falling edges, pulses, TTL windows, preview isolation, and replay/session reset boundaries; normal steady green no longer activates race-control alerts.
- **Speech language synchronization** keeps Spotter, Coach, Engineer, voice previews, and Stint Debrief text aligned with the selected voice/language and cancels stale speech when language changes.
- **Visual and catalog reliability** fixes 19 release-blocking widget layouts, preserves expression output recency, and keeps newly released overlays, widgets, and dashboards ahead of older catalog entries.

### 2.50.0 — Intent- & racecraft-aware AI Coach

- The local **AI Coach** now infers **driver intent** (racecraft, stint management, track/session conditions) over a time window before calling anything a mistake — deterministic and local-first, **no cloud LLM, no black-box ML**.
- **Golden rule**: an event is only flagged when no legitimate intent explains it, it **repeats lap-to-lap**, and there is real time loss; otherwise it stays **silent** or is kept as neutral **context**. Silence beats noise.
- **Confidence per finding + a "Coach sensitivity" slider**; grounded tips cite **Turn + Sector together**, the driving dimension in plain words, the seconds lost and the discarded intent — e.g. *"Turn 13 (Sector 3): not enough steering — lost 1.0s"*.
- **Local per-car + per-track baselines** (robust median/MAD/EMA + lap-to-lap repetition) tell the driver's **style** apart from an **error**; the local LLM only *verbalizes* the decided finding (PT-BR/EN). Research write-up in `app-v2/docs/coach-intent-research.md`.

### 2.49.0 — Overlay/widget fixes, device flashing & guided setup

- **Overlay/widget rendering fixes**: transparent, title-less, border-less overlays where reported; numbers no longer clipped; rev-lights/RPM strips fill the box width; the editor preview renders the real widget with simulated telemetry.
- **New overlay style editor**: colors, fonts, background, borders + border color, and divider lines — including hi-fi widgets.
- **Device flashing fixed**: `avrdude.exe` is bundled (with a download fallback); **iFlag** fixes (all serial ports listed, stable reconnect, persisted state, logging) plus a **guided setup wizard** for unknown devices and a **Custom serial devices** submenu.
- **Streaming**: fixed "Test from this PC → Failed to fetch" and added a **stream target selector** to choose which dashboard to stream.
- **Per-menu tutorials** (first-run walkthrough + a persistent "Start this menu's tutorial" button), a **Join us on Discord** button, a **Check for updates** button, and a fixed Windows taskbar/Start **app icon**.

<!-- WHATS_NEW:END -->

### iRacing telemetry widgets, overlays, and GT3 dashboards

- **423 generated iRacing telemetry variants** for 141 implemented concepts, plus specialized alert, derived, and car-themed widgets.
- The telemetry inventory records 143 eligible concepts: 141 implemented in the three-style framework, one blocked because opponent steering is unavailable, and shift lights handled by the dedicated rev-light implementation.
- **Per-car themed widgets** for Ferrari, Porsche, Mercedes-AMG, McLaren, Corvette, and Lamborghini visual families.
- **Themed channel widgets** plus full-frame GT3 DDU/cluster dashboards with shift LEDs, gear, speed, RPM, delta, TC/ABS, brake bias, tyres, fuel, and engineer pages.
- **NaN-safe rendering**: absent telemetry is shown as empty or placeholder data instead of fake values.

### Dashboards and cockpit displays

- **Dashboard builder/editor** with live preview, duplicate-and-edit workflow, monitor selection, import/export, and open-on-display support.
- **336 built-in dashboard presets**, including 50 dense 1024×600 GT3 layouts for qualifying, sprint, race, and endurance use.
- **Race playlist** support can interleave dashboards and Touch Controls panels and cycle them from mapped hardware buttons.
- **Read-only dashboard streaming** in local, LAN, or Internet mode, with HttpOnly viewer sessions, authentication throttling, capacity isolation, stream-safe identity masking, a selectable dashboard or Touch Controls target, and either a verified public HTTPS URL or the bundled checksum-verified Cloudflare quick tunnel.
- **Adaptive dashboards** that show/hide or emphasize widgets according to session phase and live race context.
- **AI dashboard builder** that assembles a preview from a plain-English description, with an offline keyword fallback when the local model is unavailable.
- **OLED Dashboard** presets for 128x64 ButtonBox displays.
- **Touch Controls Dash schema v2** for semantic momentary, toggle, rocker, guarded, rotary, selector, status-LED, and value-tile controls, with expression-driven states, keyboard ownership cleanup, accessible interaction, and editable RGB button boxes.

### Overlays and race awareness

- Transparent overlay windows for gear/speed, delta, inputs, fuel, relative/standings, flags, tyres, brakes, weather, radar, rev lights, and telemetry widgets.
- **Trigger-only condition overlays** for spotter/proximity, pace-car and pits-open messages, DRS, pit service, repairs, weather, race-control flags, incidents, shift flash, pit limiter, and low fuel, with pulse/TTL behavior and replay/session-safe resets.
- **Interactive 3D Waze-style navigation map** with follow-camera track-up behavior, zoom, pan/rotate, recenter, layout-specific learned outlines/corners, replay-safe learning pauses, and a 2D fallback where WebGL is unavailable.
- Overlay editing, positioning, import/export, and compositor mode for one transparent window per display.

### Strategy, audio, haptics, and hardware

- **Fuel and tyre strategy**: fuel-per-lap, laps remaining, stint planning, tyre wear, degradation, pit windows, and undercut/overcut guidance.
- **Team Fuel · LAN** rooms share same-session fuel, fuel-per-lap, laps remaining, stint targets, and pit-window state between peers using the same room key.
- **Rev-lights configuration** with presets, color bands, shift points, and live preview for SIM-X hardware.
- **Sounds/audio cues** for shift beeps, incidents, ABS, TCS, and race warnings.
- **Haptics and zonal haptics** for bass shakers/tactile feedback mapped to cockpit zones.
- **Arduino and ESP32 device support** for RGB, matrix LEDs, displays, gauges, controls, pinout design, and firmware-oriented workflows.
- **Input monitor, controls, and keyboard bindings** for buttons, axes, keystrokes, virtual gamepad actions, iRacing commands, and app actions.

### Live/replay and configuration safety

- iRacing telemetry is classified as confirmed live, replay, or unknown. Live-only Coach/Engineer findings, predictions, fuel/tyre/lap strategy, adaptive moments, biometrics, community capture, Team Fuel, alerts, SoundShift, and track-map learning reset or pause outside confirmed live telemetry.
- Returning to live starts from reset or seeded state to avoid stale findings and duplicate alerts.
- Full-profile export remains available. Full-profile import is temporarily disabled to protect existing configuration; use per-section import controls instead. Credentials, tokens, sessions, logs, recordings, and track-map caches are excluded from configuration exports.
- These controls are live-data safety boundaries, not a claim that replay analysis is complete.

### Local AI, search, and community tools

- **AI Engineer** for fuel, tyres, gaps, strategy, and race questions using local telemetry context.
- **AI Coach** for lap analysis, corner findings, and improvement points — intent- and racecraft-aware for overtaking, defending, general improvement, and qualifying context; honest when opponent controls are unavailable; and cleared outside confirmed live telemetry.
- **Semantic Search** across setups, ghosts, notes, and coach findings with a keyword fallback.
- **Career and ratings** views for iRating, Safety Rating, licenses, incidents, and result history.
- **Biometrics** for heart rate and stress-vs-pace exploration.
- **Community sharing** through local-first ghosts, telemetry, setups, and `.simshare` files.

### App experience

- **Seven-language selector**: English, Portuguese (Brazil), Spanish, French, German, Chinese, and Japanese, with incremental screen coverage and English fallback.
- **Metric / Imperial/US units** persisted across telemetry, dashboards, strategy, Coach, and Engineer output.
- **Configuration safety tools** for inspecting/deleting saved sections and exporting the full profile; full-profile import remains temporarily disabled while per-section import stays available.
- **Auto-update** through GitHub Releases, including a startup update banner and manual update check.
- **Persistent Report bug / Support button** in the app chrome.
- **Brand-new app and tray icon** used across the desktop app and installer.
- **Windows `.exe` installer** built with electron-builder NSIS (`npm run dist:win`).

---

## Screenshots

These images were captured locally from the current-main React renderer and visual-audit harness with deterministic mock telemetry. The v2.52 refresh includes the semantic Touch Controls editor and Expression Studio destinations. They are real UI renders, not generated marketing artwork. Authentication-, simulator-, and hardware-only states remain empty when the harness cannot supply them.

| Current GT3 endurance DDU | Current 336-preset dashboard gallery |
|---|---|
| <img src="app-v2/docs/screenshots/dashboard-gt3-endurance-stint.png" alt="Current GT3 endurance dashboard with gear, speed, RPM LEDs, delta, fuel, tyres, and stint telemetry" width="520" /> | <img src="app-v2/docs/screenshots/dashboard-presets-336-gallery.png" alt="Top of the current dashboard renderer gallery showing 336 presets" width="520" /> |

| Dashboard editor and protected streaming target | Current race-sun preset family |
|---|---|
| <img src="app-v2/docs/screenshots/dashboards.png" alt="Dashboard management screen with editor controls, stream-safe target selector, network access, and preset gallery" width="520" /> | <img src="app-v2/docs/screenshots/dashboard-presets-race-sun.png" alt="Contact sheet of 20 current race-sun dashboard presets rendered with mock telemetry" width="520" /> |

| Live telemetry source and diagnostics | Rev-light presets and LED configuration |
|---|---|
| <img src="app-v2/docs/screenshots/telemetry.png" alt="Telemetry screen showing mock source selection, live status, diagnostics, and vehicle data" width="520" /> | <img src="app-v2/docs/screenshots/revlights.png" alt="Rev Lights settings with LED preview, shift thresholds, presets, and hardware controls" width="520" /> |

| Fuel strategy and Team Fuel LAN | Local AI Coach before the first completed lap |
|---|---|
| <img src="app-v2/docs/screenshots/fuel.png" alt="Fuel strategy showing fuel-to-finish metrics, pit window, stint planner, and Team Fuel LAN room" width="520" /> | <img src="app-v2/docs/screenshots/coach.png" alt="AI Coach summary before a completed lap, with track map, improvement points, debrief, and setup sections" width="520" /> |

| Units and telemetry configuration | Profile backup and saved-configuration safety |
|---|---|
| <img src="app-v2/docs/screenshots/settings-units.png" alt="Settings units selector with metric and US choices plus telemetry configuration" width="520" /> | <img src="app-v2/docs/screenshots/settings-configuration-safety.png" alt="Settings profile backup and saved-configuration safety controls with full-profile import disabled" width="520" /> |

| Current overlay widget renderer | All 336 current dashboard presets |
|---|---|
| <img src="app-v2/docs/screenshots/overlay-widgets-gallery.png" alt="Minimal-style overlay gallery showing current real-renderer telemetry widgets" width="520" /> | <img src="app-v2/docs/screenshots/dashboard-presets-336-contact-sheet.png" alt="Contact sheet of all 336 current dashboard presets rendered by the real dashboard renderer" width="520" /> |

| Semantic Touch Controls editor | Expression visualization destinations |
|---|---|
| <img src="app-v2/docs/screenshots/touch-controls.png" alt="Touch Controls Dash schema v2 editor with semantic racing controls and cockpit display targeting" width="520" /> | <img src="app-v2/docs/screenshots/expr.png" alt="Expression Studio showing a live expression and explicit dashboard and overlay visualization destinations" width="520" /> |

---

## Guided tour

### Race hub

- **Telemetry** — source selection for Off, Auto-detect, Demo (mock), iRacing, ACC, Assetto Corsa, AMS2, LMU, and iRacing diagnostics, with live gear, speed, RPM, position, inputs, lap times, fuel, and relative data.
- **Alerts** — pit limiter, flags, low fuel, shift warnings, and condition-driven audio/visual notifications.

### Drive

- **Dashboards** — monitor windows, `.simhubdash` import/export, builder/editor, live previews, preset gallery with tag filtering, race playlist, token/password-protected read-only streaming, and open-on-display support.
- **Touch Controls Dash** — cockpit touch panels and RGB button-box layouts for pit commands and app actions.
- **Adaptive Dashboard** — context-aware dashboard behavior that highlights or hides widgets based on race phase and live conditions.
- **OLED Dashboard** — compact 128x64 telemetry pages for ButtonBox OLED hardware.
- **Overlays** — transparent race overlays, trigger-only warnings, compositor mode, and the 3D navigation map.
- **3D Spotter** — spatial awareness cues for nearby cars.
- **Sounds** — shift beeps, incident cues, ABS/TCS cues, and per-car learning.
- **Haptics / Zonal Haptics** — telemetry-driven bass-shaker/tactile output by body zone.
- **Biometrics** — heart-rate and stress-vs-pace tools.

### Strategy and data

- **Fuel / Team Fuel** — fuel used per lap, laps-to-empty, fuel-save target, pit window, stint planning, and same-room-key LAN sharing.
- **Tyres** — wear, temperature/pressure context, degradation, and tyre-driven pit timing.
- **Strategy** — predictive pit windows, margins, undercut/overcut hints, and race context.
- **Career & Ratings** — iRating, Safety Rating, licenses, incidents, and results history.
- **Race Profiles** — per-car/track profiles for bindings, OLED pages, overlays, alerts, and hardware behavior.
- **Setups** — local or URL-based setup installation workflows.
- **Community** — local-first ghosts, telemetry, and setup sharing through `.simshare` files.
- **Expressions** — CSP-safe custom fields and conditions without `eval`, transaction-safe imports, revision conflict protection, and explicit Dashboard/custom Overlay visualization destinations.

### Local AI

The AI Engineer, AI Coach, lap analysis, semantic search, and adaptive selections are designed to run locally on the CPU. No cloud API key is required for the built-in local flow.

- **AI Engineer** — text race engineer for fuel, tyres, gaps, and strategy.
- **AI Coach** — intent- and racecraft-aware driving coach for overtake, defend, general improvement, and qualifying context, with confidence, silence when unsure, Turn+Sector grounding, local per-car/track baselines, and replay/live fencing.
- **AI Dashboard Builder** — dashboard generation from text, with offline fallback behavior.
- **Semantic Search** — meaning-based search with keyword fallback.
- **Voice / TTS** — offline voices where available, system fallback, and language-synchronized Spotter, Coach, Engineer, preview, and Stint Debrief speech.

### Hardware and app

- **Devices** — USB/serial detection and ButtonBox selection.
- **Arduinos / ESP32** — hardware hub for RGB, matrices, displays, gauges, controls, pinout, and firmware generation.
- **Rev Lights** — LED configuration and race-style presets.
- **Input Monitor** — live Web Gamepad API validation.
- **Controls & Keyboard** — button-to-key, virtual gamepad, iRacing command, and app-action mapping.
- **Pinout Designer** — low-code pin mapping for LEDs, encoders, multiplexers, and displays.
- **Profiles** — save and load hardware/race configurations.
- **Settings** — updates, startup behavior, tray behavior, telemetry defaults, Metric/Imperial/US units, language, theme, and saved-configuration safety controls.
- **About / Credits** — licenses, fonts, and third-party component credits.

---

## Project layout

| Area | Path | Description |
|---|---|---|
| Desktop app | `app-v2/` | Electron + React + TypeScript Windows app. |
| Firmware | `firmware/` | Arduino sketches for the ButtonBox and companion modules. |
| Driver helper | `driver/` | Optional INF package for friendly COM-port naming using the Windows inbox `usbser.sys`. |
| Protocol docs | `docs/` | Serial protocol and implementation notes. |
| SimHub config | `simhub/` | Custom serial template for OLED telemetry. |
| CAD/print files | `cad/`, `print/` | 3D-printable enclosure sources/assets. |

---

## Languages

The language selector supports **pt-BR, en, es, fr, de, zh, and ja**. `Auto` follows the operating-system language and falls back to English. Translation coverage is incremental, so some screens may still use English or legacy strings. Change language in **Settings** and restart when prompted.

---

## Quick start for users

1. Open the [latest published release](https://github.com/guilhermerbasso/ultimate-sim-app/releases/latest).
2. Choose the Windows x64 `.exe` installer, or the portable x64 `.zip`, whose version matches the release tag. Ignore any older-version asset retained on a historical release.
3. Install and launch Ultimate Sim App, then select Auto-detect, Demo, iRacing, ACC, Assetto Corsa, AMS2, or LMU.
4. Use Borderless or Windowed mode for overlays; exclusive fullscreen cannot display Windows overlay windows.
5. Open a dashboard on another display or start streaming. LAN/Internet streaming requires a password in addition to the generated token.
6. Connect SIM-X/ButtonBox/Arduino/ESP32 hardware if you use physical controls, rev lights, OLED, haptics, or LEDs.

Telemetry and installer validation target Windows 10/11. Other platforms can still inspect much of the UI in development/demo mode, but racing telemetry is Windows-first.

Unsigned builds may trigger Windows SmartScreen. See [`MANUAL.md`](MANUAL.md) for basic installation and ButtonBox/SimHub hardware guidance.

---

## Development setup

Requirements: Node.js 24.x, npm, Git, Bash (Git Bash on Windows), network access for verified runtime-asset downloads, and Windows 10/11 x64 for telemetry and final installer validation.

```bash
cd app-v2
npm ci
npm run dev
```

Useful checks:

```bash
npm run typecheck
npm run test
npm run build
npm run visual:dash
npm run visual:widgets
npm run visual:touch
```

Build the Windows NSIS installer:

```bash
cd app-v2
npm run dist:win
```

The Windows build downloads and verifies required runtime binaries, then produces the NSIS `.exe`, portable `.zip`, `.exe.blockmap`, and mandatory `latest.yml` auto-update feed in `app-v2/dist-win/`.

---

## Screenshot and visual-audit tooling

The README screenshots are produced from `app-v2/visual-audit/`:

```bash
cd app-v2
node visual-audit/shoot-views.mjs
node visual-audit/shoot-dashboards.mjs
node visual-audit/shoot.mjs minimal
```

`shoot-views.mjs` captures every registered app view and writes candidate images directly to `app-v2/docs/screenshots/`; review and keep only useful frames. `shoot-dashboards.mjs` renders every `BUILTIN_PRESETS` dashboard through the production dashboard renderer (336 in this v2.51 audit) and writes individual captures, category contact sheets, and a report under ignored `app-v2/visual-audit/` output folders. `shoot.mjs minimal` validates the real overlay-widget gallery (95 registered widgets in this capture) plus representative dashboards under the ignored `shots/` folder.

The committed gallery and contact-sheet images are curated from those real-renderer outputs using the existing image tooling. Standalone files under `visual-audit/hifi/` are audit fixtures and are not used for the current README screenshots.

---

## Hardware and firmware

The reference ButtonBox uses:

- Arduino Pro Micro / Leonardo-compatible ATmega32U4 board
- 6 EC11 rotary encoders with push buttons
- SSD1306 OLED display
- CD74HC4067 multiplexer

Firmware and wiring docs live under `firmware/`, `docs/`, `simhub/`, `BOM.*`, and `WIRING.*`.

---

## Contributing

Contributions are welcome. Start with [`CONTRIBUTING.md`](CONTRIBUTING.md), follow the [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md), and use [`SECURITY.md`](SECURITY.md) for private vulnerability reporting. Open an issue for larger changes and keep pull requests focused; the maintainer reviews and merges them.

Generated dependencies and build outputs (`node_modules/`, `app-v2/out/`, `app-v2/dist-win/`, logs/caches, visual-audit outputs) are intentionally not committed. CI runs typecheck, tests, build, security analysis, and Windows package checks. Releases must attach the same-build `.exe`, `.zip`, `.exe.blockmap`, and **`latest.yml`**; see [`docs/RELEASING.md`](docs/RELEASING.md).

---

## Support and community

- [Report a bug or request a feature](https://github.com/guilhermerbasso/ultimate-sim-app/issues/new/choose)
- [Join the Discord community](https://discord.gg/Wy7d5rTgwS)
- Report security issues privately through [`SECURITY.md`](SECURITY.md)

## Support development

If this project helps your sim racing setup, you can support development here:

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-support-yellow?style=for-the-badge&logo=buymeacoffee)](https://buymeacoffee.com/bettercalllbasso)

## License

Licensed under the Apache License, Version 2.0. See [`LICENSE`](LICENSE).
