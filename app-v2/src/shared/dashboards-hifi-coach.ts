// ─── Hi-fi COACH / ENGINEER composition dashboards ────────────────────────────
// Clean v4 coach screens: black backplate, corner-to-corner rev strip, then
// self-explanatory hi-fi widgets only. The AI widgets are LOCAL — no GPU, no cost.
import { bg, comp, dashboard, hifiEl, revTop, type HifiCompPreset } from './dashboards-hifi-kit'

export const HIFI_COACH_PRESETS: HifiCompPreset[] = [
  comp(
    'hifi_coach_live_delta',
    'AI Coach — Live Delta',
    'Live delta coaching with speed, alerts, session delta and input trace context.',
    ['ai', 'local-ai', 'coach', 'delta', 'lap-time', 'inputs', 'speed', 'practice', 'qualifying', 'clean-v4', 'rev-top'],
    () =>
      dashboard('AI Coach — Live Delta', 'Local AI live-delta coaching with rev-top telemetry.', [
        bg(),
        revTop(),
        hifiEl('coachTip', 24, 112, 315, 215),
        hifiEl('speedGear', 351, 112, 315, 215),
        hifiEl('proactiveAlert', 678, 112, 322, 215),
        hifiEl('deltaBest', 24, 339, 315, 237),
        hifiEl('deltaSession', 351, 339, 315, 237),
        hifiEl('inputsCombo', 678, 339, 322, 237)
      ])
  ),
  comp(
    'hifi_coach_braking',
    'AI Coach — Braking',
    'Braking coach combining AI cues with brake temperatures, input overlay, g-force and delta.',
    ['ai', 'local-ai', 'coach', 'braking', 'brake-temp', 'inputs', 'g-force', 'delta', 'trail-braking', 'clean-v4', 'rev-top'],
    () =>
      dashboard('AI Coach — Braking', 'Local AI braking coach with rev-top telemetry.', [
        bg(),
        revTop(),
        hifiEl('coachTip', 24, 112, 315, 195),
        hifiEl('deltaBest', 351, 112, 315, 195),
        hifiEl('proactiveAlert', 678, 112, 322, 195),
        hifiEl('brakeTemp', 24, 319, 315, 257),
        hifiEl('inputsBrakeThrottle', 351, 319, 315, 257),
        hifiEl('gForce', 678, 319, 322, 257)
      ])
  ),
  comp(
    'hifi_coach_inputs',
    'AI Coach — Inputs',
    'Throttle, brake and steering coaching with input traces, confidence and best-delta feedback.',
    ['ai', 'local-ai', 'coach', 'inputs', 'throttle', 'brake', 'steering', 'delta', 'driver-development', 'clean-v4', 'rev-top'],
    () =>
      dashboard('AI Coach — Inputs', 'Local AI input-trace coaching with rev-top telemetry.', [
        bg(),
        revTop(),
        hifiEl('coachTip', 24, 112, 315, 195),
        hifiEl('inputsBrakeThrottle', 351, 112, 315, 195),
        hifiEl('deltaBest', 678, 112, 322, 195),
        hifiEl('throttle', 24, 319, 180, 257),
        hifiEl('brake', 216, 319, 180, 257),
        hifiEl('steering', 408, 319, 240, 257),
        hifiEl('aiConfidence', 660, 319, 340, 257)
      ])
  ),
  comp(
    'hifi_coach_sector',
    'AI Coach — Sector',
    'Sector debrief with AI findings and best/session/last/current lap timing context.',
    ['ai', 'local-ai', 'coach', 'sector', 'findings', 'delta', 'lap-time', 'best-lap', 'last-lap', 'debrief', 'clean-v4', 'rev-top'],
    () =>
      dashboard('AI Coach — Sector', 'Local AI sector coach with rev-top telemetry.', [
        bg(),
        revTop(),
        hifiEl('coachFindings', 24, 112, 420, 464),
        hifiEl('deltaBest', 456, 112, 256, 184),
        hifiEl('deltaSession', 744, 112, 256, 184),
        hifiEl('lapBest', 456, 308, 256, 184),
        hifiEl('lapLast', 744, 308, 256, 184)
      ])
  ),
  comp(
    'hifi_coach_racecraft_gaps',
    'AI Coach — Racecraft Gaps',
    'Racecraft coach for traffic, relative gaps, proximity radar and attack/defend delta.',
    ['ai', 'local-ai', 'coach', 'racecraft', 'traffic', 'relative', 'radar', 'gap', 'overtake', 'defend', 'clean-v4', 'rev-top'],
    () =>
      dashboard('AI Coach — Racecraft Gaps', 'Local AI racecraft and traffic coach with rev-top telemetry.', [
        bg(),
        revTop(),
        hifiEl('coachTip', 24, 112, 315, 195),
        hifiEl('gapAhead', 351, 112, 315, 195),
        hifiEl('gapBehind', 678, 112, 322, 195),
        hifiEl('relative', 24, 319, 338, 257),
        hifiEl('radar', 374, 319, 258, 257),
        hifiEl('deltaAhead', 644, 319, 356, 257)
      ])
  ),
  comp(
    'hifi_coach_confidence_focus',
    'AI Coach — Confidence Focus',
    'Findings-led view with AI confidence and live best/session delta telemetry.',
    ['ai', 'local-ai', 'coach', 'confidence', 'findings', 'delta', 'analysis', 'trust', 'clean-v4', 'rev-top'],
    () =>
      dashboard('AI Coach — Confidence Focus', 'Local AI confidence and findings focus with rev-top telemetry.', [
        bg(),
        revTop(),
        hifiEl('coachFindings', 24, 112, 420, 464),
        hifiEl('aiConfidence', 456, 112, 544, 195),
        hifiEl('deltaBest', 456, 319, 256, 257),
        hifiEl('deltaSession', 744, 319, 256, 257)
      ])
  ),
  comp(
    'hifi_coach_engineer_radio',
    'AI Coach — Engineer Radio',
    'Engineer radio page pairing AI calls with alerts, strategy, fuel and tyre temperature.',
    ['ai', 'local-ai', 'coach', 'engineer', 'radio', 'alert', 'strategy', 'fuel', 'tyres', 'stint', 'clean-v4', 'rev-top'],
    () =>
      dashboard('AI Coach — Engineer Radio', 'Local AI engineer radio with rev-top stint telemetry.', [
        bg(),
        revTop(),
        hifiEl('engineerRadio', 24, 112, 646, 195),
        hifiEl('proactiveAlert', 682, 112, 318, 195),
        hifiEl('strategyCall', 24, 319, 315, 257),
        hifiEl('fuel', 351, 319, 315, 257),
        hifiEl('tyreTemp', 678, 319, 322, 257)
      ])
  ),
  comp(
    'hifi_coach_findings_review',
    'AI Coach — Findings Review',
    'Post-run findings review with coach tip, session delta and position context.',
    ['ai', 'local-ai', 'coach', 'findings', 'review', 'debrief', 'delta', 'position', 'analysis', 'clean-v4', 'rev-top'],
    () =>
      dashboard('AI Coach — Findings Review', 'Local AI findings review with rev-top telemetry.', [
        bg(),
        revTop(),
        hifiEl('coachFindings', 24, 112, 476, 464),
        hifiEl('coachTip', 512, 112, 488, 195),
        hifiEl('deltaSession', 512, 319, 232, 257),
        hifiEl('position', 756, 319, 244, 257)
      ])
  ),
  comp(
    'hifi_coach_minimal',
    'AI Coach — Minimal',
    'Minimal coach surface with one large cue, best delta and AI confidence.',
    ['ai', 'local-ai', 'coach', 'minimal', 'negative-space', 'delta', 'confidence', 'clean', 'readable', 'clean-v4', 'rev-top'],
    () =>
      dashboard('AI Coach — Minimal', 'Minimal local AI coach with rev-top telemetry.', [
        bg(),
        revTop(),
        hifiEl('coachTip', 120, 132, 784, 210),
        hifiEl('deltaBest', 120, 374, 376, 195),
        hifiEl('aiConfidence', 528, 374, 376, 195)
      ])
  ),
  comp(
    'hifi_coach_ferrari_delta',
    'Ferrari Coach — Delta Attack',
    'Ferrari-themed delta attack page with signature cluster, coach cue, delta and position.',
    ['ai', 'local-ai', 'coach', 'themed', 'car', 'ferrari', 'cluster', 'delta', 'position', 'clean-v4', 'rev-top'],
    () =>
      dashboard('Ferrari Coach — Delta Attack', 'Ferrari-themed AI coach with rev-top cluster telemetry.', [
        bg(),
        revTop('revThemedFerrari'),
        hifiEl('clusterFerrari', 24, 132, 460, 300),
        hifiEl('coachTip', 496, 132, 504, 195),
        hifiEl('deltaBest', 496, 339, 244, 184),
        hifiEl('position', 752, 339, 248, 184)
      ])
  ),
  comp(
    'hifi_coach_porsche_stint',
    'Porsche Coach — Stint Rhythm',
    'Porsche-themed stint page with signature cluster, engineer radio and tyre temperature.',
    ['ai', 'local-ai', 'coach', 'themed', 'car', 'porsche', 'cluster', 'engineer', 'radio', 'tyres', 'clean-v4', 'rev-top'],
    () =>
      dashboard('Porsche Coach — Stint Rhythm', 'Porsche-themed AI coach with rev-top cluster telemetry.', [
        bg(),
        revTop('revThemedPorsche'),
        hifiEl('clusterPorsche', 24, 132, 460, 300),
        hifiEl('engineerRadio', 496, 132, 504, 195),
        hifiEl('tyreTemp', 496, 339, 504, 237)
      ])
  ),
  comp(
    'hifi_coach_amg_brake_trace',
    'AMG Coach — Brake Trace',
    'AMG-themed brake-trace page with signature cluster, proactive alert and brake/throttle trace.',
    ['ai', 'local-ai', 'coach', 'themed', 'car', 'amg', 'cluster', 'alert', 'inputs', 'braking', 'clean-v4', 'rev-top'],
    () =>
      dashboard('AMG Coach — Brake Trace', 'AMG-themed AI coach with rev-top cluster telemetry.', [
        bg(),
        revTop('revThemedAmg'),
        hifiEl('clusterAmg', 24, 132, 460, 300),
        hifiEl('proactiveAlert', 496, 132, 504, 195),
        hifiEl('inputsBrakeThrottle', 496, 339, 504, 237)
      ])
  )
]
