// Per-widget native-size grid for the overflow linter + contact sheets. Renders
// EVERY curated catalog variant at its exact native w×h (no downscale) so the
// linter measures real overflow, using the REAL single-element renderer. Pick a
// telemetry state with ?state=; ?all=1 includes raw iRacing channel tiles;
// ?filter=<substr> narrows by id/label.
import './harness-stubs'

import { StrictMode, useEffect, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'

import type { TelemetrySnapshot } from '@shared/telemetry'
import { renderDashboardElement } from '@renderer/dashboard/DashboardRoot'
import { UnitSystemProvider } from '@renderer/lib/units'
import { ALL_VARIANTS, variantToElement } from '@renderer/views/dashboard/widget-catalog-data'

import { createMockSnapshot, flagsYellowGreen, flagsBlue } from './mock-telemetry'
import { WidgetErrorBoundary } from './ErrorBoundary'
import './gallery.css'

// ── Telemetry states (self-contained overrides on the mock snapshot) ──────────
const STATES: Record<string, () => TelemetrySnapshot> = {
  drive: () => createMockSnapshot(),
  redline: () =>
    createMockSnapshot({ rpm: 8100, gear: 4, speedKmh: 262, shiftIndicatorPct: 0.99, throttle: 1, brake: 0 }),
  brake: () =>
    createMockSnapshot({ rpm: 5200, gear: 3, speedKmh: 120, throttle: 0, brake: 0.98, shiftIndicatorPct: 0.4 }),
  yellow: () => createMockSnapshot({ flags: flagsYellowGreen() }),
  blue: () => createMockSnapshot({ flags: flagsBlue() }),
  pit: () =>
    createMockSnapshot({ onPitRoad: true, pitLimiter: true, fuelLiters: 3.4, speedKmh: 58, gear: 1 }),
  // Worst-case string lengths + critical thresholds to exercise overflow guards.
  extreme: () =>
    createMockSnapshot({
      rpm: 9200,
      gear: -1,
      speedKmh: 999,
      shiftIndicatorPct: 1,
      waterTempC: 145,
      oilTempC: 138,
      fuelLiters: 1.2,
      deltaToBestSec: -99.999,
      deltaToSessionBestSec: 99.999
    })
}

function stateFactory(id: string): () => TelemetrySnapshot {
  return STATES[id] ?? STATES.drive
}

function WidgetGrid(): ReactElement {
  const params = new URLSearchParams(window.location.search)
  const stateId = params.get('state') ?? 'drive'
  const includeAll = params.get('all') === '1'
  const filter = (params.get('filter') ?? '').toLowerCase()

  const snapshot = stateFactory(stateId)()
  const variants = ALL_VARIANTS.filter((v) => {
    if (!includeAll && v.advanced) return false
    if (filter && !(`${v.id} ${v.label}`.toLowerCase().includes(filter))) return false
    return true
  })

  useEffect(() => {
    document.title = `Widgets · ${stateId} · ${variants.length}`
    const t = window.setTimeout(() => document.body.setAttribute('data-va-ready', 'true'), 600)
    return () => window.clearTimeout(t)
  }, [stateId, variants.length])

  return (
    <div className="va-page">
      <header className="va-header">
        <h1>Widget grid</h1>
        <span className="va-pill">{variants.length} widgets</span>
        <span className="va-sub">native size · state: {stateId}</span>
      </header>
      <div className="wg-grid">
        {variants.map((v) => {
          const el = variantToElement(v, 0, 0)
          return (
            <figure key={v.id} className="wg-cell" data-wid={v.id} data-wtype={v.type} data-wlabel={v.label}>
              <figcaption className="wg-cap">
                <span className="wg-id">{v.id}</span>
                <span className="wg-meta">
                  {v.type} · {v.w}×{v.h}
                </span>
              </figcaption>
              <div
                className="wg-box"
                data-wbox
                style={{ position: 'relative', width: v.w, height: v.h, overflow: 'visible', background: '#05070d' }}
              >
                <WidgetErrorBoundary id={v.id}>
                  {renderDashboardElement({ element: el, snapshot })}
                </WidgetErrorBoundary>
              </div>
            </figure>
          )
        })}
      </div>
    </div>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <UnitSystemProvider initialUnitSystem={new URLSearchParams(window.location.search).get('unit') === 'imperial' ? 'imperial' : 'metric'}>
      <WidgetGrid />
    </UnitSystemProvider>
  </StrictMode>
)
