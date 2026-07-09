// PREDICTION dashboard widgets (WS-H, v2.39 KIT) — futuristic + minimalist
// variants that render the WS-G `PredictionsSnapshot`: catch-up ahead/behind,
// fuel-to-the-end margin, tyre wear/cliff and projected pace.
//
// Leaf-level by design (imports the skin/instrument KIT, the shared wave-16
// helpers from new-widgets-minimal and the predictions helper — never
// gt3-widgets) so it slots into the `renderGt3Widget` fallback chain without a
// cycle, exactly like new-widgets-telemetry.tsx.
//
// Data is NEVER recomputed here: every widget subscribes to the
// `predictions:snapshot` broadcast through the shared `usePredictionsSnapshot()`
// store and reuses the pure view builders in lib/predictions.ts. The telemetry
// `snapshot` prop is intentionally unused (predictions ride their own channel).
//
// Colour rule (unchanged): warm tokens (gold/amber/red) carry chrome +
// bad/under-threat states; cool green is reserved for GOOD states (closing on the
// car ahead, fuel surplus, a trusted pace). The value fill CARRIES the tone hex.
// Structural: ONE root <svg> (viewBox + preserveAspectRatio) with every value +
// label routed through the skin-aware FitText, so overflow is impossible; long
// guidance phrases use the ellipsis overflow strategy to stay legible.

import type { ReactElement } from 'react'
import type { DashboardElement } from '../../../../shared/dashboards'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { resolveElementSkin } from '../../skins'
import type { SkinToken } from '../../skins'
import { Caption, FitValue, ValueUnit, WidgetFrame, hexAlpha } from './new-widgets-minimal'
import {
  COOL_GREEN,
  GT3,
  WARM_AMBER,
  WARM_GOLD,
  WARM_RED,
  accentOf,
  clamp01,
  usesInstrument,
  TileInstrument,
  type NewWidgetProps
} from './new-widgets-kit'
import {
  type PredTone,
  type PredView,
  caughtBehindView,
  catchAheadView,
  fuelView,
  paceView,
  tireView,
  usePredictionsSnapshot
} from '../../lib/predictions'

type Variant = 'futuristic' | 'minimal'

