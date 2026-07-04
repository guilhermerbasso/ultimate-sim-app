# GT3 Dashboard Design Spec

## Scope and copyright guardrail

Design **original, generic GT3-style** widgets and presets for the Dashboards module. The goal is to capture common motorsport functional language—segmented RPM/shift lights, large central gear, dark carbon panels, color-coded telemetry clusters, warning overlays—without copying AMG, Porsche, BMW, Ferrari, Audi, MoTeC, Bosch, Cosworth, SimHub, RaceLab, or any other specific copyrighted artwork, layout, logos, type treatments, or skins.

This document is implementation-ready for adding new widgets, richer preset dashboards, and editor UX improvements. It intentionally does **not** modify source code.

---

## 1. Current system inventory

### Current dashboard model

- `DashboardElementType` currently supports: `text`, `rect`, `bar`, `barv`, `dualbar`, `deltabar`, `gauge`, `shiftlights`, `map`, `radar`, `image`, `table`, `standings`, `flag`, `trace` (`src/shared/dashboards.ts:17-32`).
- Dashboard elements use absolute pixel geometry (`x`, `y`, `w`, `h`), optional `binding`, `style`, `name`, visibility, and source metadata (`src/shared/dashboards.ts:90-103`).
- Dashboards have `width`, `height`, `bg`, `elements`, `scaleMode`, and optional metadata/preview (`src/shared/dashboards.ts:105-124`).
- Style supports generic visual controls: background, border, radius, color, font, fill/warn/danger colors, thresholds, segments, image fit/opacity, secondary binding/color, delta range, flag key, trace config, table columns, row count, and vertical bar reverse (`src/shared/dashboards.ts:38-88`).

### Current editor behavior

- The editor exposes element add buttons for all current element types with labels: Texto, Retângulo, Barra, Barra vertical, Dualbar, Delta bar, Gauge, Shift LEDs, Mapa, Radar, Imagem, Bandeira, Trace, Tabela, Standings (`src/renderer/src/views/DashboardsView.tsx:21-37`).
- New elements are created by `addElement(type)`, which builds a default element, selects it, and appends it to the selected dashboard (`src/renderer/src/views/DashboardsView.tsx:289-297`).
- Default styles exist per element type, including basic bars, dualbar, deltabar, gauge, shiftlights, map, radar, image, flag, trace, table, and standings (`src/renderer/src/views/DashboardsView.tsx:81-128`).
- Default sizes are simple and generic; e.g. shiftlights are 48px high, bars 24px, vertical bars 32×160, tables 520×280 (`src/renderer/src/views/DashboardsView.tsx:130-172`).
- The editor already has snap-to-grid enabled by default, configurable step, and static preview canvas (`src/renderer/src/views/DashboardsView.tsx:175-188`, `src/renderer/src/views/DashboardsView.tsx:681-737`).
- The inspector exposes geometry, nudge controls, z-order, binding select, text settings, common style fields, thresholds, shiftlight segments, vertical direction, dualbar secondary binding, deltabar range, trace settings, image URL/fit/opacity, flag key, and table columns (`src/renderer/src/views/DashboardsView.tsx:1000-1288`).

### Current runtime renderers

- Runtime dispatch maps `element.type` to renderers for every current type (`src/renderer/src/dashboard/DashboardRoot.tsx:920-955`).
- `bar` renders a horizontal percentage fill based on `resolveBinding(...).pct` (`src/renderer/src/dashboard/DashboardRoot.tsx:89-120`).
- `shiftlights` renders configurable segments and color thresholds with `shiftPct` default (`src/renderer/src/dashboard/DashboardRoot.tsx:122-165`).
- `barv`, `dualbar`, `deltabar`, `flag`, `trace`, and `table/standings` are implemented as dedicated renderers (`src/renderer/src/dashboard/DashboardRoot.tsx:519-850`).
- `deltabar` maps a signed delta around center, green when negative/faster and red when positive/slower (`src/renderer/src/dashboard/DashboardRoot.tsx:590-625`).
- `table/standings` supports columns `pos`, `classPos`, `number`, `name`, `gap`, `class`, `license`, `iRating`, `laps`, sorted by position and optionally centered around the player (`src/renderer/src/dashboard/DashboardRoot.tsx:751-850`).

### Current bindings exposed in UI

`DASHBOARD_BINDINGS` currently exposes the following (`src/shared/dashboards.ts:168-216`):

