// ── Widget forms ──────────────────────────────────────────────────────────────
// The visual FORMS a telemetry variable can be shown in. The factory crosses every
// variable with these forms, so each piece of information has many ways to be read
// (bar, gauge, text, LED, 32-bit pixel, …) — well beyond the "≥5 forms" bar.
export const WIDGET_FORMS = [
  'bignum', // big numeric readout (SVG text)
  'segment7', // DSEG 7/14-segment LCD readout
  'bar', // horizontal bar
  'barv', // vertical bar
  'gauge', // analog dial / needle
  'led', // rev/LED segment bar
  'pixel32', // retro 32-bit pixel-matrix
  'tile', // material data tile
  'ring' // radial ring (d3-shape arc)
] as const

export type WidgetForm = (typeof WIDGET_FORMS)[number]

export const WIDGET_FORM_LABELS: Record<WidgetForm, string> = {
  bignum: 'Big Number',
  segment7: '7-Segment',
  bar: 'Bar',
  barv: 'Vertical Bar',
  gauge: 'Gauge',
  led: 'LED Bar',
  pixel32: '32-bit Pixel',
  tile: 'Data Tile',
  ring: 'Radial Ring'
}
