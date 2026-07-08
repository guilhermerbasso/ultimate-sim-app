// ── @simx/widgets2 — telemetry widget-matrix factory ──────────────────────────
// A declarative "variable × form" factory: every telemetry channel the app exposes
// can be shown in many visual forms (bar, gauge, 7-seg, LED, 32-bit pixel, ring,
// tile, big number, …). Built on the SSR-safe @simx/instruments primitives + the
// new Pixel32, so the whole catalogue renders under renderToStaticMarkup, NaN-safe.
//
// This is the STABLE CONTRACT the overlay/dashboard catalogues consume.
export { Pixel32 } from './Pixel32'
export type { Pixel32Props } from './Pixel32'

export { WIDGET_FORMS, WIDGET_FORM_LABELS } from './forms'
export type { WidgetForm } from './forms'

export {
  WIDGET_VARIABLES,
  WIDGET_VARIABLES_BY_ID,
  readVariable
} from './variables'
export type { WidgetVariable, VarGroup, Reading, ReadingState } from './variables'

export { renderForm } from './renderForm'
export type { RenderFormOptions } from './renderForm'

export {
  ALL_WIDGET_SPECS,
  WIDGET_SPECS_BY_ID,
  WIDGET_COUNT,
  formsForVariable,
  specsForVariable,
  resolveSpecVariable
} from './matrix'
export type { WidgetSpec } from './matrix'

export { MatrixWidget } from './MatrixWidget'
export type { MatrixWidgetProps } from './MatrixWidget'
