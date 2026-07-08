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
    relatives: {
      ahead: { carIdx: 1, name: 'M. Koval', carNumber: '23', position: 1, classPosition: 1, gapSec: 1.23, classColor: '#9b59ff' },
      behind: { carIdx: 3, name: 'D. Costa', carNumber: '88', position: 3, classPosition: 3, gapSec: -0.84, classColor: '#ff6a26' }
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
      isPlayer: i === 2
    }))
  }
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
})
