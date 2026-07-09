import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { baseSnapshot } from '../../../../../shared/telemetry-scenarios'
import type { TelemetrySnapshot } from '../../../../../shared/telemetry'
import { THEMED_CHANNEL_WIDGETS } from './index'

const badTokens = /NaN|undefined|Infinity/

function dataSnapshot(): TelemetrySnapshot {
  return {
    ...baseSnapshot(),
    speedKmh: 214,
    rpm: 6800,
    gear: 4,
    throttle: 0.9,
    brake: 0.1,
    clutch: 0,
    steerAngleDeg: -85,
    waterTempC: 92,
    oilTempC: 110,
    fuelLiters: 44,
    fuelLevelPct: 0.62,
    deltaToBestSec: -0.32,
    deltaToSessionBestSec: 0.14,
    position: 3,
    lapDistPct: 0.41,
    trackTempC: 38,
    airTempC: 24
  }
}

function renderWidget(widget: (typeof THEMED_CHANNEL_WIDGETS)[number], snapshot: TelemetrySnapshot | null): string {
  return renderToStaticMarkup(createElement(widget.render, { snapshot, width: widget.defaultSize.w, height: widget.defaultSize.h }))
}

describe('THEMED_CHANNEL_WIDGETS', () => {
  it('generates 102 widgets (17 channels × 6 cars) with unique ids', () => {
    expect(THEMED_CHANNEL_WIDGETS).toHaveLength(102)
    const ids = THEMED_CHANNEL_WIDGETS.map((w) => w.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('each widget requires exactly one telemetry field and is tagged themed/channel', () => {
    for (const w of THEMED_CHANNEL_WIDGETS) {
      expect(w.requires).toHaveLength(1)
      expect(w.tags).toContain('themed')
      expect(w.tags).toContain('channel')
    }
  })

  it('renders base, null, data, and extreme invalid snapshots without unsafe tokens', () => {
    const extreme = {
      ...baseSnapshot(),
      speedKmh: Number.NaN,
      rpm: Number.POSITIVE_INFINITY,
      gear: Number.NaN,
      throttle: Number.NaN,
      brake: Number.POSITIVE_INFINITY,
      clutch: Number.NEGATIVE_INFINITY,
      steerAngleDeg: Number.NaN,
      waterTempC: Number.NaN,
      oilTempC: Number.POSITIVE_INFINITY,
      fuelLiters: Number.NaN,
      fuelLevelPct: Number.NaN,
      deltaToBestSec: Number.NaN,
      deltaToSessionBestSec: Number.POSITIVE_INFINITY,
      position: Number.NaN,
      lapDistPct: Number.NaN,
      trackTempC: Number.NaN,
      airTempC: Number.NEGATIVE_INFINITY
    } as TelemetrySnapshot

    for (const snapshot of [baseSnapshot(), null, dataSnapshot(), extreme]) {
      for (const widget of THEMED_CHANNEL_WIDGETS) {
        const markup = renderWidget(widget, snapshot)
        expect(markup.length).toBeGreaterThan(80)
        expect(markup, `${widget.id} emitted unsafe token`).not.toMatch(badTokens)
      }
    }
  })
})
