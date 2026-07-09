# Ferrari 488 Challenge (Evo) — real-dash spec + reconstruction
Reference (reconstruction): ../../refs/car-ferrari488-dash.png
Approach: research_spec_reconstruct — matched to the REAL 488 Challenge cluster; no copyrighted photo/logo committed.

## Real dash research (functional layout)
Sources (research only): iRacing 488 Challenge cockpit, SimHub 488 Challenge replicas, onboard videos.

Real Ferrari 488 Challenge cluster characteristics:
- **Top:** a row of ~10 shift LEDs (green → yellow/orange → red/blue at shift point).
- **Just below/around gear:** a digital RPM BAR.
- **Center:** large central GEAR.
- **Left:** speed; **Right:** lap time / delta; **Bottom:** fuel + temps.
- **Signature palette:** Ferrari red + yellow on black — but distinct LAYOUT from the 296 GT3 (Challenge single-make
  style: LED row + RPM bar hugging the gear, speed pinned left, lap pinned right, fuel band bottom).

## American-English reconstruction prompt (validated vs checklist)
A clean, faithful RECONSTRUCTION of a Ferrari 488 Challenge single-make race car digital dash, flat front-on UI, dark
near-black screen, no wheel rim, no car, NO brand logos or text marks: across the very TOP a row of ~10 shift LEDs
green → yellow → red with a blue pair at the far right; DIRECTLY around the center a large gear "4" with a thin curved
RPM bar hugging it (green→red, ~85%). LEFT edge: a vertical-ish "SPD 213 km/h"; RIGHT edge: "LAP 1:52.8" and delta
"-0.24"; BOTTOM band: "FUEL 48 L" and "OIL 108 C" and "H2O 96 C". Ferrari red + yellow accents on black, crisp
high-contrast — a Challenge single-make layout distinct from a 296 GT3 (LED row + curved RPM bar hugging the gear,
speed pinned left, lap pinned right, fuel band bottom). US English only. Aspect ~16:9 (fits 1024x600).

## Checklist notes
- Subject: full 488 Challenge cluster; single-info widgets from each element.
- Data/values: top LEDs, gear 4 + curved RPM bar, speed 213 left, lap 1:52.8 + delta -0.24 right, fuel/oil/water bottom.
- Layout/sizing: LED row top; gear+curved RPM center; speed left; lap/delta right; fuel band bottom.
- Theme: Ferrari 488 Challenge — red/yellow, LED row + curved RPM bar hugging gear (distinct from 296 GT3).
- Color rules: LEDs green→red + blue; delta green=gain/red=loss; warm accents.
- AVOID: NO logos/marks; single-info app widgets title-less/transparent/borderless (dashboard uses a dark backplate).

## QA outcome
- Image QA: pass — top ~10 shift LEDs (green→yellow→red→blue); curved RPM bar hugging the center gear 4; SPD 213 left;
  LAP 1:52.8 + delta -0.24 right; FUEL/OIL/H2O bottom band with icons; Ferrari red/yellow. Distinct Challenge layout.
- Build QA vs real dash + reference: pending.
