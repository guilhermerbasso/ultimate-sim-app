# Chevrolet Corvette Z06 GT3.R — real-dash spec + reconstruction
Reference (reconstruction): ../../refs/car-corvettegt3r-dash.png
Approach: research_spec_reconstruct — matched to the REAL C8 Z06 GT3.R Bosch DDU; no copyrighted photo/logo committed.

## Real dash research (functional layout)
Sources (research only): iRacing C8 Z06 GT3.R cockpit, Bosch DDU (DDU 10) references, SimHub Corvette GT3 dashes.

Real Corvette Z06 GT3.R Bosch DDU characteristics:
- **Top:** a row of configurable shift LEDs (green → yellow → red, white/blue at redline).
- **Just below:** a horizontal RPM BAR (Bosch DDU signature — LEDs on top AND a bar).
- **Center:** a large dominant GEAR digit.
- **Rows below:** speed, lap/delta, fuel, tire pressures/temps, sector — data-dense Bosch DDU layout.
- **Signature palette:** Bosch DDU amber/yellow + white on black; Corvette racing YELLOW (#FFD100) accent.

## American-English reconstruction prompt (validated vs checklist)
A clean, faithful RECONSTRUCTION of a Chevrolet Corvette Z06 GT3.R Bosch-DDU-style GT3 digital dash, flat front-on UI,
dark near-black screen, no wheel rim, no car, NO brand logos or text marks: across the very TOP a row of ~15 shift LEDs
green → yellow → red with a white/blue pair at the far right (redline); directly beneath, a full-width horizontal
segmented RPM bar (~80% lit, green→amber→red). CENTER: one large dominant white gear "4". A data band below: LEFT
"SPD 213" and "FUEL 48 L"; CENTER-BOTTOM four tire pressures "27.6 27.4 / 27.0 27.2 psi"; RIGHT "LAP 1:52.8" and delta
"-0.24". Bosch-DDU amber/yellow + white on black with Corvette-yellow accents, crisp high-contrast, professional
data-dense GT3 cluster (LEDs AND a bar on top — distinct from a round-LED Ferrari or a single-bar Porsche). US English
only. Aspect ~16:9 (fits 1024x600).

## Checklist notes
- Subject: full C8 Z06 GT3.R Bosch DDU cluster; single-info widgets derived from each element.
- Data/values: top LEDs + horizontal RPM bar, gear 4, speed 213, fuel 48 L, 4 tire pressures, lap 1:52.8, delta -0.24.
- Layout/sizing: LEDs top, RPM bar under them, dominant center gear, data band (spd/fuel left, tires center, lap/delta right).
- Theme: Corvette Z06 GT3.R — Bosch DDU amber/yellow + white, LEDs + bar (data-dense).
- Color rules: LEDs/bar green→red + redline; delta green=gain/red=loss; warm accents.
- AVOID: NO logos/marks; single-info app widgets title-less/transparent/borderless (dashboard uses a dark backplate).

## QA outcome
- Image QA: pass — top shift LEDs (green→yellow→red→white/blue) + horizontal RPM bar with scale; dominant center gear 4;
  data band: SPD 213 + FUEL 48 L left, 4 tire pressures with car diagram center, LAP 1:52.8 + delta -0.24 right;
  Corvette-yellow Bosch-DDU accents. Distinct data-dense DDU look.
- Build QA vs real dash + reference: pending.