function clampNum(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function toneColor(tone: PredTone, style: DashboardElement['style']): string {
  switch (tone) {
    case 'good':
      return COOL_GREEN
    case 'caution':
      return WARM_AMBER
    case 'alert':
      return WARM_RED
    default:
      return accentOf(style, WARM_GOLD)
  }
}

// Shared card: a caption, a big value + unit, a fill bar (segmented+glow for
// futuristic, hairline for minimal) and a one-line sub-context. Identical
// structure for all five predictions so they read consistently on a dashboard.
// The VALUE fill carries the tone hex — the colour rule tests assert on it.
function PredictionCard({
  element,
  variant,
  label,
  view
}: {
  element: DashboardElement
  variant: Variant
  label: string
  view: PredView
}): ReactElement {
  const s = element.style
  const color = view.has ? toneColor(view.tone, s) : GT3.textMuted

  if (usesInstrument(element)) {
    return (
      <TileInstrument
        element={element}
        value={view.has ? String(view.value) : '—'}
        unit={view.unit || undefined}
        label={label}
        color={view.has ? color : undefined}
      />
    )
  }

  const skin: SkinToken = resolveElementSkin(s)
  const minimal = variant === 'minimal'
  const accent = view.has ? color : accentOf(s, skin.palette.accent)
  const glowId = minimal ? undefined : `fx-${element.id}`
  const W = element.w
  const H = element.h
  const pad = clampNum(Math.min(W, H) * 0.1, 8, 14)
  const innerW = Math.max(1, W - pad * 2)
  const g = clampNum(H * 0.035, 2, 6)
  const labelH = clampNum(H * 0.2, 11, 22)
  const subH = clampNum(H * 0.16, 10, 18)
  const barH = minimal ? clampNum(H * 0.04, 3, 5) : clampNum(H * 0.13, 8, 14)
  const valueH = Math.max(14, H - pad * 2 - labelH - subH - barH - g * 3)
  const labelY = pad
  const valueY = labelY + labelH + g
  const barY = valueY + valueH + g
  const subY = barY + barH + g
  const fill = clamp01(view.fill)
  const segs = Math.max(8, Math.min(28, s.segments ?? 16))
  const lit = Math.round(fill * segs)
  const gap = clampNum(innerW * 0.012, 1, 3)
  const cellW = Math.max(1, (innerW - gap * (segs - 1)) / segs)
  return (
    <WidgetFrame element={element} skin={skin} variant={variant} accent={accent} glowId={glowId}>
      <Caption skin={skin} x={pad} y={labelY} w={innerW} h={labelH} text={label} fill={minimal ? skin.palette.textDim : hexAlpha(accentOf(s, WARM_GOLD), 0.95)} />
      <ValueUnit element={element} skin={skin} x={pad} y={valueY} w={innerW} h={valueH} text={String(view.value)} unit={view.unit || undefined} fill={color} weight={minimal ? 600 : 700} layout="row" valueAnchor="start" />
      {minimal ? (
        <>
          <line x1={pad} y1={barY + barH / 2} x2={pad + innerW} y2={barY + barH / 2} stroke={hexAlpha(skin.palette.textDim, 0.3)} strokeWidth={barH} strokeLinecap="round" />
          {view.has && fill > 0 ? <line x1={pad} y1={barY + barH / 2} x2={pad + innerW * fill} y2={barY + barH / 2} stroke={color} strokeWidth={barH} strokeLinecap="round" /> : null}
        </>
      ) : (
        Array.from({ length: segs }, (_, i) => {
          const on = view.has && i < lit
          return <rect key={i} x={pad + i * (cellW + gap)} y={barY} width={cellW} height={barH} rx={1} fill={on ? color : hexAlpha(skin.palette.textDim, 0.22)} filter={on ? `url(#${glowId})` : undefined} />
        })
      )}
      <Caption skin={skin} x={pad} y={subY} w={innerW} h={subH} text={view.sub} fill={skin.palette.textDim} anchor="start" />
    </WidgetFrame>
  )
}

function CatchAhead({ element, variant }: NewWidgetProps & { variant: Variant }): ReactElement {
  const snapshot = usePredictionsSnapshot()
  return <PredictionCard element={element} variant={variant} label="Catch" view={catchAheadView(snapshot?.catchAhead)} />
}

function CaughtBehind({ element, variant }: NewWidgetProps & { variant: Variant }): ReactElement {
  const snapshot = usePredictionsSnapshot()
  return <PredictionCard element={element} variant={variant} label="Threat behind" view={caughtBehindView(snapshot?.caughtBehind)} />
}

function FuelMargin({ element, variant }: NewWidgetProps & { variant: Variant }): ReactElement {
  const snapshot = usePredictionsSnapshot()
  return <PredictionCard element={element} variant={variant} label="Fuel to finish" view={fuelView(snapshot)} />
}

function TireWearPred({ element, variant }: NewWidgetProps & { variant: Variant }): ReactElement {
  const snapshot = usePredictionsSnapshot()
  return <PredictionCard element={element} variant={variant} label="Tire wear" view={tireView(snapshot)} />
}

function PaceProjected({ element, variant }: NewWidgetProps & { variant: Variant }): ReactElement {
  const snapshot = usePredictionsSnapshot()
  return <PredictionCard element={element} variant={variant} label="Pace projetado" view={paceView(snapshot)} />
}

// ── Registry + dispatch ──────────────────────────────────────────────────────
export const PREDICTION_WIDGET_TYPES = [
  'pred-catch-ahead-futuristic', 'pred-catch-ahead-minimal',
  'pred-caught-behind-futuristic', 'pred-caught-behind-minimal',
  'pred-fuel-margin-futuristic', 'pred-fuel-margin-minimal',
  'pred-tire-wear-futuristic', 'pred-tire-wear-minimal',
  'pred-pace-futuristic', 'pred-pace-minimal'
] as const

export function renderPredictionWidget(props: { element: DashboardElement; snapshot: TelemetrySnapshot | null }): ReactElement | null {
  // Switch on the raw type string so this leaf registry compiles + dispatches
  // regardless of whether the integrator has added the ids to DashboardElementType.
  const type: string = props.element.type
  switch (type) {
    case 'pred-catch-ahead-futuristic': return <CatchAhead {...props} variant="futuristic" />
    case 'pred-catch-ahead-minimal': return <CatchAhead {...props} variant="minimal" />
    case 'pred-caught-behind-futuristic': return <CaughtBehind {...props} variant="futuristic" />
    case 'pred-caught-behind-minimal': return <CaughtBehind {...props} variant="minimal" />
    case 'pred-fuel-margin-futuristic': return <FuelMargin {...props} variant="futuristic" />
    case 'pred-fuel-margin-minimal': return <FuelMargin {...props} variant="minimal" />
    case 'pred-tire-wear-futuristic': return <TireWearPred {...props} variant="futuristic" />
    case 'pred-tire-wear-minimal': return <TireWearPred {...props} variant="minimal" />
    case 'pred-pace-futuristic': return <PaceProjected {...props} variant="futuristic" />
    case 'pred-pace-minimal': return <PaceProjected {...props} variant="minimal" />
    default: return null
  }
}
