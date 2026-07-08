// ─── Hi-fi COACH / ENGINEER composition dashboards ────────────────────────────
// AI-driven screens built around the local Live Coach + AI Engineer widgets
// (coachTip / coachFindings / engineerRadio / proactiveAlert / strategyCall /
// aiConfidence) alongside the telemetry they reason about. Self-contained; spread
// into BUILTIN_PRESETS. The AI widgets are LOCAL — no GPU, no cost.
//
// Add presets by pushing `comp(id, name, description, tags, build)` onto
// HIFI_COACH_PRESETS. Valid widget ids come from `HIFI_WIDGETS_BY_ID`.
import { bg, comp, dashboard, hifiEl, type HifiCompPreset } from './dashboards-hifi-kit'

export const HIFI_COACH_PRESETS: HifiCompPreset[] = [
  comp(
    'hifi_coach_cockpit',
    'AI Coach — Cockpit',
    'Live Coach cockpit: latest coaching tip, findings list, AI engineer radio, proactive alert, strategy call and AI confidence, over a live delta and inputs.',
    ['ai', 'coach', 'engineer', 'delta', 'inputs', 'strategy', 'race'],
    () =>
      dashboard('AI Coach — Cockpit', 'AI coach + engineer cockpit.', [
        bg(),
        hifiEl('coachTip', 24, 24, 640, 132),
        hifiEl('engineerRadio', 24, 168, 640, 120),
        hifiEl('coachFindings', 24, 300, 640, 276),
        hifiEl('proactiveAlert', 684, 24, 300, 132),
        hifiEl('strategyCall', 684, 168, 300, 120),
        hifiEl('aiConfidence', 684, 300, 300, 132),
        hifiEl('deltaBest', 684, 444, 300, 132)
      ])
  )
]
