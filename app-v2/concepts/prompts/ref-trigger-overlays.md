# ref-trigger-overlays  (overlay set)
Reference: refs/ref-trigger-overlays.png

## Purpose
Design target for the 6 TRIGGER-ONLY overlays that stay hidden until their condition fires (spotter-style):
car left / car right arrow, radar-on-proximity, shift-LED flash, pit-limiter, flag alert, low-fuel.

## American-English prompt (validated)
High-fidelity sim-racing HUD REFERENCE SHEET on a pure black background, arranged as a clean 2x3 grid of six
independent trigger overlays, each shown in its ACTIVE (triggered) state, flat front-on UI, no car body, no rims:
(1) CAR-LEFT / CAR-RIGHT SPOTTER ARROW — a single bold amber chevron arrow glowing on the left edge and another on the
right edge, semi-transparent, no panel, no text; means a car is alongside.
(2) RADAR PROXIMITY — a minimal top-down radar: your car as a cyan rounded rectangle in the center with 2-3 rival dots
(one red dot very close) inside a faint thin ring; no panel fill.
(3) SHIFT LED FLASH — a full-width thin horizontal LED strip flashing bright blue/white at the shift point, soft glow,
edge to edge, no text.
(4) PIT LIMITER — a compact pulsing indicator: a pit-lane / speed-limiter glyph with an amber pulsing outline, single
small word LIMITER, minimal.
(5) FLAG ALERT — a single waving racing flag shown in yellow (caution), clean vector waving cloth, soft glow, no pole
clutter.
(6) LOW FUEL — an amber fuel-pump glyph with a large laps-to-empty number and a tiny LAPS unit, warning glow.
Pure black (transparent-looking) background, NO frames, NO borders, NO drop-shadow boxes; thin gray guide caption under
each cell. Emissive neon-on-black motorsport aesthetic, crisp, high contrast. US English only.

## Checklist notes
- Subject: 6 trigger overlays in active state (spotter arrows, radar, shift flash, pit limiter, flag, low fuel).
- Data/values: amber alongside arrows; red = closest radar car; blue/white shift flash; amber limiter/fuel; yellow flag.
- Layout/sizing: 2x3 grid, each cell a compact edge/HUD element; shift strip is full-width thin.
- Theme: clean endurance/GT3 sim HUD, minimal chrome, emissive on black.
- Color rules: amber = spotter/limiter/fuel warning, red = imminent radar contact, blue/white = shift now, yellow = caution flag.
- AVOID (app output): no titles/panels, transparent bg, no borders, no clipping/overlap (reference captions are guide-only).

## QA outcome
- Image QA: pass — all 6 states distinct & clean on black (amber L/R chevrons, radar with red proximity dot + cyan
  ego car, blue/white edge-to-edge shift flash, amber LIMITER glyph, yellow waving flag, amber low-fuel pump + laps).
- Build QA vs ref: pending (v4-trigger-overlays agent).
