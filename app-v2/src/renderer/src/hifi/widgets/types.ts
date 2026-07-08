// ── Hi-fi widget module contract ──────────────────────────────────────────────
// A self-registering, per-telemetry widget/overlay. Each module is ONE small
// component that shows a single piece of information (or a few of the same
// category), usable BOTH as a floating overlay and as a dashboard widget. Modules
// live in per-category folders (hifi/widgets/<group>/) and each group exports an
// array; the registry aggregates them WITHOUT touching any shared union, so groups
// can be built fully in parallel with zero registration conflicts.
import type { ReactElement } from 'react'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'

export type TelemetryField = keyof TelemetrySnapshot

export interface HifiWidgetProps {
  /** Live telemetry (null → render em-dashes, never fake data). */
  snapshot: TelemetrySnapshot | null
  /** Pixel box to fill; the module renders an SVG with its own viewBox and scales. */
  width?: number
  height?: number
}

export interface HifiWidgetModule {
  /** Stable id, unique across ALL groups (e.g. 'speed', 'tyreTempFL', 'deltaAhead'). */
  id: string
  /** English display title. */
  title: string
  /** Short English description. */
  description: string
  /** Category tag (e.g. 'inputs','timing','tyres','fuel','map','delta','gap'). */
  category: string
  /** Style/extra tags (e.g. 'gauge','led','bar','clean','pixel'). Sim tags are added
   *  automatically from `requires` by the registry. */
  tags: string[]
  /** Telemetry fields used → drives auto sim-tags and the per-sim availability. */
  requires: TelemetryField[]
  /** Logical aspect (used for default overlay/widget size). */
  defaultSize: { w: number; h: number }
  /** Pure, SSR-safe SVG render (renderToStaticMarkup-compatible, NaN-safe). */
  render: (props: HifiWidgetProps) => ReactElement
}
