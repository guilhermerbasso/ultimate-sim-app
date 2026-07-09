# P1 Wave 2 — Environment (irEnv2 group)

Per-asset gpt-image flow: validated American-English prompt → gpt-image (gpt-image-2) →
image-QA → build clean SVG widget (`hifi/widgets/irEnv2`) → visual-QA vs reference (wind
arrow refined to an outer-ring marker so it never crosses the centre speed value).

Clean by convention: transparent, title-less/self-explanatory. Distinct visual styles so
the driver can tell them apart at a glance: percent+fill-bar (with a fog vs droplet glyph),
a compass ring + direction arrow + speed, and a horizon arc + sun dot + elevation degrees.

| Widget id | Channel (snapshot field) | Reference | Style |
|---|---|---|---|
| `fog` | `fogPct` (iRacing `FogLevel`) | `ref-ir-fog.png` | percent + fill bar + fog glyph |
| `humidity` | `humidityPct` (`RelativeHumidity`) | `ref-ir-humidity.png` | percent + fill bar + droplet glyph |
| `wind` | `windDirRad` + `windSpeedMs` (`WindDir`/`WindVel`) | `ref-ir-wind.png` | compass ring + arrow + speed |
| `solarAltitude` | `solarAltitudeRad` (`SolarAltitude`) | `ref-ir-solar.png` | horizon arc + sun dot + degrees |

## Prompts (American English)
See the four `ref-ir-{fog,humidity,wind,solar}` prompts; each specifies: fully transparent
background, no scene/car/logo/title, the exact value shown, the layout, GT DDU/MoTeC theme,
the palette, and the AVOID list (no titles / transparent / no border / no clip / no overlap).

## Prompt-validation checklist (passed before release)
Subject ✓ · exact data shown ✓ · layout ✓ · GT/DDU theme ✓ · colour rules ✓ ·
AVOID list ✓ · American English ✓.
