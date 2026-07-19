# Ultimate Sim App — Release Notes

## v2.54.0 — Managed streaming, secure Internet sharing & offline Mission Rehearsal

Version 2.54.0 makes it easier to choose what spectators see, open a secure public viewer without
manual tunnel setup, and rehearse race operations without touching a live session.

### Streaming targets you control
- 📺 **A dedicated Streaming area** stores the dashboard and Touch Controls targets you choose
  instead of making you rediscover them for each session.
- ✏️ **Edited dashboard copies stay streamable** after migration and restart, while exact built-in
  presets remain distinguishable from your customized versions.
- 🔒 Streaming remains read-only; this release does not add remote control of the app or simulator.

### Secure Internet sharing
- 🌐 **Internet mode can open its secure public HTTPS viewer automatically** through the bundled,
  checksum-verified Cloudflare quick tunnel, including password/token bootstrap and authenticated
  receiver readiness.
- 🩺 **Clear health diagnostics and supervised recovery** prevent stale public URLs, clean up old
  tunnel processes, and reconnect with bounded retries.
- 🏠 Local and LAN streaming continue to work independently of the Internet tunnel.

### Offline Mission Rehearsal
- 🏁 **Build and run branching race-operation scenarios offline** with assigned roles, checkpoints,
  deterministic decisions, resumable runs, and archive recovery.
- 📊 **Compare repeat attempts and review scored, blameless debriefs** without needing a simulator
  session or a cloud service.
- 🧱 Synthetic rehearsal events never enter real telemetry or session history, and rehearsal
  decisions cannot actuate live race controls.

### Validation
- Full test suite: **3,945 tests passing across 308 files. Typecheck clean.**
- Merged-feature suite: **142 tests passing across 11 files**; updater/package release gate:
  **5 tests passing**.
- Production build: **349 main-process modules, 8 preload modules, and 2,348 renderer modules**;
  the **48-file streaming resource graph** passes with 22 JavaScript and 5 CSS files.
- The final `npm run dist:win` and `npm run verify:win-package` runs passed. Packaging used the
  documented fallback for the optional ViGEm module because the host has no Visual Studio Build
  Tools.
- The verifier accepted the unpacked Electron runtime, elevated NSIS helper, packaged SerialPort,
  Cloudflare tunnel, Whisper runtime, and the exact four updater artifacts. `latest.yml` identifies
  `Ultimate-Sim-App-2.54.0-x64.exe` at **317,890,721 bytes** with its matching SHA-512 and
  `isAdminRightsRequired: true`.

_Release artifacts: `Ultimate-Sim-App-2.54.0-x64.exe` (NSIS, x64) + portable `.zip` + blockmap +
`latest.yml`._

