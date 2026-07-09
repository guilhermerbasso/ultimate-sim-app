import type { ReactElement } from 'react'
import { overlayDesignFamily } from '../../../../shared/overlays'
import { TrackCoachingHeatmap } from '../../components/TrackCoachingHeatmap'
import { useTrackMapData } from '../../lib/track-map'
import { useCoachReport } from '../../lib/coach-heatmap'
import type { WidgetProps } from './types'
import { pct } from './format'
import { DataTile, TelltaleIcon } from '../../instruments'
import './redesign-radar.css'

// WS-M — read-only coaching HEATMAP overlay. Same coloured corner map as the
// interactive Coach panel (RED loss / GREEN on-par / BLUE gain) but glanceable:
// no click, no expand. Rides the EXISTING `trackmap:` + `coach:` preload prefixes
// (geometry via `useTrackMapData`, report via `useCoachReport`); the telemetry
// `snapshot` only supplies the live player marker position.
export function CoachHeatmapWidget({ snapshot, config }: WidgetProps): ReactElement {
  const family = overlayDesignFamily(config?.stylePreset)
  const { data: trackData, status: trackStatus } = useTrackMapData()
  const report = useCoachReport()

  const playerPct = pct(snapshot?.lapDistPct)
  const accent = config?.style?.accent ?? '#ff6a00'
  const outline = config?.style?.border ?? '#24445d'
  const trackName = trackData?.trackName ?? trackStatus?.currentTrackName ?? snapshot?.trackName ?? 'Track'

  return (
    <div className={`overlay-card rd3-root rd3-map rd3-fam-${family}`}>
      <div className="rd3-map-head">
        {family === 'neon' ? 'COACH HEATMAP' : 'Coaching · curvas'}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <DataTile label="LAP" value={Math.round(playerPct * 100)} unit="%" width={104} height={44} color={accent} accent={accent} material="carbon" idPrefix="coach-heatmap-lap" />
        <TelltaleIcon icon="temp" active={!!report} activeColor={accent} label={report ? 'vs reference' : 'waiting for lap'} size={22} idPrefix="coach-heatmap-state" />
      </div>
      <div className="rd3-map-stage">
        <TrackCoachingHeatmap
          mode="readonly"
          data={trackData}
          report={report}
          playerPct={playerPct}
          accent={accent}
          outlineColor={outline}
          showLegend
        />
      </div>
      <div className="rd3-map-meta">
        <span>{trackName}</span>
        <span>{report ? 'vs reference' : 'waiting for lap'}</span>
      </div>
    </div>
  )
}
