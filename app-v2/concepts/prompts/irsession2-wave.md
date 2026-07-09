# irSession2 wave

Reference-driven hi-fi iRacing session widgets: transparent, title-less SVG readouts using the app hi-fi kit fonts and legibility strokes.

References copied to `concepts/refs/`:
- `ref-ir-sof.png` — cyan outlined Strength of Field numeral with small SoF tag.
- `ref-ir-clock.png` — cyan-white digital time with compact sun glyph.
- `ref-ir-ballast.png` — amber ballast icon, signed weight and kg unit.
- `ref-ir-poweradj.png` — large signed power adjustment percentage, red for cuts and green for boosts.

Implementation target: `src/renderer/src/hifi/widgets/irSession2/` with four clean session-category widgets: `strengthOfField`, `timeOfDay`, `weightPenalty`, and `powerAdjust`.
