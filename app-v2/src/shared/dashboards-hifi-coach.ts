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
    'Live Coach cockpit with local coaching, engineer radio, proactive alerting, strategy, confidence and best-delta context.',
    ['ai', 'local-ai', 'coach', 'engineer', 'radio', 'delta', 'inputs', 'strategy', 'confidence', 'race'],
    () =>
      dashboard('AI Coach — Cockpit', 'Local AI coach + engineer cockpit.', [
        bg(),
        hifiEl('coachTip', 24, 24, 315, 195),
        hifiEl('engineerRadio', 354, 24, 315, 195),
        hifiEl('proactiveAlert', 684, 24, 316, 195),
        hifiEl('coachFindings', 24, 231, 315, 345),
        hifiEl('strategyCall', 354, 231, 315, 345),
        hifiEl('aiConfidence', 684, 231, 316, 195),
        hifiEl('deltaBest', 684, 438, 316, 138)
      ])
  ),
  comp(
    'hifi_coach_engineer_radio',
    'AI Coach — Engineer Radio',
    'Engineer-focused local AI page pairing radio calls, alerts, strategy and core stint health telemetry.',
    ['ai', 'local-ai', 'coach', 'engineer', 'radio', 'alert', 'strategy', 'fuel', 'tyres', 'position', 'stint'],
    () =>
      dashboard('AI Coach — Engineer Radio', 'Local AI engineer radio with stint health.', [
        bg(),
        hifiEl('engineerRadio', 24, 14, 646, 195),
        hifiEl('proactiveAlert', 684, 14, 316, 195),
        hifiEl('strategyCall', 24, 221, 315, 215),
        hifiEl('fuel', 354, 221, 315, 215),
        hifiEl('tyreTemp', 684, 221, 316, 215),
        hifiEl('position', 24, 448, 315, 138)
      ])
  ),
  comp(
    'hifi_coach_live_delta_coach',
    'AI Coach — Live Delta Coach',
    'Local coaching page for live lap delta, session trend, inputs and speed discipline.',
    ['ai', 'local-ai', 'coach', 'delta', 'lap-time', 'inputs', 'speed', 'practice', 'qualifying'],
    () =>
      dashboard('AI Coach — Live Delta Coach', 'Local AI live delta coaching.', [
        bg(),
        hifiEl('coachTip', 24, 24, 476, 215),
        hifiEl('speed', 512, 24, 488, 215),
        hifiEl('deltaBest', 24, 251, 315, 160),
        hifiEl('deltaSession', 351, 251, 315, 160),
        hifiEl('inputsCombo', 678, 251, 322, 220)
      ])
  ),
  comp(
    'hifi_coach_inputs_coaching',
    'AI Coach — Inputs Coaching',
    'Throttle, brake and steering coaching with local AI guidance and best-delta feedback.',
    ['ai', 'local-ai', 'coach', 'inputs', 'throttle', 'brake', 'steering', 'delta', 'driver-development'],
    () =>
      dashboard('AI Coach — Inputs Coaching', 'Local AI input trace coaching.', [
        bg(),
        hifiEl('coachTip', 24, 24, 476, 195),
        hifiEl('inputsBrakeThrottle', 512, 24, 488, 220),
        hifiEl('throttle', 24, 256, 150, 220),
        hifiEl('brake', 186, 256, 150, 220),
        hifiEl('steering', 348, 256, 180, 220),
        hifiEl('deltaBest', 540, 256, 460, 220)
      ])
  ),
  comp(
    'hifi_coach_braking_coach',
    'AI Coach — Braking Coach',
    'Braking-focused local AI composition combining tip, temperatures, input overlay, g-force and best delta.',
    ['ai', 'local-ai', 'coach', 'braking', 'brake-temp', 'inputs', 'g-force', 'delta', 'trail-braking'],
    () =>
      dashboard('AI Coach — Braking Coach', 'Local AI braking coach.', [
        bg(),
        hifiEl('coachTip', 24, 24, 476, 195),
        hifiEl('deltaBest', 512, 24, 488, 195),
        hifiEl('brakeTemp', 24, 231, 315, 315),
        hifiEl('inputsBrakeThrottle', 351, 231, 320, 220),
        hifiEl('gForce', 683, 231, 317, 315)
      ])
  ),
  comp(
    'hifi_coach_racecraft_gaps',
    'AI Coach — Racecraft Gaps',
    'Local AI racecraft page for traffic, relative gaps, proximity radar and attack/defend delta.',
    ['ai', 'local-ai', 'coach', 'racecraft', 'traffic', 'relative', 'radar', 'gap', 'overtake', 'defend'],
    () =>
      dashboard('AI Coach — Racecraft Gaps', 'Local AI racecraft and traffic coach.', [
        bg(),
        hifiEl('coachTip', 24, 24, 420, 195),
        hifiEl('gapAhead', 456, 24, 232, 195),
        hifiEl('gapBehind', 700, 24, 300, 195),
        hifiEl('relative', 24, 231, 338, 206),
        hifiEl('radar', 374, 231, 258, 258),
        hifiEl('deltaAhead', 644, 231, 356, 258)
      ])
  ),
  comp(
    'hifi_coach_strategy_board',
    'AI Coach — Strategy Board',
    'Local AI strategy board for fuel window, tyre wear, proactive calls and track position.',
    ['ai', 'local-ai', 'coach', 'strategy', 'fuel', 'fuel-window', 'tyre-wear', 'alert', 'position', 'pitwall'],
    () =>
      dashboard('AI Coach — Strategy Board', 'Local AI pitwall strategy board.', [
        bg(),
        hifiEl('strategyCall', 24, 24, 315, 195),
        hifiEl('proactiveAlert', 354, 24, 315, 195),
        hifiEl('position', 684, 24, 316, 195),
        hifiEl('fuel', 24, 231, 315, 315),
        hifiEl('fuelLaps', 354, 231, 315, 315),
        hifiEl('tyreWear', 684, 231, 316, 315)
      ])
  ),
  comp(
    'hifi_coach_proactive_watch',
    'AI Coach — Proactive Watch',
    'Local AI watch desk for confidence, weather, wetness, grip and flag-state context.',
    ['ai', 'local-ai', 'coach', 'proactive', 'alert', 'confidence', 'weather', 'wetness', 'grip', 'flag', 'safety'],
    () =>
      dashboard('AI Coach — Proactive Watch', 'Local AI proactive race watch.', [
        bg(),
        hifiEl('proactiveAlert', 24, 24, 486, 195),
        hifiEl('aiConfidence', 522, 24, 478, 195),
        hifiEl('weather', 24, 231, 232, 345),
        hifiEl('wetness', 268, 231, 232, 345),
        hifiEl('grip', 512, 231, 232, 345),
        hifiEl('flag', 756, 231, 232, 345)
      ])
  ),
  comp(
    'hifi_coach_confidence_focus',
    'AI Coach — Confidence Focus',
    'Findings-led local AI view with confidence, primary coach tip and best-delta signal.',
    ['ai', 'local-ai', 'coach', 'confidence', 'findings', 'coach-tip', 'delta', 'analysis', 'trust'],
    () =>
      dashboard('AI Coach — Confidence Focus', 'Local AI confidence and findings focus.', [
        bg(),
        hifiEl('coachFindings', 24, 24, 476, 552),
        hifiEl('aiConfidence', 512, 24, 488, 195),
        hifiEl('coachTip', 512, 231, 488, 195),
        hifiEl('deltaBest', 512, 438, 488, 138)
      ])
  ),
  comp(
    'hifi_coach_findings_review',
    'AI Coach — Findings Review',
    'Post-run local AI findings review with coach tip, session delta and position context.',
    ['ai', 'local-ai', 'coach', 'findings', 'review', 'debrief', 'delta', 'position', 'analysis'],
    () =>
      dashboard('AI Coach — Findings Review', 'Local AI findings review.', [
        bg(),
        hifiEl('coachFindings', 24, 24, 488, 552),
        hifiEl('coachTip', 524, 24, 476, 195),
        hifiEl('deltaSession', 524, 231, 232, 172),
        hifiEl('position', 768, 231, 232, 172)
      ])
  ),
  comp(
    'hifi_coach_minimal',
    'AI Coach — Minimal',
    'Minimal local AI coach composition with large readable tiles and generous negative space.',
    ['ai', 'local-ai', 'coach', 'minimal', 'negative-space', 'delta', 'confidence', 'clean', 'readable'],
    () =>
      dashboard('AI Coach — Minimal', 'Minimal local AI coach.', [
        bg(),
        hifiEl('coachTip', 120, 70, 784, 210),
        hifiEl('deltaBest', 120, 312, 376, 195),
        hifiEl('aiConfidence', 528, 312, 376, 195)
      ])
  ),
  comp(
    'hifi_coach_sector_coach',
    'AI Coach — Sector Coach',
    'Sector debrief page with local AI findings and best/session/lap timing context.',
    ['ai', 'local-ai', 'coach', 'sector', 'findings', 'delta', 'lap-time', 'best-lap', 'last-lap', 'debrief'],
    () =>
      dashboard('AI Coach — Sector Coach', 'Local AI sector coach.', [
        bg(),
        hifiEl('coachFindings', 24, 24, 420, 552),
        hifiEl('deltaBest', 456, 24, 256, 184),
        hifiEl('deltaSession', 744, 24, 256, 184),
        hifiEl('lapBest', 456, 240, 256, 184),
        hifiEl('lapLast', 744, 240, 256, 184)
      ])
  )
]
