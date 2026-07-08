// ── Hi-fi full-frame dashboard widgets ────────────────────────────────────────
// Thin overlay-widget wrappers that mount the high-fidelity 1024x600 hi-fi clusters
// (DDU / Endurance / Engineer) inside the dashboards system via a single
// `overlaywidget` element (see OVERLAY_DASHBOARD_PRESETS in shared/dashboards.ts).
// They adapt the WidgetProps contract ({ snapshot, config }) to the hi-fi component
// props and keep a short rolling history so the engineer traces are live.
import { useRef, type ReactElement } from 'react'
import type { WidgetProps } from './types'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { DduCluster } from '../../hifi/DduCluster'
import { EnduranceCluster } from '../../hifi/EnduranceCluster'
import { EngineerDash } from '../../hifi/EngineerDash'

// A "no telemetry" snapshot: required numeric fields NaN → the hi-fi components
// render em-dashes rather than fake data, matching their absent-channel behaviour.
const EMPTY_SNAPSHOT: TelemetrySnapshot = {
  sim: 'none',
  connected: false,
  timestamp: 0,
  speedKmh: Number.NaN,
  rpm: Number.NaN,
  gear: Number.NaN,
  throttle: Number.NaN,
  brake: Number.NaN,
  clutch: Number.NaN
} as TelemetrySnapshot

export function HifiDduWidget({ snapshot }: WidgetProps): ReactElement {
  return <DduCluster snapshot={snapshot ?? EMPTY_SNAPSHOT} />
}

export function HifiEnduranceWidget({ snapshot }: WidgetProps): ReactElement {
  return <EnduranceCluster snapshot={snapshot ?? EMPTY_SNAPSHOT} />
}

export function HifiEngineerWidget({ snapshot }: WidgetProps): ReactElement {
  const history = useRef<TelemetrySnapshot[]>([])
  const last = history.current[history.current.length - 1]
  if (snapshot && (!last || last.timestamp !== snapshot.timestamp)) {
    history.current = [...history.current, snapshot].slice(-240)
  }
  return <EngineerDash snapshot={snapshot ?? EMPTY_SNAPSHOT} history={history.current} />
}
