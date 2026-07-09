// ── Widget matrix ─────────────────────────────────────────────────────────────
// The factory: cross every telemetry VARIABLE with every visual FORM to produce a
// large, auditable catalogue of widgets. Each spec has a stable id `<variable>.<form>`
// so dashboards/overlays can reference a widget by intent (what + how) rather than
// hand-coding hundreds of components.
import { WIDGET_FORMS, WIDGET_FORM_LABELS, type WidgetForm } from './forms'
import { WIDGET_VARIABLES, WIDGET_VARIABLES_BY_ID, type VarGroup, type WidgetVariable } from './variables'

export interface WidgetSpec {
  /** Stable id: `<variableId>.<form>` (e.g. `speed.gauge`). */
  id: string
  variableId: string
  form: WidgetForm
  /** Human label, e.g. "Speed — Gauge". */
  label: string
  group: VarGroup
}

function buildSpecs(): WidgetSpec[] {
  const specs: WidgetSpec[] = []
  for (const v of WIDGET_VARIABLES) {
    for (const form of WIDGET_FORMS) {
      specs.push({
        id: `${v.id}.${form}`,
        variableId: v.id,
        form,
        label: `${v.label} — ${WIDGET_FORM_LABELS[form]}`,
        group: v.group
      })
    }
  }
  return specs
}

/** Every widget the factory can produce (variables × forms). */
export const ALL_WIDGET_SPECS: WidgetSpec[] = buildSpecs()

export const WIDGET_SPECS_BY_ID: Record<string, WidgetSpec> = Object.fromEntries(
  ALL_WIDGET_SPECS.map((s) => [s.id, s])
)

/** Total widget count produced by the factory. */
export const WIDGET_COUNT = ALL_WIDGET_SPECS.length

/** Forms available for a given variable id (all forms apply to every variable). */
export function formsForVariable(variableId: string): WidgetForm[] {
  return WIDGET_VARIABLES_BY_ID[variableId] ? [...WIDGET_FORMS] : []
}

/** All specs for one variable id. */
export function specsForVariable(variableId: string): WidgetSpec[] {
  return ALL_WIDGET_SPECS.filter((s) => s.variableId === variableId)
}

export function resolveSpecVariable(spec: WidgetSpec): WidgetVariable | undefined {
  return WIDGET_VARIABLES_BY_ID[spec.variableId]
}