- Car: `speedKmh`, `rpm`, `rpmPct`, `shiftPct`, `gear`, `gearLabel`, `speedMph`.
- Inputs: `throttle`, `brake`, `clutch`, `throttleBrake`.
- Assists: `absActive`, `tcActive`, `drs`.
- Session: `currentLap`, `lapsRemaining`, `currentLapFmt`, `lastLapFmt`, `bestLapFmt`, `deltaBestFmt`, `deltaSessionBestFmt`, `sessionTimeLeftFmt`, `position`, `classPosition`, `totalCars`, `incidentCount`, `inPits`, `pitLimiter`.
- Fuel: `fuelLiters`, `fuelLitersStr`, `fuelPerLap`, `fuelPerLapStr`, `fuelLapsLeftStr`, `fuelPct`.
- Weather: `trackTempC`, `airTempC`.
- Relative: `gapAhead`, `gapBehind`, `gapAheadFmt`, `gapBehindFmt`, `driversCount`.
- Flags: `flagAny`, `flagColor`, `flagLabel`.

### Current binding resolver behavior

- Direct snapshot bindings include speed, rpm, gear, inputs, steering angle, lap/session/time/delta, fuel, incidents, track/air temperature, wetness, and grip (`src/renderer/src/dashboard/binding.ts:271-280`).
- Derived bindings include `gearLabel`, `rpmPct`, `shiftPct`, `fuelPct`, formatted fuel/lap times/deltas, gaps ahead/behind, `throttleBrake`, flag state/color/label, pit state, drivers count, mph, ABS/TC/DRS (`src/renderer/src/dashboard/binding.ts:317-420`).
- Generic routed output/expression bindings exist through `var:<name>`, `expr:<name>`, and `expr:#<exprId>` (`src/renderer/src/dashboard/binding.ts:288-308`). This is important for future missing telemetry values.

### TelemetrySnapshot fields available today

- Car: `speedKmh`, `rpm`, `gear`, `maxRpm`, `shiftIndicatorPct`, `throttle`, `brake`, `clutch`, `steerAngleDeg`, `drs`, `absActive`, `tcActive` (`src/shared/telemetry.ts:59-71`).
- Session/time: `sessionType`, `carName`, `trackName`, `sessionTimeRemainingSec`, `lapsRemaining`, `currentLap`, `lapDistPct`, `lastLapTimeSec`, `bestLapTimeSec`, `currentLapTimeSec`, `estimatedLapTimeSec`, `deltaToBestSec`, `deltaToSessionBestSec`, `position`, `classPosition`, `totalCars`, `strengthOfField` (`src/shared/telemetry.ts:73-90`).
- Fuel: `fuelLiters`, `fuelPerLap`, `fuelCapacityLiters` (`src/shared/telemetry.ts:92-95`).
- Tyres/brakes: `tyres?: Corners<TyreInfo>`, `brakeTempC?: Corners<number>` (`src/shared/telemetry.ts:97-99`), where `TyreInfo` has `tempC`, `pressureKpa`, and `wearPct` (`src/shared/telemetry.ts:15-19`).
- Flags/pit/incidents: `flags`, `pitLimiter`, `onPitRoad`, `pitServiceFlags`, `incidentCount`, `incidentLimit`, `fastRepairsUsed`, `fastRepairsAvailable` (`src/shared/telemetry.ts:101-109`).
- Weather/rain: `trackTempC`, `airTempC`, `trackWetnessPct`, `isRaining`, `gripPct` (`src/shared/telemetry.ts:111-116`).
- Relative/standings: `playerCarIdx`, `drivers` (`src/shared/telemetry.ts:118-120`). Driver entries include position, class position, class color, gap, lap distance, laps behind, iRating/license, and pit state (`src/shared/telemetry.ts:35-52`).
- Track map seed fields: `lat`, `lon`, `velocityX`, `velocityY`, `yawNorth` (`src/shared/telemetry.ts:122-129`).

### Existing presets

Current built-ins are generic race/strategy/minimal variants, not GT3-authentic styles: Race 1024×600, Endurance 1024×600, Qualy 1024×600, Minimal 1024×600, Cockpit Pro 1920×1080, Strategy 1920×1080, Minimal Race 1280×720, Fuel Strategy 1280×800, Portrait 600×1024 (`src/shared/dashboards.ts:1493-1502`).

### Gaps versus realistic GT3 dashboards

