import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { TelemetrySnapshot } from '../../../shared/telemetry'
import { baseSnapshot } from '../../../shared/telemetry-scenarios'
import { SHIFT_STROBE_BLUE } from '../lib/rev-lights'
import { DduCluster } from './DduCluster'
import { EnduranceCluster } from './EnduranceCluster'
import { MinimalDash } from './MinimalDash'

const clusters: Array<[string, ComponentType<{ snapshot: TelemetrySnapshot }>]> = [
  ['ddu', DduCluster],
  ['endurance', EnduranceCluster],
  ['minimal', MinimalDash]
]

function render(Component: ComponentType<{ snapshot: TelemetrySnapshot }>, snapshot: TelemetrySnapshot): string {
  return renderToStaticMarkup(createElement(Component, { snapshot }))
}

describe('full-frame rev-light clusters', () => {
  it('uses provider blink before percentage fallback and strobes every LED blue', () => {
    const providerOff = {
      ...baseSnapshot(),
      shiftIndicatorPct: 0.999,
      revLights: { pct: 0.999, blink: false }
    } as TelemetrySnapshot
    const providerOn = {
      ...baseSnapshot(),
      shiftIndicatorPct: 0.2,
      revLights: { pct: 0.2, blink: true }
    } as TelemetrySnapshot

    for (const [name, Component] of clusters) {
      const normal = render(Component, providerOff)
      const shifted = render(Component, providerOn)
      expect(normal, name).not.toContain(SHIFT_STROBE_BLUE)
      expect(normal, name).not.toContain('repeatCount="indefinite"')
      expect(shifted, name).toContain(SHIFT_STROBE_BLUE)
      expect(shifted, name).toContain('repeatCount="indefinite"')
    }
  })

  it('retains the runtime percentage fallback when blink is absent', () => {
    const fallback = {
      ...baseSnapshot(),
      shiftIndicatorPct: 1,
      revLights: { pct: 1 }
    } as TelemetrySnapshot

    for (const [name, Component] of clusters) {
      expect(render(Component, fallback), name).toContain('repeatCount="indefinite"')
    }
  })
})
