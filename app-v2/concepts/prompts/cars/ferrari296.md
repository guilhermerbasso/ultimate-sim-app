# Ferrari 296 GT3 — real-dash spec + reconstruction
Reference (reconstruction): ../../refs/car-ferrari296-dash.png
Approach: research_spec_reconstruct — matched to the REAL 296 GT3 wheel display; no copyrighted photo/logo committed.

## Real dash research (functional layout)
Sources (viewed for research only, not committed):
- iRacing forums — Ferrari 296 GT3 steering-wheel / dashboard reference thread.
- Ferrari Competizioni GT 296 GT3 official page (layout/livery palette).
- Onboard hotlap videos (in-sim cluster during a lap).

Real 296 GT3 cluster characteristics:
- **Top edge:** a horizontal row of ~10-15 shift LEDs, left→right progression green → yellow/orange → red, with a
  blue/violet FLASH at the shift point / over-rev.
- **Center:** a very large GEAR digit (dominant, white/red), the single most prominent element.
- **Speed:** smaller numeric below/around the gear; **RPM** as a numeric or thin bar near the gear.
- **Corners / sides:** last lap or delta (bottom corners), fuel (liters/bar), and electronics — TC, ABS, engine MAP —
  as small labelled value chips.
- **Signature palette:** Ferrari red (#DC0000 / rosso) accents, yellow tach highlights, on a near-black screen.

## American-English reconstruction prompt (validated vs checklist)
A clean, faithful RECONSTRUCTION of a modern Ferrari-style GT3 endurance steering-wheel digital dash cluster (296 GT3
style), flat front-on UI, dark near-black screen, no wheel rim, no car, NO brand logos or text marks: across the very
TOP edge a full-width row of ~15 round shift LEDs progressing green → yellow → orange → red with two blue flash LEDs at
the far right (shift now). CENTER: one very large gear number "4" in white with a thin red outline — clearly the
dominant element. Just beneath it a smaller speed "213" with a tiny "km/h", and a slim RPM bar. LEFT column: a compact
fuel readout "48 L" and a small "TC 4"; RIGHT column: last-lap "1:52.8" and a small "ABS 2" and "MAP 3". Ferrari-red
and yellow accents on black, crisp high-contrast emissive digits, professional Bosch/AiM-style GT3 cluster look.
US English only. Aspect ~16:9 (fits a 1024x600 cluster).

## Checklist notes
- Subject: full 296 GT3-style cluster (dashboard reference); single-info widgets derived from each element.
- Data/values: gear 4 (dominant), speed 213, rpm bar, fuel 48 L, TC 4, ABS 2, MAP 3, last lap 1:52.8, top shift LEDs.
- Layout/sizing: top LED strip edge-to-edge; huge center gear; speed/rpm under; fuel+TC left; lap+ABS+MAP right.
- Theme: Ferrari 296 GT3 — red/yellow on black, round shift LEDs + blue over-rev flash.
- Color rules: shift green→red + blue flash; warm accents = chrome; values legible.
- AVOID: NO brand logos/marks; single-info app widgets will be title-less/transparent/borderless (the dashboard uses a dark cluster backplate).

## QA outcome
- Image QA: pass — top round shift LEDs green→red + blue over-rev; dominant center gear 4 (red outline); speed 213;
  RPM bar with scale; FUEL 48 L + TC 4 left; LAST LAP 1:52.8 + ABS 2 + MAP 3 right; Ferrari red/yellow on black. Faithful.
- Build QA vs real dash + reference: pending (car build agent).