1. **Too generic:** current widgets are primitives, not prebuilt semantic motorsport widgets.
2. **No widget presets:** users must assemble gear/speed/fuel/tyre layouts manually from primitive text/bar elements.
3. **Limited tyre/brake support:** `TelemetrySnapshot` has tyre and brake corner fields, but UI bindings do not expose corner-specific values (`src/shared/telemetry.ts:97-99`, `src/shared/dashboards.ts:168-216`).
4. **No GT3 setup controls:** TC/ABS are only active booleans, not levels/settings; brake bias, engine map, ECU map, tyre compound, and brake migration are missing.
5. **No race-control page logic:** flags exist, but there is no full-screen or priority warning mode beyond one flag element.
6. **Weak shift behavior:** `shiftlights` is segmented, but no configurable flash zone, blue/purple final flash, per-gear thresholds, or pit limiter mode.
7. **No prebuilt clusters:** no central gear+speed tile, tyre/brake matrix, fuel calculator, stint panel, sector panel, or relative compact list as single ready-to-use widgets.
8. **Editor is functional but not intuitive:** add buttons are flat text, preview is static, and configuration is generic rather than widget-specific.

---

## 2. Research summary: GT3 functional language

Sources consulted:

- SimHub dashboard template community: https://www.simhubdash.com/community-2/dashboard-templates/ — community dashboards emphasize reusable visual templates and shareable dash layouts.
- RaceLab app: https://racelab.app/ — sim-racing overlays commonly package relative standings, fuel, delta, input telemetry, and dashboard widgets as ready-to-use overlays.
- Web research on GT3 cockpit dashboards and Porsche 911 GT3 R-style racing displays found recurring patterns: large central gear, progressive shift LEDs with flash at shift point, speed beneath/near gear, lap/delta data, tyre information, engine/TC/MAP settings, and multiple race/quali pages.
- Web research on Bosch DDU GT3 displays found common motorsport display capabilities: configurable RGB LEDs, gear/RPM pages, multiple configurable display pages, warnings, logging, and robust motorsport display hardware.
- Web research on MoTeC C187 found configurable RGB shift lights, configurable pages, alarms, math channels, and custom layouts as standard motorsport display capabilities.

Functional design language to emulate generically:

- **Top zone:** segmented RPM/shift bar with green/yellow/red progression and high-priority flash near shift point.
- **Center zone:** very large gear; speed and RPM numeric as secondary; delta color close enough to read in peripheral vision.
- **Side clusters:** tyres, pressures, brake temps, ABS/TC/MAP, brake bias, weather, and status indicators.
- **Bottom zone:** fuel/laps remaining, lap/sector timing, session timer, position/class, gaps ahead/behind, pit/incident status.
- **Overlay/warning layer:** flags, pit limiter, low fuel, high temp, off-track/incidents, rain/wetness; warnings should temporarily dominate the page.
- **Aesthetic:** matte black/carbon, beveled panels, high-contrast condensed numerals, color-coded thermal ramps, LED glow, thin separators, minimal decorative clutter.

---

## 3. New widget catalog

Implementation model recommendation: keep primitive `DashboardElementType`s for backward compatibility, but add semantic widget definitions as either:

1. new element types rendered by `DashboardRoot`, or
2. preconfigured compound widgets expanded into multiple primitive elements.

For editor simplicity, expose these as **Widget Gallery cards** even if internally some are compound presets.

Legend:

- **Available:** directly exists in `TelemetrySnapshot` or current binding resolver.
- **Needs binding:** field exists but resolver/UI binding needs corner-specific binding keys.
- **Missing:** not present in `TelemetrySnapshot`; use `var:`/`expr:` as temporary workaround or extend providers/model.

