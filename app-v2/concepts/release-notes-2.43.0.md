# v2.43.0 — Clean v4: title-less widgets, trigger overlays, 3D nav map, themed cars 🏁

Consolidated release (supersedes the 2.42.0 draft). Every new visual asset was built with the mandated flow: a validated American-English `gpt-image` prompt → reference image → image QA → build → visual QA against the reference until clean.

## Highlights

- 🧼 **Clean, title-less widgets & overlays** — transparent, borderless, self-explanatory (just `P4`, no "Position" label), legible over any background via a dark text-outline, and still fully editable (color/size/font/position + conditional color).
- 🚨 **Trigger-only spotter overlays** — car-left / car-right arrows, radar-on-proximity (< 0.5 s), shift-LED flash, pit-limiter, flag alert and low-fuel appear **only when their condition fires** (works in both the default per-window runtime and the compositor).
- 🙈 **Hide + "Hidden" menu** — multi-select hide/restore for widgets, overlays, dashboards and touch dashes; hidden items leave the lists (and the compositor) but are never deleted.
- 🗺️ **Interactive 3D nav map** — a Waze / Google-Maps-style track map (Three.js): follow-camera track-up, live zoom, drag-rotate/pan and recenter, with a 2D SVG fallback where WebGL is unavailable.
- 🏎️ **Per-car themes** — Ferrari, Porsche, Mercedes-AMG, McLaren, Corvette and Lamborghini shift-light signatures, cluster signatures, dashboards and touch button-boxes.
- 🖥️ **58 recreated clean dashboards** — race / endurance / coach / family rebuilt to the clean premise with a rev-lights strip corner-to-corner across the top, authored at 1024×600 and adaptive to any display; broadcast/endurance hero fixes. **0 render errors across 268 presets.**
- 🎛️ **Touch Controls** — new rocker + LED-ring button styles, preset tags, and per-car themed button-boxes.
- 💡 **More rev-lights** — gradient bar, dense LED strip, LED bar with a blue over-rev, and a centered Mustang-style cluster.
- 🌎 **100% American-English UI** — a deep i18n sweep translates every screen, description, widget/overlay/dashboard and the **AI engineer / coach / spotter voice**; switching language changes everything.

## 🧠 Local AI — no GPU, no cost

The **AI Engineer**, **Live/AI Coach** and **lap analysis** run entirely on your CPU via CPU-only `node-llama-cpp` — **no GPU, no cloud, no API keys, no per-use cost**, fully offline.

## Fixed

- Settings now **persist immediately** (default telemetry/sim and all settings stick across restarts).
- The **AI Coach map grows/shrinks with the zoom level** instead of always taking the whole screen.
- Broadcast hero no longer has an empty middle; endurance delta no longer overflows; gap ahead/behind uses green = gaining / red = losing (no title/arrow); tyre-temp °C no longer overlaps the value; gear is no longer clipped.

## Also included (from the fidelity rebuild)

- Stream any dashboard **and** the Touch Controls Dash to a phone/tablet browser via a LAN server with **QR code + token + optional password**, responsive to the device screen.
- **Auto-update** from GitHub Releases plus a manual "Check for updates".
- **Community** ships curated, editable telemetry/setup sources per simulator (iRacing / ACC / AC / AMS2 / LMU).

---

_Verified: `typecheck` (node + web) + **2,890 unit tests** green; dashboard visual-audit **0 render errors / overflow / overlap** across 268 presets._

> **Note:** This is a **draft**. Review, then build and attach the Windows installer (`npm run dist:win` in `app-v2`) before publishing.
