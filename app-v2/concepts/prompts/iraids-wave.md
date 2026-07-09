# irAids reference prompt

Create transparent-background, hi-fi motorsport telemetry tell-tales for iRacing driver aids and engine warning lamps. Style: clean Bosch DDU / MoTeC-inspired SVG widgets, no panel, no border, no title, highly legible over cockpit video. On states must glow amber/red strongly; off, false, null, and undefined states must be visibly dim.

- `absState`: amber ABS circular brake-assist badge with a small brake-cut percent bubble when ABS is active and cutting.
- `tcState`: amber TC traction-control badge with skid/car styling; active state glows, inactive state is the same composition dimmed.
- `handbrake`: vertical amber 0–100% fill bar, bottom-up, handbrake lever glyph, large percent value, em dash when missing.
- `engineWarnings`: compact lamp cluster using actual decoded iRacing `EngineWarnings` keys: `waterTemp`, `fuelPressure`, `oilPressure`, `oilTemp`, `stalled`, `pitLimiter`, `revLimiter`, `mandRepair`, `optRepair`. Lit lamps glow amber/red; null renders all dim.

References copied into `concepts/refs/`: `ref-ir-abs.png`, `ref-ir-tc.png`, `ref-ir-handbrake.png`, `ref-ir-enginewarn.png`.