| # | Widget | Purpose | Telemetry binding(s) | Visual spec | Config options | Status |
|---|---|---|---|---|---|---|
| 1 | GT3 segmented RPM shift bar | Primary upshift cue | `shiftPct`, `rpm`, `maxRpm`, `gear` | 12-24 trapezoid/LED segments across top; green→amber→red; final 2-4 segments flash blue/white at shift point; optional side LEDs | segments, thresholds, flashAt, flashColor, perGearThresholds, shape, glow | Available; flash/per-gear new |
| 2 | Central gear + speed cluster | Fastest glance zone | `gearLabel`, `speedKmh`, `rpm`, `shiftPct` | Huge central gear (55-70% height), speed below, small RPM text; carbon bevel frame | gearFontSize, speedUnits, showRpm, compact/stacked, neutral/reverse colors | Available |
| 3 | Gear-only race tile | Minimal dash center | `gearLabel` | Single giant gear in square/hex tile, color changes near shift | tileShape, shiftColorMode, background, borderGlow | Available |
| 4 | Tyre temperature grid | Tyre management | `tyres.lf.tempC`, `tyres.rf.tempC`, `tyres.lr.tempC`, `tyres.rr.tempC` | 2×2 corner grid with number + heat color ramp (blue cold, green optimal, amber hot, red critical) | unit C/F, cold/optimal/hot thresholds, showLabels, showAverage | Needs binding |
| 5 | Tyre pressure grid | Pressure monitoring | `tyres.*.pressureKpa` | 2×2 grid in kPa/psi/bar with target delta color | units, target pressure, tolerance, showDelta | Needs binding |
| 6 | Tyre wear grid | Stint wear | `tyres.*.wearPct` | 2×2 mini tyres filled by remaining/wear percentage; color ramp green→amber→red | showRemaining vs worn, warning thresholds | Needs binding |
| 7 | Brake temperature grid | Brake management | `brakeTempC.lf/rf/lr/rr` | 2×2 rotor icons or bars beside tyres; purple/blue cold, green optimal, orange/red overheat | thresholds per axle, showFrontRearAvg, blinkCritical | Needs binding |
| 8 | Tyre + brake corner stack | Combined corner health | tyres temp/pressure/wear + brake temp | Four vertical cards placed in wheel order; each card has pressure, tyre temp, brake temp, wear strip | fieldsVisible, compact/full, thresholds | Needs binding |
| 9 | Fuel stint calculator | Fuel decisions | `fuelLiters`, `fuelCapacityLiters`, `fuelPerLap`, `fuelLapsLeftStr`, `lapsRemaining`, `sessionTimeRemainingSec` | Horizontal tank bar + liters + laps left + needed-to-finish | reserveLaps, showRefuelNeeded, warningAtLaps, enduranceMode | Partly available; refuel needed derived new |
| 10 | Fuel burn mini trend | Consumption stability | `fuelPerLap`; historical samples | Sparkline of L/lap over last N laps; current/avg label | windowLaps, targetFuelPerLap, colorAboveTarget | Available field; history new |
| 11 | Delta predictive bar | Pace feedback | `deltaSec`, `deltaToBestSec`, `deltaToSessionBestSec`, `estimatedLapTimeSec` | Center-zero bar, green left/faster, red right/slower; numeric delta above | reference best/session/last/optimal, range, smoothing | Mostly available |
| 12 | Lap/sector timing panel | Qualifying/race pace | `currentLapFmt`, `lastLapFmt`, `bestLapFmt`, `estimatedLapTimeSec` | Three-row timing card; current large, last/best small; colors for PB/session best | rowsVisible, showEstimated, deltaReference | Available except sectors |
| 13 | Sector split strip | Where time is gained/lost | sector times/deltas | Three/four blocks S1/S2/S3 with green/purple/red states | sectors count, source best/session, purple mode | Missing: sector fields |
| 14 | Position/class badge | Race context | `position`, `classPosition`, `totalCars`, `strengthOfField` | Big `P12` + class `C4` + total `/36`; optional class color chip | absolute/class mode, showTotal, classColor | Available except class color from player driver lookup |
| 15 | Relative gaps compact | Attack/defend | `drivers`, `gapAheadFmt`, `gapBehindFmt` | 3-row stack: ahead, player, behind; car number/name/gap/class color | rowsBeforeAfter, showClass, showPitStatus | Available via `drivers` |
| 16 | Standings tower GT3 | Full relative/standings | `drivers` | Compact timing tower with class color rail, position, car number, name, gap | maxRows, centerOnPlayer, columns, class filter | Available; current table can evolve |
| 17 | ABS/TC active indicators | Intervention feedback | `absActive`, `tcActive` | Two small tiles that pulse when active; separate setting number if available | pulseDuration, colors, inactiveDim | Available for active; levels missing |
| 18 | ABS/TC/MAP settings strip | Driver controls | ABS level, TC level, engine map | Three/four boxes `ABS 6`, `TC 4`, `MAP 2`, `BB 53.4` | number ranges, labels, warning when changed | Missing: levels/map/brake bias |
| 19 | Brake bias indicator | Balance setting | brake bias percent | Horizontal front/rear balance bar with `BB 53.2F` | min/max, frontColor, rearColor, popupOnChange | Missing |
| 20 | Engine/water/oil temperature panel | Reliability | water temp, oil temp, oil pressure | Three numeric status cards with color ramp; alarm overlay if critical | thresholds, units, blinkCritical | Missing |
| 21 | Flag/warning overlay | Race control | `flags`, `pitLimiter`, `onPitRoad`, `incidentCount`, `incidentLimit`, `fastRepairs*` | Full-width top/bottom banner or whole-screen translucent overlay; priority red/yellow/blue/checkered/black/meatball | priority order, flash, compact/full, audio/haptic hook | Available, improve renderer |
| 22 | Pit limiter / pit state tile | Pit entry compliance | `pitLimiter`, `onPitRoad`, `pitServiceFlags` | Bright limiter tile; pit-service checklist row: fuel, LF/RF/LR/RR, repair | showServiceFlags, blinkLimiter, speedLimit if available | Available except pit speed limit |
| 23 | Input bars | Driving input feedback | `throttle`, `brake`, `clutch` | Three vertical bars with distinct colors; brake can show pressure gradient | orientation, labels, deadzone, dual/tri mode | Available |
| 24 | Input traces | Recent driving trace | `throttle`, `brake`, `clutch`, `steerAngleDeg` | Sparkline overlay: throttle green, brake red, steering cyan centerline | samples, channels, normalizeSteering, lineWidth | Available; steering normalization new |
| 25 | Steering angle gauge | Steering feedback | `steerAngleDeg` | Centered horizontal bar or circular wheel arc, left/right color split | maxDegrees, showNumeric, smoothing | Available direct; binding UI missing |
| 26 | Mini track progress map | Track position | `lapDistPct`, `drivers[].lapDistPct`, optional `lat/lon/yawNorth` | Simplified loop/strip map with player marker, nearby cars, sector markers | shape source generated/recorded, showRelatives, orientation | Partly available; track outline missing |
| 27 | Radar proximity | Spatial awareness | `drivers[].lapDistPct`, `gapToPlayerSec`; optional future lateral offsets | Car silhouette with front/rear/side proximity zones; conservative when only gap available | sensitivity, showSideOnly, class colors | Partly available; lateral position missing |
| 28 | Weather/track condition card | Strategy and grip | `trackTempC`, `airTempC`, `trackWetnessPct`, `isRaining`, `gripPct` | Compact card with track/air temp, wetness bar, rain icon, grip % | units, wetness thresholds, showTrend | Available; rain/grip binding UI missing |
| 29 | Session header strip | Context | `sessionType`, `carName`, `trackName`, `sessionTimeRemainingSec`, `currentLap`, `lapsRemaining` | Thin top/bottom info strip; small uppercase condensed labels | fieldsVisible, scrollLongText, compact | Available fields; bindings missing for text fields |
| 30 | Incident/license panel | iRacing race safety | `incidentCount`, `incidentLimit`, `fastRepairsUsed`, `fastRepairsAvailable` | `INC 4/17`, fast repair badge, color escalates near limit | warningAt, showFastRepair, compact | Available; fast repairs binding missing |
| 31 | Shift flash page overlay | Real race shift flash | `shiftPct`, `rpm`, `gear` | At `shiftPct >= flashAt`, briefly flashes entire top edge/gear outline | flashAt, duration, color, inhibitInPit | Available with new behavior |
| 32 | Multi-page dash controller | Race/quali/pit/warning pages | page state + telemetry triggers | One dashboard can switch view based on mode: Race, Quali, Stint, Pit, Warning | trigger rules, page hotkeys, fallback page | Needs new dashboard model |

