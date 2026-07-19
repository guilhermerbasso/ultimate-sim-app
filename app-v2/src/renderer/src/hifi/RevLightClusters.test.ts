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

  it('keeps the DDU RPM step bar calibrated while blink only drives the shift arc', () => {
    const shifted = {
      ...baseSnapshot(),
      rpm: 4250,
      maxRpm: 8500,
      shiftIndicatorPct: 0.2,
      revLights: { pct: 0.2, blink: true }
    } as TelemetrySnapshot
    const markup = render(DduCluster, shifted)

    expect(markup).toContain('data-rpm-gauge="ddu-step-bar"')
    expect(markup).toContain('data-rpm-pct="0.5000"')
    expect(markup).toContain('data-rpm-lit="5"')
    expect(markup).toContain('>x1000</text>')
    expect(markup).not.toContain('>SHIFT %</text>')
    expect(markup).toContain('dur="0.14s"')
  })

  it('keeps DDU width and height overrides independent', () => {
    const markup = renderToStaticMarkup(createElement(DduCluster, {
      snapshot: baseSnapshot(),
      width: 1280,
      height: 360
    }))
    expect(markup).toContain('width="1280"')
    expect(markup).toContain('height="360"')
    expect(markup).toContain('viewBox="0 0 1024 600"')
  })
})
