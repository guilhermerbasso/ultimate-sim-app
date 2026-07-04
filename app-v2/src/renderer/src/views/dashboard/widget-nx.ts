// nx() + gt3() widget-variant factory extracted into its own module so that the
// v2.40 extra-widget files can import `nx` WITHOUT creating a runtime import cycle
// with widget-catalog-data.ts (which imports those extra arrays). The only edge
// back to widget-catalog-data here is a TYPE import (WidgetVariant), which is
// erased at runtime — so no circular value dependency / TDZ crash.
import type { DashboardElement, DashboardElementType } from '../../../../shared/dashboards'
import type { WidgetCategoryTag, WidgetStyleFamily } from '../../../../shared/widget-taxonomy'
import type { WidgetVariant } from './widget-catalog-data'

// Surfaces match the live GT3 widgets: matte black panels with a hairline stroke.
export const GT3_PANEL = '#000000'
export const GT3_STROKE = '#1F1F1F'
export const TEXT_FG = '#f6fbff'

export function gt3(extra: Partial<DashboardElement['style']> = {}): DashboardElement['style'] {
  // No `fontFamily`: the value font is chosen by CONTENT (numeric→DSEG, text→condensed).
  return { background: GT3_PANEL, border: GT3_STROKE, borderWidth: 1, radius: 12, color: TEXT_FG, ...extra }
}

// Curated catalog variant. Carries explicit category + styleFamily + tags and binds
// real telemetry. `style` is merged onto the shared GT3 matte-black chrome.
export function nx(
  id: string,
  label: string,
  type: DashboardElementType,
  w: number,
  h: number,
  category: WidgetCategoryTag,
  styleFamily: WidgetStyleFamily,
  binding: string | undefined,
  style: Partial<DashboardElement['style']>,
  tags: string[] = [],
  missing?: string
): WidgetVariant {
  return { id, label, type, w, h, binding, category, styleFamily, tags, missing, style: gt3({ minFontSize: 10, ...style }) }
}
