import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { baseSnapshot } from '../../../../../shared/telemetry-scenarios'
import type { TelemetrySnapshot } from '../../../../../shared/telemetry'
import { GAPS_WIDGETS } from './index'

const badTokens = /NaN|undefined|Infinity/

function withRaceData(snapshot: TelemetrySnapshot): TelemetrySnapshot {
  return {
    ...snapshot,
    playerCarIdx: 2,
    lastLapTimeSec: 90,
    relatives: {
      ahead: { carIdx: 1, name: 'M. Koval', carNumber: '23', position: 1, classPosition: 1, gapSec: 1.23, lastLapTimeSec: 91, classColor: '#9b59ff' },
      behind: { carIdx: 3, name: 'D. Costa', carNumber: '88', position: 3, classPosition: 3, gapSec: -0.84, lastLapTimeSec: 89, classColor: '#ff6a26' }
    },
    radarCars: [
      { carIdx: 1, name: '23', relativeX: -4, relativeY: 15, gapSec: 1.23, classColor: '#9b59ff' },
      { carIdx: 3, name: '88', relativeX: 5, relativeY: -10, gapSec: -0.84, classColor: '#ff6a26' }
    ],
    drivers: Array.from({ length: 6 }, (_, i) => ({
      carIdx: i,
      name: i === 2 ? 'YOU' : `Driver ${i + 1}`,
      carNumber: String(20 + i),
      position: i + 1,
      classPosition: i + 1,
      classId: i % 3 === 0 ? 1 : 0,
      className: i % 3 === 0 ? 'LMP2' : 'GT3',
      classColor: i % 3 === 0 ? '#35d66b' : '#9b59ff',
      gapToPlayerSec: (i - 2) * 1.21,
      lastLapTimeSec: 90 + (i - 2),
      isPlayer: i === 2
    }))
  }
}

function renderWidget(id: string, snapshot: TelemetrySnapshot): string {
  const widget = GAPS_WIDGETS.find((candidate) => candidate.id === id)
  expect(widget).toBeDefined()
  return renderToStaticMarkup(createElement(widget!.render, { snapshot, width: widget!.defaultSize.w, height: widget!.defaultSize.h }))
}

function renderAll(snapshot: TelemetrySnapshot | null): string[] {
  return GAPS_WIDGETS.map((widget) => renderToStaticMarkup(createElement(widget.render, { snapshot, width: widget.defaultSize.w, height: widget.defaultSize.h })))
}

describe('GAPS_WIDGETS', () => {
  it('has unique ids', () => {
    const ids = GAPS_WIDGETS.map((widget) => widget.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('renders base, null, and extreme invalid snapshots without unsafe tokens', () => {
    const extreme = withRaceData({
      ...baseSnapshot(),
      relatives: {
        ahead: { carIdx: 1, name: 'Bad Ahead', carNumber: '7', position: Number.NaN, classPosition: Number.POSITIVE_INFINITY, gapSec: Number.NaN, classColor: '#9b59ff' },
        behind: { carIdx: 3, name: 'Bad Behind', carNumber: '9', position: Number.NEGATIVE_INFINITY, classPosition: Number.NaN, gapSec: Number.POSITIVE_INFINITY, classColor: '#ff6a26' }
      },
      radarCars: [{ carIdx: 4, name: 'Bad', relativeX: Number.NaN, relativeY: Number.POSITIVE_INFINITY, classColor: '#54df4b' }],
      drivers: [
        { carIdx: 2, name: 'YOU', carNumber: '22', position: Number.NaN, classPosition: Number.POSITIVE_INFINITY, classId: 0, classColor: '#9b59ff', gapToPlayerSec: Number.NaN, isPlayer: true }
      ]
    })

    for (const markup of [...renderAll(withRaceData(baseSnapshot())), ...renderAll(null), ...renderAll(extreme)]) {
      expect(markup.length).toBeGreaterThan(100)
      expect(markup).not.toMatch(badTokens)
    }
  })

  it('keeps clean SVG output without titles, subtitles, arrows, backgrounds, or frames', () => {
    for (const markup of renderAll(withRaceData(baseSnapshot()))) {
      expect(markup).not.toContain('PLAYER-CENTRIC RELATIVE')
      expect(markup).not.toMatch(/[▲▼]/)
      expect(markup).not.toMatch(/GAP AHEAD|GAP BEHIND|DELTA AHEAD|DELTA BEHIND|RELATIVE|STANDINGS|RADAR|PROXIMITY LIVE|NO CARS NEARBY/)
      expect(markup).not.toContain('fill="#000000"')
      expect(markup).not.toContain('fill="#0b0d10"')
      expect(markup).not.toContain('stroke="rgba(255,255,255,0.20)"')
    }
  })

  it('colors gap pace proxy by relative last lap versus player last lap', () => {
    const closingAhead = withRaceData(baseSnapshot())
    const closingBehind = withRaceData(baseSnapshot())
    const relatives = closingBehind.relatives!
    closingBehind.relatives = { ...relatives, ahead: { ...relatives.ahead!, lastLapTimeSec: 88 }, behind: { ...relatives.behind!, lastLapTimeSec: 89 } }
    const neutral = withRaceData(baseSnapshot())
    neutral.lastLapTimeSec = undefined

    expect(renderWidget('gapAhead', closingAhead)).toContain('fill="#22e06a"')
    expect(renderWidget('gapBehind', closingBehind)).toContain('fill="#ff3b30"')
    expect(renderWidget('gapAhead', neutral)).toContain('fill="#f5f7fa"')
  })

  it('clips driver names before the fixed right-aligned gap column', () => {
    const snapshot = withRaceData(baseSnapshot())
    snapshot.relatives!.ahead = { ...snapshot.relatives!.ahead!, name: 'Maximilian Very Long Driver Name' }
    snapshot.relatives!.behind = { ...snapshot.relatives!.behind!, name: 'Daniel Extremely Long Surname' }

    const markup = renderWidget('relative', snapshot)
    expect(markup).toContain('<clipPath id="gaps-name-clip-ahead')
    expect(markup).toContain('clip-path="url(#gaps-name-clip-ahead')
    expect(markup).toContain('text-anchor="end"')
  })
})
