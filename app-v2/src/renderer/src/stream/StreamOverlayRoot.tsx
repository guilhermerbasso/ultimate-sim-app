import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import type { OverlayWidgetConfig, OverlayWidgetId } from '../../../shared/overlays'
import { createDefaultOverlaysConfig, createDefaultOverlayStyle, DEFAULT_OVERLAY_STYLE_PRESET } from '../../../shared/overlays'
import type { StreamingTelemetryFrame } from '../../../shared/streaming'
import type { TelemetrySnapshot } from '../../../shared/telemetry'
import { CompactHudWidget, COMPACT_HUD_STREAM_SAFE } from '../overlay/widgets/CompactHudWidget'
import { DeltaLapWidget } from '../overlay/widgets/DeltaLapWidget'
import { FuelWidget } from '../overlay/widgets/FuelWidget'
import { GearSpeedWidget } from '../overlay/widgets/GearSpeedWidget'
import { GT3ClusterWidget, GT3_CLUSTER_STREAM_SAFE } from '../overlay/widgets/GT3ClusterWidget'
import { RelativeWidget } from '../overlay/widgets/RelativeWidget'
import type { WidgetProps } from '../overlay/widgets/types'

const WIDGETS: Array<{ id: OverlayWidgetId; title: string; className: string; streamSafe: boolean; Component: (props: WidgetProps) => ReactElement }> = [
  { id: 'gt3Cluster', title: 'GT3 Cluster', className: 'stream-gt3-cluster', streamSafe: GT3_CLUSTER_STREAM_SAFE, Component: GT3ClusterWidget },
  { id: 'gearSpeed', title: 'Gear / speed', className: 'stream-gear', streamSafe: true, Component: GearSpeedWidget },
  { id: 'compactHud', title: 'Compact HUD', className: 'stream-compact-hud', streamSafe: COMPACT_HUD_STREAM_SAFE, Component: CompactHudWidget },
  { id: 'deltaLap', title: 'Delta', className: 'stream-delta', streamSafe: true, Component: DeltaLapWidget },
  { id: 'fuel', title: 'Fuel', className: 'stream-fuel', streamSafe: true, Component: FuelWidget },
  { id: 'relative', title: 'Relative', className: 'stream-relative', streamSafe: true, Component: RelativeWidget }
]

function sseUrl(): string {
  const url = new URL(window.location.href)
  const token = url.searchParams.get('token') ?? ''
  const sse = new URL('/sse', url.origin)
  sse.searchParams.set('token', token)
  return sse.toString()
}

function widgetConfig(id: OverlayWidgetId): OverlayWidgetConfig {
  return createDefaultOverlaysConfig().widgets[id] ?? {
    id,
    enabled: true,
    locked: true,
    position: { x: 0, y: 0, width: 320, height: 160 },
    opacity: 100,
    stylePreset: DEFAULT_OVERLAY_STYLE_PRESET,
    style: createDefaultOverlayStyle(),
    display: null
  }
}

export function StreamOverlayRoot() {
  const [snapshot, setSnapshot] = useState<TelemetrySnapshot | null>(null)
  const [connected, setConnected] = useState(false)
  const [streamSafe, setStreamSafe] = useState(true)
  const configs = useMemo(() => Object.fromEntries(WIDGETS.map((item) => [item.id, widgetConfig(item.id)])) as Record<OverlayWidgetId, OverlayWidgetConfig>, [])
  const shellStyle = {
    '--overlay-bg': 'rgba(5, 10, 18, 0.60)',
    '--overlay-accent': '#ff6a00',
    '--overlay-border': 'rgba(138, 164, 200, 0.32)',
    '--overlay-radius': '18px',
    '--overlay-font': 'Segoe UI, sans-serif',
    '--overlay-content-opacity': '1'
  } as CSSProperties

  useEffect(() => {
    const source = new EventSource(sseUrl())
    source.onopen = () => setConnected(true)
    source.onerror = () => setConnected(false)
    source.addEventListener('telemetry', (event) => {
      try {
        const frame = JSON.parse((event as MessageEvent).data) as StreamingTelemetryFrame
        setSnapshot(frame.snapshot)
        setStreamSafe(frame.streamSafe)
        setConnected(true)
      } catch {
        setConnected(false)
      }
    })
    return () => source.close()
  }, [])

  return (
    <main className="stream-root" style={shellStyle}>
      <div className="stream-stage">
        {WIDGETS.map(({ id, title, className, streamSafe: widgetStreamSafe, Component }) => (
          <section key={id} className={`stream-widget ${className}`} aria-label={`${title}${widgetStreamSafe ? ' stream safe' : ''}`}>
            <Component snapshot={snapshot} config={configs[id]} />
          </section>
        ))}
      </div>
      <div className={connected && snapshot?.connected ? 'stream-status is-live' : 'stream-status'}>
        {connected && snapshot?.connected ? 'LIVE' : 'WAITING'}{streamSafe ? ' · STREAM SAFE' : ''}
      </div>
    </main>
  )
}
