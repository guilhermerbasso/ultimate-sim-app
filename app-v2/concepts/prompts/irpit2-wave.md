# irPit2 reference prompt

Create transparent-background, hi-fi motorsport telemetry pit-service widgets for iRacing. Style: clean Bosch DDU/MoTeC-inspired SVG badges, no panel, no border, no title, highly legible over cockpit video. Active states glow strongly; off/null states remain visibly dim.

- Pit road: large amber `PIT` badge in a rounded transparent pill, glowing when `onPitRoad` or `pitLimiter` is true. Include a compact speed-limiter gauge mark only when the limiter is active.
- Pit service: compact cyan checklist with fuel plus LF/RF/LR/RR tyres. Requested service items are bright cyan with check marks; non-requested items are muted grey.
- Pit status: compact condition-badge layout for `PITS OPEN`/`PITS CLOSED`, `IN STALL`, and `REPAIR`; undefined pit state uses dim `—`.

References copied into `concepts/refs/`: `ref-ir-pitroad.png`, `ref-ir-pitservice.png`.
