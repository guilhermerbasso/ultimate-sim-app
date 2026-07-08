# Ultimate Sim App — Release Notes

## v2.41.0 — Visual rebuild 🏁

A ground‑up rebuild of the visual layer (widgets, overlays, dashboards) and the app UX, plus new languages and a new identity — with the intelligent features staying **local, offline, GPU‑free and free**.

### Highlights

- 🧩 **250+ telemetry widgets** from a *variable × form* factory — every channel as a **bar, vertical bar, gauge, 7‑segment, LED, 32‑bit pixel, ring, tile, or big number** (57 variables × 9 forms = 513 combinations, ≥ 5 forms each).
- 🖼️ **57 overlays**, each in **≥ 5 visual styles** (design families: minimal, neon, glass, broadcast, terminal, bauhaus, analog, heatmap).
- 📊 **200 new dashboards** — 8 generic car families × 5 layouts (DDU cockpit, engineer wall, endurance, strategy, broadcast) × 5 resolutions, each with ≥ 5 distinct telemetry variables.
- 🏎️ **Car‑context theming** with original, trademark‑free codename liveries: Woking, Maranello, Gaydon, Stuttgart, Bowtie, Affalterbach, Ingolstadt, and a Le Mans/IMSA‑style Prototype.
- 🧭 **Collapsible sidebar** (icon‑only rail, `Ctrl/Cmd+B`, remembered), refreshed image‑driven menu, and a **new app icon**.
- 🌍 **English is now the primary language**, with **Português, Deutsch, Français, 中文, Español, 日本語** switchable in Settings.

### 🧠 Local AI — no GPU, no cost

The **AI Engineer**, **Live/AI Coach**, and **lap analysis** run **entirely on your CPU** via the CPU‑only `node‑llama‑cpp` backend — **no GPU required, no cloud, no API keys, and no per‑use cost**, fully offline.

### Fixes

- Absent telemetry no longer shows false *critical* alerts for inverted variables (fuel/wear/grip).
- Overlays can no longer overflow their declared bounds.
- Dashboard presets build a fresh deep clone per instantiation (no shared‑object mutation).

### Quality gates

- `npm run typecheck` ✓
- `npm run test` — **2,789 unit tests passing** ✓
- `npm run build` ✓
- Dashboard visual‑audit — **0 render errors, 0 overflow, 0 overlap** across 405 preset renders ✓

### Compatibility

- Windows 10/11 · Electron + React + TypeScript.
- Sims: iRacing, ACC, AC, AMS2, LMU (+ Demo/mock for offline configuration).

---

_Full details in [`CHANGELOG.md`](CHANGELOG.md)._
