// ── MatrixWidget ──────────────────────────────────────────────────────────────
// Thin React wrapper that renders a WidgetSpec (or a raw variable+form) against a
// telemetry snapshot. This is the single component dashboards/overlays mount to
// show any factory widget. Pure + SSR-safe (delegates to renderForm).
import { type ReactElement } from 'react'
import type { InstrumentColors } from '../instruments/tokens'
import { renderForm } from './renderForm'
import { resolveSpecVariable, WIDGET_SPECS_BY_ID, type WidgetSpec } from './matrix'
import { WIDGET_VARIABLES_BY_ID } from './variables'
import type { WidgetForm } from './forms'
import type { TelemetrySnapshot } from '../../../shared/telemetry'

export interface MatrixWidgetProps {
  /** Either a full spec, or a spec id like `speed.gauge`. */
  spec?: WidgetSpec
  specId?: string
  /** Or address the widget by its parts. */
  variableId?: string
  form?: WidgetForm
  snapshot: TelemetrySnapshot
  width?: number
  height?: number
  colors?: Partial<InstrumentColors>
}

export function MatrixWidget({
  spec,
  specId,
  variableId,
  form,
  snapshot,
  width,
  height,
  colors
}: MatrixWidgetProps): ReactElement | null {
  const resolved = spec ?? (specId ? WIDGET_SPECS_BY_ID[specId] : undefined)
  const variable = resolved ? resolveSpecVariable(resolved) : variableId ? WIDGET_VARIABLES_BY_ID[variableId] : undefined
  const chosenForm = resolved?.form ?? form
  if (!variable || !chosenForm) return null
  return renderForm(variable, chosenForm, snapshot, { width, height, colors })
}
