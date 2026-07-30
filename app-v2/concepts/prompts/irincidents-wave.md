# irIncidents reference prompt

Create transparent-background, hi-fi motorsport telemetry widgets for iRacing incident and fast-repair damage counters. Style: clean Bosch DDU/MoTeC-inspired SVG readouts, no panel, no border, no title, highly legible over cockpit video. Undefined states use an em dash and no fake data.

- `incidentsMine`: huge centered personal count like `4x`, with a smaller dim `/ 17x` limit below only when a positive limit exists. Normal state is bright white/cyan glow; above 75% of the limit turns amber; at/over the limit turns red with a warning triangle.
- `incidentsTeam`: team incident count like `9x`, distinguished by a small people/team glyph.
- `fastRepairs`: cyan wrench glyph next to a huge available count, with pips underneath: available repairs lit cyan, used repairs dim grey.

References copied into `concepts/refs/`: `ref-ir-incidents.png`, `ref-ir-fastrepair.png`.
