# irConditions2 reference prompt

Create transparent-background, hi-fi motorsport telemetry condition tell-tales for iRacing weather and track surface widgets. Style: clean Bosch DDU/MoTeC-inspired SVG badges, no panel, no border, no title, highly legible over cockpit video. On states must glow strongly; off states must be visibly dim.

- Rain state: cyan glowing outline rain cloud with three drops and compact `WET` state word; dry state is the same composition dimmed grey with `DRY`.
- Wet declared: distinct amber steward/flag badge, not a cloud, glowing only when wet is declared; state text `WET DECLARED`.
- Track surface: cyan label with a small matching glyph, especially a red/white kerb slab for `KERB`; undefined state uses `—`.

References copied into `concepts/refs/`: `ref-ir-rain.png`, `ref-ir-surface.png`.