### Suggested binding additions

Add these `resolveBinding` keys and expose them in `DASHBOARD_BINDINGS`:

- Tyres: `tyreLfTempC`, `tyreRfTempC`, `tyreLrTempC`, `tyreRrTempC`; `tyreLfPressureKpa`, etc.; `tyreLfPressurePsi`, `tyreLfPressureBar`; `tyreLfWearPct`, etc.
- Brakes: `brakeLfTempC`, `brakeRfTempC`, `brakeLrTempC`, `brakeRrTempC`, `brakeFrontAvgTempC`, `brakeRearAvgTempC`.
- Weather: `trackWetnessPct`, `isRaining`, `gripPct` UI bindings.
- Session text: `sessionType`, `carName`, `trackName`.
- Driver controls (requires provider/model extension): `absLevel`, `tcLevel`, `engineMap`, `brakeBiasPct`, `waterTempC`, `oilTempC`, `oilPressureKpa`, `sector1DeltaSec`, `sector2DeltaSec`, `sector3DeltaSec`, `tyreCompound`, `pitSpeedLimitKmh`.

---

## 4. Aesthetic specification

### Overall visual direction

- **Theme name:** `GT3 Carbon Pro`.
- **Background:** layered dark carbon/matte graphite, not photorealistic manufacturer carbon. Use subtle diagonal texture or CSS gradients.
- **Panel style:** bevelled rectangular/hex cards, 1px inner stroke, 2-4px outer glow only for active/critical state.
- **Typography:** condensed/mono motorsport stack: `DIN Condensed`, `Bahnschrift Condensed`, `Rajdhani`, `Roboto Condensed`, `Inter Tight`, fallback `Segoe UI`. Numeric telemetry should use tabular numerals.
- **Information hierarchy:** gear and shift lights first; speed/RPM second; delta/fuel/flags third; detailed temps/relative fourth.
- **Readability target:** all critical numeric text readable at arm's length on 5-7 inch 1024×600 displays.

