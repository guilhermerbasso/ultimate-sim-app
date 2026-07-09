# Ford Mustang GTD — real-dash spec + reconstruction
Reference (reconstruction): ../../refs/car-mustanggtd-dash.png
Approach: research_spec_reconstruct — matched to the REAL 2025 Mustang GTD digital cluster (Track mode); no copyrighted photo/logo committed.

## Real dash research (functional layout)
Sources (research only): 2025 Ford Mustang instrument-cluster user guide, GTD cluster/drive-mode walkthroughs.

Real Mustang GTD (Track mode) cluster characteristics:
- **Top:** a large colored ARC / sweeping RPM tachometer across the upper area with a redline shift zone + shift light
  at redline (distinct from round LEDs or a straight segment bar — this is a SWEEPING ARC tach).
- **Center:** a big central GEAR digit; **speed** shown digitally near it.
- **Track metrics:** tire pressures, oil temp, drive-mode indicator, lap timer emphasized in Track mode.
- **Signature palette:** Ford / Grabber BLUE accents with white + a red redline (muscle-car performance look).

## American-English reconstruction prompt (validated vs checklist)
A clean, faithful RECONSTRUCTION of a 2025 Ford Mustang GTD-style digital instrument cluster in Track mode, flat
front-on UI, dark near-black screen, no wheel rim, no car, NO brand logos or text marks: across the TOP a large bold
SWEEPING ARC tachometer (a wide semicircular RPM sweep) filling blue → white with a RED redline zone at the right end
and a bright shift indicator near redline. CENTER, inside the arc: one big white gear number "4" with a smaller speed
"213" and tiny "mph" beneath. LOWER-LEFT: "OIL 110 C" and "WATER 96 C"; LOWER-RIGHT: four small tire-pressure values
"FL 27.6  FR 27.4 / RL 27.0  RR 27.2 psi"; a small "TRACK" drive-mode tag centered at the bottom. Grabber-BLUE and
white on black with a red redline, crisp high-contrast muscle-car performance aesthetic (distinct from a round-LED
Ferrari or a segment-bar Porsche). US English only. Aspect ~16:9 (fits 1024x600).

## Checklist notes
- Subject: full Mustang GTD Track cluster; single-info widgets derived from each element.
- Data/values: sweeping arc tach + redline, gear 4, speed 213 mph, oil 110 C, water 96 C, 4 tire pressures, TRACK mode.
- Layout/sizing: big top arc tach; center gear+speed inside the arc; oil/water lower-left; tire psi lower-right; mode tag bottom.
- Theme: Mustang GTD — Grabber blue + white + red redline; SWEEPING ARC tach (the Mustang signature).
- Color rules: tach blue→white→red redline; warm = temps alert; values legible.
- AVOID: NO logos/marks; single-info app widgets title-less/transparent/borderless (dashboard uses a dark backplate).

## QA outcome
- Image QA: pass — sweeping arc tach (blue→white→red redline + shift mark); center gear 4 + speed 213 mph inside arc;
  OIL 110 C + WATER 96 C lower-left; 4 tire pressures lower-right; TRACK mode tag bottom. Distinct Ford-blue arc look.
- Build QA vs real dash + reference: pending.
