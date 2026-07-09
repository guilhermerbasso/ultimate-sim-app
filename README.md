<div align="center">

<img src="app-v2/concepts/rebuild/app-icon.png" alt="Ultimate Sim App icon" width="128" height="128" />

# Ultimate Sim App

**A Windows sim‑racing companion + DIY ButtonBox project** — live telemetry, GT3‑grade dashboards, transparent overlays, race strategy, and a **100% local, offline AI engineer & coach** that runs on your CPU with **no GPU and no cloud cost**.

Independent community project maintained by Guilherme Basso · Electron + React + TypeScript · Apache‑2.0

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-support-yellow?style=for-the-badge&logo=buymeacoffee)](https://buymeacoffee.com/bettercalllbasso)

<img src="app-v2/concepts/rebuild/hero-woking-gt3.png" alt="GT3 hero" width="960" />

</div>

---

## 🧠 Local AI — no GPU, no cost, fully offline

The **AI Engineer**, **Live/AI Coach**, and **lap analysis** run **entirely on your machine, on the CPU**:

- **No GPU required** — the bundled LLM uses the CPU‑only `node-llama-cpp` backend (GPU/CUDA/Vulkan variants are intentionally excluded from the build).
- **No cost, no cloud, no account** — nothing is sent to an external API; there are no per‑request charges or subscriptions.
- **Works offline** — the race engineer, driving coach, semantic search, and neural voices operate without an internet connection.

> In short: the intelligent features are yours, private, free, and GPU‑free.

---

## ✨ What's new

### 2.44.0 — v5: real-dash car themes, more iRacing widgets & a fixed Windows installer

- **Real-dashboard car themes** — dashboards, full-dash overlays and per-info widgets modelled on the **real cluster** of a fleet of endurance/GT3/Cup cars: **Le Mans / WEC prototype, Ferrari 488 Challenge, Ferrari 296 GT3, Aston Martin Vantage & Vantage GT3, Mercedes-AMG One & GT Track Series, Porsche 911 GT3 Cup, Ford Mustang GTD, Chevrolet Corvette Z06 GT3.R, Lamborghini Huracán GT3 and McLaren 720S**. Each theme ships a full-dash **dashboard**, a full-dash **overlay** and **10 single-info widgets/overlays**, reconstructed with the mandated *gpt-image reference → build → visual-QA-until-clean* flow. No copyrighted photos or logos are committed.
- **More iRacing widgets & overlays** — extra telemetry channels and visual styles on top of the existing catalog, each validated against its own reference image.
- **Windows `.exe` restored** — the tagged release build now runs `electron-builder --win --publish never`, so it no longer fails on electron-builder's implicit GitHub publishing; every `v*` tag again attaches a working NSIS installer (`.exe`), a portable `.zip` and `latest.yml` to the Release.
- **CI on Node 24** — `actions/checkout@v5`, `actions/setup-node@v5` and `node-version: 24` across CI, CodeQL and the installer workflow.
- **Automated Copilot QA on pull requests** — an opt-in review → auto-fix → auto-merge loop helps keep `main` clean.

### 2.43.0 — clean v4: title‑less widgets, trigger overlays, 3D nav map, themed cars

- **Clean visual language** — every widget/overlay is now **transparent, title‑less and chrome‑light**: the value speaks for itself (just `P4`, no "Position" label), no panel fills, hairline‑only separators, still fully editable (color/size/font/position + conditional color). A dark text‑outline keeps values legible over any background.
- **Trigger‑only spotter overlays** — 7 overlays that stay hidden until their condition fires: **car‑left / car‑right arrows**, **radar‑on‑proximity** (< 0.5 s), **shift‑LED flash**, **pit‑limiter**, **flag alert** and **low‑fuel**.
- **Hide + "Hidden" menu** — multi‑select hide/restore for widgets, overlays, dashboards and touch dashes; hidden items leave the main lists (and the compositor) but are never deleted.
- **Interactive 3D nav map** — a **Waze / Google‑Maps‑style** track map (Three.js): follow‑camera track‑up, live zoom, drag‑rotate/pan and a recenter button, with a 2D SVG fallback where WebGL is unavailable.
- **Per‑car themed widgets & dashboards** — 6 authentic shift‑light signatures + 6 cluster signatures (**Ferrari, Porsche, Mercedes‑AMG, McLaren, Corvette, Lamborghini**), plus rebuilt themed dashboards in every category.
- **58 recreated clean dashboards** — race / endurance / coach / family rebuilt to the clean premise with a **rev‑lights strip corner‑to‑corner across the top**, authored at 1024×600 and adaptive to any display; broadcast/endurance hero fixes.
- **Touch Controls** — new **rocker** and **LED‑ring** button styles, preset tags, and per‑car themed button‑boxes.
- **More rev‑lights** — gradient bar, dense LED strip, LED bar with a blue over‑rev, and a centered **Mustang‑style** cluster.
- **100% American‑English UI** — a deep i18n sweep translates every screen, description, widget/overlay/dashboard and the **AI engineer / coach / spotter voice**; switching language changes everything.

Every new visual asset was built with the mandated flow: a validated American‑English `gpt‑image` prompt → reference image → image QA → build → visual QA against the reference until clean.

### 2.42.0 — per‑telemetry widgets, +50 dashboards, tags & adaptive AI

- **71 per‑telemetry hi‑fi widgets** — one clean, NaN‑safe SVG per channel (inputs, speed/RPM/gear/rev‑lights, delta/lap/position/time, gaps/relative/standings/radar, fuel, tyres, brakes/engine/electronics, flags/weather/track‑map/G‑force, and **AI coach/engineer** cues). Each doubles as a **floating overlay** and a **dashboard widget**.
- **+50 hi‑fi 1024×600 composition dashboards** — race, endurance, AI‑coach and broadcast/minimal themes, **letterboxed so nothing ever clips, overflows or overlaps** at any size or aspect.
- **Tags + multi‑select filtering** on Overlays, Dashboards and Touch Controls — filter by sim (IR/ACC/AC/AMS2/LMU), category and style, several tags at once.
- **Adaptive Dashboard, now AI‑curated** — a **local** heuristic AI selects the most relevant widgets for the current race moment.
- **AI widgets & AI‑coach dashboards** — live coach tip/findings, engineer radio, proactive alerts, strategy call and AI confidence (all **local, CPU‑only, free**).

### 2.41.0 — race‑car fidelity rebuild

- **Hi‑fi 1024×600 dashboards** — photorealistic **GT3 DDU cockpit**, **MoTeC‑style engineer analysis**, and **endurance/IMSA** clusters, each built from a `gpt‑image` reference and matched pixel‑by‑pixel, driven by **live telemetry**, and **adaptive** to any screen (desktop, phone, tablet).
- **Overlays** — activating an overlay no longer scrolls the page, and the presentation options are now **5 structurally‑distinct forms** (not just colour tints): minimal, broadcast, analog, heatmap, neon.
- **Stream to your phone/tablet** — a built‑in LAN server with **QR code + token + optional password** opens the dashboard (and the Touch Controls Dash) in any mobile browser, responsive to the device screen.
- **Auto‑update** — automatic updates from GitHub Releases plus a manual **Check for updates** button.
- **English‑first, deep i18n** — English is the base and switching language localizes screens, descriptions, and the AI engineer/voice. Switchable **Português, Deutsch, Français, 中文, Español, 日本語**.
- **Fixes** — Settings now apply and persist immediately (telemetry source, etc.); the AI Coach map grows/shrinks with zoom; Community ships curated, editable telemetry/setup sources per simulator.
- **Collapsible sidebar** (icon‑only rail, `Ctrl/Cmd+B`, persisted) and a **new app icon**.

All hi‑fi dashboards are **NaN‑safe** SVG (they show em‑dashes for absent telemetry — never fake data) and verified by the visual‑audit harness (**0 render errors / overflow / overlap** across 268 presets) and the unit suite (**2,890 tests green**).

---

## 🏁 Features

### Sim Racing
- **Telemetry** — live source selection (Off / Auto / Demo mock / **iRacing / ACC / AC / AMS2 / LMU**) with a live overview.
- **Dashboards** — monitor windows, `.simhubdash` import, drag‑and‑drop builder, and 200+ built‑in GT3/endurance presets.
- **Adaptive Dashboard** — a single dashboard that reorganizes itself by session phase and lap moment.
- **Touch Controls Dash** — touch pit panel and editable RGB button boxes for a cockpit screen.
- **OLED Dashboard** — selectable presets that rotate on the ButtonBox OLED (128×64 preview).
- **Overlays** — transparent windows over the game: rev/shift lights, gear+speed, delta, inputs, fuel, relative/standings (multiclass), flags, tyres/brakes, weather, radar.
- **Fuel** — usage per lap, laps‑to‑empty, fuel‑save target, pit window, stint planner.
- **Tyres** — wear, per‑lap degradation rate, and pit window.
- **Strategy** — pit window, fuel margin, undercut/overcut, and incident clips.
- **Alerts** — pit limiter, flags, low fuel, and shift warnings (Web Audio beeps).
- **Expressions** — custom fields and conditions via a safe, CSP‑compatible evaluator (no `eval`).
- **Race Profiles** — car/track profiles (HID map + OLED + overlays + alerts + bindings) with auto‑switch.
- **Sounds** — Soundshift gear‑shift beep, incident, ABS and TCS audio cues (per‑car, self‑learning shift RPM).
- **Setups** — auto‑install `.sto` setups from a local folder or an https URL.
- **Career & Ratings** — iRating, Safety Rating, licenses, incidents, and results.
- **Biometrics** — heart rate, stress vs pace, and an AR HUD.
- **Haptics / Zonal Haptics** — ShakeIt‑style bass‑shaker + tactile feedback mapped to zones, with a visual simulator.
- **3D Spotter** — HRTF spatial‑audio cues for nearby cars.
- **Community** — local‑first ghosts, telemetry, and setups via `.simshare` files.
- **Real‑dash car themes** — per‑car dashboards, full‑dash overlays and single‑info widgets modelled on the real clusters of GT3/Cup/endurance cars (Ferrari 488 Challenge & 296 GT3, Porsche 911 GT3 Cup, Mercedes‑AMG, Aston Martin Vantage GT3, Corvette Z06 GT3.R, Lamborghini Huracán GT3, Mustang GTD, McLaren 720S, Le Mans/WEC), each with authentic shift‑light and cluster signatures.

### AI & Coaching (local, CPU‑only, free)
- **AI Engineer** — text race engineer for fuel, tyres, gaps and strategy, plus a **Voice Spotter** (Local LLM).
- **AI Coach** — driving coach and lap analysis with corner findings, track map, and setup suggestions (Local AI).
- **AI Dashboard** — build dashboards by describing them in plain text (Local LLM).
- **Semantic Search** — meaning‑based search across setups, ghosts, notes and findings (local embeddings).
- **Voice / TTS** — offline neural voices, system fallback, and wake‑word.

### ButtonBox / SIM‑X hardware
- **Devices** — USB/serial detection and ButtonBox selection.
- **Arduinos** — SimHub‑style hardware hub for RGB, matrix, displays, gauges, controls, pinout and firmware.
- **Rev Lights** — rev‑light configuration and presets.
- **Input Monitor** — live validation through the Web Gamepad API.
- **Controls & Keyboard** — button → key, virtual gamepad, iRacing command, or app action.
- **Pinout Designer** — low‑code drag‑and‑drop pin map plus firmware generation.
- **Profiles** — save and load hardware/race configurations.

### App
- **Settings** — auto‑start with Windows, default telemetry source, **language (7)**, and theme.
- **About / Credits** — licenses, fonts, and third‑party components.

---

## 📸 Screenshots

**Hi‑fi dashboards** (built from a `gpt‑image` reference, then matched pixel‑by‑pixel; live telemetry; 1024×600, adaptive):

| GT3 DDU Cockpit | Engineer — MoTeC analysis |
|---|---|
| ![GT3 DDU cockpit](app-v2/concepts/rebuild/hifi-ddu-cockpit.png) | ![Engineer MoTeC](app-v2/concepts/rebuild/hifi-engineer.png) |

| Endurance / IMSA stint | App icon |
|---|---|
| ![Endurance stint](app-v2/concepts/rebuild/hifi-endurance.png) | <img src="app-v2/concepts/rebuild/app-icon.png" width="160" /> |

> Plus **50+ new hi‑fi composition dashboards** and **71 per‑telemetry widgets/overlays** — every one built with the same *image → build → visual‑QA‑until‑clean* flow, tagged and filterable. Preview renders of every dashboard, widget, overlay and touch panel are generated by the visual‑audit harness (`npm run visual:dash`).

---

## 🖥️ Guided tour — every screen

A screenshot and a short explanation of each screen in the app (sidebar order). The UI is **English‑first** and fully **keyboard‑navigable** (press `⌘/Ctrl‑K` for the command palette; star any screen to pin it to Favorites; `Ctrl/Cmd‑B` collapses the sidebar to an icon rail).

### Race data & telemetry

**Telemetry**
![Telemetry](app-v2/docs/screenshots/telemetry.png)
The live data hub. Pick your telemetry source — **Off / Auto‑detect / Demo (mock) / iRacing / ACC / Assetto Corsa / AMS2 / LMU** (plus an iRacing diagnostics mode) — and watch gear, speed, RPM, position, inputs, lap times, fuel and a live relative list update at 60 Hz. Use **Demo (mock)** to explore and configure everything with no sim running.

**Alerts**
![Alerts](app-v2/docs/screenshots/alerts.png)
Configurable audible/visual warnings — pit limiter, flags, low fuel and shift points — using CSP‑safe Web Audio beeps (no external media).

### Dashboards & displays

**Dashboards**
![Dashboards](app-v2/docs/screenshots/dashboards.png)
Open GT3/endurance dashboards on your second monitor or a cockpit screen. Browse the preset gallery (now **200+ presets**, including the new hi‑fi 1024×600 clusters and 50+ composition dashboards), **filter by multiple tags** at once, import `.simhubdash` files, or duplicate‑and‑edit any preset in the drag‑and‑drop builder.

**Adaptive Dashboard**
![Adaptive Dashboard](app-v2/docs/screenshots/dashboard-adaptive.png)
A single dashboard that **reorganizes itself live** by session phase and lap moment. With **AI live selection** on, a local heuristic AI continuously picks the most relevant widgets for the moment (low fuel, hot tyres, a car closing in, the pit window…).

**AI Dashboard Builder**
![AI Dashboard Builder](app-v2/docs/screenshots/dashboard-builder.png)
Describe the dashboard you want in plain English and a **local** LLM assembles it from the widget catalog — then fine‑tune it in the editor.

**OLED Dashboard**
![OLED Dashboard](app-v2/docs/screenshots/oled-dash.png)
Selectable telemetry presets for a 128×64 ButtonBox OLED, with a live on‑screen preview.

**Touch Controls Dash**
![Touch Controls Dash](app-v2/docs/screenshots/touch-controls.png)
Photoreal, touch‑friendly pit panels and editable **RGB button boxes** for a cockpit touchscreen — tap to send key binds, iRacing commands or app actions. Streams to a phone/tablet too.

**Overlays**
![Overlays](app-v2/docs/screenshots/overlays.png)
Transparent windows over the game: rev/shift lights, gear+speed, delta, inputs, fuel, relative/standings (multiclass), flags, tyres/brakes, weather, radar and every per‑telemetry hi‑fi widget. Filter by **sim + multiple tags**; each overlay offers **5 structurally distinct presentation styles**.

### Strategy

**Fuel**
![Fuel](app-v2/docs/screenshots/fuel.png)
Fuel used per lap, laps‑to‑empty, a fuel‑save target, the pit window and a stint planner.

**Tyres**
![Tyres](app-v2/docs/screenshots/tire.png)
Tyre wear, per‑lap degradation rate and the tyre‑driven pit window.

**Strategy**
![Strategy](app-v2/docs/screenshots/strategy.png)
Predictive pit window, fuel margin, undercut/overcut analysis and incident clips.

**Career & Ratings**
![Career & Ratings](app-v2/docs/screenshots/career.png)
iRating, Safety Rating, licenses, incidents and results history.

**Race Profiles**
![Race Profiles](app-v2/docs/screenshots/race-profiles.png)
Per car/track profiles (HID map + OLED + overlays + alerts + bindings) that auto‑switch when you change car or track.

### Local AI — no GPU, no cost

> The **AI Engineer**, **AI/Live Coach**, **lap analysis**, **semantic search** and the **adaptive widget selection** all run **100% locally on your CPU** (CPU‑only `node‑llama‑cpp`), **offline**, with **no GPU, no cloud, no API keys and no per‑use cost**.

**AI Engineer**
![AI Engineer](app-v2/docs/screenshots/engineer.png)
A text race engineer for fuel, tyres, gaps and strategy. Direct questions ("can we finish on this fuel?", "how are the tyres?") answer instantly from telemetry; open‑ended questions load the local model on demand. Includes the **Voice Spotter** for spoken warnings.

**AI Coach**
![AI Coach](app-v2/docs/screenshots/coach.png)
A driving coach and lap‑analysis workspace: per‑corner findings, a colour‑coded track map (losing / on‑par / much‑better), improvement points, a stint debrief and suggested setup changes.

**Semantic Search**
![Semantic Search](app-v2/docs/screenshots/search.png)
Meaning‑based search across setups, ghosts, notes and coach findings using local embeddings, with a keyword fallback.

**Voice / TTS**
![Voice / TTS](app-v2/docs/screenshots/voice.png)
Offline neural voices for the Engineer/Spotter (download on demand), a system‑voice fallback and a wake‑word to talk hands‑free.

### Immersion & feedback

**Haptics**
![Haptics](app-v2/docs/screenshots/haptics.png)
ShakeIt‑style bass‑shaker + tactile feedback driven by telemetry events.

**Zonal Haptics**
![Zonal Haptics](app-v2/docs/screenshots/haptics-zonal.png)
Map events to body zones (seat / pedals / wheel) with a visual simulator.

**3D Spotter**
![3D Spotter](app-v2/docs/screenshots/spotter-3d.png)
HRTF spatial‑audio cues that place nearby cars around you in 3D.

**Biometrics**
![Biometrics](app-v2/docs/screenshots/biometrics.png)
Heart rate, stress‑vs‑pace and an AR HUD.

**Sounds**
![Sounds](app-v2/docs/screenshots/sounds.png)
Soundshift gear‑shift beep plus incident, ABS and TCS audio cues (per‑car, self‑learning shift RPM).

### Community, setups & customization

**Community**
![Community](app-v2/docs/screenshots/community.png)
Local‑first ghosts, telemetry and setups shared via `.simshare` files, with curated, editable trusted sources per simulator — compare where you gain/lose.

**Setups**
![Setups](app-v2/docs/screenshots/setups.png)
Auto‑install `.sto` setups from a local folder or an https URL.

**Expressions**
![Expressions](app-v2/docs/screenshots/expr.png)
Custom fields and conditions via a safe, CSP‑compatible evaluator (no `eval`).

### ButtonBox / SIM‑X hardware

**Devices**
![Devices](app-v2/docs/screenshots/devices.png)
USB/serial detection and ButtonBox selection.

**Arduinos**
![Arduinos](app-v2/docs/screenshots/arduinos.png)
A SimHub‑style hardware hub: RGB, matrix, displays, gauges, controls, pinout and firmware generation.

**Rev Lights**
![Rev Lights](app-v2/docs/screenshots/revlights.png)
Rev/shift‑light configuration and presets.

**Input Monitor**
![Input Monitor](app-v2/docs/screenshots/inputs.png)
Live button/axis validation through the Web Gamepad API.

**Controls & Keyboard**
![Controls & Keyboard](app-v2/docs/screenshots/controls.png)
Bind each button → keystroke, virtual gamepad, iRacing command, or an app action (open a dashboard/OLED/overlay).

**Pinout Designer**
![Pinout Designer](app-v2/docs/screenshots/pinout.png)
A low‑code, drag‑and‑drop pin map (LEDs, multiplexers, encoders) with firmware generation.

**Profiles**
![Profiles](app-v2/docs/screenshots/profiles.png)
Save and load hardware/race configurations.

### App

**Settings**
![Settings](app-v2/docs/screenshots/settings.png)
Auto‑start with Windows, start‑minimized, SIM‑X/serial auto‑connect, close‑to‑tray, **default telemetry source**, **language (7)** and theme — applied and persisted immediately.

**About / Credits**
![About / Credits](app-v2/docs/screenshots/about.png)
Licenses, fonts and third‑party components.

---

## 📦 What's included

| Area | Path | Description |
|---|---|---|
| Desktop app | `app-v2/` | Electron + React + TypeScript Windows app. |
| Firmware | `firmware/` | Arduino sketches for the ButtonBox and companion modules. |
| Driver helper | `driver/` | Optional INF package for friendly COM‑port naming using the Windows inbox `usbser.sys`. |
| Protocol docs | `docs/` | Serial protocol and implementation notes. |
| SimHub config | `simhub/` | Custom serial template for OLED telemetry. |
| CAD/print files | `cad/`, `print/` | 3D‑printable enclosure sources/assets. |

---

## 🌍 Languages

English (primary) · Português · Deutsch · Français · 中文 (Simplified) · Español · 日本語. `Auto` follows the Windows/OS language and falls back to English. Change it in **Settings → Language**.

---

## 🚀 Quick start for users

1. Download the Windows installer (`.exe`) from the latest [Release](../../releases) — every release ships a built installer attached as an asset.
2. Install or unzip the Windows package.
3. Connect the ButtonBox by USB.
4. Open Ultimate Sim App and select the device/COM port.
5. Keep SimHub closed while configuring the serial device, then close/disconnect the app before racing if SimHub needs the same COM port.

See the full user guide in [`MANUAL.md`](MANUAL.md).

> **Telemetry is Windows‑only** (the sims live on Windows). On other platforms, or without a live session, use the **Demo (mock)** source to explore and configure everything.

---

## 🛠️ Development setup

Requirements: Node.js 24+, npm, Git, and Windows 10/11 for final installer validation.

```bash
cd app-v2
npm install
npm run dev
```

Useful checks:

```bash
npm run typecheck   # tsc (node + web)
npm run test        # vitest (2,854 tests)
npm run build       # electron-vite bundle
npm run visual:dash # render every dashboard preset and report errors
```

Build the Windows installer (on Windows):

```bash
cd app-v2
npm run dist:win
```

---

## 🔩 Hardware and firmware

The reference ButtonBox uses:

- Arduino Pro Micro / Leonardo‑compatible ATmega32U4 board
- 6 EC11 rotary encoders with push buttons
- SSD1306 OLED display
- CD74HC4067 multiplexer

Firmware and wiring docs live under `firmware/`, `docs/`, `simhub/`, `BOM.*`, and `WIRING.*`.

---

## 🤝 Contributing

Contributions are welcome. Start with [`CONTRIBUTING.md`](CONTRIBUTING.md), open an issue for larger changes, and keep changes focused. Pull requests must be reviewed and approved by the maintainer before merge.

Generated dependencies and build outputs (`node_modules/`, `app-v2/out/`, `app-v2/dist-win/`, logs/caches) are intentionally not committed. Release installers are generated from source and attached to GitHub Releases after review.

---

## ❤️ Support

If this project helps your sim racing setup, you can support development here:

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-support-yellow?style=for-the-badge&logo=buymeacoffee)](https://buymeacoffee.com/bettercalllbasso)

## 📄 License

Licensed under the Apache License, Version 2.0. See [`LICENSE`](LICENSE).