### Color tokens

```text
bgCarbon0       #05070A
bgCarbon1       #0A0E13
panel           #101722
panelRaised     #151D2A
panelStroke     #2B3545
textPrimary     #F5F8FC
textSecondary   #AAB6C5
textMuted       #647386
cyanAccent      #49C5B1
blueAccent      #3EA0FF
greenGood       #20E070
amberWarn       #FFB84D
redDanger       #FF3B4F
purpleBest      #B66CFF
whiteFlash      #F6FBFF
pitLimiterBlue  #00A3FF
flagYellow      #FFD400
flagBlue        #2E8BFF
flagGreen       #2DD96A
flagRed         #FF2A3A
```

### RPM/shift color ramp

- 0.00-0.55: dim/unlit or cool blue/cyan.
- 0.55-0.75: green/cyan active build.
- 0.75-0.90: amber.
- 0.90-0.98: red.
- 0.98-1.00: blue-white/purple flash, 8-12 Hz perceived blink, also glow gear outline.
- Pit limiter: override with alternating blue/white pulse if `pitLimiter` is active.

### Temperature ramps

- Tyre temp default: cold `<70C` blue, warm `70-85C` cyan, optimal `85-105C` green, hot `105-115C` amber, critical `>115C` red.
- Brake temp default: cold `<250C` blue, working `250-650C` green, hot `650-850C` amber, critical `>850C` red.
- Pressure default: target-centered; below target = blue, in range = green, above = amber/red. User must configure target per car.

### Layout grid zones

For 1024×600 base:

```text
0-72px      top shift/race-control zone
72-390px    primary cluster zone (left data, center gear/speed, right data)
390-520px   pace/fuel/session zone
520-600px   bottom warnings / relative / setup strip
```

Grid rules:

- Use 8px base grid; 16px outer margins; 8-12px gutters.
- Keep gear cluster centered on optical center, not necessarily canvas center if side clusters are asymmetric.
- Reserve a top overlay layer for flags/shift flash; never bury flags under other widgets.
- Use consistent 12px panel radius, 1px stroke, and 4px internal gap for micro-cards.

---

## 5. Prebuilt GT3-style dashboard presets

All presets are original, generic GT3 styles. Do not use manufacturer logos, exact layouts, or named OEM skins. Each preset should be implemented as a `BUILTIN_PRESETS` builder in `src/shared/dashboards.ts` after widget support lands.

### Preset A — `GT3 Pro Race · 1024×600`

Purpose: default race dashboard for a 7-inch DDU-style screen.

Canvas: 1024×600, bg `#05070A`.

Layout:

- `shiftBar`: x=24, y=16, w=976, h=44, binding `shiftPct`, 18 segments, flash at 0.98.
- `flagOverlay`: x=24, y=66, w=976, h=42, any active flag, hidden/dim when inactive.
- `centralGearSpeed`: x=342, y=108, w=340, h=250, bindings `gearLabel`, `speedKmh`, `rpm`.
- `leftTyreBrakeStack`: x=24, y=116, w=270, h=250, tyres/brakes LF/LR.
- `rightTyreBrakeStack`: x=730, y=116, w=270, h=250, tyres/brakes RF/RR.
- `deltaPredictive`: x=260, y=374, w=504, h=48, binding `deltaSec`, range ±1.0.
- `fuelStint`: x=24, y=432, w=300, h=74, fuel liters/laps left/per lap.
- `lapTiming`: x=340, y=432, w=344, h=74, current/last/best.
- `positionGap`: x=700, y=432, w=300, h=74, P/class + ahead/behind.
- `setupStrip`: x=24, y=520, w=976, h=56, ABS/TC/MAP/BB + pit limiter + incidents.

### Preset B — `GT3 Quali Attack · 1024×600`

Purpose: qualifying hotlap, prioritizes shift, gear, delta, lap timing, tyres.

Layout:

