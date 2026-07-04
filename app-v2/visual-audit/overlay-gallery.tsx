// IMPORTANT: stubs first so widget effects find a safe window.ipc/window.api.
import './harness-stubs'

import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import type { CSSProperties } from 'react'

import type {
  OverlayWidgetConfig,
  OverlayWidgetId,
  OverlayStylePresetId
} from '@shared/overlays'
import {
  OVERLAY_STYLE_PRESETS,
  OVERLAY_WIDGETS,
  createDefaultOverlayStyle,
  DEFAULT_OVERLAY_STYLE_PRESET,
  getOverlayStylePreset
} from '@shared/overlays'

// Real overlay shell + widget CSS so the gallery looks production-accurate.
// (overlayWidgetsR16.css is pulled in transitively by the widget index.)
import '@renderer/overlay/overlay-runtime.css'
import { WIDGET_COMPONENTS } from '@renderer/overlay/widgets'

import { createMockSnapshot } from './mock-telemetry'
import { WidgetErrorBoundary } from './ErrorBoundary'
import './gallery.css'

const MAX_W = 460
const MAX_H = 340

function resolvePreset(): OverlayStylePresetId {
  const raw = new URLSearchParams(window.location.search).get('preset') ?? ''
  const match = OVERLAY_STYLE_PRESETS.find((p) => p.id === raw)
  return (match?.id ?? DEFAULT_OVERLAY_STYLE_PRESET) as OverlayStylePresetId
}

function buildConfig(id: OverlayWidgetId, preset: OverlayStylePresetId): OverlayWidgetConfig {
  const definition = OVERLAY_WIDGETS.find((w) => w.id === id)
  const position = definition
    ? { ...definition.defaultPosition }
    : { x: 0, y: 0, width: 320, height: 200 }
  return {
    id,
    enabled: true,
    locked: true,
    favorite: false,
    position,
    opacity: 100,
    stylePreset: preset,
    style: createDefaultOverlayStyle(preset),
    display: null
  }
}

function shellVars(config: OverlayWidgetConfig): CSSProperties {
  // Mirror OverlayRoot's CSS-var application exactly so styling matches runtime.
  return {
    '--overlay-bg': config.style.background,
    '--overlay-accent': config.style.accent,
    '--overlay-border': config.style.border,
    '--overlay-radius': `${config.style.radius}px`,
    '--overlay-font': config.style.fontFamily,
    '--overlay-content-opacity': '1'
  } as CSSProperties
}

const SNAPSHOT = createMockSnapshot()

function OverlayCell({
  id,
  title,
  preset
}: {
  id: OverlayWidgetId
  title: string
  preset: OverlayStylePresetId
}) {
  const Widget = WIDGET_COMPONENTS[id]
  const config = buildConfig(id, preset)
  const natW = config.position.width
  const natH = config.position.height
  const scale = Math.min(1, MAX_W / natW, MAX_H / natH)
  const stageStyle: CSSProperties = {
    width: Math.round(natW * scale),
    height: Math.round(natH * scale)
  }
  // The real overlay shell, sized to the widget's native footprint and scaled to
  // fit the cell (crisp: rendered at native px, then transformed).
  const shellStyle: CSSProperties = {
    ...shellVars(config),
    position: 'absolute',
    top: 0,
    left: 0,
    width: natW,
    height: natH,
    transform: `scale(${scale})`,
    transformOrigin: 'top left'
  }

  return (
    <div className="va-cell" data-widget-id={id}>
      <div className="va-cell-label">
        <span className="va-id">{id}</span>
        <span className="va-title">{title}</span>
      </div>
      <div className="va-stage-wrap">
        <div className="va-stage" style={stageStyle}>
          <main className="overlay-shell" style={shellStyle}>
            <WidgetErrorBoundary id={id}>
              {Widget ? (
                <Widget snapshot={SNAPSHOT} config={config} />
              ) : (
                <div className="va-error">no component for {id}</div>
              )}
            </WidgetErrorBoundary>
          </main>
        </div>
      </div>
    </div>
  )
}

function OverlayGallery() {
  const preset = resolvePreset()
  const presetMeta = getOverlayStylePreset(preset)
  const ids = OVERLAY_WIDGETS.map((w) => w.id)

  useEffect(() => {
    document.title = `Overlays · ${presetMeta.title}`
    // Signal "rendered" for the screenshot script; give rAF-driven widgets
    // (g-force, radars, track map) a couple frames to paint first.
    const t = window.setTimeout(() => {
      document.body.setAttribute('data-va-ready', 'true')
    }, 350)
    return () => window.clearTimeout(t)
  }, [presetMeta.title])

  return (
    <div className="va-page">
      <header className="va-header">
        <h1>Overlay widgets</h1>
        <span className="va-pill">{presetMeta.title}</span>
        <span className="va-sub">
          preset <code>{preset}</code> · {ids.length} widgets · {presetMeta.description}
        </span>
      </header>
      <div className="va-grid">
        {OVERLAY_WIDGETS.map((w) => (
          <OverlayCell key={w.id} id={w.id} title={w.title} preset={preset} />
        ))}
      </div>
    </div>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <OverlayGallery />
  </StrictMode>
)
