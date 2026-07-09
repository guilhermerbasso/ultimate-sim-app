# P1 Wave 1 — Engine / driveline vitals (irVitals group)

Per-asset gpt-image flow: validated American-English prompt → gpt-image (gpt-image-2) →
image-QA → build clean SVG widget (`hifi/widgets/irVitals`) → visual-QA vs reference.

All widgets are clean by convention: transparent, title-less/self-explanatory (big value +
unit only), hairline min→max micro-scale with a health-coloured value tick (conditional
colour: red below the safe threshold, amber when high). References live in `concepts/refs/`.

| Widget id | Channel (snapshot field) | Reference | Range | Unit |
|---|---|---|---|---|
| `voltage` | `voltage` (iRacing `Voltage`) | `ref-ir-voltage.png` | 11.5–14.5 | V |
| `manifoldPress` | `manifoldPressBar` (`ManifoldPress`) | `ref-ir-manifoldpress.png` | 0–2.5 | bar |
| `fuelPress` | `fuelPressBar` (`FuelPress`) | `ref-ir-fuelpress.png` | 0–7 | bar |
| `waterLevel` | `waterLevelL` (`WaterLevel`) | `ref-ir-waterlevel.png` | 0–8 | L |
| `oilLevel` | `oilLevelL` (`OilLevel`) | `ref-ir-oillevel.png` | 0–6 | L |

## Prompts (American English)

**voltage** — Ultra-clean sim-racing dashboard WIDGET reference, fully TRANSPARENT background (alpha), no scene, no car, no logos, no title text. Subject: a single electrical-system VOLTAGE readout for a GT3 race-car digital dash cluster, Bosch DDU / MoTeC style. One large crisp 7-segment digital number "12.6" with a small "V" unit to the lower-right. Directly beneath, a thin hairline horizontal micro-scale from 11.5 to 14.5 with a small tick marker near center-right. Palette: bright cyan-white segments, subtle green accent when healthy. Front-on flat 2D UI, high contrast, crisp anti-aliased edges, no panel fill, no border, no drop shadow. Square composition, centered, generous transparent margins.

**manifoldPress** — …MANIFOLD / BOOST PRESSURE readout… number "1.85" + "bar", micro-scale 0.0–2.5, amber accent near the top of the range. (same clean rules)

**fuelPress** — …FUEL PRESSURE readout… number "4.3" + "bar", micro-scale 0–7, green when healthy, red at the low end. (same clean rules)

**waterLevel** — …COOLANT / WATER LEVEL readout… number "6.5" + "L", micro-scale 0–8, red accent at the low end. (same clean rules)

**oilLevel** — …ENGINE OIL LEVEL readout… number "5.2" + "L", micro-scale 0–6, amber accent, red at the low end. (same clean rules)

## Prompt-validation checklist (passed before release)
Subject ✓ · exact data shown ✓ · layout ✓ · GT/DDU theme ✓ · colour rules ✓ ·
AVOID list (no titles / transparent bg / no border / no clip / no overlap) ✓ · American English ✓.
