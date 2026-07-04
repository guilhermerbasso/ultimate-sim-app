// WS-M — read-only coaching HEATMAP dashboard widget (v2.39 KIT). A leaf registry
// (imports the skin KIT, the heatmap component + the pure lib helpers, never
// gt3-widgets) so it slots into the `renderGt3Widget` fallback chain WITHOUT a
// cycle and WITHOUT requiring the integrator to add the id to
// `DashboardElementType` first — it dispatches on the raw type string, exactly
// like new-widgets-predictions.tsx.
//
// The body is an HTML/canvas track map (TrackCoachingHeatmap) so — unlike the
// pure-SVG widgets — it keeps a thin HTML flex-column wrapper. Only the chrome is
// modernised to the skin token system and the header label is routed through the
// skin-aware FitText inside a small SVG so it stays legible and overflow-safe.
// Same coloured corner map as the interactive Coach panel (RED loss / GREEN
// on-par / BLUE gain), glanceable: no click, no expand. Data rides the EXISTING
// `trackmap:` + `coach:` preload prefixes; the telemetry `snapshot` only supplies
// the live player marker position.

import type { CSSProperties, ReactElement } from 'react'
import type { DashboardElement } from '../../../../shared/dashboards'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { TrackCoachingHeatmap } from '../../components/TrackCoachingHeatmap'
import { useTrackMapData } from '../../lib/track-map'
import { useCoachReport } from '../../lib/coach-heatmap'
import { FitText, resolveElementSkin } from '../../skins'
import { accentOf, type NewWidgetProps } from './new-widgets-kit'

function clampNum(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function CoachHeatmap({ element, snapshot }: NewWidgetProps): ReactElement {
  const s = element.style
  const skin = resolveElementSkin(s)
  const accent = accentOf(s, skin.palette.accent)
  const { data: trackData } = useTrackMapData()
  const report = useCoachReport()
  const playerPct =
    typeof snapshot?.lapDistPct === 'number' && Number.isFinite(snapshot.lapDistPct) ? snapshot.lapDistPct : undefined

  const mat = skin.material
  const W = Math.max(1, element.w)
  const H = Math.max(1, element.h)
  // The embedded HTML/canvas heatmap wants ~225px of vertical room for its
  // min-height map surface + wrapped legend. In a compact 240² cell that barely
  // fits, so the skin-token label is OVERLAID (absolute) on the top strip rather
  // than consuming a flow row — giving the heatmap the full padded box height,
  // which keeps the wrapped legend inside the widget bounds (no overflow).
  const pad = clampNum(Math.min(W, H) * 0.015, 3, 4)
  const headerH = clampNum(H * 0.08, 12, 15)

  const shell: CSSProperties = {
    position: 'relative',
    width: '100%',
    height: '100%',
    boxSizing: 'border-box',
    padding: pad,
    background: mat.base,
    border: `1px solid ${mat.border}`,
    borderRadius: mat.radius
  }
  const headerStyle: CSSProperties = {
    position: 'absolute',
    top: pad,
    left: pad,
    width: `calc(100% - ${pad * 2}px)`,
    height: headerH,
    display: 'block',
    pointerEvents: 'none',
    zIndex: 2
  }

  return (
    <div style={shell} className="coach-heatmap-widget">
      <svg
        viewBox={`0 0 ${W} ${headerH}`}
        preserveAspectRatio="xMinYMid meet"
        style={headerStyle}
      >
        <FitText
          x={0}
          y={headerH / 2}
          boxW={W}
          boxH={headerH}
          text="Coaching · curvas"
          anchor="start"
          baseline="middle"
          fontFamily={skin.typography.label}
          fill={accent}
          weight={600}
          letterSpacing={0.6}
          minFontPx={Math.max(1, skin.typography.minFontPx)}
          maxFontPx={Math.max(skin.typography.minFontPx, Math.min(15, headerH))}
          overflowStrategy="ellipsis"
        />
      </svg>
      <div style={{ width: '100%', height: '100%' }}>
        <TrackCoachingHeatmap
          mode="readonly"
          data={trackData}
          report={report}
          playerPct={playerPct}
          accent={accent}
          showLegend
        />
      </div>
    </div>
  )
}

// ── Registry + dispatch ──────────────────────────────────────────────────────
export const COACH_HEATMAP_WIDGET_TYPES = ['coach-heatmap'] as const

export function renderCoachHeatmapWidget(props: {
  element: DashboardElement
  snapshot: TelemetrySnapshot | null
}): ReactElement | null {
  // Switch on the raw type string so this leaf registry compiles + dispatches
  // regardless of whether the integrator has added the id to DashboardElementType.
  const type: string = props.element.type
  switch (type) {
    case 'coach-heatmap':
      return <CoachHeatmap {...props} />
    default:
      return null
  }
}
