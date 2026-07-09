# McLaren 720S GT3 EVO — real-dash spec + reconstruction
Reference (reconstruction): ../../refs/car-mclaren720s-dash.png
Approach: research_spec_reconstruct — matched to the REAL 720S GT3 EVO Cosworth Omega LCD; no copyrighted photo/logo committed.

## Real dash research (functional layout)
Sources (research only): iRacing 720S GT3 EVO cockpit, Cosworth Omega LCD references, onboard videos.

Real McLaren 720S GT3 EVO cluster characteristics:
- **Top:** an LED RPM/shift bar (~10-14 RGB LEDs), green → yellow → red, all-red/flashing at the shift point.
- **Center:** large central GEAR.
- **Bottom/sides:** lap time, delta, fuel, water temp, oil temp, best lap.
- **Signature palette:** McLaren PAPAYA ORANGE (#FF8000) accents + white on black (Cosworth Omega look) — distinct from
  Ferrari red, Porsche white, Corvette yellow, Mustang blue, Lambo lime, Aston green.

## American-English reconstruction prompt (validated vs checklist)
A clean, faithful RECONSTRUCTION of a McLaren 720S GT3-style Cosworth Omega LCD dash, flat front-on UI, dark near-black
screen, no wheel rim, no car, NO brand logos or text marks: across the very TOP an LED RPM / shift bar of ~12 segments
green → yellow → red (about 80% lit). CENTER: one large white gear "4" with a small speed "213" and tiny "km/h"
beneath. LOWER-LEFT: "FUEL 48 L" and "WATER 90 C"; LOWER-CENTER: "OIL 95 C"; LOWER-RIGHT: "LAP 1:52.8" and delta
"-0.24". McLaren PAPAYA ORANGE (#FF8000) accents + white on black, crisp high-contrast, clean Cosworth Omega GT3
cluster with a distinct papaya signature. US English only. Aspect ~16:9 (fits 1024x600).

## Checklist notes
- Subject: full 720S GT3 EVO cluster; single-info widgets from each element.
- Data/values: top LED bar 80%, gear 4, speed 213, fuel 48 L, water 90 C, oil 95 C, lap 1:52.8, delta -0.24.
- Layout/sizing: LED shift bar top; central gear+speed; fuel/water left, oil center, lap/delta right.
- Theme: McLaren 720S GT3 EVO — papaya orange + white, Cosworth Omega LED bar.
- Color rules: shift green→red + flash; delta green=gain/red=loss; papaya accents.
- AVOID: NO logos/marks; single-info app widgets title-less/transparent/borderless (dashboard uses a dark backplate).

## QA outcome
- Image QA: pass — top LED shift bar (green→yellow→red, ~80%); papaya-orange side tach graphics; big center gear 4 +
  speed 213; FUEL/WATER left, OIL center, LAP/delta right; McLaren papaya-orange signature. Distinct Cosworth Omega look.
- Build QA vs real dash + reference: pending.
