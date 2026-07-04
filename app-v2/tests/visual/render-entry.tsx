// Bundled by scripts/capture-widgets.mjs (esbuild, css loader=empty) and executed
// in Node to produce static widget markup for the GT3 hero clusters across a few
// telemetry scenarios. Playwright then renders that markup with the real overlay CSS
// + embedded DSEG/condensed fonts and screenshots it into tests/visual/current, so
// scripts/visual-regression.mjs can gate font/colour drift. Pure render — no DOM.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { WIDGET_COMPONENTS } from '../../src/renderer/src/overlay/widgets/index'
import { createDefaultOverlaysConfig } from '../../src/shared/overlays'
import { TELEMETRY_SCENARIOS } from '../../src/shared/telemetry-scenarios'
import type { TelemetryScenarioId } from '../../src/shared/telemetry-scenarios'

const HERO_WIDGETS = ['gt3Cluster', 'gearSpeed', 'revlights', 'symbolStatus', 'gridStackDash', 'gridProDash', 'bosch296Dash', 'ringDash', 'lmuEnduranceDash', 'lmuStintDash'] as const
const HERO_SCENARIOS: TelemetryScenarioId[] = ['shift-light-sweep', 'hard-braking', 'yellow-flag', 'low-fuel']

export interface Capture {
  name: string
  html: string
}

export function render(): Capture[] {
  const config = createDefaultOverlaysConfig()
  const out: Capture[] = []
  for (const widgetId of HERO_WIDGETS) {
    const Component = WIDGET_COMPONENTS[widgetId]
    // Full-frame dashboards were moved out of the overlay picker (no default config
    // entry); fall back to a minimal stub so the capture still renders them.
    const widgetConfig = config.widgets[widgetId] ?? {
      id: widgetId,
      enabled: true,
      locked: false,
      favorite: false,
      position: { x: 0, y: 0, width: 1280, height: 720 },
      opacity: 100,
      stylePreset: 'default',
      style: {},
      display: null
    }
    if (!Component) continue
    for (const scenarioId of HERO_SCENARIOS) {
      const scenario = TELEMETRY_SCENARIOS[scenarioId]
      if (!scenario) continue
      const snapshot = scenario.frame(0.85)
      try {
        const html = renderToStaticMarkup(createElement(Component, { snapshot, config: widgetConfig }))
        out.push({ name: `${widgetId}__${scenarioId}`, html })
      } catch {
        // skip a widget/scenario that throws — capture is best-effort
      }
    }
  }
  return out
}
