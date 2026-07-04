// IMPORTANT: stubs first so dashboard effects find a safe window.ipc/window.api.
import './harness-stubs'

import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import type { CSSProperties } from 'react'

import type { Dashboard, DashboardElement } from '@shared/dashboards'
import { BUILTIN_PRESETS, sortElementsByZ } from '@shared/dashboards'
import type { TelemetrySnapshot } from '@shared/telemetry'

// Reuse the REAL single-element renderer (same primitives + GT3/extra widgets +
// binding resolution the dashboard windows use). Importing from DashboardRoot
// also pulls in dashboard-runtime.css so styling is production-accurate.
import { renderDashboardElement } from '@renderer/dashboard/DashboardRoot'

import { createMockSnapshot } from './mock-telemetry'
import { WidgetErrorBoundary } from './ErrorBoundary'
import './gallery.css'

// Scaled-down render width per dashboard cell (canvases are ~1024×600 native).
const TARGET_W = 500

// A representative spread across the catalogue families: dense GT3 DDUs, ACC
// style, clean/minimal wheels, warm "NP" colour variants, graphic-first FX
// futuristic, and the wave-16 futuristic + minimalist kits. Missing ids are
// skipped gracefully; the set is topped up by even sampling if needed.
const PREFERRED_IDS = [
  'gt3_cup_ddu_fuel',
  'acc_style_full',
  'grid_dense_ddu',
  'compact_hud',
  'spotter_race',
  'mclaren_minimal',
  'np_crimson_tyres',
  'np_amber_wide_center',
  'fx_neon_furnace_halo',
  'fx_amber_quantum_blade',
  'race-hud-futuristic',
  'hud-cluster-futuristic',
  'vector-telemetry-futuristic',
  'primary-minimal',
  'tyres-pressures-minimal',
  'energy-manager-minimal',
  'delta-focus-minimal',
  'standings-minimal'
]

const MIN_PRESETS = 12

function selectPresets(): Array<{ id: string; name: string }> {
  const byId = new Map(BUILTIN_PRESETS.map((p) => [p.id, p]))
  const chosen = new Map<string, { id: string; name: string }>()
  for (const id of PREFERRED_IDS) {
    const entry = byId.get(id)
    if (entry) chosen.set(id, { id: entry.id, name: entry.name })
  }
  // Allow an explicit ?presets=a,b,c override for ad-hoc QA.
  const override = new URLSearchParams(window.location.search).get('presets')
  if (override) {
    chosen.clear()
    for (const id of override.split(',').map((s) => s.trim())) {
      const entry = byId.get(id)
      if (entry) chosen.set(id, { id: entry.id, name: entry.name })
    }
  }
  // Top up by even sampling if we have too few.
  if (chosen.size < MIN_PRESETS && BUILTIN_PRESETS.length > 0) {
    const step = Math.max(1, Math.floor(BUILTIN_PRESETS.length / MIN_PRESETS))
    for (let i = 0; i < BUILTIN_PRESETS.length && chosen.size < MIN_PRESETS; i += step) {
      const entry = BUILTIN_PRESETS[i]
      if (!chosen.has(entry.id)) chosen.set(entry.id, { id: entry.id, name: entry.name })
    }
  }
  return [...chosen.values()]
}

const SNAPSHOT = createMockSnapshot()

function DashElement({ element, snapshot }: { element: DashboardElement; snapshot: TelemetrySnapshot | null }) {
  return <>{renderDashboardElement({ element, snapshot })}</>
}

function DashboardCell({ id, name }: { id: string; name: string }) {
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
      <div className="va-cell" data-dash-id={id}>
        <div className="va-cell-label">
          <span className="va-id">{id}</span>
          <span className="va-title">{name}</span>
        </div>
        <div className="va-error">build error: {buildError ?? 'preset not found'}</div>
      </div>
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
    borderRadius: 8
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
    <div className="va-cell" data-dash-id={id}>
      <div className="va-cell-label">
        <span className="va-id">{id}</span>
        <span className="va-title">{name}</span>
      </div>
      <div className="dashboard-shell" style={shellStyle}>
        <div className="dashboard-canvas" style={canvasStyle}>
          <WidgetErrorBoundary id={id}>
            {sortElementsByZ(dashboard.elements).map((el) => (
              <DashElement key={el.id} element={el} snapshot={SNAPSHOT} />
            ))}
          </WidgetErrorBoundary>
        </div>
      </div>
    </div>
  )
}

function DashboardGallery() {
  const presets = selectPresets()

  useEffect(() => {
    document.title = `Dashboards · ${presets.length} presets`
    const t = window.setTimeout(() => {
      document.body.setAttribute('data-va-ready', 'true')
    }, 500)
    return () => window.clearTimeout(t)
  }, [presets.length])

  return (
    <div className="va-page">
      <header className="va-header">
        <h1>Dashboard presets</h1>
        <span className="va-pill">{presets.length} presets</span>
        <span className="va-sub">real dashboard renderer · representative spread of the catalogue</span>
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
    <DashboardGallery />
  </StrictMode>
)
