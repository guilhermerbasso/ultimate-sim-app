# Aston Martin Vantage GT3 (EVO) — real-dash spec + reconstruction
Reference (reconstruction): ../../refs/car-astonmartingt3-dash.png
Approach: research_spec_reconstruct — matched to the REAL Vantage GT3 EVO cluster; no copyrighted photo/logo committed.

## Real dash research (functional layout)
Sources (research only): iRacing Vantage GT3 EVO preview, LMU/Z1/SimHub Vantage GT3 dashboards, onboard videos.

Real Aston Martin Vantage GT3 EVO cluster characteristics:
- **Top:** a horizontal RPM / shift-light bar (green → yellow → red, flashing at the shift point).
- **Center:** large central GEAR.
- **Sides/bottom:** speed, lap time, delta (green faster / red slower), fuel; ABS/TC at edges; warnings center.
- **Signature palette:** Aston Martin British racing GREEN / teal (#00665E) with lime highlights + white on black —
  distinct from Ferrari red, Porsche white, Corvette yellow, Mustang blue, Lamborghini lime-hex.

## American-English reconstruction prompt (validated vs checklist)
A clean, faithful RECONSTRUCTION of an Aston Martin Vantage GT3-style modern endurance dash, flat front-on UI, dark
near-black screen, no wheel rim, no car, NO brand logos or text marks: across the very TOP a full-width horizontal
segmented RPM / shift bar green → yellow → red (about 82% lit). CENTER: one large white gear "4" with a small speed
"213" and tiny "km/h" beneath. LEFT edge: "ABS 3" and "TC 5"; RIGHT edge: "LAP 1:52.8" and delta "-0.24"; BOTTOM band:
"FUEL 48 L" and "OIL 108 C" separated by a thin hairline. Aston Martin British racing GREEN / teal (#00665E) with lime
accents + white on black, crisp high-contrast, clean modern endurance GT3 cluster (distinct green signature). US
English only. Aspect ~16:9 (fits 1024x600).

## Checklist notes
- Subject: full Vantage GT3 cluster; single-info widgets from each element.
- Data/values: top shift bar 82%, gear 4, speed 213, ABS 3, TC 5, lap 1:52.8, delta -0.24, fuel 48 L, oil 108 C.
- Layout/sizing: horizontal shift bar top; central gear+speed; ABS/TC left, lap/delta right, fuel/oil bottom.
- Theme: Aston Martin Vantage GT3 — British racing green/teal + lime + white.
- Color rules: shift green→red + flash; delta green=gain/red=loss; green signature accents.
- AVOID: NO logos/marks; single-info app widgets title-less/transparent/borderless (dashboard uses a dark backplate).

## QA outcome
- Image QA: pass — top horizontal segmented shift bar (green→yellow→red, ~82%); big center gear 4 + speed 213;
  ABS 3 + TC 5 left; LAP 1:52.8 + delta -0.24 right; FUEL 48 L + OIL 108 C bottom band; Aston British-green/teal.
- Build QA vs real dash + reference: pending.
