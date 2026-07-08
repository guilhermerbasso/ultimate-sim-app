# ref-dash-endurance-clean-1024x600  (dashboard layout)
Reference: refs/ref-dash-endurance-clean-1024x600.png

## Purpose
Layout target for the CLEAN recreated dashboards. Target device resolution 1024x600 (adaptive to other sizes). Core
premise: rev-lights run along the TOP edge-to-edge (except the Mustang theme). Clean = transparent/dark, no titles,
self-explanatory values, hairline-only chrome. This generic GT3 endurance cluster is the base template; themed variants
follow. Composed from the already-built clean hi-fi widgets.

## American-English prompt (validated)
A clean modern GT3 endurance digital dash cluster UI, 1024x600 widescreen, dark near-black transparent background, flat
front-on UI (no physical wheel, no car): a full-width edge-to-edge LED rev-light strip across the very TOP (green to
amber to red with blue shift LEDs). Center: a very large gear number with speed beneath it and a slim RPM arc. Left
column: four small tyre-temperature readouts with a cool-to-hot thermal tint, and a fuel readout with laps-to-empty.
Right column: position (P4/24), a green/red delta to the car ahead and behind, and the last lap time. Bottom strip:
brake-bias, TC and ABS values, and laps remaining. All values are big and self-explanatory with NO text titles/labels,
NO panel boxes, NO borders — just glowing numbers and thin hairline separators on dark. Cyan/white/amber accents,
emissive neon-on-dark motorsport telemetry aesthetic, crisp, high contrast, professional Bosch-DDU / MoTeC feel. US
English only.

## Checklist notes
- Subject: clean GT3 endurance cluster, 1024x600, rev-lights top edge-to-edge.
- Data/values: rev strip, gear/speed/rpm center, tyre temps + fuel left, position/deltas/laptime right, BB/TC/ABS/laps bottom.
- Layout/sizing: top full-width LED strip; 3-zone body (left/center/right); bottom status strip. 1024x600 aspect.
- Theme: clean Bosch-DDU/MoTeC GT3, neon-on-dark, minimal chrome.
- Color rules: rev green->red + blue shift; delta green=good/red=bad; thermal tyre tint.
- AVOID (app output): no titles/labels, transparent/dark bg, no panel boxes, no hard borders, no overlap/clipping.

## QA outcome
- Image QA: pass — top edge-to-edge rev strip; center gear+speed+RPM arc; left 4 thermal tyre temps + fuel/laps;
  right P4/24 + green(behind)/red(ahead) deltas + last lap; bottom BB%/TC/ABS/laps. No titles/panels, hairline-only,
  1024x600 aspect. Strong clean-dashboard template.
- Build QA vs ref: pending (v4-dash-recreate).