### What's Changed
- [#71](https://github.com/guilhermerbasso/ultimate-sim-app/pull/71) — add persistent,
  user-managed dashboard and Touch Controls streaming targets.
- [#72](https://github.com/guilhermerbasso/ultimate-sim-app/pull/72) — restore and harden secure
  Internet auto-tunnel streaming.
- [#73](https://github.com/guilhermerbasso/ultimate-sim-app/pull/73) — add offline Mission
  Rehearsal with isolated synthetic events and recovery-safe runs.

**Full Changelog:** https://github.com/guilhermerbasso/ultimate-sim-app/compare/v2.53.1...v2.54.0

## v2.53.1 — SerialPort startup hotfix

Version 2.53.1 fixes the JavaScript error shown immediately after installing v2.53.0:
Electron could not resolve `serialport` from the packaged `app.asar`.

### Fixed
- The main process now loads SerialPort through an ASAR-aware CommonJS `createRequire` bridge,
  avoiding Electron's failing ESM resolution for the unpacked native package.
- Windows package verification now inspects the packaged main bundle, resolves SerialPort with the
  packaged Electron runtime, and fails the release when the bridge or native binding is unusable.

### Upgrade
Install `Ultimate-Sim-App-2.53.1-x64.exe` over v2.53.0. User settings and saved data remain in the
separate app-data directory.

**Full Changelog:** https://github.com/guilhermerbasso/ultimate-sim-app/compare/v2.53.0...v2.53.1

## v2.53.0 — Restart-safe dashboards, telemetry truth & governed visual foundations

Release 2.53 focuses on trustworthy race data and dependable saved dashboards. It fixes the
reported black-dashboard-after-restart failure, aligns fuel and alert behavior across every visual
surface, and ships the governance foundations for the next visual program without presenting
planned dashboards or images as finished work.

### Highlights
- 🖥️ **Saved dashboards restore safely after restart** — every supported element, including
  `overlaywidget` compositions, survives canonical validation and legacy migration. Invalid files
  are preserved in quarantine, replacement is atomic, and storage/render failures surface
  diagnostics instead of a black window.
- ⛽ **Litre-canonical fuel truth** — fuel range and fuel-to-finish use litres consistently, while
  startup, partial, and refuelling laps no longer pollute the consumption average.
- 🚨 **One alert policy on every surface** — serialized configuration and shared trigger logic keep
  Alerts, overlays, dashboards, and widgets aligned. Shift Point uses native shift state or
  RPM/max-RPM and respects disabled policies and simulator coverage.
- 🧭 **Telemetry provenance is explicit** — engine map is distinct from throttle map, garage cold
  pressure is not shown as live tyre pressure, and opponent steering remains unsupported rather
  than synthesized.
- 🧪 **Governed visual foundations** — PRs #60, #61, and #63 add an immutable 50-dashboard brief
  portfolio, structural/perceptual clone rejection, and a 143-concept registry with 142 currently
  visualizable concepts plus 45 trigger-only families.

### In development — not included in this release
- The separate Phase 02 program targets **50 newly produced dashboards and 16,600 individually
  evidenced visual artifacts**.
- Version 2.53.0 includes the briefs, registry, provenance, and quality gates only. It does **not**
  ship those generated reference images or completed dashboard outputs.

### Reliability and compatibility
- Persisted dashboard operations are serialized and race-safe across load failures, renderer
  crashes, queued opens, close/delete, and concurrent saves.
- Newest configuration wins during hydration, while telemetry disconnect/reconnect emissions stay
  ordered; persisted revisions remain monotonic even with clock rollback or future-dated files.
- Windows 10/11 x64 remains the supported release target. iRacing has the deepest normalized
  telemetry; other simulator coverage varies by provider.
- Full-profile import remains disabled for configuration safety; per-section import/export and
  full-profile export remain available.

### Validation
- Full test suite: **3,821 tests passing across 295 files. Typecheck clean.**
- Updater/package metadata contract: **3 targeted tests passing**.
- Current React view harness: **34/34 real UI captures**, with no render-boundary failures.
- Production GT3 dashboard renderer: targeted Endurance Stint Core capture passes.
- Production build and the **47-file streaming resource graph** pass.

_Release artifact names: `Ultimate-Sim-App-2.53.0-x64.exe` (NSIS, x64) + portable `.zip` + blockmap + `latest.yml`._

### What's Changed
- [#60](https://github.com/guilhermerbasso/ultimate-sim-app/pull/60) — add the immutable 50-dashboard portfolio registry (foundation only).
- [#61](https://github.com/guilhermerbasso/ultimate-sim-app/pull/61) — enforce structural and perceptual dashboard differentiation (foundation only).
- [#62](https://github.com/guilhermerbasso/ultimate-sim-app/pull/62) — align runtime fuel, pressure, map, Shift Point, and alert truth.
- [#63](https://github.com/guilhermerbasso/ultimate-sim-app/pull/63) — add the governed telemetry and trigger-only registries (foundation only).
- [#64](https://github.com/guilhermerbasso/ultimate-sim-app/pull/64) — restore saved dashboard windows safely after restart.

**Full Changelog:** https://github.com/guilhermerbasso/ultimate-sim-app/compare/v2.52.0...v2.53.0

## v2.52.0 — Semantic controls, expression destinations, secure streaming & synchronized speech

Release 2.52 brings the Release B foundations into the Windows app: richer cockpit controls,
explicit destinations for custom telemetry, safer browser streaming, temporal race alerts, and
speech that stays aligned with the selected language.

### Highlights
- 🎛️ **Touch Controls schema v2** — momentary, latching toggle, rocker, guarded two-step,
  rotary, selector, status LED, and value-tile controls with expression-driven states,
  accessibility, multi-touch ownership, and deterministic key release.
- 📊 **Expression visualization destinations** — place a custom expression or mapped iRacing
  variable on a selected dashboard or custom overlay as a value, bar, gauge, or status.
- 🔐 **Secure streaming sessions** — HttpOnly viewers, authentication throttling, prefix-safe
  resource discovery, capacity isolation, HTTPS-only Internet exposure, and fail-closed browser
  controls.
- 🚨 **Temporal trigger-only overlays** — pace-car, pits-open, DRS, pit service, repairs,
  precipitation/wetness/fog, proximity, incidents, race-control flags, pit limiter, low fuel, and
  other alerts appear only while relevant or for their configured pulse/TTL.
- 🗣️ **Language-correct speech** — Spotter, Coach, Engineer, previews, and Stint Debrief now keep
  spoken copy synchronized with the selected language and cancel stale audio on language changes.
- 🧼 **Visual reliability** — 19 release-blocking widget targets were corrected across validated
  telemetry states, and steady green no longer triggers a race-control warning.

### Reliability and compatibility
- Expression imports are transactional and revision-checked; deletion tombstones, unsaved drafts,
  legacy route state, and duplicate-name output recency are preserved.
- Touch key holds/latches release on unmount, close, reload, navigation, renderer loss, live edits,
  disabled-state transitions, and app teardown.
- Packaged streaming verifies nested JavaScript/CSS resources, dynamic imports, preloads, and
  browser-tolerated script closing tags.
- Windows 10/11 x64 · Electron + React + TypeScript · local-first Coach/Engineer/TTS.

### Validation
- Full test suite: **3,683 tests passing. Typecheck clean.**
- Production build and the **47-file streaming resource graph** pass.
- Windows packaging is verified before all four updater artifacts are attached.

_Installer: `Ultimate-Sim-App-2.52.0-x64.exe` (NSIS, x64) + portable `.zip` + blockmap + `latest.yml`._

### What's Changed
- [#54](https://github.com/guilhermerbasso/ultimate-sim-app/pull/54) — repair release-blocking widget clipping and overflow.
- [#56](https://github.com/guilhermerbasso/ultimate-sim-app/pull/56) — add temporal trigger-only overlay lifecycles.
- [#57](https://github.com/guilhermerbasso/ultimate-sim-app/pull/57) — exclude steady green from race-control alerts.
- [#55](https://github.com/guilhermerbasso/ultimate-sim-app/pull/55) — synchronize spoken text with the selected language.
- [#58](https://github.com/guilhermerbasso/ultimate-sim-app/pull/58) — add Expression destinations, semantic Touch Controls, and secure streaming foundations.

**Full Changelog:** https://github.com/guilhermerbasso/ultimate-sim-app/compare/v2.50.0...v2.52.0

## v2.44.0 — v5: real-dash car themes + more iRacing widgets (Windows .exe restored) 🏎️

Consolidates the v5 work from PR #15 and **fixes the Windows installer pipeline** so every release ships a working `.exe` again.

### Highlights
- 🏎️ **Real-dashboard car themes** — reference-matched dashboards, full-dash overlays and single-info widgets for a fleet of endurance/GT3/Cup cars (Ferrari 488 Challenge & 296 GT3, Aston Martin Vantage & GT3, Mercedes-AMG One & GT Track Series, Porsche 911 GT3 Cup, Mustang GTD, Corvette Z06 GT3.R, Lamborghini Huracán GT3, McLaren 720S, Le Mans/WEC prototype).
- 🧩 **More iRacing widgets & overlays** — new telemetry channels and visual styles, each validated against a `gpt-image` reference and QA'd until clean.
- 🖥️ **Windows `.exe` restored** — the v2.43.0 release build failed because electron-builder tried to implicitly publish on the tag without a `GH_TOKEN`; fixed with `--publish never` so the workflow attaches the installer.
- 📖 **New consolidated README** — full English feature catalog with screenshots.
- ⚙️ **CI on Node 24** and **automated Copilot QA** on pull requests.

_Installer: `Ultimate Sim App-2.44.0-x64.exe` (NSIS, x64) + portable `.zip`._

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