- Top shift bar full width x=16, y=12, w=992, h=54; 24 thin LEDs.
- Giant gear x=384, y=92, w=256, h=210; speed small below.
- Delta bar x=160, y=318, w=704, h=50; numeric delta x=402, y=270, w=220, h=48.
- Current lap x=256, y=386, w=248, h=64; estimated lap x=520, y=386, w=248, h=64.
- Sector split strip x=120, y=464, w=784, h=54 (disabled/fallback until sectors exist).
- Tyre temp compact grids x=24, y=104, w=220, h=220 and x=780, y=104, w=220, h=220.
- Bottom weather/track x=24, y=532, w=280, h=44; fuel x=744, y=532, w=256, h=44.

### Preset C — `GT3 Endurance Stint · 1024×600`

Purpose: endurance racing, fuel, tyre/brake health, consistency, stint time.

Layout:

- Shift bar x=32, y=16, w=960, h=38.
- Gear+speed compact x=404, y=80, w=216, h=172.
- Fuel calculator dominant x=32, y=270, w=448, h=130.
- Tyre+brake health matrix x=544, y=78, w=448, h=322.
- Lap timing x=32, y=416, w=300, h=74.
- Fuel burn trend x=348, y=416, w=300, h=74.
- Weather/grip x=664, y=416, w=328, h=74.
- Relative compact x=32, y=506, w=600, h=76.
- Pit/service/incident strip x=648, y=506, w=344, h=76.

### Preset D — `GT3 Sprint Battle · 1280×720`

Purpose: large overlay/dashboard for sprint races with relative/attack/defend focus.

Layout:

- Shift bar x=32, y=20, w=1216, h=52.
- Gear+speed x=458, y=96, w=364, h=260.
- Relative/standings tower left x=32, y=96, w=360, h=500, centered on player, 9 rows.
- Position/class badge right top x=888, y=96, w=360, h=110.
- Gaps ahead/behind right x=888, y=224, w=360, h=132.
- Tyre/brake compact x=888, y=374, w=360, h=164.
- Delta x=416, y=386, w=448, h=52.
- Input bars x=416, y=462, w=180, h=134; fuel x=616, y=462, w=248, h=134.
- Bottom warning strip x=32, y=620, w=1216, h=68.

### Preset E — `GT3 Minimal Wheel · 800×480`

Purpose: small wheel-mounted/phone display: maximum legibility, minimum clutter.

Layout:

- Shift bar x=16, y=12, w=768, h=46.
- Gear huge x=220, y=82, w=360, h=210.
- Speed x=310, y=300, w=180, h=54.
- Delta x=130, y=366, w=540, h=34.
- Bottom 4 tiles: fuel laps, lap time, position, flag/pit x=16/212/408/604, y=416, w=180, h=48.

### Preset F — `GT3 Engineer Debug · 1920×1080`

Purpose: second-monitor engineering page while testing telemetry providers.

Layout:

- Top race header x=32, y=24, w=1856, h=64.
- Gear/speed/rpm x=760, y=112, w=400, h=280.
- Full standings x=32, y=112, w=560, h=760.
- Tyre/brake matrix x=1250, y=112, w=638, h=360.
- Fuel/stint x=1250, y=504, w=638, h=180.
- Input traces x=624, y=432, w=560, h=252.
- Weather/map/radar row x=624, y=716, w=1264, h=300.
- Bottom diagnostics strip x=32, y=900, w=560, h=116.

---

## 6. Editor UX improvements

### Widget gallery

Replace flat add-button strip with a categorized gallery:

- **Primary GT3:** Shift Bar, Gear+Speed, Delta, Fuel Stint, Flag Overlay.
- **Tyres & Brakes:** Tyre Temps, Pressures, Wear, Brake Temps, Corner Stack.
- **Race Context:** Position, Relative, Standings, Lap Timing, Sector Strip.
- **Driver Inputs:** Input Bars, Input Trace, Steering Gauge.
- **Car Setup:** ABS/TC/MAP, Brake Bias, Engine Temps.
- **Utility:** Text, Rect, Image, Generic Bar, Generic Gauge, Table.

Each card should show: miniature preview, required bindings, missing telemetry warnings, and one-click insertion.

### Preconfigured widget variants

For each semantic widget, ship ready variants:

- Shift bar: 12 LED, 18 LED, 24 thin LED, side-pod LEDs.
- Gear cluster: square tile, hex tile, full DDU cluster.
- Tyres: temp only, pressure only, temp+pressure, full health.
- Fuel: compact, endurance, pit strategy.
- Relative: 3-row compact, 5-row battle, 9-row tower.

### Preset gallery

Add a preset gallery before blank-dashboard creation:

