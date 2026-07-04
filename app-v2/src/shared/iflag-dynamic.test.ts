import { describe, expect, it } from 'vitest'
import type { DriverEntry, TelemetrySnapshot } from './telemetry'
import {
  DEFAULT_IFLAG_DYNAMIC_CONFIG,
  computeIflagReadout,
  gapAheadSeconds,
  mergeIflagDynamicConfig,
  renderIflagDynamicFrame,
  renderIflagDynamicHexGrid
} from './iflag-dynamic'

const OFF = '#000000'
const GREEN = '#16C60C'
const YELLOW = '#FCE100'
const ORANGE = '#FF8C00'
const RED = '#E81123'
const PURPLE = '#B146C2'
const WHITE = '#FFFFFF'
const GOLD = '#FFD700'

function snap(partial: Partial<TelemetrySnapshot> = {}): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp: 1_000,
    speedKmh: 150,
    rpm: 6000,
    gear: 4,
    throttle: 0.5,
    brake: 0,
    clutch: 0,
    ...partial
  }
}

function driver(partial: Partial<DriverEntry> = {}): DriverEntry {
  return {
    carIdx: 1,
    name: 'Ahead',
    carNumber: '7',
    position: 1,
    classPosition: 1,
    classId: 0,
    isPlayer: false,
    ...partial
  }
}

describe('renderIflagDynamicHexGrid — shape & blank', () => {
  it('is a blank 8×8 grid when disconnected or null', () => {
    for (const grid of [renderIflagDynamicHexGrid(null), renderIflagDynamicHexGrid(snap({ connected: false }))]) {
      expect(grid).toHaveLength(8)
      for (const row of grid) {
        expect(row).toHaveLength(8)
        for (const cell of row) expect(cell).toBe(OFF)
      }
    }
  })
})

describe('computeIflagReadout — position', () => {
  it('uses overall position, falls back to class position', () => {
    expect(computeIflagReadout(snap({ position: 7 }), DEFAULT_IFLAG_DYNAMIC_CONFIG).position).toBe(7)
    expect(computeIflagReadout(snap({ classPosition: 3 }), DEFAULT_IFLAG_DYNAMIC_CONFIG).position).toBe(3)
    expect(computeIflagReadout(snap(), DEFAULT_IFLAG_DYNAMIC_CONFIG).position).toBeNull()
  })

  it('tints podium positions and clamps text to two digits', () => {
    expect(computeIflagReadout(snap({ position: 1 }), DEFAULT_IFLAG_DYNAMIC_CONFIG).positionColor).toBe(GOLD)
    const big = computeIflagReadout(snap({ position: 123 }), DEFAULT_IFLAG_DYNAMIC_CONFIG)
    expect(big.positionText).toBe('99')
  })
})

describe('gapAheadSeconds & gap bar', () => {
  it('reads the relative-ahead gap, else the standings driver one position ahead', () => {
    const rel = snap({ position: 4, relatives: { ahead: { carIdx: 2, name: 'A', carNumber: '9', gapSec: 0.3 } } })
    expect(gapAheadSeconds(rel)).toBeCloseTo(0.3, 5)
    const standings = snap({ position: 5, drivers: [driver({ position: 4, gapToPlayerSec: -0.8 })] })
    expect(gapAheadSeconds(standings)).toBeCloseTo(0.8, 5)
    expect(gapAheadSeconds(snap())).toBeNull()
  })

  it('lights more LEDs as the car ahead gets closer, graded by colour', () => {
    const close = computeIflagReadout(snap({ relatives: { ahead: { carIdx: 2, name: 'A', carNumber: '9', gapSec: 0.3 } } }), DEFAULT_IFLAG_DYNAMIC_CONFIG)
    expect(close.gapBarLit).toBe(7)
    expect(close.gapBarColor).toBe(RED)

    const mid = computeIflagReadout(snap({ relatives: { ahead: { carIdx: 2, name: 'A', carNumber: '9', gapSec: 1 } } }), DEFAULT_IFLAG_DYNAMIC_CONFIG)
    expect(mid.gapBarLit).toBe(5)
    expect(mid.gapBarColor).toBe(ORANGE)

    const far = computeIflagReadout(snap({ relatives: { ahead: { carIdx: 2, name: 'A', carNumber: '9', gapSec: 3 } } }), DEFAULT_IFLAG_DYNAMIC_CONFIG)
    expect(far.gapBarLit).toBe(0)
    expect(far.gapBarColor).toBe(GREEN)
  })
})

