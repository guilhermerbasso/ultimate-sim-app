# Porsche 911 GT3 Cup (992) — real-dash spec + reconstruction
Reference (reconstruction): ../../refs/car-porschecup-dash.png
Approach: research_spec_reconstruct — matched to the REAL 992 Cup Cosworth ICD; no copyrighted photo/logo committed.

## Real dash research (functional layout)
Sources (research only, not committed): iRacing 992 Cup cockpit overviews, SimRacingWiki 992 Cup guide, Cosworth ICD
product page, onboard dash videos.

Real 911 GT3 Cup (992) Cosworth ICD characteristics:
- **Top:** a straight, horizontal SEGMENTED rev/shift bar spanning the width, multi-color sequential — green →
  yellow → red, flashing at the limiter. (NOT round LEDs — a clean rectangular segment bar.)
- **Center:** a large central GEAR numeral (dominant).
- **Below/around:** speed, delta, lap time, fuel, oil/water — as compact rows on the color screen.
- **Signature palette:** minimalist WHITE + RED on black (Cosworth ICD look), cooler/cleaner than the Ferrari.

## American-English reconstruction prompt (validated vs checklist)
A clean, faithful RECONSTRUCTION of a Porsche 911 GT3 Cup (992) Cosworth-style digital dash (ICD), flat front-on UI,
dark near-black screen, no wheel rim, no car, NO brand logos or text marks: across the very TOP a single straight
horizontal SEGMENTED rev bar spanning full width, ~20 rectangular segments lighting green → yellow → red left to
right (about 78% lit). CENTER: one large white gear number "4" (dominant, minimalist, thin). Directly under it a speed
"213" with tiny "km/h". LOWER-LEFT: "FUEL 48 L" and "OIL 108 C"; LOWER-RIGHT: "LAP 1:52.8" and delta "-0.24"; a thin
white hairline separates the lower info band. Minimalist WHITE and RED on black, crisp high-contrast, clean Cosworth
ICD aesthetic (cooler and simpler than a Ferrari cluster). US English only. Aspect ~16:9 (fits 1024x600).

## Checklist notes
- Subject: full 992 Cup Cosworth cluster; single-info widgets derived from each element.
- Data/values: gear 4, speed 213, top segmented rev bar ~78%, fuel 48 L, oil 108 C, lap 1:52.8, delta -0.24.
- Layout/sizing: straight segmented rev bar on top; dominant center gear; speed under; fuel/oil lower-left; lap/delta lower-right.
- Theme: Porsche 911 GT3 Cup — Cosworth ICD, white/red minimalist on black, straight segment bar (NOT round LEDs).
- Color rules: rev green→red + flash; delta green=gain/red=loss; minimalist white primary.
- AVOID: NO logos/marks; single-info app widgets title-less/transparent/borderless (dashboard uses a dark backplate).

## QA outcome
- Image QA: pass — straight segmented rev bar top (green→yellow→red, ~78%); minimalist thin white gear 4; speed 213;
  FUEL 48 L + OIL 108 C lower-left; LAP 1:52.8 + delta -0.24 lower-right; hairline band. Distinct Cosworth ICD look.
- Build QA vs real dash + reference: pending.
