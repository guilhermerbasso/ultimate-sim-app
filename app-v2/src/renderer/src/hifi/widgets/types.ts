// ── Hi-fi widget module contract ──────────────────────────────────────────────
// A self-registering, per-telemetry widget/overlay. Each module is ONE small
// component that shows a single piece of information (or a few of the same
// category), usable BOTH as a floating overlay and as a dashboard widget. Modules
// live in per-category folders (hifi/widgets/<group>/) and each group exports an
// array; the registry aggregates them WITHOUT touching any shared union, so groups
// can be built fully in parallel with zero registration conflicts.
import type { ReactElement } from 'react'
import type { AlertsConfig } from '../../../../shared/alerts'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import type {
  OverlayRole,
  OverlayTrigger,
  OverlayTriggerResult
} from '../../../../shared/overlays'
import type { UnitSystem } from '../../../../shared/units'
import type { TelemetryRequirement } from '../../../../shared/sim-coverage'

export type TelemetryField = keyof TelemetrySnapshot
export type HifiTelemetryRequirement = TelemetryRequirement

/** Severity used by AI coach findings / alerts. */
export type HifiAiSeverity = 'low' | 'med' | 'high'

/**
 * Optional AI view-model fed to AI-powered widgets (coach/engineer). It is a
 * renderer-side, decoupled snapshot of the local AI engines (coach, ai-engineer,
 * proactive-engineer) — the widget layer never imports main-process modules. When
 * absent (SSR/tests/no AI running) AI widgets render placeholders, never fake data.
 */
export interface HifiAiContext {
  /** Single most-relevant coaching cue for the current moment. */
  coachTip?: { text: string; corner?: string; confidence?: number } | null
  /** Ranked driving-improvement findings. */
  coachFindings?: { label: string; severity: HifiAiSeverity }[] | null
  /** Latest race-engineer radio message. */
  engineerRadio?: { text: string; at?: number } | null
  /** Latest proactive alert. */
  proactiveAlert?: { text: string; level?: 'info' | 'warn' | 'crit' } | null
  /** Strategy call (e.g. pit window). */
  strategy?: { text: string; pitInLaps?: number } | null
  /** Overall AI confidence 0..1. */
  confidence?: number | null
}

export interface HifiWidgetProps {
  /** Live telemetry (null → render em-dashes, never fake data). */
  snapshot: TelemetrySnapshot | null
  /** Optional AI view-model for AI-powered widgets (absent → placeholders). */
  ai?: HifiAiContext | null
  /** Pixel box to fill; the module renders an SVG with its own viewBox and scales. */
  width?: number
  height?: number
  /** Active global display units. Canonical telemetry remains metric. */
  unitSystem?: UnitSystem
  /** Runtime trigger phase; preview/runtime controllers are isolated. */
  visibility?: OverlayTriggerResult
  /** Persisted alert policy used by trigger-aware widgets. */
  alertsConfig?: AlertsConfig
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
  /** Telemetry fields used → drives auto yes-tags and the per-yes availability. */
  requires: HifiTelemetryRequirement[]
  /** Alternative AND-groups. The widget is available when `requires` OR any group is covered. */
  alternativeRequires?: HifiTelemetryRequirement[][]
  /** Logical aspect (used for default overlay/widget size). */
  defaultSize: { w: number; h: number }
  /** v4: default visibility trigger for spotter-style trigger-only overlays. When
   *  set (and not 'always'), the overlay is shown ONLY while the trigger fires,
   *  unless the user overrides it in the overlay config. */
  defaultTrigger?: OverlayTrigger
  role?: OverlayRole
  preview?: 'simulated-active-sequence'
  catalogOrder?: number
  releasedAt?: string
  priority?: number
  /** Pure, SSR-safe SVG render (renderToStaticMarkup-compatible, NaN-safe). */
  render: (props: HifiWidgetProps) => ReactElement
}
