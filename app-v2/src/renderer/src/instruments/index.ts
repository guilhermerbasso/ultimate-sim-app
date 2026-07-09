// ═══════════════════════════════════════════════════════════════════════════════
//  @yesx/instruments — token-driven React + SVG instrument-primitive library
// ───────────────────────────────────────────────────────────────────────────────
//  Brand-neutral, high-fidelity SVG primitives for the real-race-car visual rebuild
//  of the dashboard widgets. Every primitive is PURE, unit-testable (renders via
//  createElement + renderToStaticMarkup) and NaN-safe (null/extreme telemetry never
//  produces NaN/undefined markup). Glow (feGaussianBlur bloom) is reserved for LEDs
//  and active alerts; warm chrome carries decoration; cool/green = good STATE only.
//
//  This barrel is the STABLE CONTRACT consumed by the downstream render-layer
//  agents. Import primitives + their prop types from here only.
//
//  ── Primitives & prop APIs ────────────────────────────────────────────────────
//   RevLedBar      <RevLedBar pct segments? shape? width? height? gap? warnAt?
//                    dangerAt? flashAt? redlineFlash? flashOn? zones? glow? bloom?
//                    colors? />
//                  Individually-modelled LEDs (dark stroke + diffuse off muscle +
//                  radial on dome + feGaussianBlur bloom overflowing the LED radius);
//                  green→amber→red zones + redline flash.
//
//   AnalogDial     <AnalogDial value min? max? size? startAngleDeg? endAngleDeg?
//                    majorTicks? minorPerMajor? unit? label? showValue? decimals?
//                    showTicks? bezel? material? needleColor? damp? warnFrom?
//                    redlineFrom? colors? />
//                  Anti-aliased circular gauge (d3-shape arc) composing BezelRing +
//                  TickScale + Needle; any sweep angle; optional damped needle;
//                  out-of-range value clamps the needle to the sweep ends.
//
//   BezelRing      <BezelRing size thickness? kind? material? colors? />
//   TickScale      <TickScale cx cy radius startAngleDeg endAngleDeg majorTicks?
//                    minorPerMajor? min? max? color? labelColor? showLabels?
//                    majorLen? minorLen? decimals? />
//   Needle         <Needle cx cy length angleDeg color? width? tail? hubRadius? />
//
//   SegmentReadout <SegmentReadout value mode? digits? ghost? decimals? color?
//                    ghostColor? height? width? align? unit? label? />
//                  DSEG 7/14-seg readout reusing the embedded DSEG fonts; numerals
//                  → 7-seg, letters → 14-seg/condensed.
//
//   TelltaleIcon   <TelltaleIcon icon active? size? activeColor? inactiveColor?
//                    glow? label? />
//   TelltaleBank   <TelltaleBank lamps[] size? gap? columns? glow? />
//                  FIA/warning lamps reusing icons/motorsport; glow only when lit.
//
//   DataTile       <DataTile label? value unit? width? height? color? accent?
//                    material? align? numeric? decimals? colors? />
//   AlarmStrip     <AlarmStrip alarms[] width? height? gap? glow? colors? />
//
//  ── Tokens / helpers ──────────────────────────────────────────────────────────
//   INSTRUMENT_COLORS, resolveColors(), revZoneColor(), materialFill(),
//   bloomFilter(), clamp/clamp01/fraction/safe/fmtNum/dampStep, FONT_SEG7 …
//   MaterialKind = 'matte' | 'carbon' | 'brushed'; BezelKind = 'none' | 'thin' |
//   'chrome' | 'double'.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Primitives ────────────────────────────────────────────────────────────────
export { RevLedBar } from './RevLedBar'
export type { RevLedBarProps, LedShape } from './RevLedBar'

export { AnalogDial } from './AnalogDial'
export type { AnalogDialProps } from './AnalogDial'

export { BezelRing } from './BezelRing'
export type { BezelRingProps } from './BezelRing'

export { TickScale, pointOnArc } from './TickScale'
export type { TickScaleProps } from './TickScale'

export { Needle } from './Needle'
export type { NeedleProps } from './Needle'

export { SegmentReadout } from './SegmentReadout'
export type { SegmentReadoutProps, SegmentMode } from './SegmentReadout'

export { TelltaleIcon, TelltaleBank } from './TelltaleIcon'
export type { TelltaleIconProps, TelltaleBankProps, TelltaleLamp } from './TelltaleIcon'

export { DataTile, AlarmStrip } from './DataTile'
export type { DataTileProps, AlarmStripProps, AlarmChip } from './DataTile'

// ── Tokens, materials, glow, helpers ──────────────────────────────────────────
export {
  INSTRUMENT_COLORS,
  resolveColors,
  revZoneColor,
  isNumericReadout,
  safe,
  clamp,
  clamp01,
  fraction,
  fmtNum,
  deg2rad,
  dampStep,
  FONT_SEG7,
  FONT_SEG14,
  FONT_COND,
  FONT_TECH
} from './tokens'
export type { InstrumentColors, MaterialKind, BezelKind } from './tokens'

export { materialFill, bloomFilter, ledOnGradient, ledOffGradient, bezelGradient, useUid } from './defs'
export type { MaterialFill } from './defs'

// ── Optional generated-asset manifest (procedural fallback always available) ──
export { getInstrumentAsset, hasInstrumentAssets } from './assets'
export type { InstrumentAsset, InstrumentAssetManifest } from './assets'

// ── v2.39 skin-aware building blocks (nested-svg, consume a SkinToken) ────────
export { BarGraph } from './BarGraph'
export type { BarGraphProps } from './BarGraph'
export { DataField } from './DataField'
export type { DataFieldProps, FieldState } from './DataField'
