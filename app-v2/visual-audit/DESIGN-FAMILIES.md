# Overlay Design Families

> Foundation spec for the overlay redesign fleet. **This document defines the
> system — it does not redesign any widget yet.**

A **style preset** only swaps the surface *colors* (`OverlayWidgetStyle`:
`background`, `accent`, `border`, `radius`, `fontFamily`). A **design family**
swaps the *layout + typography language*, so a widget can render **structurally**
different per family (a gauge vs a bar vs a bracketed readout) while still reading
its colors from the resolved preset.

Source of truth lives in `src/shared/overlays.ts`:

- `OverlayDesignFamily` — the 8-way union (derived from `OVERLAY_DESIGN_FAMILIES`).
- `OVERLAY_DESIGN_FAMILIES` — ordered list for pickers / harness / redesign.
- `OVERLAY_DESIGN_FAMILY_SPECS` — machine-readable mirror of this document.
- `OVERLAY_PRESET_FAMILY` — total `Record<OverlayStylePresetId, OverlayDesignFamily>`
  mapping for all 34 presets (adding/removing a preset without a family is a
  compile error).
- `overlayDesignFamily(presetId?)` — resolves a preset id to its family; unknown /
  missing ids fall back to the default preset's family (`minimal`).

Widgets should branch on `overlayDesignFamily(config.stylePreset)` rather than raw
preset ids, so every preset in a family inherits a redesigned layout for free.

---

## Global color-role rule

Gui's rule, applied by **every** family:

- **Warm tokens (red / orange / amber) carry chrome** — accents, highlights,
  redline/limit, attention and "hot" telemetry.
- **Cool / green / blue are reserved for a genuinely positive "good" state** —
  faster delta, full battery/charge, dry track, optimal shift band, radar clear.
  Never use cool hues as default chrome.
- **Neutral metallics (silver, steel, gold, gray) are allowed as quiet chrome** —
  it is the *saturated* cool hues that signal "good".

---

## The 8 families

### `minimal` — Minimal
*Restrained telemetry that gets out of the way.*

- **Layout** — one value per line, hairline dividers, generous negative space, muted labels.
- **Typography** — Segoe UI; regular body, light/medium labels, tabular numerals.
- **Shape / treatment** — soft 12–20px radius, near-flat panels, single hairline border, no glow.
- **Motion restraint** — opacity / cross-fade only; chrome never pulses.
- **When it shines** — long stints, road & GT cockpits, drivers who want telemetry that disappears.
- **Color role** — mono surface + one warm accent on the live value; neutral grays as chrome; cool/green only on a confirmed good state.

### `neon` — Neon
*Glowing cyber HUD for the dark.*

- **Layout** — floating HUD segments, ring/bar emphasis, vector linework over a dark void, sparse text.
- **Typography** — Bahnschrift/condensed big numbers + monospace tags/units, uppercase accents.
- **Shape / treatment** — emissive strokes, segmented arcs, scanline/grid hints, glowing borders, medium radius.
- **Motion restraint** — glow pulse on threshold (shift/limit) only; steady otherwise.
- **When it shines** — night races, futuristic builds, streamers who want spectacle.
- **Color role** — hot orange/red/amber emission for chrome + redline; cyan/green glow **only** for a positive event (good shift, gain, clear).

### `glass` — Glass
*Frosted depth that floats over anything.*

- **Layout** — layered translucent cards, soft shadow depth, content floats over a blurred backdrop.
- **Typography** — Segoe UI light/regular, airy letter-spacing, low-opacity labels.
- **Shape / treatment** — large 22–30px radius, frosted low-alpha fill, bright thin top edge, soft inner glow.
- **Motion restraint** — gentle fade/parallax; specular shift on alert; no hard flashes.
- **When it shines** — premium overlays over varied backgrounds, demo & show-car builds.
- **Color role** — warm accent tints the frost; a cool/blue frost tint is reserved to signal a genuinely good/optimal state.

### `broadcast` — Broadcast
*TV lower-third legible from across the room.*

- **Layout** — horizontal lower-thirds, boxed label+value cells, strong baseline grid, position/gap chips.
- **Typography** — DIN Condensed/Bahnschrift, bold uppercase labels, condensed numerics, max legibility.
- **Shape / treatment** — small 6–12px radius, solid filled blocks, colored label tab + value field, thick separators.
- **Motion restraint** — slide-in / clip reveal like a TV bug; no idle motion.
- **When it shines** — streaming, spectating, multiclass standings & relative at distance.
- **Color role** — warm accent on label tabs + live highlights; cool/green only on a "good" chip (P-gain, faster, clear).

### `terminal` — Terminal
*Bracketed monospace readout, CRT cockpit.*

- **Layout** — fixed-width rows, bracketed `[fields]`, column-aligned `key:value`, ASCII/box-drawing rules.
- **Typography** — monospace (Cascadia/Consolas), uppercase keys, everything tabular.
- **Shape / treatment** — near-zero radius, thin mono border, CRT scan tint, brackets & dividers instead of fills.
- **Motion restraint** — caret blink / typewriter reveal at most; otherwise static.
- **When it shines** — data/debug overlays, retro cockpits, drivers who like dense readouts.
- **Color role** — amber/orange phosphor on near-black; green phosphor **only** for an OK/good status line; red for limits.

### `bauhaus` — Bauhaus
*Geometric blocks and one giant number.*

