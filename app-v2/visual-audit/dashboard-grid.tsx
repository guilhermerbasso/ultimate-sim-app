// Dashboard visual-audit grid: renders EVERY BUILTIN_PRESETS dashboard (existing +
// the v2.40 Quali/Race Wet/Sun/First/Chase presets) via the REAL renderDashboardElement
// path the Windows app uses, scaled to a readable tile. `?filter=<substr>` narrows by
// id/name (e.g. ?filter=quali). shoot-dashboards.mjs screenshots each [data-dash-id].
import './harness-stubs'

import { StrictMode, useEffect, type CSSProperties, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'

import type { Dashboard, DashboardElement } from '@shared/dashboards'
import { BUILTIN_PRESETS, sortElementsByZ } from '@shared/dashboards'
import type { TelemetrySnapshot } from '@shared/telemetry'
import { renderDashboardElement } from '@renderer/dashboard/DashboardRoot'

import { createMockSnapshot } from './mock-telemetry'
import { WidgetErrorBoundary } from './ErrorBoundary'
import './gallery.css'

const TARGET_W = 512
const SNAPSHOT: TelemetrySnapshot = createMockSnapshot()

function DashboardCell({ id, name }: { id: string; name: string }): ReactElement {
  let dashboard: Dashboard | null = null
  let buildError: string | null = null
  try {
    const entry = BUILTIN_PRESETS.find((p) => p.id === id)
    dashboard = entry ? entry.build() : null
  } catch (err) {
    buildError = err instanceof Error ? err.message : String(err)
  }

  if (!dashboard) {
    return (
      <figure className="va-cell" data-dash-id={id} data-dash-name={name} data-dash-error="1">
        <figcaption className="va-cell-label"><span className="va-id">{id}</span><span className="va-title">{name}</span></figcaption>
        <div className="va-error">build error: {buildError ?? 'preset not found'}</div>
      </figure>
    )
  }

  const baseW = dashboard.width || 1024
  const baseH = dashboard.height || 600
  const scale = TARGET_W / baseW
  const shellStyle: CSSProperties = {
    position: 'relative',
    width: Math.round(baseW * scale),
    height: Math.round(baseH * scale),
    overflow: 'hidden',
    background: dashboard.bg,
    borderRadius: 6
  }
  const canvasStyle: CSSProperties = {
    position: 'absolute',
    left: 0,
    top: 0,
    width: baseW,
    height: baseH,
    transform: `scale(${scale})`,
    transformOrigin: '0 0',
    background: dashboard.bg
  }

  return (
    <figure className="va-cell" data-dash-id={id} data-dash-name={name}>
      <figcaption className="va-cell-label"><span className="va-id">{id}</span><span className="va-title">{name}</span></figcaption>
      <div className="dashboard-shell" data-dash-shell style={shellStyle}>
        <div className="dashboard-canvas" style={canvasStyle}>
          <WidgetErrorBoundary id={id}>
            {sortElementsByZ(dashboard.elements).map((el: DashboardElement) => (
              <>{renderDashboardElement({ element: el, snapshot: SNAPSHOT })}</>
            ))}
          </WidgetErrorBoundary>
        </div>
      </div>
    </figure>
  )
}

function DashboardGrid(): ReactElement {
  const params = new URLSearchParams(window.location.search)
  const filter = (params.get('filter') ?? '').toLowerCase()
  const presets = BUILTIN_PRESETS.filter((p) => !filter || `${p.id} ${p.name}`.toLowerCase().includes(filter))

  useEffect(() => {
    document.title = `Dashboards · ${presets.length}`
    const t = window.setTimeout(() => document.body.setAttribute('data-va-ready', 'true'), 700)
    return () => window.clearTimeout(t)
  }, [presets.length])

  return (
    <div className="va-page">
      <header className="va-header">
        <h1>Dashboards</h1>
        <span className="va-pill">{presets.length} presets</span>
        <span className="va-sub">real renderer · {filter ? `filter: ${filter}` : 'all'}</span>
      </header>
      <div className="va-grid va-grid-dash">
        {presets.map((p) => (
          <DashboardCell key={p.id} id={p.id} name={p.name} />
        ))}
      </div>
    </div>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <DashboardGrid />
  </StrictMode>
)
