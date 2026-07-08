# Ultimate Sim App — Release Notes

## v2.43.0 — Clean v4: title‑less widgets, trigger overlays, 3D nav map, themed cars 🏁

A clean‑up pass on the whole visual language plus several new systems — every new asset built with the mandated flow (validated American‑English `gpt‑image` prompt → reference → image QA → build → visual QA until clean).

### Highlights
- 🧼 **Clean, title‑less widgets & overlays** — transparent, borderless, self‑explanatory (just `P4`), legible over any background, still fully editable.
- 🚨 **Trigger‑only spotter overlays** — car‑left/right arrows, radar‑on‑proximity, shift‑LED flash, pit‑limiter, flag and low‑fuel appear **only when relevant**.
- 🙈 **Hide + "Hidden" menu** — multi‑select hide/restore for widgets, overlays, dashboards and touch dashes.
- 🗺️ **Interactive 3D nav map** — Waze‑style follow‑cam track map (Three.js) with zoom/rotate/pan and a 2D fallback.
- 🏎️ **Per‑car themes** — Ferrari, Porsche, Mercedes‑AMG, McLaren, Corvette, Lamborghini shift‑lights, clusters, dashboards and touch boxes.
- 🖥️ **58 recreated clean dashboards** — rev‑lights corner‑to‑corner on top, 1024×600, adaptive; **0 render errors across 268 presets**.
- 🌎 **100% American‑English UI** — including the AI engineer / coach / spotter voice; the language switch changes everything.

### Fixed
- Settings persist immediately; the AI Coach map scales with zoom; broadcast/endurance hero fixes; gap color logic; tyre‑temp / gear layout.

_typecheck (node + web) + **2,890 tests** green._

## v2.42.0 — Per‑telemetry hi‑fi widgets, +50 dashboards, tags & adaptive AI 🏎️

Building on the race‑car fidelity rebuild, this release makes **every telemetry channel** its own clean hi‑fi widget/overlay, adds **50+ new 1024×600 dashboards**, and lets a **local AI** curate your dashboard live — all filterable by tags.

### Highlights

- 🧩 **71 per‑telemetry hi‑fi widgets** — one crisp, NaN‑safe SVG per channel (inputs, speed/rpm/gear/rev‑lights, delta/lap/position/time, gaps/relative/standings/radar, fuel, tyres, brakes/engine/electronics, flags/weather/track‑map/G‑force, and **AI coach/engineer** cues). Each doubles as a **floating overlay** and a **dashboard widget**, built from a `gpt‑image` reference and visual‑QA’d until clean.
- 🏁 **+50 hi‑fi 1024×600 dashboards** — race, endurance, AI‑coach and broadcast/minimal themes, composed from the hi‑fi widgets, each **letterboxed so nothing ever clips, overflows or overlaps** at any size.
- 🧠 **AI widgets & AI‑coach dashboards** — live Coach tip/findings, Engineer radio, proactive alerts, strategy call and AI confidence. **Local, CPU‑only, free.**
- 🤖 **Adaptive Dashboard, now AI‑curated** — turn it on and a **local** heuristic AI selects the most relevant widgets for the current race moment (low fuel, hot tyres, a car closing in, pit window…), with sensible category diversity.
- 🏷️ **Tags + multi‑select filtering** — every overlay and dashboard is tagged (sim IR/ACC/AC/AMS2/LMU, category, style) and filterable by **several tags at once** on Overlays, Dashboards and Touch Controls.
- 🎛️ **Hi‑fi Touch Controls** — six new photoreal pit/cockpit/strategy/comms/wheel/endurance panels and new selector/RGB button materials.

### 🧠 Local AI — no GPU, no cost

The **AI Engineer**, **Live/AI Coach**, **lap analysis** and the **adaptive widget selection** run **entirely on your CPU** via CPU‑only `node‑llama‑cpp` — **no GPU, no cloud, no API keys, no per‑use cost**, fully offline.

### Quality gates

- `npm run typecheck` (node + web) ✓
- `npm run test` — **2,854 unit tests passing** ✓
- Dashboard & widget visual‑audit — **0 render errors, 0 overflow, 0 overlap** ✓

### Compatibility

- Windows 10/11 · Electron + React + TypeScript.
- Sims: iRacing, ACC, AC, AMS2, LMU (+ Demo/mock for offline configuration).

---

## v2.41.0 — Race‑car fidelity rebuild 🏁

A ground‑up rework of the dashboards for **real race‑car visual fidelity**, plus streaming to mobile, auto‑update, and an English‑first UI — with the intelligent features staying **local, offline, GPU‑free and free**.

### Highlights

- 🏎️ **Hi‑fi 1024×600 dashboards** — photorealistic **GT3 DDU cockpit**, **MoTeC‑style engineer analysis**, **endurance/IMSA stint**, **broadcast**, and **minimal** clusters. Each was built from a `gpt‑image` reference and **matched pixel‑by‑pixel** (image → build → visual‑QA‑until‑clean), is driven by **live telemetry**, and **adapts** to any screen (1024×600 panel, desktop, phone, tablet). They show em‑dashes for absent telemetry — never fake data.
- 🖼️ **Overlays** — activating an overlay no longer scrolls the page, and the options are now **5 structurally‑distinct forms** (minimal, broadcast, analog, heatmap, neon), not colour‑only tints.
- 📱 **Stream to your phone/tablet** — a built‑in LAN server with **QR code + token + optional password** opens the dashboard (and the Touch Controls Dash) in any mobile browser, responsive to the device.
- ⬆️ **Auto‑update** — automatic updates from GitHub Releases **plus** a manual *Check for updates* button.
- 🌍 **English‑first, deep i18n** — English is the base; switching language localizes screens, descriptions and the AI engineer/voice. Switchable **Português, Deutsch, Français, 中文, Español, 日本語**.
- 🔧 **Fixes** — Settings apply & persist immediately (telemetry source, etc.); the AI Coach map grows/shrinks with zoom; Community ships curated, editable sources per simulator.
- 🧭 **Collapsible sidebar** (`Ctrl/Cmd+B`) and a **new app icon**.

### 🧠 Local AI — no GPU, no cost

The **AI Engineer**, **Live/AI Coach**, and **lap analysis** run **entirely on your CPU** via the CPU‑only `node‑llama‑cpp` backend — **no GPU, no cloud, no API keys, no per‑use cost**, fully offline.

### Quality gates

- `npm run typecheck` ✓
- `npm run test` — **2,798 unit tests passing** ✓
- Dashboard visual‑audit — **0 render errors, 0 overflow, 0 overlap** ✓

### Compatibility

- Windows 10/11 · Electron + React + TypeScript.
- Sims: iRacing, ACC, AC, AMS2, LMU (+ Demo/mock for offline configuration).

---

_Full details in [`CHANGELOG.md`](CHANGELOG.md)._
