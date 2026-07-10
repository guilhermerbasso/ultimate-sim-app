<div align="center">

<img src="app-v2/concepts/rebuild/app-icon.png" alt="Ultimate Sim App icon" width="128" height="128" />

# Ultimate Sim App

**Ultimate Sim App 2.50.0** is a Windows sim-racing companion for iRacing-focused telemetry, GT3-style dashboards, transparent overlays, strategy tools, DIY hardware, and local AI coaching.

Independent community project maintained by Guilherme Basso · Electron + React + TypeScript · Apache-2.0

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-support-yellow?style=for-the-badge&logo=buymeacoffee)](https://buymeacoffee.com/bettercalllbasso)

<img src="app-v2/concepts/rebuild/hero-woking-gt3.png" alt="GT3 hero" width="960" />

</div>

---

## What is included in 2.50.0

Ultimate Sim App combines live race telemetry, dashboard composition, transparent overlays, phone streaming, hardware control, and local AI into one desktop app. It is designed for Windows racing rigs, second monitors, cockpit tablets/phones, and DIY Arduino/ESP32 devices.

## What's new since 2.48

### 2.50.0 — Intent- & racecraft-aware AI Coach

- The local **AI Coach / Race Engineer** now infers **driver intent** (racecraft, stint management, track/session conditions) over a time window before calling anything a mistake — deterministic and local-first, **no cloud LLM, no black-box ML**.
- **Golden rule**: an event is only flagged when no legitimate intent explains it, it **repeats lap-to-lap**, and there is real time loss; otherwise it stays **silent** or is kept as neutral **context**. Silence beats noise.
- **Confidence per finding + a "Coach sensitivity" slider**; grounded tips cite **Turn + Sector together**, the driving dimension in plain words, the seconds lost and the discarded intent — e.g. *"Turn 13 (Sector 3): not enough steering — lost 1.0s"*.
- **Local per-car + per-track baselines** (robust median/MAD/EMA + lap-to-lap repetition) tell the driver's **style** apart from an **error**; the local LLM only *verbalizes* the decided finding (PT-BR/EN). Research write-up in `app-v2/docs/coach-intent-research.md`.

### 2.49.0 — Overlay/widget fixes, device flashing & guided setup

- **Overlay/widget rendering fixes**: transparent, title-less, border-less overlays where reported; numbers no longer clipped; rev-lights/RPM strips fill the box width; the editor preview renders the real widget with simulated telemetry.
- **New overlay style editor**: colors, fonts, background, borders + border color, and divider lines — including hi-fi widgets.
- **Device flashing fixed**: `avrdude.exe` is bundled (with a download fallback); **iFlag** fixes (all serial ports listed, stable reconnect, persisted state, logging) plus a **guided setup wizard** for unknown devices and a **Custom serial devices** submenu.
- **Streaming**: fixed "Test from this PC → Failed to fetch" and added a **stream target selector** to choose which dashboard to stream.
- **Per-menu tutorials** (first-run walkthrough + a persistent "Start this menu's tutorial" button), a **Join us on Discord** button, a **Check for updates** button, and a fixed Windows taskbar/Start **app icon**.

### iRacing telemetry widgets, overlays, and GT3 dashboards

- **100+ clean iRacing telemetry widgets** across inputs, speed, RPM, gear, rev lights, lap timing, delta, gaps, relative, standings, radar, fuel, tyres, brakes, engine, electronics, flags, weather, track map, G-force, coach cues, engineer cues, and derived/combined channels.
- **Every widget-able telemetry field is covered** by a dashboard widget and/or overlay-ready component where the app can represent it safely.
- **Per-car themed widgets** for Ferrari, Porsche, Mercedes-AMG, McLaren, Corvette, and Lamborghini visual families.
- **Themed channel widgets** plus full-frame GT3 DDU/cluster dashboards with shift LEDs, gear, speed, RPM, delta, TC/ABS, brake bias, tyres, fuel, and engineer pages.
- **NaN-safe rendering**: absent telemetry is shown as empty or placeholder data instead of fake values.

### Dashboards and cockpit displays

- **Dashboard builder/editor** with live preview, duplicate-and-edit workflow, monitor selection, import/export, and open-on-display support.
- **286 dashboard presets** in the visual-audit gallery, with tag filtering and multiple layout families for race, qualifying, endurance, engineer, broadcast, compact, themed, and car-style dashboards.
- **Race playlist** support and button-to-cycle integration so a hardware button can rotate through selected dashboards during a session.
- **Secure dashboard streaming** to a phone/tablet/browser: read-only, tokenized, optional password, stream-safe hiding of private data, LAN access, and support for a user-provided internet tunnel.
- **Adaptive dashboards** that show/hide or emphasize widgets according to session phase and live race context.
- **AI dashboard builder** that assembles a preview from a plain-English description, with an offline keyword fallback when the local model is unavailable.
- **OLED Dashboard** presets for 128x64 ButtonBox displays.
- **Touch Controls Dash** for pit panels and editable RGB button boxes on a cockpit touchscreen or streamed device.

### Overlays and race awareness

- Transparent overlay windows for gear/speed, delta, inputs, fuel, relative/standings, flags, tyres, brakes, weather, radar, rev lights, and telemetry widgets.
- **Trigger-only condition overlays** for warnings such as spotter arrows, proximity/radar, shift flash, pit limiter, flag alerts, and low fuel.
- **Interactive 3D Waze-style navigation map** with follow-camera track-up behavior, zoom, pan/rotate, recenter, and a 2D fallback where WebGL is unavailable.
- Overlay editing, positioning, import/export, and compositor mode for one transparent window per display.

### Strategy, audio, haptics, and hardware

- **Fuel and tyre strategy**: fuel-per-lap, laps remaining, stint planning, tyre wear, degradation, pit windows, and undercut/overcut guidance.
- **Rev-lights configuration** with presets, color bands, shift points, and live preview for SIM-X hardware.
- **Sounds/audio cues** for shift beeps, incidents, ABS, TCS, and race warnings.
- **Haptics and zonal haptics** for bass shakers/tactile feedback mapped to cockpit zones.
- **Arduino and ESP32 device support** for RGB, matrix LEDs, displays, gauges, controls, pinout design, and firmware-oriented workflows.
- **Input monitor, controls, and keyboard bindings** for buttons, axes, keystrokes, virtual gamepad actions, iRacing commands, and app actions.

### Local AI, search, and community tools

- **AI Engineer** for fuel, tyres, gaps, strategy, and race questions using local telemetry context.
- **AI Coach** for lap analysis, corner findings, and improvement points — now **intent- & racecraft-aware**: it infers whether a deviation is a deliberate choice (attacking/defending, fuel/tyre saving, flags/safety car, wet) before flagging it, attaches a confidence, and stays silent when unsure. Plus stint debriefs and setup suggestions.
- **Semantic Search** across setups, ghosts, notes, and coach findings with a keyword fallback.
- **Career and ratings** views for iRating, Safety Rating, licenses, incidents, and result history.
- **Biometrics** for heart rate and stress-vs-pace exploration.
- **Community sharing** through local-first ghosts, telemetry, setups, and `.simshare` files.

### App experience

- **Full multi-language UI**: English, Portuguese (Brazil), Spanish, French, German, Chinese, and Japanese. Language changes are persisted and applied after restart where required.
- **Auto-update** through GitHub Releases, including a startup update banner and manual update check.
- **Persistent Report bug / Support button** in the app chrome.
- **Brand-new app and tray icon** used across the desktop app and installer.
- **Windows `.exe` installer** built with electron-builder NSIS (`npm run dist:win`).

---

## Screenshots

All screenshots below were regenerated from the app's visual-audit harness for this README refresh unless noted.

| GT3 DDU dashboard | Race dashboard preset gallery |
|---|---|
| ![GT3 DDU dashboard](app-v2/docs/screenshots/hifi-ddu-v248.png) | ![Race dashboard presets](app-v2/docs/screenshots/dashboard-presets-race-sun-v248.png) |

| Live telemetry view | Rev-light configuration |
|---|---|
| ![Telemetry](app-v2/docs/screenshots/telemetry.png) | ![Rev lights](app-v2/docs/screenshots/revlights.png) |

| Dashboards and streaming | Overlays |
|---|---|
| ![Dashboards](app-v2/docs/screenshots/dashboards.png) | ![Overlays](app-v2/docs/screenshots/overlays.png) |

| Settings and updates | Full preset contact sheet |
|---|---|
| ![Settings](app-v2/docs/screenshots/settings.png) | <img src="app-v2/docs/screenshots/dashboard-presets-existing-v248.png" alt="Dashboard preset contact sheet" width="360" /> |

---

## Guided tour

### Race hub

- **Telemetry** — source selection for Off, Auto-detect, Demo (mock), iRacing, ACC, Assetto Corsa, AMS2, and iRacing diagnostics, with live gear, speed, RPM, position, inputs, lap times, fuel, and relative data.
- **Alerts** — pit limiter, flags, low fuel, shift warnings, and condition-driven audio/visual notifications.

### Drive

- **Dashboards** — monitor windows, `.simhubdash` import/export, builder/editor, live previews, preset gallery with tag filtering, race playlist, secure streaming, and open-on-display support.
- **Touch Controls Dash** — cockpit touch panels and RGB button-box layouts for pit commands and app actions.
- **Adaptive Dashboard** — context-aware dashboard behavior that highlights or hides widgets based on race phase and live conditions.
- **OLED Dashboard** — compact 128x64 telemetry pages for ButtonBox OLED hardware.
- **Overlays** — transparent race overlays, trigger-only warnings, compositor mode, and the 3D navigation map.
- **3D Spotter** — spatial awareness cues for nearby cars.
- **Sounds** — shift beeps, incident cues, ABS/TCS cues, and per-car learning.
- **Haptics / Zonal Haptics** — telemetry-driven bass-shaker/tactile output by body zone.
- **Biometrics** — heart-rate and stress-vs-pace tools.

### Strategy and data

- **Fuel** — fuel used per lap, laps-to-empty, fuel-save target, pit window, and stint planning.
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
- **AI Coach** — intent- & racecraft-aware driving coach: infers driver intent (racecraft/management/conditions) before flagging an error, with confidence, silence when unsure, Turn+Sector grounded tips, and local per-car+track baselines.
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
- **Settings** — updates, startup behavior, tray behavior, telemetry defaults, language, and theme.
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

The UI supports **pt-BR, en, es, fr, de, zh, and ja**. `Auto` follows the operating-system language and falls back to English. Change language in **Settings**; restart when prompted so every renderer and tray surface uses the new locale.

---

## Quick start for users

1. Download the Windows `.exe` installer from the latest [Release](../../releases).
2. Install and launch Ultimate Sim App.
3. Select a telemetry source. Use **Demo (mock)** to explore without a running sim.
4. Open a dashboard on another display or start secure streaming to a phone/tablet.
5. Connect SIM-X/ButtonBox/Arduino/ESP32 hardware if you use physical controls, rev lights, OLED, haptics, or LEDs.

Telemetry and installer validation target Windows 10/11. Other platforms can still inspect much of the UI in development/demo mode, but racing telemetry is Windows-first.

See the full user guide in [`MANUAL.md`](MANUAL.md).

---

## Development setup

Requirements: Node.js 24+, npm, Git, and Windows 10/11 for final installer validation.

```bash
cd app-v2
npm install
npm run dev
```

Useful checks:

```bash
npm run typecheck
npm run test
npm run build
npm run visual:dash
npm run visual:touch
```

Build the Windows NSIS installer:

```bash
cd app-v2
npm run dist:win
```

---

## Screenshot and visual-audit tooling

The README screenshots are produced from `app-v2/visual-audit/`:

```bash
cd app-v2
node visual-audit/shoot-views.mjs
node visual-audit/shoot-dashboards.mjs
node visual-audit/shoot-hifi.mjs
```

`shoot-views.mjs` writes screen captures to `app-v2/docs/screenshots/`. `shoot-dashboards.mjs` renders all dashboard presets and contact sheets under `app-v2/visual-audit/`. `shoot-hifi.mjs` renders the DDU reference shot.

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

Contributions are welcome. Start with [`CONTRIBUTING.md`](CONTRIBUTING.md), open an issue for larger changes, and keep changes focused. Pull requests must be reviewed and approved by the maintainer before merge.

Generated dependencies and build outputs (`node_modules/`, `app-v2/out/`, `app-v2/dist-win/`, logs/caches, visual-audit outputs) are intentionally not committed. Release installers are generated from source and attached to GitHub Releases after review.

---

## Support

If this project helps your sim racing setup, you can support development here:

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-support-yellow?style=for-the-badge&logo=buymeacoffee)](https://buymeacoffee.com/bettercalllbasso)

## License

Licensed under the Apache License, Version 2.0. See [`LICENSE`](LICENSE).