describe('delta colours', () => {
  it('colours the live delta green/red/neutral and off without data', () => {
    expect(computeIflagReadout(snap({ deltaToBestSec: -0.2 }), DEFAULT_IFLAG_DYNAMIC_CONFIG).liveDeltaColor).toBe(GREEN)
    expect(computeIflagReadout(snap({ deltaToBestSec: 0.2 }), DEFAULT_IFLAG_DYNAMIC_CONFIG).liveDeltaColor).toBe(RED)
    expect(computeIflagReadout(snap({ deltaToBestSec: 0 }), DEFAULT_IFLAG_DYNAMIC_CONFIG).liveDeltaColor).toBe('#1A1A1A')
    expect(computeIflagReadout(snap(), DEFAULT_IFLAG_DYNAMIC_CONFIG).liveDeltaColor).toBe(OFF)
  })

  it('grades the last-lap delta and flags purple for a session-best lap', () => {
    expect(computeIflagReadout(snap({ lastLapTimeSec: 90.3, bestLapTimeSec: 90 }), DEFAULT_IFLAG_DYNAMIC_CONFIG).lastLapColor).toBe(GREEN)
    expect(computeIflagReadout(snap({ lastLapTimeSec: 90.6, bestLapTimeSec: 90 }), DEFAULT_IFLAG_DYNAMIC_CONFIG).lastLapColor).toBe(YELLOW)
    expect(computeIflagReadout(snap({ lastLapTimeSec: 92, bestLapTimeSec: 90 }), DEFAULT_IFLAG_DYNAMIC_CONFIG).lastLapColor).toBe(RED)
    expect(computeIflagReadout(snap({ lastLapTimeSec: 90, bestLapTimeSec: 90, deltaToSessionBestSec: -0.1 }), DEFAULT_IFLAG_DYNAMIC_CONFIG).lastLapColor).toBe(PURPLE)
    expect(computeIflagReadout(snap(), DEFAULT_IFLAG_DYNAMIC_CONFIG).lastLapColor).toBe(OFF)
  })
})

describe('renderIflagDynamicHexGrid — pixels', () => {
  it('draws a centred single position digit in rows 2-6', () => {
    const grid = renderIflagDynamicHexGrid(snap({ position: 5 }))
    // '5' glyph top row '111' at originX 2 → cols 2,3,4 lit white.
    expect(grid[2][2]).toBe(WHITE)
    expect(grid[2][3]).toBe(WHITE)
    expect(grid[2][4]).toBe(WHITE)
    // '5' row 1 is '100' → col 3 is off.
    expect(grid[3][3]).toBe(OFF)
  })

  it('draws two digits side by side and tints P1 gold', () => {
    const grid = renderIflagDynamicHexGrid(snap({ position: 12 }))
    // '1' occupies cols 0-2, '2' cols 4-6; col 7 stays off in the digit band.
    expect(grid[2][1]).toBe(WHITE) // '1' top row '010'
    expect(grid[2][5]).toBe(WHITE) // '2' top row '111' middle pixel
    expect(grid[2][7]).toBe(OFF)

    // Single digit '1' is centred (originX 2) → top row '010' lights col 3.
    const p1 = renderIflagDynamicHexGrid(snap({ position: 1 }))
    expect(p1[2][3]).toBe(GOLD)
  })

  it('paints the delta strips and gap bar on their rows', () => {
    const grid = renderIflagDynamicHexGrid(
      snap({
        position: 4,
        lastLapTimeSec: 90.2,
        bestLapTimeSec: 90,
        deltaToBestSec: -0.3,
        relatives: { ahead: { carIdx: 2, name: 'A', carNumber: '9', gapSec: 0.3 } }
      })
    )
    expect(grid[0].every((c) => c === GREEN)).toBe(true) // last-lap delta 0.2 → green
    expect(grid[1].every((c) => c === GREEN)).toBe(true) // live delta -0.3 → green
    // gap 0.3 → 7 lit red from the left, last cell off.
    expect(grid[7].slice(0, 7).every((c) => c === RED)).toBe(true)
    expect(grid[7][7]).toBe(OFF)
  })
})

describe('renderIflagDynamicFrame — RgbFrame & brightness', () => {
  it('returns an 8×8 RgbColor grid scaled by brightness', () => {
    const full = renderIflagDynamicFrame(snap({ position: 5 }), { ...DEFAULT_IFLAG_DYNAMIC_CONFIG, brightness: 1 })
    expect(full).toHaveLength(8)
    expect(full[0]).toHaveLength(8)
    expect(full[2][2]).toEqual({ r: 255, g: 255, b: 255 })

    const dim = renderIflagDynamicFrame(snap({ position: 5 }), { ...DEFAULT_IFLAG_DYNAMIC_CONFIG, brightness: 0.5 })
    expect(dim[2][2]).toEqual({ r: 128, g: 128, b: 128 })
  })
})

describe('mergeIflagDynamicConfig', () => {
  it('clamps numbers, sanitizes the hex colour and stamps updatedAt', () => {
    const merged = mergeIflagDynamicConfig(DEFAULT_IFLAG_DYNAMIC_CONFIG, {
      enabled: true,
      brightness: 5,
      gapAheadFullSec: 0,
      positionColor: '#00ff00'
    })
    expect(merged.enabled).toBe(true)
    expect(merged.brightness).toBe(1)
    expect(merged.gapAheadFullSec).toBe(0.2)
    expect(merged.positionColor).toBe('#00FF00')
    expect(merged.updatedAt).toBeGreaterThan(0)

    const bad = mergeIflagDynamicConfig(DEFAULT_IFLAG_DYNAMIC_CONFIG, { positionColor: 'nope' })
    expect(bad.positionColor).toBe(WHITE)
  })
})