- Large preview image generated from the actual dashboard model.
- Filters: `7 inch`, `wheel`, `overlay`, `race`, `quali`, `endurance`, `engineering`.
- “Duplicate and edit” instead of editing built-in directly.
- Show missing telemetry badges: e.g. “Brake bias requires provider support”.

### Inspector improvements

- Replace generic controls with per-widget config panels.
- Group config sections: Data, Visual, Thresholds, Behavior, Layout.
- Add live simulated telemetry preview modes: idle, racing, shift flash, yellow flag, low fuel, hot brakes.
- Add threshold editors with color chips and numeric breakpoints.
- Add unit selectors (km/h mph; C/F; kPa/psi/bar; liters/gallons).
- Add “bind from telemetry” search with field documentation from `TelemetrySnapshot`.
- For missing fields, offer `var:` and `expr:` binding entry manually, because resolver already supports them (`src/renderer/src/dashboard/binding.ts:288-308`).

### Layout tools

- Keep current snap grid, but add visible 8/16/32px grid modes and smart guides.
- Add align/distribute multi-select.
- Add lock/hide layers.
- Add duplicate-as-variant and save-widget-template.
- Add responsive scale preview for common displays: 800×480, 1024×600, 1280×720, 1920×1080.
- Add “safe zone” overlay for bezels and steering-wheel rims.

---

## 7. Prioritized build plan

### Phase 1 — Maximum visual impact, minimum telemetry changes

1. **GT3 segmented RPM shift bar v2**
   - Extend current `shiftlights` with flash zone, glow, segment shape, final flash color, and pit limiter override.
   - Uses existing `shiftPct`, `rpm`, `maxRpm`, `pitLimiter`.
2. **Central gear + speed cluster**
   - Compound widget or new semantic element.
   - Uses existing `gearLabel`, `speedKmh`, `rpm`, `shiftPct`.
3. **Fuel stint calculator compact**
   - Uses existing `fuelLiters`, `fuelCapacityLiters`, `fuelPerLap`, `fuelLapsLeftStr`, `lapsRemaining`.
4. **Delta predictive bar + numeric tile**
   - Build on current `deltabar`; add numeric and reference label.
5. **Flag/warning overlay v2**
   - Improve priority/visibility using existing `flags`, `pitLimiter`, `onPitRoad`.
6. **Preset A: GT3 Pro Race** and **Preset E: GT3 Minimal Wheel**
   - Gives users immediate “real GT3-style” dashboards with current data.

### Phase 2 — Tyres, brakes, race context

1. Add corner-specific tyre/brake binding keys.
2. Implement Tyre Temp Grid, Tyre Pressure Grid, Brake Temp Grid, Tyre+Brake Corner Stack.
3. Upgrade Standings/Relative with GT3 styling and compact 3-row relative widget.
4. Implement Weather/Track Condition Card with wetness/grip/rain bindings.
5. Ship Preset B Quali Attack and Preset C Endurance Stint.

### Phase 3 — Missing GT3 setup data and advanced pages

1. Extend `TelemetrySnapshot` and providers for `absLevel`, `tcLevel`, `engineMap`, `brakeBiasPct`, water/oil temps, oil pressure, sectors, tyre compound, pit speed limit.
2. Implement ABS/TC/MAP settings strip, brake bias indicator, engine temperature panel, sector split strip.
3. Add multi-page dash controller and telemetry-triggered warning/pit pages.
4. Ship Preset D Sprint Battle and Preset F Engineer Debug.

### Phase 4 — Editor productivity

1. Widget gallery with previews and variants.
2. Preset gallery with filter tags and missing-telemetry badges.
3. Simulated telemetry preview states.
4. Smart guides, multi-select align/distribute, lock/hide layers.
5. Save/share widget templates.

---

## 8. Recommended first implementation slice

Build these first for the fastest “wow, this looks like a GT3 dash” outcome while using existing telemetry:

1. **Shift Bar v2** — flash + glow + GT3 segmented styling.
2. **Central Gear+Speed Cluster** — single most recognizable GT3 feature.
3. **Fuel Stint Compact** — real race utility with current fuel fields.
4. **Delta Predictive Tile** — already close to existing `deltabar`, high value.
5. **Flag Overlay v2** — safety/race-control authenticity.
6. **Two built-in presets:** `GT3 Pro Race · 1024×600` and `GT3 Minimal Wheel · 800×480`.

Then immediately add tyre/brake corner bindings and the Tyre+Brake Corner Stack, because `TelemetrySnapshot` already models tyres/brakes but the dashboard binding UI cannot use them yet.
