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
### 2.51.0 (draft) — telemetry coverage, dense dashboards, units, and live-data safety

- The generated iRacing telemetry framework implements **423 real widget variants for 141 concepts**, with competition, futuristic-plausible, and DDU-inspired styles.
- The dashboard catalog adds **50 individually authored dense GT3 layouts**, bringing the built-in total to **336 presets**.
- Settings adds **Metric** and **Imperial/US** units for telemetry, dashboards, strategy, Coach, and Engineer output.
- The local Coach distinguishes overtake, defend, general improvement, and qualifying contexts without claiming opponent controls that iRacing does not expose.
- Streaming adds a searchable dashboard/Touch Controls target and an optional bundled Cloudflare quick tunnel; LAN and Internet access require a token and password.
- Confirmed live, replay, and unknown telemetry contexts now fence live-only analytics, alerts, alert-driven transient hardware effects, and track-map learning. Full-profile import is temporarily disabled; per-section import/export remains available.

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
- **Read-only dashboard streaming** in local, LAN, or Internet mode, with a session token, mandatory password for LAN/Internet, stream-safe identity masking, selectable dashboard or Touch Controls target, and either a manual public HTTPS URL or the bundled checksum-verified Cloudflare quick tunnel.
- **Adaptive dashboards** that show/hide or emphasize widgets according to session phase and live race context.
- **AI dashboard builder** that assembles a preview from a plain-English description, with an offline keyword fallback when the local model is unavailable.
- **OLED Dashboard** presets for 128x64 ButtonBox displays.
- **Touch Controls Dash** for pit panels and editable RGB button boxes on a cockpit touchscreen or streamed device.

### Overlays and race awareness

- Transparent overlay windows for gear/speed, delta, inputs, fuel, relative/standings, flags, tyres, brakes, weather, radar, rev lights, and telemetry widgets.
- **Trigger-only condition overlays** for warnings such as spotter arrows, proximity/radar, shift flash, pit limiter, flag alerts, and low fuel.
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

The versioned dashboard/contact-sheet images below are historical v2.48 captures. Current-main screenshots are maintained through the real-renderer visual-audit workflow.

| GT3 DDU dashboard | Race dashboard preset gallery |
|---|---|
| ![GT3 DDU dashboard](app-v2/docs/screenshots/hifi-ddu-v248.png) | ![Race dashboard presets](app-v2/docs/screenshots/dashboard-presets-race-sun-v248.png) |

| Live telemetry view | Rev-light configuration |
|---|---|
| ![Telemetry](app-v2/docs/screenshots/telemetry.png) | ![Rev lights](app-v2/docs/screenshots/revlights.png) |

| Dashboards and streaming | Overlays |
|---|---|
| ![Dashboards](app-v2/docs/screenshots/dashboards.png) | ![Overlays](app-v2/docs/screenshots/overlays.png) |

| Settings and updates | v2.48 preset contact sheet |
|---|---|
| ![Settings](app-v2/docs/screenshots/settings.png) | <img src="app-v2/docs/screenshots/dashboard-presets-existing-v248.png" alt="v2.48 dashboard preset contact sheet" width="360" /> |

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
- **Expressions** — CSP-safe custom fields and conditions without `eval`.

### Local AI

The AI Engineer, AI Coach, lap analysis, semantic search, and adaptive selections are designed to run locally on the CPU. No cloud API key is required for the built-in local flow.

- **AI Engineer** — text race engineer for fuel, tyres, gaps, and strategy.
- **AI Coach** — intent- and racecraft-aware driving coach for overtake, defend, general improvement, and qualifying context, with confidence, silence when unsure, Turn+Sector grounding, local per-car/track baselines, and replay/live fencing.
- **AI Dashboard Builder** — dashboard generation from text, with offline fallback behavior.
- **Semantic Search** — meaning-based search with keyword fallback.
- **Voice / TTS** — offline voices where available, system fallback, and voice-oriented race feedback.

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
2. Download `Ultimate-Sim-App-<version>-x64.exe`, or the x64 `.zip` for portable use.
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
node visual-audit/shoot-hifi.mjs
```

`shoot-views.mjs` writes candidate captures directly to `app-v2/docs/screenshots/`; review them before committing. `shoot-dashboards.mjs` renders all dashboard presets and contact sheets under ignored `app-v2/visual-audit/` output folders, and `shoot-hifi.mjs` produces working output that must be reviewed before any curated copy is committed. Versioned screenshots can lag current `main`.

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
