# Ultimate Sim App — Release Notes

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