- **Layout** — hard modular grid of colored blocks, one giant focal value, primary shapes (circle/square/triangle) as indicators.
- **Typography** — heavy display (Impact/Arial Narrow), oversized numerics, ALL-CAPS short labels.
- **Shape / treatment** — zero radius, flat saturated blocks, thick rules, aggressive diagonal cuts.
- **Motion restraint** — snap / step changes, instant state flips, no easing.
- **When it shines** — bold single-metric overlays (gear, rev, flag), poster-like dashboards.
- **Color role** — primary warm blocks carry chrome + alerts; a blue/green block only for a confirmed good state.

### `analog` — Analog
*Skeuomorphic dials, needles and sweeps.*

- **Layout** — circular dials, needles/arcs, tick rings, sub-readouts in the dial face, radar/sweep variants.
- **Typography** — Bahnschrift/Segoe dial numerals, engraved-style labels, centered readouts.
- **Shape / treatment** — round bezels, beveled depth, needle + tick marks, metallic/bronze chrome.
- **Motion restraint** — smooth needle sweep with inertia; no flashing.
- **When it shines** — rev/speed/fuel gauges, radar & relative position, heritage cockpit looks.
- **Color role** — warm needle/redline arc + chrome bezel; a green/blue zone **only** for the healthy/optimal band (clear radar, good shift band).

### `heatmap` — Heatmap
*Data-dense cells coded cold-to-hot.*

- **Layout** — tightly packed grids/cells/bars, every channel visible at once, numeric label per cell.
- **Typography** — Bahnschrift/condensed tabular numerals, tiny dense labels, high info density.
- **Shape / treatment** — small radius, filled cells/tiles, intensity-mapped fills, segmented bars, mesh.
- **Motion restraint** — cells re-color in place; no layout movement.
- **When it shines** — tyres/brakes/pressures, multi-channel telemetry, race engineers.
- **Color role** — cold→hot ramp where HOT (orange/red) = high/attention and COOL (blue/green) = low/in-range (the genuinely good state); the one place a gradient is allowed, still anchored by good=cool / hot=warn.

---

## Preset → family mapping (all 34)

The 8 namesake presets are the **archetype** of each family; the remaining color
variants are grouped by their closest design language.

| Preset id | Family | Why |
|---|---|---|
| `minimal` | `minimal` | archetype |
| `neon` | `neon` | archetype |
| `glass` | `glass` | archetype |
| `broadcast` | `broadcast` | archetype |
| `terminal` | `terminal` | archetype |
| `bauhaus` | `bauhaus` | archetype |
| `analog` | `analog` | archetype |
| `heatmap` | `heatmap` | archetype |
| `race` | `broadcast` | DIN-condensed race TV, compact alert-red bars |
| `carbon` | `broadcast` | brushed-steel structural panels, boxy + solid |
| `gulf` | `broadcast` | endurance livery, lower-third spectating vibe |
| `lemans` | `analog` | heritage endurance, bronze, classic instrument feel |
| `stealth` | `minimal` | tactical restraint, minimal border, no distraction |
| `amber` | `analog` | GT cockpit instrument cluster, dense dial panel |
| `apexIgnition` | `neon` | glowing ignition HUD rings + redline alert |
| `ionEmber` | `glass` | dark glass surface, blue shift-flash |
| `vectorPulse` | `neon` | glowing vector pulse lines for textless gauges |
| `cinderGlass` | `glass` | translucent smoke / frosted glass |
| `thermalGhost` | `heatmap` | near-invisible surface, thermal telemetry glow |
| `emberCircuit` | `neon` | electronic circuit grid, segmented bars + chips |
| `radarClear` | `analog` | circular radar sweep, green reserved for clear |
| `orangeCore` | `neon` | glowing hot core with thick emissive rings |
| `pitWallHolo` | `neon` | holographic technical pit-wall HUD |
| `blackGold` | `minimal` | premium restraint, warm gold accent |
| `redlineVoid` | `bauhaus` | aggressive geometric cutouts, limit-red blocks |
| `amberVector` | `neon` | amber geometric vector linework |
| `copperMesh` | `heatmap` | copper mesh grids for tyre/brake cells |
| `moltenCarbon` | `broadcast` | structural carbon, deep boxy borders |
| `safetyGreen` | `analog` | radar instrument, green = healthy/clear state |
| `laserGrid` | `neon` | laser cyber grid, segmented mono marks |
| `solarFlare` | `analog` | circular gauges with high-energy flare |
| `obsidianRing` | `analog` | thin circular rings / minimal gauge dial |
| `brakeGlow` | `heatmap` | brake heat tiles, hot-cell alerts |
| `nightStint` | `minimal` | low-intrusion soft restraint, night stint |

### Family tally

| Family | Count | Presets |
|---|---|---|
| `minimal` | 4 | minimal, stealth, blackGold, nightStint |
| `neon` | 8 | neon, apexIgnition, vectorPulse, emberCircuit, orangeCore, pitWallHolo, amberVector, laserGrid |
| `glass` | 3 | glass, ionEmber, cinderGlass |
| `broadcast` | 5 | broadcast, race, carbon, gulf, moltenCarbon |
| `terminal` | 1 | terminal |
| `bauhaus` | 2 | bauhaus, redlineVoid |
| `analog` | 7 | analog, lemans, amber, radarClear, safetyGreen, solarFlare, obsidianRing |
| `heatmap` | 4 | heatmap, thermalGhost, copperMesh, brakeGlow |
| **Total** | **34** | |

> Note: the 4 families already branched on by today's widgets
> (`terminal`, `bauhaus`, `analog`, `heatmap`) keep their namesake preset as the
> archetype, so swapping widget branches from `stylePreset === 'terminal'` to
> `overlayDesignFamily(stylePreset) === 'terminal'` is behavior-preserving and
> simply *extends* each layout to the rest of that family.
