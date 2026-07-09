# irSessionInfo wave

Create a clean transparent hi-fi iRacing session-info widget group with four title-less SVG widgets:

- `sessionState`: bold uppercase state badge decoded through `sessionStateLabel(raw)`, with a small flag glyph. Racing is green; other known states are amber; missing is `—`.
- `paceMode`: uppercase pace badge decoded through `paceModeLabel(raw)`, with chevrons, a small pace-car glyph, and optional decoded pace flags via `paceFlagsList(raw)`. Active pacing is amber; missing is `—`.
- `carInfo`: auto-fitting car name readout, falling back to the `carPath` slug, with `—` for missing data.
- `trackInfo`: auto-fitting track name with a smaller second-line layout/config when present, with `—` for missing data.

References copied into `concepts/refs/`:

- `ref-ir-sessionstate.png`
- `ref-ir-pace.png`
